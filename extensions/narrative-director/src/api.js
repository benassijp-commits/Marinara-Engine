const NarrativeDirectorApi = (() => {
  "use strict";
  const core = globalThis.__NarrativeDirectorCore;
  const INSTRUCTION_LIMIT = 4_000;
  const SELECTED_TEXT_LIMIT = 50_000;

  function createApi(marinara) {
    let lastRawResponse = "";
    async function request(path, options = {}) {
      const response = await marinara.apiFetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
      if (response && typeof response === "object" && typeof response.error === "string") { const field = response.field || response.param || response.path || response.details?.field; const safe = typeof field === "string" && /^[A-Za-z0-9_.\[\]-]{1,120}$/.test(field) ? field : ""; throw new Error(safe ? `${response.error}: ${safe}` : response.error); }
      return response;
    }
    const get = (path) => request(path);
    const post = (path, body) => request(path, { method: "POST", body: JSON.stringify(body) });
    const patch = (path, body) => request(path, { method: "PATCH", body: JSON.stringify(body) });
    function rewrite(body, label) { if (typeof body.instruction !== "string" || body.instruction.length > INSTRUCTION_LIMIT) throw new Error(`${label} instruction exceeds the Marinara 4,000-character limit`); if (typeof body.selectedText !== "string" || body.selectedText.length > SELECTED_TEXT_LIMIT) throw new Error(`${label} selectedText exceeds the Marinara 50,000-character limit`); return post("/agents/suite/rewrite", body); }
    function finishReason(response) { return response?.finishReason || response?.finish_reason || response?.choices?.[0]?.finish_reason || ""; }

    async function listCharacters() { const result = await get("/characters?limit=500&sort=name"); const rows = Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : []; return rows.map((row) => { let data = row.data; if (typeof data === "string") try { data = JSON.parse(data); } catch { data = {}; } return { id: row.id, name: data?.name || row.name || "Unnamed character" }; }); }
    async function listChats() { const rows = await get("/chats"); return Array.isArray(rows) ? rows : []; }
    async function listConnections() { const rows = await get("/connections"); return (Array.isArray(rows) ? rows : []).filter((row) => !["image_generation", "video_generation"].includes(row.provider)); }
    async function listAgents() { const rows = await get("/agents"); return Array.isArray(rows) ? rows : []; }
    async function getChat(chatId) { return get(`/chats/${encodeURIComponent(chatId)}`); }
    async function listChatMessages(chatId) { const rows = await get(`/chats/${encodeURIComponent(chatId)}/messages`); return Array.isArray(rows) ? rows : []; }
    async function getAgentStatuses(chatId) { const [agents, chat] = await Promise.all([listAgents(), chatId ? getChat(chatId) : Promise.resolve({ metadata: {} })]); return core.agentStatuses(agents, core.parseMetadata(chat?.metadata)); }
    async function updateChatActivation(chatId, active) { const statuses = await getAgentStatuses(chatId); if (active && statuses.curator.status === "missing") throw new Error("Import the fixed Narrative Curator v4 agent before activation."); const chat = await getChat(chatId); const metadata = core.parseMetadata(chat?.metadata); return patch(`/chats/${encodeURIComponent(chatId)}/metadata`, { activeAgentIds: core.updateFixedActivation(core.activeAgentTypes(metadata), active), ...(active ? { enableAgents: true } : {}) }); }

    async function analyzeStory(connectionId, sourceText, rules) {
      if (!core.cleanId(connectionId)) throw new Error("Choose an analysis connection."); if (typeof sourceText !== "string" || !sourceText.trim()) throw new Error("Paste a story before analyzing it."); if (sourceText.length > core.MAX_SOURCE_LENGTH) throw new Error("Story analysis supports up to 50,000 characters."); lastRawResponse = "";
      const response = await rewrite({ connectionId, selectedText: sourceText, instruction: core.ANALYSIS_PROMPT, agentName: "Narrative Curator v4 Story Extractor", dataLabel: "Fictional source", contextSections: [{ label: "User analysis rules", content: core.analysisRules(rules) }] }, "Analysis");
      if (typeof response?.rewrittenText !== "string") throw new Error("Analysis connection returned no usable text."); lastRawResponse = response.rewrittenText; return core.parseAnalysisResponse(response.rewrittenText, finishReason(response));
    }

    async function initializeFromChat(connectionId, project, messages, options = {}) {
      if (!core.cleanId(connectionId)) throw new Error("Choose an initialization connection."); const prepared = core.buildInitializationInput(project, messages, { chatSummary: options.chatSummary });
      const response = await rewrite({ connectionId, selectedText: prepared.input, instruction: core.INITIALIZATION_PROMPT, agentName: "Narrative Curator v4 Chat Initializer", dataLabel: "Private project and recent active history" }, "Initialization");
      if (typeof response?.rewrittenText !== "string") throw new Error("Initialization connection returned no usable text."); return { state: core.parseInitializationResponse(response.rewrittenText, project.story, finishReason(response)), ...prepared };
    }

    async function listLorebookEntries(lorebookId) { const rows = await get(`/lorebooks/${encodeURIComponent(lorebookId)}/entries`); return Array.isArray(rows) ? rows : []; }
    async function listLorebooks() { const rows = await get("/lorebooks"); return Array.isArray(rows) ? rows : Array.isArray(rows?.items) ? rows.items : []; }
    async function updateLorebookEntry(lorebookId, entryId, payload) { return patch(`/lorebooks/${encodeURIComponent(lorebookId)}/entries/${encodeURIComponent(entryId)}`, payload); }
    async function discoverProjectLorebook(chatId) { const books = await listLorebooks(); const candidates = books.filter((book) => book?.chatId === chatId || book?.scope?.mode === "specific" && Array.isArray(book.scope.chatIds) && book.scope.chatIds.includes(chatId)); for (const book of candidates) { if (!core.cleanId(book?.id)) continue; const entries = await listLorebookEntries(book.id); if (entries.some((entry) => entry?.name === core.CURATOR_LOREBOOK_SENTINEL)) return { lorebookId: book.id, entries }; } return null; }
    function readIds(value) { if (Array.isArray(value)) return value.filter(core.cleanId); if (typeof value === "string") try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter(core.cleanId) : []; } catch { return []; } return []; }
    async function keepTransportInactive(chatId, lorebookId) { const chat = await getChat(chatId); const metadata = core.parseMetadata(chat?.metadata); return patch(`/chats/${encodeURIComponent(chatId)}/metadata`, { activeLorebookIds: readIds(metadata.activeLorebookIds).filter((id) => id !== lorebookId), excludedLorebookIds: readIds(metadata.excludedLorebookIds).filter((id) => id !== lorebookId) }); }
    async function createLorebook(payload) { return post("/lorebooks", payload); }
    async function createLorebookEntry(lorebookId, payload) { return post(`/lorebooks/${encodeURIComponent(lorebookId)}/entries`, payload); }
    async function upsertEntry(lorebookId, known, payload) { if (core.cleanId(known?.id)) return updateLorebookEntry(lorebookId, known.id, payload); return createLorebookEntry(lorebookId, payload); }
    async function syncProjectLorebook(project) {
      if (!core.cleanId(project.chatId)) throw new Error("Choose a chat before synchronizing the project lorebook."); let lorebookId = core.cleanId(project.agentLorebookId); let entries = [];
      if (!lorebookId) { const found = await discoverProjectLorebook(project.chatId); lorebookId = found?.lorebookId || ""; entries = found?.entries || []; }
      if (!lorebookId) { const created = await createLorebook({ name: `${project.name} · Curator Transport`, description: "Narrative Curator v4 private transport. Do not select as a Knowledge Router source.", category: "uncategorized", chatId: project.chatId, scope: { mode: "specific", chatIds: [project.chatId] }, generatedBy: "user", recursiveScanning: false, excludeFromVectorization: true }); lorebookId = core.cleanId(created?.id); if (!lorebookId) throw new Error("No lorebook ID returned."); }
      await keepTransportInactive(project.chatId, lorebookId); if (!entries.length) entries = await listLorebookEntries(lorebookId); const transport = core.buildLorebookTransport(project); const known = entries.find((row) => row.name === core.CURATOR_LOREBOOK_SENTINEL) || entries.find((row) => row.id === project.agentEntryIds?.curator); const curator = await upsertEntry(lorebookId, known, transport.curator); return { lorebookId, entryIds: { curator: curator.id } };
    }

    async function createCharacter(payload) { return post("/characters", payload); }
    async function associateCharactersWithChat(chatId, characterIds) { const chat = await getChat(chatId); return patch(`/chats/${encodeURIComponent(chatId)}`, { characterIds: Array.from(new Set([...readIds(chat.characterIds), ...characterIds])) }); }
    async function associateLorebookWithChat(chatId, lorebookId) { const chat = await getChat(chatId); const metadata = core.parseMetadata(chat.metadata); return patch(`/chats/${encodeURIComponent(chatId)}/metadata`, { activeLorebookIds: Array.from(new Set([...readIds(metadata.activeLorebookIds), lorebookId])), excludedLorebookIds: readIds(metadata.excludedLorebookIds).filter((id) => id !== lorebookId) }); }

    return { listCharacters, listChats, listConnections, listAgents, getChat, listChatMessages, getAgentStatuses, updateChatActivation, analyzeStory, initializeFromChat, syncProjectLorebook, discoverProjectLorebook, listLorebooks, listLorebookEntries, createCharacter, createLorebook, createLorebookEntry, associateCharactersWithChat, associateLorebookWithChat, getLastRawResponse: () => lastRawResponse, clearLastRawResponse: () => { lastRawResponse = ""; } };
  }
  return { createApi };
})();

globalThis.__NarrativeDirectorApi = NarrativeDirectorApi;
