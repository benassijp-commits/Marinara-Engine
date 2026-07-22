// ──────────────────────────────────────────────
// Routes: Avatar file serving
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { findImageStyleProfile, parseAgentSettingsRecord, type CharacterStat } from "@marinara-engine/shared";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { join, extname } from "path";
import { createLLMProvider } from "../services/llm/provider-registry.js";
import { createAgentsStorage } from "../services/storage/agents.storage.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import {
  convertCharacterTrackerAvatarToTags,
  convertCharacterTrackerSceneToTags,
  regenerateCharacterTrackerDescription,
} from "../services/image/character-tracker-avatar-prompt.js";
import { generateImage } from "../services/image/image-generation.js";
import { resolveConnectionImageDefaults } from "../services/image/image-generation-defaults.js";
import { loadImageGenerationUserSettings } from "../services/image/image-generation-settings.js";
import { compileImagePrompt } from "../services/image/image-prompt-compiler.js";
import {
  applyAvatarBodyControls,
  avatarBodyControlState,
  extractComfyAvatarPrompt,
  getAvatarBodyRuntimeSettings,
  getStoredAvatarBodyControl,
  initializeAvatarBodyRuntimeSettings,
  normalizeAvatarBodyValues,
  previewAvatarBodyRuntime,
  resetAvatarBodyRuntimeSettings,
  saveAvatarBodyRuntimeSettings,
  updateStoredAvatarBodyControl,
} from "../services/image/avatar-body-control.js";
import { resolveImageConnectionFallback } from "../services/generation/media-connection-fallback.js";
import { DATA_DIR } from "../utils/data-dir.js";
import { assertInsideDir, isAllowedImageBuffer } from "../utils/security.js";
import { resolveBaseUrl } from "./generate/generate-route-utils.js";

const AVATAR_DIR = join(DATA_DIR, "avatars");
const NPC_AVATAR_DIR = join(AVATAR_DIR, "npc");
const SOLO_SCENE_NEGATIVE = "multiple people, extra person, crowd, disembodied limbs";

function ensureDir() {
  if (!existsSync(AVATAR_DIR)) {
    mkdirSync(AVATAR_DIR, { recursive: true });
  }
}

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

function avatarRevision(filePath: string): string {
  return Math.trunc(statSync(filePath).mtimeMs).toString(36);
}

function removeOtherNpcAvatarVariants(npcDir: string, safeName: string, keepPath: string) {
  for (const ext of Object.keys(MIME_MAP)) {
    const candidate = assertInsideDir(npcDir, join(npcDir, `${safeName}${ext}`));
    if (candidate !== keepPath && existsSync(candidate)) rmSync(candidate, { force: true });
  }
}

function isValidFilename(name: string): boolean {
  return !name.includes("..") && !name.includes("/") && !name.includes("\\");
}

function slugifyCharacterName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function npcDirectory(chatId: string): string {
  return assertInsideDir(NPC_AVATAR_DIR, join(NPC_AVATAR_DIR, chatId));
}

function currentNpcPng(chatId: string, name: string): string | null {
  const safeName = slugifyCharacterName(name);
  if (!safeName) return null;
  const path = assertInsideDir(npcDirectory(chatId), join(npcDirectory(chatId), `${safeName}.png`));
  return existsSync(path) ? path : null;
}

