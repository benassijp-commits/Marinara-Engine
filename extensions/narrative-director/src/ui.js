(() => {
  "use strict";

  if (globalThis.__narrativeDirectorLoaded) return;
  globalThis.__narrativeDirectorLoaded = true;

  const core = NarrativeDirectorCore;
  const storage = NarrativeDirectorStorage.createStore();
  const api = NarrativeDirectorApi.createApi(marinara);
  const state = {
    open: false,
    loading: false,
    stories: [],
    currentId: "",
    draft: null,
    resources: { characters: [], chats: [], connections: [] },
    activeTab: "story",
    dirty: false,
    initializationProposal: null,
    initializationMessageCount: 0,
    initializationBlockCount: 0,
    initializationStoryId: "",
    initializationChatId: "",
    initializationCheckpoint: null,
    initializationAbortController: null,
  };

  const launcher = marinara.addElement(document.body, "button", {
    type: "button",
    class: "nd-launcher",
    textContent: "Narrative Director",
    "aria-label": "Open Narrative Director",
    title: "Open Narrative Director",
  });

  const root = marinara.addElement(document.body, "div", {
    class: "nd-root",
    "aria-hidden": "true",
  });

  if (!launcher || !root) return;

  root.innerHTML = `
    <div class="nd-backdrop" data-action="close"></div>
    <section class="nd-shell" role="dialog" aria-modal="true" aria-labelledby="nd-title">
      <header class="nd-header">
        <div class="nd-heading">
          <span class="nd-kicker">Story workspace</span>
          <h1 id="nd-title">Narrative Director</h1>
        </div>
        <div class="nd-header-actions">
          <button class="nd-button nd-button-quiet" type="button" data-action="import">Import JSON</button>
          <button class="nd-button nd-button-quiet" type="button" data-action="export">Export JSON</button>
          <button class="nd-icon-button" type="button" data-action="close" aria-label="Close Narrative Director">×</button>
        </div>
      </header>
      <div class="nd-notice nd-notice-warning" role="note">
        <strong>Private planning boundary</strong>
        <span>Use an exclusive Director connection. Shared pre-generation connections may batch prompts. Agent debug can expose private settings to the local administrator.</span>
      </div>
      <div class="nd-workspace">
        <aside class="nd-sidebar" aria-label="Saved stories">
          <div class="nd-sidebar-toolbar">
            <div>
              <span class="nd-section-label">Saved stories</span>
              <span class="nd-count" data-slot="count">0</span>
            </div>
            <button class="nd-button nd-button-primary nd-button-small" type="button" data-action="new">New story</button>
          </div>
          <div class="nd-story-list" data-slot="stories"></div>
        </aside>
        <main class="nd-main">
          <div class="nd-loading" data-slot="loading" hidden>
            <div class="nd-skeleton nd-skeleton-title"></div>
            <div class="nd-skeleton"></div>
            <div class="nd-skeleton"></div>
          </div>
          <div class="nd-empty" data-slot="empty">
            <div class="nd-empty-mark">ND</div>
            <h2>Build a private story plan</h2>
            <p>Create a story, review its public resources, then apply them only when you explicitly confirm.</p>
            <button class="nd-button nd-button-primary" type="button" data-action="new">Create first story</button>
          </div>
          <form class="nd-editor" data-slot="editor" hidden>
            <div class="nd-editor-title-row">
              <label class="nd-title-field">
                <span class="nd-sr-only">Story name</span>
                <input name="name" maxlength="160" placeholder="Story name" autocomplete="off" />
              </label>
              <div class="nd-status" data-slot="status">Draft</div>
            </div>
            <nav class="nd-tabs" aria-label="Story sections">
              <button type="button" data-tab="story" aria-selected="true">Story</button>
              <button type="button" data-tab="director" aria-selected="false">Director</button>
              <button type="button" data-tab="tracker" aria-selected="false">Tracker</button>
              <button type="button" data-tab="initialization" aria-selected="false">Initialize</button>
              <button type="button" data-tab="application" aria-selected="false">Apply</button>
              <button type="button" data-tab="activation" aria-selected="false">Activation</button>
            </nav>
            <div class="nd-tab-panel" data-panel="story">
              <div class="nd-form-grid nd-form-grid-two">
                <label class="nd-field">
                  <span>Character</span>
                  <select name="characterId"><option value="">Select manually</option></select>
                </label>
                <label class="nd-field">
                  <span>Chat</span>
                  <select name="chatId"><option value="">Select manually</option></select>
                </label>
              </div>
              <label class="nd-field">
                <span>Optional source text</span>
                <small>Kept locally for manual editing. Analysis runs only when you press Analyze.</small>
                <textarea name="sourceText" rows="6" placeholder="Paste or draft the source story here"></textarea>
              </label>
              <section class="nd-analysis-bar" aria-labelledby="nd-analysis-title">
                <div class="nd-analysis-copy">
                  <span class="nd-section-label">AI-assisted structure</span>
                  <strong id="nd-analysis-title">Analyze this source</strong>
                  <small>The result fills reviewable proposals. It does not apply anything to Marinara.</small>
                </div>
                <label class="nd-field nd-analysis-connection">
                  <span>Analysis connection</span>
                  <select name="analysisConnectionId"><option value="">Choose connection</option></select>
                </label>
                <button class="nd-button nd-button-primary" type="button" data-action="analyze">
                  <span data-slot="analyze-label">Analyze story</span>
                </button>
              </section>
              <details class="nd-advanced nd-raw-response" data-slot="raw-response-section" hidden>
                <summary>Raw AI response</summary>
                <div class="nd-raw-warning">This response may contain the complete source story and private narrative data. It is kept only in memory until this panel closes or the extension reloads.</div>
                <pre data-slot="raw-response"></pre>
                <button class="nd-button nd-button-quiet nd-button-small" type="button" data-action="copy-raw-response">Copy raw response</button>
              </details>
              <div class="nd-form-grid nd-form-grid-two">
                <label class="nd-field">
                  <span>Public premise</span>
                  <small>Only the apparent starting situation known to the user and present characters.</small>
                  <textarea name="publicPremise" rows="5" placeholder="Initially safe premise, or empty"></textarea>
                </label>
                <label class="nd-field">
                  <span>Complete story summary</span>
                  <small>Private Director context. Never used to build public resources.</small>
                  <textarea name="storySummary" rows="5" placeholder="The analyzed story summary appears here"></textarea>
                </label>
              </div>
              <div class="nd-form-grid nd-form-grid-two">
                <label class="nd-field">
                  <span>Character information</span>
                  <small>Externally observable and initially safe information only.</small>
                  <textarea name="characterInformation" rows="5" placeholder="Reviewable character information appears here"></textarea>
                </label>
                <label class="nd-field">
                  <span>Proposed card additions</span>
                  <small>Only facts safe at the initial point.</small>
                  <textarea name="cardAdditions" rows="5" placeholder="Permanent public facts"></textarea>
                </label>
                <label class="nd-field">
                  <span>Proposed lorebook entries</span>
                  <small>Review the JSON here, then select and edit entries in Apply.</small>
                  <textarea name="lorebookEntries" rows="5" placeholder="Contextual public facts"></textarea>
                </label>
              </div>
            </div>
            <div class="nd-tab-panel" data-panel="director" hidden>
              <div class="nd-privacy-banner">
                <strong>Director-only document</strong>
                <span>Stored in <code>settings.narrative.privateDocument</code>. Never copied to tracker settings, chat metadata, cards or lorebooks.</span>
              </div>
              <label class="nd-field">
                <span>Private document</span>
                <textarea name="privateDocument" rows="10" placeholder="Secrets, future events and unrevealed progressions"></textarea>
              </label>
              <section class="nd-structured-private" aria-labelledby="nd-private-structure-title">
                <div class="nd-apply-heading">
                  <div><span class="nd-section-label">Structured private data</span><strong id="nd-private-structure-title">Characters, secrets, arcs and candidate beats</strong></div>
                  <span class="nd-resource-state">Director only</span>
                </div>
                <div class="nd-structured-group">
                  <div class="nd-structured-heading"><strong>Private characters</strong><button class="nd-button nd-button-quiet nd-button-small" type="button" data-action="add-private-character">Add character</button></div>
                  <div class="nd-structured-list" data-slot="private-characters"></div>
                </div>
                <div class="nd-structured-group">
                  <div class="nd-structured-heading"><strong>Secrets</strong><button class="nd-button nd-button-quiet nd-button-small" type="button" data-action="add-secret">Add secret</button></div>
                  <div class="nd-structured-list" data-slot="private-secrets"></div>
                </div>
                <div class="nd-structured-group">
                  <div class="nd-structured-heading"><strong>Adaptive arcs</strong><button class="nd-button nd-button-quiet nd-button-small" type="button" data-action="add-narrative-arc">Add arc</button></div>
                  <div class="nd-structured-list" data-slot="narrative-arcs"></div>
                </div>
                <div class="nd-structured-group">
                  <div class="nd-structured-heading"><strong>Candidate beats</strong><button class="nd-button nd-button-quiet nd-button-small" type="button" data-action="add-candidate-beat">Add beat</button></div>
                  <small>Eligibility permits consideration only. Setup must act through NPCs, environment or external consequences—never by controlling {{user}}.</small>
                  <div class="nd-structured-list" data-slot="candidate-beats"></div>
                </div>
              </section>
              <div class="nd-form-grid nd-form-grid-three">
                <label class="nd-field nd-field-wide">
                  <span>Exclusive Director connection</span>
                  <select name="directorConnectionId"><option value="">Choose connection</option></select>
                </label>
                <label class="nd-field"><span>Context messages</span><input name="directorContextSize" type="number" min="1" max="200" /></label>
                <label class="nd-field"><span>Max tokens</span><input name="directorMaxTokens" type="number" min="128" max="32768" /></label>
              </div>
              <details class="nd-advanced">
                <summary>Director prompt and temperature</summary>
                <label class="nd-field"><span>Prompt template</span><textarea name="directorPrompt" rows="9"></textarea></label>
                <label class="nd-field nd-field-compact"><span>Temperature</span><input name="directorTemperature" type="number" min="0" max="2" step="0.1" /></label>
              </details>
            </div>
            <div class="nd-tab-panel" data-panel="tracker" hidden>
              <div class="nd-privacy-banner nd-privacy-banner-neutral">
                <strong>Observable tracker structure</strong>
                <span>The tracker records evidence, arc/beat IDs and revelation layers. It never receives private explanations or setup strategies.</span>
              </div>
              <div class="nd-form-grid nd-form-grid-three">
                <label class="nd-field nd-field-wide">
                  <span>Tracker connection</span>
                  <select name="trackerConnectionId"><option value="">Choose connection</option></select>
                </label>
                <label class="nd-field"><span>Context messages</span><input name="trackerContextSize" type="number" min="1" max="200" /></label>
                <label class="nd-field"><span>Max tokens</span><input name="trackerMaxTokens" type="number" min="128" max="32768" /></label>
              </div>
              <details class="nd-advanced">
                <summary>Tracker prompt and temperature</summary>
                <label class="nd-field"><span>Prompt template</span><textarea name="trackerPrompt" rows="9"></textarea></label>
                <label class="nd-field nd-field-compact"><span>Temperature</span><input name="trackerTemperature" type="number" min="0" max="2" step="0.1" /></label>
              </details>
            </div>
            <div class="nd-tab-panel" data-panel="initialization" hidden>
              <div class="nd-privacy-banner nd-privacy-banner-neutral">
                <strong>Existing chat, active messages only</strong>
                <span>Analysis is manual and read-only. The proposal stays unsaved until you confirm it, and agents are not activated.</span>
              </div>
              <section class="nd-initialization-toolbar">
                <div class="nd-analysis-copy">
                  <span class="nd-section-label">Current narrative state</span>
                  <strong>Compare private plan with selected chat</strong>
                  <small data-slot="initialization-status">No initialization proposal loaded.</small>
                </div>
                <label class="nd-field">
                  <span>Initialization connection</span>
                  <select name="initializationConnectionId"><option value="">Choose connection</option></select>
                </label>
                <div class="nd-initialization-actions">
                  <button class="nd-button nd-button-primary" type="button" data-action="initialize-chat">Initialize from existing chat</button>
                  <button class="nd-button nd-button-quiet" type="button" data-action="cancel-analysis" hidden>Cancel analysis</button>
                </div>
              </section>
              <div class="nd-initialization-progress" data-slot="initialization-progress" hidden role="status" aria-live="polite">
                <strong data-slot="initialization-progress-label"></strong>
                <span data-slot="initialization-progress-range"></span>
              </div>
              <div class="nd-form-grid nd-form-grid-two">
                <label class="nd-field"><span>What already happened</span><textarea name="initHappenedSummary" rows="6"></textarea></label>
                <label class="nd-field"><span>Current story point</span><textarea name="initCurrentPoint" rows="6"></textarea></label>
                <label class="nd-field"><span>Occurred events</span><small>One confirmed event per line.</small><textarea name="initOccurredEvents" rows="6"></textarea></label>
                <label class="nd-field"><span>Pending events</span><small>Private future events not yet confirmed.</small><textarea name="initPendingEvents" rows="6"></textarea></label>
                <label class="nd-field"><span>Revealed secrets</span><small>One clearly revealed secret per line.</small><textarea name="initRevealedSecrets" rows="6"></textarea></label>
                <label class="nd-field"><span>Blocked secrets</span><small>JSON array with non-revealing id and label.</small><textarea name="initBlockedSecrets" rows="6"></textarea></label>
              </div>
              <label class="nd-field"><span>Current character states</span><small>JSON array with name and confirmed state.</small><textarea name="initCharacterStates" rows="7"></textarea></label>
              <div class="nd-activation-actions">
                <button class="nd-button nd-button-primary" type="button" data-action="confirm-initialization">Confirm state and update agents</button>
                <button class="nd-button nd-button-quiet" type="button" data-action="cancel-initialization">Cancel proposal</button>
              </div>
            </div>
            <div class="nd-tab-panel" data-panel="application" hidden>
              <div class="nd-privacy-banner nd-privacy-banner-neutral">
                <strong>Public resources only</strong>
                <span>This preview never includes the complete summary or private Director data. Confirm that these fields contain no unrevealed information.</span>
              </div>
              <section class="nd-apply-section" aria-labelledby="nd-card-preview-title">
                <div class="nd-apply-heading">
                  <div><span class="nd-section-label">Character card</span><strong id="nd-card-preview-title">Choose public sections</strong></div>
                  <span class="nd-resource-state" data-slot="character-resource-state">Not created</span>
                </div>
                <label class="nd-field">
                  <span>New character name</span>
                  <input name="applicationCharacterName" maxlength="200" placeholder="Character name" />
                </label>
                <div class="nd-choice-row" aria-label="Card sections">
                  <label><input type="checkbox" name="cardSection" value="publicPremise" /> Public premise</label>
                  <label><input type="checkbox" name="cardSection" value="characterInformation" /> Character information</label>
                  <label><input type="checkbox" name="cardSection" value="cardAdditions" /> Permanent card details</label>
                </div>
                <pre class="nd-public-preview" data-slot="character-preview">Select at least one section.</pre>
              </section>
              <section class="nd-apply-section" aria-labelledby="nd-lorebook-preview-title">
                <div class="nd-apply-heading">
                  <div><span class="nd-section-label">Lorebook</span><strong id="nd-lorebook-preview-title">Choose and edit entries</strong></div>
                  <span class="nd-resource-state" data-slot="lorebook-resource-state">Not created</span>
                </div>
                <label class="nd-field">
                  <span>New lorebook name</span>
                  <input name="applicationLorebookName" maxlength="200" placeholder="Lorebook name" />
                </label>
                <div class="nd-lorebook-proposals" data-slot="lorebook-proposals"></div>
              </section>
              <label class="nd-confirmation">
                <input type="checkbox" name="applicationConfirmed" />
                <span>I reviewed this public preview and confirm creation and association with the selected chat.</span>
              </label>
              <div class="nd-activation-actions">
                <button class="nd-button nd-button-primary" type="button" data-action="apply-resources">Create or retry public resources</button>
                <button class="nd-button nd-button-quiet" type="button" data-action="copy-report">Copy sanitized report</button>
              </div>
              <section class="nd-application-log" aria-labelledby="nd-application-log-title">
                <div class="nd-state-header"><div><span class="nd-section-label">Diagnostics</span><strong id="nd-application-log-title">Sanitized operation log</strong></div></div>
                <div data-slot="application-log"><p>No public-resource operations yet.</p></div>
              </section>
            </div>
            <div class="nd-tab-panel" data-panel="activation" hidden>
              <section class="nd-activation-summary">
                <div>
                  <span class="nd-section-label">Selected chat</span>
                  <strong data-slot="selected-chat">No chat selected</strong>
                </div>
                <span class="nd-activation-pill" data-slot="activation-state">Inactive</span>
              </section>
              <div class="nd-agent-types">
                <div><span>Director type</span><code data-slot="director-type"></code></div>
                <div><span>Tracker type</span><code data-slot="tracker-type"></code></div>
              </div>
              <div class="nd-activation-actions">
                <button class="nd-button nd-button-primary" type="button" data-action="activate">Create agents and activate</button>
                <button class="nd-button nd-button-danger" type="button" data-action="deactivate">Deactivate this story</button>
                <button class="nd-button nd-button-quiet" type="button" data-action="refresh-state">Refresh tracker state</button>
              </div>
              <section class="nd-state-view">
                <div class="nd-state-header">
                  <div><span class="nd-section-label">Current tracker state</span><strong>Custom fields</strong></div>
                  <span data-slot="state-anchor"></span>
                </div>
                <div class="nd-state-fields" data-slot="tracker-state">
                  <p>No tracker state loaded.</p>
                </div>
              </section>
            </div>
            <div class="nd-errors" data-slot="errors" role="alert" hidden></div>
            <footer class="nd-editor-footer">
              <button class="nd-button nd-button-danger-quiet" type="button" data-action="delete">Delete story</button>
              <div>
                <span class="nd-save-hint" data-slot="save-hint"></span>
                <button class="nd-button nd-button-primary" type="submit">Save story</button>
              </div>
            </footer>
          </form>
        </main>
      </div>
      <div class="nd-toast-region" data-slot="toasts" aria-live="polite"></div>
      <input data-slot="import-file" type="file" accept="application/json,.json" hidden />
    </section>`;

  const $ = (selector) => root.querySelector(selector);
  const $$ = (selector) => Array.from(root.querySelectorAll(selector));
  const editor = $('[data-slot="editor"]');
  const fields = editor.elements;

  function toast(message, tone = "info") {
    const region = $('[data-slot="toasts"]');
    const item = document.createElement("div");
    item.className = `nd-toast nd-toast-${tone}`;
    item.textContent = message;
    region.appendChild(item);
    marinara.setTimeout(() => item.remove(), 4200);
  }

  function showErrors(errors) {
    const box = $('[data-slot="errors"]');
    if (!errors?.length) {
      box.hidden = true;
      box.textContent = "";
      return;
    }
    box.hidden = false;
    box.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = "Check this story before continuing:";
    const list = document.createElement("ul");
    for (const error of errors) {
      const item = document.createElement("li");
      item.textContent = error;
      list.appendChild(item);
    }
    box.append(strong, list);
  }

  function renderRawAnalysisResponse() {
    const raw = api.getLastAnalysisRawResponse();
    const section = $('[data-slot="raw-response-section"]');
    section.hidden = !raw;
    $('[data-slot="raw-response"]').textContent = raw;
  }

  async function copyRawAnalysisResponse() {
    const raw = api.getLastAnalysisRawResponse();
    if (!raw) return;
    try {
      await navigator.clipboard.writeText(raw);
      toast("Raw AI response copied.", "success");
    } catch {
      toast("Could not access the clipboard.", "error");
    }
  }

  function option(value, label) {
    const node = document.createElement("option");
    node.value = value;
    node.textContent = label;
    return node;
  }

  function fillSelect(select, items, selected, placeholder) {
    select.replaceChildren(option("", placeholder));
    for (const item of items) select.appendChild(option(item.id, item.label || item.name));
    select.value = selected || "";
  }

  function selectedCardSections() {
    return $$('input[name="cardSection"]:checked').map((input) => input.value);
  }

  function selectedLorebookIndexes() {
    return $$('[data-lore-select]:checked').map((input) => Number(input.dataset.loreSelect));
  }

  function readLorebookProposalEditor(fallback) {
    const rows = $$('[data-lore-index]');
    if (!rows.length) return fallback;
    return JSON.stringify(rows.map((row) => ({
      name: row.querySelector('[data-lore-field="name"]').value,
      description: row.querySelector('[data-lore-field="description"]').value,
      content: row.querySelector('[data-lore-field="content"]').value,
      keys: row.querySelector('[data-lore-field="keys"]').value.split(",").map((key) => key.trim()).filter(Boolean),
    })), null, 2);
  }

  function readStructuredPrivateEditor() {
    return {
      privateCharacters: $$('[data-private-character]').map((row) => ({
        id: row.querySelector('[data-private-field="id"]').value.trim(),
        name: row.querySelector('[data-private-field="name"]').value.trim(),
        role: row.querySelector('[data-private-field="role"]').value.trim(),
        privateGoal: row.querySelector('[data-private-field="privateGoal"]').value.trim(),
      })),
      secrets: $$('[data-private-secret]').map((row) => ({
        id: row.querySelector('[data-secret-field="id"]').value.trim(),
        title: row.querySelector('[data-secret-field="title"]').value.trim(),
        ownerCharacterId: row.querySelector('[data-secret-field="ownerCharacterId"]').value.trim(),
        knownByCharacterIds: row.querySelector('[data-secret-field="knownByCharacterIds"]').value.split(",").map((id) => id.trim()).filter(Boolean),
        status: row.querySelector('[data-secret-field="status"]').value,
        summary: row.querySelector('[data-secret-field="summary"]').value.trim(),
        revealCondition: row.querySelector('[data-secret-field="revealCondition"]').value.trim(),
      })),
      narrativeArcs: $$('[data-narrative-arc]').map((row) => ({
        id: row.querySelector('[data-arc-field="id"]').value.trim(),
        title: row.querySelector('[data-arc-field="title"]').value.trim(),
        status: row.querySelector('[data-arc-field="status"]').value,
        observedState: row.querySelector('[data-arc-field="observedState"]').value.trim(),
        momentum: row.querySelector('[data-arc-field="momentum"]').value,
        impossibilityEvidence: row.querySelector('[data-arc-field="impossibilityEvidence"]').value.trim(),
        impossibilityFact: row.querySelector('[data-arc-field="impossibilityFact"]').value.trim(),
        confidence: row.querySelector('[data-arc-field="confidence"]').value,
      })),
      candidateBeats: $$('[data-candidate-beat]').map((row) => ({
        id: row.querySelector('[data-beat-field="id"]').value.trim(),
        title: row.querySelector('[data-beat-field="title"]').value.trim(),
        relatedArcIds: row.querySelector('[data-beat-field="relatedArcIds"]').value.split(",").map((id) => id.trim()).filter(Boolean),
        status: row.querySelector('[data-beat-field="status"]').value,
        hardPrerequisites: readLines(row.querySelector('[data-beat-field="hardPrerequisites"]').value),
        readinessSignals: readLines(row.querySelector('[data-beat-field="readinessSignals"]').value),
        blockers: readLines(row.querySelector('[data-beat-field="blockers"]').value),
        setupStrategies: readLines(row.querySelector('[data-beat-field="setupStrategies"]').value),
        relatedSecretIds: row.querySelector('[data-beat-field="relatedSecretIds"]').value.split(",").map((id) => id.trim()).filter(Boolean),
      })),
    };
  }

  function readDraft() {
    if (!state.draft) return null;
    const privateStructure = readStructuredPrivateEditor();
    return core.createStory({
      ...state.draft,
      name: fields.name.value,
      characterId: fields.characterId.value,
      chatId: fields.chatId.value,
      analysisConnectionId: fields.analysisConnectionId.value,
      initializationConnectionId: fields.initializationConnectionId.value,
      sourceText: fields.sourceText.value,
      publicPremise: fields.publicPremise.value,
      storySummary: fields.storySummary.value,
      characterInformation: fields.characterInformation.value,
      cardAdditions: fields.cardAdditions.value,
      lorebookEntries: state.activeTab === "application"
        ? readLorebookProposalEditor(fields.lorebookEntries.value)
        : fields.lorebookEntries.value,
      privateDocument: fields.privateDocument.value,
      ...privateStructure,
      applicationCharacterName: fields.applicationCharacterName.value,
      applicationLorebookName: fields.applicationLorebookName.value,
      applicationCardSections: selectedCardSections(),
      applicationLorebookSelection: selectedLorebookIndexes(),
      director: {
        ...state.draft.director,
        connectionId: fields.directorConnectionId.value,
        promptTemplate: fields.directorPrompt.value,
        contextSize: fields.directorContextSize.value,
        maxTokens: fields.directorMaxTokens.value,
        temperature: fields.directorTemperature.value,
      },
      tracker: {
        ...state.draft.tracker,
        connectionId: fields.trackerConnectionId.value,
        promptTemplate: fields.trackerPrompt.value,
        contextSize: fields.trackerContextSize.value,
        maxTokens: fields.trackerMaxTokens.value,
        temperature: fields.trackerTemperature.value,
      },
      updatedAt: new Date().toISOString(),
    }, state.draft.createdAt);
  }

  function writeDraft(story) {
    state.draft = core.createStory(story, story.createdAt);
    story = state.draft;
    fields.name.value = story.name;
    fillSelect(fields.characterId, state.resources.characters, story.characterId, "Select manually");
    fillSelect(
      fields.chatId,
      state.resources.chats.map((chat) => ({ id: chat.id, label: chat.name || "Unnamed chat" })),
      story.chatId,
      "Select manually",
    );
    fillSelect(
      fields.analysisConnectionId,
      state.resources.connections.map(connectionOption),
      story.analysisConnectionId,
      "Choose connection",
    );
    fillSelect(
      fields.initializationConnectionId,
      state.resources.connections.map(connectionOption),
      story.initializationConnectionId || story.analysisConnectionId,
      "Choose connection",
    );
    fillSelect(
      fields.directorConnectionId,
      state.resources.connections.map(connectionOption),
      story.director.connectionId,
      "Choose connection",
    );
    fillSelect(
      fields.trackerConnectionId,
      state.resources.connections.map(connectionOption),
      story.tracker.connectionId,
      "Choose connection",
    );
    fields.sourceText.value = story.sourceText;
    fields.publicPremise.value = story.publicPremise;
    fields.storySummary.value = story.storySummary;
    fields.characterInformation.value = story.characterInformation;
    fields.cardAdditions.value = story.cardAdditions;
    fields.lorebookEntries.value = story.lorebookEntries;
    fields.privateDocument.value = story.privateDocument;
    renderPrivateStructure(story);
    fields.applicationCharacterName.value = story.applicationCharacterName || story.name;
    fields.applicationLorebookName.value = story.applicationLorebookName || `${story.name} Lorebook`;
    $$('input[name="cardSection"]').forEach((input) => {
      input.checked = story.applicationCardSections.includes(input.value);
    });
    fields.directorPrompt.value = story.director.promptTemplate;
    fields.directorContextSize.value = story.director.contextSize;
    fields.directorMaxTokens.value = story.director.maxTokens;
    fields.directorTemperature.value = story.director.temperature;
    fields.trackerPrompt.value = story.tracker.promptTemplate;
    fields.trackerContextSize.value = story.tracker.contextSize;
    fields.trackerMaxTokens.value = story.tracker.maxTokens;
    fields.trackerTemperature.value = story.tracker.temperature;
    renderInitializationProposal(
      state.initializationStoryId === story.id ? state.initializationProposal : story.confirmedInitialState,
      story,
    );
    state.dirty = false;
    renderApplicationView(state.draft);
    updateDerivedView();
    showErrors([]);
  }

  function connectionOption(connection) {
    return { id: connection.id, label: `${connection.name || "Connection"} · ${connection.model || connection.provider}` };
  }

  function setRowValue(row, selector, value) {
    const input = row.querySelector(selector);
    if (input) input.value = value ?? "";
  }

  function renderPrivateStructure(story) {
    const characters = $('[data-slot="private-characters"]');
    const secrets = $('[data-slot="private-secrets"]');
    const arcs = $('[data-slot="narrative-arcs"]');
    const beats = $('[data-slot="candidate-beats"]');
    characters.replaceChildren();
    secrets.replaceChildren();
    arcs.replaceChildren();
    beats.replaceChildren();
    story.privateCharacters.forEach((item, index) => {
      const row = document.createElement("details");
      row.className = "nd-structured-entry";
      row.dataset.privateCharacter = String(index);
      row.innerHTML = `<summary><span>${item.name || item.id}</span><small>${item.id}</small></summary>
        <div class="nd-structured-fields">
          <div class="nd-form-grid nd-form-grid-two">
            <label class="nd-field"><span>ID</span><input data-private-field="id" /></label>
            <label class="nd-field"><span>Name</span><input data-private-field="name" /></label>
          </div>
          <label class="nd-field"><span>Private role</span><input data-private-field="role" /></label>
          <label class="nd-field"><span>Private goal</span><textarea data-private-field="privateGoal" rows="3"></textarea></label>
          <button class="nd-button nd-button-danger-quiet nd-button-small" type="button" data-action="remove-private-character" data-index="${index}">Remove character</button>
        </div>`;
      setRowValue(row, '[data-private-field="id"]', item.id);
      setRowValue(row, '[data-private-field="name"]', item.name);
      setRowValue(row, '[data-private-field="role"]', item.role);
      setRowValue(row, '[data-private-field="privateGoal"]', item.privateGoal);
      characters.appendChild(row);
    });
    story.secrets.forEach((item, index) => {
      const row = document.createElement("details");
      row.className = "nd-structured-entry";
      row.dataset.privateSecret = String(index);
      row.innerHTML = `<summary><span>${item.title || item.id}</span><small>${item.status} · ${item.id}</small></summary>
        <div class="nd-structured-fields">
          <div class="nd-form-grid nd-form-grid-two">
            <label class="nd-field"><span>ID</span><input data-secret-field="id" /></label>
            <label class="nd-field"><span>Title</span><input data-secret-field="title" /></label>
            <label class="nd-field"><span>Owner character ID</span><input data-secret-field="ownerCharacterId" /></label>
            <label class="nd-field"><span>Known by character IDs</span><input data-secret-field="knownByCharacterIds" placeholder="id_one, id_two" /></label>
            <label class="nd-field"><span>Status</span><select data-secret-field="status"><option value="locked">Locked</option><option value="foreshadowed">Foreshadowed</option><option value="suspected">Suspected</option><option value="partially_revealed">Partially revealed</option><option value="confirmed">Confirmed</option></select></label>
          </div>
          <label class="nd-field"><span>Private summary</span><textarea data-secret-field="summary" rows="3"></textarea></label>
          <label class="nd-field"><span>Reveal condition</span><textarea data-secret-field="revealCondition" rows="3"></textarea></label>
          <button class="nd-button nd-button-danger-quiet nd-button-small" type="button" data-action="remove-secret" data-index="${index}">Remove secret</button>
        </div>`;
      setRowValue(row, '[data-secret-field="id"]', item.id);
      setRowValue(row, '[data-secret-field="title"]', item.title);
      setRowValue(row, '[data-secret-field="ownerCharacterId"]', item.ownerCharacterId);
      setRowValue(row, '[data-secret-field="knownByCharacterIds"]', item.knownByCharacterIds.join(", "));
      setRowValue(row, '[data-secret-field="status"]', item.status);
      setRowValue(row, '[data-secret-field="summary"]', item.summary);
      setRowValue(row, '[data-secret-field="revealCondition"]', item.revealCondition);
      secrets.appendChild(row);
    });
    story.narrativeArcs.forEach((item, index) => {
      const row = document.createElement("details");
      row.className = "nd-structured-entry";
      row.dataset.narrativeArc = String(index);
      row.innerHTML = `<summary><span>${item.title || item.id}</span><small>${item.status} · ${item.momentum}</small></summary>
        <div class="nd-structured-fields"><div class="nd-form-grid nd-form-grid-two">
          <label class="nd-field"><span>ID</span><input data-arc-field="id" /></label>
          <label class="nd-field"><span>Title</span><input data-arc-field="title" /></label>
          <label class="nd-field"><span>Status</span><select data-arc-field="status"><option value="inactive">Inactive</option><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option><option value="abandoned">Abandoned</option></select></label>
          <label class="nd-field"><span>Momentum</span><select data-arc-field="momentum"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        </div><label class="nd-field"><span>Observed state</span><textarea data-arc-field="observedState" rows="3"></textarea></label>
        <details class="nd-arc-abandonment"><summary>Abandonment evidence</summary><div class="nd-structured-fields">
          <label class="nd-field"><span>Definitive impossibility evidence</span><textarea data-arc-field="impossibilityEvidence" rows="3"></textarea></label>
          <label class="nd-field"><span>Confirmed impossibility fact</span><textarea data-arc-field="impossibilityFact" rows="3"></textarea></label>
          <label class="nd-field"><span>Confidence</span><select data-arc-field="confidence"><option value="">Not established</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <small>Required only for abandoned. Refusal, delay, low readiness and recoverable divergence are not abandonment.</small>
        </div></details>
        <button class="nd-button nd-button-danger-quiet nd-button-small" type="button" data-action="remove-narrative-arc" data-index="${index}">Remove arc</button></div>`;
      for (const key of ["id", "title", "status", "observedState", "momentum", "impossibilityEvidence", "impossibilityFact", "confidence"]) setRowValue(row, `[data-arc-field="${key}"]`, item[key]);
      arcs.appendChild(row);
    });
    story.candidateBeats.forEach((item, index) => {
      const row = document.createElement("details");
      row.className = "nd-structured-entry";
      row.dataset.candidateBeat = String(index);
      row.innerHTML = `<summary><span>${item.title || item.id}</span><small>${item.status} · ${item.id}</small></summary>
        <div class="nd-structured-fields"><div class="nd-form-grid nd-form-grid-two">
          <label class="nd-field"><span>ID</span><input data-beat-field="id" /></label><label class="nd-field"><span>Title</span><input data-beat-field="title" /></label>
          <label class="nd-field"><span>Status</span><select data-beat-field="status"><option value="unavailable">Unavailable</option><option value="eligible">Eligible</option><option value="active">Active</option><option value="deferred">Deferred</option><option value="completed">Completed</option><option value="skipped">Skipped</option></select></label>
          <label class="nd-field"><span>Related arc IDs</span><input data-beat-field="relatedArcIds" /></label>
          <label class="nd-field"><span>Related secret IDs</span><input data-beat-field="relatedSecretIds" /></label>
        </div>
        <label class="nd-field"><span>Hard prerequisites</span><small>One confirmed prerequisite per line.</small><textarea data-beat-field="hardPrerequisites" rows="3"></textarea></label>
        <label class="nd-field"><span>Readiness signals</span><small>One observable signal per line.</small><textarea data-beat-field="readinessSignals" rows="3"></textarea></label>
        <label class="nd-field"><span>Blockers</span><textarea data-beat-field="blockers" rows="3"></textarea></label>
        <label class="nd-field"><span>Setup strategies</span><small>NPC/environment actions only; never control {{user}}.</small><textarea data-beat-field="setupStrategies" rows="3"></textarea></label>
        <button class="nd-button nd-button-danger-quiet nd-button-small" type="button" data-action="remove-candidate-beat" data-index="${index}">Remove beat</button></div>`;
      for (const key of ["id", "title", "status"]) setRowValue(row, `[data-beat-field="${key}"]`, item[key]);
      for (const key of ["relatedArcIds", "relatedSecretIds"]) setRowValue(row, `[data-beat-field="${key}"]`, item[key].join(", "));
      for (const key of ["hardPrerequisites", "readinessSignals", "blockers", "setupStrategies"]) setRowValue(row, `[data-beat-field="${key}"]`, item[key].join("\n"));
      beats.appendChild(row);
    });
    for (const [container, label] of [[characters, "No private characters yet."], [secrets, "No secrets yet."], [arcs, "No adaptive arcs yet."], [beats, "No candidate beats yet."]]) {
      if (!container.children.length) {
        const empty = document.createElement("p");
        empty.className = "nd-inline-empty";
        empty.textContent = label;
        container.appendChild(empty);
      }
    }
  }

  function nextStructuredId(prefix, items) {
    let number = items.length + 1;
    while (items.some((item) => item.id === `${prefix}_${number}`)) number++;
    return `${prefix}_${number}`;
  }

  function mutatePrivateStructure(kind, index = -1) {
    const draft = readDraft();
    if (!draft) return;
    if (kind === "add-character") {
      draft.privateCharacters.push({ id: nextStructuredId("character", draft.privateCharacters), name: "New character", role: "Private role", privateGoal: "Private goal" });
    } else if (kind === "add-secret") {
      draft.secrets.push({ id: nextStructuredId("secret", draft.secrets), title: "New secret", ownerCharacterId: draft.privateCharacters[0]?.id || "character_1", knownByCharacterIds: [], status: "locked", summary: "Private summary", revealCondition: "Reveal condition" });
    } else if (kind === "add-arc") {
      draft.narrativeArcs.push({ id: nextStructuredId("arc", draft.narrativeArcs), title: "New arc", status: "inactive", observedState: "No confirmed movement yet", momentum: "low", impossibilityEvidence: "", impossibilityFact: "", confidence: "" });
    } else if (kind === "add-beat") {
      draft.candidateBeats.push({ id: nextStructuredId("beat", draft.candidateBeats), title: "New candidate beat", relatedArcIds: [draft.narrativeArcs[0]?.id || "arc_1"], status: "unavailable", hardPrerequisites: [], readinessSignals: ["Observable readiness signal"], blockers: [], setupStrategies: ["An NPC or environment setup"], relatedSecretIds: [] });
    } else if (kind === "remove-character") draft.privateCharacters.splice(index, 1);
    else if (kind === "remove-secret") draft.secrets.splice(index, 1);
    else if (kind === "remove-arc") draft.narrativeArcs.splice(index, 1);
    else if (kind === "remove-beat") draft.candidateBeats.splice(index, 1);
    state.draft = core.createStory(draft, draft.createdAt);
    state.dirty = true;
    renderPrivateStructure(state.draft);
    updateDerivedView();
  }

  function renderInitializationProposal(proposal, story = state.draft) {
    const value = proposal || {
      happenedSummary: "", currentPoint: "", occurredEvents: [], pendingEvents: [], revealedSecrets: [],
      blockedSecrets: [], characterStates: [],
    };
    fields.initHappenedSummary.value = value.happenedSummary || "";
    fields.initCurrentPoint.value = value.currentPoint || "";
    fields.initOccurredEvents.value = (value.occurredEvents || []).join("\n");
    fields.initPendingEvents.value = (value.pendingEvents || []).join("\n");
    fields.initRevealedSecrets.value = (value.revealedSecrets || []).join("\n");
    fields.initBlockedSecrets.value = JSON.stringify(value.blockedSecrets || [], null, 2);
    fields.initCharacterStates.value = JSON.stringify(value.characterStates || [], null, 2);
    const hasPending = Boolean(
      state.initializationProposal && state.initializationStoryId === story?.id && state.initializationChatId === story?.chatId,
    );
    $('[data-slot="initialization-status"]').textContent = hasPending
      ? `Unsaved proposal from ${state.initializationMessageCount} active messages in ${state.initializationBlockCount || 1} block(s). Review and confirm or cancel.`
      : story?.initializedChatId
        ? `Confirmed for chat ${story.initializedChatId}${story.initializedAt ? ` at ${story.initializedAt}` : ""}.`
        : "No initialization proposal loaded.";
  }

  function readLines(value) {
    return value.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  function readInitializationEditor() {
    let blockedSecrets;
    let characterStates;
    try {
      blockedSecrets = JSON.parse(fields.initBlockedSecrets.value || "[]");
      characterStates = JSON.parse(fields.initCharacterStates.value || "[]");
    } catch {
      throw new Error("Blocked secrets and character states must contain valid JSON arrays.");
    }
    return core.parseInitializationResponse(JSON.stringify({
      happenedSummary: fields.initHappenedSummary.value,
      currentPoint: fields.initCurrentPoint.value,
      occurredEvents: readLines(fields.initOccurredEvents.value),
      pendingEvents: readLines(fields.initPendingEvents.value),
      revealedSecrets: readLines(fields.initRevealedSecrets.value),
      blockedSecrets,
      characterStates,
    }));
  }

  function renderApplicationView(story) {
    if (!story) return;
    const container = $('[data-slot="lorebook-proposals"]');
    container.replaceChildren();
    let proposals = [];
    try {
      proposals = core.parseLorebookProposals(story.lorebookEntries || "[]");
    } catch (error) {
      const message = document.createElement("p");
      message.className = "nd-inline-error";
      message.textContent = error.message;
      container.appendChild(message);
    }
    const selected = Array.isArray(story.applicationLorebookSelection)
      ? new Set(story.applicationLorebookSelection)
      : new Set(proposals.map((_entry, index) => index));
    for (const [index, entry] of proposals.entries()) {
      const row = document.createElement("section");
      row.className = "nd-lorebook-proposal";
      row.dataset.loreIndex = String(index);
      row.innerHTML = `
        <label class="nd-entry-choice"><input type="checkbox" data-lore-select="${index}" ${selected.has(index) ? "checked" : ""} /><span>Include entry ${index + 1}</span></label>
        <div class="nd-form-grid nd-form-grid-two">
          <label class="nd-field"><span>Name</span><input data-lore-field="name" maxlength="200" /></label>
          <label class="nd-field"><span>Keys, comma separated</span><input data-lore-field="keys" /></label>
        </div>
        <label class="nd-field"><span>Description</span><input data-lore-field="description" /></label>
        <label class="nd-field"><span>Public lore content</span><textarea data-lore-field="content" rows="4"></textarea></label>`;
      row.querySelector('[data-lore-field="name"]').value = entry.name;
      row.querySelector('[data-lore-field="keys"]').value = entry.keys.join(", ");
      row.querySelector('[data-lore-field="description"]').value = entry.description;
      row.querySelector('[data-lore-field="content"]').value = entry.content;
      container.appendChild(row);
    }
    if (!proposals.length && !container.children.length) {
      const empty = document.createElement("p");
      empty.className = "nd-inline-empty";
      empty.textContent = "No lorebook proposals are available.";
      container.appendChild(empty);
    }
    const previewStory = core.createStory({ ...story,
      applicationCharacterName: fields.applicationCharacterName.value,
      applicationLorebookName: fields.applicationLorebookName.value,
      applicationCardSections: selectedCardSections(),
      applicationLorebookSelection: selectedLorebookIndexes(),
    }, story.createdAt);
    try {
      const preview = core.buildPublicResourcePreview(previewStory);
      $('[data-slot="character-preview"]').textContent = preview.character.data.description || "No public card sections selected.";
    } catch (error) {
      $('[data-slot="character-preview"]').textContent = error.message;
    }
    $('[data-slot="character-resource-state"]').textContent = story.createdCharacterId
      ? `Created · ${story.createdCharacterId}` : "Not created";
    const entryCount = Object.keys(story.createdLorebookEntryIds).length;
    $('[data-slot="lorebook-resource-state"]').textContent = story.createdLorebookId
      ? `Created · ${story.createdLorebookId} · ${entryCount} entries` : "Not created";
    renderApplicationLog(story);
  }

  function renderApplicationLog(story) {
    const container = $('[data-slot="application-log"]');
    container.replaceChildren();
    if (!story.applicationLog.length) {
      const empty = document.createElement("p");
      empty.textContent = "No public-resource operations yet.";
      container.appendChild(empty);
      return;
    }
    for (const entry of [...story.applicationLog].reverse()) {
      const row = document.createElement("div");
      row.className = `nd-log-row is-${entry.status}`;
      const summary = document.createElement("strong");
      summary.textContent = `${entry.operation}: ${entry.status}`;
      const detail = document.createElement("span");
      const ids = Object.values(entry.resourceIds).join(", ");
      const chat = entry.chatId ? `chat ${entry.chatId}` : "";
      const messages = entry.messageCount ? `${entry.messageCount} messages` : "";
      const agents = entry.operation.includes("existing_chat")
        ? `Director ${entry.directorUpdated ? "updated" : "not updated"}; tracker ${entry.trackerUpdated ? "updated" : "not updated"}`
        : "";
      detail.textContent = [entry.timestamp, entry.stage, chat, messages, agents, ids, entry.error].filter(Boolean).join(" · ");
      row.append(summary, detail);
      container.appendChild(row);
    }
  }

  function updateApplicationPreview() {
    if (!state.draft || state.activeTab !== "application") return;
    try {
      const preview = core.buildPublicResourcePreview(readDraft());
      $('[data-slot="character-preview"]').textContent = preview.character.data.description || "No public card sections selected.";
    } catch (error) {
      $('[data-slot="character-preview"]').textContent = error.message;
    }
  }

  function renderStories() {
    const list = $('[data-slot="stories"]');
    list.replaceChildren();
    $('[data-slot="count"]').textContent = String(state.stories.length);
    if (!state.stories.length) {
      const text = document.createElement("p");
      text.className = "nd-sidebar-empty";
      text.textContent = "No saved stories yet.";
      list.appendChild(text);
      return;
    }
    for (const story of state.stories) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `nd-story-row${story.id === state.currentId ? " is-active" : ""}`;
      button.dataset.storyId = story.id;
      const title = document.createElement("strong");
      title.textContent = story.name;
      const meta = document.createElement("span");
      const character = state.resources.characters.find((item) => item.id === story.characterId);
      meta.textContent = character?.name || "No character";
      const status = document.createElement("span");
      status.className = `nd-story-status${story.activeChatId ? " is-active" : ""}`;
      status.textContent = story.activeChatId ? "Active" : "Draft";
      button.append(title, meta, status);
      list.appendChild(button);
    }
  }

  function updateDerivedView() {
    if (!state.draft) return;
    const draft = readDraft() || state.draft;
    const types = core.storyTypes(draft);
    $('[data-slot="director-type"]').textContent = types.director;
    $('[data-slot="tracker-type"]').textContent = types.tracker;
    const chat = state.resources.chats.find((item) => item.id === draft.chatId);
    $('[data-slot="selected-chat"]').textContent = chat?.name || "No chat selected";
    const active = Boolean(draft.activeChatId && draft.activeChatId === draft.chatId);
    const pill = $('[data-slot="activation-state"]');
    pill.textContent = active ? "Active in chat" : "Inactive";
    pill.classList.toggle("is-active", active);
    $('[data-slot="status"]').textContent = active ? "Active" : state.dirty ? "Unsaved" : "Saved locally";
    $('[data-slot="save-hint"]').textContent = state.dirty ? "Unsaved changes" : "";
  }

  function renderEditor() {
    $('[data-slot="empty"]').hidden = Boolean(state.draft);
    editor.hidden = !state.draft;
    if (state.draft) writeDraft(state.draft);
    renderStories();
  }

  async function loadResources() {
    const [characters, chats, connections] = await Promise.all([
      api.listCharacters(), api.listChats(), api.listConnections(),
    ]);
    state.resources = { characters, chats, connections };
  }

  async function refreshAll() {
    state.loading = true;
    $('[data-slot="loading"]').hidden = false;
    $('[data-slot="empty"]').hidden = true;
    editor.hidden = true;
    try {
      await Promise.all([loadResources(), storage.open()]);
      state.stories = await storage.listStories();
      const preferred = state.currentId || (await storage.getMeta("lastStoryId")) || state.stories[0]?.id || "";
      state.currentId = state.stories.some((story) => story.id === preferred) ? preferred : state.stories[0]?.id || "";
      state.draft = state.stories.find((story) => story.id === state.currentId) || null;
    } catch (error) {
      toast(error.message || "Could not load Narrative Director.", "error");
    } finally {
      state.loading = false;
      $('[data-slot="loading"]').hidden = true;
      renderEditor();
    }
  }

  async function selectStory(id) {
    if (state.dirty && !window.confirm("Discard unsaved changes and open another story?")) return;
    state.currentId = id;
    clearInitializationProposal();
    state.draft = state.stories.find((story) => story.id === id) || null;
    await storage.setMeta("lastStoryId", id);
    renderEditor();
  }

  function newStory() {
    if (state.dirty && !window.confirm("Discard unsaved changes and create a new story?")) return;
    const defaultConnection = state.resources.connections.find((item) => item.defaultForAgents === true || item.defaultForAgents === "true");
    const draft = core.createStory({
      name: "New story",
      analysisConnectionId: defaultConnection?.id || "",
      initializationConnectionId: defaultConnection?.id || "",
      director: { connectionId: defaultConnection?.id || "" },
      tracker: { connectionId: defaultConnection?.id || "" },
    });
    state.currentId = draft.id;
    clearInitializationProposal();
    state.draft = draft;
    state.dirty = true;
    renderEditor();
    fields.name.select();
  }

  async function saveCurrent() {
    const draft = readDraft();
    if (!draft) return null;
    if (!draft.name.trim()) {
      showErrors(["Story name is required."]);
      return null;
    }
    await storage.saveStory(draft);
    state.stories = await storage.listStories();
    state.currentId = draft.id;
    state.draft = draft;
    state.dirty = false;
    await storage.setMeta("lastStoryId", draft.id);
    renderEditor();
    toast("Story saved locally.", "success");
    return draft;
  }

  async function deleteCurrent() {
    if (!state.draft) return;
    if (state.draft.activeChatId) {
      toast("Deactivate this story before deleting it.", "error");
      return;
    }
    if (!window.confirm(`Delete “${state.draft.name}” from this browser?`)) return;
    await storage.deleteStory(state.draft.id);
    state.stories = await storage.listStories();
    state.currentId = state.stories[0]?.id || "";
    state.draft = state.stories[0] || null;
    state.dirty = false;
    renderEditor();
    toast("Story deleted.", "success");
  }

  async function analyzeCurrent() {
    const original = readDraft();
    if (!original) return;
    const errors = [];
    if (!original.sourceText.trim()) errors.push("Paste a story before analyzing it.");
    if (!original.analysisConnectionId) errors.push("Choose an analysis connection.");
    if (original.sourceText.length > core.MAX_ANALYSIS_SOURCE_LENGTH) {
      errors.push(`Story analysis supports up to ${core.MAX_ANALYSIS_SOURCE_LENGTH.toLocaleString()} characters.`);
    }
    if (errors.length) {
      showErrors(errors);
      return;
    }
    setAnalyzing(true);
    showErrors([]);
    try {
      const result = await api.analyzeStory(original.analysisConnectionId, original.sourceText);
      const analyzed = core.applyAnalysis(original, result);
      await storage.saveStory(analyzed);
      state.stories = await storage.listStories();
      state.currentId = analyzed.id;
      state.draft = analyzed;
      state.dirty = false;
      renderEditor();
      renderRawAnalysisResponse();
      toast("Analysis complete. Review every proposal before activation.", "success");
    } catch (error) {
      state.draft = original;
      renderRawAnalysisResponse();
      showErrors([error.message || "Story analysis failed. Your source text was preserved."]);
      toast("Analysis failed. The original source is unchanged.", "error");
    } finally {
      setAnalyzing(false);
    }
  }

  function clearInitializationProposal(clearCheckpoint = true) {
    state.initializationProposal = null;
    state.initializationMessageCount = 0;
    state.initializationBlockCount = 0;
    state.initializationStoryId = "";
    state.initializationChatId = "";
    if (clearCheckpoint) state.initializationCheckpoint = null;
  }

  function showInitializationProgress(progress = null) {
    const panel = $('[data-slot="initialization-progress"]');
    const cancel = $('[data-action="cancel-analysis"]');
    panel.hidden = !progress;
    cancel.hidden = !progress;
    if (!progress) return;
    $('[data-slot="initialization-progress-label"]').textContent = `Analyzing block ${progress.block} of ${progress.blockCount}`;
    const split = progress.splits?.length ? ` · split message parts: ${progress.splits.map((item) => `${item.message}:${item.part}/${item.total}`).join(", ")}` : "";
    $('[data-slot="initialization-progress-range"]').textContent = `Messages ${progress.messageStart}–${progress.messageEnd}${split}`;
  }

  async function saveInitializationDiagnostic(story, input) {
    const logged = appendApplicationLog(story, input);
    await storage.saveStory(logged);
    state.draft = logged;
    state.stories = await storage.listStories();
    return logged;
  }

  async function initializeExistingChat() {
    const original = readDraft();
    if (!original) return;
    const errors = [];
    if (!original.chatId) errors.push("Choose the existing chat to initialize.");
    if (!original.initializationConnectionId) errors.push("Choose an initialization connection.");
    if (!original.privateDocument.trim()) errors.push("The private Director document is empty.");
    if (errors.length) {
      showErrors(errors);
      return;
    }
    setBusy(true, "Reading active chat messages…");
    state.initializationAbortController = new AbortController();
    showErrors([]);
    let messageCount = 0;
    try {
      const messages = await api.listChatMessages(original.chatId);
      messageCount = messages.length;
      const result = await api.initializeFromChat(original.initializationConnectionId, original, messages, {
        resume: state.initializationCheckpoint,
        signal: state.initializationAbortController.signal,
        onProgress: showInitializationProgress,
      });
      state.initializationCheckpoint = null;
      state.initializationProposal = result.initialState;
      state.initializationMessageCount = result.messageCount;
      state.initializationBlockCount = result.blockCount || 1;
      state.initializationStoryId = original.id;
      state.initializationChatId = original.chatId;
      renderInitializationProposal(result.initialState, original);
      toast("Initialization proposal ready. Nothing has been saved or activated.", "success");
    } catch (error) {
      if (error.name === "AbortError") {
        clearInitializationProposal();
        renderInitializationProposal(original.confirmedInitialState, original);
        showErrors([]);
        toast("Initialization cancelled. Previous state preserved.", "info");
        return;
      }
      clearInitializationProposal(false);
      if (error.initializationCheckpoint) state.initializationCheckpoint = error.initializationCheckpoint;
      await saveInitializationDiagnostic(original, {
        operation: "initialize_existing_chat", status: "error", stage: error.block ? `block_${error.block}_of_${error.blockCount}` : "analysis",
        chatId: original.chatId, messageCount, error: "Initialization analysis failed.",
      });
      renderInitializationProposal(original.confirmedInitialState, original);
      showErrors([error.message || "Existing-chat initialization failed. The previous state was preserved."]);
      toast("Initialization failed. The chat and previous state are unchanged.", "error");
    } finally {
      state.initializationAbortController = null;
      showInitializationProgress(null);
      setBusy(false);
    }
  }

  function cancelInitializationAnalysis() {
    state.initializationAbortController?.abort();
    state.initializationCheckpoint = null;
    showInitializationProgress(null);
    toast("Cancellation requested. No partial state will be saved.", "info");
  }

  function cancelInitialization() {
    const story = readDraft() || state.draft;
    clearInitializationProposal();
    renderInitializationProposal(story?.confirmedInitialState, story);
    showErrors([]);
    toast("Initialization proposal discarded. No state was saved.", "info");
  }

  async function confirmInitialization() {
    const original = readDraft();
    if (!original) return;
    if (
      !state.initializationProposal || state.initializationStoryId !== original.id || state.initializationChatId !== original.chatId
    ) {
      showErrors(["Generate an initialization proposal for this story and chat before confirming."]);
      return;
    }
    let reviewed;
    try {
      reviewed = readInitializationEditor();
    } catch (error) {
      showErrors([error.message]);
      return;
    }
    const candidate = core.createStory({
      ...original,
      confirmedInitialState: reviewed,
      initializedChatId: original.chatId,
      initializedAt: new Date().toISOString(),
    }, original.createdAt);
    setBusy(true, "Updating Director and tracker…");
    showErrors([]);
    try {
      const agents = await api.ensureAgents(candidate);
      let saved = core.createStory({
        ...candidate,
        director: { ...candidate.director, agentId: agents.director.id },
        tracker: { ...candidate.tracker, agentId: agents.tracker.id },
      }, candidate.createdAt);
      saved = appendApplicationLog(saved, {
        operation: "confirm_existing_chat_state", status: "success", stage: "agents_updated",
        chatId: saved.chatId, messageCount: state.initializationMessageCount,
        resourceIds: { directorId: agents.director.id, trackerId: agents.tracker.id },
        directorUpdated: true, trackerUpdated: true,
      });
      await storage.saveStory(saved);
      state.draft = saved;
      state.stories = await storage.listStories();
      state.dirty = false;
      clearInitializationProposal();
      renderEditor();
      setTab("initialization");
      toast("Confirmed state saved and both agents updated. They were not activated.", "success");
    } catch (error) {
      const logged = await saveInitializationDiagnostic(original, {
        operation: "confirm_existing_chat_state", status: "error", stage: "agent_update",
        chatId: original.chatId, messageCount: state.initializationMessageCount, error: "Agent update failed.",
        directorUpdated: error?.directorUpdated === true, trackerUpdated: false,
      });
      showErrors([error.message || "Could not update both agents. The previous confirmed state remains saved."]);
      state.draft = logged;
      renderInitializationProposal(state.initializationProposal, original);
    } finally {
      setBusy(false);
    }
  }

  function appendApplicationLog(story, input) {
    return core.createStory({
      ...story,
      applicationLog: [...story.applicationLog, core.applicationLogEntry({
        ...input,
        privateDocument: story.privateDocument,
      })],
      updatedAt: new Date().toISOString(),
    }, story.createdAt);
  }

  async function persistApplicationProgress(story) {
    await storage.saveStory(story);
    state.draft = story;
    state.stories = await storage.listStories();
  }

  async function applyPublicResources() {
    let working = readDraft();
    if (!working) return;
    const errors = [];
    try { core.requireApplicationConfirmation(fields.applicationConfirmed.checked); } catch (error) { errors.push(error.message); }
    if (!working.chatId) errors.push("Choose a chat before creating and associating resources.");
    let preview;
    try {
      preview = core.buildPublicResourcePreview(working);
      if (!preview.character.data.name.trim()) errors.push("Enter a character name.");
      if (!preview.lorebook.name.trim()) errors.push("Enter a lorebook name.");
    } catch (error) {
      errors.push(error.message);
    }
    if (errors.length) {
      showErrors(errors);
      return;
    }
    setBusy(true, "Creating public resources…");
    showErrors([]);
    const failures = [];
    try {
      await persistApplicationProgress(working);
      if (core.pendingPublicOperations(working).character) {
        try {
          const created = await api.createCharacter(preview.character);
          if (!core.cleanId(created?.id)) throw new Error("Character creation returned no valid ID.");
          working = core.createStory({ ...working, createdCharacterId: created.id, characterId: created.id }, working.createdAt);
          working = appendApplicationLog(working, {
            operation: "create_character", status: "success", stage: "character", resourceIds: { characterId: created.id },
          });
          await persistApplicationProgress(working);
        } catch (error) {
          failures.push(`Character: ${core.sanitizeDiagnostic(error, working.privateDocument)}`);
          working = appendApplicationLog(working, {
            operation: "create_character", status: "error", stage: "character", error,
          });
          await persistApplicationProgress(working);
        }
      }

      if (core.pendingPublicOperations(working).lorebook) {
        try {
          const lorebookPayload = {
            ...preview.lorebook,
            characterIds: working.createdCharacterId ? [working.createdCharacterId] : [],
          };
          const created = await api.createLorebook(lorebookPayload);
          if (!core.cleanId(created?.id)) throw new Error("Lorebook creation returned no valid ID.");
          working = core.createStory({ ...working, createdLorebookId: created.id }, working.createdAt);
          working = appendApplicationLog(working, {
            operation: "create_lorebook", status: "success", stage: "lorebook", resourceIds: { lorebookId: created.id },
          });
          await persistApplicationProgress(working);
        } catch (error) {
          failures.push(`Lorebook: ${core.sanitizeDiagnostic(error, working.privateDocument)}`);
          working = appendApplicationLog(working, {
            operation: "create_lorebook", status: "error", stage: "lorebook", error,
          });
          await persistApplicationProgress(working);
        }
      }

      if (working.createdLorebookId) {
        for (const entry of preview.lorebookEntries) {
          if (!core.pendingPublicOperations(working, [entry.index]).entryIndexes.length) continue;
          try {
            const created = await api.createLorebookEntry(working.createdLorebookId, {
              name: entry.name, description: entry.description, content: entry.content, keys: entry.keys,
            });
            if (!core.cleanId(created?.id)) throw new Error(`Lorebook entry ${entry.index + 1} returned no valid ID.`);
            working = core.createStory({
              ...working,
              createdLorebookEntryIds: { ...working.createdLorebookEntryIds, [entry.index]: created.id },
            }, working.createdAt);
            working = appendApplicationLog(working, {
              operation: "create_lorebook_entry", status: "success", stage: `entry_${entry.index + 1}`,
              resourceIds: { lorebookId: working.createdLorebookId, entryId: created.id },
            });
            await persistApplicationProgress(working);
          } catch (error) {
            failures.push(`Lorebook entry ${entry.index + 1}: ${core.sanitizeDiagnostic(error, working.privateDocument)}`);
            working = appendApplicationLog(working, {
              operation: "create_lorebook_entry", status: "error", stage: `entry_${entry.index + 1}`,
              resourceIds: { lorebookId: working.createdLorebookId }, error,
            });
            await persistApplicationProgress(working);
          }
        }
      }

      if (core.pendingPublicOperations(working).characterAssociation) {
        try {
          await api.associateCharacterWithChat(working.chatId, working.createdCharacterId);
          working = core.createStory({ ...working, characterAssociatedChatId: working.chatId }, working.createdAt);
          working = appendApplicationLog(working, {
            operation: "associate_character", status: "success", stage: "chat", resourceIds: { characterId: working.createdCharacterId, chatId: working.chatId },
          });
          await persistApplicationProgress(working);
        } catch (error) {
          failures.push(`Character association: ${core.sanitizeDiagnostic(error, working.privateDocument)}`);
          working = appendApplicationLog(working, {
            operation: "associate_character", status: "error", stage: "chat", resourceIds: { characterId: working.createdCharacterId, chatId: working.chatId }, error,
          });
          await persistApplicationProgress(working);
        }
      }

      if (core.pendingPublicOperations(working).lorebookAssociation) {
        try {
          await api.associateLorebookWithChat(working.chatId, working.createdLorebookId);
          working = core.createStory({ ...working, lorebookAssociatedChatId: working.chatId }, working.createdAt);
          working = appendApplicationLog(working, {
            operation: "associate_lorebook", status: "success", stage: "chat_metadata", resourceIds: { lorebookId: working.createdLorebookId, chatId: working.chatId },
          });
          await persistApplicationProgress(working);
        } catch (error) {
          failures.push(`Lorebook association: ${core.sanitizeDiagnostic(error, working.privateDocument)}`);
          working = appendApplicationLog(working, {
            operation: "associate_lorebook", status: "error", stage: "chat_metadata", resourceIds: { lorebookId: working.createdLorebookId, chatId: working.chatId }, error,
          });
          await persistApplicationProgress(working);
        }
      }
    } finally {
      state.draft = working;
      state.dirty = false;
      fields.applicationConfirmed.checked = false;
      renderEditor();
      setTab("application");
      setBusy(false);
    }
    if (failures.length) {
      showErrors(["Public-resource application finished partially.", ...failures]);
      toast("Partial result saved. Retry to continue only failed operations.", "error");
    } else {
      toast("Public resources created and associated. Agents remain a separate action.", "success");
    }
  }

  async function copySanitizedReport() {
    const story = readDraft();
    if (!story) return;
    const report = story.applicationLog.map(({ operation, timestamp, status, stage, resourceIds, error, chatId, messageCount, directorUpdated, trackerUpdated }) => ({
      operation, timestamp, status, stage, resourceIds, chatId, messageCount, directorUpdated, trackerUpdated,
      error: core.sanitizeDiagnostic(error, story.privateDocument),
    }));
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      toast("Sanitized report copied.", "success");
    } catch {
      toast("Could not access the clipboard. Export JSON remains available.", "error");
    }
  }

  async function activateCurrent() {
    const draft = readDraft();
    if (!draft) return;
    const validation = core.validateStory(draft);
    if (!draft.chatId) validation.errors.push("Choose a chat to activate this story.");
    const otherActive = state.stories.find((story) => story.id !== draft.id && story.activeChatId === draft.chatId);
    if (otherActive) validation.errors.push(`“${otherActive.name}” is already active in this chat. Deactivate it first.`);
    if (draft.director.connectionId === draft.tracker.connectionId) {
      validation.errors.push("Use an exclusive Director connection instead of sharing it with the tracker.");
    }
    if (validation.errors.length) {
      showErrors(validation.errors);
      return;
    }
    setBusy(true, "Creating agents…");
    try {
      const agents = await api.ensureAgents(draft);
      await api.updateChatActivation(draft.chatId, draft, true);
      const saved = core.createStory({
        ...draft,
        activeChatId: draft.chatId,
        director: { ...draft.director, agentId: agents.director.id },
        tracker: { ...draft.tracker, agentId: agents.tracker.id },
        updatedAt: new Date().toISOString(),
      }, draft.createdAt);
      await storage.saveStory(saved);
      state.stories = await storage.listStories();
      state.draft = saved;
      state.dirty = false;
      renderEditor();
      await refreshTrackerState();
      toast("Story activated. Existing chat agents were preserved.", "success");
    } catch (error) {
      showErrors([error.message || "Activation failed. The chat remains usable."]);
    } finally {
      setBusy(false);
    }
  }

  async function deactivateCurrent() {
    const draft = readDraft();
    if (!draft?.chatId) {
      showErrors(["Choose the chat where this story should be deactivated."]);
      return;
    }
    setBusy(true, "Deactivating…");
    try {
      await api.updateChatActivation(draft.chatId, draft, false);
      const saved = core.createStory({ ...draft, activeChatId: "", updatedAt: new Date().toISOString() }, draft.createdAt);
      await storage.saveStory(saved);
      state.stories = await storage.listStories();
      state.draft = saved;
      state.dirty = false;
      renderEditor();
      toast("Story deactivated. Other agents were preserved.", "success");
    } catch (error) {
      showErrors([error.message || "Could not deactivate this story."]);
    } finally {
      setBusy(false);
    }
  }

  async function refreshTrackerState() {
    const draft = readDraft();
    if (!draft?.chatId) {
      showErrors(["Choose a chat before loading tracker state."]);
      return;
    }
    const container = $('[data-slot="tracker-state"]');
    container.replaceChildren();
    const loading = document.createElement("p");
    loading.textContent = "Loading tracker state…";
    container.appendChild(loading);
    try {
      const gameState = await api.getGameState(draft.chatId);
      const fields = gameState?.playerStats?.customTrackerFields;
      container.replaceChildren();
      if (!Array.isArray(fields) || fields.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "No custom tracker fields saved in this chat yet.";
        container.appendChild(empty);
      } else {
        for (const field of fields) {
          const row = document.createElement("div");
          const name = document.createElement("span");
          const value = document.createElement("strong");
          name.textContent = String(field.name || "Field");
          value.textContent = String(field.value ?? "");
          row.append(name, value);
          container.appendChild(row);
        }
      }
      $('[data-slot="state-anchor"]').textContent = gameState?.messageId
        ? `Message ${String(gameState.messageId).slice(0, 8)} · swipe ${gameState.swipeIndex ?? 0}`
        : "No snapshot";
    } catch (error) {
      container.replaceChildren();
      const message = document.createElement("p");
      message.textContent = error.message || "Could not load tracker state.";
      container.appendChild(message);
    }
  }

  function setBusy(busy, label = "Working…") {
    $$('button, input, select, textarea').forEach((element) => {
      if (!["close", "cancel-analysis"].includes(element.dataset.action)) element.disabled = busy;
    });
    if (busy) toast(label, "info");
  }

  function setAnalyzing(analyzing) {
    setBusy(analyzing, analyzing ? "Analyzing story…" : "");
    const label = $('[data-slot="analyze-label"]');
    if (label) label.textContent = analyzing ? "Analyzing…" : "Analyze story";
  }

  function setTab(tab) {
    const draftBeforeTabChange = readDraft() || state.draft;
    state.activeTab = tab;
    $$('[data-tab]').forEach((button) => button.setAttribute("aria-selected", String(button.dataset.tab === tab)));
    $$('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== tab; });
    if (tab === "initialization") {
      const hasMatchingProposal = state.initializationProposal && state.initializationStoryId === draftBeforeTabChange?.id;
      if (!hasMatchingProposal) renderInitializationProposal(draftBeforeTabChange?.confirmedInitialState, draftBeforeTabChange);
    }
    if (tab === "application") renderApplicationView(draftBeforeTabChange);
    if (tab === "activation") updateDerivedView();
  }

  function openPanel() {
    state.open = true;
    root.classList.add("is-open");
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("nd-body-locked");
    void refreshAll().then(() => $('.nd-shell')?.focus());
  }

  function closePanel() {
    if (state.dirty && !window.confirm("Close and discard unsaved changes?")) return;
    state.open = false;
    api.clearLastAnalysisRawResponse();
    renderRawAnalysisResponse();
    root.classList.remove("is-open");
    root.setAttribute("aria-hidden", "true");
    document.body.classList.remove("nd-body-locked");
    launcher.focus();
  }

  function downloadJson() {
    if (!state.stories.length) {
      toast("Create a story before exporting.", "error");
      return;
    }
    const blob = new Blob([JSON.stringify(core.exportBundle(state.stories), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `narrative-director-stories-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function importJson(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = core.importBundle(parsed);
      const current = new Map(state.stories.map((story) => [story.id, story]));
      for (const story of imported) current.set(story.id, story);
      await storage.replaceStories(Array.from(current.values()));
      state.stories = await storage.listStories();
      state.currentId = imported[0]?.id || state.currentId;
      state.draft = state.stories.find((story) => story.id === state.currentId) || null;
      state.dirty = false;
      renderEditor();
      toast(`Imported ${imported.length} ${imported.length === 1 ? "story" : "stories"}.`, "success");
    } catch (error) {
      toast(error.message || "Import failed.", "error");
    }
  }

  marinara.on(launcher, "click", openPanel);
  marinara.on(root, "click", (event) => {
    const tab = event.target.closest?.("[data-tab]");
    if (tab) return setTab(tab.dataset.tab);
    const story = event.target.closest?.("[data-story-id]");
    if (story) return void selectStory(story.dataset.storyId);
    const action = event.target.closest?.("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "close") closePanel();
    if (action === "new") newStory();
    if (action === "delete") void deleteCurrent();
    if (action === "analyze") void analyzeCurrent();
    if (action === "copy-raw-response") void copyRawAnalysisResponse();
    if (action === "add-private-character") mutatePrivateStructure("add-character");
    if (action === "add-secret") mutatePrivateStructure("add-secret");
    if (action === "add-narrative-arc") mutatePrivateStructure("add-arc");
    if (action === "add-candidate-beat") mutatePrivateStructure("add-beat");
    if (action === "remove-private-character") mutatePrivateStructure("remove-character", Number(event.target.closest("[data-index]").dataset.index));
    if (action === "remove-secret") mutatePrivateStructure("remove-secret", Number(event.target.closest("[data-index]").dataset.index));
    if (action === "remove-narrative-arc") mutatePrivateStructure("remove-arc", Number(event.target.closest("[data-index]").dataset.index));
    if (action === "remove-candidate-beat") mutatePrivateStructure("remove-beat", Number(event.target.closest("[data-index]").dataset.index));
    if (action === "initialize-chat") void initializeExistingChat();
    if (action === "cancel-analysis") cancelInitializationAnalysis();
    if (action === "confirm-initialization") void confirmInitialization();
    if (action === "cancel-initialization") cancelInitialization();
    if (action === "apply-resources") void applyPublicResources();
    if (action === "copy-report") void copySanitizedReport();
    if (action === "activate") void activateCurrent();
    if (action === "deactivate") void deactivateCurrent();
    if (action === "refresh-state") void refreshTrackerState();
    if (action === "export") downloadJson();
    if (action === "import") $('[data-slot="import-file"]').click();
  });
  marinara.on(editor, "submit", (event) => {
    event.preventDefault();
    void saveCurrent();
  });
  marinara.on(editor, "input", (event) => {
    if (event.target?.name?.startsWith("init") && event.target.name !== "initializationConnectionId") {
      if (state.initializationProposal) {
        try { state.initializationProposal = readInitializationEditor(); } catch { /* Keep last valid in-memory review. */ }
      }
      showErrors([]);
      return;
    }
    state.dirty = true;
    updateDerivedView();
    updateApplicationPreview();
    showErrors([]);
  });
  marinara.on($('[data-slot="import-file"]'), "change", (event) => {
    void importJson(event.target.files?.[0]);
    event.target.value = "";
  });
  marinara.on(document, "keydown", (event) => {
    if (!state.open) return;
    if (event.key === "Escape") closePanel();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveCurrent();
    }
  });
  marinara.onCleanup(() => {
    document.body.classList.remove("nd-body-locked");
    api.clearLastAnalysisRawResponse();
    delete globalThis.__narrativeDirectorLoaded;
    delete globalThis.__NarrativeDirectorCore;
    delete globalThis.__NarrativeDirectorStorage;
    delete globalThis.__NarrativeDirectorApi;
  });
})();
