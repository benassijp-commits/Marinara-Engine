import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { inflateSync } from "zlib";
import { join } from "path";
import {
  DEFAULT_AVATAR_BODY_CONTROLS,
  DEFAULT_AVATAR_BODY_THRESHOLD_SETTINGS,
  calculateAvatarBodyControls,
  type AvatarBodyControlMode,
  type AvatarBodyControlState,
  type AvatarBodyControlValues,
  type AvatarBodyThresholdRule,
  type AvatarBodyThresholdSettings,
  type CharacterStat,
} from "@marinara-engine/shared";
import { assertInsideDir } from "../../utils/security.js";
import { DATA_DIR } from "../../utils/data-dir.js";

export interface LockedAvatarPrompt {
  positive: string;
  negative: string;
  seed: number;
}

interface StoredAvatarBodyControl {
  mode: AvatarBodyControlMode;
  manual: AvatarBodyControlValues;
  lockedPrompt?: LockedAvatarPrompt;
}

type StoredAvatarBodyControls = Record<string, StoredAvatarBodyControl>;

const STORE_FILENAME = ".avatar-body-controls.json";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function characterStorageKey(characterId: string): string {
  return `character:${characterId}`;
}

function clampControl(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(Math.min(100, Math.max(0, parsed))) : fallback;
}

export function normalizeAvatarBodyValues(
  value: Partial<AvatarBodyControlValues> | null | undefined,
): AvatarBodyControlValues {
  const parsedHeight = Number(value?.heightCm);
  const parsedWeight = Number(value?.weightKg);
  return {
    muscularity: clampControl(value?.muscularity, DEFAULT_AVATAR_BODY_CONTROLS.muscularity),
    bodyFat: clampControl(value?.bodyFat, DEFAULT_AVATAR_BODY_CONTROLS.bodyFat),
    cock: clampControl(value?.cock, DEFAULT_AVATAR_BODY_CONTROLS.cock),
    ...(Number.isFinite(parsedHeight) && parsedHeight > 0 ? { heightCm: parsedHeight } : {}),
    ...(Number.isFinite(parsedWeight) && parsedWeight > 0 ? { weightKg: parsedWeight } : {}),
  };
}

function storePath(npcDir: string): string {
  return assertInsideDir(npcDir, join(npcDir, STORE_FILENAME));
}

function readStore(npcDir: string): StoredAvatarBodyControls {
  const path = storePath(npcDir);
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as StoredAvatarBodyControls) : {};
  } catch {
    return {};
  }
}

