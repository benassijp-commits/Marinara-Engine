const NarrativeDirectorApi = (() => {
  "use strict";
  const core = globalThis.__NarrativeDirectorCore;
  const INSTRUCTION_LIMIT = 4_000;
  const SELECTED_TEXT_LIMIT = 50_000;

  function createApi(marinara) {
    let lastRawResponse = "";
    async function request(path, options = {}) {
      const response = await marinara.apiFetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
      if (response && typeof response === "object" && typeof response.error === "string") {
        const field = response.field || response.param || response.path || response.details?.field || response.details?.param || response.details?.path;
        const safeField = typeof field === "string" && /^[A-Za-z0-9_.\[\]-]{1,120}$/.test(field) ? field : "";
        throw new Error(safeField ? `${response.error}: ${safeField}` : response.error);
      }
      return response;
    }
    const get = (path) => request(path);
    const post = (path, body) => request(path, { method: "POST", body: JSON.stringify(body) });
    const patch = (path, body) => request(path, { method: "PATCH", body: JSON.stringify(body) });
    const remove = (path) => request(path, { method: "DELETE" });

    function rewrite(body, label) {
      if (typeof body.instruction !== "string" || body.instruction.length > INSTRUCTION_LIMIT) throw new Error(`${label} instruction exceeds the Marinara 4,000-character limit`);
      if (typeof body.selectedText !== "string" || body.selectedText.length > SELECTED_TEXT_LIMIT) throw new Error(`${label} selectedText exceeds the Marinara 50,000-character limit`);
      return post("/agents/suite/rewrite", body);
    }

    async function rewriteAndParse({ connectionId, selectedText, instruction, label, agentName, dataLabel, parse, keepRaw = false }) {
      const first = await rewrite({ connectionId, selectedText, instruction, agentName, dataLabel }, label);
      if (typeof first?.rewrittenText !== "string") throw new Error(`${label} connection returned no usable text.`);
      if (keepRaw) lastRawResponse = first.rewrittenText;
      try { return parse(first.rewrittenText); } catch (firstError) {
        if (first.rewrittenText.length > SELECTED_TEXT_LIMIT) throw firstError;
        const repaired = await rewrite({ connectionId, selectedText: first.rewrittenText, instruction: core.REPAIR_PROMPT, agentName: `${agentName} JSON Repair`, dataLabel: `${dataLabel} invalid JSON response` }, `${label} repair`);
        if (typeof repaired?.rewrittenText !== "string") throw firstError;
        if (keepRaw) lastRawResponse = `${first.rewrittenText}\n\n[Automatic repair attempt]\n${repaired.rewrittenText}`;
        try { return parse(repaired.rewrittenText); } catch { throw firstError; }
      }
    }

    async function listCharacters() {
      const result = await get("/characters?limit=500&sort=name"); const rows = Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : [];
      return rows.map((row) => { let data = row.data; if (typeof data === "string") try { data = JSON.parse(data); } catch { data = {}; } return { id: row.id, name: data?.name || row.name || "Unnamed character" }; });
    }
    async function listChats() { const rows = await get("/chats"); return Array.isArray(rows) ? rows : []; }
    async function listConnections() { const rows = await get("/connections"); return (Array.isArray(rows) ? rows : []).filter((row) => !["image_generation", "video_generation"].includes(row.provider)); }
    async function listAgents() { const rows = await get("/agents"); return Array.isArray(rows) ? rows : []; }
    async function getChat(chatId) { return get(`/chats/${encodeURIComponent(chatId)}`); }
    async function listChatMessages(chatId) { const rows = await get(`/chats/${encodeURIComponent(chatId)}/messages`); return Array.isArray(rows) ? rows : []; }
    async function getGameState(chatId) { return get(`/chats/${encodeURIComponent(chatId)}/game-state`); }

    async function getAgentStatuses(chatId) {
      const [agents, chat] = await Promise.all([listAgents(), chatId ? getChat(chatId) : Promise.resolve({ metadata: {} })]);
      return core.agentStatuses(agents, core.parseMetadata(chat?.metadata));
    }
    async function updateChatActivation(chatId, active) {
      const statuses = await getAgentStatuses(chatId);
      if (active && Object.values(statuses).some((entry) => entry.status === "missing")) throw new Error("Import and configure both fixed Narrative Director agents before activation.");
      const chat = await getChat(chatId); const metadata = core.parseMetadata(chat?.metadata); const activeAgentIds = core.updateFixedActivation(core.activeAgentTypes(metadata), active);
      return patch(`/chats/${encodeURIComponent(chatId)}/metadata`, { activeAgentIds, ...(active ? { enableAgents: true } : {}) });
    }

    async function getAgentMemory(agentType, chatId) { const result = await get(`/agents/memory/${encodeURIComponent(agentType)}/${encodeURIComponent(chatId)}`); return result?.memory || {}; }
    async function patchAgentMemory(agentType, chatId, memory) { return patch(`/agents/memory/${encodeURIComponent(agentType)}/${encodeURIComponent(chatId)}`, { patch: memory }); }
    async function deleteAgentMemory(agentType, chatId) { return remove(`/agents/memory/${encodeURIComponent(agentType)}/${encodeURIComponent(chatId)}`); }
    async function loadProjectMemories(chatId) {
      const types = core.agentTypes(); const [director, tracker] = await Promise.all([getAgentMemory(types.director, chatId), getAgentMemory(types.tracker, chatId)]); return { director, tracker };
    }
    async function syncProjectMemories(project) {
      if (!core.cleanId(project.chatId)) throw new Error("Choose a chat before synchronizing memory.");
      const statuses = await getAgentStatuses(project.chatId);
      if (Object.values(statuses).some((entry) => entry.status === "missing")) throw new Error("Both fixed agents must exist before memory can be synchronized.");
      const types = core.agentTypes(); const directorMemory = core.buildDirectorMemory(project); const trackerMemory = core.buildTrackerMemory(project);
      const directorResult = await patchAgentMemory(types.director, project.chatId, directorMemory);
      try { const trackerResult = await patchAgentMemory(types.tracker, project.chatId, trackerMemory); return { director: directorResult, tracker: trackerResult }; }
      catch (error) { error.directorMemoryUpdated = Boolean(directorResult); throw error; }
    }

    async function analyzeStory(connectionId, sourceText, projectType = "character_focus") {
      lastRawResponse = "";
      if (!core.cleanId(connectionId)) throw new Error("Choose an analysis connection.");
      if (typeof sourceText !== "string" || !sourceText.trim()) throw new Error("Paste a story before analyzing it.");
      if (sourceText.length > core.MAX_ANALYSIS_SOURCE_LENGTH) throw new Error(`Story analysis supports up to ${core.MAX_ANALYSIS_SOURCE_LENGTH.toLocaleString()} characters.`);
      return rewriteAndParse({ connectionId, selectedText: sourceText, instruction: core.analysisInstruction(projectType), label: "Analysis", agentName: "Narrative Director Structured Extractor", dataLabel: "Fictional source", parse: core.parseAnalysisResponse, keepRaw: true });
    }

    async function initializeFromChat(connectionId, project, messages, options = {}) {
      if (!core.cleanId(connectionId)) throw new Error("Choose an initialization connection.");
      try {
        const prepared = core.buildInitializationInput(project, messages); options.onProgress?.({ block: 1, blockCount: 1, messageStart: 1, messageEnd: prepared.messageCount });
        const initialState = await rewriteAndParse({ connectionId, selectedText: prepared.input, instruction: core.INITIALIZATION_PROMPT, label: "Initialization", agentName: "Narrative Director Chat Initializer", dataLabel: "Private project and active history", parse: core.parseInitializationResponse });
        if (options.signal?.aborted) { const error = new Error("Initialization cancelled. No partial state was saved."); error.name = "AbortError"; throw error; }
        return { initialState, messageCount: prepared.messageCount, blockCount: 1, splits: [] };
      } catch (error) { if (error.name === "AbortError" || !/exceed|too large|50,000/i.test(error.message || "")) throw error; }
      const resume = options.resume && options.resume.projectId === project.id && options.resume.chatId === project.chatId ? options.resume : { projectId: project.id, chatId: project.chatId, cursor: { messagePosition: 0, offset: 0, part: 1 }, partialState: null, completedBlocks: 0, splits: [] };
      while (true) {
        if (options.signal?.aborted) { const error = new Error("Initialization cancelled. No partial state was saved."); error.name = "AbortError"; throw error; }
        const block = core.buildNextInitializationBlock(project, messages, resume.cursor, resume.partialState, { instruction: core.INITIALIZATION_PROMPT }); if (block.done) break;
        const blockNumber = resume.completedBlocks + 1; options.onProgress?.({ block: blockNumber, blockCount: null, messageStart: block.messageStart, messageEnd: block.messageEnd, splits: block.splitMessageParts });
        try {
          resume.partialState = await rewriteAndParse({ connectionId, selectedText: block.selectedText, instruction: core.INITIALIZATION_PROMPT, label: `Initialization block ${blockNumber}`, agentName: "Narrative Director Chat Initializer", dataLabel: `Chronological history block ${blockNumber}`, parse: core.parseInitializationResponse });
          resume.cursor = block.nextCursor; resume.completedBlocks = blockNumber; resume.splits.push(...block.splitMessageParts);
        } catch (cause) { const error = new Error(`Initialization block ${blockNumber} failed: ${cause.message || "unknown error"}`); error.initializationCheckpoint = resume; error.block = blockNumber; throw error; }
      }
      return { initialState: resume.partialState, messageCount: core.normalizeInitializationMessages(messages).length, blockCount: resume.completedBlocks, splits: resume.splits };
    }

    async function createCharacter(payload) { return post("/characters", payload); }
    async function createLorebook(payload) { return post("/lorebooks", payload); }
    async function createLorebookEntry(lorebookId, payload) { return post(`/lorebooks/${encodeURIComponent(lorebookId)}/entries`, payload); }
    function readIds(value) { if (Array.isArray(value)) return value.filter(core.cleanId); if (typeof value === "string") try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter(core.cleanId) : []; } catch { return []; } return []; }
    async function associateCharactersWithChat(chatId, characterIds) { const chat = await getChat(chatId); return patch(`/chats/${encodeURIComponent(chatId)}`, { characterIds: Array.from(new Set([...readIds(chat.characterIds), ...characterIds])) }); }
    async function associateLorebookWithChat(chatId, lorebookId) { const chat = await getChat(chatId); const metadata = core.parseMetadata(chat.metadata); return patch(`/chats/${encodeURIComponent(chatId)}/metadata`, { activeLorebookIds: Array.from(new Set([...readIds(metadata.activeLorebookIds), lorebookId])), excludedLorebookIds: readIds(metadata.excludedLorebookIds).filter((id) => id !== lorebookId) }); }

    return { get, listCharacters, listChats, listConnections, listAgents, getChat, listChatMessages, getGameState, getAgentStatuses, updateChatActivation,
      getAgentMemory, patchAgentMemory, deleteAgentMemory, loadProjectMemories, syncProjectMemories, analyzeStory, initializeFromChat,
      createCharacter, createLorebook, createLorebookEntry, associateCharactersWithChat, associateLorebookWithChat,
      getLastRawResponse: () => lastRawResponse, clearLastRawResponse: () => { lastRawResponse = ""; } };
  }
  return { createApi };
})();

globalThis.__NarrativeDirectorApi = NarrativeDirectorApi;
