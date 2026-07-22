import type { AvatarBodyControlValues, CharacterStat } from "../types/game-state.js";

export const DEFAULT_AVATAR_BODY_CONTROLS: AvatarBodyControlValues = {
  muscularity: 30,
  bodyFat: 22,
  cock: 30,
};

export const AVATAR_BODY_REFERENCE_HEIGHT_CM = 175;

export interface AvatarBodyThresholdRule {
  id: string;
  label: string;
  maxExclusive: number | null;
  control: readonly [number, number];
  requiresFatBelowFirstThreshold?: boolean;
}

export interface AvatarBodyThresholdSettings {
  referenceCeilingKg: number;
  sizeRules: readonly AvatarBodyThresholdRule[];
  fatRules: readonly AvatarBodyThresholdRule[];
}

export const DEFAULT_AVATAR_BODY_THRESHOLD_SETTINGS: AvatarBodyThresholdSettings = {
  referenceCeilingKg: 600,
  sizeRules: [
    { id: "skinny", label: "Extremely Skinny", maxExclusive: 60, control: [0, 14.67], requiresFatBelowFirstThreshold: true },
    { id: "small", label: "Small", maxExclusive: 75, control: [14.67, 27.08] },
    { id: "average1", label: "Average 1", maxExclusive: 90, control: [27.08, 39.5] },
    { id: "muscular", label: "Muscular", maxExclusive: 120, control: [39.5, 52.67] },
    { id: "large", label: "Large", maxExclusive: 200, control: [52.67, 68.33] },
    { id: "extreme", label: "Extreme", maxExclusive: null, control: [68.33, 100] },
  ],
  fatRules: [
    { id: "muscle100", label: "100% muscular", maxExclusive: 10, control: [0, 17] },
    { id: "muscle75", label: "75% muscular / 25% fat", maxExclusive: 16, control: [17, 32.8] },
    { id: "balanced", label: "50% muscular / 50% fat", maxExclusive: 22, control: [32.8, 48.6] },
    { id: "muscle25", label: "25% muscular / 75% fat", maxExclusive: 35, control: [48.6, 66.5] },
    { id: "fat100", label: "100% fat", maxExclusive: null, control: [66.5, 100] },
  ],
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function statValue(stats: CharacterStat[], pattern: RegExp): number | null {
  const stat = stats.find((candidate) => pattern.test(candidate.name.trim()));
  return stat && Number.isFinite(stat.value) ? stat.value : null;
}

function heightValueCm(stats: CharacterStat[]): number {
  const stat = stats.find((candidate) => /^height(?:\s*\(\s*(?:cm|m)\s*\))?$/i.test(candidate.name.trim()));
  if (!stat || !Number.isFinite(stat.value) || stat.value <= 0) return AVATAR_BODY_REFERENCE_HEIGHT_CM;
  const explicitlyCentimeters = /\(\s*cm\s*\)/i.test(stat.name);
  const explicitlyMeters = /\(\s*m\s*\)/i.test(stat.name);
  if (explicitlyCentimeters) return stat.value;
  if (explicitlyMeters) return stat.value <= 10 ? stat.value * 100 : stat.value;
  return stat.value <= 10 ? stat.value * 100 : stat.value;
}

function ruleIndex(value: number, rules: readonly AvatarBodyThresholdRule[], start = 0): number {
  const relative = rules.slice(start).findIndex((rule) => rule.maxExclusive === null || value < rule.maxExclusive);
  return relative < 0 ? rules.length - 1 : start + relative;
}

function ruleLowerBound(rules: readonly AvatarBodyThresholdRule[], index: number): number {
  if (index <= 0) return 0;
  return rules[index - 1]?.maxExclusive ?? 0;
}

function interpolateRange(value: number, start: number, end: number, low: number, high: number): number {
  const progress = end === start ? 0 : (value - start) / (end - start);
  return low + (high - low) * clamp(progress, 0, 1);
}

function sizeRuleIndex(weightKg: number, bodyFatPercent: number, settings: AvatarBodyThresholdSettings): number {
  const firstSize = settings.sizeRules[0]!;
  const firstFatCeiling = settings.fatRules[0]?.maxExclusive ?? 0;
  const isSpecialSkinny =
    firstSize.requiresFatBelowFirstThreshold === true &&
    firstSize.maxExclusive !== null &&
    weightKg < firstSize.maxExclusive &&
    bodyFatPercent < firstFatCeiling;
  return isSpecialSkinny ? 0 : ruleIndex(weightKg, settings.sizeRules, 1);
}

function physicalValueToSlider(
  value: number,
  rules: readonly AvatarBodyThresholdRule[],
  index: number,
  finalCeiling: number,
  lowerOverride?: number,
): number {
  const rule = rules[index]!;
  return interpolateRange(
    value,
    lowerOverride ?? ruleLowerBound(rules, index),
    rule.maxExclusive ?? finalCeiling,
    rule.control[0],
    rule.control[1],
  );
}

function sliderRuleIndex(value: number, rules: readonly AvatarBodyThresholdRule[]): number {
  let selected = 0;
  for (let index = 1; index < rules.length; index += 1) {
    if (value < rules[index]!.control[0]) break;
    selected = index;
  }
  return selected;
}

function sliderToPhysicalValue(
  value: number,
  rules: readonly AvatarBodyThresholdRule[],
  index: number,
  finalCeiling: number,
  lowerOverride?: number,
): number {
  const rule = rules[index]!;
  return interpolateRange(
    value,
    rule.control[0],
    rule.control[1],
    lowerOverride ?? ruleLowerBound(rules, index),
    rule.maxExclusive ?? finalCeiling,
  );
}

function roundControl(value: number): number {
  return Math.round(clamp(value) * 10_000) / 10_000;
}

export function cockCmToAvatarSlider(cm: number): number {
  if (!Number.isFinite(cm) || cm < 0) return DEFAULT_AVATAR_BODY_CONTROLS.cock;
  // A true zero emits no genital-size tag. Values above zero through 40 cm
  // remain clothed-compatible "bulge" territory. Above that,
  // four continuous slider bands select penis/big/huge/hyper penis; 150 cm
  // remains the beginning of Hyper, as established by the avatar references.
  if (cm <= 40) return clamp((cm / 40) * 39);
  if (cm <= 80) return clamp(40 + ((cm - 40) / 40) * 19);
  if (cm <= 120) return clamp(60 + ((cm - 80) / 40) * 14);
  if (cm < 150) return clamp(75 + ((cm - 120) / 30) * 14);
  return clamp(90 + 10 * Math.sqrt((cm - 150) / 450));
}

export function calculateAvatarBodyControls(
  stats: CharacterStat[],
  settings: AvatarBodyThresholdSettings = DEFAULT_AVATAR_BODY_THRESHOLD_SETTINGS,
): AvatarBodyControlValues {
  const weight = statValue(stats, /^weight(?:\s*\(\s*kg\s*\))?$/i);
  const bodyFat = statValue(stats, /^body\s*fat(?:\s*\(\s*%\s*\))?$/i);
  const cock = statValue(stats, /^cock(?:\s*\(\s*cm\s*\))?$/i);
  const heightCm = heightValueCm(stats);
  const physiologicalBodyFat = bodyFat === null ? null : clamp(bodyFat);

  // Each category receives a usable base width, with additional width for
  // physically broader ranges. This keeps early categories adjustable without
  // squeezing the 200–600 kg Extreme range into only the final ten points.
  const sizeIndex = weight === null || weight <= 0
    ? null
    : sizeRuleIndex(weight, physiologicalBodyFat ?? 100, settings);
  const muscularity =
    weight !== null && weight > 0 && sizeIndex !== null
      ? physicalValueToSlider(
          weight,
          settings.sizeRules,
          sizeIndex,
          settings.referenceCeilingKg,
          sizeIndex === 1 ? settings.sizeRules[0]?.maxExclusive ?? 0 : undefined,
        )
      : DEFAULT_AVATAR_BODY_CONTROLS.muscularity;
  const visualBodyFat =
    physiologicalBodyFat === null
      ? DEFAULT_AVATAR_BODY_CONTROLS.bodyFat
      : physicalValueToSlider(
          physiologicalBodyFat,
          settings.fatRules,
          ruleIndex(physiologicalBodyFat, settings.fatRules),
          100,
        );

  return {
    muscularity: roundControl(muscularity),
    bodyFat: roundControl(visualBodyFat),
    cock: Math.round(cock === null ? DEFAULT_AVATAR_BODY_CONTROLS.cock : cockCmToAvatarSlider(cock)),
    heightCm,
    ...(weight !== null && weight > 0 ? { weightKg: weight } : {}),
  };
}

export function avatarBodySizeLabel(
  values: Pick<AvatarBodyControlValues, "muscularity" | "bodyFat">,
  settings: AvatarBodyThresholdSettings = DEFAULT_AVATAR_BODY_THRESHOLD_SETTINGS,
): string {
  return settings.sizeRules[sliderRuleIndex(clamp(values.muscularity), settings.sizeRules)]?.label ?? "Unknown";
}

export function avatarBodySliderToWeightKg(
  muscularity: number,
  settings: AvatarBodyThresholdSettings = DEFAULT_AVATAR_BODY_THRESHOLD_SETTINGS,
): number {
  const value = clamp(muscularity);
  const index = sliderRuleIndex(value, settings.sizeRules);
  return sliderToPhysicalValue(
    value,
    settings.sizeRules,
    index,
    settings.referenceCeilingKg,
    index === 1 ? settings.sizeRules[0]?.maxExclusive ?? 0 : undefined,
  );
}

export function avatarBodyCompositionLabel(
  bodyFatPercent: number,
  settings: AvatarBodyThresholdSettings = DEFAULT_AVATAR_BODY_THRESHOLD_SETTINGS,
): string {
  return settings.fatRules[sliderRuleIndex(clamp(bodyFatPercent), settings.fatRules)]?.label ?? "Unknown";
}

export function avatarBodySliderToBodyFatPercent(
  bodyFat: number,
  settings: AvatarBodyThresholdSettings = DEFAULT_AVATAR_BODY_THRESHOLD_SETTINGS,
): number {
  const value = clamp(bodyFat);
  const index = sliderRuleIndex(value, settings.fatRules);
  return sliderToPhysicalValue(value, settings.fatRules, index, 100);
}

export function avatarBodyControlLabel(kind: "muscularity" | "bodyFat" | "cock", value: number): string {
  const normalized = clamp(value);
  if (kind === "cock") {
    if (normalized === 0) return "None";
    if (normalized < 40) return "Bulge";
    if (normalized < 60) return "Penis";
    if (normalized < 75) return "Big";
    if (normalized < 90) return "Huge";
    return "Hyper";
  }
  if (kind === "muscularity") {
    return avatarBodySizeLabel({ muscularity: normalized, bodyFat: DEFAULT_AVATAR_BODY_CONTROLS.bodyFat });
  }
  return avatarBodyCompositionLabel(normalized);
}
