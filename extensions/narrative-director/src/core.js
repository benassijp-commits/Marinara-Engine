const NarrativeDirectorCore = (() => {
  "use strict";

  const SCHEMA_VERSION = 4;
  const BUNDLE_KIND = "marinara.narrative-curator-projects";
  const CURATOR_TYPE = "narrative-story-curator";
  const CURATOR_LOREBOOK_SENTINEL = "__ND_CURATOR_PROJECT_V4__";
  const NEVER_MATCH_REGEX = "(?!)";
  const MAX_SOURCE_LENGTH = 50_000;
  const MAX_ANALYSIS_RULES_LENGTH = 12_000;
  const MAX_INITIALIZATION_INPUT_LENGTH = 50_000;
  const PROJECT_TYPES = ["character_focus", "world_ensemble"];
  const SECRET_STATUSES = ["locked", "hinted", "revealed"];
  const STORYLINE_STATUSES = ["inactive", "active", "paused", "completed"];

  const DEFAULT_ANALYSIS_RULES = [
    "Considere o início da história como referência temporal.",
    "Coloque somente informações públicas e observáveis no worldCard, nos perfis públicos dos personagens, nos resumos públicos das relações e nas worldEntries.",
    "Identidades ocultas, parentescos, facções secretas, poderes, missões, intenções e eventos futuros pertencem aos campos privados do Curador.",
    "Crie uma única entidade por personagem e registre títulos ou apelidos em aliases.",
    "Registre relações importantes em relationships e use somente IDs existentes de personagens.",
    "Não invente ações, pensamentos, sentimentos, decisões ou consentimento de {{user}}.",
    "Crie somente segredos cuja revelação precise ser acompanhada e linhas narrativas amplas e adaptáveis.",
    "Informações ainda não apresentadas não devem aparecer em campos públicos.",
    "Use o idioma predominante do texto-fonte e evite duplicar a mesma informação.",
    "Se houver dúvida sobre a segurança de uma informação, mantenha-a privada.",
  ].join("\n\n");

  const ANALYSIS_PROMPT = [
    "Transform the supplied fictional source into exactly one compact Narrative Curator v4 story JSON object. Write human-readable values in the source's predominant language. Return ONLY JSON, without Markdown or commentary.",
    "Exact shape:",
    '{"title":"","mainCharacterId":"","worldCard":{"name":"","description":"","personality":"","scenario":""},"characters":[{"id":"","name":"","aliases":[],"isMain":false,"public":{"role":"","description":"","appearance":"","personality":"","scenario":""},"curatorNotes":""}],"relationships":[{"id":"","characterIds":[],"publicSummary":"","privateSummary":""}],"worldEntries":[{"id":"","name":"","keys":[],"content":""}],"curatorGuide":"","secrets":[{"id":"","title":"","truth":"","knownByCharacterIds":[],"revealCondition":"","status":"locked"}],"storylines":[{"id":"","title":"","direction":"","status":"inactive"}]}',
    "Secret status: locked, hinted, or revealed. Storyline status: inactive, active, paused, or completed.",
    "Use short unique readable IDs and valid references. Represent each person once; put titles and alternate names in aliases.",
    "Only immediately safe public content belongs in worldCard, characters.public, relationships.publicSummary, and worldEntries. Hidden knowledge, motives, relationships, future plans, revelations, and constraints belong in curatorNotes, relationships.privateSummary, curatorGuide, secrets, and storylines.",
    "Keep only important trackable secrets and broad adaptable storylines. Never invent or determine {{user}} actions, speech, thoughts, feelings, decisions, consent, or intent.",
  ].join("\n");

  const INITIALIZATION_PROMPT = [
    "Read the supplied private Curator project, optional chat summary, and recent active messages. Return ONLY the current confirmed state as JSON.",
    'Exact shape: {"summary":"","currentSituation":"","revealedSecretIds":[],"storylineStatuses":{},"characterStates":{}}.',
    "Record only events that actually occurred. Distinguish confirmed facts from suspicions, hints, possibilities, and character beliefs. A hint is not a revealed secret. Do not turn future plans into past events. Preserve valid project IDs and use only allowed storyline statuses: inactive, active, paused, completed.",
  ].join("\n");

  const CURATOR_PROMPT = [
    `First call search_lorebook("${CURATOR_LOREBOOK_SENTINEL}"). Treat that result as the private structured Curator project for this chat.`,
    "Use the available <chat_summary>, the ten most recent active messages, and any confirmed initial state in the project to determine what has actually happened, what has been revealed, what remains hidden, which characters know each fact, and which broad storylines are currently relevant.",
    "Internally distinguish confirmed events from suspicions, hints, possibilities, plans, and character beliefs. Never treat a planned event as something that occurred.",
    "A hidden fact may influence the narrator only when it was already revealed in the story, when a character present in the scene is explicitly listed as knowing it and can naturally act on that knowledge, or when its reveal condition is now observably satisfied. Otherwise do not mention, imply, foreshadow, contradict, or invent details from it.",
    "Give the narrator one brief, organic instruction that preserves continuity and character agency. Do not force a beat, write the scene, expose private notes or identifiers, or decide {{user}} actions, speech, thoughts, feelings, decisions, consent, or intent.",
    "Return only the short instruction for the main narrator, without a label, JSON, analysis, categories, or commentary.",
  ].join("\n");

  function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
  function text(value, max = 120_000) { return typeof value === "string" ? value.slice(0, max) : ""; }
  function cleanId(value) { return typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : ""; }
  function randomId() { return globalThis.crypto?.randomUUID?.() || `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
  function stringList(value) { return Array.isArray(value) ? Array.from(new Set(value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))) : []; }
  function idList(value) { return stringList(value).map(cleanId).filter(Boolean); }
  function idRecord(value, allowedIds = null, allowedValues = null) { if (!isRecord(value)) return {}; return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => cleanId(key) && (!allowedIds || allowedIds.has(key)) && typeof item === "string" && (!allowedValues || allowedValues.includes(item)) ? [[key, item]] : [])); }
  function resourceIds(value) { return { characterIds: idRecord(value?.characterIds), lorebookId: cleanId(value?.lorebookId), entryIds: idRecord(value?.entryIds) }; }
  function analysisRules(value) { const clean = text(value, MAX_ANALYSIS_RULES_LENGTH).trim(); return clean || DEFAULT_ANALYSIS_RULES; }
  function validateStrings(value, keys, label, errors) { for (const key of keys) if (typeof value?.[key] !== "string") errors.push(`${label}.${key} must be a string.`); }

  function emptyStory() { return { title: "", mainCharacterId: "", worldCard: { name: "", description: "", personality: "", scenario: "" }, characters: [], relationships: [], worldEntries: [], curatorGuide: "", secrets: [], storylines: [] }; }

  function normalizeStory(value, strict = true) {
    const errors = [];
    if (!isRecord(value)) { if (strict) throw new Error("Story must be one JSON object."); value = {}; }
    const world = isRecord(value.worldCard) ? value.worldCard : {};
    if (!isRecord(value.worldCard) && strict) errors.push("worldCard must be an object.");
    validateStrings(value, ["title", "mainCharacterId", "curatorGuide"], "story", errors);
    validateStrings(world, ["name", "description", "personality", "scenario"], "worldCard", errors);
    const worldCard = { name: text(world.name, 300).trim(), description: text(world.description, 30_000).trim(), personality: text(world.personality, 20_000).trim(), scenario: text(world.scenario, 30_000).trim() };

    const seenCharacters = new Set();
    const characters = Array.isArray(value.characters) ? value.characters.flatMap((row, index) => {
      if (!isRecord(row) || !cleanId(row.id) || !text(row.name, 300).trim() || seenCharacters.has(row.id)) { errors.push(`characters[${index}] needs a unique valid id and name.`); return []; }
      if (!Array.isArray(row.aliases) || row.aliases.some((alias) => typeof alias !== "string")) errors.push(`characters[${index}].aliases must be strings.`);
      const visible = isRecord(row.public) ? row.public : {};
      if (!isRecord(row.public)) errors.push(`characters[${index}].public must be an object.`);
      validateStrings(row, ["id", "name", "curatorNotes"], `characters[${index}]`, errors);
      if (typeof row.isMain !== "boolean") errors.push(`characters[${index}].isMain must be a boolean.`);
      validateStrings(visible, ["role", "description", "appearance", "personality", "scenario"], `characters[${index}].public`, errors);
      seenCharacters.add(row.id);
      return [{ id: row.id, name: text(row.name, 300).trim(), aliases: stringList(row.aliases), isMain: row.isMain === true, public: { role: text(visible.role, 2_000).trim(), description: text(visible.description, 20_000).trim(), appearance: text(visible.appearance, 20_000).trim(), personality: text(visible.personality, 20_000).trim(), scenario: text(visible.scenario, 20_000).trim() }, curatorNotes: text(row.curatorNotes, 30_000).trim() }];
    }) : (strict ? (errors.push("characters must be an array."), []) : []);
    const characterIds = new Set(characters.map((row) => row.id));

    const seenRelationships = new Set();
    const relationships = Array.isArray(value.relationships) ? value.relationships.flatMap((row, index) => {
      const members = idList(row?.characterIds);
      if (!isRecord(row) || !cleanId(row.id) || seenRelationships.has(row.id)) { errors.push(`relationships[${index}] needs a unique valid id.`); return []; }
      if (!Array.isArray(row.characterIds) || members.length < 2 || members.some((id) => !characterIds.has(id))) errors.push(`relationships[${index}].characterIds must contain at least two known characters.`);
      validateStrings(row, ["id", "publicSummary", "privateSummary"], `relationships[${index}]`, errors);
      seenRelationships.add(row.id);
      return [{ id: row.id, characterIds: members.filter((id) => characterIds.has(id)), publicSummary: text(row.publicSummary, 20_000).trim(), privateSummary: text(row.privateSummary, 30_000).trim() }];
    }) : (strict ? (errors.push("relationships must be an array."), []) : []);

    const seenEntries = new Set();
    const worldEntries = Array.isArray(value.worldEntries) ? value.worldEntries.flatMap((row, index) => {
      if (!isRecord(row) || !cleanId(row.id) || !text(row.name, 300).trim() || seenEntries.has(row.id)) { errors.push(`worldEntries[${index}] needs a unique valid id and name.`); return []; }
      if (!Array.isArray(row.keys) || row.keys.some((key) => typeof key !== "string")) errors.push(`worldEntries[${index}].keys must be strings.`);
      validateStrings(row, ["id", "name", "content"], `worldEntries[${index}]`, errors);
      seenEntries.add(row.id);
      return [{ id: row.id, name: text(row.name, 300).trim(), keys: stringList(row.keys), content: text(row.content, 30_000).trim() }];
    }) : (strict ? (errors.push("worldEntries must be an array."), []) : []);

    const seenSecrets = new Set();
    const secrets = Array.isArray(value.secrets) ? value.secrets.flatMap((row, index) => {
      const known = idList(row?.knownByCharacterIds);
      if (!isRecord(row) || !cleanId(row.id) || !text(row.title, 300).trim() || seenSecrets.has(row.id)) { errors.push(`secrets[${index}] needs a unique valid id and title.`); return []; }
      if (!Array.isArray(row.knownByCharacterIds) || known.some((id) => !characterIds.has(id))) errors.push(`secrets[${index}].knownByCharacterIds contains an unknown character.`);
      if (!SECRET_STATUSES.includes(row.status)) errors.push(`secrets[${index}].status is invalid.`);
      validateStrings(row, ["id", "title", "truth", "revealCondition", "status"], `secrets[${index}]`, errors);
      seenSecrets.add(row.id);
      return [{ id: row.id, title: text(row.title, 300).trim(), truth: text(row.truth, 30_000).trim(), knownByCharacterIds: known.filter((id) => characterIds.has(id)), revealCondition: text(row.revealCondition, 20_000).trim(), status: SECRET_STATUSES.includes(row.status) ? row.status : "locked" }];
    }) : (strict ? (errors.push("secrets must be an array."), []) : []);

    const seenStorylines = new Set();
    const storylines = Array.isArray(value.storylines) ? value.storylines.flatMap((row, index) => {
      if (!isRecord(row) || !cleanId(row.id) || !text(row.title, 300).trim() || seenStorylines.has(row.id)) { errors.push(`storylines[${index}] needs a unique valid id and title.`); return []; }
      if (!STORYLINE_STATUSES.includes(row.status)) errors.push(`storylines[${index}].status is invalid.`);
      validateStrings(row, ["id", "title", "direction", "status"], `storylines[${index}]`, errors);
      seenStorylines.add(row.id);
      return [{ id: row.id, title: text(row.title, 300).trim(), direction: text(row.direction, 30_000).trim(), status: STORYLINE_STATUSES.includes(row.status) ? row.status : "inactive" }];
    }) : (strict ? (errors.push("storylines must be an array."), []) : []);

    const mainCharacterId = cleanId(value.mainCharacterId);
    if (mainCharacterId && !characterIds.has(mainCharacterId)) errors.push("mainCharacterId must reference an existing character.");
    const result = { title: text(value.title, 300).trim(), mainCharacterId, worldCard, characters, relationships, worldEntries, curatorGuide: text(value.curatorGuide, 60_000).trim(), secrets, storylines };
    if (!result.title) errors.push("title is required.");
    if (strict && errors.length) throw new Error(`Invalid story v4: ${errors.join(" ")}`);
    return result;
  }

  function normalizeState(value, story, strict = true) {
    if (value == null) return null;
    const errors = [];
    if (!isRecord(value)) { if (strict) throw new Error("State must be an object or null."); return null; }
    validateStrings(value, ["summary", "currentSituation"], "state", errors);
    const secretIds = new Set(story.secrets.map((row) => row.id)); const storylineIds = new Set(story.storylines.map((row) => row.id)); const characterIds = new Set(story.characters.map((row) => row.id));
    if (!Array.isArray(value.revealedSecretIds) || value.revealedSecretIds.some((id) => !secretIds.has(id))) errors.push("revealedSecretIds contains an unknown secret.");
    const storylineStatuses = idRecord(value.storylineStatuses, storylineIds, STORYLINE_STATUSES); if (!isRecord(value.storylineStatuses) || Object.keys(storylineStatuses).length !== Object.keys(value.storylineStatuses || {}).length) errors.push("storylineStatuses contains an invalid entry.");
    const characterStates = idRecord(value.characterStates, characterIds); if (!isRecord(value.characterStates) || Object.keys(characterStates).length !== Object.keys(value.characterStates || {}).length) errors.push("characterStates contains an invalid entry.");
    const state = { summary: text(value.summary, 30_000).trim(), currentSituation: text(value.currentSituation, 20_000).trim(), revealedSecretIds: idList(value.revealedSecretIds).filter((id) => secretIds.has(id)), storylineStatuses, characterStates };
    if (strict && errors.length) throw new Error(`Invalid state v4: ${errors.join(" ")}`);
    return errors.length ? null : state;
  }

  function createProject(overrides = {}, now = new Date().toISOString()) {
    const story = normalizeStory(overrides.story || emptyStory(), false); const id = cleanId(overrides.id) || randomId(); const confirmedState = normalizeState(overrides.confirmedState, story, false);
    return { id, schemaVersion: SCHEMA_VERSION, name: text(overrides.name || story.title, 300).trim() || "Untitled project", projectType: PROJECT_TYPES.includes(overrides.projectType) ? overrides.projectType : "character_focus", chatId: cleanId(overrides.chatId), analysisConnectionId: cleanId(overrides.analysisConnectionId), initializationConnectionId: cleanId(overrides.initializationConnectionId), sourceText: text(overrides.sourceText, MAX_SOURCE_LENGTH), story, confirmedState, editorialInstructions: text(overrides.editorialInstructions, 20_000), primaryCharacterEntityId: cleanId(overrides.primaryCharacterEntityId || story.mainCharacterId), separateCharacterEntityIds: idList(overrides.separateCharacterEntityIds), publicResourceIds: resourceIds(overrides.publicResourceIds), agentLorebookId: cleanId(overrides.agentLorebookId), agentEntryIds: idRecord(overrides.agentEntryIds), associatedChatId: cleanId(overrides.associatedChatId), lorebookSyncedChatId: cleanId(overrides.lorebookSyncedChatId), lorebookSyncedAt: text(overrides.lorebookSyncedAt, 40), applicationLog: Array.isArray(overrides.applicationLog) ? overrides.applicationLog.slice(-50).map(sanitizeLog) : [], createdAt: typeof overrides.createdAt === "string" ? overrides.createdAt : now, updatedAt: typeof overrides.updatedAt === "string" ? overrides.updatedAt : now };
  }

  function extractJsonObject(value, finishReason = "") { const source = text(value, 300_000).trim(); if (!source) throw new Error("The AI returned an empty response."); if (/length|max_tokens|max_output_tokens|incomplete/i.test(finishReason)) throw new Error("The AI response was truncated. Reduce the source, try another connection, or import an external story JSON."); const start = source.indexOf("{"); const end = source.lastIndexOf("}"); if (start < 0 || end < start) throw new Error("The AI response did not contain a complete JSON object."); try { return JSON.parse(source.slice(start, end + 1)); } catch { throw new Error("The AI returned invalid JSON. Reduce the source, try another connection, or import an external story JSON."); } }
  function parseAnalysisResponse(value, finishReason = "") { return normalizeStory(extractJsonObject(value, finishReason), true); }
  function parseInitializationResponse(value, story, finishReason = "") { return normalizeState(extractJsonObject(value, finishReason), story, true); }
  function applyStory(project, story, now = new Date().toISOString()) { const normalized = normalizeStory(story, true); return createProject({ ...project, name: normalized.title || project.name, story: normalized, primaryCharacterEntityId: normalized.mainCharacterId, confirmedState: null, updatedAt: now }, project.createdAt); }

  function cardData(name, fields) { return { name, description: fields.description, personality: fields.personality, scenario: fields.scenario, first_mes: "", mes_example: "", creator_notes: "", system_prompt: "", post_history_instructions: "", tags: [], creator: "Narrative Curator", character_version: "4", alternate_greetings: [], extensions: { appearance: fields.appearance || "", backstory: "", talkativeness: 0.5, fav: false, world: "", depth_prompt: { prompt: "", depth: 4, role: "system" } }, character_book: null }; }
  function publicProfileContent(character) { const visible = character.public; return [visible.role, visible.description, visible.appearance, visible.personality, visible.scenario].filter(Boolean).join("\n"); }
  function compilePublicResources(project) {
    const story = normalizeStory(project.story, true); const selected = new Set(project.separateCharacterEntityIds); const cards = []; const lorebookEntries = [];
    const primary = story.characters.find((row) => row.id === project.primaryCharacterEntityId) || story.characters.find((row) => row.id === story.mainCharacterId) || story.characters.find((row) => row.isMain) || story.characters[0];
    if (project.projectType === "world_ensemble") cards.push({ entityId: "world_card", data: cardData(story.worldCard.name || story.title, { ...story.worldCard, appearance: "" }) }); else if (primary) cards.push({ entityId: primary.id, data: cardData(primary.name, primary.public) });
    for (const character of story.characters) { if (project.projectType === "character_focus" && character.id === primary?.id) continue; if (selected.has(character.id)) cards.push({ entityId: character.id, data: cardData(character.name, character.public) }); else { const content = publicProfileContent(character); if (content) lorebookEntries.push({ entityId: character.id, name: character.name, description: "Public character profile", content, keys: Array.from(new Set([character.name, ...character.aliases])) }); } }
    for (const relationship of story.relationships) if (relationship.publicSummary) lorebookEntries.push({ entityId: relationship.id, name: `Relationship: ${relationship.characterIds.join(" / ")}`, description: "Public relationship", content: relationship.publicSummary, keys: relationship.characterIds });
    for (const entry of story.worldEntries) lorebookEntries.push({ entityId: entry.id, name: entry.name, description: "Public story context", content: entry.content, keys: entry.keys.length ? entry.keys : [entry.name] });
    return { cards, lorebook: { name: `${story.title} Lorebook`, description: story.worldCard.description, category: "world", characterIds: [], chatId: project.chatId || null, scope: project.chatId ? { mode: "specific", chatIds: [project.chatId] } : { mode: "all", chatIds: [] }, generatedBy: "user" }, lorebookEntries };
  }

  function buildCuratorDocument(project) { const story = normalizeStory(project.story, true); return { title: story.title, curatorGuide: story.curatorGuide, characters: story.characters.map((row) => ({ id: row.id, name: row.name, aliases: row.aliases, curatorNotes: row.curatorNotes })), relationships: story.relationships, secrets: story.secrets, storylines: story.storylines, editorialInstructions: project.editorialInstructions, ...(project.confirmedState ? { confirmedInitialState: project.confirmedState } : {}) }; }
  function technicalLorebookEntry(content) { return { name: CURATOR_LOREBOOK_SENTINEL, description: "Private Narrative Curator v4 project. Never activate in narration.", content: JSON.stringify(content), keys: [NEVER_MATCH_REGEX], secondaryKeys: [], enabled: true, constant: false, selective: false, probability: null, scanDepth: null, matchWholeWords: false, caseSensitive: true, useRegex: true, additionalMatchingSources: [], preventRecursion: true, excludeRecursion: true, delayUntilRecursion: false, sticky: null, cooldown: null, delay: null, ephemeral: null, activationConditions: [], schedule: null, excludeFromVectorization: true, tag: "nd_private_curator_v4", locked: true }; }
  function buildLorebookTransport(project) { return { curator: technicalLorebookEntry(buildCuratorDocument(project)) }; }

  function agentTypes() { return { curator: CURATOR_TYPE }; }
  function parseMetadata(value) { if (isRecord(value)) return { ...value }; if (typeof value === "string") try { const parsed = JSON.parse(value); return isRecord(parsed) ? parsed : {}; } catch { return {}; } return {}; }
  function activeAgentTypes(metadata) { return Array.isArray(parseMetadata(metadata).activeAgentIds) ? parseMetadata(metadata).activeAgentIds.filter((item) => typeof item === "string") : []; }
  function updateFixedActivation(existing, active) { return active ? Array.from(new Set([...existing, CURATOR_TYPE])) : existing.filter((item) => item !== CURATOR_TYPE); }
  function agentStatuses(agents, metadata) { const active = new Set(activeAgentTypes(metadata)); const agent = agents.find((item) => item?.type === CURATOR_TYPE); return { curator: { type: CURATOR_TYPE, agent: agent || null, status: active.has(CURATOR_TYPE) ? "active" : agent ? "inactive" : "missing" } }; }
  function validateCuratorInstruction(value) { const output = text(value, 2_000).trim(); return Boolean(output) && output.length <= 800 && !/```|<[^>]+>|\{\s*"/.test(output) && output.split(/[.!?]+/).filter(Boolean).length <= 4; }

  function normalizeMessages(messages) { if (!Array.isArray(messages)) return []; return messages.flatMap((row, index) => isRecord(row) && typeof row.content === "string" && row.content.trim() ? [{ id: cleanId(row.id) || `message_${index + 1}`, role: text(row.role, 40) || "unknown", content: row.content, sourceIndex: index }] : []); }
  function buildInitializationInput(project, messages, options = {}) { const rows = normalizeMessages(messages); if (!rows.length) throw new Error("The selected chat has no active message content to analyze."); const base = { privateProject: buildCuratorDocument(project), chatSummary: text(options.chatSummary, 20_000), recentMessages: [] }; const budget = MAX_INITIALIZATION_INPUT_LENGTH - 500; const selected = []; const envelope = JSON.stringify(base).length; if (envelope >= budget - 500) throw new Error("The private project is too large for Marinara's 50,000-character initialization limit."); for (let index = rows.length - 1; index >= 0; index--) { const candidate = [rows[index], ...selected]; if (JSON.stringify({ ...base, recentMessages: candidate }).length <= budget) selected.unshift(rows[index]); else break; } if (!selected.length) { const newest = rows.at(-1); const room = budget - envelope - 200; selected.push({ ...newest, content: newest.content.slice(-room) }); } const input = JSON.stringify({ ...base, recentMessages: selected }); return { input, messageCount: rows.length, includedMessageCount: selected.length, omittedMessageCount: rows.length - selected.length }; }

  function sanitizeLog(row) { return { operation: text(row?.operation, 80), timestamp: text(row?.timestamp, 40), status: row?.status === "success" ? "success" : "error", stage: text(row?.stage, 80), resourceIds: idRecord(row?.resourceIds), chatId: cleanId(row?.chatId), error: text(row?.error, 500).replace(/[\r\n]+/g, " ") }; }
  function exportBundle(projects) { return { kind: BUNDLE_KIND, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), projects: projects.map((project) => createProject(project, project.createdAt)) }; }
  function importBundle(value) { if (!isRecord(value) || value.kind !== BUNDLE_KIND || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.projects)) throw new Error("Only clean Narrative Curator v4 exports are supported."); return value.projects.map((project) => { if (project?.schemaVersion !== SCHEMA_VERSION) throw new Error("Every imported project must use schemaVersion 4."); const story = normalizeStory(project.story, true); const confirmedState = normalizeState(project.confirmedState, story, true); return createProject({ ...project, schemaVersion: SCHEMA_VERSION, story, confirmedState }, project.createdAt); }); }
  function validateProject(project) { const errors = []; if (!text(project?.name).trim()) errors.push("Project name is required."); if (!PROJECT_TYPES.includes(project?.projectType)) errors.push("Choose a project type."); if (text(project?.sourceText, MAX_SOURCE_LENGTH + 1).length > MAX_SOURCE_LENGTH) errors.push("Source exceeds 50,000 characters."); const hasStory = Boolean(project?.story?.title || project?.story?.characters?.length || project?.story?.worldEntries?.length || project?.story?.secrets?.length || project?.story?.storylines?.length); try { if (hasStory) normalizeStory(project?.story, true); normalizeState(project?.confirmedState, project.story, true); } catch (error) { errors.push(error.message); } return { valid: !errors.length, errors }; }

  return { SCHEMA_VERSION, BUNDLE_KIND, CURATOR_TYPE, CURATOR_LOREBOOK_SENTINEL, NEVER_MATCH_REGEX, SECRET_STATUSES, STORYLINE_STATUSES, ANALYSIS_PROMPT, INITIALIZATION_PROMPT, CURATOR_PROMPT, DEFAULT_ANALYSIS_RULES, MAX_SOURCE_LENGTH, MAX_ANALYSIS_RULES_LENGTH, isRecord, cleanId, analysisRules, emptyStory, normalizeStory, normalizeState, createProject, parseAnalysisResponse, parseInitializationResponse, applyStory, compilePublicResources, buildCuratorDocument, buildLorebookTransport, agentTypes, parseMetadata, activeAgentTypes, updateFixedActivation, agentStatuses, validateCuratorInstruction, buildInitializationInput, exportBundle, importBundle, validateProject, sanitizeLog };
})();

globalThis.__NarrativeDirectorCore = NarrativeDirectorCore;
