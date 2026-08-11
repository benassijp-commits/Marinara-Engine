// ──────────────────────────────────────────────
// Panel: Narrative Curator (native, replaces the extensions/narrative-director extension)
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Sparkles, History, BookOpen, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { useChatStore } from "../../stores/chat.store";
import {
  useAgentConfigs,
  useAgentMemory,
  useAgentSuiteRewrite,
  useApplyCuratorReport,
  useUpdateAgent,
  useUpdateAgentMemory,
} from "../../hooks/use-agents";
import { useUpdateChatMetadata } from "../../hooks/use-chats";
import { useConnections } from "../../hooks/use-connections";
import { cn } from "../../lib/utils";

const CURATOR_TRACKER_TYPE = "narrative-curator-tracker";
const CURATOR_SCENE_TYPE = "narrative-curator-scene";

interface CuratorCharacter {
  id: string;
  name: string;
  aliases: string[];
  curatorNotes: string;
}
interface CuratorSecret {
  id: string;
  title: string;
  truth: string;
  knownByCharacterIds: string[];
  revealCondition: string;
  forbiddenTerms: string[];
}
interface CuratorStoryline {
  id: string;
  title: string;
  direction: string;
}
interface CuratorRelationship {
  id: string;
  characterIds: string[];
  privateSummary: string;
}
interface CuratorBible {
  characters: CuratorCharacter[];
  secrets: CuratorSecret[];
  storylines: CuratorStoryline[];
  relationships: CuratorRelationship[];
}
interface CuratorEntityState {
  status?: string;
  disposition?: string;
  driftNote?: string;
  updatedAt?: string;
}
interface CuratorLogEntry {
  ts: string;
  entityType: string;
  entityId: string;
  field: string;
  from: unknown;
  to: unknown;
}
interface CuratorGraduatedEntry {
  entityType: string;
  entityId: string;
  graduatedAt: string;
}

const EMPTY_BIBLE: CuratorBible = { characters: [], secrets: [], storylines: [], relationships: [] };
const SECRET_STATUS_OPTIONS = ["locked", "hinted", "revealed"] as const;
const STORYLINE_STATUS_OPTIONS = ["inactive", "active", "paused", "completed"] as const;

function randomId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseChatMetadata(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) ?? {};
    } catch {
      return {};
    }
  }
  return (raw as Record<string, unknown>) ?? {};
}

const ANALYSIS_INSTRUCTION = [
  "Transform the supplied fictional source into exactly one compact JSON object describing the story's private bible. Return ONLY JSON, no markdown fences, no commentary.",
  'Exact shape: {"characters":[{"id":"","name":"","aliases":[],"curatorNotes":""}],"secrets":[{"id":"","title":"","truth":"","knownByCharacterIds":[],"revealCondition":"","forbiddenTerms":[]}],"storylines":[{"id":"","title":"","direction":""}],"relationships":[{"id":"","characterIds":[],"privateSummary":""}]}',
  "Use short unique lowercase-hyphen ids. Only include secrets that need to be tracked (things not everyone should know yet) and storylines with a clear intended direction. forbiddenTerms should list the specific words that would spoil the secret if said aloud (e.g. a name, a species, a condition).",
].join("\n");

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON object found in the response.");
  return JSON.parse(text.slice(start, end + 1));
}

function bibleFingerprint(b: CuratorBible): string {
  return JSON.stringify(b);
}

function normalizeBible(value: unknown): CuratorBible {
  const raw = (value as Partial<CuratorBible>) ?? {};
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  return {
    characters: Array.isArray(raw.characters)
      ? raw.characters.map((c) => ({
          id: String(c.id || randomId("char")),
          name: String(c.name || "Unnamed"),
          aliases: strArr(c.aliases),
          curatorNotes: String(c.curatorNotes || ""),
        }))
      : [],
    secrets: Array.isArray(raw.secrets)
      ? raw.secrets.map((s) => ({
          id: String(s.id || randomId("secret")),
          title: String(s.title || "Untitled secret"),
          truth: String(s.truth || ""),
          knownByCharacterIds: strArr(s.knownByCharacterIds),
          revealCondition: String(s.revealCondition || ""),
          forbiddenTerms: strArr(s.forbiddenTerms),
        }))
      : [],
    storylines: Array.isArray(raw.storylines)
      ? raw.storylines.map((s) => ({
          id: String(s.id || randomId("storyline")),
          title: String(s.title || "Untitled storyline"),
          direction: String(s.direction || ""),
        }))
      : [],
    relationships: Array.isArray(raw.relationships)
      ? raw.relationships.map((r) => ({
          id: String(r.id || randomId("rel")),
          characterIds: strArr(r.characterIds),
          privateSummary: String(r.privateSummary || ""),
        }))
      : [],
  };
}