function writeStore(npcDir: string, value: StoredAvatarBodyControls): void {
  const path = storePath(npcDir);
  const temporaryPath = assertInsideDir(npcDir, join(npcDir, `.${STORE_FILENAME}.${Date.now()}.tmp`));
  try {
    writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf8");
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
}

export function getStoredAvatarBodyControl(npcDir: string, characterId: string): StoredAvatarBodyControl {
  const stored = readStore(npcDir)[characterStorageKey(characterId)];
  return {
    mode: stored?.mode === "manual" ? "manual" : "auto",
    manual: normalizeAvatarBodyValues(stored?.manual),
    ...(stored?.lockedPrompt ? { lockedPrompt: stored.lockedPrompt } : {}),
  };
}

export function updateStoredAvatarBodyControl(
  npcDir: string,
  characterId: string,
  update: Partial<StoredAvatarBodyControl>,
): StoredAvatarBodyControl {
  const all = readStore(npcDir);
  const current = getStoredAvatarBodyControl(npcDir, characterId);
  const next: StoredAvatarBodyControl = {
    ...current,
    ...update,
    manual: normalizeAvatarBodyValues(update.manual ?? current.manual),
  };
  if (update.lockedPrompt === undefined && Object.hasOwn(update, "lockedPrompt")) delete next.lockedPrompt;
  all[characterStorageKey(characterId)] = next;
  writeStore(npcDir, all);
  return next;
}

export function avatarBodyControlState(
  stored: StoredAvatarBodyControl,
  stats: CharacterStat[],
  canLock: boolean,
): AvatarBodyControlState {
  const automatic = calculateAvatarBodyControls(stats, activeRuntimeSettings);
  const manual = normalizeAvatarBodyValues(stored.manual);
  const effective =
    stored.mode === "auto" ? automatic : { ...manual, heightCm: automatic.heightCm, weightKg: automatic.weightKg };
  return {
    mode: stored.mode,
    manual,
    effective,
    locked: !!stored.lockedPrompt,
    canLock,
    seed: stored.lockedPrompt?.seed ?? null,
  };
}

function pngTextChunks(buffer: Buffer): Map<string, string> {
  const result = new Map<string, string>();
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return result;
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (data.length !== length) break;
    try {
      if (type === "tEXt") {
        const separator = data.indexOf(0);
        if (separator > 0)
          result.set(data.subarray(0, separator).toString("latin1"), data.subarray(separator + 1).toString("utf8"));
      } else if (type === "zTXt") {
        const separator = data.indexOf(0);
        if (separator > 0 && data[separator + 1] === 0) {
          result.set(
            data.subarray(0, separator).toString("latin1"),
            inflateSync(data.subarray(separator + 2)).toString("utf8"),
          );
        }
      } else if (type === "iTXt") {
        const keyEnd = data.indexOf(0);
        if (keyEnd > 0) {
          const compressed = data[keyEnd + 1] === 1;
          let cursor = keyEnd + 3;
          cursor = data.indexOf(0, cursor) + 1;
          cursor = data.indexOf(0, cursor) + 1;
          if (cursor > 1) {
            const text = compressed
              ? inflateSync(data.subarray(cursor)).toString("utf8")
              : data.subarray(cursor).toString("utf8");
            result.set(data.subarray(0, keyEnd).toString("utf8"), text);
          }
        }
      }
    } catch {
      /* malformed ancillary metadata is ignored */
    }
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return result;
}

type WorkflowNode = { class_type?: string; inputs?: Record<string, unknown> };

function linkedNode(workflow: Record<string, WorkflowNode>, value: unknown): WorkflowNode | null {
  return Array.isArray(value) && typeof value[0] === "string" ? (workflow[value[0]] ?? null) : null;
}

function resolveTextInput(workflow: Record<string, WorkflowNode>, value: unknown, depth = 0): string | null {
  if (typeof value === "string") return value;
  if (depth > 8) return null;
  const node = linkedNode(workflow, value);
  if (!node?.inputs) return null;
  return resolveTextInput(workflow, node.inputs.text, depth + 1);
}

export function extractComfyAvatarPrompt(buffer: Buffer): LockedAvatarPrompt | null {
  const raw = pngTextChunks(buffer).get("prompt");
  if (!raw) return null;
  try {
    const workflow = JSON.parse(raw) as Record<string, WorkflowNode>;
    const sampler = Object.values(workflow).find((node) => node.class_type === "KSampler" && node.inputs);
    const seed = Number(sampler?.inputs?.seed);
    if (!sampler?.inputs || !Number.isSafeInteger(seed) || seed < 0) return null;
    const positiveNode = linkedNode(workflow, sampler.inputs.positive);
    const negativeNode = linkedNode(workflow, sampler.inputs.negative);
    const positive = resolveTextInput(workflow, positiveNode?.inputs?.text)?.trim();
    const negative = resolveTextInput(workflow, negativeNode?.inputs?.text)?.trim() ?? "";
    return positive ? { positive, negative, seed } : null;
  } catch {
    return null;
  }
}

function unwrapTag(tag: string): string {
  return tag
    .trim()
    .replace(/^\((.*?):\s*-?\d+(?:\.\d+)?\)$/, "$1")
    .trim()
    .toLowerCase()
    .replaceAll("_", " ");
}

const CONTROLLED_LORAS = new Set([
  "furr mass sdxl",
  "rokudenashi style v2 ilxl",
  "Ripped-Saurian Illustrious V",
  "zoroj ill11",
  "hyper muscles",
]);

const MUSCLE_TRIGGERS = new Set(["mass", "r0kud3n4shi", "20r0j 2"]);

const BODY_MORPHOLOGY_REGION =
  /\b(?:shoulders?|chest|torso|upper body|arms?|upper arms?|biceps?|triceps?|forearms?|wrists?|neck|back|waist|abdomen|belly|stomach|hips?|buttocks?|ass|thighs?|legs?|calves?)\b/;
const BODY_IDENTITY_OR_WEARABLE_CONTEXT =
  /\b(?:scar|tattoo|birthmark|marking|vitiligo|freckles?|mole|prosthetic|cybernetic|mechanical|missing|amputated|armor|armour|sleeves?|gloves?|gauntlets?|bracelets?|watch|shirt|jacket|coat|dress|top|harness)\b/;
const BODY_POSE_OR_ACTION_CONTEXT =
  /\b(?:crossed|raised|lowered|extended|outstretched|bent|folded|behind|over|under|holding|reaching|pointing|waving|resting|akimbo|looking over|leaning|kneeling|sitting|standing)\b/;
const BODY_COMPOSITION_CONCEPT =
  /\b(?:physique|body shape|body type|body proportions?|body frame|physical frame|(?:slender|broad|wide|narrow|large|small|heavy|delicate) frame|hourglass figure|v-shaped torso|body fat|muscle mass|muscle definition|potbelly|beer belly|love handles?|six-pack|eight-pack|abs|pectorals?|pecs?)\b/;

function controlledLora(tag: string): boolean {
  const match = tag.trim().match(/^<lora:([^:>]+):\s*-?\d+(?:\.\d+)?>$/i);
  if (!match?.[1]) return false;
  const name = match[1]
    .replace(/\.safetensors$/i, "")
    .replaceAll("_", " ")
    .toLowerCase();
  return CONTROLLED_LORAS.has(name);
}

function controlledFamily(tag: string): "muscularity" | "bodyFat" | "cock" | "support" | null {
  if (controlledLora(tag)) return "support";
  const value = unwrapTag(tag);
  if (MUSCLE_TRIGGERS.has(value)) return "support";
  if (/\b(?:muscular|muscles?|musclebound|bodybuilder|athletic|atlethic|skinny|slim|lean)\b/.test(value))
    return "muscularity";
  if (/^(?:weak|low muscle mass|muscle definition)$/.test(value)) return "muscularity";
  if (/\b(?:chubby|fat|obese|obesity)\b/.test(value)) return "bodyFat";
  if (/^(?:very lean|soft|round belly|full-body fat distribution)$/.test(value)) return "bodyFat";
  if (/\b(?:veins?|vascular)\b/.test(value)) return "support";
  if (/^(?:detailed face|tall|giant|colossal|planetary scale)$/.test(value)) return "support";
  if (/\b(?:bulge|penis|cock|genitalia|testicles?|scrotum)\b/.test(value)) return "cock";
  if (BODY_COMPOSITION_CONCEPT.test(value)) return "muscularity";
  if (
    BODY_MORPHOLOGY_REGION.test(value) &&
    !BODY_IDENTITY_OR_WEARABLE_CONTEXT.test(value) &&
    !BODY_POSE_OR_ACTION_CONTEXT.test(value)
  ) {
    return "muscularity";
  }
  return null;
}

export function isAvatarBodyControllerOwnedTag(tag: string): boolean {
  return controlledFamily(tag) !== null;
}

function splitTags(prompt: string): string[] {
  return prompt
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function interpolate(value: number, start: number, end: number, low: number, high: number): number {
  const progress = end === start ? 0 : (value - start) / (end - start);
  return low + (high - low) * Math.min(1, Math.max(0, progress));
}

function weighted(tag: string, weight: number): string {
  return Math.abs(weight - 1) < 0.005 ? tag : `(${tag}:${weight.toFixed(2)})`;
}

type MuscleLoraName =
  | "furr_mass_SDXL"
  | "Rokudenashi_Style_V2_ILXL"
  | "ripped-saurian_illustrious_v"
  | "zoroj_ill11"
  | "Hyper_muscles";
type CalibrationWeights = Record<string, number>;

interface BodyCalibrationPoint {
  loras: Record<MuscleLoraName, number>;
  loraPresence: ReadonlySet<MuscleLoraName>;
  positive: CalibrationWeights;
  literalPositive: readonly string[];
  negative: CalibrationWeights;
}

const EMPTY_LORAS: Record<MuscleLoraName, number> = {
  furr_mass_SDXL: 0,
  Rokudenashi_Style_V2_ILXL: 0,
  "ripped-saurian_illustrious_v": 0,
  zoroj_ill11: 0,
  Hyper_muscles: 0,
};
const BASE_LORAS: readonly MuscleLoraName[] = [
  "furr_mass_SDXL",
  "Rokudenashi_Style_V2_ILXL",
  "ripped-saurian_illustrious_v",
  "zoroj_ill11",
];

function calibrationPoint(
  loras: Partial<Record<MuscleLoraName, number>>,
  positive: CalibrationWeights = {},
  negativeTags: string[] = [],
  literalPositive: string[] = [],
): BodyCalibrationPoint {
  return {
    loras: { ...EMPTY_LORAS, ...loras },
    loraPresence: new Set([
      ...BASE_LORAS,
      ...(Object.hasOwn(loras, "Hyper_muscles") ? ["Hyper_muscles" as const] : []),
    ]),
    positive,
    literalPositive,
    negative: Object.fromEntries(negativeTags.map((tag) => [tag, 1])),
  };
}

const FACE = { "detailed face": 1.2 };
const VASCULAR_NEGATIVE = ["veins", "vascular", "prominent veins"];
const SOFT_MUSCLE_NEGATIVE = [...VASCULAR_NEGATIVE, "muscle definition"];
const EXTREME_SKINNY = calibrationPoint({}, { skinny: 1.3 });

// Rows are visual magnitude (extremely skinny, small, average 1, muscular, large,
// extreme). Columns are the tested fat-to-muscle proportions
// (0/100, 25/75, 50/50, 75/25, 100/0).
const DEFAULT_BODY_CALIBRATION_GRID: ReadonlyArray<ReadonlyArray<BodyCalibrationPoint>> = [
  [EXTREME_SKINNY, EXTREME_SKINNY, EXTREME_SKINNY, EXTREME_SKINNY, EXTREME_SKINNY],
  [
    calibrationPoint(
      { Rokudenashi_Style_V2_ILXL: 0.1, "ripped-saurian_illustrious_v": 0.1, zoroj_ill11: 0.1 },
      { ...FACE, lean: 0.3 },
    ),
    calibrationPoint(
      { furr_mass_SDXL: 0.1, Rokudenashi_Style_V2_ILXL: 0.15, "ripped-saurian_illustrious_v": 0.1, zoroj_ill11: 0.1 },
      { ...FACE, muscular: 0.5, chubby: 0.5, "full-body fat distribution": 0.5 },
      SOFT_MUSCLE_NEGATIVE,
    ),
    calibrationPoint(
      {},
      { ...FACE, muscular: 0.3, chubby: 0.5, "full-body fat distribution": 0.5 },
      SOFT_MUSCLE_NEGATIVE,
    ),
    calibrationPoint(
      { Rokudenashi_Style_V2_ILXL: 0.05 },
      { ...FACE, atlethic: 0.2, chubby: 0.6 },
      SOFT_MUSCLE_NEGATIVE,
    ),
    calibrationPoint({}, { chubby: 0.8 }, [...VASCULAR_NEGATIVE, "muscles", "muscular"]),
  ],
  [
    calibrationPoint(
      {
        furr_mass_SDXL: 0.2,
        Rokudenashi_Style_V2_ILXL: 0.15,
        "ripped-saurian_illustrious_v": 0.2,
        zoroj_ill11: 0.2,
        Hyper_muscles: 0.1,
      },
      { ...FACE, atlethic: 0.3 },
    ),
    calibrationPoint(
      { Rokudenashi_Style_V2_ILXL: 0.05, "ripped-saurian_illustrious_v": 0.1, zoroj_ill11: 0.1 },
      { ...FACE, muscular: 0.5, chubby: 0.5, "full-body fat distribution": 0.5 },
      SOFT_MUSCLE_NEGATIVE,
    ),
    calibrationPoint(
      { Rokudenashi_Style_V2_ILXL: 0.05 },
      { ...FACE, muscular: 1, chubby: 1, "full-body fat distribution": 0.5 },
      SOFT_MUSCLE_NEGATIVE,
    ),
    calibrationPoint(
      { Rokudenashi_Style_V2_ILXL: 0.15, "ripped-saurian_illustrious_v": 0.1, zoroj_ill11: 0.1 },
      { ...FACE, atlethic: 0.1, chubby: 0.2, "full-body fat distribution": 0.5 },
      SOFT_MUSCLE_NEGATIVE,
    ),
    calibrationPoint({}, { chubby: 1.5 }, VASCULAR_NEGATIVE),
  ],
  [
    calibrationPoint(
      {
        furr_mass_SDXL: 0.4,
        Rokudenashi_Style_V2_ILXL: 0.15,
        "ripped-saurian_illustrious_v": 0.4,
        zoroj_ill11: 0.4,
        Hyper_muscles: 0.1,
      },
      { ...FACE, muscular: 0.5 },
    ),
    calibrationPoint(
      { furr_mass_SDXL: 0.2, Rokudenashi_Style_V2_ILXL: 0.1, "ripped-saurian_illustrious_v": 0.1, zoroj_ill11: 0.1 },
      { ...FACE, atlethic: 0.3, obese: 0.1, "full-body fat distribution": 1 },
    ),
    calibrationPoint(
      { furr_mass_SDXL: 0.3, Rokudenashi_Style_V2_ILXL: 0.15, "ripped-saurian_illustrious_v": 0.5, zoroj_ill11: 0.5 },
      { ...FACE, muscular: 1, obese: 1, "full-body fat distribution": 1 },
      SOFT_MUSCLE_NEGATIVE,
    ),
    calibrationPoint(
      { furr_mass_SDXL: 0.1, Rokudenashi_Style_V2_ILXL: 0.15, "ripped-saurian_illustrious_v": 0.3, zoroj_ill11: 0.3 },
      { ...FACE, atlethic: 0.1, obese: 0.6, "full-body fat distribution": 1 },
      SOFT_MUSCLE_NEGATIVE,
    ),
    calibrationPoint({ Rokudenashi_Style_V2_ILXL: 0.15 }, { muscular: -0.2, obese: 1.3 }, VASCULAR_NEGATIVE),
  ],
  [
    calibrationPoint(
      {
        furr_mass_SDXL: 0.5,
        Rokudenashi_Style_V2_ILXL: 0.15,
        "ripped-saurian_illustrious_v": 0.5,
        zoroj_ill11: 0.5,
        Hyper_muscles: 0.3,
      },
      { ...FACE, "hyper muscular": 0.6 },
    ),
    calibrationPoint(
      {
        furr_mass_SDXL: 0.3,
        Rokudenashi_Style_V2_ILXL: 0.15,
        "ripped-saurian_illustrious_v": 0.3,
        zoroj_ill11: 0.3,
        Hyper_muscles: 0.3,
      },
      { ...FACE, muscular: 0.9, obese: 0.3, "full-body fat distribution": 1 },
    ),
    calibrationPoint(
      { furr_mass_SDXL: 0.5, Rokudenashi_Style_V2_ILXL: 0.15, "ripped-saurian_illustrious_v": 0.7, zoroj_ill11: 0.7 },
      { ...FACE, muscular: 1, obese: 1, "full-body fat distribution": 1 },
      SOFT_MUSCLE_NEGATIVE,
    ),
    calibrationPoint(
      { furr_mass_SDXL: 0.5, Rokudenashi_Style_V2_ILXL: 0.15, "ripped-saurian_illustrious_v": 0.7, zoroj_ill11: 0.7 },
      { ...FACE, muscular: 0.3, obese: 1, "full-body fat distribution": 1 },
      SOFT_MUSCLE_NEGATIVE,
    ),
    calibrationPoint({ Rokudenashi_Style_V2_ILXL: 0.15 }, { muscular: -0.2, obese: 1.5 }, VASCULAR_NEGATIVE),
  ],
  [
    calibrationPoint(
      {
        furr_mass_SDXL: 0.8,
        Rokudenashi_Style_V2_ILXL: 0.15,
        "ripped-saurian_illustrious_v": 0.8,
        zoroj_ill11: 0.8,
        Hyper_muscles: 0.5,
      },
      { ...FACE, "hyper muscular": 1.4 },
    ),
    calibrationPoint(
      {
        furr_mass_SDXL: 0.7,
        Rokudenashi_Style_V2_ILXL: 0.15,
        "ripped-saurian_illustrious_v": 0.8,
        zoroj_ill11: 0.8,
        Hyper_muscles: 0.25,
      },
      { ...FACE, "hyper muscular": 1.35, "hyper obese": 0.6, "full-body fat distribution": 0.5 },
      ["veins", "vascular", "prominent veins", "muscle definition"],
    ),
    calibrationPoint(
      { furr_mass_SDXL: 0.6, Rokudenashi_Style_V2_ILXL: 0.15, "ripped-saurian_illustrious_v": 0.8, zoroj_ill11: 0.8 },
      { ...FACE, "hyper muscular": 1.3, "hyper obese": 1.2, "full-body fat distribution": 1 },
      SOFT_MUSCLE_NEGATIVE,
    ),
    calibrationPoint(
      { furr_mass_SDXL: 0.3, Rokudenashi_Style_V2_ILXL: 0.15, "ripped-saurian_illustrious_v": 0.4, zoroj_ill11: 0.4 },
      { ...FACE, "hyper muscular": 0.55, muscular: -0.1, "hyper obese": 1.35, "full-body fat distribution": 0.5 },
      SOFT_MUSCLE_NEGATIVE,
    ),
    calibrationPoint({ Rokudenashi_Style_V2_ILXL: 0.15 }, { muscular: -0.2, "hyper obese": 1.5 }, VASCULAR_NEGATIVE),
  ],
];

const SCALE_STEPS = [0, 20, 40, 60, 80, 100] as const;
const COMPOSITION_STEPS = [0, 0.25, 0.5, 0.75, 1] as const;
const AUTHORED_SCALE_RANGES = [
  [0, 9],
  [10, 29],
  [30, 49],
  [50, 69],
  [70, 89],
  [90, 100],
] as const;
const AUTHORED_COMPOSITION_RANGES = [
  [0, 12],
  [13, 37],
  [38, 62],
  [63, 87],
  [88, 100],
] as const;

type RuntimeWeightCurve = [number, number, number];
type RuntimeCorrectionRow = [number, number, number];
type RuntimeCorrectionGrid = [RuntimeCorrectionRow, RuntimeCorrectionRow, RuntimeCorrectionRow];

interface RuntimeAdjustment {
  min: number | null;
  max: number | null;
  corrections: RuntimeCorrectionGrid;
}

type RuntimeAnchors = Record<string, number>;
type RuntimeAdjustments = Record<string, RuntimeAdjustment>;

interface AvatarBodyRuntimeCell {
  reference: string;
  status: "reference" | "derived";
  loras: Partial<Record<MuscleLoraName, number>>;
  positive: RuntimeAnchors;
  adjustments: {
    loras: RuntimeAdjustments;
    positive: RuntimeAdjustments;
  };
  negative: string[];
}

export interface AvatarBodyRuntimeSettings extends AvatarBodyThresholdSettings {
  schema: "marinara-avatar-body-settings/v2";
  interpolation: {
    isolatedTagPower: number;
    columnTagEntryWeight: number;
    extremeTagEntryWeight: number;
    loraEntryWeight: number;
    skinnyExitWeight: number;
  };
  cells: Record<string, AvatarBodyRuntimeCell>;
}

const SIZE_IDS = ["skinny", "small", "average1", "muscular", "large", "extreme"] as const;
const FAT_IDS = ["muscle100", "muscle75", "balanced", "muscle25", "fat100"] as const;
const ZERO_CORRECTIONS: RuntimeCorrectionGrid = [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
];
const CELL_REFERENCES: ReadonlyArray<ReadonlyArray<readonly [string, "reference" | "derived"]>> = [
  Array.from({ length: 5 }, () => ["EXTREME_SKINNY.json", "reference"] as const),
  [
    ["SMALL_MUSCULAR.json", "reference"],
    ["SMALL_FAT_25_MUS_75.json", "reference"],
    ["SMALL_FAT_50_MUS_50.json", "reference"],
    ["SMALL_FAT_75_MUSCLE_25.json", "reference"],
    ["SMALL_FAT.json", "reference"],
  ],
  [
    ["AVERAGE_1_MUSCULAR.json", "reference"],
    ["AVERAGE_1_FAT_25_MUS_75.json", "reference"],
    ["AVERAGE_1_FAT_50_MUS_50.json", "reference"],
    ["AVERAGE_1_FAT_75_MUSCLE_25.json", "reference"],
    ["AVERAGE_1_FAT.json", "reference"],
  ],
  [
    ["AVERAGE_2_MUSCULAR.json", "reference"],
    ["AVERAGE_2_FAT_25_MUSCLE_75.json", "reference"],
    ["AVERAGE_2_FAT_50_MUSCLE_50.json", "reference"],
    ["AVERAGE_2_FAT_75_MUSCLE_25.json", "reference"],
    ["AVERAGE_2_FAT.json", "reference"],
  ],
  [
    ["BIG_MUSCULAR.json", "reference"],
    ["BIG_FAT_25_MUSCLE_75.json", "reference"],
    ["BIG_FAT_50_MUSCLE_50.json", "reference"],
    ["BIG_FAT_75_MUSCLE_25_.json", "reference"],
    ["BIG_FAT.json", "reference"],
  ],
  [
    ["EXTREME_MUSCULAR.json", "reference"],
    ["DERIVED_EXTREME_25_75", "derived"],
    ["EXTREME_FAT_MUSCLE.json", "reference"],
    ["DERIVED_EXTREME_75_25", "derived"],
    ["EXTREME_FAT.json", "reference"],
  ],
];

function serializeDefaultCells(): Record<string, AvatarBodyRuntimeCell> {
  const cells: Record<string, AvatarBodyRuntimeCell> = {};
  DEFAULT_BODY_CALIBRATION_GRID.forEach((row, rowIndex) =>
    row.forEach((point, columnIndex) => {
      const [reference, status] = CELL_REFERENCES[rowIndex]![columnIndex]!;
      cells[`${SIZE_IDS[rowIndex]}:${FAT_IDS[columnIndex]}`] = {
        reference,
        status,
        loras: Object.fromEntries([...point.loraPresence].map((name) => [name, point.loras[name]])) as Partial<
          Record<MuscleLoraName, number>
        >,
        positive: { ...point.positive },
        adjustments: { loras: {}, positive: {} },
        negative: Object.keys(point.negative),
      };
    }),
  );
  return cells;
}

const DEFAULT_AVATAR_BODY_RUNTIME_SETTINGS: AvatarBodyRuntimeSettings = {
  schema: "marinara-avatar-body-settings/v2",
  ...DEFAULT_AVATAR_BODY_THRESHOLD_SETTINGS,
  sizeRules: DEFAULT_AVATAR_BODY_THRESHOLD_SETTINGS.sizeRules.map((rule) => ({
    ...rule,
    control: [...rule.control] as [number, number],
  })),
  fatRules: DEFAULT_AVATAR_BODY_THRESHOLD_SETTINGS.fatRules.map((rule) => ({
    ...rule,
    control: [...rule.control] as [number, number],
  })),
  interpolation: {
    isolatedTagPower: 2.3,
    columnTagEntryWeight: 0.1,
    extremeTagEntryWeight: 0.8,
    loraEntryWeight: 0.05,
    skinnyExitWeight: 0.1,
  },
  cells: serializeDefaultCells(),
};

const RUNTIME_SETTINGS_PATH = join(DATA_DIR, "avatar-body-settings.json");
let activeRuntimeSettings = structuredClone(DEFAULT_AVATAR_BODY_RUNTIME_SETTINGS);
let activeBodyCalibrationGrid = DEFAULT_BODY_CALIBRATION_GRID;

function finiteNumber(value: unknown, label: string, low: number, high: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < low || parsed > high)
    throw new Error(`${label} must be between ${low} and ${high}`);
  return parsed;
}

function normalizeRules(value: unknown, expectedIds: readonly string[], label: string): AvatarBodyThresholdRule[] {
  if (!Array.isArray(value) || value.length !== expectedIds.length)
    throw new Error(`${label} must contain ${expectedIds.length} rules`);
  let previousCeiling = 0;
  let previousControlEnd = 0;
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${label}[${index}] is invalid`);
    const record = raw as Record<string, unknown>;
    if (record.id !== expectedIds[index]) throw new Error(`${label}[${index}] must keep id ${expectedIds[index]}`);
    const maxExclusive =
      index === expectedIds.length - 1
        ? null
        : finiteNumber(record.maxExclusive, `${label}[${index}].maxExclusive`, 0.01, 1_000_000);
    if (maxExclusive !== null && maxExclusive <= previousCeiling)
      throw new Error(`${label} ceilings must be strictly increasing`);
    if (maxExclusive !== null) previousCeiling = maxExclusive;
    const control = record.control;
    if (!Array.isArray(control) || control.length !== 2) throw new Error(`${label}[${index}].control is invalid`);
    const controlStart = finiteNumber(control[0], "control start", 0, 100);
    const controlEnd = finiteNumber(control[1], "control end", 0, 100);
    if (controlEnd <= controlStart) throw new Error(`${label}[${index}].control end must be above its start`);
    if (index > 0 && controlStart < previousControlEnd) throw new Error(`${label} slider ranges must not overlap`);
    previousControlEnd = controlEnd;
    return {
      id: expectedIds[index]!,
      label:
        typeof record.label === "string" && record.label.trim()
          ? record.label.trim().slice(0, 80)
          : expectedIds[index]!,
      maxExclusive,
      control: [controlStart, controlEnd],
      ...(index === 0 && label === "sizeRules" ? { requiresFatBelowFirstThreshold: true } : {}),
    };
  });
}

function normalizeAnchorRecord(value: unknown, label: string, allowedNames?: ReadonlySet<string>): RuntimeAnchors {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const result: RuntimeAnchors = {};
  for (const [rawName, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const name = rawName.trim().slice(0, 100);
    if (!name || (allowedNames && !allowedNames.has(name)))
      throw new Error(`${label} contains unsupported name ${rawName}`);
    const anchor = Array.isArray(rawValue) ? rawValue[1] : rawValue;
    result[name] = finiteNumber(anchor, `${label}.${name}`, -5, 5);
  }
  return result;
}

function emptyAdjustment(): RuntimeAdjustment {
  return { min: null, max: null, corrections: structuredClone(ZERO_CORRECTIONS) };
}

function normalizeOptionalBound(value: unknown, label: string): number | null {
  return value === null || value === undefined || value === "" ? null : finiteNumber(value, label, -5, 5);
}

function normalizeCorrectionGrid(value: unknown, label: string): RuntimeCorrectionGrid {
  if (value === undefined || value === null) return structuredClone(ZERO_CORRECTIONS);
  if (!Array.isArray(value) || value.length !== 3 || value.some((row) => !Array.isArray(row) || row.length !== 3)) {
    throw new Error(`${label} must be a 3x3 grid`);
  }
  return value.map(
    (row, rowIndex) =>
      (row as unknown[]).map((entry, columnIndex) =>
        finiteNumber(entry, `${label}[${rowIndex}][${columnIndex}]`, -5, 5),
      ) as RuntimeCorrectionRow,
  ) as RuntimeCorrectionGrid;
}

function normalizeAdjustmentRecord(
  value: unknown,
  names: readonly string[],
  label: string,
  legacyCell?: Record<string, unknown>,
  legacyKind?: "loras" | "positive",
): RuntimeAdjustments {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const result: RuntimeAdjustments = {};
  for (const name of names) {
    const raw = source[name];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>;
      const min = normalizeOptionalBound(record.min, `${label}.${name}.min`);
      const max = normalizeOptionalBound(record.max, `${label}.${name}.max`);
      if (min !== null && max !== null && min > max) throw new Error(`${label}.${name}.min must not exceed max`);
      result[name] = {
        min,
        max,
        corrections: normalizeCorrectionGrid(record.corrections, `${label}.${name}.corrections`),
      };
      continue;
    }
    const legacyWeights =
      legacyKind &&
      legacyCell?.[legacyKind] &&
      typeof legacyCell[legacyKind] === "object" &&
      !Array.isArray(legacyCell[legacyKind])
        ? (legacyCell[legacyKind] as Record<string, unknown>)[name]
        : undefined;
    const legacyEnabled =
      legacyKind &&
      legacyCell?.overrides &&
      typeof legacyCell.overrides === "object" &&
      !Array.isArray(legacyCell.overrides) &&
      (legacyCell.overrides as Record<string, unknown>)[legacyKind] &&
      typeof (legacyCell.overrides as Record<string, unknown>)[legacyKind] === "object" &&
      (legacyCell.overrides as Record<string, Record<string, unknown>>)[legacyKind]?.[name] === true;
    if (legacyEnabled && Array.isArray(legacyWeights) && legacyWeights.length === 3) {
      const curve = legacyWeights.map((entry, index) =>
        finiteNumber(entry, `${label}.${name}.legacy[${index}]`, -5, 5),
      ) as RuntimeWeightCurve;
      const anchor = curve[1];
      result[name] = {
        min: null,
        max: null,
        corrections: curve.map((entry) => [entry - anchor, entry - anchor, entry - anchor]) as RuntimeCorrectionGrid,
      };
    }
  }
  return result;
}

function normalizeRuntimeSettings(value: unknown): AvatarBodyRuntimeSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Settings must be an object");
  const record = value as Record<string, unknown>;
  const legacyV1 = record.schema === "marinara-avatar-body-settings/v1";
  if (!legacyV1 && record.schema !== DEFAULT_AVATAR_BODY_RUNTIME_SETTINGS.schema)
    throw new Error("Unsupported settings schema");
  const sizeRules = normalizeRules(record.sizeRules, SIZE_IDS, "sizeRules");
  const fatRules = normalizeRules(record.fatRules, FAT_IDS, "fatRules");
  const rawInterpolation = record.interpolation as Record<string, unknown> | undefined;
  if (!rawInterpolation) throw new Error("interpolation is required");
  const rawCells = record.cells;
  if (!rawCells || typeof rawCells !== "object" || Array.isArray(rawCells)) throw new Error("cells must be an object");
  const cells: Record<string, AvatarBodyRuntimeCell> = {};
  const allowedLoras = new Set<MuscleLoraName>(Object.keys(EMPTY_LORAS) as MuscleLoraName[]);
  for (const sizeId of SIZE_IDS)
    for (const fatId of FAT_IDS) {
      const key = `${sizeId}:${fatId}`;
      const rawCell = (rawCells as Record<string, unknown>)[key];
      if (!rawCell || typeof rawCell !== "object" || Array.isArray(rawCell)) throw new Error(`Missing cell ${key}`);
      const cell = rawCell as Record<string, unknown>;
      const negative = Array.isArray(cell.negative)
        ? cell.negative
            .map((tag) => String(tag).trim().slice(0, 100))
            .filter(Boolean)
            .slice(0, 100)
        : [];
      const loras = normalizeAnchorRecord(cell.loras, `${key}.loras`, allowedLoras) as Partial<
        Record<MuscleLoraName, number>
      >;
      const positive = normalizeAnchorRecord(cell.positive, `${key}.positive`);
      const rawAdjustments =
        cell.adjustments && typeof cell.adjustments === "object" && !Array.isArray(cell.adjustments)
          ? (cell.adjustments as Record<string, unknown>)
          : {};
      cells[key] = {
        reference: typeof cell.reference === "string" ? cell.reference.trim().slice(0, 160) : key,
        status: cell.status === "derived" ? "derived" : "reference",
        loras,
        positive,
        adjustments: {
          loras: normalizeAdjustmentRecord(
            rawAdjustments.loras,
            Object.keys(loras),
            `${key}.adjustments.loras`,
            legacyV1 ? cell : undefined,
            "loras",
          ),
          positive: normalizeAdjustmentRecord(
            rawAdjustments.positive,
            Object.keys(positive),
            `${key}.adjustments.positive`,
            legacyV1 ? cell : undefined,
            "positive",
          ),
        },
        negative,
      };
    }
  return {
    schema: DEFAULT_AVATAR_BODY_RUNTIME_SETTINGS.schema,
    referenceCeilingKg: finiteNumber(record.referenceCeilingKg, "referenceCeilingKg", 200, 1_000_000),
    sizeRules,
    fatRules,
    interpolation: {
      isolatedTagPower: finiteNumber(rawInterpolation.isolatedTagPower, "isolatedTagPower", 0.1, 10),
      columnTagEntryWeight: finiteNumber(rawInterpolation.columnTagEntryWeight, "columnTagEntryWeight", 0, 5),
      extremeTagEntryWeight: finiteNumber(rawInterpolation.extremeTagEntryWeight, "extremeTagEntryWeight", 0, 5),
      loraEntryWeight: finiteNumber(rawInterpolation.loraEntryWeight, "loraEntryWeight", 0, 5),
      skinnyExitWeight:
        rawInterpolation.skinnyExitWeight === undefined
          ? DEFAULT_AVATAR_BODY_RUNTIME_SETTINGS.interpolation.skinnyExitWeight
          : finiteNumber(rawInterpolation.skinnyExitWeight, "skinnyExitWeight", 0, 5),
    },
    cells,
  };
}

function hydrateGrid(settings: AvatarBodyRuntimeSettings): ReadonlyArray<ReadonlyArray<BodyCalibrationPoint>> {
  return SIZE_IDS.map((sizeId) =>
    FAT_IDS.map((fatId) => {
      const cell = settings.cells[`${sizeId}:${fatId}`]!;
      const loras = Object.fromEntries(
        Object.entries(cell.loras).map(([name, weight]) => [name, weight ?? 0]),
      ) as Partial<Record<MuscleLoraName, number>>;
      const positive = { ...cell.positive };
      const point = calibrationPoint(loras, positive, cell.negative);
      return { ...point, loraPresence: new Set(Object.keys(cell.loras) as MuscleLoraName[]) };
    }),
  );
}

function activateRuntimeSettings(settings: AvatarBodyRuntimeSettings): void {
  activeRuntimeSettings = settings;
  activeBodyCalibrationGrid = hydrateGrid(settings);
}

export function initializeAvatarBodyRuntimeSettings(): AvatarBodyRuntimeSettings {
  if (!existsSync(RUNTIME_SETTINGS_PATH)) return getAvatarBodyRuntimeSettings();
  activateRuntimeSettings(normalizeRuntimeSettings(JSON.parse(readFileSync(RUNTIME_SETTINGS_PATH, "utf8"))));
  return getAvatarBodyRuntimeSettings();
}

export function getAvatarBodyRuntimeSettings(): AvatarBodyRuntimeSettings {
  return structuredClone(activeRuntimeSettings);
}

export function saveAvatarBodyRuntimeSettings(value: unknown): AvatarBodyRuntimeSettings {
  const normalized = normalizeRuntimeSettings(value);
  mkdirSync(DATA_DIR, { recursive: true });
  const temporaryPath = `${RUNTIME_SETTINGS_PATH}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(normalized, null, 2), "utf8");
    renameSync(temporaryPath, RUNTIME_SETTINGS_PATH);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
  activateRuntimeSettings(normalized);
  return getAvatarBodyRuntimeSettings();
}