export async function avatarsRoutes(app: FastifyInstance) {
  try {
    initializeAvatarBodyRuntimeSettings();
  } catch (error) {
    app.log.warn(error, "Avatar body runtime settings are invalid; built-in defaults remain active");
  }
  const agents = createAgentsStorage(app.db);
  const characters = createCharactersStorage(app.db);
  const chats = createChatsStorage(app.db);
  const connections = createConnectionsStorage(app.db);

  const resolveTrackerImageConnection = async () => {
    const trackerAgent = await agents.getByType("character-tracker");
    if (!trackerAgent) throw new Error("Character Tracker is not configured");
    const trackerSettings = parseAgentSettingsRecord(trackerAgent.settings);
    const imageConnectionId =
      typeof trackerSettings.imageConnectionId === "string" ? trackerSettings.imageConnectionId.trim() : "";
    if (!imageConnectionId) throw new Error("Character Tracker has no image generation connection configured");
    const imageConnection = await connections.getWithKey(imageConnectionId);
    if (!imageConnection) throw new Error("Character Tracker image connection could not be resolved");
    return imageConnection;
  };

  /** Read and update the live NPC avatar body classification/prompt settings. */
  app.get("/body-settings", async () => getAvatarBodyRuntimeSettings());

  app.post("/body-settings/preview", async (req, reply) => {
    const body = req.body as { cellKey?: unknown; kind?: unknown; name?: unknown } | null;
    if (typeof body?.cellKey !== "string" || (body.kind !== "positive" && body.kind !== "loras") || typeof body.name !== "string") {
      return reply.status(400).send({ error: "cellKey, kind, and name are required" });
    }
    try {
      return previewAvatarBodyRuntime(body.cellKey, body.kind, body.name);
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "Invalid avatar body preview" });
    }
  });

  app.put("/body-settings", async (req, reply) => {
    try {
      return saveAvatarBodyRuntimeSettings(req.body);
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "Invalid avatar body settings" });
    }
  });

  app.delete("/body-settings", async () => resetAvatarBodyRuntimeSettings());

  /** Serve an avatar image file. */
  app.get("/file/:filename", async (req, reply) => {
    ensureDir();
    const { filename } = req.params as { filename: string };

    if (!isValidFilename(filename)) {
      return reply.status(400).send({ error: "Invalid filename" });
    }

    const filePath = assertInsideDir(AVATAR_DIR, join(AVATAR_DIR, filename));
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Not found" });
    }

    const ext = extname(filename).toLowerCase();
    const { createReadStream } = await import("fs");
    const stream = createReadStream(filePath);
    return reply
      .header("Content-Type", MIME_MAP[ext] ?? "application/octet-stream")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(stream);
  });

  /** Serve an NPC avatar image by chatId and filename. */
  app.get("/npc/:chatId/:filename", async (req, reply) => {
    const { chatId, filename } = req.params as { chatId: string; filename: string };

    if (!isValidFilename(chatId) || !isValidFilename(filename)) {
      return reply.status(400).send({ error: "Invalid path" });
    }

    const filePath = assertInsideDir(NPC_AVATAR_DIR, join(NPC_AVATAR_DIR, chatId, filename));
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Not found" });
    }

    const ext = extname(filename).toLowerCase();
    const { createReadStream } = await import("fs");
    const stream = createReadStream(filePath);
    const hasRevision = typeof (req.query as { v?: unknown }).v === "string";
    return reply
      .header("Content-Type", MIME_MAP[ext] ?? "application/octet-stream")
      .header("Cache-Control", hasRevision ? "public, max-age=31536000, immutable" : "no-store")
      .send(stream);
  });

  /** Delete every stored image variant for an NPC avatar in a chat. */
  app.delete("/npc/:chatId", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    const { name } = req.query as { name?: unknown };

    if (!isValidFilename(chatId)) {
      return reply.status(400).send({ error: "Invalid chatId" });
    }
    if (typeof name !== "string" || !name.trim()) {
      return reply.status(400).send({ error: "Missing character name" });
    }

    const safeName = slugifyCharacterName(name);
    if (!safeName) {
      return reply.status(400).send({ error: "Invalid character name" });
    }

    const npcDir = assertInsideDir(NPC_AVATAR_DIR, join(NPC_AVATAR_DIR, chatId));
    let deleted = 0;
    for (const ext of Object.keys(MIME_MAP)) {
      const filePath = assertInsideDir(npcDir, join(npcDir, `${safeName}${ext}`));
      if (!existsSync(filePath)) continue;
      rmSync(filePath, { force: true });
      deleted += 1;
    }

    return reply.send({ deleted });
  });

  /** Read the persisted body controller and calculate current automatic values from tracker stats. */
  app.post("/npc/:chatId/body-control/state", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    const { characterId, name, stats } = req.body as { characterId?: unknown; name?: unknown; stats?: unknown };
    if (!isValidFilename(chatId)) return reply.status(400).send({ error: "Invalid chatId" });
    if (typeof characterId !== "string" || !characterId.trim() || typeof name !== "string" || !name.trim()) {
      return reply.status(400).send({ error: "Character ID and name are required" });
    }
    const dir = npcDirectory(chatId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const png = currentNpcPng(chatId, name);
    const canLock = !!png && !!extractComfyAvatarPrompt(readFileSync(png));
    return avatarBodyControlState(
      getStoredAvatarBodyControl(dir, characterId),
      Array.isArray(stats) ? (stats as CharacterStat[]) : [],
      canLock,
    );
  });

  /** Persist Auto/Manual and manual slider values without generating an image. */
  app.patch("/npc/:chatId/body-control", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    const { characterId, name, mode, manual, stats } = req.body as Record<string, unknown>;
    if (!isValidFilename(chatId)) return reply.status(400).send({ error: "Invalid chatId" });
    if (typeof characterId !== "string" || !characterId.trim()) {
      return reply.status(400).send({ error: "Character ID is required" });
    }
    if (mode !== "auto" && mode !== "manual") return reply.status(400).send({ error: "Invalid control mode" });
    const dir = npcDirectory(chatId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const stored = updateStoredAvatarBodyControl(dir, characterId, {
      mode,
      manual: normalizeAvatarBodyValues(manual as Record<string, number> | undefined),
    });
    const png = typeof name === "string" ? currentNpcPng(chatId, name) : null;
    const canLock = !!png && !!extractComfyAvatarPrompt(readFileSync(png));
    return avatarBodyControlState(stored, Array.isArray(stats) ? (stats as CharacterStat[]) : [], canLock);
  });

  /** Fix the current ComfyUI PNG prompt and seed as the character's structural reference. */
  app.post("/npc/:chatId/body-control/lock", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    const { characterId, name, stats } = req.body as { characterId?: unknown; name?: unknown; stats?: unknown };
    if (!isValidFilename(chatId)) return reply.status(400).send({ error: "Invalid chatId" });
    if (typeof characterId !== "string" || !characterId.trim() || typeof name !== "string" || !name.trim()) {
      return reply.status(400).send({ error: "Character ID and name are required" });
    }
    const png = currentNpcPng(chatId, name);
    const lockedPrompt = png ? extractComfyAvatarPrompt(readFileSync(png)) : null;
    if (!lockedPrompt) {
      return reply.status(400).send({ error: "The current avatar has no compatible ComfyUI prompt and seed metadata" });
    }
    const dir = npcDirectory(chatId);
    const stored = updateStoredAvatarBodyControl(dir, characterId, { lockedPrompt });
    return avatarBodyControlState(stored, Array.isArray(stats) ? (stats as CharacterStat[]) : [], true);
  });

  app.delete("/npc/:chatId/body-control/lock", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    const { characterId } = req.query as { characterId?: unknown };
    if (!isValidFilename(chatId)) return reply.status(400).send({ error: "Invalid chatId" });
    if (typeof characterId !== "string" || !characterId.trim()) {
      return reply.status(400).send({ error: "Character ID is required" });
    }
    const dir = npcDirectory(chatId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const stored = updateStoredAvatarBodyControl(dir, characterId, { lockedPrompt: undefined });
    return avatarBodyControlState(stored, [], false);
  });

  /** Regenerate from the fixed final prompt with only body-control tag families replaced. */
  app.post("/npc/:chatId/regenerate-locked", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    const { characterId, name, stats, previewOnly, promptOverride, negativePromptOverride } = req.body as {
      characterId?: unknown;
      name?: unknown;
      stats?: unknown;
      previewOnly?: unknown;
      promptOverride?: unknown;
      negativePromptOverride?: unknown;
    };
    if (!isValidFilename(chatId)) return reply.status(400).send({ error: "Invalid chatId" });
    if (typeof characterId !== "string" || !characterId.trim() || typeof name !== "string" || !name.trim()) {
      return reply.status(400).send({ error: "Character ID and name are required" });
    }
    const dir = npcDirectory(chatId);
    const stored = getStoredAvatarBodyControl(dir, characterId);
    if (!stored.lockedPrompt) return reply.status(400).send({ error: "Fix this avatar structure before regenerating it" });

    try {
      const imageConnection = await resolveTrackerImageConnection();
      const imageDefaults = resolveConnectionImageDefaults(imageConnection);
      if (!imageDefaults || imageDefaults.service !== "comfyui" || !imageDefaults.comfyui) {
        return reply.status(400).send({ error: "Fixed avatar regeneration currently requires a ComfyUI connection" });
      }
      const controls = avatarBodyControlState(
        stored,
        Array.isArray(stats) ? (stats as CharacterStat[]) : [],
        true,
      ).effective;
      const controlledPrompt = applyAvatarBodyControls(stored.lockedPrompt, controls);
      const finalPositive = typeof promptOverride === "string" && promptOverride.trim()
        ? promptOverride.trim()
        : controlledPrompt.positive;
      const finalNegative = typeof negativePromptOverride === "string"
        ? negativePromptOverride.trim()
        : controlledPrompt.negative;
      if (previewOnly === true) {
        return { prompt: finalPositive, negativePrompt: finalNegative, seed: controlledPrompt.seed };
      }
      const lockedDefaults = {
        ...imageDefaults,
        seed: controlledPrompt.seed,
        comfyui: { ...imageDefaults.comfyui, promptPrefix: "", negativePromptPrefix: "" },
      };
      const imageSettings = await loadImageGenerationUserSettings(app.db);
      const result = await generateImage(
        imageConnection.model || "",
        imageConnection.baseUrl || "https://image.pollinations.ai",
        imageConnection.apiKey || "",
        imageConnection.imageService || imageConnection.imageGenerationSource || imageConnection.model || "",
        {
          prompt: finalPositive,
          negativePrompt: finalNegative || undefined,
          model: imageConnection.model || "",
          width: imageSettings.portrait.width,
          height: imageSettings.portrait.height,
          imageEndpointId: imageConnection.imageEndpointId || undefined,
          comfyWorkflow: imageConnection.comfyuiWorkflow || undefined,
          imageDefaults: lockedDefaults,
          fallback: await resolveImageConnectionFallback(connections, imageConnection.id),
        },
      );
      const safeName = slugifyCharacterName(name);
      const filePath = assertInsideDir(dir, join(dir, `${safeName}.png`));
      const temporaryPath = assertInsideDir(dir, join(dir, `.${safeName}-${Date.now()}.png.tmp`));
      try {
        writeFileSync(temporaryPath, Buffer.from(result.base64, "base64"));
        renameSync(temporaryPath, filePath);
        removeOtherNpcAvatarVariants(dir, safeName, filePath);
      } finally {
        if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
      }
      return { avatarPath: `/api/avatars/npc/${chatId}/${safeName}.png?v=${avatarRevision(filePath)}` };
    } catch (error) {
      req.log.error(error, "Fixed Character Tracker avatar regeneration failed");
      return reply.status(500).send({ error: error instanceof Error ? error.message : "Avatar regeneration failed" });
    }
  });

  /** Build a fresh, editable appearance/outfit proposal without reusing tracker text. */
  app.post("/npc/:chatId/description-preview", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    const { characterId, name } = req.body as { characterId?: unknown; name?: unknown };
    if (!isValidFilename(chatId)) return reply.status(400).send({ error: "Invalid chatId" });
    if (typeof name !== "string" || !name.trim()) {
      return reply.status(400).send({ error: "Character name is required" });
    }

    const chat = await chats.getById(chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    const trackerAgent = await agents.getByType("character-tracker");
    if (!trackerAgent) return reply.status(400).send({ error: "Character Tracker is not configured" });
    const agentConnection = trackerAgent.connectionId
      ? await connections.getWithKey(trackerAgent.connectionId)
      : await connections.getDefaultForAgents();
    if (!agentConnection) {
      return reply.status(400).send({ error: "Character Tracker language-model connection could not be resolved" });
    }

    let cardContext: Record<string, unknown> | null = null;
    if (typeof characterId === "string" && characterId.trim() && !characterId.startsWith("manual-")) {
      const card = await characters.getById(characterId.trim());
      if (card) {
        try {
          const data = typeof card.data === "string" ? JSON.parse(card.data) : card.data;
          if (data && typeof data === "object" && !Array.isArray(data)) {
            const record = data as Record<string, unknown>;
            const extensions =
              record.extensions && typeof record.extensions === "object" && !Array.isArray(record.extensions)
                ? (record.extensions as Record<string, unknown>)
                : {};
            cardContext = {
              name: record.name,
              description: record.description,
              canonicalAppearance: extensions.appearance,
              scenario: record.scenario,
              firstMessage: record.first_mes,
              creatorNotes: record.creator_notes,
            };
          }
        } catch {
          cardContext = null;
        }
      }
    }

    const messages = await chats.listMessages(chatId);
    const sceneContext = messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-8)
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n\n")
      .slice(-12000);
    const provider = createLLMProvider(
      agentConnection.provider,
      resolveBaseUrl(agentConnection),
      agentConnection.apiKey,
      agentConnection.maxContext,
      agentConnection.openrouterProvider,
      agentConnection.maxTokensOverride,
    );

    try {
      const proposal = await regenerateCharacterTrackerDescription({
        provider,
        model: agentConnection.model,
        characterName: name.trim(),
        cardContext,
        sceneContext,
      });
      if (!proposal) {
        return reply.status(422).send({ error: "The model could not produce usable appearance or outfit text" });
      }
      const source = cardContext ? "card_and_scene" : "scene_fallback";
      return {
        ...proposal,
        source,
        warnings: cardContext ? [] : ["No matching character card was found; this proposal uses recent scene text only."],
      };
    } catch (error) {
      req.log.error(error, "Character Tracker description preview failed");
      return reply.status(500).send({
        error: error instanceof Error ? error.message : "Failed to regenerate appearance and outfit",
      });
    }
  });

  /** Regenerate one tracker NPC with the Character Tracker image pipeline. */
  app.post("/npc/:chatId/regenerate", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    const { characterId, name, appearance, outfit, stats, previewOnly, promptOverride, negativePromptOverride } = req.body as {
      characterId?: unknown;
      name?: unknown;
      appearance?: unknown;
      outfit?: unknown;
      stats?: unknown;
      previewOnly?: unknown;
      promptOverride?: unknown;
      negativePromptOverride?: unknown;
    };
    if (!isValidFilename(chatId)) return reply.status(400).send({ error: "Invalid chatId" });
    if (typeof name !== "string" || !name.trim() || typeof appearance !== "string" || !appearance.trim()) {
      return reply.status(400).send({ error: "Character name and appearance are required" });
    }

    const trackerAgent = await agents.getByType("character-tracker");
    if (!trackerAgent) return reply.status(400).send({ error: "Character Tracker is not configured" });
    const trackerSettings = parseAgentSettingsRecord(trackerAgent.settings);
    const imageConnectionId =
      typeof trackerSettings.imageConnectionId === "string" ? trackerSettings.imageConnectionId.trim() : "";
    if (!imageConnectionId) {
      return reply.status(400).send({ error: "Character Tracker has no image generation connection configured" });
    }

    const imageConnection = await connections.getWithKey(imageConnectionId);
    const agentConnection = trackerAgent.connectionId
      ? await connections.getWithKey(trackerAgent.connectionId)
      : await connections.getDefaultForAgents();
    if (!imageConnection || !agentConnection) {
      return reply.status(400).send({ error: "Character Tracker connection could not be resolved" });
    }

    const chat = await chats.getById(chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    let chatMeta: Record<string, unknown> = {};
    try {
      chatMeta = typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : ((chat.metadata ?? {}) as Record<string, unknown>);
    } catch {
      chatMeta = {};
    }
    const messages = await chats.listMessages(chatId);
    const sceneContext = messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-8)
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n\n")
      .slice(-12000);
    const imageSettings = await loadImageGenerationUserSettings(app.db);
    const styleProfileId =
      ((chatMeta.gameSetupConfig as Record<string, unknown> | undefined)?.imageStyleProfileId as string | undefined) ??
      (chatMeta.imageStyleProfileId as string | undefined) ??
      null;
    const styleProfile = findImageStyleProfile(imageSettings.styleProfiles, styleProfileId);
    const tagPromptMode =
      styleProfile.promptMode === "danbooru" || styleProfile.promptMode === "tagged"
        ? styleProfile.promptMode
        : null;
    const agentProvider = createLLMProvider(
      agentConnection.provider,
      resolveBaseUrl(agentConnection),
      agentConnection.apiKey,
      agentConnection.maxContext,
      agentConnection.openrouterProvider,
      agentConnection.maxTokensOverride,
    );

    try {
      const hasPromptOverride = typeof promptOverride === "string" && promptOverride.trim().length > 0;
      let sceneTags: string[] = [];
      const converted = !hasPromptOverride && tagPromptMode
        ? await Promise.all([
            convertCharacterTrackerAvatarToTags({
              provider: agentProvider,
              model: agentConnection.model,
              promptMode: tagPromptMode,
              characterName: name,
              appearance,
              outfit: typeof outfit === "string" ? outfit : "",
            }),
            convertCharacterTrackerSceneToTags({
              provider: agentProvider,
              model: agentConnection.model,
              promptMode: tagPromptMode,
              characterName: name,
              sceneContext,
            }).catch((error) => {
              req.log.warn(error, "Character Tracker scene tag conversion failed; continuing without scene tags");
              return null;
            }),
          ]).then(([identity, scene]) => {
            sceneTags = scene?.sceneTags ?? [];
            return identity;
          })
        : null;
      if (!hasPromptOverride && tagPromptMode && !converted) {
        throw new Error("Character appearance tag conversion returned no valid tags");
      }

      const imageDefaults = resolveConnectionImageDefaults(imageConnection);
      const compiledPrompt = hasPromptOverride
        ? {
            prompt: (promptOverride as string).trim(),
            negativePrompt: typeof negativePromptOverride === "string" ? negativePromptOverride.trim() : "",
          }
        : compileImagePrompt({
            kind: "portrait",
            prompt: "single character, solo, full body, detailed face, high quality",
            negativePrompt: converted?.negativeTags.join(", ") || undefined,
            protectedPositive: converted
              ? [...converted.positiveTags, ...sceneTags].join(", ")
              : [appearance, typeof outfit === "string" ? outfit : ""].filter(Boolean).join(", "),
            hardNegative: sceneTags.length > 0 ? SOLO_SCENE_NEGATIVE : undefined,
            styleProfiles: imageSettings.styleProfiles,
            styleProfileId,
            imageDefaults,
          });
      const shouldApplyBodyControls = !hasPromptOverride && typeof characterId === "string" && characterId.trim().length > 0;
      const finalCompiledPrompt = shouldApplyBodyControls
        ? applyAvatarBodyControls(
            {
              positive: compiledPrompt.prompt,
              negative: compiledPrompt.negativePrompt,
              seed: imageDefaults?.seed ?? -1,
            },
            avatarBodyControlState(
              getStoredAvatarBodyControl(npcDirectory(chatId), characterId),
              Array.isArray(stats) ? (stats as CharacterStat[]) : [],
              false,
            ).effective,
          )
        : null;
      const sendsExactFinalPrompt = hasPromptOverride || !!finalCompiledPrompt;
      const requestDefaults = sendsExactFinalPrompt && imageDefaults?.comfyui
        ? { ...imageDefaults, comfyui: { ...imageDefaults.comfyui, promptPrefix: "", negativePromptPrefix: "" } }
        : imageDefaults;
      const requestPrompt = finalCompiledPrompt?.positive ?? compiledPrompt.prompt;
      const requestNegativePrompt = finalCompiledPrompt?.negative ?? compiledPrompt.negativePrompt;
      if (previewOnly === true) {
        return {
          prompt: requestPrompt,
          negativePrompt: requestNegativePrompt,
          seed: imageDefaults?.seed ?? -1,
        };
      }
      const result = await generateImage(
        imageConnection.model || "",
        imageConnection.baseUrl || "https://image.pollinations.ai",
        imageConnection.apiKey || "",
        imageConnection.imageService || imageConnection.imageGenerationSource || imageConnection.model || "",
        {
          prompt: requestPrompt,
          negativePrompt: requestNegativePrompt || undefined,
          model: imageConnection.model || "",
          width: imageSettings.portrait.width,
          height: imageSettings.portrait.height,
          imageEndpointId: imageConnection.imageEndpointId || undefined,
          comfyWorkflow: imageConnection.comfyuiWorkflow || undefined,
          imageDefaults: requestDefaults,
          fallback: await resolveImageConnectionFallback(connections, imageConnection.id),
        },
      );

      const safeName = slugifyCharacterName(name);
      const npcDir = assertInsideDir(NPC_AVATAR_DIR, join(NPC_AVATAR_DIR, chatId));
      if (!existsSync(npcDir)) mkdirSync(npcDir, { recursive: true });
      const filePath = assertInsideDir(npcDir, join(npcDir, `${safeName}.png`));
      const temporaryPath = assertInsideDir(npcDir, join(npcDir, `.${safeName}-${Date.now()}.png.tmp`));
      try {
        writeFileSync(temporaryPath, Buffer.from(result.base64, "base64"));
        renameSync(temporaryPath, filePath);
        removeOtherNpcAvatarVariants(npcDir, safeName, filePath);
      } finally {
        if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
      }
      return { avatarPath: `/api/avatars/npc/${chatId}/${safeName}.png?v=${avatarRevision(filePath)}` };
    } catch (error) {
      req.log.error(error, "Character Tracker avatar regeneration failed");
      return reply.status(500).send({ error: error instanceof Error ? error.message : "Avatar regeneration failed" });
    }
  });

  /** Upload an NPC avatar (base64 data URL). */
  app.post("/npc/:chatId", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    const { name, avatar, characterId } = req.body as { name: string; avatar: string; characterId?: string };

    if (!isValidFilename(chatId)) {
      return reply.status(400).send({ error: "Invalid chatId" });
    }
    if (!name || !avatar) {
      return reply.status(400).send({ error: "Missing name or avatar" });
    }

    // Extract base64 data from data URL
    const match = avatar.match(/^data:image\/([\w.+-]+);base64,(.+)$/);
    if (!match) {
      return reply.status(400).send({ error: "Invalid avatar format — expected base64 data URL" });
    }

    const safeName = slugifyCharacterName(name);
    if (!safeName) {
      return reply.status(400).send({ error: "Invalid character name" });
    }

    const npcDir = join(NPC_AVATAR_DIR, chatId);
    if (!existsSync(npcDir)) mkdirSync(npcDir, { recursive: true });

    const hintedExt = `.${match[1]!.replace("+xml", "")}`;
    const imageBuffer = Buffer.from(match[2]!, "base64");
    const image = isAllowedImageBuffer(imageBuffer, hintedExt);
    if (!image) {
      return reply.status(400).send({ error: "Unsupported or invalid avatar image" });
    }
    const filename = `${safeName}.${image.ext}`;
    const filePath = assertInsideDir(npcDir, join(npcDir, filename));
    const temporaryPath = assertInsideDir(
      npcDir,
      join(npcDir, `.${safeName}-${Date.now()}-${Math.random().toString(36).slice(2)}.${image.ext}.tmp`),
    );
    try {
      writeFileSync(temporaryPath, imageBuffer);
      renameSync(temporaryPath, filePath);
      removeOtherNpcAvatarVariants(npcDir, safeName, filePath);
      if (typeof characterId === "string" && characterId.trim()) {
        updateStoredAvatarBodyControl(npcDir, characterId, { lockedPrompt: undefined });
      }
    } finally {
      if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
    }

    return reply.send({ avatarPath: `/api/avatars/npc/${chatId}/${filename}?v=${avatarRevision(filePath)}` });
  });
}
