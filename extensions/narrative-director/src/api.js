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

    async function listLorebookEntries(lorebookId) { const rows = await get(`/lorebooks/${encodeURIComponent(lorebookId)}/entries`); return Array.isArray(rows) ? rows : []; }
    async function listLorebooks() { const rows = await get("/lorebooks"); return Array.isArray(rows) ? rows : Array.isArray(rows?.items) ? rows.items : []; }
    async function updateLorebookEntry(lorebookId, entryId, payload) { return patch(`/lorebooks/${encodeURIComponent(lorebookId)}/entries/${encodeURIComponent(entryId)}`, payload); }
    async function discoverProjectLorebook(chatId) {
      const books = await listLorebooks(); const candidates = books.filter((book) => book?.chatId === chatId || (book?.scope?.mode === "specific" && Array.isArray(book.scope.chatIds) && book.scope.chatIds.includes(chatId)));
      for (const book of candidates) { if (!core.cleanId(book?.id)) continue; const entries = await listLorebookEntries(book.id); if (entries.some((entry) => entry?.name === core.DIRECTOR_LOREBOOK_SENTINEL)) return { lorebookId: book.id, entries }; }
      return null;
    }
    async function keepTransportOutOfActiveLorebooks(chatId, lorebookId) { const chat = await getChat(chatId); const metadata = core.parseMetadata(chat?.metadata); return patch(`/chats/${encodeURIComponent(chatId)}/metadata`, { activeLorebookIds: readIds(metadata.activeLorebookIds).filter((id) => id !== lorebookId), excludedLorebookIds: readIds(metadata.excludedLorebookIds).filter((id) => id !== lorebookId) }); }
    async function upsertTechnicalEntry(lorebookId, entryId, payload) {
      if (core.cleanId(entryId)) { const updated = await updateLorebookEntry(lorebookId, entryId, payload); if (!core.cleanId(updated?.id)) throw new Error(`No entry ID returned for ${payload.name}.`); return updated; }
      const created = await createLorebookEntry(lorebookId, payload); if (!core.cleanId(created?.id)) throw new Error(`No entry ID returned for ${payload.name}.`); return created;
    }
    async function syncProjectLorebook(project) {
      if (!core.cleanId(project.chatId)) throw new Error("Choose a chat before synchronizing the project lorebook.");
      let lorebookId = core.cleanId(project.agentLorebookId); let knownEntries = [];
      if (!lorebookId) { const discovered = await discoverProjectLorebook(project.chatId); lorebookId = discovered?.lorebookId || ""; knownEntries = discovered?.entries || []; }
      if (!lorebookId) { const created = await createLorebook({ name: `${project.name} · Agent Transport`, description: "Narrative Director agent transport. Do not select as a Knowledge Router source.", category: "uncategorized", chatId: project.chatId, scope: { mode: "specific", chatIds: [project.chatId] }, generatedBy: "user", recursiveScanning: false, excludeFromVectorization: true }); lorebookId = core.cleanId(created?.id); if (!lorebookId) throw new Error("No lorebook ID returned."); }
      await keepTransportOutOfActiveLorebooks(project.chatId, lorebookId);
      if (!knownEntries.length) knownEntries = await listLorebookEntries(lorebookId);
      const transport = core.buildLorebookTransport(project); const entryIds = { ...project.agentEntryIds };
      const directorKnown = knownEntries.find((entry) => entry?.name === core.DIRECTOR_LOREBOOK_SENTINEL); const trackerKnown = knownEntries.find((entry) => entry?.name === core.TRACKER_LOREBOOK_SENTINEL);
      const director = await upsertTechnicalEntry(lorebookId, directorKnown?.id, transport.director); entryIds.director = director.id;
      try { const tracker = await upsertTechnicalEntry(lorebookId, trackerKnown?.id, transport.tracker); entryIds.tracker = tracker.id; }
      catch (error) { error.directorLorebookUpdated = true; error.lorebookId = lorebookId; error.entryIds = entryIds; throw error; }
      const completeProject = core.createProject({ ...project, agentLorebookId: lorebookId, agentEntryIds: entryIds }, project.createdAt);
      await updateLorebookEntry(lorebookId, entryIds.director, core.buildLorebookTransport(completeProject).director);
      return { lorebookId, entryIds };
    }
    async function loadProjectFromLorebook(chatId) {
      const discovered = await discoverProjectLorebook(chatId); if (!discovered) throw new Error("No synchronized Narrative Director lorebook was found for this chat.");
      const entry = discovered.entries.find((row) => row?.name === core.DIRECTOR_LOREBOOK_SENTINEL); if (!entry?.content) throw new Error("The Director project entry is empty.");
      return { project: core.parseDirectorLorebookContent(entry.content, { chatId }), lorebookId: discovered.lorebookId, entryIds: { director: entry.id, tracker: discovered.entries.find((row) => row?.name === core.TRACKER_LOREBOOK_SENTINEL)?.id || "" } };
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
      syncProjectLorebook, loadProjectFromLorebook, discoverProjectLorebook, listLorebooks, listLorebookEntries, updateLorebookEntry, analyzeStory, initializeFromChat,
      createCharacter, createLorebook, createLorebookEntry, associateCharactersWithChat, associateLorebookWithChat,
      getLastRawResponse: () => lastRawResponse, clearLastRawResponse: () => { lastRawResponse = ""; } };
  }
  return { createApi };
})();

globalThis.__NarrativeDirectorApi = NarrativeDirectorApi;
