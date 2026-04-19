import "./style.css";
import { DreidelSimulation } from "./sim/DreidelSimulation";
import { DREIDEL_MODELS } from "./sim/dreidelModels";
import type { DreidelResult, DreidelValue } from "./sim/types";

const LOCAL_HISTORY_KEY = "dreidel.local.spin-history.v1";
const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/$/, "");

interface StoredResult extends DreidelResult {
  id: string;
  createdAt: number;
}

interface ResultsResponse {
  items: StoredResult[];
  total: number;
}

interface StatsResponse {
  totalSpins: number;
  averageConfidence: number;
  byValue: Record<DreidelValue, number>;
  byModel: Record<string, number>;
  latestTimestamp: number | null;
  mostFrequentValue: DreidelValue | null;
}

const DREIDEL_VALUES: DreidelValue[] = ["Nun", "Gimel", "Hei", "Shin"];

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("#app root element is missing");
}

app.innerHTML = `
  <div class="layout">
    <aside class="panel">
      <h1 class="title">Dreidel Physics Lab</h1>
      <p class="subtle">Real-time rigid body simulation with programmatic value reading after the dreidel settles.</p>

      <div class="control-group">
        <label>
          Dreidel Model
          <select id="model-select"></select>
        </label>

        <div class="range-row">
          <div class="range-label">
            <span>Spin Rate</span>
            <span><strong id="spin-rate-value"></strong> rad/s</span>
          </div>
          <input id="spin-rate" type="range" min="14" max="58" step="1" value="36" />
        </div>

        <div class="range-row">
          <div class="range-label">
            <span>Initial Tilt</span>
            <span><strong id="tilt-value"></strong> rad</span>
          </div>
          <input id="tilt" type="range" min="0.06" max="0.55" step="0.01" value="0.18" />
        </div>
      </div>

      <div class="actions">
        <button id="spin-btn">Spin Dreidel</button>
        <button id="reset-btn" class="secondary">Reset</button>
      </div>

      <div class="result-box" id="result-box">
        Last result: <strong>None yet</strong>
      </div>

      <div class="api-status" id="api-status" data-mode="pending">
        API: checking...
      </div>

      <div class="stats-box" id="stats-box"></div>

      <div class="history-box">
        <div class="history-title">Recent Spins</div>
        <ul class="history-list" id="history-list"></ul>
      </div>

      <pre class="code-block" id="api-preview">window.getLastDreidelResult() => null</pre>
    </aside>

    <main class="viewport" id="viewport"></main>
  </div>
`;

function requireEl<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Required element not found: ${selector}`);
  }
  return element;
}

function emptyByValue(): Record<DreidelValue, number> {
  return {
    Nun: 0,
    Gimel: 0,
    Hei: 0,
    Shin: 0
  };
}

function apiUrl(path: string): string {
  return `${apiBase}${path}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseStoredResult(value: unknown): StoredResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<StoredResult>;
  if (
    typeof candidate.id !== "string" ||
    !DREIDEL_VALUES.includes(candidate.value as DreidelValue) ||
    !isFiniteNumber(candidate.confidence) ||
    !isFiniteNumber(candidate.spinRateAtRest) ||
    !isFiniteNumber(candidate.linearSpeedAtRest) ||
    typeof candidate.modelKey !== "string" ||
    !isFiniteNumber(candidate.timestamp) ||
    !isFiniteNumber(candidate.createdAt)
  ) {
    return null;
  }

  return {
    id: candidate.id,
    value: candidate.value as DreidelValue,
    confidence: candidate.confidence,
    spinRateAtRest: candidate.spinRateAtRest,
    linearSpeedAtRest: candidate.linearSpeedAtRest,
    modelKey: candidate.modelKey,
    timestamp: candidate.timestamp,
    createdAt: candidate.createdAt
  };
}

function toStoredResult(result: DreidelResult): StoredResult {
  const fallbackId = `${result.timestamp}-${Math.random().toString(16).slice(2, 8)}`;
  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : fallbackId;
  return {
    ...result,
    id,
    createdAt: Date.now()
  };
}

