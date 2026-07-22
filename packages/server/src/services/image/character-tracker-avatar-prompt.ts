import { z } from "zod";
import type { ImagePromptMode } from "@marinara-engine/shared";
import type { BaseLLMProvider } from "../llm/base-provider.js";
import { isAvatarBodyControllerOwnedTag } from "./avatar-body-control.js";

const convertedTagsSchema = z
  .object({
    positiveTags: z.array(z.string().trim().min(1).max(120)).min(1).max(64),
    negativeTags: z.array(z.string().trim().min(1).max(120)).max(32).default([]),
  })
  .strict();

const convertedSceneTagsSchema = z
  .object({
    sceneTags: z.array(z.string().trim().min(1).max(120)).max(16).default([]),
  })
  .strict();

const refreshedDescriptionSchema = z
  .object({
    appearance: z.string().trim().min(1).max(1200).nullable(),
    outfit: z.string().trim().min(1).max(1200).nullable(),
  })
  .strict();

export type CharacterTrackerAvatarPrompt = z.infer<typeof convertedTagsSchema>;
export type CharacterTrackerScenePrompt = z.infer<typeof convertedSceneTagsSchema>;
export type CharacterTrackerDescriptionRefresh = z.infer<typeof refreshedDescriptionSchema>;

function stripCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function removeUnsupportedMeasurements(tags: string[]): string[] {
  return tags.filter((tag) => {
    const clean = tag.trim();
    if (/^\d+(?:girl|boy|other)s?$/i.test(clean)) return true;
    return !/\b\d+(?:\.\d+)?\s*(?:cm|mm|m|kg|g|lb|lbs|ml|l|liters?|litres?|inches?|inch|in)\b/i.test(clean);
  });
}

function removeBodyControllerTags(tags: string[]): string[] {
  return tags.filter((tag) => !isAvatarBodyControllerOwnedTag(tag));
}

function removeMultiSubjectTags(tags: string[]): string[] {
  return tags.filter((tag) => {
    const value = tag.trim().replaceAll("_", " ").toLowerCase();
    return !(
      /^(?:\d+(?:girls?|boys?|others?)|multiple (?:people|girls?|boys?|characters?)|group|crowd|couple|duo)$/.test(
        value,
      ) ||
      /\b(?:looking at another|looking at another person|holding hands|hugging|kissing|talking to another|interacting with another)\b/.test(
        value,
      )
    );
  });
}

function compactTrackerDescription(value: string | null, maxLength = 350): string | null {
  if (!value) return null;
  if (value.trim().toLowerCase() === "null") return null;
  const withoutNumbers = value
    .replace(/\b\d+(?:\.\d+)?\s*(?:cm|mm|m|kg|g|lb|lbs|inches?|inch|in|years? old)\b/gi, "")
    .replace(/\b\d+(?:\.\d+)?\b/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,;])\s*\1+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,;:.\s]+|[,;:\s]+$/g, "")
    .trim();
  if (!withoutNumbers) return null;
  if (withoutNumbers.length <= maxLength) return withoutNumbers;
  const shortened = withoutNumbers.slice(0, maxLength + 1);
  const boundary = Math.max(shortened.lastIndexOf(","), shortened.lastIndexOf(";"), shortened.lastIndexOf("."));
  return `${shortened.slice(0, boundary >= Math.floor(maxLength * 0.6) ? boundary : maxLength).trim()}${
    shortened.includes(".") ? "." : ""
  }`;
}

export function parseCharacterTrackerAvatarTags(raw: string): CharacterTrackerAvatarPrompt | null {
  try {
    const parsed = convertedTagsSchema.parse(JSON.parse(stripCodeFence(raw)));
    const positiveTags = removeBodyControllerTags(removeUnsupportedMeasurements(parsed.positiveTags));
    const negativeTags = removeBodyControllerTags(removeUnsupportedMeasurements(parsed.negativeTags));
    if (positiveTags.length === 0) return null;
    return { positiveTags, negativeTags };
  } catch {
    return null;
  }
}

export function parseCharacterTrackerSceneTags(raw: string): CharacterTrackerScenePrompt | null {
  try {
    const parsed = convertedSceneTagsSchema.parse(JSON.parse(stripCodeFence(raw)));
    const sceneTags = removeMultiSubjectTags(
      removeBodyControllerTags(removeUnsupportedMeasurements(parsed.sceneTags)),
    );
    return { sceneTags };
  } catch {
    return null;
  }
}

export function parseCharacterTrackerDescriptionRefresh(raw: string): CharacterTrackerDescriptionRefresh | null {
  try {
    const parsed = refreshedDescriptionSchema.parse(JSON.parse(stripCodeFence(raw)));
    const appearance = compactTrackerDescription(parsed.appearance);
    const outfit = compactTrackerDescription(parsed.outfit);
    if (!appearance && !outfit) return null;
    return { appearance, outfit };
  } catch {
    return null;
  }
}

function conversionInstruction(promptMode: ImagePromptMode): string {
  return promptMode === "danbooru"
    ? "Use concise atomic Danbooru/Illustrious/NoobAI tags. Prefer established booru vocabulary."
    : "Use concise atomic comma-style visual tags suitable for an anime image checkpoint.";
}

