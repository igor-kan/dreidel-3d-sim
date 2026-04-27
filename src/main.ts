import "./style.css";
import { DreidelSimulation } from "./sim/DreidelSimulation";
import { DREIDEL_MODELS } from "./sim/dreidelModels";
import type { DreidelResult, DreidelValue, SpinOptions } from "./sim/types";

const LOCAL_HISTORY_KEY = "dreidel.local.spin-history.v2";
const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/$/, "");

const DREIDEL_VALUES: DreidelValue[] = ["Nun", "Gimel", "Hei", "Shin"];

type DataSource = "server" | "local";

interface StoredResult extends DreidelResult {
  id: string;
  createdAt: number;
  userId: string | null;
  username: string | null;
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

interface PublicUser {
  id: string;
  username: string;
  email: string;
  role: "user" | "admin" | "developer";
  provider: "local" | "google" | "github";
  createdAt: number;
  lastLoginAt: number;
  totalSpins: number;
  wins: number;
  averageConfidence: number;
  valueCounts: Record<DreidelValue, number>;
}

interface HealthResponse {
  status: string;
  timestamp: number;
  oauth?: {
    google: boolean;
    github: boolean;
  };
  payments?: {
    solana: boolean;
    ethereum: boolean;
    polygon: boolean;
    base: boolean;
  };
  storage?: {
    mode: "postgres" | "json";
    ready: boolean;
    error: string | null;
  };
}

interface LeaderboardEntry {
  userId: string;
  username: string;
  role: "user" | "admin" | "developer";
  wins: number;
  totalSpins: number;
  averageConfidence: number;
  score: number;
}

interface LobbyPlayer {
  userId: string;
  username: string;
  role: "user" | "admin" | "developer";
  joinedAt: number;
  lastSeenAt: number;
}

interface LobbySnapshot {
  roomId: string;
  maxPlayers: number;
  players: LobbyPlayer[];
}

type PaymentChain = "solana" | "ethereum" | "polygon" | "base";

interface PaymentIntent {
  id: string;
  userId: string;
  username: string;
  chain: PaymentChain;
  amount: number;
  currency: string;
  payToAddress: string;
  paymentUri: string;
  status: "created" | "submitted" | "confirmed" | "rejected";
  txHash: string | null;
  walletAddress: string | null;
  note: string;
  createdAt: number;
  updatedAt: number;
}

class ApiError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("#app root element is missing");
}

