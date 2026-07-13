const NarrativeDirectorApi = (() => {
  "use strict";
  const core = globalThis.__NarrativeDirectorCore;
  const INSTRUCTION_LIMIT = 4_000;
  const SELECTED_TEXT_LIMIT = 50_000;
  const ANALYSIS_MAX_ATTEMPTS = 40;

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

    function finishReason(response) { return response?.finishReason || response?.finish_reason || response?.usage?.finishReason || response?.choices?.[0]?.finish_reason || ""; }
    function rememberRaw(raw, label, append) { const value = label ? `[${label}]\n${raw}` : raw; lastRawResponse = append && lastRawResponse ? `${lastRawResponse}\n\n${value}` : value; }
    function responseError(label, kind) {
      if (kind === "truncated") { const error = new Error(`${label} response was truncated before its JSON object completed. Retry this block with a connection that allows a complete compact response.`); error.code = "ND_TRUNCATED_OUTPUT"; return error; }
      if (kind === "empty") return new Error(`${label} connection returned no usable text.`);
      return new Error(`${label} response did not contain a complete JSON object compatible with the requested schema.`);
    }

    async function rewriteAndParse({ connectionId, selectedText, instruction, label, agentName, dataLabel, contextSections, parse, keepRaw = false, appendRaw = false, rawLabel = "" }) {
      const first = await rewrite({ connectionId, selectedText, instruction, agentName, dataLabel, ...(contextSections?.length ? { contextSections } : {}) }, label);
      if (typeof first?.rewrittenText !== "string") throw new Error(`${label} connection returned no usable text.`);
      if (keepRaw) rememberRaw(first.rewrittenText, rawLabel, appendRaw);
      const classified = core.classifyJsonResponse(first.rewrittenText, finishReason(first));
      if (classified.kind === "truncated" || classified.kind === "empty" || classified.kind === "incompatible") throw responseError(label, classified.kind);
      if (classified.kind === "valid") return parse(first.rewrittenText);
      let firstError; try { return parse(first.rewrittenText); } catch (error) { firstError = error; }
      if (first.rewrittenText.length > SELECTED_TEXT_LIMIT) throw firstError;
      const repaired = await rewrite({ connectionId, selectedText: first.rewrittenText, instruction: core.REPAIR_PROMPT, agentName: `${agentName} JSON Repair`, dataLabel: `${dataLabel} invalid JSON response` }, `${label} repair`);
      if (typeof repaired?.rewrittenText !== "string") throw firstError;
      if (keepRaw) rememberRaw(repaired.rewrittenText, `${rawLabel || label} automatic repair`, true);
      const repairClassification = core.classifyJsonResponse(repaired.rewrittenText, finishReason(repaired));
      if (repairClassification.kind !== "valid") throw repairClassification.kind === "truncated" ? responseError(`${label} repair`, "truncated") : firstError;
      try { return parse(repaired.rewrittenText); } catch { throw firstError; }
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

    async function analyzeStory(connectionId, sourceText, projectType = "character_focus", options = {}) {
      if (!core.cleanId(connectionId)) throw new Error("Choose an analysis connection.");
      if (typeof sourceText !== "string" || !sourceText.trim()) throw new Error("Paste a story before analyzing it.");
      if (sourceText.length > core.MAX_ANALYSIS_SOURCE_LENGTH) throw new Error(`Story analysis supports up to ${core.MAX_ANALYSIS_SOURCE_LENGTH.toLocaleString()} characters.`);
      const blocks = core.splitAnalysisSource(sourceText); const signature = core.sourceSignature(sourceText);
      const resumable = options.resume && options.resume.sourceSignature === signature && options.resume.projectType === projectType && Array.isArray(options.resume.partials) && Array.isArray(options.resume.queue) && Number.isInteger(options.resume.completedBlocks) && options.resume.completedBlocks >= 0;
      if (blocks.length === 1 && !resumable) {
        lastRawResponse = ""; options.onProgress?.({ block: 1, blockCount: 1, blockPath: "1", subdivisionDepth: 0, charStart: 1, charEnd: sourceText.length });
        try { return await rewriteAndParse({ connectionId, selectedText: sourceText, instruction: core.analysisInstruction(projectType), label: "Analysis", agentName: "Narrative Director Structured Extractor", dataLabel: "Fictional source", parse: core.parseAnalysisResponse, keepRaw: true }); }
        catch (cause) {
          if (cause.code !== "ND_TRUNCATED_OUTPUT" || sourceText.length < core.ANALYSIS_MIN_BLOCK_LENGTH * 2) throw cause;
        }
      }
      const checkpoint = resumable ? options.resume : { sourceSignature: signature, projectType, completedBlocks: 0, partials: [], queue: blocks.length === 1 ? core.subdivideAnalysisBlock({ ...blocks[0], path: "1", depth: 0 }, sourceText) : blocks, rawResponse: lastRawResponse, subdivisions: blocks.length === 1 ? 1 : 0, attempts: blocks.length === 1 ? 1 : 0 };
      lastRawResponse = checkpoint.rawResponse || "";
      if (!resumable && blocks.length === 1) options.onProgress?.({ subdivided: true, block: 1, blockCount: checkpoint.queue.length, blockPath: "1", childPaths: checkpoint.queue.map((block) => block.path), subdivisionDepth: 1, charStart: 1, charEnd: sourceText.length });
      while (checkpoint.queue.length) {
        if (options.signal?.aborted) { const error = new Error("Analysis cancelled. Completed blocks remain available only for retry during this session."); error.name = "AbortError"; error.analysisCheckpoint = checkpoint; throw error; }
        if (checkpoint.attempts >= ANALYSIS_MAX_ATTEMPTS) { const error = new Error(`Analysis stopped after the safe limit of ${ANALYSIS_MAX_ATTEMPTS} block attempts.`); error.analysisCheckpoint = checkpoint; throw error; }
        const block = checkpoint.queue[0]; const blockNumber = checkpoint.completedBlocks + 1; const blockCount = checkpoint.completedBlocks + checkpoint.queue.length;
        options.onProgress?.({ block: blockNumber, blockCount, blockPath: block.path, subdivisionDepth: block.depth, autoSubdivided: block.depth > 0, charStart: block.start + 1, charEnd: block.end });
        checkpoint.attempts++;
        try {
          const partial = await rewriteAndParse({ connectionId, selectedText: block.text, instruction: core.analysisPartInstruction(projectType, blockNumber, blockCount), label: `Analysis block ${block.path}`, agentName: "Narrative Director Compact Extractor", dataLabel: `Fictional source block ${block.path}`, contextSections: block.context ? [{ label: "Source structure context", content: block.context }] : [], parse: core.parseAnalysisPartialResponse, keepRaw: true, appendRaw: Boolean(lastRawResponse), rawLabel: `Analysis block ${block.path}` });
          if (options.signal?.aborted) { const error = new Error("Analysis cancelled. Completed blocks remain available only for retry during this session."); error.name = "AbortError"; error.analysisCheckpoint = checkpoint; throw error; }
          checkpoint.partials.push(partial); checkpoint.queue.shift(); checkpoint.completedBlocks++; checkpoint.rawResponse = lastRawResponse;
        } catch (cause) {
          if (cause.analysisCheckpoint) throw cause;
          checkpoint.rawResponse = lastRawResponse;
          if (cause.code === "ND_TRUNCATED_OUTPUT" && block.depth < core.ANALYSIS_MAX_SUBDIVISION_DEPTH && checkpoint.subdivisions < core.ANALYSIS_MAX_SUBDIVISIONS && checkpoint.attempts < ANALYSIS_MAX_ATTEMPTS) {
            try {
              const children = core.subdivideAnalysisBlock(block, sourceText); checkpoint.queue.splice(0, 1, ...children); checkpoint.subdivisions++;
              options.onProgress?.({ subdivided: true, block: blockNumber, blockCount: checkpoint.completedBlocks + checkpoint.queue.length, blockPath: block.path, childPaths: children.map((child) => child.path), subdivisionDepth: children[0].depth, charStart: block.start + 1, charEnd: block.end });
              continue;
            } catch { /* The bounded error below explains why automatic subdivision stopped. */ }
          }
          const bounded = cause.code === "ND_TRUNCATED_OUTPUT" ? " Automatic subdivision reached its safe minimum, depth or attempt limit." : " Retry Analyze story to continue from this block.";
          const error = new Error(`Analysis block ${block.path} failed: ${cause.message || "unknown error"}${bounded}`); error.analysisCheckpoint = checkpoint; error.block = blockNumber; error.blockCount = blockCount; throw error;
        }
      }
      return core.mergeAnalysisPartials(checkpoint.partials, projectType);
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