function SectionHeader({ title, onAdd }: { title: string; onAdd: () => void }) {
  return (
    <div className="mb-1.5 flex items-center justify-between">
      <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{title}</h3>
      <button
        type="button"
        onClick={onAdd}
        className="mari-chrome-control mari-chrome-control--small inline-flex items-center gap-1 px-2 py-1 text-[0.625rem]"
      >
        <Plus size="0.75rem" /> Add
      </button>
    </div>
  );
}

function RowShell({ onRemove, children }: { onRemove: () => void; children: React.ReactNode }) {
  return (
    <div className="mb-2 space-y-1.5 rounded-lg border border-[var(--border)]/70 bg-[var(--background)]/40 p-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onRemove}
          className="text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
          aria-label="Remove"
        >
          <Trash2 size="0.75rem" />
        </button>
      </div>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-[var(--input)] bg-[var(--secondary)]/45 px-2 py-1.5 text-[0.6875rem] text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]";
const labelClass = "mb-0.5 block text-[0.5625rem] font-medium text-[var(--muted-foreground)]";

// Placeholders disappear once a field has a value, so a filled-in row otherwise has no way
// to tell you what each input means. This keeps a persistent label above every field.
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[0.5rem] text-[var(--muted-foreground)]">{hint}</span>}
    </label>
  );
}

