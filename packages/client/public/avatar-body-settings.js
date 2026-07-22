const $ = (id) => document.getElementById(id);
const CSRF_HEADERS = { "x-marinara-csrf": "1" };
const JSON_HEADERS = { ...CSRF_HEADERS, "content-type": "application/json" };
const AXIS_LABELS = ["Entrada", "Âncora", "Saída"];
const ZERO_GRID = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
let config = null;
let selectedKey = "average1:fat100";
let selectedEntry = null;
let selectedPoint = [1, 0];
let previewCache = new Map();
let previewRequest = 0;
let dirty = false;

function message(text, kind = "") {
  $("status").textContent = text;
  $("status").className = `status ${kind}`;
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatWeight(value) {
  return value == null ? "ausente" : Number(value).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function emptyAdjustment() {
  return { min: null, max: null, corrections: structuredClone(ZERO_GRID) };
}

function ensureCell(cell) {
  cell.adjustments ||= { loras: {}, positive: {} };
  cell.adjustments.loras ||= {};
  cell.adjustments.positive ||= {};
}

function ensureAdjustment(cell, kind, name) {
  ensureCell(cell);
  cell.adjustments[kind][name] ||= emptyAdjustment();
  return cell.adjustments[kind][name];
}

function markDirty() {
  dirty = true;
  $("saveButton").textContent = "Salvar alterações";
  message("Alterações locais. Salve para recalcular a superfície.");
}

function bindNumber(input, object, property, rerender = false) {
  input.addEventListener("change", () => {
    object[property] = input.value === "" ? null : numeric(input.value);
    markDirty();
    if (rerender) renderAll();
  });
}

function renderRules() {
  $("sizeRules").innerHTML = "";
  config.sizeRules.forEach((rule) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${escapeHtml(rule.label)}${rule.requiresFatBelowFirstThreshold ? " *" : ""}</td><td><input data-threshold type="number" step="0.1" value="${rule.maxExclusive ?? ""}" ${rule.maxExclusive === null ? "disabled" : ""}></td><td><div class="range-inputs"><input aria-label="Início no slider" type="number" min="0" max="100" step="0.01" value="${rule.control[0]}"><span>–</span><input aria-label="Fim no slider" type="number" min="0" max="100" step="0.01" value="${rule.control[1]}"></div></td>`;
    if (rule.maxExclusive !== null) bindNumber(row.querySelector("[data-threshold]"), rule, "maxExclusive", true);
    const inputs = row.querySelectorAll(".range-inputs input");
    bindNumber(inputs[0], rule.control, 0); bindNumber(inputs[1], rule.control, 1);
    $("sizeRules").append(row);
  });
  $("fatRules").innerHTML = "";
  config.fatRules.forEach((rule) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${escapeHtml(rule.label)}</td><td><input data-threshold type="number" step="0.1" value="${rule.maxExclusive ?? ""}" ${rule.maxExclusive === null ? "disabled" : ""}></td><td><div class="range-inputs"><input aria-label="Início no slider" type="number" min="0" max="100" step="0.01" value="${rule.control[0]}"><span>–</span><input aria-label="Fim no slider" type="number" min="0" max="100" step="0.01" value="${rule.control[1]}"></div></td>`;
    if (rule.maxExclusive !== null) bindNumber(row.querySelector("[data-threshold]"), rule, "maxExclusive", true);
    const inputs = row.querySelectorAll(".range-inputs input");
    bindNumber(inputs[0], rule.control, 0); bindNumber(inputs[1], rule.control, 1);
    $("fatRules").append(row);
  });
}

function renderInterpolation() {
  const labels = {
    isolatedTagPower: "Curva de tag isolada",
    columnTagEntryWeight: "Entrada de tag na coluna",
    extremeTagEntryWeight: "Entrada de tag Extreme",
    loraEntryWeight: "Entrada mínima de LoRA",
    skinnyExitWeight: "Saída da tag skinny",
  };
  $("interpolation").innerHTML = "";
  Object.entries(labels).forEach(([key, label]) => {
    const field = document.createElement("label");
    field.innerHTML = `${label}<input type="number" min="0" max="10" step="0.01" value="${config.interpolation[key]}">`;
    bindNumber(field.querySelector("input"), config.interpolation, key);
    $("interpolation").append(field);
  });
}

function firstEntry(cell) {
  const positive = Object.keys(cell.positive)[0];
  if (positive) return { kind: "positive", name: positive };
  const lora = Object.keys(cell.loras)[0];
  return lora ? { kind: "loras", name: lora } : null;
}

function renderMatrix() {
  const matrix = $("matrix");
  matrix.innerHTML = `<div></div>${config.fatRules.map((rule) => `<div class="matrix-head">${escapeHtml(rule.label)}</div>`).join("")}`;
  config.sizeRules.forEach((size) => {
    matrix.insertAdjacentHTML("beforeend", `<div class="row-head">${escapeHtml(size.label)}</div>`);
    config.fatRules.forEach((fat) => {
      const key = `${size.id}:${fat.id}`;
      const cell = config.cells[key];
      ensureCell(cell);
      const constrained = ["positive", "loras"].some((kind) => Object.values(cell.adjustments[kind]).some((item) => item.min != null || item.max != null || item.corrections.flat().some((value) => value !== 0)));
      const button = document.createElement("button");
      button.className = `cell ${key === selectedKey ? "selected" : ""}`;
      button.innerHTML = `<strong>${escapeHtml(cell.reference.replace(".json", ""))}</strong><small>${Object.keys(cell.positive).length} tags · ${Object.keys(cell.loras).length} LoRAs</small>${cell.status === "derived" ? '<span class="badge warning">derivada</span>' : ""}${constrained ? '<span class="badge">ajustada</span>' : ""}`;
      button.addEventListener("click", () => {
        selectedKey = key; selectedEntry = firstEntry(cell); selectedPoint = [1, key.startsWith("skinny:") ? 1 : 0];
        previewCache = new Map(); renderMatrix(); renderEditor(); requestCellPreviews();
      });
      matrix.append(button);
    });
  });
}

function previewKey(kind, name) {
  return `${selectedKey}|${kind}|${name}`;
}

function entryRows(cell, kind) {
  return Object.entries(cell[kind]).map(([name, anchor]) => {
    const adjustment = ensureAdjustment(cell, kind, name);
    const data = previewCache.get(previewKey(kind, name));
    const active = selectedEntry?.kind === kind && selectedEntry?.name === name;
    return `<div class="entry-row ${active ? "active" : ""}" data-kind="${kind}" data-name="${escapeHtml(name)}">
      <button class="entry-select"><strong>${escapeHtml(name)}</strong><small>${data ? `${formatWeight(data.range.min)} até ${formatWeight(data.range.max)}` : "calculando superfície…"}</small></button>
      <label>Base<input data-field="anchor" type="number" min="-5" max="5" step="0.01" value="${anchor}"></label>
      <label>Piso<input data-field="min" type="number" min="-5" max="5" step="0.01" placeholder="livre" value="${adjustment.min ?? ""}"></label>
      <label>Teto<input data-field="max" type="number" min="-5" max="5" step="0.01" placeholder="livre" value="${adjustment.max ?? ""}"></label>
      <button class="danger remove" aria-label="Remover ${escapeHtml(name)}">×</button>
    </div>`;
  }).join("");
}

function neighborhoodMarkup(data) {
  const cells = data.neighborhood.flatMap((row) => row.map((item) => item
    ? `<div class="neighbor ${item.current ? "current" : ""}"><strong>${escapeHtml(item.reference.replace(".json", ""))}</strong><span class="${item.present ? "" : "absent"}">${item.present ? formatWeight(item.anchor) : "ausente"}</span></div>`
    : '<div class="neighbor outside"><span>fora da matriz</span></div>')).join("");
  return `<div class="axis-title horizontal">Gordura →</div><div class="map-grid neighborhood"><div class="axis-title vertical">Peso ↓</div>${cells}</div>`;
}

function surfaceMarkup(data) {
  const cells = data.surface.flatMap((row, rowIndex) => row.map((point, columnIndex) =>
    `<button class="surface-point ${selectedPoint[0] === rowIndex && selectedPoint[1] === columnIndex ? "selected" : ""}" data-row="${rowIndex}" data-column="${columnIndex}" ${!data.fatAxisEnabled && columnIndex !== 1 ? "disabled" : ""}><span>${data.verticalLabels?.[rowIndex] ?? AXIS_LABELS[rowIndex]} peso<br>${AXIS_LABELS[columnIndex]} gordura</span><strong>${formatWeight(point.value)}</strong></button>`,
  )).join("");
  return `<div class="axis-title horizontal">Gordura →</div><div class="map-grid surface"><div class="axis-title vertical">Peso ↓</div>${cells}</div>${data.fatAxisEnabled ? "" : '<p class="hint">Extremely Skinny ignora o eixo de gordura; somente a coluna central participa.</p>'}`;
}

function traceMarkup(data) {
  const point = data.surface[selectedPoint[0]]?.[selectedPoint[1]] ?? data.surface[1][1];
  const trace = point.trace;
  const verticalSource = trace.vertical.sourceCell
    ? `${trace.vertical.sourceCell} (${trace.vertical.sourcePresent ? formatWeight(trace.vertical.sourceAnchor) : "ausente"})`
    : "âncora da própria célula";
  const horizontalSource = trace.horizontal.sourceCell
    ? `${trace.horizontal.sourceCell} (âncora ${trace.horizontal.sourcePresent ? formatWeight(trace.horizontal.sourceAnchor) : "ausente"}${trace.horizontal.sourceAfterVertical == null ? "" : `, após vertical ${formatWeight(trace.horizontal.sourceAfterVertical)}`})${trace.horizontal.diagonalSourceCell ? `; diagonal ${trace.horizontal.diagonalSourceCell} (${trace.horizontal.diagonalSourceAnchor == null ? "ausente" : formatWeight(trace.horizontal.diagonalSourceAnchor)})` : ""}`
    : "âncora da própria célula";
  const limited = trace.result !== trace.adjusted;
  return `<div class="trace-flow">
    <div><span>1 · Vertical</span><strong>${trace.vertical.direction}</strong><small>${escapeHtml(trace.vertical.rule)}; ${escapeHtml(verticalSource)} → ${formatWeight(trace.vertical.result)}</small></div>
    <div><span>2 · Horizontal</span><strong>${trace.horizontal.direction}</strong><small>${escapeHtml(horizontalSource)} → ${formatWeight(trace.automatic)}</small></div>
    <div><span>3 · Correção</span><strong>${trace.correction >= 0 ? "+" : ""}${formatWeight(trace.correction)}</strong><small>automático ${formatWeight(trace.automatic)} → ${formatWeight(trace.adjusted)}</small></div>
    <div class="${limited ? "limited" : ""}"><span>4 · Piso/teto</span><strong>${formatWeight(trace.result)}</strong><small>${trace.min == null ? "sem piso" : `piso ${formatWeight(trace.min)}`} · ${trace.max == null ? "sem teto" : `teto ${formatWeight(trace.max)}`}</small></div>
  </div>`;
}

function correctionMarkup(cell, data) {
  const adjustment = ensureAdjustment(cell, data.kind, data.name);
  const fields = adjustment.corrections.flatMap((row, rowIndex) => row.map((value, columnIndex) =>
    `<label class="correction-field"><span>${data.verticalLabels?.[rowIndex] ?? AXIS_LABELS[rowIndex]} peso<br>${AXIS_LABELS[columnIndex]} gordura</span><input data-correction-row="${rowIndex}" data-correction-column="${columnIndex}" type="number" min="-5" max="5" step="0.01" value="${value}" ${!data.fatAxisEnabled && columnIndex !== 1 ? "disabled" : ""}></label>`,
  )).join("");
  return `<details class="advanced"><summary>Correções avançadas</summary><p>Valores somados à interpolação automática antes do piso e teto.</p><div class="correction-grid">${fields}</div></details>`;
}

function analysisMarkup(cell) {
  if (!selectedEntry) return '<div class="empty">Adicione uma tag ou LoRA para analisar esta célula.</div>';
  const data = previewCache.get(previewKey(selectedEntry.kind, selectedEntry.name));
  if (!data) return '<div class="skeleton">Calculando mapa bidimensional…</div>';
  return `<div class="analysis-head"><div><span class="eyebrow">${selectedEntry.kind === "loras" ? "LoRA" : "Tag positiva"}</span><h3>${escapeHtml(selectedEntry.name)}</h3></div><div class="range-summary"><span>Faixa automática</span><strong>${formatWeight(data.range.min)} → ${formatWeight(data.range.max)}</strong></div></div>
    <div class="analysis-section"><h4>Âncoras vizinhas</h4><p>Valor zero participa da interpolação. “Ausente” não participa.</p>${neighborhoodMarkup(data)}</div>
    <div class="analysis-section"><h4>Superfície usada pela Engine</h4><p>Clique em um ponto para ver de onde o valor veio.</p>${surfaceMarkup(data)}</div>
    <div class="analysis-section"><h4>Fluxo do ponto selecionado</h4>${traceMarkup(data)}</div>
    ${correctionMarkup(cell, data)}`;
}

function bindEntryRows(cell) {
  $("editor").querySelectorAll(".entry-row").forEach((row) => {
    const kind = row.dataset.kind;
    const name = row.dataset.name;
    const adjustment = ensureAdjustment(cell, kind, name);
    row.querySelector(".entry-select").addEventListener("click", () => {
      selectedEntry = { kind, name }; selectedPoint = [1, selectedKey.startsWith("skinny:") ? 1 : 0]; renderEditor();
    });
    row.querySelector('[data-field="anchor"]').addEventListener("change", (event) => {
      cell[kind][name] = numeric(event.target.value); markDirty();
    });
    ["min", "max"].forEach((field) => row.querySelector(`[data-field="${field}"]`).addEventListener("change", (event) => {
      adjustment[field] = event.target.value === "" ? null : numeric(event.target.value); markDirty(); renderMatrix();
    }));
    row.querySelector(".remove").addEventListener("click", () => {
      if (!confirm(`Remover ${name} desta célula?`)) return;
      delete cell[kind][name]; delete cell.adjustments[kind][name];
      if (selectedEntry?.kind === kind && selectedEntry?.name === name) selectedEntry = firstEntry(cell);
      markDirty(); renderEditor(); renderMatrix(); requestCellPreviews();
    });
  });
}

function renderEditor() {
  const cell = config.cells[selectedKey];
  ensureCell(cell);
  if (!selectedEntry || !Object.hasOwn(cell[selectedEntry.kind], selectedEntry.name)) selectedEntry = firstEntry(cell);
  const [sizeId, fatId] = selectedKey.split(":");
  const size = config.sizeRules.find((rule) => rule.id === sizeId);
  const fat = config.fatRules.find((rule) => rule.id === fatId);
  $("editor").innerHTML = `<div class="editor-head"><div><h2>${escapeHtml(size.label)}</h2><p>${escapeHtml(fat.label)}</p></div><span class="badge ${cell.status === "derived" ? "warning" : ""}">${cell.status === "derived" ? "derivada" : "referência"}</span></div>
    <div class="field-grid"><label>Arquivo / identificação<input id="reference" value="${escapeHtml(cell.reference)}"></label><label>Status<input value="${cell.status}" disabled></label></div>
    <div class="subhead"><h3>Tags positivas</h3><button data-add="positive">Adicionar</button></div><div class="entry-list">${entryRows(cell, "positive")}</div>
    <div class="subhead"><h3>LoRAs</h3><button data-add="loras">Adicionar</button></div><div class="entry-list">${entryRows(cell, "loras")}</div>
    <div class="subhead"><h3>Análise bidimensional</h3></div><div id="analysis">${analysisMarkup(cell)}</div>
    <div class="subhead"><h3>Tags negativas</h3></div><label>Uma por linha<textarea id="negative">${cell.negative.join("\n")}</textarea></label>`;
  $("reference").addEventListener("change", (event) => { cell.reference = event.target.value.trim(); markDirty(); renderMatrix(); });
  $("negative").addEventListener("change", (event) => { cell.negative = event.target.value.split("\n").map((tag) => tag.trim()).filter(Boolean); markDirty(); });
  $("editor").querySelectorAll("[data-add]").forEach((button) => button.addEventListener("click", () => {
    const kind = button.dataset.add;
    const base = kind === "loras" ? "Nova_LoRA" : "nova tag";
    let name = base, suffix = 2;
    while (Object.hasOwn(cell[kind], name)) name = `${base}_${suffix++}`;
    cell[kind][name] = 0; cell.adjustments[kind][name] = emptyAdjustment(); selectedEntry = { kind, name };
    markDirty(); renderEditor(); renderMatrix();
  }));
  bindEntryRows(cell);
  $("analysis")?.querySelectorAll(".surface-point").forEach((button) => button.addEventListener("click", () => {
    selectedPoint = [Number(button.dataset.row), Number(button.dataset.column)]; renderEditor();
  }));
  $("analysis")?.querySelectorAll("[data-correction-row]").forEach((input) => input.addEventListener("change", () => {
    const adjustment = ensureAdjustment(cell, selectedEntry.kind, selectedEntry.name);
    adjustment.corrections[Number(input.dataset.correctionRow)][Number(input.dataset.correctionColumn)] = numeric(input.value);
    markDirty(); renderMatrix();
  }));
}

async function requestCellPreviews() {
  const requestId = ++previewRequest;
  const cellKey = selectedKey;
  const cell = config.cells[cellKey];
  const entries = [
    ...Object.keys(cell.positive).map((name) => ({ kind: "positive", name })),
    ...Object.keys(cell.loras).map((name) => ({ kind: "loras", name })),
  ];
  const results = await Promise.all(entries.map(async (entry) => {
    const response = await fetch("/api/avatars/body-settings/preview", {
      method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ cellKey, ...entry }),
    });
    if (!response.ok) throw new Error(`Falha ao calcular ${entry.name} (${response.status})`);
    return response.json();
  }));
  if (requestId !== previewRequest || cellKey !== selectedKey) return;
  results.forEach((data) => previewCache.set(`${cellKey}|${data.kind}|${data.name}`, data));
  renderEditor();
}

