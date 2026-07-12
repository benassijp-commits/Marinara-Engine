const NarrativeDirectorApi = (() => {
  "use strict";
  const core = globalThis.__NarrativeDirectorCore;

  function createApi(marinara) {
    async function request(path, options = {}) {
      const response = await marinara.apiFetch(path, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      });
      if (response && typeof response === "object" && typeof response.error === "string") {
        throw new Error(response.error);
      }
      return response;
    }

    const get = (path) => request(path);
    const post = (path, body) => request(path, { method: "POST", body: JSON.stringify(body) });
    const patch = (path, body) => request(path, { method: "PATCH", body: JSON.stringify(body) });

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

    async function initializeFromChat(connectionId, story, messages) {
      if (!core.cleanId(connectionId)) throw new Error("Choose an initialization connection.");
      const prepared = core.buildInitializationInput(story, messages);
      const response = await post("/agents/suite/rewrite", {
        connectionId,
        selectedText: prepared.input,
        instruction: core.INITIALIZATION_PROMPT,
        agentName: "Narrative Director Existing Chat Initializer",
        dataLabel: "Private story plan and active chat history",
      });
      if (typeof response?.rewrittenText !== "string") {
        throw new Error("The initialization connection returned no usable text.");
      }
      return { initialState: core.parseInitializationResponse(response.rewrittenText), messageCount: prepared.messageCount };
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
      if (!core.cleanId(connectionId)) throw new Error("Choose an analysis connection.");
      if (typeof sourceText !== "string" || !sourceText.trim()) throw new Error("Paste a story before analyzing it.");
      if (sourceText.length > core.MAX_ANALYSIS_SOURCE_LENGTH) {
        throw new Error(`Story analysis supports up to ${core.MAX_ANALYSIS_SOURCE_LENGTH.toLocaleString()} characters.`);
      }
      const response = await post("/agents/suite/rewrite", {
        connectionId,
        selectedText: sourceText,
        instruction: core.ANALYSIS_PROMPT,
        agentName: "Narrative Director Story Analyst",
        dataLabel: "Fictional story source",
      });
      if (typeof response?.rewrittenText !== "string") {
        throw new Error("The analysis connection returned no usable text.");
      }
      return core.parseAnalysisResponse(response.rewrittenText);
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
    };
  }

  return { createApi };
})();

globalThis.__NarrativeDirectorApi = NarrativeDirectorApi;