export function resetAvatarBodyRuntimeSettings(): AvatarBodyRuntimeSettings {
  if (existsSync(RUNTIME_SETTINGS_PATH)) rmSync(RUNTIME_SETTINGS_PATH, { force: true });
  activateRuntimeSettings(structuredClone(DEFAULT_AVATAR_BODY_RUNTIME_SETTINGS));
  return getAvatarBodyRuntimeSettings();
}

type TagVector = "inverse" | "forward" | "neutral";

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function lerpAt(value: number, start: number, end: number, low: number, high: number): number {
  return interpolate(clamp(value, start, end), start, end, low, high);
}

function hasOwnWeight(weights: CalibrationWeights, key: string): boolean {
  return Object.hasOwn(weights, key);
}

function tagFamily(tag: string): "thin" | "muscle" | "fat" | "distribution" | "other" {
  if (tag === "skinny" || tag === "lean") return "thin";
  if (tag === "atlethic" || tag === "muscular" || tag === "hyper muscular") return "muscle";
  if (tag === "chubby" || tag === "obese" || tag === "hyper obese" || tag === "fat") return "fat";
  if (tag === "full-body fat distribution") return "distribution";
  return "other";
}

function tagVector(tag: string): TagVector {
  if (tag === "skinny" || tag === "lean") return "inverse";
  if (
    ["atlethic", "muscular", "hyper muscular", "chubby", "obese", "hyper obese", "full-body fat distribution"].includes(
      tag,
    )
  ) {
    return "forward";
  }
  return "neutral";
}

