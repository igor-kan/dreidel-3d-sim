import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const DREIDEL_VALUES = ["Nun", "Gimel", "Hei", "Shin"] as const;

export type DreidelValue = (typeof DREIDEL_VALUES)[number];

export interface SpinPayload {
  value: DreidelValue;
  confidence: number;
  spinRateAtRest: number;
  linearSpeedAtRest: number;
  modelKey: string;
  timestamp: number;
}

export interface StoredSpinResult extends SpinPayload {
  id: string;
  createdAt: number;
}

export interface SpinStats {
  totalSpins: number;
  averageConfidence: number;
  byValue: Record<DreidelValue, number>;
  byModel: Record<string, number>;
  latestTimestamp: number | null;
  mostFrequentValue: DreidelValue | null;
}

interface PersistedStore {
  items: StoredSpinResult[];
}

const MAX_STORED_ITEMS = 5000;
const DATA_DIR = path.resolve(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "spin-results.json");
const TEMP_FILE = path.join(DATA_DIR, "spin-results.json.tmp");

function emptyByValue(): Record<DreidelValue, number> {
  return {
    Nun: 0,
    Gimel: 0,
    Hei: 0,
    Shin: 0
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDreidelValue(value: unknown): value is DreidelValue {
  return typeof value === "string" && DREIDEL_VALUES.includes(value as DreidelValue);
}

function isStoredSpinResult(value: unknown): value is StoredSpinResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<StoredSpinResult>;
  return (
    typeof candidate.id === "string" &&
    isDreidelValue(candidate.value) &&
    isFiniteNumber(candidate.confidence) &&
    isFiniteNumber(candidate.spinRateAtRest) &&
    isFiniteNumber(candidate.linearSpeedAtRest) &&
    typeof candidate.modelKey === "string" &&
    isFiniteNumber(candidate.timestamp) &&
    isFiniteNumber(candidate.createdAt)
  );
}

async function readStore(): Promise<PersistedStore> {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      return { items: [] };
    }

    const maybeItems = (parsed as Partial<PersistedStore>).items;
    if (!Array.isArray(maybeItems)) {
      return { items: [] };
    }

    const items = maybeItems.filter(isStoredSpinResult);
    items.sort((a, b) => b.createdAt - a.createdAt);
    return { items };
  } catch {
    return { items: [] };
  }
}

async function writeStore(store: PersistedStore): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const payload = JSON.stringify(store, null, 2);
  await writeFile(TEMP_FILE, payload, "utf8");
  await rename(TEMP_FILE, DATA_FILE);
}

function sanitizePayload(payload: SpinPayload): SpinPayload {
  return {
    value: payload.value,
    confidence: clamp(payload.confidence, 0, 1),
    spinRateAtRest: clamp(payload.spinRateAtRest, 0, 200),
    linearSpeedAtRest: clamp(payload.linearSpeedAtRest, 0, 200),
    modelKey: payload.modelKey.slice(0, 80),
    timestamp: Math.floor(payload.timestamp)
  };
}

export async function insertSpin(payload: SpinPayload): Promise<StoredSpinResult> {
  const normalized = sanitizePayload(payload);
  const store = await readStore();

  const created: StoredSpinResult = {
    ...normalized,
    id: randomUUID(),
    createdAt: Date.now()
  };

  store.items.unshift(created);
  if (store.items.length > MAX_STORED_ITEMS) {
    store.items.length = MAX_STORED_ITEMS;
  }

  await writeStore(store);
  return created;
}

export async function listSpins(limit: number): Promise<{ items: StoredSpinResult[]; total: number }> {
  const store = await readStore();
  const safeLimit = clamp(Math.floor(limit), 1, 200);
  return {
    items: store.items.slice(0, safeLimit),
    total: store.items.length
  };
}

export async function getSpinStats(): Promise<SpinStats> {
  const store = await readStore();
  const byValue = emptyByValue();
  const byModel: Record<string, number> = {};

  let confidenceAccumulator = 0;
  let latestTimestamp: number | null = null;

  for (const entry of store.items) {
    byValue[entry.value] += 1;
    byModel[entry.modelKey] = (byModel[entry.modelKey] ?? 0) + 1;
    confidenceAccumulator += entry.confidence;

    if (latestTimestamp === null || entry.timestamp > latestTimestamp) {
      latestTimestamp = entry.timestamp;
    }
  }

  const totalSpins = store.items.length;
  const averageConfidence =
    totalSpins > 0 ? Number((confidenceAccumulator / totalSpins).toFixed(4)) : 0;

  let mostFrequentValue: DreidelValue | null = null;
  let bestCount = 0;
  for (const value of DREIDEL_VALUES) {
    const count = byValue[value];
    if (count > bestCount) {
      bestCount = count;
      mostFrequentValue = value;
    }
  }

  return {
    totalSpins,
    averageConfidence,
    byValue,
    byModel,
    latestTimestamp,
    mostFrequentValue
  };
}

export function parseSpinPayload(body: unknown): SpinPayload | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const candidate = body as Partial<SpinPayload>;

  if (!isDreidelValue(candidate.value)) {
    return null;
  }

  if (
    !isFiniteNumber(candidate.confidence) ||
    !isFiniteNumber(candidate.spinRateAtRest) ||
    !isFiniteNumber(candidate.linearSpeedAtRest) ||
    !isFiniteNumber(candidate.timestamp)
  ) {
    return null;
  }

  if (typeof candidate.modelKey !== "string" || candidate.modelKey.length === 0) {
    return null;
  }

  return sanitizePayload({
    value: candidate.value,
    confidence: candidate.confidence,
    spinRateAtRest: candidate.spinRateAtRest,
    linearSpeedAtRest: candidate.linearSpeedAtRest,
    modelKey: candidate.modelKey,
    timestamp: candidate.timestamp
  });
}