function readLocalHistory(): StoredResult[] {
  try {
    const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => parseStoredResult(item))
      .filter((item): item is StoredResult => item !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

function writeLocalHistory(items: StoredResult[]): void {
  const next = items.slice(0, 200);
  localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(next));
}

function buildStats(items: StoredResult[]): StatsResponse {
  const byValue = emptyByValue();
  const byModel: Record<string, number> = {};

  let confidenceAccumulator = 0;
  let latestTimestamp: number | null = null;

  for (const item of items) {
    byValue[item.value] += 1;
    byModel[item.modelKey] = (byModel[item.modelKey] ?? 0) + 1;
    confidenceAccumulator += item.confidence;

    if (latestTimestamp === null || item.timestamp > latestTimestamp) {
      latestTimestamp = item.timestamp;
    }
  }

  const totalSpins = items.length;
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

const viewport = requireEl<HTMLElement>("#viewport");
const modelSelect = requireEl<HTMLSelectElement>("#model-select");
const spinRateInput = requireEl<HTMLInputElement>("#spin-rate");
const tiltInput = requireEl<HTMLInputElement>("#tilt");
const spinRateValue = requireEl<HTMLElement>("#spin-rate-value");
const tiltValue = requireEl<HTMLElement>("#tilt-value");
const spinButton = requireEl<HTMLButtonElement>("#spin-btn");
const resetButton = requireEl<HTMLButtonElement>("#reset-btn");
const resultBox = requireEl<HTMLElement>("#result-box");
const apiStatus = requireEl<HTMLElement>("#api-status");
const statsBox = requireEl<HTMLElement>("#stats-box");
const historyList = requireEl<HTMLUListElement>("#history-list");
const apiPreview = requireEl<HTMLElement>("#api-preview");

for (const model of DREIDEL_MODELS) {
  const option = document.createElement("option");
  option.value = model.key;
  option.textContent = model.label;
  modelSelect.append(option);
}

spinRateValue.textContent = spinRateInput.value;
tiltValue.textContent = Number(tiltInput.value).toFixed(2);

function renderResult(result: DreidelResult): void {
  const localTime = new Date(result.timestamp).toLocaleTimeString();
  resultBox.innerHTML =
    `Last result: <strong>${result.value}</strong>` +
    `<br />Confidence: ${(result.confidence * 100).toFixed(1)}%` +
    `<br />Rest speeds: linear ${result.linearSpeedAtRest.toFixed(3)} m/s, angular ${result.spinRateAtRest.toFixed(3)} rad/s` +
    `<br />Model: ${result.modelKey} | at ${localTime}`;

  apiPreview.textContent = `window.getLastDreidelResult() => ${JSON.stringify(result, null, 2)}`;
}

function renderStats(stats: StatsResponse, source: "server" | "local"): void {
  const topModel = Object.entries(stats.byModel).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "n/a";

  statsBox.innerHTML =
    `<strong>Stats (${source})</strong>` +
    `<br />Total spins: ${stats.totalSpins}` +
    `<br />Average confidence: ${(stats.averageConfidence * 100).toFixed(1)}%` +
    `<br />Most frequent value: ${stats.mostFrequentValue ?? "n/a"}` +
    `<br />Top model: ${topModel}` +
    `<br />By value: N ${stats.byValue.Nun}, G ${stats.byValue.Gimel}, H ${stats.byValue.Hei}, S ${stats.byValue.Shin}`;
}

function renderHistory(items: StoredResult[], source: "server" | "local"): void {
  historyList.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = `No spins yet (${source})`;
    historyList.append(empty);
    return;
  }

  for (const item of items.slice(0, 8)) {
    const row = document.createElement("li");
    const time = new Date(item.timestamp).toLocaleTimeString();
    row.textContent = `${time} • ${item.value} • ${item.modelKey} • ${(item.confidence * 100).toFixed(1)}%`;
    historyList.append(row);
  }
}

function renderSourceStatus(source: "server" | "local"): void {
  if (source === "server") {
    apiStatus.dataset.mode = "online";
    apiStatus.textContent = `API: connected (${apiBase || "same-origin /api"})`;
    return;
  }

  apiStatus.dataset.mode = "offline";
  apiStatus.textContent = "API: unavailable, using local browser fallback";
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

async function refreshDataPanels(): Promise<void> {
  try {
    const [stats, results] = await Promise.all([
      requestJson<StatsResponse>("/api/stats"),
      requestJson<ResultsResponse>("/api/results?limit=8")
    ]);
    renderSourceStatus("server");
    renderStats(stats, "server");
    renderHistory(results.items, "server");
  } catch {
    const localItems = readLocalHistory();
    renderSourceStatus("local");
    renderStats(buildStats(localItems), "local");
    renderHistory(localItems, "local");
  }
}

async function persistSpinResult(result: DreidelResult): Promise<void> {
  try {
    await requestJson<{ item: StoredResult }>("/api/results", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(result)
    });
  } catch {
    const localItems = readLocalHistory();
    localItems.unshift(toStoredResult(result));
    writeLocalHistory(localItems);
  }

  await refreshDataPanels();
}

const simulation = new DreidelSimulation(viewport, (result) => {
  renderResult(result);
  void persistSpinResult(result);

  window.dispatchEvent(
    new CustomEvent("dreidel:settled", {
      detail: result
    })
  );
});

modelSelect.addEventListener("change", () => {
  simulation.setModel(modelSelect.value);
  resultBox.innerHTML = "Last result: <strong>Model switched</strong>";
  apiPreview.textContent = "window.getLastDreidelResult() => null";
});

spinRateInput.addEventListener("input", () => {
  spinRateValue.textContent = spinRateInput.value;
});

tiltInput.addEventListener("input", () => {
  tiltValue.textContent = Number(tiltInput.value).toFixed(2);
});

spinButton.addEventListener("click", () => {
  const spinRate = Number(spinRateInput.value);
  const tilt = Number(tiltInput.value);
  resultBox.innerHTML = "Spinning... waiting for the dreidel to settle";
  simulation.spin({ spinRate, tilt });
});

resetButton.addEventListener("click", () => {
  simulation.reset();
  resultBox.innerHTML = "Last result: <strong>Reset complete</strong>";
  apiPreview.textContent = "window.getLastDreidelResult() => null";
});

declare global {
  interface Window {
    getLastDreidelResult: () => DreidelResult | null;
    getDreidelStats: () => Promise<StatsResponse>;
  }
}

window.getLastDreidelResult = () => simulation.getLastResult();
window.getDreidelStats = async () => {
  try {
    return await requestJson<StatsResponse>("/api/stats");
  } catch {
    return buildStats(readLocalHistory());
  }
};

void refreshDataPanels();
