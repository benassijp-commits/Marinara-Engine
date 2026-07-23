import { z } from "zod";
import type { ChatMode } from "@marinara-engine/shared";

export const CURATOR_TRACKER_TYPE = "narrative-curator-tracker";
export const CURATOR_SCENE_TYPE = "narrative-curator-scene";
export const CURATOR_LOG_MAX_ENTRIES = 200;

const SECRET_STATUSES = ["locked", "hinted", "revealed"] as const;
const STORYLINE_STATUSES = ["inactive", "active", "paused", "completed"] as const;
type SecretStatus = (typeof SECRET_STATUSES)[number];
type StorylineStatus = (typeof STORYLINE_STATUSES)[number];
type CuratorEntityType = "secret" | "storyline" | "relationship" | "character";

// ──────────────────────────────────────────────
// Schemas — bible (static, edited via the panel or seeded by analysis)
// ──────────────────────────────────────────────

// name/title/characterIds are deliberately unconstrained (not .min(1)) — the panel saves
// on every keystroke-adjacent change, so a row being composed (just added, not filled in
// yet) is a normal, valid transient state, not an error.
const curatorCharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  aliases: z.array(z.string()).default([]),
  curatorNotes: z.string().default(""),
});

const curatorSecretSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(""),
  truth: z.string().default(""),
  knownByCharacterIds: z.array(z.string()).default([]),
  revealCondition: z.string().default(""),
  forbiddenTerms: z.array(z.string()).default([]),
});

const curatorStorylineSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(""),
  direction: z.string().default(""),
});

const curatorRelationshipSchema = z.object({
  id: z.string().min(1),
  characterIds: z.array(z.string()).default([]),
  privateSummary: z.string().default(""),
});

const curatorBibleSchema = z.object({
  characters: z.array(curatorCharacterSchema).default([]),
  secrets: z.array(curatorSecretSchema).default([]),
  storylines: z.array(curatorStorylineSchema).default([]),
  relationships: z.array(curatorRelationshipSchema).default([]),
});

export type CuratorBible = z.infer<typeof curatorBibleSchema>;
export type CuratorSecret = z.infer<typeof curatorSecretSchema>;
export type CuratorStoryline = z.infer<typeof curatorStorylineSchema>;
export type CuratorRelationship = z.infer<typeof curatorRelationshipSchema>;
export type CuratorCharacter = z.infer<typeof curatorCharacterSchema>;

// ──────────────────────────────────────────────
// Schemas — live state (one entry per tracked entity, keyed "type:id")
// ──────────────────────────────────────────────

