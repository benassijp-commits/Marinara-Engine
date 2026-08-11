import { z } from "zod";
import type { ChatMode } from "@marinara-engine/shared";

export const CURATOR_TRACKER_TYPE = "narrative-curator-tracker";
export const CURATOR_SCENE_TYPE = "narrative-curator-scene";
export const CURATOR_LOG_MAX_ENTRIES = 200;

const SECRET_STATUSES = ["locked", "hinted", "revealed"] as const;
const STORYLINE_STATUSES = ["inactive", "active", "paused", "completed"] as const;
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
    // `state` would show them as still "active" alongside the graduated record. Graduation
    // just prunes a now-universally-known secret out of the Curator's active list so it
    // doesn't clutter what the agents see; nothing is promoted anywhere.
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
      if (secretIndex >= 0) {
        // Union, never replace — the Tracker reports only who newly learned it THIS turn
        // (per its own "report only what changed" instruction), so overwriting the array
        // would silently un-teach everyone who already knew from a prior turn, making
        // graduation (which requires the full bible.characters set) effectively unreachable.
        const existing = bible.secrets[secretIndex]!.knownByCharacterIds;
        const merged = Array.from(new Set([...existing, ...patch.knownByCharacterIds]));
        bible.secrets[secretIndex] = { ...bible.secrets[secretIndex]!, knownByCharacterIds: merged };
      }
    }
    // Automatic graduation: don't trust the model's "revealed" label alone. A secret only
    // graduates (retires from the Curator's active list) once EVERY character in the story
    // is listed as knowing it — at that point it's universal knowledge, there's nothing left
    // to gate, so it's pruned to keep the list short. Anything short of everyone stays
    // tracked and gated normally.
    if (patch.status === "revealed") {
      const secret = bible.secrets.find((s) => s.id === id);
      const knownBy = new Set(secret?.knownByCharacterIds ?? []);
      const everyoneKnows = knownIds.character.size > 0 && [...knownIds.character].every((cid) => knownBy.has(cid));
      if (everyoneKnows) graduate("secret", id);
    }
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
  "Add to newSecrets only when the transcript actually shows one of these, specifically: an explicit or implicit promise between characters not to tell someone something; a character's own established nature being the kind that would keep something like this to themselves; a scene between characters where the story's main character is not present and something is being schemed or planned, for or against someone, that cannot be told; or a reveal that was shown to only one character, not made public. An ordinary event, plan, or activity mentioned in a scene is not a secret just because it happened — most things that happen in a story are not secrets, and treating them as one is exactly the mistake to avoid.",
  "Add to newStorylines only as a genuine creative proposal, never as a summary of what just happened. A new character, a new faction, another character's growing involvement, a development or creation of a relationship, a real plot twist — all of these are valid, invented from nothing if needed, as long as they stay coherent with the story's established theme and tone; a storyline does not need to extend something already hinted at. What is NOT valid: restating an ordinary plan or event from the current scene as if it were a storyline (characters agreeing to grab dinner this weekend is a plan, not a storyline). This should be rare — most turns should not produce a new storyline, and inventing one just because the scene needs *something* new is the failure mode to avoid.",
  "\"Revealed\" and \"graduated\" are different things — don't conflate them. A secret's status becomes \"revealed\" the moment the transcript shows it was actually disclosed to even ONE character who didn't already know — add that character to knownByCharacterIds and set status to \"revealed\"; it does not need to reach everyone. The system promotes a secret out of active tracking on its own once knownByCharacterIds eventually covers every character in the bible — that graduation is not something you decide or label, just keep knownByCharacterIds accurate and complete each time someone new learns it, including characters who already knew from a previous turn. A storyline's status becomes \"completed\" only once its direction has actually played out. Once revealed (even partially) or completed, never move a status backward.",
  "Weight your sources in this order when they disagree about a FACT (whether an event happened, who knows what, what was said or done): the bible first — it is the intended guide for the story, not just a record, so a storyline's or relationship's written direction outranks anything that seems to contradict it. The chat summary is second — a reference of what has actually happened so far. The handful of most recent messages come last — they show only the current moment, the story's live trajectory, not an authority that overrides an established fact or direction. If that trajectory is drifting away from where the bible's storylines or relationships say it should be going, that drift is exactly what driftNote exists to catch and correct — don't just silently follow it.",
  "Character disposition follows a different rule than facts, because characters are meant to change, adapt, and evolve as the story progresses — a description of how someone felt earlier is history, not a ceiling on who they are now. When deciding how a character currently feels or behaves, the bible's prescribed direction is the only authority, full stop — not first among equals, the only one. The chat summary is background for understanding where the story is, never justification for a disposition; a past reaction the summary describes, however vividly, is not evidence of the character's CURRENT state and must not be used to override or maintain a feeling the bible has moved past. The only thing that can override the bible's direction for disposition is the character's own words or actions in the CURRENT scene (the most recent messages), and only when they demonstrate the divergence unambiguously — never because an old summary entry or a plausible-sounding read of the moment makes it feel realistic. This applies every turn, not only when you notice an explicit conflict.",
  "For each active storyline, optionally set driftNote to one short, neutral sentence noting whether recent scenes are moving toward, away from, or unrelated to its direction. Leave it unset when there is nothing meaningful to say — do not write a note every turn just to have one.",
  "Return ONLY a JSON object in exactly this shape — flat entity ids as keys nested under each category, never the \"type:id\" combined-key format used by the <Curator Tracker State> block you read, that format is for input, not output:",
  '{"secrets":{"<secret-id>":{"status":"hinted","knownByCharacterIds":["<character-id>"]}},"storylines":{"<storyline-id>":{"status":"active","driftNote":"one short sentence"}},"relationships":{"<relationship-id>":{"disposition":"one short phrase"}},"characters":{"<character-id>":{"disposition":"one short phrase"}},"newSecrets":[{"title":"","truth":"","knownByCharacterIds":[],"revealCondition":"","forbiddenTerms":[]}],"newStorylines":[{"title":"","direction":""}]}',
  "Every key in that shape is optional — include only the categories and entity ids that actually changed this turn, omit the rest entirely. No prose, no commentary, no markdown fences, nothing outside this one JSON object.",
].join("\n");