app.innerHTML = `
  <div class="layout">
    <aside class="panel">
      <h1 class="title">Dreidel Physics Arena</h1>
      <p class="subtle">Camera drag works anywhere. Drag the center body to set tilt, then drag the top stem outward to spin.</p>

      <section class="card">
        <h2>Account</h2>
        <div class="auth-state" id="auth-state">Checking session...</div>

        <form id="register-form" class="stack-form">
          <label>
            Username
            <input id="register-username" required minlength="3" maxlength="50" />
          </label>
          <label>
            Email
            <input id="register-email" type="email" required />
          </label>
          <label>
            Password
            <input id="register-password" type="password" minlength="8" required />
          </label>
          <button type="submit">Register</button>
        </form>

        <form id="login-form" class="stack-form">
          <label>
            Email or Username
            <input id="login-identifier" required />
          </label>
          <label>
            Password
            <input id="login-password" type="password" required />
          </label>
          <button type="submit">Login</button>
        </form>

        <div class="oauth-row">
          <a id="oauth-google" class="oauth-btn" href="#" rel="noopener noreferrer">Google OAuth</a>
          <a id="oauth-github" class="oauth-btn" href="#" rel="noopener noreferrer">GitHub OAuth</a>
        </div>

        <button id="logout-btn" class="secondary">Logout</button>
        <div class="tiny" id="auth-message"></div>
      </section>

      <section class="card">
        <h2>Game</h2>
        <label>
          Dreidel Model
          <select id="model-select"></select>
        </label>

        <div class="actions">
          <button id="random-spin-btn">Random Toss</button>
          <button id="reset-btn" class="secondary">Reset</button>
        </div>

        <div id="admin-controls" class="admin-controls" hidden>
          <h3>Admin / Developer Launch Controls</h3>

          <div class="range-row">
            <div class="range-label">
              <span>Spin Rate</span>
              <strong id="spin-rate-value"></strong>
            </div>
            <input id="spin-rate" type="range" min="14" max="58" step="1" value="36" />
          </div>

          <div class="range-row">
            <div class="range-label">
              <span>Tilt</span>
              <strong id="tilt-value"></strong>
            </div>
            <input id="tilt" type="range" min="0.06" max="0.55" step="0.01" value="0.18" />
          </div>

          <button id="admin-spin-btn" class="secondary">Launch With Admin Preset</button>
        </div>

        <div class="result-box" id="result-box">Last result: <strong>None yet</strong></div>
        <div class="api-status" id="api-status" data-mode="pending">API: checking...</div>
      </section>

      <section class="card">
        <h2>Players <span id="players-count" class="tiny">0/8</span></h2>
        <ul id="players-list" class="simple-list"></ul>
      </section>

      <section class="card">
        <h2>Leaderboard</h2>
        <ol id="leaderboard-list" class="simple-list"></ol>
      </section>

      <section class="card" id="payments-card">
        <h2>Payments</h2>
        <p class="tiny">Create Solana/EVM payment intents, then submit wallet + tx proof.</p>

        <form id="payment-form" class="stack-form">
          <label>
            Chain
            <select id="payment-chain">
              <option value="solana">Solana</option>
              <option value="ethereum">Ethereum</option>
              <option value="polygon">Polygon</option>
              <option value="base">Base</option>
            </select>
          </label>
          <label>
            Amount
            <input id="payment-amount" type="number" min="0.000001" step="0.000001" value="0.01" required />
          </label>
          <label>
            Note
            <input id="payment-note" maxlength="160" placeholder="Tournament buy-in" />
          </label>
          <button type="submit">Create Payment Intent</button>
        </form>

        <div id="payment-current" class="tiny"></div>

        <form id="payment-proof-form" class="stack-form">
          <label>
            Payment ID
            <input id="proof-payment-id" required />
          </label>
          <label>
            Wallet Address
            <input id="proof-wallet" required />
          </label>
          <label>
            Tx Hash / Signature
            <input id="proof-tx" required />
          </label>
          <button type="submit" class="secondary">Submit Payment Proof</button>
        </form>

        <ul id="payment-list" class="simple-list"></ul>
      </section>

      <section class="card">
        <h2>Stats</h2>
        <div id="stats-box" class="stats-box"></div>
        <ul id="history-list" class="simple-list"></ul>
      </section>

      <pre class="code-block" id="api-preview">window.getLastDreidelResult() => null</pre>
    </aside>

    <main class="viewport-wrap">
      <div class="gesture-overlay">
        Camera: drag anywhere, wheel/pinch to zoom
        <br />Tilt: drag center body
        <br />Spin: drag top stem outward
      </div>
      <div class="viewport" id="viewport"></div>
    </main>
  </div>
`;

function requireEl<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Required element not found: ${selector}`);
  }
  return element;
}

function apiUrl(path: string): string {
  return `${apiBase}${path}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {})
    }
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const code =
      parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string"
        ? parsed.error
        : null;
    throw new ApiError(response.status, code, `${response.status} ${response.statusText}`);
  }

  return parsed as T;
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
    createdAt: candidate.createdAt,
    userId: typeof candidate.userId === "string" ? candidate.userId : null,
    username: typeof candidate.username === "string" ? candidate.username : null
  };
}

function toStoredResult(result: DreidelResult): StoredResult {
  const fallbackId = `${result.timestamp}-${Math.random().toString(16).slice(2, 8)}`;
  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : fallbackId;
  return {
    ...result,
    id,
    createdAt: Date.now(),
    userId: currentUser?.id ?? null,
    username: currentUser?.username ?? null
  };
}

function emptyByValue(): Record<DreidelValue, number> {
  return {
    Nun: 0,
    Gimel: 0,
    Hei: 0,
    Shin: 0
  };
}

