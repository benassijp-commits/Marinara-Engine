import { z } from "zod";
import type { ImagePromptMode } from "@marinara-engine/shared";
import type { BaseLLMProvider } from "../llm/base-provider.js";

const convertedTagsSchema = z
  .object({
    positiveTags: z.array(z.string().trim().min(1).max(120)).min(1).max(64),
    negativeTags: z.array(z.string().trim().min(1).max(120)).max(32).default([]),
  })
  .strict();

export type CharacterTrackerAvatarPrompt = z.infer<typeof convertedTagsSchema>;

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

export function parseCharacterTrackerAvatarTags(raw: string): CharacterTrackerAvatarPrompt | null {
  try {
    const parsed = convertedTagsSchema.parse(JSON.parse(stripCodeFence(raw)));
    const positiveTags = removeUnsupportedMeasurements(parsed.positiveTags);
    const negativeTags = removeUnsupportedMeasurements(parsed.negativeTags);
    if (positiveTags.length === 0) return null;
    return { positiveTags, negativeTags };
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
  sceneContext: string;
  debugMode?: boolean;
}): Promise<CharacterTrackerAvatarPrompt | null> {
  const system = `${conversionInstruction(input.promptMode)}
Convert the supplied character identity into tags for a single full-body character image.
Preserve visible physical identity, face, build, current clothing, accessories, and visually relevant adult sexual anatomy.
Remove all numeric measurements and quantities that do not have a reliable visual tag.
Use scene context only to resolve mutually exclusive current states such as footwear versus barefoot; do not turn story prose into tags.
Do not add style, quality, camera, pose, name, personality, or narrative tags.
Return JSON only with this exact shape: {"positiveTags":["tag"],"negativeTags":["tag"]}.`;
  const user = JSON.stringify({
    character: input.characterName,
    appearance: input.appearance,
    outfit: input.outfit,
    sceneContext: input.sceneContext.slice(-2000),
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
