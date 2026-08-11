import { useCallback, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import type {
  CharacterStat,
  CustomTrackerField,
  InventoryItem,
  PlayerStats,
  PresentCharacter,
  QuestProgress,
  TrackerHiddenFields,
} from "@marinara-engine/shared";
import {
  characterTrackerLockPrefix,
  inventoryItemTrackerLockPrefix,
  normalizeTrackerHiddenFields,
  removeTrackerCharacterLocks,
  removeTrackerFieldLockPrefix,
  removeTrackerQuestLocks,
  renameTrackerFieldLockPrefix,
} from "@marinara-engine/shared";
import { api } from "../../../lib/api-client";
import { showConfirmDialog } from "../../../lib/app-dialogs";
import { useGameStateStore } from "../../../stores/game-state.store";
import { patchGameStateField, type GameStatePatchField } from "../../../hooks/use-game-state-patcher";
import { getCharacterFeatureKey, resolveCharacterTargetIndex } from "../lib/character-tracker-data";
import { useTrackerFieldLockUpdater } from "./use-tracker-field-lock-updater";

function makeManualTrackerId() {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `manual-${id}`;
}

function shallowRecordEqual(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
  for (const key of keys) {
    if (!Object.is(leftRecord[key], rightRecord[key])) return false;
  }
  return true;
}

function mergeChangedRecord<T extends Record<string, unknown>>(live: T, rendered: T | undefined, updated: T): T {
  if (!rendered) return updated;
  const merged: Record<string, unknown> = { ...live };
  for (const key of Object.keys(updated)) {
    if (!Object.is(updated[key], rendered[key])) {
      merged[key] = updated[key];
    }
  }
  return merged as T;
}

function findUniqueNamedIndex<T extends { name?: string }>(items: T[], item: T | undefined) {
  const name = item?.name?.trim().toLowerCase();
  if (!name) return -1;
  const matches = items
    .map((candidate, index) => ({ index, name: candidate.name?.trim().toLowerCase() }))
    .filter((candidate) => candidate.name === name);
  return matches.length === 1 ? matches[0]!.index : -1;
}

function resolveIndexedMutationTarget<T extends { name?: string }>(liveItems: T[], renderedItems: T[], index: number) {
  const renderedItem = renderedItems[index];
  const namedIndex = findUniqueNamedIndex(liveItems, renderedItem);
  const targetIndex = namedIndex >= 0 ? namedIndex : index;
  return {
    renderedItem,
    targetIndex: targetIndex >= 0 && targetIndex < liveItems.length ? targetIndex : -1,
  };
}

function reconcileListUpdate<T extends { name?: string }>(liveItems: T[], renderedItems: T[], updatedItems: T[]) {
  if (updatedItems.length === renderedItems.length + 1) {
    return [...liveItems, ...updatedItems.slice(renderedItems.length)];
  }

  if (updatedItems.length === renderedItems.length - 1) {
    const removedIndex = renderedItems.findIndex(
      (renderedItem, index) => !shallowRecordEqual(renderedItem, updatedItems[index]),
    );
    const fallbackIndex = removedIndex >= 0 ? removedIndex : renderedItems.length - 1;
    const { targetIndex } = resolveIndexedMutationTarget(liveItems, renderedItems, fallbackIndex);
    if (targetIndex < 0) return liveItems;
    return liveItems.filter((_, index) => index !== targetIndex);
  }

  if (updatedItems.length === renderedItems.length) {
    const changedIndex = updatedItems.findIndex(
      (updatedItem, index) => !shallowRecordEqual(updatedItem, renderedItems[index]),
    );
    if (changedIndex < 0) return liveItems;
    const { renderedItem, targetIndex } = resolveIndexedMutationTarget(liveItems, renderedItems, changedIndex);
    if (targetIndex < 0) return updatedItems;
    const next = [...liveItems];
    next[targetIndex] = mergeChangedRecord(
      liveItems[targetIndex]! as T & Record<string, unknown>,
      renderedItem as (T & Record<string, unknown>) | undefined,
      updatedItems[changedIndex]! as T & Record<string, unknown>,
    ) as T;
    return next;
  }

  return updatedItems;
}

export function useTrackerMutations({
  activeChatId,
  customFields,
  inventory,
  personaStats,
  presentCharacters,
  quests,
  patchField,
  patchPlayerStats,
  flushPatch,
  removeFeaturedCharacterCard,
}: {
  activeChatId: string | null;
  customFields: CustomTrackerField[];
  inventory: InventoryItem[];
  personaStats: CharacterStat[];
  presentCharacters: PresentCharacter[];
  quests: QuestProgress[];
  patchField: (field: GameStatePatchField, value: unknown) => void;
  patchPlayerStats: (field: keyof PlayerStats, value: unknown) => void;
  flushPatch: () => Promise<void>;
  removeFeaturedCharacterCard: (key: string) => void;
}) {
  const [avatarUpload, setAvatarUpload] = useState<{ characterId: string; index: number } | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const avatarUploadSerialRef = useRef(0);
  const avatarUploadTokenByCharacterRef = useRef(new Map<string, number>());
  const [avatarRemovalKey, setAvatarRemovalKey] = useState<string | null>(null);
  const [avatarBodyControl, setAvatarBodyControl] = useState<{ characterId: string; index: number } | null>(null);
  const updateFieldLocks = useTrackerFieldLockUpdater({ chatId: activeChatId, patchField });
  const updateHiddenTrackerFields = useCallback(
    (updater: (hiddenFields: TrackerHiddenFields | null | undefined) => TrackerHiddenFields) => {
      const current = activeChatId ? useGameStateStore.getState().current : null;
      const base =
        current?.chatId === activeChatId ? normalizeTrackerHiddenFields(current.hiddenTrackerFields) : undefined;
      patchField("hiddenTrackerFields", updater(base));
    },
    [activeChatId, patchField],
  );

  const readCurrentGameState = useCallback(() => {
    if (!activeChatId) return null;
    const current = useGameStateStore.getState().current;
    return current?.chatId === activeChatId ? current : null;
  }, [activeChatId]);

  const readPresentCharacters = useCallback(
    () => readCurrentGameState()?.presentCharacters ?? presentCharacters,
    [presentCharacters, readCurrentGameState],
  );
  const readPlayerStats = useCallback(() => readCurrentGameState()?.playerStats ?? null, [readCurrentGameState]);
  const readInventory = useCallback(() => readPlayerStats()?.inventory ?? inventory, [inventory, readPlayerStats]);
  const readQuests = useCallback(() => readPlayerStats()?.activeQuests ?? quests, [quests, readPlayerStats]);
  const readPersonaStats = useCallback(
    () => readCurrentGameState()?.personaStats ?? personaStats,
    [personaStats, readCurrentGameState],
  );
  const readCustomFields = useCallback(() => readPlayerStats()?.customTrackerFields ?? [], [readPlayerStats]);

  const openAvatarUpload = useCallback(
    (index: number) => {
      const characterId = presentCharacters[index]?.characterId ?? readPresentCharacters()[index]?.characterId ?? null;
      if (!characterId) return;
      setAvatarUpload({ characterId, index });
      avatarFileInputRef.current?.click();
    },
    [presentCharacters, readPresentCharacters],
  );

  const openAvatarBodyControl = useCallback(
    (index: number) => {
      const character = presentCharacters[index] ?? readPresentCharacters()[index];
      if (!character?.characterId) return;
      setAvatarBodyControl({ characterId: character.characterId, index });
    },
    [presentCharacters, readPresentCharacters],
  );

  const updateAvatarPath = useCallback(
    (characterId: string, fallbackIndex: number, avatarPath: string) => {
      const latestCharacters = readPresentCharacters();
      const targetIndex = resolveCharacterTargetIndex(latestCharacters, characterId, fallbackIndex);
      if (targetIndex < 0) return false;
      const nextCharacters = [...latestCharacters];
      nextCharacters[targetIndex] = { ...latestCharacters[targetIndex]!, avatarPath, preferGeneratedAvatar: true };
      if (!activeChatId) return false;
      patchGameStateField(activeChatId, "presentCharacters", nextCharacters, { allowDuringRefresh: true });
      return true;
    },
    [activeChatId, readPresentCharacters],
  );

  const handleAvatarUpload = useCallback(
    (characterId: string, fallbackIndex: number, file: File) => {
      if (!activeChatId) return;
      const currentCharacters = readPresentCharacters();
      const initialIndex = resolveCharacterTargetIndex(currentCharacters, characterId, fallbackIndex);
      const character = initialIndex >= 0 ? currentCharacters[initialIndex] : undefined;
      if (!character) return;

      const uploadToken = avatarUploadSerialRef.current + 1;
      avatarUploadSerialRef.current = uploadToken;
      avatarUploadTokenByCharacterRef.current.set(characterId, uploadToken);

      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        if (!dataUrl) {
          if (avatarUploadTokenByCharacterRef.current.get(characterId) === uploadToken) {
            avatarUploadTokenByCharacterRef.current.delete(characterId);
          }
          return;
        }
        if (avatarUploadTokenByCharacterRef.current.get(characterId) !== uploadToken) return;

        try {
          const response = await api.post<{ avatarPath: string }>(`/avatars/npc/${activeChatId}`, {
            characterId: character.characterId,
            name: character.name,
            avatar: dataUrl,
          });
          if (avatarUploadTokenByCharacterRef.current.get(characterId) !== uploadToken) return;

          const latestCharacters = readPresentCharacters();
          const targetIndex = resolveCharacterTargetIndex(latestCharacters, characterId, fallbackIndex);
          if (targetIndex < 0) return;

          const nextCharacters = [...latestCharacters];
          nextCharacters[targetIndex] = { ...latestCharacters[targetIndex]!, avatarPath: response.avatarPath };
          patchField("presentCharacters", nextCharacters);
        } catch {
          // Match the original HUD widget behavior: failed avatar uploads leave tracker data unchanged.
        } finally {
          if (avatarUploadTokenByCharacterRef.current.get(characterId) === uploadToken) {
            avatarUploadTokenByCharacterRef.current.delete(characterId);
          }
        }
      };
      reader.onerror = () => {
        if (avatarUploadTokenByCharacterRef.current.get(characterId) === uploadToken) {
          avatarUploadTokenByCharacterRef.current.delete(characterId);
        }
      };
      reader.readAsDataURL(file);
    },
    [activeChatId, patchField, readPresentCharacters],
  );

  const handleAvatarFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      const pending = avatarUpload;
      setAvatarUpload(null);
      if (file && pending) handleAvatarUpload(pending.characterId, pending.index, file);
      event.target.value = "";
    },
    [avatarUpload, handleAvatarUpload],
  );

  const removeAvatar = useCallback(
    async (index: number) => {
      if (!activeChatId) return;
      const renderedCharacter = presentCharacters[index];
      const initialCharacters = readPresentCharacters();
      const initialIndex = resolveCharacterTargetIndex(initialCharacters, renderedCharacter?.characterId, index);
      const character = initialIndex >= 0 ? initialCharacters[initialIndex] : undefined;
      if (!character?.avatarPath?.startsWith("/api/avatars/npc/")) return;

      const removalKey = `${character.characterId || "character"}:${index}`;
      if (avatarRemovalKey) return;
      const confirmed = await showConfirmDialog({
        title: "Regenerate character avatar?",
        message: `Generate a new avatar for ${character.name.trim() || "this character"} now? The current image remains in place unless generation and saving both succeed.`,
        confirmLabel: "Regenerate avatar",
        cancelLabel: "Cancel",
      });
      if (!confirmed) return;

      setAvatarRemovalKey(removalKey);
      try {
        const stored = await api.post<{ avatarPath: string }>(
          `/avatars/npc/${encodeURIComponent(activeChatId)}/regenerate`,
          {
          name: character.name,
            appearance: character.appearance,
            outfit: character.outfit,
          },
        );

        const latestCharacters = readPresentCharacters();
        const targetIndex = resolveCharacterTargetIndex(latestCharacters, character.characterId, initialIndex);
        if (targetIndex < 0) {
          toast.error("The character changed before the new avatar could be saved.");
          return;
        }
        const nextCharacters = [...latestCharacters];
        nextCharacters[targetIndex] = { ...latestCharacters[targetIndex]!, avatarPath: stored.avatarPath };
        patchField("presentCharacters", nextCharacters);
        await flushPatch();
        toast.success(`${character.name.trim() || "Character"}'s avatar was regenerated.`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to regenerate the character avatar.");
      } finally {
        setAvatarRemovalKey(null);
      }
    },
    [activeChatId, avatarRemovalKey, flushPatch, patchField, presentCharacters, readPresentCharacters],
  );

  const updateCharacter = useCallback(
    (index: number, character: PresentCharacter) => {
      const liveCharacters = readPresentCharacters();
      const renderedCharacter = presentCharacters[index];
      const targetCharacterId = character.characterId || renderedCharacter?.characterId;
      const targetIndex = resolveCharacterTargetIndex(liveCharacters, targetCharacterId, index);
      if (targetIndex < 0) return;

      const previous = liveCharacters[targetIndex];
      const nextCharacter = mergeChangedRecord(
        previous as PresentCharacter & Record<string, unknown>,
        renderedCharacter as (PresentCharacter & Record<string, unknown>) | undefined,
        character as PresentCharacter & Record<string, unknown>,
      ) as PresentCharacter;
      if (previous && previous.name !== character.name) {
        updateFieldLocks((locks) =>
          renameTrackerFieldLockPrefix(
            locks,
            characterTrackerLockPrefix(previous, targetIndex),
            characterTrackerLockPrefix(nextCharacter, targetIndex),
          ),
        );
        updateHiddenTrackerFields((hiddenFields) =>
          renameTrackerFieldLockPrefix(
            hiddenFields,
            characterTrackerLockPrefix(previous, targetIndex),
            characterTrackerLockPrefix(nextCharacter, targetIndex),
          ),
        );
      }
      const next = [...liveCharacters];
      next[targetIndex] = nextCharacter;
      patchField("presentCharacters", next);
    },
    [patchField, presentCharacters, readPresentCharacters, updateFieldLocks, updateHiddenTrackerFields],
  );

  const removeCharacter = useCallback(
    (index: number) => {
      const liveCharacters = readPresentCharacters();
      const renderedCharacter = presentCharacters[index];
      const targetIndex = resolveCharacterTargetIndex(liveCharacters, renderedCharacter?.characterId, index);
      if (targetIndex < 0) return;

      const removed = liveCharacters[targetIndex];
      if (removed) {
        removeFeaturedCharacterCard(getCharacterFeatureKey(removed, targetIndex));
        updateFieldLocks((locks) => removeTrackerCharacterLocks(locks, removed, targetIndex));
        updateHiddenTrackerFields((hiddenFields) => removeTrackerCharacterLocks(hiddenFields, removed, targetIndex));
      }
      patchField(
        "presentCharacters",
        liveCharacters.filter((_, characterIndex) => characterIndex !== targetIndex),
      );
    },
    [
      patchField,
      presentCharacters,
      readPresentCharacters,
      removeFeaturedCharacterCard,
      updateFieldLocks,
      updateHiddenTrackerFields,
    ],
  );

  const addCharacter = useCallback(() => {
    const liveCharacters = readPresentCharacters();
    patchField("presentCharacters", [
      ...liveCharacters,
      {
        characterId: makeManualTrackerId(),
        name: "New Character",
        emoji: "?",
        mood: "",
        appearance: null,
        outfit: null,
        customFields: {},
        stats: [],
        thoughts: null,
      },
    ]);
  }, [patchField, readPresentCharacters]);

  const updateInventory = useCallback(
    (items: InventoryItem[]) => patchPlayerStats("inventory", items),
    [patchPlayerStats],
  );

  const updateInventoryItem = useCallback(
    (index: number, item: InventoryItem) => {
      const liveInventory = readInventory();
      const { renderedItem, targetIndex } = resolveIndexedMutationTarget(liveInventory, inventory, index);
      if (targetIndex < 0) return;
      const next = [...liveInventory];
      next[targetIndex] = mergeChangedRecord(
        liveInventory[targetIndex]! as InventoryItem & Record<string, unknown>,
        renderedItem as (InventoryItem & Record<string, unknown>) | undefined,
        item as InventoryItem & Record<string, unknown>,
      ) as InventoryItem;
      updateInventory(next);
    },
    [inventory, readInventory, updateInventory],
  );

  const removeInventoryItem = useCallback(
    (index: number) => {
      const liveInventory = readInventory();
      const { targetIndex } = resolveIndexedMutationTarget(liveInventory, inventory, index);
      if (targetIndex < 0) return;
      updateInventory(liveInventory.filter((_, itemIndex) => itemIndex !== targetIndex));
      updateFieldLocks((locks) =>
        removeTrackerFieldLockPrefix(locks, inventoryItemTrackerLockPrefix(liveInventory[targetIndex]!, targetIndex)),
      );
    },
    [inventory, readInventory, updateFieldLocks, updateInventory],
  );

  const addInventoryItem = useCallback(() => {
    updateInventory([...readInventory(), { name: "New Item", description: "", quantity: 1, location: "on_person" }]);
  }, [readInventory, updateInventory]);

  const updateQuests = useCallback(
    (nextQuests: QuestProgress[]) => patchPlayerStats("activeQuests", nextQuests),
    [patchPlayerStats],
  );

  const updateQuest = useCallback(
    (index: number, quest: QuestProgress) => {
      const liveQuests = readQuests();
      const renderedQuest = quests[index];
      const targetQuestId = quest.questEntryId || renderedQuest?.questEntryId;
      const targetIndex = targetQuestId
        ? liveQuests.findIndex((candidate) => candidate.questEntryId === targetQuestId)
        : index;
      if (targetIndex < 0 || targetIndex >= liveQuests.length) return;
      const next = [...liveQuests];
      next[targetIndex] = mergeChangedRecord(
        liveQuests[targetIndex]! as QuestProgress & Record<string, unknown>,
        renderedQuest as (QuestProgress & Record<string, unknown>) | undefined,
        quest as QuestProgress & Record<string, unknown>,
      ) as QuestProgress;
      updateQuests(next);
    },
    [quests, readQuests, updateQuests],
  );

  const removeQuest = useCallback(
    (index: number) => {
      const liveQuests = readQuests();
      const renderedQuest = quests[index];
      const targetIndex = renderedQuest?.questEntryId
        ? liveQuests.findIndex((candidate) => candidate.questEntryId === renderedQuest.questEntryId)
        : index;
      if (targetIndex < 0 || targetIndex >= liveQuests.length) return;
      const removed = liveQuests[targetIndex];
      if (removed) updateFieldLocks((locks) => removeTrackerQuestLocks(locks, removed, targetIndex));
      updateQuests(liveQuests.filter((_, questIndex) => questIndex !== targetIndex));
    },
    [quests, readQuests, updateFieldLocks, updateQuests],
  );

  const addQuest = useCallback(() => {
    const liveQuests = readQuests();
    updateQuests([
      ...liveQuests,
      {
        questEntryId: makeManualTrackerId(),
        name: "New Quest",
        currentStage: 0,
        objectives: [{ text: "Objective 1", completed: false }],
        completed: false,
      },
    ]);
  }, [readQuests, updateQuests]);

  const savePersonaStatus = useCallback((status: string) => patchPlayerStats("status", status), [patchPlayerStats]);

  const updatePersonaStats = useCallback(
    (stats: CharacterStat[]) =>
      patchField("personaStats", reconcileListUpdate(readPersonaStats(), personaStats, stats)),
    [patchField, personaStats, readPersonaStats],
  );

  const addPersonaStat = useCallback(() => {
    patchField("personaStats", [
      ...readPersonaStats(),
      { name: "New Stat", value: 0, max: 100, color: "var(--primary)" },
    ]);
  }, [patchField, readPersonaStats]);

  const updateCustomFields = useCallback(
    (fields: CustomTrackerField[]) =>
      patchPlayerStats("customTrackerFields", reconcileListUpdate(readCustomFields(), customFields, fields)),
    [customFields, patchPlayerStats, readCustomFields],
  );

  return {
    addCharacter,
    addInventoryItem,
    addPersonaStat,
    addQuest,
    avatarFileInputRef,
    handleAvatarFileInputChange,
    openAvatarUpload,
    avatarRemovalKey,
    avatarBodyControl,
    closeAvatarBodyControl: () => setAvatarBodyControl(null),
    openAvatarBodyControl,
    updateAvatarPath,
    removeAvatar,
    removeCharacter,
    removeInventoryItem,
    removeQuest,
    savePersonaStatus,
    updateCharacter,
    updateCustomFields,
    updateInventoryItem,
    updatePersonaStats,
    updateQuest,
  };
}