function readLocalHistory(): StoredResult[] {
  try {
    const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
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
  localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(items.slice(0, 200)));
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
      mostFrequentValue = value;
      bestCount = count;
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

const viewport = requireEl<HTMLDivElement>("#viewport");
const modelSelect = requireEl<HTMLSelectElement>("#model-select");
const randomSpinButton = requireEl<HTMLButtonElement>("#random-spin-btn");
const resetButton = requireEl<HTMLButtonElement>("#reset-btn");
const adminControls = requireEl<HTMLElement>("#admin-controls");
const adminSpinButton = requireEl<HTMLButtonElement>("#admin-spin-btn");
const spinRateInput = requireEl<HTMLInputElement>("#spin-rate");
const tiltInput = requireEl<HTMLInputElement>("#tilt");
const spinRateValue = requireEl<HTMLElement>("#spin-rate-value");
const tiltValue = requireEl<HTMLElement>("#tilt-value");

const authState = requireEl<HTMLElement>("#auth-state");
const authMessage = requireEl<HTMLElement>("#auth-message");
const registerForm = requireEl<HTMLFormElement>("#register-form");
const loginForm = requireEl<HTMLFormElement>("#login-form");
const logoutButton = requireEl<HTMLButtonElement>("#logout-btn");
const oauthGoogle = requireEl<HTMLAnchorElement>("#oauth-google");
const oauthGithub = requireEl<HTMLAnchorElement>("#oauth-github");

const resultBox = requireEl<HTMLElement>("#result-box");
const apiStatus = requireEl<HTMLElement>("#api-status");
const statsBox = requireEl<HTMLElement>("#stats-box");
const historyList = requireEl<HTMLUListElement>("#history-list");
const playersCount = requireEl<HTMLElement>("#players-count");
const playersList = requireEl<HTMLUListElement>("#players-list");
const leaderboardList = requireEl<HTMLOListElement>("#leaderboard-list");
const apiPreview = requireEl<HTMLElement>("#api-preview");

const paymentsCard = requireEl<HTMLElement>("#payments-card");
const paymentForm = requireEl<HTMLFormElement>("#payment-form");
const paymentChain = requireEl<HTMLSelectElement>("#payment-chain");
const paymentAmount = requireEl<HTMLInputElement>("#payment-amount");
const paymentNote = requireEl<HTMLInputElement>("#payment-note");
const paymentCurrent = requireEl<HTMLElement>("#payment-current");
const paymentProofForm = requireEl<HTMLFormElement>("#payment-proof-form");
const proofPaymentId = requireEl<HTMLInputElement>("#proof-payment-id");
const proofWallet = requireEl<HTMLInputElement>("#proof-wallet");
const proofTx = requireEl<HTMLInputElement>("#proof-tx");
const paymentList = requireEl<HTMLUListElement>("#payment-list");

let currentUser: PublicUser | null = null;
let currentDataSource: DataSource = "local";
let lastHealth: HealthResponse | null = null;
let recentPaymentIntents: PaymentIntent[] = [];
let lobbyJoined = false;

for (const model of DREIDEL_MODELS) {
  const option = document.createElement("option");
  option.value = model.key;
  option.textContent = model.label;
  modelSelect.append(option);
}

spinRateValue.textContent = `${spinRateInput.value} rad/s`;
tiltValue.textContent = Number(tiltInput.value).toFixed(2);

function updateApiStatus(source: DataSource, health: HealthResponse | null = null): void {
  currentDataSource = source;
  if (source === "server") {
    const storageLabel = health?.storage
      ? ` | storage: ${health.storage.mode}${health.storage.ready ? "" : " (not ready)"}`
      : "";
    const oauthLabel = health?.oauth
      ? ` | oauth: google ${health.oauth.google ? "on" : "off"}, github ${health.oauth.github ? "on" : "off"}`
      : "";
    const paymentsEnabled = health?.payments
      ? [health.payments.solana, health.payments.ethereum, health.payments.polygon, health.payments.base].filter(
          Boolean
        ).length
      : null;
    const paymentsLabel =
      paymentsEnabled === null ? "" : ` | payments: ${paymentsEnabled}/4 chains configured`;
    apiStatus.dataset.mode = "online";
    apiStatus.textContent = `API: connected (${apiBase || "same-origin /api"}${storageLabel}${oauthLabel}${paymentsLabel})`;
    return;
  }

  apiStatus.dataset.mode = "offline";
  apiStatus.textContent = "API: unavailable, local browser fallback active";
}

function renderResult(result: DreidelResult): void {
  const localTime = new Date(result.timestamp).toLocaleTimeString();
  resultBox.innerHTML =
    `Last result: <strong>${result.value}</strong>` +
    `<br />Confidence: ${(result.confidence * 100).toFixed(1)}%` +
    `<br />Rest speed: ${result.spinRateAtRest.toFixed(3)} rad/s angular, ${result.linearSpeedAtRest.toFixed(3)} m/s linear` +
    `<br />Model: ${result.modelKey} at ${localTime}`;

  apiPreview.textContent = `window.getLastDreidelResult() => ${JSON.stringify(result, null, 2)}`;
}

function renderHistory(items: StoredResult[], source: DataSource): void {
  historyList.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = `No spins recorded (${source})`;
    historyList.append(empty);
    return;
  }

  for (const item of items.slice(0, 8)) {
    const row = document.createElement("li");
    const time = new Date(item.timestamp).toLocaleTimeString();
    const owner = item.username ? ` • ${item.username}` : "";
    row.textContent = `${time} • ${item.value} • ${item.modelKey}${owner}`;
    historyList.append(row);
  }
}