function replacementFamilyWeight(point: BodyCalibrationPoint, tag: string): number | null {
  const family = tagFamily(tag);
  if (family === "other") return null;
  const candidates = Object.entries(point.positive)
    .filter(([candidate, weight]) => candidate !== tag && tagFamily(candidate) === family && weight !== 0)
    .map(([, weight]) => Math.abs(weight));
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

function isolatedRowWeight(
  tag: string,
  anchor: number,
  magnitude: number,
  center: number,
  neighbor: BodyCalibrationPoint | null,
): number {
  if (anchor === 0 || magnitude === center) return anchor;
  const vector = tagVector(tag);
  if (vector === "neutral" || center <= 0 || magnitude <= 0) return anchor;

  const movesInVectorDirection = vector === "forward" ? magnitude > center : magnitude < center;
  const replacement = neighbor ? replacementFamilyWeight(neighbor, tag) : null;
  const anchorMagnitude = Math.abs(anchor);
  const boundaryMagnitude = movesInVectorDirection
    ? Math.max(anchorMagnitude * 1.25, replacement ?? 0)
    : (replacement ?? Math.min(activeRuntimeSettings.interpolation.columnTagEntryWeight, anchorMagnitude));
  const rawMagnitude =
    anchorMagnitude *
    Math.pow(
      magnitude / center,
      vector === "forward"
        ? activeRuntimeSettings.interpolation.isolatedTagPower
        : -activeRuntimeSettings.interpolation.isolatedTagPower,
    );
  const boundedMagnitude = clamp(
    rawMagnitude,
    Math.min(anchorMagnitude, boundaryMagnitude),
    Math.max(anchorMagnitude, boundaryMagnitude),
  );
  return Math.sign(anchor) * boundedMagnitude;
}

function verticalTagWeight(
  column: number,
  tag: string,
  magnitude: number,
  selectedRow: number,
  skinnyFatMagnitude = 0,
): number {
  const selected = activeBodyCalibrationGrid[selectedRow]![column]!;
  const anchor = selected.positive[tag]!;
  if (anchor === 0) return anchor;
  if (selectedRow === 0) {
    if (tag !== "skinny") return anchor;
    const weightProgress = clamp(magnitude / AUTHORED_SCALE_RANGES[0][1], 0, 1);
    const fatProgress = clamp(skinnyFatMagnitude / AUTHORED_COMPOSITION_RANGES[0][1], 0, 1);
    const progress = Math.max(weightProgress, fatProgress);
    const exit = Math.sign(anchor) * Math.min(Math.abs(anchor), activeRuntimeSettings.interpolation.skinnyExitWeight);
    return anchor + (exit - anchor) * Math.pow(progress, activeRuntimeSettings.interpolation.isolatedTagPower);
  }

  const center = SCALE_STEPS[selectedRow]!;
  if (selectedRow === SCALE_STEPS.length - 1) {
    const lower = activeBodyCalibrationGrid[selectedRow - 1]![column]!;
    if (hasOwnWeight(lower.positive, tag)) {
      return lerpAt(magnitude, SCALE_STEPS[selectedRow - 1]!, center, lower.positive[tag]!, anchor);
    }
    const entry =
      Math.sign(anchor) * Math.min(activeRuntimeSettings.interpolation.extremeTagEntryWeight, Math.abs(anchor));
    const progress = clamp((magnitude - 90) / 10, 0, 1);
    return entry + (anchor - entry) * Math.pow(progress, activeRuntimeSettings.interpolation.isolatedTagPower);
  }

  const neighborRow = magnitude < center ? selectedRow - 1 : selectedRow + 1;
  const neighbor =
    neighborRow >= 0 && neighborRow < activeBodyCalibrationGrid.length
      ? activeBodyCalibrationGrid[neighborRow]![column]!
      : null;
  if (neighbor && hasOwnWeight(neighbor.positive, tag)) {
    const neighborCenter = SCALE_STEPS[neighborRow]!;
    return neighborCenter < center
      ? lerpAt(magnitude, neighborCenter, center, neighbor.positive[tag]!, anchor)
      : lerpAt(magnitude, center, neighborCenter, anchor, neighbor.positive[tag]!);
  }
  return isolatedRowWeight(tag, anchor, magnitude, center, neighbor);
}

function horizontalTagWeight(
  row: number,
  tag: string,
  verticalWeight: number,
  magnitude: number,
  composition: number,
  selectedColumn: number,
): number {
  if (verticalWeight === 0) return 0;
  // 100% muscular has no fat signal to blend toward — any bleed from the
  // neighboring column reads as an unwanted, disproportionate change at this
  // model's low tag weights. This column stays fixed on the fat axis; weight
  // (row) interpolation is untouched.
  if (selectedColumn === 0) return verticalWeight;
  const center = COMPOSITION_STEPS[selectedColumn]!;
  if (composition === center) return verticalWeight;
  const neighborColumn = composition < center ? selectedColumn - 1 : selectedColumn + 1;
  if (neighborColumn < 0 || neighborColumn >= COMPOSITION_STEPS.length) return verticalWeight;
  const neighbor = activeBodyCalibrationGrid[row]![neighborColumn]!;
  if (hasOwnWeight(neighbor.positive, tag)) {
    const neighborWeight = verticalTagWeight(neighborColumn, tag, magnitude, row);
    const neighborCenter = COMPOSITION_STEPS[neighborColumn]!;
    return neighborCenter < center
      ? lerpAt(composition, neighborCenter, center, neighborWeight, verticalWeight)
      : lerpAt(composition, center, neighborCenter, verticalWeight, neighborWeight);
  }

  // Tags which do not exist in the next column remain stable. A tag which is
  // new in the selected column enters only after the categorical boundary.
  if (composition > center) return verticalWeight;
  const boundary = (COMPOSITION_STEPS[selectedColumn - 1]! + center) / 2;
  const entry =
    Math.sign(verticalWeight) *
    Math.min(activeRuntimeSettings.interpolation.columnTagEntryWeight, Math.abs(verticalWeight));
  return lerpAt(composition, boundary, center, entry, verticalWeight);
}

function verticalLoraWeight(column: number, name: MuscleLoraName, magnitude: number, selectedRow: number): number {
  const selected = activeBodyCalibrationGrid[selectedRow]![column]!;
  const anchor = selected.loras[name];
  if (!selected.loraPresence.has(name)) return anchor;
  if (selectedRow === 0) return anchor;
  const center = SCALE_STEPS[selectedRow]!;
  const neighborRow =
    selectedRow === SCALE_STEPS.length - 1 ? selectedRow - 1 : magnitude < center ? selectedRow - 1 : selectedRow + 1;
  if (neighborRow < 0 || neighborRow >= activeBodyCalibrationGrid.length) return anchor;
  const neighbor = activeBodyCalibrationGrid[neighborRow]![column]!;
  if (neighbor.loraPresence.has(name)) {
    const neighborCenter = SCALE_STEPS[neighborRow]!;
    return neighborCenter < center
      ? lerpAt(magnitude, neighborCenter, center, neighbor.loras[name], anchor)
      : lerpAt(magnitude, center, neighborCenter, anchor, neighbor.loras[name]);
  }
  if (magnitude >= center || selectedRow === SCALE_STEPS.length - 1) return anchor;
  const boundary = (SCALE_STEPS[selectedRow - 1]! + center) / 2;
  const entry = Math.min(activeRuntimeSettings.interpolation.loraEntryWeight, Math.abs(anchor));
  return lerpAt(magnitude, boundary, center, entry, anchor);
}

function horizontalLoraWeight(
  row: number,
  name: MuscleLoraName,
  verticalWeight: number,
  magnitude: number,
  composition: number,
  selectedColumn: number,
): number {
  // Same rationale as horizontalTagWeight: 100% muscular stays fixed on the
  // fat axis, so the mass LoRAs don't soften on approach to the boundary.
  if (selectedColumn === 0) return verticalWeight;
  const center = COMPOSITION_STEPS[selectedColumn]!;
  if (composition === center) return verticalWeight;
  const neighborColumn = composition < center ? selectedColumn - 1 : selectedColumn + 1;
  if (neighborColumn < 0 || neighborColumn >= COMPOSITION_STEPS.length) return verticalWeight;
  const neighbor = activeBodyCalibrationGrid[row]![neighborColumn]!;
  if (neighbor.loraPresence.has(name)) {
    const neighborWeight = verticalLoraWeight(neighborColumn, name, magnitude, row);
    const neighborCenter = COMPOSITION_STEPS[neighborColumn]!;
    return neighborCenter < center
      ? lerpAt(composition, neighborCenter, center, neighborWeight, verticalWeight)
      : lerpAt(composition, center, neighborCenter, verticalWeight, neighborWeight);
  }
  if (composition > center) return verticalWeight;
  const boundary = (COMPOSITION_STEPS[selectedColumn - 1]! + center) / 2;
  const entry = Math.min(activeRuntimeSettings.interpolation.loraEntryWeight, Math.abs(verticalWeight));
  return lerpAt(composition, boundary, center, entry, verticalWeight);
}

function sliderRuleIndex(value: number, rules: readonly AvatarBodyThresholdRule[]): number {
  let selected = 0;
  for (let index = 1; index < rules.length; index += 1) {
    if (value < rules[index]!.control[0]) break;
    selected = index;
  }
  return selected;
}

function sliderValueToAuthoredControl(
  value: number,
  rules: readonly AvatarBodyThresholdRule[],
  index: number,
  authoredRanges: ReadonlyArray<readonly [number, number]>,
): number {
  const rule = rules[index]!;
  const authored = authoredRanges[index]!;
  return lerpAt(value, rule.control[0], rule.control[1], authored[0], authored[1]);
}

function correctionAxis(value: number, start: number, center: number, end: number): [number, number, number] {
  if (value <= center || center === end) {
    const progress = center === start ? 1 : clamp((value - start) / (center - start), 0, 1);
    return [0, 1, progress];
  }
  const progress = end === center ? 0 : clamp((value - center) / (end - center), 0, 1);
  return [1, 2, progress];
}

function correctionAt(
  adjustment: RuntimeAdjustment | undefined,
  row: number,
  column: number,
  magnitude: number,
  composition: number,
): number {
  if (!adjustment) return 0;
  const sizeRange = AUTHORED_SCALE_RANGES[row]!;
  if (row === 0) {
    const [top, bottom, progress] = correctionAxis(
      magnitude,
      sizeRange[0],
      (sizeRange[0] + sizeRange[1]) / 2,
      sizeRange[1],
    );
    return lerpAt(progress, 0, 1, adjustment.corrections[top]![1], adjustment.corrections[bottom]![1]);
  }
  const [top, bottom, verticalProgress] = correctionAxis(magnitude, sizeRange[0], SCALE_STEPS[row]!, sizeRange[1]);
  const fatRange = AUTHORED_COMPOSITION_RANGES[column]!;
  const [left, right, horizontalProgress] = correctionAxis(
    composition * 100,
    fatRange[0],
    COMPOSITION_STEPS[column]! * 100,
    fatRange[1],
  );
  const upper = lerpAt(
    horizontalProgress,
    0,
    1,
    adjustment.corrections[top]![left]!,
    adjustment.corrections[top]![right]!,
  );
  const lower = lerpAt(
    horizontalProgress,
    0,
    1,
    adjustment.corrections[bottom]![left]!,
    adjustment.corrections[bottom]![right]!,
  );
  return lerpAt(verticalProgress, 0, 1, upper, lower);
}

type RuntimeEntryKind = "positive" | "loras";

interface RuntimeEntryTrace {
  vertical: {
    direction: "above" | "anchor" | "below";
    rule: string;
    sourceCell: string | null;
    sourcePresent: boolean;
    sourceAnchor: number | null;
    result: number;
  };
  horizontal: {
    direction: "left" | "anchor" | "right";
    sourceCell: string | null;
    sourcePresent: boolean;
    sourceAnchor: number | null;
    sourceAfterVertical: number | null;
    diagonalSourceCell: string | null;
    diagonalSourceAnchor: number | null;
    result: number;
  };
  automatic: number;
  correction: number;
  adjusted: number;
  min: number | null;
  max: number | null;
  result: number;
}

function anchorFor(row: number, column: number, kind: RuntimeEntryKind, name: string): number | null {
  if (row < 0 || row >= SIZE_IDS.length || column < 0 || column >= FAT_IDS.length) return null;
  const point = activeBodyCalibrationGrid[row]![column]!;
  if (kind === "positive") return hasOwnWeight(point.positive, name) ? point.positive[name]! : null;
  return point.loraPresence.has(name as MuscleLoraName) ? point.loras[name as MuscleLoraName] : null;
}

function evaluateRuntimeEntry(
  row: number,
  column: number,
  kind: RuntimeEntryKind,
  name: string,
  magnitude: number,
  composition: number,
  skinnyFatMagnitude = 0,
): { value: number; trace: RuntimeEntryTrace } {
  const cellKey = `${SIZE_IDS[row]}:${FAT_IDS[column]}`;
  const cell = activeRuntimeSettings.cells[cellKey]!;
  const sizeCenter = SCALE_STEPS[row]!;
  const verticalNeighbor =
    row === 0
      ? -1
      : magnitude === sizeCenter
        ? -1
        : row === SIZE_IDS.length - 1
          ? row - 1
          : magnitude < sizeCenter
            ? row - 1
            : row + 1;
  const verticalDirection: RuntimeEntryTrace["vertical"]["direction"] =
    magnitude < sizeCenter ? "above" : magnitude > sizeCenter ? "below" : "anchor";
  const vertical =
    kind === "positive"
      ? verticalTagWeight(column, name, magnitude, row, skinnyFatMagnitude)
      : verticalLoraWeight(column, name as MuscleLoraName, magnitude, row);
  const fatCenter = COMPOSITION_STEPS[column]!;
  const horizontalNeighbor =
    row === 0 || column === 0 || composition === fatCenter ? -1 : composition < fatCenter ? column - 1 : column + 1;
  const horizontalDirection: RuntimeEntryTrace["horizontal"]["direction"] =
    row === 0 || column === 0 || composition === fatCenter ? "anchor" : composition < fatCenter ? "left" : "right";
  const automatic =
    kind === "positive"
      ? horizontalTagWeight(row, name, vertical, magnitude, composition, column)
      : horizontalLoraWeight(row, name as MuscleLoraName, vertical, magnitude, composition, column);
  const adjustment = cell.adjustments[kind][name];
  const correction = correctionAt(adjustment, row, column, magnitude, composition);
  const adjusted = automatic + correction;
  const minimum = adjustment?.min ?? null;
  const maximum = adjustment?.max ?? null;
  const result = clamp(adjusted, minimum ?? -Infinity, maximum ?? Infinity);
  const verticalSourceCell = verticalNeighbor >= 0 ? `${SIZE_IDS[verticalNeighbor]}:${FAT_IDS[column]}` : null;
  const horizontalSourceCell = horizontalNeighbor >= 0 ? `${SIZE_IDS[row]}:${FAT_IDS[horizontalNeighbor]}` : null;
  const verticalSourceAnchor = verticalNeighbor >= 0 ? anchorFor(verticalNeighbor, column, kind, name) : null;
  const horizontalSourceAnchor = horizontalNeighbor >= 0 ? anchorFor(row, horizontalNeighbor, kind, name) : null;
  const horizontalSourceAfterVertical =
    horizontalNeighbor >= 0 && horizontalSourceAnchor !== null
      ? kind === "positive"
        ? verticalTagWeight(horizontalNeighbor, name, magnitude, row)
        : verticalLoraWeight(horizontalNeighbor, name as MuscleLoraName, magnitude, row)
      : null;
  const diagonalSourceCell =
    horizontalNeighbor >= 0 && verticalNeighbor >= 0
      ? `${SIZE_IDS[verticalNeighbor]}:${FAT_IDS[horizontalNeighbor]}`
      : null;
  const diagonalSourceAnchor =
    horizontalNeighbor >= 0 && verticalNeighbor >= 0
      ? anchorFor(verticalNeighbor, horizontalNeighbor, kind, name)
      : null;
  return {
    value: result,
    trace: {
      vertical: {
        direction: verticalDirection,
        rule:
          row === 0 && kind === "positive" && name === "skinny"
            ? `curva interna até ${activeRuntimeSettings.interpolation.skinnyExitWeight} (peso ou gordura, o que estiver mais avançado)`
            : "interpolação vertical",
        sourceCell: verticalSourceCell,
        sourcePresent: verticalSourceAnchor !== null,
        sourceAnchor: verticalSourceAnchor,
        result: vertical,
      },
      horizontal: {
        direction: horizontalDirection,
        sourceCell: horizontalSourceCell,
        sourcePresent: horizontalSourceAnchor !== null,
        sourceAnchor: horizontalSourceAnchor,
        sourceAfterVertical: horizontalSourceAfterVertical,
        diagonalSourceCell,
        diagonalSourceAnchor,
        result: automatic,
      },
      automatic,
      correction,
      adjusted,
      min: minimum,
      max: maximum,
      result,
    },
  };
}

function calibrationFor(values: AvatarBodyControlValues): BodyCalibrationPoint {
  const sizeSlider = clamp(values.muscularity, 0, 100);
  const fatSlider = clamp(values.bodyFat, 0, 100);
  const selectedScaleIndex = sliderRuleIndex(sizeSlider, activeRuntimeSettings.sizeRules);
  const magnitude = sliderValueToAuthoredControl(
    sizeSlider,
    activeRuntimeSettings.sizeRules,
    selectedScaleIndex,
    AUTHORED_SCALE_RANGES,
  );
  // Extremely Skinny has only one authored reference. Body fat must not change
  // its tags or LoRAs until Weight selects the Small row.
  const selectedColumnIndex = selectedScaleIndex === 0 ? 0 : sliderRuleIndex(fatSlider, activeRuntimeSettings.fatRules);
  const composition =
    selectedScaleIndex === 0
      ? 0
      : sliderValueToAuthoredControl(
          fatSlider,
          activeRuntimeSettings.fatRules,
          selectedColumnIndex,
          AUTHORED_COMPOSITION_RANGES,
        ) / 100;
  // The `skinny` tag itself is still allowed to fade with body fat inside this
  // isolated row, using the same authored magnitude space as the weight axis.
  const skinnyFatMagnitude =
    selectedScaleIndex === 0
      ? sliderValueToAuthoredControl(fatSlider, activeRuntimeSettings.fatRules, 0, AUTHORED_COMPOSITION_RANGES)
      : 0;
  const selected = activeBodyCalibrationGrid[selectedScaleIndex]![selectedColumnIndex]!;
  const positive = Object.fromEntries(
    Object.keys(selected.positive).map((tag) => [
      tag,
      evaluateRuntimeEntry(
        selectedScaleIndex,
        selectedColumnIndex,
        "positive",
        tag,
        magnitude,
        composition,
        skinnyFatMagnitude,
      ).value,
    ]),
  );
  const loras = Object.fromEntries(
    (Object.keys(EMPTY_LORAS) as MuscleLoraName[]).map((name) => {
      if (!selected.loraPresence.has(name)) return [name, 0];
      return [
        name,
        evaluateRuntimeEntry(selectedScaleIndex, selectedColumnIndex, "loras", name, magnitude, composition).value,
      ];
    }),
  ) as Record<MuscleLoraName, number>;
  return {
    loras,
    loraPresence: selected.loraPresence,
    positive,
    literalPositive: selected.literalPositive,
    negative: selected.negative,
  };
}

export function previewAvatarBodyRuntime(cellKey: string, kind: RuntimeEntryKind, name: string) {
  const [sizeId, fatId] = cellKey.split(":");
  const row = SIZE_IDS.indexOf(sizeId as (typeof SIZE_IDS)[number]);
  const column = FAT_IDS.indexOf(fatId as (typeof FAT_IDS)[number]);
  const cell = activeRuntimeSettings.cells[cellKey];
  if (row < 0 || column < 0 || !cell) throw new Error("Invalid avatar body cellKey");
  if (kind !== "positive" && kind !== "loras") throw new Error("Invalid avatar body entry kind");
  const anchors = kind === "positive" ? cell.positive : cell.loras;
  if (!Object.hasOwn(anchors, name)) throw new Error(`Entry ${name} is not present in ${cellKey}`);

  const sizeRange = AUTHORED_SCALE_RANGES[row]!;
  const fatRange = AUTHORED_COMPOSITION_RANGES[column]!;
  const magnitudes =
    row === 0
      ? [sizeRange[0], (sizeRange[0] + sizeRange[1]) / 2, sizeRange[1]]
      : [sizeRange[0], SCALE_STEPS[row]!, sizeRange[1]];
  const compositions = row === 0 ? [0, 0, 0] : [fatRange[0] / 100, COMPOSITION_STEPS[column]!, fatRange[1] / 100];
  const surface = magnitudes.map((magnitude, verticalIndex) =>
    compositions.map((composition, horizontalIndex) => ({
      verticalIndex,
      horizontalIndex,
      magnitude,
      composition,
      ...evaluateRuntimeEntry(row, column, kind, name, magnitude, composition),
    })),
  );
  const neighborhood = [-1, 0, 1].map((rowOffset) =>
    [-1, 0, 1].map((columnOffset) => {
      const sourceRow = row + rowOffset;
      const sourceColumn = column + columnOffset;
      if (sourceRow < 0 || sourceRow >= SIZE_IDS.length || sourceColumn < 0 || sourceColumn >= FAT_IDS.length) {
        return null;
      }
      const sourceCellKey = `${SIZE_IDS[sourceRow]}:${FAT_IDS[sourceColumn]}`;
      const sourceCell = activeRuntimeSettings.cells[sourceCellKey]!;
      const anchor = anchorFor(sourceRow, sourceColumn, kind, name);
      return {
        cellKey: sourceCellKey,
        reference: sourceCell.reference,
        present: anchor !== null,
        anchor,
        current: rowOffset === 0 && columnOffset === 0,
      };
    }),
  );
  const values = surface.flat().map((point) => point.value);
  return {
    cellKey,
    kind,
    name,
    weightAxisEnabled: true,
    verticalLabels: row === 0 ? ["Entrada", "Meio", "Saída"] : ["Entrada", "Âncora", "Saída"],
    fatAxisEnabled: row !== 0,
    anchor: kind === "positive" ? cell.positive[name] : cell.loras[name as MuscleLoraName],
    range: { min: Math.min(...values), max: Math.max(...values) },
    adjustment: cell.adjustments[kind][name] ?? emptyAdjustment(),
    neighborhood,
    surface,
  };
}

function explicitlyWeighted(tag: string, weight: number): string {
  const printableWeight = Math.abs(weight) < 0.005 ? 0 : weight;
  return `(${tag}:${printableWeight.toFixed(2)})`;
}

function emittedPositiveTags(calibration: BodyCalibrationPoint): string[] {
  return [
    ...calibration.literalPositive.filter((tag) => tag !== "detailed face"),
    ...Object.entries(calibration.positive)
      .filter(([tag]) => tag !== "detailed face")
      .map(([tag, weight]) => explicitlyWeighted(tag, weight)),
  ];
}

function cockTag(values: AvatarBodyControlValues): string | null {
  if (values.cock <= 0) return null;
  const cock =
    values.cock < 40
      ? weighted("bulge", interpolate(values.cock, 0, 39, 0.6, 1.3))
      : values.cock < 60
        ? weighted("penis", interpolate(values.cock, 40, 59, 1, 1.15))
        : values.cock < 75
          ? weighted("big penis", interpolate(values.cock, 60, 74, 1, 1.15))
          : values.cock < 90
            ? weighted("huge penis", interpolate(values.cock, 75, 89, 1, 1.25))
            : weighted("hyper penis", interpolate(values.cock, 90, 100, 1, 1.3));
  return cock;
}

function heightScaleTag(values: AvatarBodyControlValues): string | null {
  if ((values.weightKg ?? 0) < 600) return null;
  const heightCm = values.heightCm ?? 175;
  if (heightCm < 200) return null;
  if (heightCm < 300) return weighted("tall", interpolate(heightCm, 200, 299, 1, 1.3));
  if (heightCm < 1_000) return weighted("giant", interpolate(heightCm, 300, 999, 1, 1.4));
  if (heightCm < 100_000) return weighted("colossal", interpolate(heightCm, 1_000, 99_999, 1, 1.5));
  return weighted("planetary scale", interpolate(heightCm, 100_000, 1_000_000, 1, 1.5));
}

export function applyAvatarBodyControls(
  prompt: LockedAvatarPrompt,
  values: AvatarBodyControlValues,
): LockedAvatarPrompt {
  const calibration = calibrationFor(values);
  const loraTags = (Object.entries(calibration.loras) as Array<[MuscleLoraName, number]>)
    .map(([name, weight]) => [name, weight < 0.05 ? 0 : weight] as const)
    .filter(([name, weight]) => name !== "Hyper_muscles" || weight >= 0.05)
    .map(([name, weight]) => `<lora:${name}:${weight.toFixed(2)}>`);
  const controlledPositive = [
    "20r0j_2",
    "r0kud3n4shi",
    "mass",
    ...loraTags,
    "(detailed face:1.2)",
    ...emittedPositiveTags(calibration),
    heightScaleTag(values),
    cockTag(values),
  ].filter((tag): tag is string => !!tag);
  const positive = [...splitTags(prompt.positive).filter((tag) => !controlledFamily(tag)), ...controlledPositive].join(
    ", ",
  );
  const negative = [
    ...splitTags(prompt.negative).filter((tag) => !controlledFamily(tag)),
    ...Object.keys(calibration.negative),
  ].join(", ");
  return { positive, negative, seed: prompt.seed };
}