export function NarrativeCuratorPanel() {
  const activeChat = useChatStore((s) => s.activeChat);
  const chatId = activeChat?.id ?? null;
  const metadata = useMemo(() => parseChatMetadata(activeChat?.metadata), [activeChat?.metadata]);
  // Real per-chat agent activation lives in metadata.activeAgentIds — that's what the
  // generation pipeline actually reads to decide which agents run. A separate on/off flag
  // here would drift out of sync with it, so this toggle reads and writes that list directly.
  const activeAgentIds = useMemo(
    () => (Array.isArray(metadata.activeAgentIds) ? (metadata.activeAgentIds as string[]) : []),
    [metadata.activeAgentIds],
  );
  const curatorEnabled = activeAgentIds.includes(CURATOR_TRACKER_TYPE) && activeAgentIds.includes(CURATOR_SCENE_TYPE);
  const agentsEnabledForChat = metadata.enableAgents === true;
  const updateMeta = useUpdateChatMetadata();
  const toggleCurator = () => {
    if (!chatId) return;
    const next = curatorEnabled
      ? activeAgentIds.filter((id) => id !== CURATOR_TRACKER_TYPE && id !== CURATOR_SCENE_TYPE)
      : [...activeAgentIds, CURATOR_TRACKER_TYPE, CURATOR_SCENE_TYPE];
    updateMeta.mutate({ id: chatId, activeAgentIds: next });
  };

  const [tab, setTab] = useState<"story" | "live-state">("story");
  const [sourceText, setSourceText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [connectionId, setConnectionId] = useState("");
  const [reviewing, setReviewing] = useState(false);

  const { data: memoryResp } = useAgentMemory(CURATOR_TRACKER_TYPE, chatId);
  const updateMemory = useUpdateAgentMemory();
  const serverBible = normalizeBible((memoryResp?.memory as { bible?: unknown })?.bible ?? EMPTY_BIBLE);
  const serverState = ((memoryResp?.memory as { state?: Record<string, CuratorEntityState> })?.state ?? {}) as Record<
    string,
    CuratorEntityState
  >;
  const log = ((memoryResp?.memory as { log?: CuratorLogEntry[] })?.log ?? []) as CuratorLogEntry[];
  const graduated = ((memoryResp?.memory as { graduated?: CuratorGraduatedEntry[] })?.graduated ??
    []) as CuratorGraduatedEntry[];

  // Local draft, decoupled from the server round-trip. Typing updates this instantly; the
  // save is debounced. Without this, every keystroke saved-then-refetched immediately,
  // which reset the input's value prop mid-edit and threw the cursor to the end.
  const [bible, setBible] = useState<CuratorBible>(serverBible);
  const savedFingerprintRef = useRef(bibleFingerprint(serverBible));
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Chat switched: drop any pending save for the old chat, snap straight to the new one.
  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    setBible(serverBible);
    savedFingerprintRef.current = bibleFingerprint(serverBible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Server data changed for the same chat (e.g. the Tracker wrote to it) and there's no
  // unsaved local edit in flight: adopt it. If a save is pending, don't clobber the draft.
  useEffect(() => {
    if (saveTimeoutRef.current) return;
    const nextFingerprint = bibleFingerprint(serverBible);
    if (nextFingerprint === savedFingerprintRef.current) return;
    setBible(serverBible);
    savedFingerprintRef.current = nextFingerprint;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoryResp?.memory]);

  useEffect(
    () => () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    },
    [],
  );

  // Same local-draft + debounce pattern as the bible, for the same reason — Live State
  // needs to be directly correctable (a wrong status/disposition the Tracker set), and
  // saving on every keystroke would throw the cursor to the end mid-edit.
  const [stateDraft, setStateDraft] = useState<Record<string, CuratorEntityState>>(serverState);
  const savedStateFingerprintRef = useRef(JSON.stringify(serverState));
  const stateSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (stateSaveTimeoutRef.current) {
      clearTimeout(stateSaveTimeoutRef.current);
      stateSaveTimeoutRef.current = null;
    }
    setStateDraft(serverState);
    savedStateFingerprintRef.current = JSON.stringify(serverState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  useEffect(() => {
    if (stateSaveTimeoutRef.current) return;
    const nextFingerprint = JSON.stringify(serverState);
    if (nextFingerprint === savedStateFingerprintRef.current) return;
    setStateDraft(serverState);
    savedStateFingerprintRef.current = nextFingerprint;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoryResp?.memory]);

  useEffect(
    () => () => {
      if (stateSaveTimeoutRef.current) clearTimeout(stateSaveTimeoutRef.current);
    },
    [],
  );

  const { data: agentConfigs } = useAgentConfigs();
  const trackerConfig = agentConfigs?.find((a) => a.type === CURATOR_TRACKER_TYPE);
  const sceneConfig = agentConfigs?.find((a) => a.type === CURATOR_SCENE_TYPE);
  const updateAgent = useUpdateAgent();
  const { data: connectionsRaw } = useConnections();
  const connections = (connectionsRaw ?? []) as Array<{ id: string; name: string }>;

  const rewrite = useAgentSuiteRewrite();
  const applyReport = useApplyCuratorReport();

  const scheduleSave = useCallback(
    (next: CuratorBible) => {
      setBible(next);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null;
        if (!chatId) return;
        savedFingerprintRef.current = bibleFingerprint(next);
        updateMemory.mutate(
          { agentType: CURATOR_TRACKER_TYPE, chatId, patch: { bible: next } },
          { onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save bible") },
        );
      }, 600);
    },
    [chatId, updateMemory],
  );

  const scheduleStateSave = useCallback(
    (next: Record<string, CuratorEntityState>) => {
      setStateDraft(next);
      if (stateSaveTimeoutRef.current) clearTimeout(stateSaveTimeoutRef.current);
      stateSaveTimeoutRef.current = setTimeout(() => {
        stateSaveTimeoutRef.current = null;
        if (!chatId) return;
        savedStateFingerprintRef.current = JSON.stringify(next);
        updateMemory.mutate(
          { agentType: CURATOR_TRACKER_TYPE, chatId, patch: { state: next } },
          { onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save state") },
        );
      }, 600);
    },
    [chatId, updateMemory],
  );

  const setEntityStateField = (key: string, field: keyof CuratorEntityState, value: string) => {
    const current = stateDraft[key] ?? {};
    scheduleStateSave({ ...stateDraft, [key]: { ...current, [field]: value, updatedAt: new Date().toISOString() } });
  };

  const removeEntityState = (key: string) => {
    const next = { ...stateDraft };
    delete next[key];
    scheduleStateSave(next);
  };

  const handleAnalyze = async () => {
    if (!chatId || !connectionId || !sourceText.trim()) return;
    setAnalyzing(true);
    try {
      let response = await rewrite.mutateAsync({
        connectionId,
        instruction: ANALYSIS_INSTRUCTION,
        selectedText: sourceText.slice(0, 50_000),
        dataLabel: "Narrative Curator bible",
      });
      let parsed: unknown;
      try {
        parsed = extractJson(response.rewrittenText);
      } catch (firstError) {
        // One repair attempt: hand the model back its own broken output plus the error.
        response = await rewrite.mutateAsync({
          connectionId,
          instruction: `${ANALYSIS_INSTRUCTION}\n\nYour previous response failed to parse as JSON (${(firstError as Error).message}). Here is what you returned — fix it and return ONLY corrected JSON:\n${response.rewrittenText.slice(0, 2000)}`,
          selectedText: sourceText.slice(0, 50_000),
          dataLabel: "Narrative Curator bible (repair)",
        });
        parsed = extractJson(response.rewrittenText);
      }
      // One-shot replace, not incremental typing — save immediately, no debounce.
      const next = normalizeBible(parsed);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      setBible(next);
      savedFingerprintRef.current = bibleFingerprint(next);
      await updateMemory.mutateAsync({ agentType: CURATOR_TRACKER_TYPE, chatId, patch: { bible: next } });
      toast.success("Bible updated from source text");
      setSourceText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  // One-time catch-up for a story already in progress: unlike the normal per-turn Tracker
  // (last ~10 messages), this hands the model the FULL chat summary so it can backfill
  // everything already established, then applies the exact same deterministic diff/log.
  const handleReviewFullStory = async () => {
    if (!chatId || !trackerConfig?.connectionId || !trackerConfig?.promptTemplate) {
      toast.error("Set a Tracker connection first.");
      return;
    }
    setReviewing(true);
    try {
      const summary = typeof metadata.summary === "string" ? metadata.summary : "";
      if (!summary.trim()) {
        toast.error("This chat has no summary yet to review.");
        return;
      }
      const selectedText = [
        // Bible only, no state — same reasoning as the normal per-turn Tracker: it should
        // independently re-derive truth from the full summary, not anchor on what's already
        // recorded (especially here, where the whole point is catching up on missed state).
        `<Curator Tracker State>${JSON.stringify({ bible })}</Curator Tracker State>`,
        `<chat_summary>${summary}</chat_summary>`,
      ].join("\n\n");
      const instruction = [
        trackerConfig.promptTemplate,
        "",
        "This is a ONE-TIME full catch-up review for a story already in progress, not a normal turn — you were not running before now, so nothing established earlier has been recorded yet. Use the entire chat summary above, not just the most recent scene. Go through every entity carefully and report everything whose true current state differs from what's in the bible/state, even things established a long time ago in the summary.",
      ].join("\n");
      let response = await rewrite.mutateAsync({
        connectionId: trackerConfig.connectionId,
        instruction,
        selectedText: selectedText.slice(0, 50_000),
        dataLabel: "Narrative Curator full review",
      });
      let parsed: unknown;
      try {
        parsed = extractJson(response.rewrittenText);
      } catch (firstError) {
        response = await rewrite.mutateAsync({
          connectionId: trackerConfig.connectionId,
          instruction: `${instruction}\n\nYour previous response failed to parse as JSON (${(firstError as Error).message}). Here is what you returned — fix it and return ONLY corrected JSON:\n${response.rewrittenText.slice(0, 2000)}`,
          selectedText: selectedText.slice(0, 50_000),
          dataLabel: "Narrative Curator full review (repair)",
        });
        parsed = extractJson(response.rewrittenText);
      }
      const result = await applyReport.mutateAsync({ chatId, report: parsed });
      toast.success(`Review applied: ${result.changedCount} change(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Review failed");
    } finally {
      setReviewing(false);
    }
  };

  const setCharacters = (fn: (rows: CuratorCharacter[]) => CuratorCharacter[]) =>
    scheduleSave({ ...bible, characters: fn(bible.characters) });
  const setSecrets = (fn: (rows: CuratorSecret[]) => CuratorSecret[]) => scheduleSave({ ...bible, secrets: fn(bible.secrets) });
  const setStorylines = (fn: (rows: CuratorStoryline[]) => CuratorStoryline[]) =>
    scheduleSave({ ...bible, storylines: fn(bible.storylines) });
  const setRelationships = (fn: (rows: CuratorRelationship[]) => CuratorRelationship[]) =>
    scheduleSave({ ...bible, relationships: fn(bible.relationships) });

  const characterName = (id: string) => bible.characters.find((c) => c.id === id)?.name ?? id;

  if (!chatId) {
    return <div className="mari-chrome-text-muted flex h-full items-center justify-center p-6 text-sm">Open a chat first.</div>;
  }

  return (
    <div className="mari-chrome-token-scope flex h-full flex-col">
      <div className="flex border-b border-[var(--border)]/60 px-2 pt-2">
        {(["story", "live-state"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "rounded-t-md px-3 py-1.5 text-[0.6875rem] font-medium transition-colors",
              tab === key
                ? "bg-[var(--accent)] text-[var(--foreground)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            {key === "story" ? "Story" : "Live State"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {tab === "story" ? (
          <div className="space-y-4">
            <div className="space-y-2 rounded-lg border border-[var(--border)]/70 bg-[var(--background)]/40 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[0.6875rem] font-semibold">Curator agents for this chat</span>
                <button
                  type="button"
                  onClick={toggleCurator}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[0.625rem] font-medium",
                    curatorEnabled
                      ? "bg-[var(--primary)]/15 text-[var(--primary)]"
                      : "bg-[var(--secondary)] text-[var(--muted-foreground)]",
                  )}
                >
                  {curatorEnabled ? "Enabled" : "Disabled"}
                </button>
              </div>
              {curatorEnabled && !agentsEnabledForChat && (
                <p className="rounded-md bg-[var(--destructive)]/10 px-2 py-1.5 text-[0.5625rem] text-[var(--destructive)]">
                  Agents are turned off for this chat overall (Chat Settings → Agents), so these won't run yet even
                  though they're enabled here.
                </p>
              )}
              {curatorEnabled && (
                <div className="grid grid-cols-2 gap-2 text-[0.625rem]">
                  {[
                    { label: "Tracker connection", type: CURATOR_TRACKER_TYPE, config: trackerConfig },
                    { label: "Scene connection", type: CURATOR_SCENE_TYPE, config: sceneConfig },
                  ].map(({ label, type, config }) => (
                    <label key={type} className="block">
                      <span className={labelClass}>{label}</span>
                      <select
                        className={inputClass}
                        value={config?.connectionId ?? ""}
                        onChange={(e) => config?.id && updateAgent.mutate({ id: config.id, connectionId: e.target.value })}
                      >
                        <option value="">Not set</option>
                        {connections.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              {curatorEnabled && (
                <button
                  type="button"
                  disabled={reviewing || !trackerConfig?.connectionId}
                  onClick={handleReviewFullStory}
                  className="mari-chrome-control mari-chrome-control--small inline-flex w-full items-center justify-center gap-1.5 px-3 py-1.5 text-[0.6875rem] disabled:opacity-50"
                >
                  <ScanSearch size="0.75rem" /> {reviewing ? "Reviewing…" : "Review full story"}
                </button>
              )}
              {curatorEnabled && (
                <p className="text-[0.5625rem] text-[var(--muted-foreground)]">
                  For a story already in progress: reviews the whole chat summary (not just recent messages) and
                  backfills everything already established — use this once after turning the Curator on partway
                  through an existing chat, or whenever it seems to have missed something from earlier.
                </p>
              )}
            </div>

            <div className="space-y-2 rounded-lg border border-[var(--border)]/70 bg-[var(--background)]/40 p-2.5">
              <div className="flex items-center gap-1.5 text-[0.6875rem] font-semibold">
                <Sparkles size="0.75rem" /> Analyze source text
              </div>
              <textarea
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                rows={5}
                placeholder="Paste raw story/planning text (up to 50,000 characters)…"
                className={inputClass}
              />
              <div className="flex items-center gap-2">
                <select className={cn(inputClass, "flex-1")} value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
                  <option value="">Choose a connection…</option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={analyzing || !connectionId || !sourceText.trim()}
                  onClick={handleAnalyze}
                  className="mari-chrome-control mari-chrome-control--small px-3 py-1.5 text-[0.6875rem] disabled:opacity-50"
                >
                  {analyzing ? "Analyzing…" : "Analyze"}
                </button>
              </div>
              <p className="text-[0.5625rem] text-[var(--muted-foreground)]">
                Replaces the whole bible below. If the model's JSON is malformed, one automatic repair attempt runs before failing.
              </p>
            </div>

            <div>
              <SectionHeader
                title="Characters"
                onAdd={() =>
                  setCharacters((rows) => [...rows, { id: randomId("char"), name: "New character", aliases: [], curatorNotes: "" }])
                }
              />
              {bible.characters.map((c, i) => (
                <RowShell key={c.id} onRemove={() => setCharacters((rows) => rows.filter((_, idx) => idx !== i))}>
                  <Field label="Name" hint={`ID: ${c.id}`}>
                    <input
                      className={inputClass}
                      placeholder="Name"
                      value={c.name}
                      onChange={(e) =>
                        setCharacters((rows) => rows.map((r, idx) => (idx === i ? { ...r, name: e.target.value } : r)))
                      }
                    />
                  </Field>
                  <Field label="Aliases (comma separated)">
                    <input
                      className={inputClass}
                      placeholder="Aliases, comma separated"
                      value={c.aliases.join(", ")}
                      onChange={(e) =>
                        setCharacters((rows) =>
                          rows.map((r, idx) =>
                            idx === i ? { ...r, aliases: e.target.value.split(",").map((a) => a.trim()).filter(Boolean) } : r,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label="Curator notes (private — motives, hidden traits, never shown to the narrator as-is)">
                    <textarea
                      className={inputClass}
                      rows={2}
                      placeholder="Curator notes"
                      value={c.curatorNotes}
                      onChange={(e) =>
                        setCharacters((rows) => rows.map((r, idx) => (idx === i ? { ...r, curatorNotes: e.target.value } : r)))
                      }
                    />
                  </Field>
                </RowShell>
              ))}
            </div>

            <div>
              <SectionHeader
                title="Secrets"
                onAdd={() =>
                  setSecrets((rows) => [
                    ...rows,
                    {
                      id: randomId("secret"),
                      title: "New secret",
                      truth: "",
                      knownByCharacterIds: [],
                      revealCondition: "",
                      forbiddenTerms: [],
                    },
                  ])
                }
              />
              {bible.secrets.map((s, i) => (
                <RowShell key={s.id} onRemove={() => setSecrets((rows) => rows.filter((_, idx) => idx !== i))}>
                  <Field label="Title">
                    <input
                      className={inputClass}
                      placeholder="Title"
                      value={s.title}
                      onChange={(e) => setSecrets((rows) => rows.map((r, idx) => (idx === i ? { ...r, title: e.target.value } : r)))}
                    />
                  </Field>
                  <Field label="Truth (never sent to the narrator directly)">
                    <textarea
                      className={inputClass}
                      rows={2}
                      placeholder="Truth"
                      value={s.truth}
                      onChange={(e) => setSecrets((rows) => rows.map((r, idx) => (idx === i ? { ...r, truth: e.target.value } : r)))}
                    />
                  </Field>
                  <Field
                    label="Known by (character IDs, comma separated)"
                    hint={
                      bible.characters.length
                        ? `Available: ${bible.characters.map((c) => `${c.name} (${c.id})`).join(", ")}`
                        : "No characters registered yet"
                    }
                  >
                    <input
                      className={inputClass}
                      placeholder="Character IDs, comma separated"
                      value={s.knownByCharacterIds.join(", ")}
                      onChange={(e) =>
                        setSecrets((rows) =>
                          rows.map((r, idx) =>
                            idx === i
                              ? { ...r, knownByCharacterIds: e.target.value.split(",").map((c) => c.trim()).filter(Boolean) }
                              : r,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label="Reveal condition (when it's safe for the narrator to use it)">
                    <input
                      className={inputClass}
                      placeholder="Reveal condition"
                      value={s.revealCondition}
                      onChange={(e) =>
                        setSecrets((rows) => rows.map((r, idx) => (idx === i ? { ...r, revealCondition: e.target.value } : r)))
                      }
                    />
                  </Field>
                  <Field label="Forbidden terms (comma separated — exact words that must never leak)">
                    <input
                      className={inputClass}
                      placeholder="Forbidden terms, comma separated"
                      value={s.forbiddenTerms.join(", ")}
                      onChange={(e) =>
                        setSecrets((rows) =>
                          rows.map((r, idx) =>
                            idx === i ? { ...r, forbiddenTerms: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) } : r,
                          ),
                        )
                      }
                    />
                  </Field>
                  <div className="text-[0.5625rem] text-[var(--muted-foreground)]">
                    Status: {stateDraft[`secret:${s.id}`]?.status ?? "locked"}
                  </div>
                </RowShell>
              ))}
            </div>

            <div>
              <SectionHeader
                title="Storylines"
                onAdd={() =>
                  setStorylines((rows) => [...rows, { id: randomId("storyline"), title: "New storyline", direction: "" }])
                }
              />
              {bible.storylines.map((s, i) => (
                <RowShell key={s.id} onRemove={() => setStorylines((rows) => rows.filter((_, idx) => idx !== i))}>
                  <Field label="Title">
                    <input
                      className={inputClass}
                      placeholder="Title"
                      value={s.title}
                      onChange={(e) =>
                        setStorylines((rows) => rows.map((r, idx) => (idx === i ? { ...r, title: e.target.value } : r)))
                      }
                    />
                  </Field>
                  <Field label="Intended direction (what this should build toward)">
                    <textarea
                      className={inputClass}
                      rows={2}
                      placeholder="Intended direction"
                      value={s.direction}
                      onChange={(e) =>
                        setStorylines((rows) => rows.map((r, idx) => (idx === i ? { ...r, direction: e.target.value } : r)))
                      }
                    />
                  </Field>
                  <div className="text-[0.5625rem] text-[var(--muted-foreground)]">
                    Status: {stateDraft[`storyline:${s.id}`]?.status ?? "inactive"}
                  </div>
                </RowShell>
              ))}
            </div>

            <div>
              <SectionHeader
                title="Relationships"
                onAdd={() => setRelationships((rows) => [...rows, { id: randomId("rel"), characterIds: [], privateSummary: "" }])}
              />
              {bible.relationships.map((r, i) => (
                <RowShell key={r.id} onRemove={() => setRelationships((rows) => rows.filter((_, idx) => idx !== i))}>
                  <Field
                    label="Character IDs (comma separated)"
                    hint={
                      bible.characters.length
                        ? `Available: ${bible.characters.map((c) => `${c.name} (${c.id})`).join(", ")}`
                        : "No characters registered yet"
                    }
                  >
                    <input
                      className={inputClass}
                      placeholder="Character IDs, comma separated"
                      value={r.characterIds.join(", ")}
                      onChange={(e) =>
                        setRelationships((rows) =>
                          rows.map((row, idx) =>
                            idx === i
                              ? { ...row, characterIds: e.target.value.split(",").map((c) => c.trim()).filter(Boolean) }
                              : row,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label="Private summary (the real state of things between them, not the public version)">
                    <textarea
                      className={inputClass}
                      rows={2}
                      placeholder="Private summary"
                      value={r.privateSummary}
                      onChange={(e) =>
                        setRelationships((rows) => rows.map((row, idx) => (idx === i ? { ...row, privateSummary: e.target.value } : row)))
                      }
                    />
                  </Field>
                  <div className="text-[0.5625rem] text-[var(--muted-foreground)]">
                    Disposition: {stateDraft[`relationship:${r.id}`]?.disposition ?? "—"}
                  </div>
                </RowShell>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                <BookOpen size="0.75rem" /> Active state
              </div>
              {Object.keys(stateDraft).length === 0 && (
                <p className="text-[0.625rem] text-[var(--muted-foreground)]">Nothing tracked yet.</p>
              )}
              {Object.entries(stateDraft).map(([key, value]) => {
                const [type, id] = key.split(":", 2);
                const label =
                  type === "secret"
                    ? bible.secrets.find((s) => s.id === id)?.title
                    : type === "storyline"
                      ? bible.storylines.find((s) => s.id === id)?.title
                      : type === "character"
                        ? characterName(id ?? "")
                        : (bible.relationships.find((r) => r.id === id)?.characterIds ?? []).map(characterName).join(" / ");
                const statusOptions =
                  type === "secret" ? SECRET_STATUS_OPTIONS : type === "storyline" ? STORYLINE_STATUS_OPTIONS : null;
                return (
                  <div key={key} className="mb-1.5 space-y-1 rounded-md border border-[var(--border)]/60 px-2 py-1.5 text-[0.625rem]">
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        <span className="font-medium">{label || id}</span>{" "}
                        <span className="text-[var(--muted-foreground)]">({type})</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeEntityState(key)}
                        title="Clear this tracked entry"
                        className="text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
                      >
                        <Trash2 size="0.6875rem" />
                      </button>
                    </div>
                    {statusOptions && (
                      <label className="block">
                        <span className={labelClass}>Status</span>
                        <select
                          className={inputClass}
                          value={value.status ?? ""}
                          onChange={(e) => setEntityStateField(key, "status", e.target.value)}
                        >
                          {statusOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {(type === "character" || type === "relationship") && (
                      <label className="block">
                        <span className={labelClass}>Disposition</span>
                        <input
                          className={inputClass}
                          value={value.disposition ?? ""}
                          onChange={(e) => setEntityStateField(key, "disposition", e.target.value)}
                        />
                      </label>
                    )}
                    {type === "storyline" && (
                      <label className="block">
                        <span className={labelClass}>Drift note</span>
                        <input
                          className={inputClass}
                          value={value.driftNote ?? ""}
                          onChange={(e) => setEntityStateField(key, "driftNote", e.target.value)}
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>

            {graduated.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Graduated
                </h3>
                {graduated.map((g) => (
                  <div
                    key={`${g.entityType}:${g.entityId}`}
                    className="mb-1 flex items-center justify-between gap-2 text-[0.625rem] text-[var(--muted-foreground)]"
                  >
                    <span>
                      {g.entityType} — {g.entityId} ({new Date(g.graduatedAt).toLocaleString()})
                    </span>
                    <button
                      type="button"
                      title="Move back to active tracking, so the Curator gates and reveals it again instead of treating it as universally known."
                      onClick={() => {
                        if (!chatId) return;
                        const nextGraduated = graduated.filter(
                          (item) => !(item.entityType === g.entityType && item.entityId === g.entityId),
                        );
                        const key = `${g.entityType}:${g.entityId}`;
                        const nextState = stateDraft[key]
                          ? stateDraft
                          : { ...stateDraft, [key]: { status: "hinted", updatedAt: new Date().toISOString() } };
                        setStateDraft(nextState);
                        savedStateFingerprintRef.current = JSON.stringify(nextState);
                        updateMemory.mutate(
                          { agentType: CURATOR_TRACKER_TYPE, chatId, patch: { graduated: nextGraduated, state: nextState } },
                          { onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to revert") },
                        );
                      }}
                      className="mari-chrome-control mari-chrome-control--small shrink-0 px-2 py-0.5 text-[0.5625rem]"
                    >
                      Revert
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                <History size="0.75rem" /> Log
              </div>
              {log.length === 0 && <p className="text-[0.625rem] text-[var(--muted-foreground)]">No changes yet.</p>}
              {[...log]
                .reverse()
                .slice(0, 100)
                .map((entry, idx) => (
                  <div key={idx} className="mb-1 text-[0.625rem] text-[var(--muted-foreground)]">
                    <span className="text-[var(--foreground)]">{entry.entityType}:{entry.entityId}</span> {entry.field}{" "}
                    {String(entry.from)} → {String(entry.to)}{" "}
                    <span className="opacity-60">({new Date(entry.ts).toLocaleTimeString()})</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