function renderStats(stats: StatsResponse, source: DataSource): void {
  const topModel = Object.entries(stats.byModel).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "n/a";

  statsBox.innerHTML =
    `<strong>Source: ${source}</strong>` +
    `<br />Total spins: ${stats.totalSpins}` +
    `<br />Average confidence: ${(stats.averageConfidence * 100).toFixed(1)}%` +
    `<br />Most frequent value: ${stats.mostFrequentValue ?? "n/a"}` +
    `<br />Top model: ${topModel}` +
    `<br />By value: N ${stats.byValue.Nun}, G ${stats.byValue.Gimel}, H ${stats.byValue.Hei}, S ${stats.byValue.Shin}`;
}

function renderLeaderboard(items: LeaderboardEntry[]): void {
  leaderboardList.replaceChildren();

  if (items.length === 0) {
    const row = document.createElement("li");
    row.textContent = "No leaderboard entries yet";
    leaderboardList.append(row);
    return;
  }

  for (const [index, item] of items.entries()) {
    const row = document.createElement("li");
    row.textContent = `#${index + 1} ${item.username} (${item.role}) • wins ${item.wins} • spins ${item.totalSpins} • score ${item.score.toFixed(2)}`;
    leaderboardList.append(row);
  }
}

function renderLobby(snapshot: LobbySnapshot): void {
  playersCount.textContent = `${snapshot.players.length}/${snapshot.maxPlayers}`;
  playersList.replaceChildren();

  if (snapshot.players.length === 0) {
    const row = document.createElement("li");
    row.textContent = "Lobby empty";
    playersList.append(row);
    return;
  }

  for (const player of snapshot.players) {
    const row = document.createElement("li");
    const you = currentUser && player.userId === currentUser.id ? " (you)" : "";
    row.textContent = `${player.username} • ${player.role}${you}`;
    playersList.append(row);
  }
}

function renderPaymentIntents(items: PaymentIntent[]): void {
  recentPaymentIntents = items;
  paymentList.replaceChildren();

  if (items.length === 0) {
    const row = document.createElement("li");
    row.textContent = "No payment intents yet";
    paymentList.append(row);
    return;
  }

  for (const item of items.slice(0, 8)) {
    const row = document.createElement("li");
    const created = new Date(item.createdAt).toLocaleTimeString();
    row.textContent = `${item.id.slice(0, 8)} • ${item.chain.toUpperCase()} ${item.amount} ${item.currency} • ${item.status} • ${created}`;
    paymentList.append(row);
  }
}

