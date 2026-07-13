(() => {
  "use strict";
  if (globalThis.__narrativeDirectorLoaded) return;
  globalThis.__narrativeDirectorLoaded = true;
  const core = NarrativeDirectorCore;
  const storage = NarrativeDirectorStorage.createStore();
  const api = NarrativeDirectorApi.createApi(marinara);
  const state = { open: false, projects: [], currentId: "", draft: null, resources: { chats: [], connections: [] }, tab: "source", dirty: false,
    initializationProposal: null, initializationCheckpoint: null, initializationAbortController: null, initializationMessageCount: 0 };

  const launcher = marinara.addElement(document.body, "button", { type: "button", class: "nd-launcher", textContent: "Narrative Director", title: "Open Narrative Director" });
  const root = marinara.addElement(document.body, "div", { class: "nd-root", "aria-hidden": "true" });
  if (!launcher || !root) return;
  root.innerHTML = `
    <div class="nd-backdrop" data-action="close"></div>
    <section class="nd-shell" role="dialog" aria-modal="true" aria-labelledby="nd-title" tabindex="-1">
      <header class="nd-header"><div><span class="nd-kicker">Private story workspace</span><h1 id="nd-title">Narrative Director</h1></div>
        <div class="nd-header-actions"><button class="nd-button nd-button-quiet" type="button" data-action="import">Import JSON</button><button class="nd-button nd-button-quiet" type="button" data-action="export">Export JSON</button><button class="nd-icon-button" type="button" data-action="close" aria-label="Close">×</button></div></header>
      <div class="nd-layout">
        <aside class="nd-sidebar"><div class="nd-sidebar-heading"><strong>Projects</strong><button class="nd-button nd-button-primary nd-button-small" type="button" data-action="new">New</button></div><div class="nd-project-list" data-slot="projects"></div></aside>
        <main class="nd-main"><div class="nd-empty" data-slot="empty"><h2>Build a private story plan</h2><p>Extract facts first, review disclosure, then compile public resources locally.</p><button class="nd-button nd-button-primary" type="button" data-action="new">Create project</button></div>
          <form class="nd-editor" data-slot="editor" hidden>
            <div class="nd-editor-head"><label class="nd-field"><span>Project name</span><input name="name" maxlength="160"></label><span class="nd-save-state" data-slot="save-state">Local draft</span></div>
            <nav class="nd-tabs" aria-label="Project sections">${["source","review","public","private","initialize","agents"].map((tab) => `<button type="button" data-tab="${tab}" aria-selected="${tab === "source"}">${tab[0].toUpperCase()}${tab.slice(1)}</button>`).join("")}</nav>
            <section class="nd-panel" data-panel="source">
              <div class="nd-form-grid"><label class="nd-field"><span>Project type</span><select name="projectType"><option value="character_focus">Character focus</option><option value="world_ensemble">World / ensemble</option></select></label><label class="nd-field"><span>Chat</span><select name="chatId"><option value="">Choose chat</option></select></label></div>
              <label class="nd-field"><span>Story source</span><textarea name="sourceText" rows="12" maxlength="50000" placeholder="Paste an outline or story source, up to 50,000 characters"></textarea><small><span data-slot="source-count">0</span> / 50,000</small></label>
              <div class="nd-action-strip"><label class="nd-field"><span>Analysis connection</span><select name="analysisConnectionId"><option value="">Choose connection</option></select></label><button class="nd-button nd-button-primary" type="button" data-action="analyze">Analyze story</button></div>
              <label class="nd-check"><input type="checkbox" name="creativeEnrichment" disabled><span>Creative enrichment is a separate future action and remains disabled.</span></label>
              <details class="nd-raw" data-slot="raw-section" hidden><summary>Raw AI response</summary><p class="nd-warning">May contain the complete story and private data. Session memory only, never saved or exported.</p><pre data-slot="raw-response"></pre><button class="nd-button nd-button-quiet nd-button-small" type="button" data-action="copy-raw">Copy response</button></details>
            </section>
            <section class="nd-panel" data-panel="review" hidden>
              <div class="nd-intro"><strong>Atomic disclosure review</strong><span>Mixed paragraphs are split into individual facts. Decide every uncertain item before Apply.</span></div>
              <div class="nd-review-groups"><section><h3>Public</h3><div data-slot="facts-public"></div></section><section><h3>Private</h3><div data-slot="facts-private"></div></section><section><h3>Uncertain, requires review</h3><div data-slot="facts-uncertain"></div></section></div>
              <button class="nd-button nd-button-quiet" type="button" data-action="add-fact">Add fact</button>
            </section>
            <section class="nd-panel" data-panel="public" hidden>
              <div class="nd-warning">Confirm that these fields contain no unrevealed information.</div>
              <section class="nd-public-options"><strong>Character output</strong><label class="nd-field"><span>Primary character</span><select name="primaryCharacterEntityId"></select></label><div data-slot="character-selection"></div></section>
              <div class="nd-preview-grid"><section><h3>Character cards</h3><div data-slot="card-preview"></div></section><section><h3>Lorebook</h3><div data-slot="lorebook-preview"></div></section></div>
              <label class="nd-check"><input type="checkbox" name="applyConfirmed"><span>I reviewed all public output and want to create only the missing resources.</span></label>
              <button class="nd-button nd-button-primary" type="button" data-action="apply">Create public resources</button>
            </section>
            <section class="nd-panel" data-panel="private" hidden>
              <div class="nd-intro"><strong>Director-only project</strong><span>Saved in the guarded Director entry only after explicit synchronization.</span></div>
              <label class="nd-field"><span>Complete private summary</span><textarea name="privateSummary" rows="6"></textarea></label>
              <label class="nd-field"><span>Private document</span><textarea name="privateDocument" rows="8"></textarea></label>
              <label class="nd-field"><span>Story-specific editorial instructions</span><textarea name="editorialInstructions" rows="4"></textarea></label>
              <div class="nd-private-grid"><section><h3>Characters</h3><div data-slot="private-characters"></div></section><section><h3>Secrets</h3><div data-slot="secrets"></div></section><section><h3>Adaptive arcs</h3><div data-slot="arcs"></div></section><section><h3>Candidate beats</h3><div data-slot="beats"></div></section></div>
            </section>
            <section class="nd-panel" data-panel="initialize" hidden>
              <div class="nd-intro"><strong>Initialize from existing chat</strong><span>Reads active messages only. No message is edited and no partial result is persisted.</span></div>
              <div class="nd-action-strip"><label class="nd-field"><span>Initialization connection</span><select name="initializationConnectionId"><option value="">Choose connection</option></select></label><button class="nd-button nd-button-primary" type="button" data-action="initialize">Initialize</button><button class="nd-button nd-button-quiet" type="button" data-action="cancel-analysis" hidden>Cancel</button></div>
              <div class="nd-progress" data-slot="progress" hidden><strong data-slot="progress-label"></strong><span data-slot="progress-range"></span></div>
              <div data-slot="initialization-review"><p>No proposal loaded.</p></div>
              <div class="nd-inline-actions" data-slot="initialization-actions" hidden><button class="nd-button nd-button-primary" type="button" data-action="confirm-initialization">Confirm and synchronize lorebook</button><button class="nd-button nd-button-quiet" type="button" data-action="discard-initialization">Discard</button></div>
            </section>
            <section class="nd-panel" data-panel="agents" hidden>
              <div class="nd-intro"><strong>Two fixed agents</strong><span>The extension can activate existing types, but never creates or edits their configuration.</span></div>
              <div class="nd-agent-statuses"><section><code>${core.DIRECTOR_TYPE}</code><strong data-slot="director-status">Checking…</strong></section><section><code>${core.TRACKER_TYPE}</code><strong data-slot="tracker-status">Checking…</strong></section></div>
              <div class="nd-warning" data-slot="lorebook-contract-warning">One chat-scoped agent lorebook carries two guarded entries. It stays outside activeLorebookIds so Knowledge Router does not use it by default. Never select it manually as a Knowledge Router source.</div>
              <div class="nd-inline-actions"><button class="nd-button nd-button-primary" type="button" data-action="sync-lorebook">Synchronize project lorebook</button><button class="nd-button nd-button-quiet" type="button" data-action="load-lorebook">Load project from lorebook</button><button class="nd-button nd-button-quiet" type="button" data-action="refresh-agents">Refresh status</button></div>
              <div class="nd-inline-actions"><button class="nd-button nd-button-primary" type="button" data-action="activate">Activate fixed agents</button><button class="nd-button nd-button-danger" type="button" data-action="deactivate">Deactivate fixed agents</button></div>
              <details class="nd-guide"><summary>Manual agent configuration</summary><div data-slot="agent-guide"></div></details>
              <section class="nd-runtime"><div class="nd-runtime-head"><h3>Tracker runtime</h3><button class="nd-button nd-button-quiet nd-button-small" type="button" data-action="refresh-runtime">Refresh</button></div><div data-slot="tracker-runtime"><p>No state loaded.</p></div></section>
            </section>
            <div class="nd-errors" data-slot="errors" role="alert" hidden></div>
            <footer class="nd-footer"><button class="nd-button nd-button-danger-quiet" type="button" data-action="delete">Delete local draft</button><button class="nd-button nd-button-primary" type="submit">Save local draft</button></footer>
          </form>
        </main>
      </div>
      <div class="nd-toasts" data-slot="toasts" aria-live="polite"></div><input data-slot="import-file" type="file" accept="application/json,.json" hidden>
    </section>`;

  const $ = (selector, within = root) => within.querySelector(selector);
  const $$ = (selector, within = root) => Array.from(within.querySelectorAll(selector));
  const editor = $('[data-slot="editor"]');
  const fields = Object.fromEntries($$("[name]", editor).map((field) => [field.name, field]));
  function toast(message, tone = "info") { const row = document.createElement("div"); row.className = `nd-toast is-${tone}`; row.textContent = message; $('[data-slot="toasts"]').appendChild(row); setTimeout(() => row.remove(), 4500); }
  function errors(rows = []) { const box = $('[data-slot="errors"]'); box.hidden = !rows.length; box.replaceChildren(); for (const message of rows) { const p = document.createElement("p"); p.textContent = message; box.appendChild(p); } }
  function option(value, label) { const row = document.createElement("option"); row.value = value; row.textContent = label; return row; }
  function fillSelect(select, rows, selected, placeholder) { select.replaceChildren(option("", placeholder)); for (const row of rows) select.appendChild(option(row.id, row.label)); select.value = selected || ""; }
  function nextId(prefix, rows) { let index = rows.length + 1; while (rows.some((row) => row.id === `${prefix}_${index}`)) index++; return `${prefix}_${index}`; }

  function readDraft() {
    if (!state.draft) return null;
    const intermediate = structuredClone(state.draft.intermediate);
    intermediate.projectType = fields.projectType.value;
    intermediate.privateSummary = fields.privateSummary.value;
    intermediate.privateDocument = fields.privateDocument.value;
    for (const input of $$('[data-fact-id][data-fact-field]')) { const fact = intermediate.facts.find((row) => row.id === input.dataset.factId); if (fact) fact[input.dataset.factField] = input.value; }
    for (const input of $$('[data-collection][data-index][data-key]')) {
      const row = intermediate[input.dataset.collection]?.[Number(input.dataset.index)]; if (!row) continue;
      row[input.dataset.key] = input.dataset.valueType === "list" ? input.value.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) : input.dataset.valueType === "boolean" ? input.checked : input.value;
    }
    const uncertainDecisions = { ...state.draft.uncertainDecisions };
    for (const select of $$('[data-uncertain-id]')) { if (select.value) uncertainDecisions[select.dataset.uncertainId] = select.value; else delete uncertainDecisions[select.dataset.uncertainId]; }
    return core.createProject({ ...state.draft, name: fields.name.value, projectType: fields.projectType.value, chatId: fields.chatId.value,
      analysisConnectionId: fields.analysisConnectionId.value, initializationConnectionId: fields.initializationConnectionId.value,
      sourceText: fields.sourceText.value, primaryCharacterEntityId: fields.primaryCharacterEntityId.value,
      separateCharacterEntityIds: $$('[data-character-card]').filter((input) => input.checked).map((input) => input.value), uncertainDecisions,
      editorialInstructions: fields.editorialInstructions.value, intermediate, updatedAt: new Date().toISOString() }, state.draft.createdAt);
  }

  function renderProjectList() { const container = $('[data-slot="projects"]'); container.replaceChildren(); for (const project of state.projects) { const button = document.createElement("button"); button.type = "button"; button.dataset.projectId = project.id; button.className = project.id === state.currentId ? "is-active" : ""; const strong = document.createElement("strong"); strong.textContent = project.name; const span = document.createElement("span"); span.textContent = project.chatId ? "Chat linked" : "Local draft"; button.append(strong, span); container.appendChild(button); } }
  function renderRaw() { const raw = api.getLastRawResponse(); $('[data-slot="raw-section"]').hidden = !raw; $('[data-slot="raw-response"]').textContent = raw; }

  function factRow(fact, group) {
    const row = document.createElement("article"); row.className = "nd-fact";
    const meta = document.createElement("div"); meta.className = "nd-fact-meta"; const id = document.createElement("code"); id.textContent = fact.id; const category = document.createElement("span"); category.textContent = fact.category; meta.append(id, category);
    const textarea = document.createElement("textarea"); textarea.rows = 2; textarea.value = fact.text; textarea.dataset.factId = fact.id; textarea.dataset.factField = "text";
    row.append(meta, textarea);
    if (group === "uncertain") { const select = document.createElement("select"); select.dataset.uncertainId = fact.id; select.append(option("", "Decision required"), option("public", "Mark public"), option("private", "Keep private")); select.value = state.draft.uncertainDecisions[fact.id] || ""; row.appendChild(select); }
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "nd-button nd-button-danger-quiet nd-button-small"; remove.dataset.action = "remove-fact"; remove.dataset.id = fact.id; remove.textContent = "Remove"; row.appendChild(remove); return row;
  }
  function renderFacts(project) { for (const group of ["public", "private", "uncertain"]) { const container = $(`[data-slot="facts-${group}"]`); container.replaceChildren(); const rows = project.intermediate.facts.filter((fact) => fact.visibility === group); if (!rows.length) { const p = document.createElement("p"); p.textContent = "No facts."; container.appendChild(p); } else rows.forEach((fact) => container.appendChild(factRow(fact, group))); } }

  function editableList(slot, collection, rows, title, definitions) { const container = $(`[data-slot="${slot}"]`); container.replaceChildren(); if (!rows.length) { const p = document.createElement("p"); p.textContent = "None."; container.appendChild(p); return; } rows.forEach((row, index) => { const details = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = title(row); details.appendChild(summary); for (const definition of definitions) { const label = document.createElement("label"); label.className = "nd-field"; const span = document.createElement("span"); span.textContent = definition.label; const input = definition.type === "textarea" || definition.type === "list" ? document.createElement("textarea") : definition.type === "select" ? document.createElement("select") : document.createElement("input"); input.dataset.collection = collection; input.dataset.index = String(index); input.dataset.key = definition.key; if (definition.type === "list") input.dataset.valueType = "list"; if (definition.type === "boolean") { input.type = "checkbox"; input.checked = row[definition.key] === true; input.dataset.valueType = "boolean"; } else if (definition.type === "select") { for (const value of definition.options) input.append(option(value, value)); input.value = row[definition.key] || definition.options[0]; } else input.value = Array.isArray(row[definition.key]) ? row[definition.key].join("\n") : row[definition.key] || ""; label.append(span, input); details.appendChild(label); } container.appendChild(details); }); }
  function renderPrivate(project) {
    const s = project.intermediate;
    editableList("private-characters", "characters", s.characters, (row) => row.name, [{ key: "name", label: "Name" }, { key: "role", label: "Role" }, { key: "description", label: "Description", type: "textarea" }, { key: "appearance", label: "Appearance", type: "textarea" }, { key: "personality", label: "Personality", type: "textarea" }, { key: "scenario", label: "Scenario", type: "textarea" }, { key: "privateGoal", label: "Private goal", type: "textarea" }]);
    editableList("secrets", "secrets", s.secrets, (row) => `${row.id} · ${row.layer}`, [{ key: "title", label: "Title" }, { key: "ownerCharacterId", label: "Owner character ID" }, { key: "knownByCharacterIds", label: "Known by character IDs", type: "list" }, { key: "layer", label: "Layer", type: "select", options: ["locked", "foreshadowed", "suspected", "partially_revealed", "confirmed"] }, { key: "summary", label: "Private summary", type: "textarea" }, { key: "revealCondition", label: "Reveal condition", type: "textarea" }]);
    editableList("arcs", "narrativeArcs", s.narrativeArcs, (row) => `${row.id} · ${row.status}`, [{ key: "title", label: "Title" }, { key: "status", label: "Status", type: "select", options: ["inactive", "active", "paused", "completed", "abandoned"] }, { key: "observedState", label: "Observed state", type: "textarea" }, { key: "momentum", label: "Momentum", type: "select", options: ["low", "medium", "high"] }, { key: "impossibilityEvidence", label: "Impossibility evidence", type: "textarea" }, { key: "impossibilityFact", label: "Impossibility fact", type: "textarea" }, { key: "confidence", label: "Confidence", type: "select", options: ["", "low", "medium", "high"] }]);
    editableList("beats", "candidateBeats", s.candidateBeats, (row) => `${row.id} · ${row.status}`, [{ key: "title", label: "Title" }, { key: "status", label: "Status", type: "select", options: ["unavailable", "eligible", "active", "deferred", "completed", "skipped"] }, { key: "relatedArcIds", label: "Related arc IDs", type: "list" }, { key: "hardPrerequisites", label: "Hard prerequisites", type: "list" }, { key: "readinessSignals", label: "Readiness signals", type: "list" }, { key: "blockers", label: "Observable blockers", type: "list" }, { key: "setupStrategies", label: "Private setup strategies", type: "list" }, { key: "relatedSecretIds", label: "Related secret IDs", type: "list" }]);
  }

  function renderPublic(project) {
    const characters = project.intermediate.characters.map((row) => ({ id: row.id, label: row.name })); fillSelect(fields.primaryCharacterEntityId, characters, project.primaryCharacterEntityId, "No character");
    const selection = $('[data-slot="character-selection"]'); selection.replaceChildren(); for (const character of project.intermediate.characters) { const label = document.createElement("label"); label.className = "nd-check"; const input = document.createElement("input"); input.type = "checkbox"; input.value = character.id; input.dataset.characterCard = "true"; input.checked = project.separateCharacterEntityIds.includes(character.id); const span = document.createElement("span"); span.textContent = `Create separate card for ${character.name}`; label.append(input, span); selection.appendChild(label); }
    const cardPreview = $('[data-slot="card-preview"]'); const lorePreview = $('[data-slot="lorebook-preview"]'); cardPreview.replaceChildren(); lorePreview.replaceChildren();
    try { const preview = core.compilePublicResources(project); for (const card of preview.cards) { const details = document.createElement("details"); details.open = true; const summary = document.createElement("summary"); summary.textContent = card.data.name; const pre = document.createElement("pre"); pre.textContent = JSON.stringify({ description: card.data.description, personality: card.data.personality, scenario: card.data.scenario, appearance: card.data.extensions.appearance }, null, 2); details.append(summary, pre); cardPreview.appendChild(details); } for (const entry of preview.lorebookEntries) { const details = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = entry.name; const pre = document.createElement("pre"); pre.textContent = entry.content; details.append(summary, pre); lorePreview.appendChild(details); } if (!preview.lorebookEntries.length) lorePreview.append("No public lorebook entries."); }
    catch (error) { const p = document.createElement("p"); p.textContent = error.message; cardPreview.appendChild(p); lorePreview.append("Resolve disclosure before preview."); }
  }

  function renderAgentGuide() {
    const container = $('[data-slot="agent-guide"]'); container.replaceChildren();
    const rows = [
      { title: "Director", values: [`Type: ${core.DIRECTOR_TYPE}`, "Phase: pre_generation", "Result: director_event", "Output: short editorial instruction only", "Suggested temperature: 0.2", core.DIRECTOR_PROMPT] },
      { title: "Tracker", values: [`Type: ${core.TRACKER_TYPE}`, "Phase: post_processing", "Result: custom_tracker_update", "Capability: Edit trackers", "Suggested temperature: 0.1", core.TRACKER_PROMPT] },
    ];
    for (const row of rows) { const section = document.createElement("section"); const h = document.createElement("h3"); h.textContent = row.title; const pre = document.createElement("pre"); pre.textContent = row.values.join("\n"); section.append(h, pre); container.appendChild(section); }
    const note = document.createElement("p"); note.textContent = "Import extensions/narrative-director/presets/marinara-agents.json in the Agents panel, then choose connections there. The extension never imports it automatically."; container.appendChild(note);
  }

  function writeDraft(project) {
    state.draft = core.createProject(project, project.createdAt); project = state.draft;
    fields.name.value = project.name; fields.projectType.value = project.projectType; fields.sourceText.value = project.sourceText; fields.privateSummary.value = project.intermediate.privateSummary; fields.privateDocument.value = project.intermediate.privateDocument; fields.editorialInstructions.value = project.editorialInstructions;
    fillSelect(fields.chatId, state.resources.chats, project.chatId, "Choose chat"); fillSelect(fields.analysisConnectionId, state.resources.connections, project.analysisConnectionId, "Choose connection"); fillSelect(fields.initializationConnectionId, state.resources.connections, project.initializationConnectionId || project.analysisConnectionId, "Choose connection");
    $('[data-slot="source-count"]').textContent = String(project.sourceText.length); renderFacts(project); renderPrivate(project); renderPublic(project); renderRaw(); renderProjectList(); renderAgentGuide();
  }
  function renderEditor() { const empty = $('[data-slot="empty"]'); empty.hidden = Boolean(state.draft); editor.hidden = !state.draft; if (state.draft) writeDraft(state.draft); }

  async function refreshResources() { const [chats, connections] = await Promise.all([api.listChats(), api.listConnections()]); state.resources.chats = chats.map((row) => ({ id: row.id, label: row.name || row.title || row.id })); state.resources.connections = connections.map((row) => ({ id: row.id, label: `${row.name || "Connection"} · ${row.model || row.provider}` })); }
  async function refreshAll() { try { await Promise.all([refreshResources(), storage.open()]); state.projects = await storage.listProjects(); if (state.currentId) state.draft = state.projects.find((row) => row.id === state.currentId) || state.draft; renderEditor(); } catch (error) { errors([error.message]); } }
  function newProject() { const project = core.createProject(); state.currentId = project.id; state.draft = project; state.dirty = true; setTab("source"); renderEditor(); }
  async function selectProject(id) { if (state.dirty && !window.confirm("Discard unsaved local edits?")) return; const project = await storage.getProject(id); if (!project) return; state.currentId = id; state.draft = core.createProject(project, project.createdAt); state.dirty = false; renderEditor(); }
  async function saveProject() { const project = readDraft(); if (!project) return; const validation = core.validateProject(project); if (!validation.valid) return errors(validation.errors); await storage.saveProject(project); state.projects = await storage.listProjects(); state.draft = project; state.dirty = false; $('[data-slot="save-state"]').textContent = "Saved locally"; renderProjectList(); toast("Local draft saved.", "success"); }
  async function deleteProject() { if (!state.draft || !window.confirm("Delete this local draft? Server memories and public resources are not deleted.")) return; await storage.deleteProject(state.draft.id); state.projects = await storage.listProjects(); state.currentId = ""; state.draft = null; state.dirty = false; renderEditor(); }

  async function analyze() { const before = readDraft(); if (!before) return; setBusy(true); errors([]); try { const analysis = await api.analyzeStory(before.analysisConnectionId, before.sourceText, before.projectType); state.draft = core.applyAnalysis(before, analysis); state.dirty = true; writeDraft(state.draft); setTab("review"); toast("Structured extraction ready for review.", "success"); } catch (error) { renderRaw(); errors([error.message]); } finally { setBusy(false); } }
  function addFact() { const project = readDraft(); if (!project) return; const facts = [...project.intermediate.facts, { id: nextId("fact", project.intermediate.facts), subjectId: project.intermediate.characters[0]?.id || project.intermediate.places[0]?.id || "project", category: "context", text: "New fact", visibility: "uncertain", knownByCharacterIds: [], evidence: "Manual entry" }]; state.draft = core.createProject({ ...project, intermediate: { ...project.intermediate, facts } }, project.createdAt); state.dirty = true; renderFacts(state.draft); }
  function removeFact(id) { const project = readDraft(); if (!project) return; state.draft = core.createProject({ ...project, intermediate: { ...project.intermediate, facts: project.intermediate.facts.filter((row) => row.id !== id) } }, project.createdAt); state.dirty = true; renderFacts(state.draft); }

  async function applyResources() {
    let project = readDraft(); if (!project) return; if (!fields.applyConfirmed.checked) return errors(["Confirm the public preview before creating resources."]); if (!project.chatId) return errors(["Choose a chat first."]);
    let preview; try { preview = core.compilePublicResources(project); } catch (error) { return errors([error.message]); }
    setBusy(true); const failures = [];
    try {
      const characterIds = { ...project.publicResourceIds.characterIds };
      for (const card of preview.cards) if (!characterIds[card.entityId]) try { const created = await api.createCharacter({ data: card.data }); if (!core.cleanId(created?.id)) throw new Error("No character ID returned."); characterIds[card.entityId] = created.id; project = core.createProject({ ...project, publicResourceIds: { ...project.publicResourceIds, characterIds } }, project.createdAt); await storage.saveProject(project); } catch (error) { failures.push(`${card.data.name}: ${error.message}`); }
      let lorebookId = project.publicResourceIds.lorebookId;
      if (!lorebookId && preview.lorebookEntries.length) try { const created = await api.createLorebook({ ...preview.lorebook, characterIds: Object.values(characterIds) }); if (!core.cleanId(created?.id)) throw new Error("No lorebook ID returned."); lorebookId = created.id; project = core.createProject({ ...project, publicResourceIds: { ...project.publicResourceIds, characterIds, lorebookId } }, project.createdAt); await storage.saveProject(project); } catch (error) { failures.push(`Lorebook: ${error.message}`); }
      const entryIds = { ...project.publicResourceIds.entryIds };
      if (lorebookId) for (const entry of preview.lorebookEntries) if (!entryIds[entry.entityId]) try { const created = await api.createLorebookEntry(lorebookId, { name: entry.name, description: entry.description, content: entry.content, keys: entry.keys }); if (!core.cleanId(created?.id)) throw new Error("No entry ID returned."); entryIds[entry.entityId] = created.id; project = core.createProject({ ...project, publicResourceIds: { characterIds, lorebookId, entryIds } }, project.createdAt); await storage.saveProject(project); } catch (error) { failures.push(`${entry.name}: ${error.message}`); }
      if (Object.values(characterIds).length) try { await api.associateCharactersWithChat(project.chatId, Object.values(characterIds)); } catch (error) { failures.push(`Character association: ${error.message}`); }
      if (lorebookId) try { await api.associateLorebookWithChat(project.chatId, lorebookId); } catch (error) { failures.push(`Lorebook association: ${error.message}`); }
      project = core.createProject({ ...project, associatedChatId: project.chatId, publicResourceIds: { characterIds, lorebookId, entryIds }, updatedAt: new Date().toISOString() }, project.createdAt); await storage.saveProject(project); state.projects = await storage.listProjects(); state.draft = project; state.dirty = false; fields.applyConfirmed.checked = false; renderPublic(project);
      if (failures.length) errors(["Public resources completed partially.", ...failures]); else toast("Public resources created and associated.", "success");
    } finally { setBusy(false); }
  }

  function renderInitialization(proposal) { const container = $('[data-slot="initialization-review"]'); container.replaceChildren(); $('[data-slot="initialization-actions"]').hidden = !proposal; if (!proposal) { container.append("No proposal loaded."); return; } const fieldsToShow = [["What happened", proposal.happenedSummary], ["Current point", proposal.currentPoint], ["Confirmed facts", proposal.confirmedFacts.join("\n")], ["Occurred events", proposal.occurredEvents.join("\n")], ["Revealed secret IDs", proposal.revealedSecretIds.join(", ")], ["Blocked secret IDs", proposal.blockedSecretIds.join(", ")]]; for (const [label, value] of fieldsToShow) { const field = document.createElement("label"); field.className = "nd-field"; const span = document.createElement("span"); span.textContent = label; const textarea = document.createElement("textarea"); textarea.rows = 3; textarea.value = value; textarea.readOnly = true; field.append(span, textarea); container.appendChild(field); } }
  async function initialize() { const project = readDraft(); if (!project?.chatId) return errors(["Choose a chat."]); const controller = new AbortController(); state.initializationAbortController = controller; $('[data-action="cancel-analysis"]').hidden = false; setBusy(true, ["cancel-analysis"]); try { const messages = await api.listChatMessages(project.chatId); const result = await api.initializeFromChat(project.initializationConnectionId, project, messages, { signal: controller.signal, resume: state.initializationCheckpoint, onProgress: (progress) => { const panel = $('[data-slot="progress"]'); panel.hidden = false; $('[data-slot="progress-label"]').textContent = progress.blockCount ? `Analyzing block ${progress.block} of ${progress.blockCount}` : `Analyzing block ${progress.block}`; $('[data-slot="progress-range"]').textContent = `Messages ${progress.messageStart}–${progress.messageEnd}`; } }); state.initializationProposal = result.initialState; state.initializationMessageCount = result.messageCount; state.initializationCheckpoint = null; renderInitialization(result.initialState); toast("Initialization proposal ready.", "success"); } catch (error) { if (error.initializationCheckpoint) state.initializationCheckpoint = error.initializationCheckpoint; if (error.name !== "AbortError") errors([error.message]); } finally { setBusy(false); $('[data-action="cancel-analysis"]').hidden = true; state.initializationAbortController = null; } }
  async function confirmInitialization() { if (!state.initializationProposal) return; const project = readDraft(); const updated = core.createProject({ ...project, confirmedInitialState: state.initializationProposal }, project.createdAt); setBusy(true); try { const synced = await api.syncProjectLorebook(updated); const saved = core.createProject({ ...updated, agentLorebookId: synced.lorebookId, agentEntryIds: synced.entryIds, lorebookSyncedChatId: updated.chatId, lorebookSyncedAt: new Date().toISOString() }, updated.createdAt); await storage.saveProject(saved); state.draft = saved; state.projects = await storage.listProjects(); state.initializationProposal = null; renderInitialization(null); toast("State confirmed and project lorebook synchronized.", "success"); } catch (error) { errors([error.message, "The previous confirmed state remains unchanged."]); } finally { setBusy(false); } }

  async function refreshAgents() { const project = readDraft(); if (!project) return; try { const statuses = await api.getAgentStatuses(project.chatId); for (const role of ["director", "tracker"]) { const label = statuses[role].status === "missing" ? "Absent" : statuses[role].status === "active" ? "Created and active" : "Created, inactive"; $(`[data-slot="${role}-status"]`).textContent = label; } } catch (error) { errors([error.message]); } }
  async function syncLorebook() { const project = readDraft(); if (!project) return; setBusy(true); try { const synced = await api.syncProjectLorebook(project); const saved = core.createProject({ ...project, agentLorebookId: synced.lorebookId, agentEntryIds: synced.entryIds, lorebookSyncedChatId: project.chatId, lorebookSyncedAt: new Date().toISOString() }, project.createdAt); await storage.saveProject(saved); state.draft = saved; state.projects = await storage.listProjects(); toast("Director and Tracker entries synchronized in one agent lorebook.", "success"); } catch (error) { errors([error.message, error.directorLorebookUpdated ? "Director entry updated, Tracker entry failed. Retry synchronization." : "No confirmed local state was discarded."]); } finally { setBusy(false); } }
  async function loadLorebook() { const project = readDraft(); if (!project?.chatId) return errors(["Choose a chat."]); setBusy(true); try { const loaded = await api.loadProjectFromLorebook(project.chatId); const recovered = core.createProject({ ...loaded.project, chatId: project.chatId, analysisConnectionId: project.analysisConnectionId, initializationConnectionId: project.initializationConnectionId, agentLorebookId: loaded.lorebookId, agentEntryIds: loaded.entryIds }, loaded.project.createdAt); state.currentId = recovered.id; state.draft = recovered; state.dirty = true; writeDraft(recovered); toast("Project recovered from its Director lorebook entry. Save locally to keep this draft.", "success"); } catch (error) { errors([error.message]); } finally { setBusy(false); } }
  async function activate(active) { const project = readDraft(); if (!project?.chatId) return errors(["Choose a chat."]); setBusy(true); try { await api.updateChatActivation(project.chatId, active); await refreshAgents(); toast(active ? "Fixed agents activated. Existing agents preserved." : "Fixed agents deactivated. Project lorebook was preserved.", "success"); } catch (error) { errors([error.message]); } finally { setBusy(false); } }
  async function refreshRuntime() { const project = readDraft(); const container = $('[data-slot="tracker-runtime"]'); if (!project?.chatId) return errors(["Choose a chat."]); try { const gameState = await api.getGameState(project.chatId); const fields = gameState?.playerStats?.customTrackerFields?.filter((row) => core.TRACKER_FIELD_NAMES.includes(row.name)) || []; container.replaceChildren(); if (!fields.length) container.append("No Narrative Director tracker fields saved."); for (const field of fields) { const details = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = field.name; const pre = document.createElement("pre"); try { pre.textContent = JSON.stringify(JSON.parse(field.value), null, 2); } catch { pre.textContent = String(field.value); } details.append(summary, pre); container.appendChild(details); } } catch (error) { errors([error.message]); } }

  function setBusy(busy, allowed = []) { $$('button, input, select, textarea').forEach((element) => { if (!allowed.includes(element.dataset.action)) element.disabled = busy; }); }
  function setTab(tab) { const project = readDraft() || state.draft; state.tab = tab; $$('[data-tab]').forEach((button) => button.setAttribute("aria-selected", String(button.dataset.tab === tab))); $$('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== tab; }); if (project && tab === "public") renderPublic(project); if (project && tab === "agents") void refreshAgents(); }
  function openPanel() { state.open = true; root.classList.add("is-open"); root.setAttribute("aria-hidden", "false"); document.body.classList.add("nd-body-locked"); void refreshAll().then(() => $('.nd-shell')?.focus()); }
  function closePanel() { if (state.dirty && !window.confirm("Close and discard unsaved changes?")) return; api.clearLastRawResponse(); renderRaw(); state.open = false; root.classList.remove("is-open"); root.setAttribute("aria-hidden", "true"); document.body.classList.remove("nd-body-locked"); }
  function exportJson() { if (!state.projects.length) return toast("No saved projects to export.", "error"); const blob = new Blob([JSON.stringify(core.exportBundle(state.projects), null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "narrative-director-projects.json"; link.click(); URL.revokeObjectURL(url); }
  async function importJson(file) { if (!file) return; try { const projects = core.importBundle(JSON.parse(await file.text())); const current = new Map(state.projects.map((row) => [row.id, row])); for (const project of projects) current.set(project.id, project); await storage.replaceProjects([...current.values()]); state.projects = await storage.listProjects(); state.currentId = projects[0]?.id || ""; state.draft = projects[0] || null; state.dirty = false; renderEditor(); toast(`Imported ${projects.length} project${projects.length === 1 ? "" : "s"}.`, "success"); } catch (error) { errors([error.message]); } }

  marinara.on(launcher, "click", openPanel);
  marinara.on(root, "click", (event) => {
    const tab = event.target.closest?.("[data-tab]"); if (tab) return setTab(tab.dataset.tab);
    const project = event.target.closest?.("[data-project-id]"); if (project) return void selectProject(project.dataset.projectId);
    const target = event.target.closest?.("[data-action]"); const action = target?.dataset.action; if (!action) return;
    if (action === "close") closePanel(); if (action === "new") newProject(); if (action === "delete") void deleteProject(); if (action === "analyze") void analyze();
    if (action === "copy-raw") navigator.clipboard.writeText(api.getLastRawResponse()).then(() => toast("Raw response copied.", "success"), () => toast("Clipboard unavailable.", "error"));
    if (action === "add-fact") addFact(); if (action === "remove-fact") removeFact(target.dataset.id); if (action === "apply") void applyResources();
    if (action === "initialize") void initialize(); if (action === "cancel-analysis") state.initializationAbortController?.abort();
    if (action === "confirm-initialization") void confirmInitialization(); if (action === "discard-initialization") { state.initializationProposal = null; state.initializationCheckpoint = null; renderInitialization(null); }
    if (action === "sync-lorebook") void syncLorebook(); if (action === "load-lorebook") void loadLorebook(); if (action === "refresh-agents") void refreshAgents();
    if (action === "activate") void activate(true); if (action === "deactivate") void activate(false); if (action === "refresh-runtime") void refreshRuntime();
    if (action === "export") exportJson(); if (action === "import") $('[data-slot="import-file"]').click();
  });
  marinara.on(editor, "submit", (event) => { event.preventDefault(); void saveProject(); });
  marinara.on(editor, "input", () => { state.dirty = true; $('[data-slot="save-state"]').textContent = "Unsaved changes"; $('[data-slot="source-count"]').textContent = String(fields.sourceText.value.length); errors([]); });
  marinara.on($('[data-slot="import-file"]'), "change", (event) => { void importJson(event.target.files?.[0]); event.target.value = ""; });
  marinara.on(document, "keydown", (event) => { if (!state.open) return; if (event.key === "Escape") closePanel(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void saveProject(); } });
  marinara.onCleanup(() => { document.body.classList.remove("nd-body-locked"); api.clearLastRawResponse(); delete globalThis.__narrativeDirectorLoaded; delete globalThis.__NarrativeDirectorCore; delete globalThis.__NarrativeDirectorStorage; delete globalThis.__NarrativeDirectorApi; });
})();
