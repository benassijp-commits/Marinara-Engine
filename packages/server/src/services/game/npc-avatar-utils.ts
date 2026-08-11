import type { GameNpc } from "@marinara-engine/shared";
import { existsSync } from "fs";
import { join } from "path";

export const BUILT_IN_MARI_AVATAR = "/sprites/mari/Mari_profile.png";
export const NPC_AVATAR_FILE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"] as const;

export function findStoredNpcAvatarFile(directory: string, safeName: string): {
  extension: (typeof NPC_AVATAR_FILE_EXTENSIONS)[number];
  path: string;
} | null {
  for (const extension of NPC_AVATAR_FILE_EXTENSIONS) {
    const path = join(directory, `${safeName}${extension}`);
    if (existsSync(path)) return { extension, path };
  }
  return null;
}

export function npcAvatarSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeNpcName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/'/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMariNpcName(name: unknown): boolean {
  if (typeof name !== "string") return false;
  const normalized = normalizeNpcName(name);
  return normalized === "mari" || normalized === "professor mari";
}

export function isInvalidBuiltInMariNpcAvatar(npc: Pick<GameNpc, "name" | "avatarUrl">): boolean {
  const avatarPath = typeof npc.avatarUrl === "string" ? npc.avatarUrl.split("?")[0] : "";
  return avatarPath === BUILT_IN_MARI_AVATAR && !isMariNpcName(npc.name);
}

export function sanitizeGameNpcAvatarUrls(npcs: GameNpc[]): GameNpc[] {
  let changed = false;
  const sanitized = npcs.map((npc) => {
    const { met: _met, ...withoutMet } = npc as GameNpc & { met?: unknown };
    const hasLegacyMet = "met" in npc;
    if (!isInvalidBuiltInMariNpcAvatar(withoutMet)) {
      if (hasLegacyMet) changed = true;
      return withoutMet;
    }
    changed = true;
    const { avatarUrl: _avatarUrl, ...rest } = withoutMet;
    return rest;
  });
  return changed ? sanitized : npcs;
}
