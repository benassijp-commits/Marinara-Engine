import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Lock, LockOpen, RefreshCw, Sparkles, X } from "lucide-react";
import {
  type AvatarDescriptionPreview,
  avatarBodyCompositionLabel,
  avatarBodyControlLabel,
  avatarBodySliderToBodyFatPercent,
  avatarBodySliderToWeightKg,
  avatarBodySizeLabel,
  calculateAvatarBodyControls,
  type AvatarBodyControlMode,
  type AvatarBodyControlState,
  type AvatarBodyControlValues,
  type AvatarBodyThresholdSettings,
  type PresentCharacter,
} from "@marinara-engine/shared";
import { api } from "../../../../lib/api-client";
import { toast } from "sonner";

interface Props {
  activeChatId: string;
  character: PresentCharacter;
  onClose: () => void;
  onAvatarUpdated: (avatarPath: string) => Promise<void>;
  onDescriptionUpdated: (appearance: string, outfit: string) => Promise<void>;
}

const CONTROL_ROWS: Array<{ key: "muscularity" | "bodyFat" | "cock"; label: string }> = [
  { key: "muscularity", label: "Body size" },
  { key: "bodyFat", label: "Body Fat (%)" },
  { key: "cock", label: "Cock" },
];

export function AvatarBodyControlModal({
  activeChatId,
  character,
  onClose,
  onAvatarUpdated,
  onDescriptionUpdated,
}: Props) {
  const autoValues = useMemo(() => calculateAvatarBodyControls(character.stats ?? []), [character.stats]);
  const [state, setState] = useState<AvatarBodyControlState | null>(null);
  const [mode, setMode] = useState<AvatarBodyControlMode>("auto");
  const [manual, setManual] = useState<AvatarBodyControlValues>(autoValues);
  const [busy, setBusy] = useState<
    "load" | "save" | "lock" | "regenerate" | "description" | "apply-description" | null
  >("load");
  const [loaded, setLoaded] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [descriptionPreview, setDescriptionPreview] = useState<AvatarDescriptionPreview | null>(null);
  const [thresholds, setThresholds] = useState<AvatarBodyThresholdSettings | undefined>();
  const [promptEditor, setPromptEditor] = useState<{
    kind: "fixed" | "normal";
    prompt: string;
    negativePrompt: string;
    seed: number;
  } | null>(null);

  const body = useMemo(
    () => ({ characterId: character.characterId, name: character.name, stats: character.stats ?? [] }),
    [character.characterId, character.name, character.stats],
  );
  const generationBody = useMemo(
    () => ({ ...body, appearance: character.appearance, outfit: character.outfit }),
    [body, character.appearance, character.outfit],
  );

  useEffect(() => {
    let cancelled = false;
    void api
      .post<AvatarBodyControlState>(`/avatars/npc/${encodeURIComponent(activeChatId)}/body-control/state`, body)
      .then((result) => {
        if (cancelled) return;
        setState(result);
        setMode(result.mode);
        setManual(result.manual);
        setLoaded(true);
      })
      .catch((error) => !cancelled && toast.error(error instanceof Error ? error.message : "Failed to load body controls"))
      .finally(() => !cancelled && setBusy(null));
    return () => { cancelled = true; };
  }, [activeChatId, body]);

  useEffect(() => {
    void api.get<AvatarBodyThresholdSettings>("/avatars/body-settings").then(setThresholds).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timeout = window.setTimeout(() => {
      setBusy((current) => current ?? "save");
      void api
        .patch<AvatarBodyControlState>(`/avatars/npc/${encodeURIComponent(activeChatId)}/body-control`, {
          ...body,
          mode,
          manual,
        })
        .then(setState)
        .catch((error) => toast.error(error instanceof Error ? error.message : "Failed to save body controls"))
        .finally(() => setBusy((current) => current === "save" ? null : current));
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [activeChatId, body, loaded, manual, mode]);

  const effective = mode === "auto" ? (state?.effective ?? autoValues) : manual;
  const toggleLock = async () => {
    if (!state) return;
    setBusy("lock");
    try {
      const result = state.locked
        ? await api.delete<AvatarBodyControlState>(
            `/avatars/npc/${encodeURIComponent(activeChatId)}/body-control/lock?characterId=${encodeURIComponent(character.characterId)}`,
          )
        : await api.post<AvatarBodyControlState>(
            `/avatars/npc/${encodeURIComponent(activeChatId)}/body-control/lock`,
            body,
          );
      setState({ ...result, canLock: result.canLock || state.canLock, effective });
      toast.success(result.locked ? "Avatar structure fixed." : "Avatar structure unlocked.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update avatar lock");
    } finally {
      setBusy(null);
    }
  };

  const preparePrompt = async (kind: "fixed" | "normal") => {
    if (kind === "fixed" && !state?.locked) return;
    setBusy("regenerate");
    try {
      await api.patch(`/avatars/npc/${encodeURIComponent(activeChatId)}/body-control`, { ...body, mode, manual });
      const endpoint = kind === "fixed" ? "regenerate-locked" : "regenerate";
      const result = await api.post<{ prompt: string; negativePrompt: string; seed: number }>(
        `/avatars/npc/${encodeURIComponent(activeChatId)}/${endpoint}`,
        { ...generationBody, previewOnly: true },
      );
      setPromptEditor({ kind, ...result });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to prepare avatar prompt");
    } finally {
      setBusy(null);
    }
  };

  const generateEditedPrompt = async () => {
    if (!promptEditor?.prompt.trim()) return;
    setBusy("regenerate");
    try {
      const endpoint = promptEditor.kind === "fixed" ? "regenerate-locked" : "regenerate";
      const result = await api.post<{ avatarPath: string }>(
        `/avatars/npc/${encodeURIComponent(activeChatId)}/${endpoint}`,
        {
          ...generationBody,
          promptOverride: promptEditor.prompt,
          negativePromptOverride: promptEditor.negativePrompt,
        },
      );
      await onAvatarUpdated(result.avatarPath);
      toast.success(`${character.name || "Character"}'s avatar was regenerated.`);
      setPromptEditor(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to regenerate avatar");
    } finally {
      setBusy(null);
    }
  };

  const generateDescriptionPreview = async () => {
    setBusy("description");
    setDescriptionOpen(true);
    try {
      const result = await api.post<AvatarDescriptionPreview>(
        `/avatars/npc/${encodeURIComponent(activeChatId)}/description-preview`,
        { characterId: character.characterId, name: character.name },
      );
      setDescriptionPreview(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to regenerate appearance and outfit");
    } finally {
      setBusy(null);
    }
  };

  const applyDescriptionPreview = async () => {
    const appearance = descriptionPreview?.appearance?.trim() ?? "";
    const outfit = descriptionPreview?.outfit?.trim() ?? "";
    if (!appearance || !outfit) return;
    setBusy("apply-description");
    try {
      await onDescriptionUpdated(appearance, outfit);
      setDescriptionPreview(null);
      toast.success(`${character.name || "Character"}'s appearance and outfit were updated.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to apply appearance and outfit");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${character.name} avatar body controls`}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">{character.name} — Avatar body</h2>
            <p className="text-xs text-[var(--muted-foreground)]">Auto follows tracker stats; regeneration is always manual.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-[var(--accent)]" aria-label="Close">
            <X size="1rem" />
          </button>
        </div>

        {busy === "load" || !state ? (
          <div className="flex min-h-40 items-center justify-center"><Loader2 className="animate-spin" /></div>
        ) : (
          <>
            <section className="mb-4 border-b border-[var(--border)] pb-4">
              <button
                type="button"
                onClick={() => setDescriptionOpen((current) => !current)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-left hover:bg-[var(--accent)]/45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
                aria-expanded={descriptionOpen}
              >
                <span>
                  <span className="block text-xs font-semibold">Appearance & outfit</span>
                  <span className="block text-[0.6875rem] text-[var(--muted-foreground)]">
                    Build a fresh proposal from the character card and current scene.
                  </span>
                </span>
                <ChevronDown
                  size="0.9rem"
                  className={`shrink-0 transition-transform ${descriptionOpen ? "rotate-180" : ""}`}
                />
              </button>

              {descriptionOpen && (
                <div className="mt-3 space-y-3">
                  {!descriptionPreview ? (
                    <button
                      type="button"
                      onClick={() => void generateDescriptionPreview()}
                      disabled={!!busy}
                      className="flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs disabled:opacity-45"
                    >
                      {busy === "description" ? (
                        <Loader2 size="0.8rem" className="animate-spin" />
                      ) : (
                        <Sparkles size="0.8rem" />
                      )}
                      Generate fresh description
                    </button>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                        <span>
                          Source: {descriptionPreview.source === "card_and_scene" ? "character card + current scene" : "current scene only"}
                        </span>
                        <button
                          type="button"
                          onClick={() => void generateDescriptionPreview()}
                          disabled={!!busy}
                          className="flex min-h-8 items-center gap-1 rounded-md px-2 py-1 hover:bg-[var(--accent)] disabled:opacity-45"
                        >
                          {busy === "description" ? <Loader2 size="0.75rem" className="animate-spin" /> : <RefreshCw size="0.75rem" />}
                          Generate again
                        </button>
                      </div>
                      {descriptionPreview.warnings.map((warning) => (
                        <p key={warning} className="rounded-lg bg-[var(--muted)] px-2.5 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                          {warning}
                        </p>
                      ))}
                      <label className="block text-xs">
                        Appearance
                        <textarea
                          value={descriptionPreview.appearance ?? ""}
                          onChange={(event) =>
                            setDescriptionPreview((current) =>
                              current ? { ...current, appearance: event.target.value || null } : current,
                            )
                          }
                          rows={4}
                          className="mt-1 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--muted)] p-2 text-xs outline-none focus:ring-1 focus:ring-[var(--primary)]"
                        />
                      </label>
                      <label className="block text-xs">
                        Outfit
                        <textarea
                          value={descriptionPreview.outfit ?? ""}
                          onChange={(event) =>
                            setDescriptionPreview((current) =>
                              current ? { ...current, outfit: event.target.value || null } : current,
                            )
                          }
                          rows={3}
                          className="mt-1 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--muted)] p-2 text-xs outline-none focus:ring-1 focus:ring-[var(--primary)]"
                        />
                      </label>
                      <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
                        Applying replaces both tracker texts. Existing field locks remain active.
                      </p>
                      <div className="flex flex-col-reverse gap-2 min-[360px]:flex-row min-[360px]:justify-end">
                        <button
                          type="button"
                          onClick={() => setDescriptionPreview(null)}
                          disabled={!!busy}
                          className="min-h-9 rounded-lg border border-[var(--border)] px-3 py-2 text-xs disabled:opacity-45"
                        >
                          Discard
                        </button>
                        <button
                          type="button"
                          onClick={() => void applyDescriptionPreview()}
                          disabled={
                            !!busy ||
                            !descriptionPreview.appearance?.trim() ||
                            !descriptionPreview.outfit?.trim()
                          }
                          className="min-h-9 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs text-[var(--primary-foreground)] disabled:opacity-45"
                        >
                          {busy === "apply-description" ? "Applying…" : "Apply texts"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>

            <div className="mb-4 grid grid-cols-2 rounded-lg bg-[var(--muted)] p-1 text-xs">
              {(["auto", "manual"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`rounded-md px-3 py-1.5 capitalize ${mode === value ? "bg-[var(--background)] shadow" : "text-[var(--muted-foreground)]"}`}
                >
                  {value}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {CONTROL_ROWS.map(({ key, label }) => {
                const value = effective[key];
                const valueLabel = key === "muscularity"
                  ? `${Math.round(avatarBodySliderToWeightKg(value, thresholds))} kg · ${avatarBodySizeLabel(effective, thresholds)}`
                  : key === "bodyFat"
                    ? `${avatarBodySliderToBodyFatPercent(value, thresholds).toFixed(1)}% · ${avatarBodyCompositionLabel(value, thresholds)}`
                    : avatarBodyControlLabel(key, value);
                return (
                  <label key={key} className="block">
                    <span className="mb-1 flex justify-between text-xs">
                      <span>{label}</span>
                      <span className="tabular-nums text-[var(--muted-foreground)]">{value} · {valueLabel}</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={0.1}
                      value={value}
                      disabled={mode === "auto"}
                      onChange={(event) => setManual((current) => ({ ...current, [key]: Number(event.target.value) }))}
                      className="w-full accent-[var(--primary)] disabled:opacity-55"
                    />
                  </label>
                );
              })}
            </div>

            {mode === "auto" && (
              <p className="mt-3 text-[0.6875rem] text-[var(--muted-foreground)]">
                Weight and Body Fat drive body shape. Height only adds scale tags from 600 kg onward; Cock uses Cock(cm).
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void toggleLock()}
                disabled={!!busy || (!state.locked && !state.canLock)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs disabled:opacity-45"
                title={!state.locked && !state.canLock ? "Current avatar has no compatible ComfyUI metadata" : undefined}
              >
                {busy === "lock" ? <Loader2 size="0.8rem" className="animate-spin" /> : state.locked ? <LockOpen size="0.8rem" /> : <Lock size="0.8rem" />}
                {state.locked ? "Unfix structure" : "Fix current structure"}
              </button>
              <button
                type="button"
                onClick={() => void preparePrompt("fixed")}
                disabled={!!busy || !state.locked}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs text-[var(--primary-foreground)] disabled:opacity-45"
              >
                {busy === "regenerate" ? <Loader2 size="0.8rem" className="animate-spin" /> : <RefreshCw size="0.8rem" />}
                Prepare fixed prompt
              </button>
              <button
                type="button"
                onClick={() => void preparePrompt("normal")}
                disabled={!!busy}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs disabled:opacity-45"
              >
                Prepare normal prompt
              </button>
            </div>
            {state.locked && <p className="mt-2 text-[0.6875rem] text-[var(--muted-foreground)]">Fixed seed: {state.seed}</p>}

            {promptEditor && (
              <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold capitalize">{promptEditor.kind} prompt sent to ComfyUI</h3>
                  <span className="text-[0.6875rem] text-[var(--muted-foreground)]">
                    Seed: {promptEditor.seed < 0 ? "random" : promptEditor.seed}
                  </span>
                </div>
                <label className="block text-xs">
                  Positive prompt
                  <textarea
                    value={promptEditor.prompt}
                    onChange={(event) => setPromptEditor((current) => current && ({ ...current, prompt: event.target.value }))}
                    rows={7}
                    className="mt-1 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--muted)] p-2 font-mono text-[0.6875rem] outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  />
                </label>
                <label className="block text-xs">
                  Negative prompt
                  <textarea
                    value={promptEditor.negativePrompt}
                    onChange={(event) => setPromptEditor((current) => current && ({ ...current, negativePrompt: event.target.value }))}
                    rows={4}
                    className="mt-1 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--muted)] p-2 font-mono text-[0.6875rem] outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setPromptEditor(null)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void generateEditedPrompt()}
                    disabled={!!busy || !promptEditor.prompt.trim()}
                    className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs text-[var(--primary-foreground)] disabled:opacity-45"
                  >
                    {busy === "regenerate" ? "Generating…" : "Send to ComfyUI"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