function setAuthMessage(message: string, isError = false): void {
  authMessage.textContent = message;
  authMessage.dataset.mode = isError ? "error" : "ok";
}

function updateAuthUi(): void {
  if (!currentUser) {
    authState.textContent = "Guest mode";
    authState.dataset.mode = "guest";
    logoutButton.disabled = true;
    adminControls.hidden = true;
    paymentsCard.classList.add("disabled");
    paymentForm.querySelectorAll("input, select, button").forEach((node) => {
      (node as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = true;
    });
    paymentProofForm.querySelectorAll("input, button").forEach((node) => {
      (node as HTMLInputElement | HTMLButtonElement).disabled = true;
    });
    return;
  }

  authState.textContent = `${currentUser.username} (${currentUser.role})`;
  authState.dataset.mode = "user";
  logoutButton.disabled = false;

  const canUseAdmin = currentUser.role === "admin" || currentUser.role === "developer";
  adminControls.hidden = !canUseAdmin;

  paymentsCard.classList.remove("disabled");
  paymentForm.querySelectorAll("input, select, button").forEach((node) => {
    (node as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = false;
  });
  paymentProofForm.querySelectorAll("input, button").forEach((node) => {
    (node as HTMLInputElement | HTMLButtonElement).disabled = false;
  });
}

function randomSpinOptions(): SpinOptions {
  return {
    spinRate: 28 + Math.random() * 12,
    tilt: 0.14 + Math.random() * 0.2
  };
}

async function checkApiHealth(): Promise<void> {
  try {
    const health = await requestJson<HealthResponse>("/api/health");
    lastHealth = health;
    updateApiStatus("server", health);
  } catch {
    lastHealth = null;
    updateApiStatus("local");
  }

  const googleEnabled = Boolean(lastHealth?.oauth?.google);
  const githubEnabled = Boolean(lastHealth?.oauth?.github);

  oauthGoogle.href = googleEnabled ? apiUrl("/api/oauth-google") : "#";
  oauthGithub.href = githubEnabled ? apiUrl("/api/oauth-github") : "#";
  oauthGoogle.classList.toggle("disabled", !googleEnabled);
  oauthGithub.classList.toggle("disabled", !githubEnabled);
}

async function refreshAuthSession(): Promise<void> {
  try {
    const response = await requestJson<{ user: PublicUser | null }>("/api/auth-me");
    currentUser = response.user;
  } catch {
    currentUser = null;
  }

  updateAuthUi();
}

async function refreshStatsAndHistory(): Promise<void> {
  try {
    const [stats, results] = await Promise.all([
      requestJson<StatsResponse>("/api/stats"),
      requestJson<ResultsResponse>("/api/results?limit=8")
    ]);
    updateApiStatus("server", lastHealth);
    renderStats(stats, "server");
    renderHistory(results.items, "server");
    return;
  } catch {
    const localItems = readLocalHistory();
    updateApiStatus("local");
    renderStats(buildStats(localItems), "local");
    renderHistory(localItems, "local");
  }
}

async function refreshLeaderboard(): Promise<void> {
  try {
    const response = await requestJson<{ items: LeaderboardEntry[] }>("/api/leaderboard?limit=20");
    renderLeaderboard(response.items);
  } catch {
    renderLeaderboard([]);
  }
}

async function refreshLobby(forceJoin = false): Promise<void> {
  try {
    if (!currentUser) {
      lobbyJoined = false;
      const snapshot = await requestJson<LobbySnapshot>("/api/lobby");
      renderLobby(snapshot);
      return;
    }

    if (forceJoin || !lobbyJoined) {
      const snapshot = await requestJson<LobbySnapshot>("/api/lobby-join", {
        method: "POST"
      });
      lobbyJoined = true;
      renderLobby(snapshot);
      return;
    }

    const snapshot = await requestJson<LobbySnapshot>("/api/lobby-heartbeat", {
      method: "POST"
    });
    renderLobby(snapshot);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      lobbyJoined = false;
      currentUser = null;
      updateAuthUi();
    }
    renderLobby({ roomId: "main-room", maxPlayers: 8, players: [] });
  }
}

async function refreshPayments(): Promise<void> {
  if (!currentUser) {
    paymentCurrent.textContent = "Login required for payment intents.";
    renderPaymentIntents([]);
    return;
  }

  try {
    const includeAll = currentUser.role === "admin" || currentUser.role === "developer";
    const query = includeAll ? "?limit=20&all=true" : "?limit=20";
    const response = await requestJson<{ items: PaymentIntent[] }>(`/api/payments-intents${query}`);
    renderPaymentIntents(response.items);

    const active = response.items[0];
    if (active) {
      proofPaymentId.value = active.id;
      paymentCurrent.innerHTML =
        `Pay to: <code>${active.payToAddress}</code>` +
        `<br />URI: <a href="${active.paymentUri}" target="_blank" rel="noopener noreferrer">${active.paymentUri}</a>`;
    } else {
      paymentCurrent.textContent = "No payment intents yet.";
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      paymentCurrent.textContent = "Login required for payment intents.";
    } else {
      paymentCurrent.textContent = "Unable to load payment intents.";
    }
    renderPaymentIntents([]);
  }
}

async function persistSpinResult(result: DreidelResult): Promise<void> {
  try {
    await requestJson<{ item: StoredResult }>("/api/results", {
      method: "POST",
      body: JSON.stringify(result)
    });
  } catch {
    const localItems = readLocalHistory();
    localItems.unshift(toStoredResult(result));
    writeLocalHistory(localItems);
  }

  await Promise.all([refreshStatsAndHistory(), refreshLeaderboard()]);
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
  spinRateValue.textContent = `${spinRateInput.value} rad/s`;
});