function renderAll() {
  const cell = config.cells[selectedKey] ?? Object.values(config.cells)[0];
  if (!config.cells[selectedKey]) selectedKey = Object.keys(config.cells)[0];
  selectedEntry = firstEntry(cell); previewCache = new Map();
  renderRules(); renderInterpolation(); renderMatrix(); renderEditor();
  void requestCellPreviews().catch((error) => message(error.message, "error"));
}

async function loadSettings() {
  const response = await fetch("/api/avatars/body-settings", { cache: "no-store" });
  if (!response.ok) throw new Error(`Falha ao carregar settings (${response.status})`);
  config = await response.json(); dirty = false; $("saveButton").textContent = "Salvar no Engine";
  renderAll(); message("Valores ativos carregados da Engine.", "ok");
}

$("saveButton").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/avatars/body-settings", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(config) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Falha ao salvar (${response.status})`);
    config = payload; dirty = false; $("saveButton").textContent = "Salvar no Engine"; renderAll();
    message("Configuração ativa. Superfícies recalculadas.", "ok");
  } catch (error) { message(error.message, "error"); }
});

$("resetButton").addEventListener("click", async () => {
  if (!confirm("Restaurar os valores embutidos na Engine?")) return;
  try {
    const response = await fetch("/api/avatars/body-settings", { method: "DELETE", headers: CSRF_HEADERS });
    if (!response.ok) throw new Error(`Falha ao restaurar (${response.status})`);
    config = await response.json(); dirty = false; renderAll(); message("Padrões restaurados e ativados.", "ok");
  } catch (error) { message(error.message, "error"); }
});

$("exportButton").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "marinara-avatar-body-settings.json"; link.click(); URL.revokeObjectURL(link.href);
});

$("importFile").addEventListener("change", async (event) => {
  try {
    const imported = JSON.parse(await event.target.files[0].text());
    const response = await fetch("/api/avatars/body-settings", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(imported) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Falha ao importar (${response.status})`);
    config = payload; dirty = false; renderAll(); message("JSON importado, migrado e ativado.", "ok");
  } catch (error) { message(`JSON inválido: ${error.message}`, "error"); }
});

window.addEventListener("beforeunload", (event) => { if (dirty) event.preventDefault(); });
loadSettings().catch((error) => message(error.message, "error"));
