// ──────────────────────────────────────────────
// Promotes graduated Narrative Curator entities into a real, public, activatable lorebook —
// otherwise a revealed secret only lives in the private Curator bible (never read by the
// narrator) and the chat's own summary, which can compress the detail away over a long story.
// ──────────────────────────────────────────────
import type { createLorebooksStorage } from "../storage/lorebooks.storage.js";
import { buildCanonEntryContent, type CuratorGraduatedEntry, type CuratorMemory } from "./curator-runtime.js";

const CANON_LOREBOOK_SUFFIX = " · Curator Canon";

type LorebooksStorage = ReturnType<typeof createLorebooksStorage>;

/**
 * Creates one lorebook entry per newly-graduated secret/storyline, creating the chat's
 * "Curator Canon" lorebook on first use. Returns the memory patch to persist (just
 * canonLorebookId, only when it was newly created) — callers merge this into their own
 * setMemories call rather than this function writing memory itself, so it stays a plain
 * side-effecting helper with one job.
 */
export async function promoteGraduatedToLorebook(
  lorebooks: LorebooksStorage,
  chatId: string,
  chatTitle: string,
  memory: CuratorMemory,
  newlyGraduated: CuratorGraduatedEntry[],
): Promise<{ canonLorebookId?: string }> {
  if (newlyGraduated.length === 0) return {};
  const bible = memory.bible ?? { characters: [], secrets: [], storylines: [], relationships: [] };

  let lorebookId = memory.canonLorebookId ?? null;
  let created = false;
  if (!lorebookId) {
    const lorebook = (await lorebooks.create({
      name: `${chatTitle || "Story"}${CANON_LOREBOOK_SUFFIX}`,
      description: "Facts the Narrative Curator has confirmed are now fully known in the story.",
      category: "world",
      chatId,
      scope: { mode: "specific", chatIds: [chatId] },
      generatedBy: "agent",
    } as Parameters<LorebooksStorage["create"]>[0])) as { id: string } | null;
    if (!lorebook) throw new Error("Failed to create Curator Canon lorebook");
    lorebookId = lorebook.id;
    created = true;
  }

  for (const entry of newlyGraduated) {
    const shaped = buildCanonEntryContent(entry, bible);
    if (!shaped) continue;
    try {
      await lorebooks.createEntry({
        lorebookId,
        name: shaped.name,
        content: shaped.content,
        keys: shaped.keys,
      } as Parameters<LorebooksStorage["createEntry"]>[0]);
    } catch {
      // Non-critical — the fact stays available in the private bible either way, and a
      // failed promotion here should never block the turn that triggered it.
    }
  }

  return created && lorebookId ? { canonLorebookId: lorebookId } : {};
}
