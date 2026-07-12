const NarrativeDirectorApi = (() => {
  "use strict";
  const core = globalThis.__NarrativeDirectorCore;
  const REWRITE_INSTRUCTION_LIMIT = 4_000;
  const REWRITE_SELECTED_TEXT_LIMIT = 50_000;

  function validationField(response) {
    const candidates = [response?.field, response?.param, response?.path, response?.details?.field, response?.details?.param, response?.details?.path];
    if (Array.isArray(response?.details)) {
      for (const detail of response.details) candidates.push(detail?.field, detail?.param, detail?.path);
    }
    const value = candidates.find((item) => typeof item === "string" || Array.isArray(item));
    const field = Array.isArray(value) ? value.join(".") : value;
    return typeof field === "string" && /^[A-Za-z0-9_.\[\]-]{1,120}$/.test(field) ? field : "";
  }

  function createApi(marinara) {
    let lastAnalysisRawResponse = "";
    async function request(path, options = {}) {
      const response = await marinara.apiFetch(path, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      });
      if (response && typeof response === "object" && typeof response.error === "string") {
        const field = validationField(response);
        throw new Error(field ? `${response.error}: ${field}` : response.error);
      }
      return response;
    }

    const get = (path) => request(path);
    const post = (path, body) => request(path, { method: "POST", body: JSON.stringify(body) });
    const patch = (path, body) => request(path, { method: "PATCH", body: JSON.stringify(body) });
    const postRewrite = (body, label) => {
      if (typeof body.instruction !== "string" || body.instruction.length > REWRITE_INSTRUCTION_LIMIT) {
        throw new Error(`${label} instruction exceeds the Marinara 4,000-character limit`);
      }
      if (typeof body.selectedText !== "string" || body.selectedText.length > REWRITE_SELECTED_TEXT_LIMIT) {
        throw new Error(`${label} selectedText exceeds the Marinara 50,000-character limit`);
      }
      return post("/agents/suite/rewrite", body);
    };

    async function listCharacters() {
      const result = await get("/characters?limit=500&sort=name");
      const rows = Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : [];
      return rows.map((row) => {
        let data = row.data;
        if (typeof data === "string") {
          try { data = JSON.parse(data); } catch { data = {}; }
        }
        return { id: row.id, name: data?.name || row.name || "Unnamed character" };
      });
    }

    async function listChats() {
      const rows = await get("/chats");
      return Array.isArray(rows) ? rows : [];
    }

    async function listConnections() {
      const rows = await get("/connections");
      return (Array.isArray(rows) ? rows : []).filter((row) => row.provider !== "image_generation" && row.provider !== "video_generation");
    }

    async function listAgents() {
      const rows = await get("/agents");
      return Array.isArray(rows) ? rows : [];
    }

    async function upsertAgent(story, role, existingAgents) {
      const payload = role === "director"
        ? core.buildDirectorPayload(story)
        : core.buildTrackerPayload(story);
      const existing = existingAgents.find((agent) => agent.type === payload.type);
      if (existing) {
        const updated = await patch(`/agents/${encodeURIComponent(existing.id)}`, payload);
        return updated;
      }
      return post("/agents", payload);
    }

    async function ensureAgents(story) {
      const before = await listAgents();
      let director;
      try {
        director = await upsertAgent(story, "director", before);
        const tracker = await upsertAgent(story, "tracker", [...before, director]);
        return { director, tracker };
      } catch (error) {
        if (error && typeof error === "object") error.directorUpdated = Boolean(director?.id);
        throw error;
      }
    }

    async function updateChatActivation(chatId, story, active) {
      const chat = await get(`/chats/${encodeURIComponent(chatId)}`);
      const metadata = core.parseMetadata(chat.metadata);
      const existing = core.activeAgentTypes(metadata);
      const types = core.storyTypes(story);
      const activeAgentIds = active
        ? core.activateTypes(existing, types)
        : core.deactivateTypes(existing, types);
      return patch(`/chats/${encodeURIComponent(chatId)}/metadata`, {
        activeAgentIds,
        ...(active ? { enableAgents: true } : {}),
      });
    }

    async function getGameState(chatId) {
      return get(`/chats/${encodeURIComponent(chatId)}/game-state`);
    }

    async function listChatMessages(chatId) {
      const rows = await get(`/chats/${encodeURIComponent(chatId)}/messages`);
      return Array.isArray(rows) ? rows : [];
    }

    async function initializeFromChat(connectionId, story, messages, options = {}) {
      if (!core.cleanId(connectionId)) throw new Error("Choose an initialization connection.");
      try {
        const prepared = core.buildInitializationInput(story, messages);
        options.onProgress?.({ block: 1, blockCount: 1, messageStart: 1, messageEnd: prepared.messageCount });
        const response = await postRewrite({
          connectionId, selectedText: prepared.input, instruction: core.INITIALIZATION_PROMPT,
          agentName: "Narrative Director Existing Chat Initializer", dataLabel: "Private story plan and active chat history",
        }, "Initialization");
        if (options.signal?.aborted) {
          const error = new Error("Initialization cancelled. No partial state was saved.");
          error.name = "AbortError";
          throw error;
        }
        if (typeof response?.rewrittenText !== "string") throw new Error("The initialization connection returned no usable text.");
        return { initialState: core.parseInitializationResponse(response.rewrittenText), messageCount: prepared.messageCount, blockCount: 1, splits: [] };
      } catch (error) {
        if (!/exceed|too large/i.test(error.message || "")) throw error;
      }
      const prepared = core.buildInitializationChunks(story, messages);
      const resume = options.resume && options.resume.storyId === story.id && options.resume.chatId === story.chatId
        ? options.resume : { storyId: story.id, chatId: story.chatId, nextBlock: 0, partialState: null };
      for (let index = resume.nextBlock; index < prepared.chunks.length; index++) {
        if (options.signal?.aborted) {
          const error = new Error("Initialization cancelled. No partial state was saved.");
          error.name = "AbortError";
          throw error;
        }
        const chunk = prepared.chunks[index];
        options.onProgress?.({ block: index + 1, blockCount: prepared.chunks.length, messageStart: chunk.messageStart, messageEnd: chunk.messageEnd, splits: chunk.splitMessageParts });
        try {
          const response = await postRewrite({
            connectionId,
            selectedText: core.buildInitializationChunkInput(story, chunk, resume.partialState),
            instruction: core.INITIALIZATION_PROMPT,
            agentName: "Narrative Director Existing Chat Initializer",
            dataLabel: `Private story plan and active chat history block ${index + 1} of ${prepared.chunks.length}`,
          }, "Initialization");
          if (options.signal?.aborted) {
            const cancelled = new Error("Initialization cancelled. No partial state was saved.");
            cancelled.name = "AbortError";
            throw cancelled;
          }
          if (typeof response?.rewrittenText !== "string") throw new Error("The initialization connection returned no usable text.");
          resume.partialState = core.parseInitializationResponse(response.rewrittenText);
          resume.nextBlock = index + 1;
        } catch (cause) {
          if (cause.name === "AbortError") throw cause;
          const error = new Error(`Initialization block ${index + 1} of ${prepared.chunks.length} failed: ${cause.message || "unknown error"}`);
          error.initializationCheckpoint = resume;
          error.block = index + 1;
          error.blockCount = prepared.chunks.length;
          throw error;
        }
      }
      return {
        initialState: resume.partialState, messageCount: prepared.messageCount, blockCount: prepared.chunks.length,
        splits: prepared.chunks.flatMap((chunk) => chunk.splitMessageParts),
      };
    }

    async function createCharacter(payload) {
      return post("/characters", payload);
    }

    async function createLorebook(payload) {
      return post("/lorebooks", payload);
    }

    async function createLorebookEntry(lorebookId, entry) {
      return post(`/lorebooks/${encodeURIComponent(lorebookId)}/entries`, entry);
    }

    function readIds(value) {
      if (Array.isArray(value)) return value.filter((id) => typeof id === "string" && id.trim());
      if (typeof value !== "string") return [];
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string" && id.trim()) : [];
      } catch {
        return [];
      }
    }

    async function associateCharacterWithChat(chatId, characterId) {
      const chat = await get(`/chats/${encodeURIComponent(chatId)}`);
      const characterIds = Array.from(new Set([...readIds(chat.characterIds), characterId]));
      return patch(`/chats/${encodeURIComponent(chatId)}`, { characterIds });
    }

    async function associateLorebookWithChat(chatId, lorebookId) {
      const chat = await get(`/chats/${encodeURIComponent(chatId)}`);
      const metadata = core.parseMetadata(chat.metadata);
      const activeLorebookIds = Array.from(new Set([...readIds(metadata.activeLorebookIds), lorebookId]));
      const excludedLorebookIds = readIds(metadata.excludedLorebookIds).filter((id) => id !== lorebookId);
      return patch(`/chats/${encodeURIComponent(chatId)}/metadata`, { activeLorebookIds, excludedLorebookIds });
    }

    async function analyzeStory(connectionId, sourceText) {
      lastAnalysisRawResponse = "";
      if (!core.cleanId(connectionId)) throw new Error("Choose an analysis connection.");
      if (typeof sourceText !== "string" || !sourceText.trim()) throw new Error("Paste a story before analyzing it.");
      if (sourceText.length > core.MAX_ANALYSIS_SOURCE_LENGTH) {
        throw new Error(`Story analysis supports up to ${core.MAX_ANALYSIS_SOURCE_LENGTH.toLocaleString()} characters.`);
      }
      const response = await postRewrite({
        connectionId,
        selectedText: sourceText,
        instruction: core.ANALYSIS_PROMPT,
        agentName: "Narrative Director Story Analyst",
        dataLabel: "Fictional story source",
      }, "Analysis");
      if (typeof response?.rewrittenText !== "string") {
        throw new Error("The analysis connection returned no usable text.");
      }
      lastAnalysisRawResponse = response.rewrittenText;
      return core.parseAnalysisResponse(response.rewrittenText);
    }

    function getLastAnalysisRawResponse() {
      return lastAnalysisRawResponse;
    }

    function clearLastAnalysisRawResponse() {
      lastAnalysisRawResponse = "";
    }

    return {
      get,
      post,
      patch,
      listCharacters,
      listChats,
      listConnections,
      listAgents,
      ensureAgents,
      updateChatActivation,
      getGameState,
      listChatMessages,
      initializeFromChat,
      createCharacter,
      createLorebook,
      createLorebookEntry,
      associateCharacterWithChat,
      associateLorebookWithChat,
      analyzeStory,
      getLastAnalysisRawResponse,
      clearLastAnalysisRawResponse,
    };
  }

  return { createApi };
})();

globalThis.__NarrativeDirectorApi = NarrativeDirectorApi;