export async function convertCharacterTrackerAvatarToTags(input: {
  provider: BaseLLMProvider;
  model: string;
  promptMode: Extract<ImagePromptMode, "tagged" | "danbooru">;
  characterName: string;
  appearance: string;
  outfit: string;
  debugMode?: boolean;
}): Promise<CharacterTrackerAvatarPrompt | null> {
  const system = `${conversionInstruction(input.promptMode)}
Convert only the supplied character appearance and outfit into identity tags for a single-character image.

Treat appearance and outfit as authoritative visual identity data. Preserve every supplied identity, face, structural trait, clothing item, accessory, and distinguishing feature that is not managed by the body controller. Never replace, reinterpret, contradict, weaken, or omit those traits.

The body controller separately supplies the final weighted tags for muscularity and muscle mass, body fat and weight distribution, vascularity, height/scale, and cock/penis/bulge size. Omit every tag from those controlled families from both positiveTags and negativeTags. Do not infer replacements or synonyms for them. Preserve unrelated structural identity such as species, apparent age, face, shoulder shape, body hair, skin, markings, scars, and limb anatomy.

Do not add action, pose, facial expression, interaction, environment, scenery, nearby objects, camera, composition, style, or quality tags. A separate scene converter supplies them. An object counts as identity only when it is explicitly worn or is a persistent part of the supplied outfit.

Remove all numeric measurements and quantities that do not have a reliable visual tag.

Do not invent visual details. Do not add the character name, personality, or abstract narrative tags.

Order positive tags by priority: authoritative physical identity and face, uncontrolled structural traits, then authoritative clothing and accessories.

Return JSON only with this exact shape: {"positiveTags":["tag"],"negativeTags":["tag"]}.`;
  const user = JSON.stringify({
    character: input.characterName,
    appearance: input.appearance,
    outfit: input.outfit,
  });
  const result = await input.provider.chatComplete(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    {
      model: input.model,
      temperature: 0.1,
      maxTokens: 600,
      stream: false,
      responseFormat: { type: "json_object" },
      debugMode: input.debugMode,
    },
  );
  return parseCharacterTrackerAvatarTags(result.content ?? "");
}

export async function convertCharacterTrackerSceneToTags(input: {
  provider: BaseLLMProvider;
  model: string;
  promptMode: Extract<ImagePromptMode, "tagged" | "danbooru">;
  characterName: string;
  sceneContext: string;
  debugMode?: boolean;
}): Promise<CharacterTrackerScenePrompt | null> {
  if (!input.sceneContext.trim()) return { sceneTags: [] };
  const system = `${conversionInstruction(input.promptMode)}
You have one task: convert the latest visible moment of the named target character into scene-only image tags.

Include only details explicitly and unambiguously belonging to the target: current action, compatible pose, visible facial expression, objects they are holding or using, and the immediate environment. Include one framing tag suited to the action when the scene supports it.

The final image must show exactly one character. Never include another character, a crowd, a couple, multiple people, or body parts entering from outside the frame. When the target interacts with another person, keep only the target's solo-safe action, pose, expression, and owned object. Omit the other person rather than inventing a replacement.

Do not include identity, anatomy, body shape, muscularity, fat, height, penis/cock/bulge, vascularity, clothing, hairstyle, species, style, quality, character name, personality, dialogue, thoughts, memories, plans, or abstract narrative meaning. Other systems supply identity, outfit, body, and style.

Use only the most recent currently depicted moment. Exclude superseded actions, off-screen details, figurative effects, and anything whose ownership is ambiguous. Do not invent props or scenery.

Return 2 to 12 useful atomic tags when a concrete visual moment exists. Return an empty array when it does not.
Return JSON only with this exact shape: {"sceneTags":["tag"]}.`;
  const result = await input.provider.chatComplete(
    [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          targetCharacter: input.characterName,
          latestScene: input.sceneContext.slice(-3000),
        }),
      },
    ],
    {
      model: input.model,
      temperature: 0.1,
      maxTokens: 240,
      stream: false,
      responseFormat: { type: "json_object" },
      debugMode: input.debugMode,
    },
  );
  return parseCharacterTrackerSceneTags(result.content ?? "");
}

export async function regenerateCharacterTrackerDescription(input: {
  provider: BaseLLMProvider;
  model: string;
  characterName: string;
  cardContext: Record<string, unknown> | null;
  sceneContext: string;
  debugMode?: boolean;
}): Promise<CharacterTrackerDescriptionRefresh | null> {
  const system = `Rebuild one Character Tracker NPC from the character card and recent scene. Write English JSON only.

appearance: one concise sentence, maximum 350 characters. Preserve established physical identity and current visible conditions: age group, species, build, face, hair, eyes, skin or fur, markings, scars, tattoos, unusual anatomy, injuries, dirt, or wetness. Exclude clothing, action, expression, environment, and image tags.

outfit: one concise sentence, maximum 350 characters. Preserve every currently worn garment, layer, color, material, pattern, footwear item, accessory, and wearable equipment. Latest explicit clothing changes override the card.

Use only details belonging to the named target. Preserve uncommon specifics, prefer the latest still-current state, and do not invent. Never output digits, quantities, ages, or measurements. Return null only when no reliable evidence exists.

Return exactly: {"appearance":"English text or null","outfit":"English text or null"}.`;
  const result = await input.provider.chatComplete(
    [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          targetCharacter: input.characterName,
          characterCard: input.cardContext,
          recentScene: input.sceneContext.slice(-12000),
        }),
      },
    ],
    {
      model: input.model,
      temperature: 0.2,
      maxTokens: 700,
      stream: false,
      responseFormat: { type: "json_object" },
      debugMode: input.debugMode,
    },
  );
  return parseCharacterTrackerDescriptionRefresh(result.content ?? "");
}