tiltInput.addEventListener("input", () => {
  tiltValue.textContent = Number(tiltInput.value).toFixed(2);
});

randomSpinButton.addEventListener("click", () => {
  resultBox.innerHTML = "Spinning... drag center to tilt and top stem to launch custom spins.";
  simulation.spin(randomSpinOptions(), { source: "api" });
});

adminSpinButton.addEventListener("click", () => {
  if (!currentUser || (currentUser.role !== "admin" && currentUser.role !== "developer")) {
    setAuthMessage("Admin/developer role required for slider launch.", true);
    return;
  }

  const spinRate = Number(spinRateInput.value);
  const tilt = Number(tiltInput.value);
  resultBox.innerHTML = "Admin preset launch in progress...";
  simulation.spin({ spinRate, tilt }, { source: "admin" });
});

resetButton.addEventListener("click", () => {
  simulation.reset();
  resultBox.innerHTML = "Last result: <strong>Reset complete</strong>";
  apiPreview.textContent = "window.getLastDreidelResult() => null";
});

registerForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const username = requireEl<HTMLInputElement>("#register-username").value;
  const email = requireEl<HTMLInputElement>("#register-email").value;
  const password = requireEl<HTMLInputElement>("#register-password").value;

  void (async () => {
    try {
      const response = await requestJson<{ user: PublicUser }>("/api/auth-register", {
        method: "POST",
        body: JSON.stringify({ username, email, password })
      });

      currentUser = response.user;
      updateAuthUi();
      setAuthMessage("Registration successful.");
      registerForm.reset();

      await Promise.all([refreshLobby(true), refreshLeaderboard(), refreshPayments()]);
    } catch (error) {
      const message = error instanceof ApiError && error.code ? error.code : "register_failed";
      setAuthMessage(message, true);
    }
  })();
});

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const identifier = requireEl<HTMLInputElement>("#login-identifier").value;
  const password = requireEl<HTMLInputElement>("#login-password").value;

  void (async () => {
    try {
      const response = await requestJson<{ user: PublicUser }>("/api/auth-login", {
        method: "POST",
        body: JSON.stringify({ identifier, password })
      });

      currentUser = response.user;
      updateAuthUi();
      setAuthMessage("Login successful.");
      loginForm.reset();

      await Promise.all([refreshLobby(true), refreshLeaderboard(), refreshPayments()]);
    } catch (error) {
      const message = error instanceof ApiError && error.code ? error.code : "login_failed";
      setAuthMessage(message, true);
    }
  })();
});