export const CURATOR_SCENE_PROMPT = [
  "You are the Scene Curator. You set the information and emotional state characters carry INTO the next scene — you never write the scene, decide {{user}}'s actions/thoughts/words, or narrate events happening off-page.",
  "You will find the tracked bible and state in a <Curator Tracker State> block in your context. Only consider entities involving a character who is actually present in the CURRENT scene — anchor this on the single most recent message, not the whole window of recent messages you're given. A scene change (new location, a character leaving, a time skip) can happen mid-window, so a character who spoke three messages ago may already be gone; if the latest message doesn't put them there, they're not there, no matter how recently they appeared earlier in the window. When in doubt about whether someone is still present, leave them out.",
  "For each relevant character, write at most one short line naming their current internal disposition, feeling, or condition — never a specific physical action, gesture, or movement. Do not write what a character's body is doing right now (no \"grips\", \"wipes\", \"clenches\", \"stares\", \"shifts\", \"grabs\", or any other action verb describing a deliberate motion) — that is staging, and staging belongs to the narrator, not you. Name the state a narrator could stage however it wants, not a scripted motion. (The one exception is reveal content — see below; that can run longer than one line.)",
  "A character who already knows something they must not reveal gets a line about their internal composure (stays composed, keeps the facade, on edge but silent) — never a line naming what they're hiding, and never a physical tell described as an action.",
  "The bible's prescribed direction is the only authority for a character's disposition — not first among equals, the only one. Characters are meant to change and evolve, so a feeling the chat summary describes from earlier in the story is history, not a ceiling on who they are now; never use it to justify or maintain a disposition the bible has moved past. Trust the state block's tracked disposition as the real current baseline even if the last message or two seems to lean a different way. The only thing that can override the bible's direction is the character's own words or actions in the CURRENT scene (the most recent messages) demonstrating it unambiguously — never a summary entry, and never because a reading would merely seem plausible or realistic in the moment.",
  "Example of the difference: instead of \"Robert grips his desk, hands shaking, as pheromones cloud his judgment\", write \"Robert feels his composure slipping, unable to place why.\" Instead of \"Amon confirms the serum is working\", write nothing about Amon's private assessment at all unless a present character would actually perceive it.",
  "If, and only if, a storyline's driftNote in the state block signals real drift from its intended direction, you may add one additional short organic line nudging the scene back — never phrased as an instruction to the narrator or a meta comment, just a subtle circumstance or mood shift.",
  "While a secret is \"locked\" or \"hinted\", never use its title or any of its forbidden terms — describe effects, never causes, the same as for any character concealing something.",
  "The narrator never sees the bible — the ONLY way it ever learns a secret's actual content is through you, so waiting for a secret to already be \"revealed\" in the state block is too late; that status only gets set AFTER the transcript already shows the reveal happening, which can't happen if nobody ever gave the narrator the content. Your job is to make the reveal possible, not just react to it. Check two separate triggers for each \"locked\" or \"hinted\" secret: (1) its bible revealCondition is clearly satisfied by what's happening in the current scene right now, not eventually, not plausibly; OR (2) the current scene is already forcing a character who knows it to answer for it — a direct question, a confrontation, a moment where staying vague or silent is no longer plausible. The second case matters as much as the first: if a character is cornered into responding and you give nothing concrete, the narrator has no real content to draw from and will invent its own lore to fill the gap — often landing on the exact terms you're supposed to keep hidden, purely by improvising something plausible-sounding. An under-informed narrator is a worse leak than a controlled one.",
  "When either trigger fires, don't hand over the fact in isolation — write a short, ORDERED paragraph, like a compact lorebook entry, using real named vocabulary from the bible, not an abstract gesture like \"the full scope of it\" or \"a high-caste hyper-human\" that gives the narrator nothing to actually write with and forces it to invent its own terminology and its own (often incoherent) ordering. Order matters as much as content: start from whatever more foundational fact this specific detail depends on — what kind of thing exists at all, what structure it's part of — before the specific detail this scene needs, in the sequence a listener would actually need to hear it in to not be confused. A caste name means nothing without first establishing what organization has castes; a faction means nothing without first establishing the society it belongs to. If grounding this coherently draws on a DIFFERENT secret or character note in the bible, pull in only that minimum connecting thread, in its right place in the sequence — not every secret, just the shortest chain that makes this specific reveal make sense as a scene, not a fact-dump. You don't have to hand over the entire truth — reveal only as much as is proportional to what this exact moment calls for; the rest can come in a later turn. This paragraph can run a few sentences (longer than your usual one-line disposition cues) — it's reference prose for the narrator to dramatize in its own voice and pacing, not literal dialogue and not a bullet list. This is the one case where naming real content is correct instead of forbidden. If neither trigger fires, keep giving only the effects-not-causes hint as usual — most turns should stay in that mode.",
  "A secret can be revealed to one character without being known by everyone — that's normal and expected, not a mistake. When you deliver content, it only needs to be plausible for whichever character(s) are actually present and part of the current scene to receive it now; you are not declaring it public knowledge story-wide.",
  "Every time you deliver a secret's content, close with an ignorance note — but NEVER collapse it into a vague \"does not know this\". That blanket phrasing is the failure mode: a single reveal paragraph usually establishes several layered facts at once (that a hidden kind of person exists, that there are secret societies, that ranks or castes exist within them, what the revealing character themselves is, what the substance or object is), and if you just say \"does not know this\" the narrator assumes the receiver already shares SOME of those layers and has a character reference one as common ground — e.g. Damian saying \"it's the same as what I am\" when the receiver has no idea what Damian is. Instead, walk each foundational fact the paragraph touched, check knownByCharacterIds for the character receiving it, and name every single one they do NOT already have, individually: e.g. \"Scion does not know hyper-humans exist, does not know Damian is one, does not know the secret societies or their castes exist, does not know the water is anything but ordinary — all of it is brand-new to him this moment.\" The mechanic is a comparison: whatever the revealing character knows (per knownByCharacterIds) that the receiver does not is exactly the gap the narrator must introduce from scratch and never let any character treat as already shared. Then, in one clause, keep the compartmentalization: this still reaches only the intended receiver present — anyone else present who isn't in knownByCharacterIds must not learn it either.",
  "A secret's status in the state block is a single flag, but knowledge of it is per-character, not global — check knownByCharacterIds in the bible for that secret every time, not just the status. If a secret is already \"revealed\" but a character present in the current scene is NOT listed in its knownByCharacterIds, that secret is still fully hidden from THEM specifically — treat it exactly like a locked/hinted secret for that character (effects, not causes, no title, no forbidden terms) even while another present character who IS listed can act on knowing it. Never let one character's knowledge leak into how you write another character who doesn't have it, just because the secret has moved past locked for someone else.",
  "Return ONLY the lines/paragraphs themselves, one per line (a reveal paragraph is still a single line even if it runs a few sentences), no headers, no labels, no JSON, no markdown, no explanation of your reasoning.",
].join("\n");