const curatorEntityStateSchema = z.object({
  status: z.string().optional(),
  disposition: z.string().optional(),
  driftNote: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type CuratorEntityState = z.infer<typeof curatorEntityStateSchema>;

const curatorLogEntrySchema = z.object({
  ts: z.string(),
  entityType: z.enum(["secret", "storyline", "relationship", "character"]),
  entityId: z.string(),
  field: z.string(),
  from: z.unknown(),
  to: z.unknown(),
});

export type CuratorLogEntry = z.infer<typeof curatorLogEntrySchema>;

const curatorGraduatedEntrySchema = z.object({
  entityType: z.enum(["secret", "storyline"]),
  entityId: z.string(),
  graduatedAt: z.string(),
});

export type CuratorGraduatedEntry = z.infer<typeof curatorGraduatedEntrySchema>;

/** Full shape of the narrative-curator-tracker agentMemory blob. Every key optional — patches are partial. */
export const curatorMemoryPatchSchema = z.object({
  bible: curatorBibleSchema.partial().optional(),
  state: z.record(z.string(), curatorEntityStateSchema).optional(),
  log: z.array(curatorLogEntrySchema).optional(),
  graduated: z.array(curatorGraduatedEntrySchema).optional(),
  enabled: z.boolean().optional(),
});

export type CuratorMemory = {
  bible?: CuratorBible;
  state?: Record<string, CuratorEntityState>;
  log?: CuratorLogEntry[];
  graduated?: CuratorGraduatedEntry[];
  enabled?: boolean;
};

/** What the Tracker agent is allowed to report back per turn — deliberately just "what is true now". */
export const curatorTrackerReportSchema = z.object({
  secrets: z
    .record(
      z.string(),
      z.object({ status: z.enum(SECRET_STATUSES).optional(), knownByCharacterIds: z.array(z.string()).optional() }),
    )
    .optional(),
  storylines: z
    .record(z.string(), z.object({ status: z.enum(STORYLINE_STATUSES).optional(), driftNote: z.string().optional() }))
    .optional(),
  relationships: z.record(z.string(), z.object({ disposition: z.string().optional() })).optional(),
  characters: z.record(z.string(), z.object({ disposition: z.string().optional() })).optional(),
  // id is never sent for new entities — applyCuratorTrackerReport generates it server-side
  // and never reads raw.id, so it must be optional here too, not just the other fields.
  newSecrets: z.array(curatorSecretSchema.partial({ id: true, forbiddenTerms: true, revealCondition: true })).optional(),
  newStorylines: z.array(curatorStorylineSchema.partial({ id: true })).optional(),
});

export type CuratorTrackerReport = z.infer<typeof curatorTrackerReportSchema>;

// ──────────────────────────────────────────────
// Enabled / gating
// ──────────────────────────────────────────────

export function resolveCuratorEnabled(
  settings: Record<string, unknown>,
  chatMeta: Record<string, unknown>,
  chatMode: ChatMode,
): boolean {
  if (chatMode !== "roleplay") return false;
  if (typeof chatMeta.narrativeCuratorEnabled === "boolean") return chatMeta.narrativeCuratorEnabled;
  return settings.curatorEnabled === true;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function entityKey(type: CuratorEntityType, id: string): string {
  return `${type}:${id}`;
}

function randomEntityId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Active (non-graduated) bible — what both agents are allowed to see. */
function activeBible(memory: CuratorMemory): CuratorBible {
  const bible = memory.bible ?? { characters: [], secrets: [], storylines: [], relationships: [] };
  const graduatedIds = new Set((memory.graduated ?? []).map((g) => entityKey(g.entityType, g.entityId)));
  return {
    characters: bible.characters ?? [],
    secrets: (bible.secrets ?? []).filter((s) => !graduatedIds.has(entityKey("secret", s.id))),
    storylines: (bible.storylines ?? []).filter((s) => !graduatedIds.has(entityKey("storyline", s.id))),
    relationships: bible.relationships ?? [],
  };
}

/**
 * What the Tracker sees: the bible only, never the live state. The Tracker's job is to
 * independently re-derive current truth from the transcript every turn — the diffing in
 * applyCuratorTrackerReport already handles "is this actually a change" deterministically,
 * so the model doesn't need last turn's recorded state to do its job. Showing it anyway
 * biases the model toward treating the prior state as an established record to preserve
 * rather than something to re-check from scratch, which is exactly backwards for an agent
 * whose whole purpose is continuous re-verification against the bible's direction.
 */
export function buildTrackerPromptState(memory: CuratorMemory): Record<string, unknown> {
  const bible = activeBible(memory);
  if (!bible.characters.length && !bible.secrets.length && !bible.storylines.length && !bible.relationships.length) {
    return {};
  }
  return { bible };
}

/**
 * What the Scene Curator sees: bible + live state. Unlike the Tracker, the Scene Curator's
 * job is to summarize the CURRENT state into a narrator-facing cue, so it needs the state —
 * there is nothing for it to "re-derive", it is reporting what is already tracked.
 */
export function buildScenePromptState(memory: CuratorMemory): Record<string, unknown> {
  const bible = activeBible(memory);
  if (!bible.characters.length && !bible.secrets.length && !bible.storylines.length && !bible.relationships.length) {
    return {};
  }
  const state = memory.state ?? {};
  return {
    bible,
    state: Object.fromEntries(
      Object.entries(state).filter(([key]) => {
        const [type, id] = key.split(":", 2);
        if (type === "secret") return bible.secrets.some((s) => s.id === id);
        if (type === "storyline") return bible.storylines.some((s) => s.id === id);
        if (type === "relationship") return bible.relationships.some((r) => r.id === id);
        return true;
      }),
    ),
  };
}

// ──────────────────────────────────────────────
// Deterministic diff + log — the model reports current truth, code decides what's a change
// ──────────────────────────────────────────────

export interface ApplyCuratorReportResult {
  memory: CuratorMemory;
  changedCount: number;
}

/**
 * Applies a Tracker report on top of stored memory. Every comparison happens here, in code —
 * the agent never decides "is this worth logging", it only reports what it currently believes
 * to be true for the entities it touched.
 */
export function applyCuratorTrackerReport(memory: CuratorMemory, report: CuratorTrackerReport): ApplyCuratorReportResult {
  const bible: CuratorBible = memory.bible ?? { characters: [], secrets: [], storylines: [], relationships: [] };
  const state: Record<string, CuratorEntityState> = { ...(memory.state ?? {}) };
  const log: CuratorLogEntry[] = [...(memory.log ?? [])];
  const graduated: CuratorGraduatedEntry[] = [...(memory.graduated ?? [])];
  let changedCount = 0;

  const applyField = (type: CuratorEntityType, id: string, field: string, nextValue: unknown) => {
    if (nextValue === undefined) return;
    const key = entityKey(type, id);
    const current = state[key] ?? {};
    const currentValue = (current as Record<string, unknown>)[field];
    if (currentValue === nextValue) return;
    state[key] = { ...current, [field]: nextValue, updatedAt: nowIso() };
    log.push({ ts: nowIso(), entityType: type, entityId: id, field, from: currentValue ?? null, to: nextValue });
    if (log.length > CURATOR_LOG_MAX_ENTRIES) log.splice(0, log.length - CURATOR_LOG_MAX_ENTRIES);
    changedCount++;
  };

  const graduate = (type: "secret" | "storyline", id: string) => {
    const key = entityKey(type, id);
    if (!graduated.some((g) => entityKey(g.entityType, g.entityId) === key)) {
      graduated.push({ entityType: type, entityId: id, graduatedAt: nowIso() });
    }
    // Graduated entities move to the graduated list exclusively — leaving the old entry in
    // `state` would show them as still "active" alongside the graduated record.
    delete state[key];
  };

  const knownIds = {
    secret: new Set(bible.secrets.map((s) => s.id)),
    storyline: new Set(bible.storylines.map((s) => s.id)),
    relationship: new Set(bible.relationships.map((r) => r.id)),
    character: new Set(bible.characters.map((c) => c.id)),
  };

  for (const [id, patch] of Object.entries(report.secrets ?? {})) {
    if (!knownIds.secret.has(id)) continue;
    if (patch.status !== undefined) applyField("secret", id, "status", patch.status);
    if (patch.knownByCharacterIds !== undefined) {
      const secretIndex = bible.secrets.findIndex((s) => s.id === id);
      if (secretIndex >= 0) bible.secrets[secretIndex] = { ...bible.secrets[secretIndex]!, knownByCharacterIds: patch.knownByCharacterIds };
    }
    // Automatic graduation: a secret revealed to everyone relevant retires from active tracking.
    if (patch.status === "revealed") graduate("secret", id);
  }

  for (const [id, patch] of Object.entries(report.storylines ?? {})) {
    if (!knownIds.storyline.has(id)) continue;
    if (patch.status !== undefined) applyField("storyline", id, "status", patch.status);
    if (patch.driftNote !== undefined) {
      applyField("storyline", id, "driftNote", patch.driftNote);
      // A driftNote means the Tracker is actively following this storyline against a
      // scene — don't rely on the model to also remember to flip status separately.
      const currentStatus = state[entityKey("storyline", id)]?.status;
      if (patch.status === undefined && (!currentStatus || currentStatus === "inactive")) {
        applyField("storyline", id, "status", "active");
      }
    }
    if (patch.status === "completed") graduate("storyline", id);
  }

  for (const [id, patch] of Object.entries(report.relationships ?? {})) {
    if (!knownIds.relationship.has(id)) continue;
    if (patch.disposition !== undefined) applyField("relationship", id, "disposition", patch.disposition);
  }

  for (const [id, patch] of Object.entries(report.characters ?? {})) {
    if (!knownIds.character.has(id)) continue;
    if (patch.disposition !== undefined) applyField("character", id, "disposition", patch.disposition);
  }

  for (const raw of report.newSecrets ?? []) {
    const title = raw.title?.trim();
    if (!title || bible.secrets.some((s) => s.title.trim().toLowerCase() === title.toLowerCase())) continue;
    const id = randomEntityId("secret");
    bible.secrets.push({
      id,
      title,
      truth: raw.truth ?? "",
      knownByCharacterIds: (raw.knownByCharacterIds ?? []).filter((cid) => knownIds.character.has(cid)),
      revealCondition: raw.revealCondition ?? "",
      forbiddenTerms: raw.forbiddenTerms ?? [],
    });
    log.push({ ts: nowIso(), entityType: "secret", entityId: id, field: "created", from: null, to: title });
    changedCount++;
  }

  for (const raw of report.newStorylines ?? []) {
    const title = raw.title?.trim();
    if (!title || bible.storylines.some((s) => s.title.trim().toLowerCase() === title.toLowerCase())) continue;
    const id = randomEntityId("storyline");
    bible.storylines.push({ id, title, direction: raw.direction ?? "" });
    log.push({ ts: nowIso(), entityType: "storyline", entityId: id, field: "created", from: null, to: title });
    changedCount++;
  }

  if (log.length > CURATOR_LOG_MAX_ENTRIES) log.splice(0, log.length - CURATOR_LOG_MAX_ENTRIES);

  return { memory: { ...memory, bible, state, log, graduated }, changedCount };
}

// ──────────────────────────────────────────────
// Scene Curator output — deterministic backstop against literal secret vocabulary leaking
// ──────────────────────────────────────────────

const REDACTION_PLACEHOLDER = "something";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strips literal occurrences of still-hidden secret vocabulary (title + configured
 * forbidden terms) from the Scene Curator's output before it is allowed to become a
 * narrator-facing injection. This is a backstop, not the primary mechanism — the prompt
 * itself is instructed to never write these terms in the first place.
 */
export function scrubForbiddenTerms(text: string, memory: CuratorMemory): string {
  if (!text.trim()) return text;
  const bible = memory.bible ?? { characters: [], secrets: [], storylines: [], relationships: [] };
  const state = memory.state ?? {};
  let result = text;
  for (const secret of bible.secrets ?? []) {
    const status = state[entityKey("secret", secret.id)]?.status ?? "locked";
    if (status === "revealed") continue;
    const terms = [secret.title, ...(secret.forbiddenTerms ?? [])].map((t) => t.trim()).filter((t) => t.length > 2);
    for (const term of terms) {
      const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi");
      result = result.replace(pattern, REDACTION_PLACEHOLDER);
    }
  }
  return result;
}

// ──────────────────────────────────────────────
// Default prompts for auto-seeding (see agents.routes.ts getOrCreateConfigByType call sites)
// ──────────────────────────────────────────────

export const CURATOR_TRACKER_PROMPT = [
  "You are the Continuity Tracker for a private story bible. You never write narration and nothing you return is ever shown to the narrator directly.",
  "You will find the current bible and live state in a <Curator Tracker State> block in your context (bible: characters/secrets/storylines/relationships; state: current status/disposition per entity, keyed \"type:id\").",
  "Before writing your output, go through every single character, secret, storyline, and relationship listed in the bible one at a time — not just whichever ones are most salient in the last message. For each one, check it against the chat summary and recent messages: has anything about it actually changed? Most will not have changed; that is expected. Do not stop checking early just because you already found one or two changes.",
  "The chat summary usually covers a long span of story, not just the current scene. Give facts established early in the summary the same weight as facts from its most recent section — do not let the latest events crowd out something confirmed earlier that simply never got reported yet. Catching up on an old, still-unreported development is exactly your job, just as much as noticing something from this exact turn.",
  "Using the chat summary and the most recent messages, report ONLY what the transcript now confirms as true — never what a character merely suspects, hints at, or plans. Do not reason about what should stay hidden; that is a different agent's job.",
  "For every secret/storyline/relationship/character whose status or disposition actually changed, include it in your JSON output under the matching key with the new value only. Leave untouched entities out entirely — you report facts, the system decides what counts as a change.",
  "When a storyline's direction or a relationship's development establishes that a character now feels or behaves differently going forward (a jealousy resolved, a new attachment, a shift in loyalty or priority), also report that under characters for every character it affects — the storyline or relationship progressing is not itself a character's behavior, translate what it now means for the people living it. This is easy to skip; check for it deliberately.",
  "If two or more characters in the scene agree, explicitly or implicitly, to keep something from another character, or a hidden condition is newly established, add it to newSecrets (title + truth + who currently knows). If a new ongoing thread of consequence starts, add it to newStorylines (title + direction). Only do this when the transcript actually establishes it — never invent secrets that were not shown.",
  "A secret's status becomes \"revealed\" only once every character who matters to it, and not just one, has openly learned it in the story. A storyline's status becomes \"completed\" only once its direction has actually played out. Both are permanent — once revealed or completed, never move a status backward.",
  "The bible and the chat summary are the established, confirmed truth of the story so far. The handful of most recent messages show only the current moment's surface action, not permission to contradict something already established. If recent messages seem to lean against a fact or shift already confirmed in the summary, trust the summary.",
  "For each active storyline, optionally set driftNote to one short, neutral sentence noting whether recent scenes are moving toward, away from, or unrelated to its direction. Leave it unset when there is nothing meaningful to say — do not write a note every turn just to have one.",
  "Return ONLY a JSON object in exactly this shape — flat entity ids as keys nested under each category, never the \"type:id\" combined-key format used by the <Curator Tracker State> block you read, that format is for input, not output:",
  '{"secrets":{"<secret-id>":{"status":"hinted","knownByCharacterIds":["<character-id>"]}},"storylines":{"<storyline-id>":{"status":"active","driftNote":"one short sentence"}},"relationships":{"<relationship-id>":{"disposition":"one short phrase"}},"characters":{"<character-id>":{"disposition":"one short phrase"}},"newSecrets":[{"title":"","truth":"","knownByCharacterIds":[],"revealCondition":"","forbiddenTerms":[]}],"newStorylines":[{"title":"","direction":""}]}',
  "Every key in that shape is optional — include only the categories and entity ids that actually changed this turn, omit the rest entirely. No prose, no commentary, no markdown fences, nothing outside this one JSON object.",
].join("\n");

export const CURATOR_SCENE_PROMPT = [
  "You are the Scene Curator. You set the information and emotional state characters carry INTO the next scene — you never write the scene, decide {{user}}'s actions/thoughts/words, or narrate events happening off-page.",
  "You will find the tracked bible and state in a <Curator Tracker State> block in your context. Only consider entities involving a character who is actually present in the most recent messages — ignore everything else in that block, even if it is technically there.",
  "For each relevant character, write at most one short line naming their current internal disposition, feeling, or condition — never a specific physical action, gesture, or movement. Do not write what a character's body is doing right now (no \"grips\", \"wipes\", \"clenches\", \"stares\", \"shifts\", \"grabs\", or any other action verb describing a deliberate motion) — that is staging, and staging belongs to the narrator, not you. Name the state a narrator could stage however it wants, not a scripted motion.",
  "A character who already knows something they must not reveal gets a line about their internal composure (stays composed, keeps the facade, on edge but silent) — never a line naming what they're hiding, and never a physical tell described as an action.",
  "A character's disposition in the state block reflects everything established about them so far — trust it as their real current baseline even if the last message or two seems to lean a different way. The immediate scene is one moment; the tracked disposition is who they actually are right now. When the two conflict, write toward the tracked disposition, not the passing moment.",
  "Example of the difference: instead of \"Robert grips his desk, hands shaking, as pheromones cloud his judgment\", write \"Robert feels his composure slipping, unable to place why.\" Instead of \"Amon confirms the serum is working\", write nothing about Amon's private assessment at all unless a present character would actually perceive it.",
  "If, and only if, a storyline's driftNote in the state block signals real drift from its intended direction, you may add one additional short organic line nudging the scene back — never phrased as an instruction to the narrator or a meta comment, just a subtle circumstance or mood shift.",
  "Never use a secret's own title or any of its forbidden terms, revealed or not — describe effects, never causes.",
  "Return ONLY the short lines, one per line, no headers, no labels, no JSON, no markdown, no explanation of your reasoning.",
].join("\n");