logoutButton.addEventListener("click", () => {
  void (async () => {
    try {
      await requestJson<{ ok: boolean }>("/api/auth-logout", {
        method: "POST"
      });
    } catch {
      // ignore logout network errors
    }

    currentUser = null;
    lobbyJoined = false;
    updateAuthUi();
    setAuthMessage("Logged out.");

    await Promise.all([refreshLobby(false), refreshLeaderboard(), refreshPayments()]);
  })();
});

oauthGoogle.addEventListener("click", (event) => {
  if (oauthGoogle.classList.contains("disabled")) {
    event.preventDefault();
    setAuthMessage("Google OAuth is not configured on the server.", true);
  }
});

oauthGithub.addEventListener("click", (event) => {
  if (oauthGithub.classList.contains("disabled")) {
    event.preventDefault();
    setAuthMessage("GitHub OAuth is not configured on the server.", true);
  }
});

paymentForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!currentUser) {
    setAuthMessage("Login required for payments.", true);
    return;
  }

  const chain = paymentChain.value as PaymentChain;
  const amount = Number(paymentAmount.value);
  const note = paymentNote.value;

  void (async () => {
    try {
      const response = await requestJson<{ intent: PaymentIntent }>("/api/payments-intents", {
        method: "POST",
        body: JSON.stringify({ chain, amount, note })
      });

      paymentCurrent.innerHTML =
        `Pay to: <code>${response.intent.payToAddress}</code>` +
        `<br />URI: <a href="${response.intent.paymentUri}" target="_blank" rel="noopener noreferrer">${response.intent.paymentUri}</a>`;
      proofPaymentId.value = response.intent.id;

      await refreshPayments();
      setAuthMessage("Payment intent created.");
    } catch (error) {
      const code = error instanceof ApiError && error.code ? error.code : "payment_create_failed";
      setAuthMessage(code, true);
    }
  })();
});

paymentProofForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!currentUser) {
    setAuthMessage("Login required for payment proof.", true);
    return;
  }

  const paymentId = proofPaymentId.value;
  const walletAddress = proofWallet.value;
  const txHash = proofTx.value;

  void (async () => {
    try {
      await requestJson<{ intent: PaymentIntent }>("/api/payments-submit", {
        method: "POST",
        body: JSON.stringify({ paymentId, walletAddress, txHash })
      });
      setAuthMessage("Payment proof submitted.");
      proofTx.value = "";
      await refreshPayments();
    } catch (error) {
      const code = error instanceof ApiError && error.code ? error.code : "payment_submit_failed";
      setAuthMessage(code, true);
    }
  })();
});

window.addEventListener("beforeunload", () => {
  if (!currentUser) {
    return;
  }

  void fetch(apiUrl("/api/lobby-leave"), {
    method: "POST",
    credentials: "include",
    keepalive: true
  });
});

const searchParams = new URLSearchParams(window.location.search);
const oauthState = searchParams.get("oauth");
if (oauthState) {
  const provider = searchParams.get("provider") ?? "oauth";
  if (oauthState === "ok") {
    setAuthMessage(`${provider} login successful.`);
  } else {
    setAuthMessage(`${provider} login state: ${oauthState}.`, oauthState !== "ok");
  }
  searchParams.delete("oauth");
  searchParams.delete("provider");
  const cleanQuery = searchParams.toString();
  const nextUrl = cleanQuery.length > 0 ? `${window.location.pathname}?${cleanQuery}` : window.location.pathname;
  window.history.replaceState({}, "", nextUrl);
}

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

async function bootstrap(): Promise<void> {
  await checkApiHealth();
  await refreshAuthSession();

  await Promise.all([
    refreshStatsAndHistory(),
    refreshLeaderboard(),
    refreshLobby(Boolean(currentUser)),
    refreshPayments()
  ]);

  updateAuthUi();
}

void bootstrap();

window.setInterval(() => {
  void refreshStatsAndHistory();
  void refreshLeaderboard();
  void refreshLobby(false);
  if (currentUser) {
    void refreshPayments();
  }
}, 12_000);
