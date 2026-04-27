import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

export const DREIDEL_VALUES = ["Nun", "Gimel", "Hei", "Shin"] as const;
export type DreidelValue = (typeof DREIDEL_VALUES)[number];

export type UserRole = "user" | "admin" | "developer";
export type AuthProvider = "local" | "google" | "github";
export type PaymentChain = "solana" | "ethereum" | "polygon" | "base";

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
  userId: string | null;
  username: string | null;
}

export interface SpinStats {
  totalSpins: number;
  averageConfidence: number;
  byValue: Record<DreidelValue, number>;
  byModel: Record<string, number>;
  latestTimestamp: number | null;
  mostFrequentValue: DreidelValue | null;
}

export interface UserRecord {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  provider: AuthProvider;
  providerId: string | null;
  passwordHash: string | null;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number;
  totalSpins: number;
  wins: number;
  totalConfidence: number;
  valueCounts: Record<DreidelValue, number>;
}

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  provider: AuthProvider;
  createdAt: number;
  lastLoginAt: number;
  totalSpins: number;
  wins: number;
  averageConfidence: number;
  valueCounts: Record<DreidelValue, number>;
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  role: UserRole;
  wins: number;
  totalSpins: number;
  averageConfidence: number;
  score: number;
}

export interface LobbyPlayer {
  userId: string;
  username: string;
  role: UserRole;
  joinedAt: number;
  lastSeenAt: number;
}

export interface LobbySnapshot {
  roomId: string;
  maxPlayers: number;
  players: LobbyPlayer[];
}

export interface PaymentIntent {
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

interface PersistedSpinStore {
  items: StoredSpinResult[];
}

interface PersistedUserStore {
  users: UserRecord[];
}

interface PersistedPaymentStore {
  items: PaymentIntent[];
}

const MAX_STORED_SPINS = 5000;
const DATA_DIR = resolveDataDir();
const SPINS_FILE = path.join(DATA_DIR, "spin-results.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const PAYMENTS_FILE = path.join(DATA_DIR, "payment-intents.json");
const LOBBY_ROOM_ID = "main-room";
const LOBBY_MAX_PLAYERS = 8;
const LOBBY_STALE_MS = 45_000;
const DB_URL =
  process.env.DATABASE_URL?.trim() ??
  process.env.POSTGRES_URL?.trim() ??
  process.env.NEON_DATABASE_URL?.trim() ??
  null;
const DB_ENABLED = Boolean(DB_URL);
const DB_FALLBACK_TO_JSON = process.env.DB_FALLBACK_TO_JSON !== "false";
const DB_BOOTSTRAP_FROM_JSON = process.env.DB_BOOTSTRAP_FROM_JSON !== "false";

let dbPool: Pool | null = null;
let dbReadyPromise: Promise<void> | null = null;
let dbInitError: string | null = null;
let dbFallbackActive = false;

const lobbyPlayers = new Map<string, LobbyPlayer>();

function resolveDataDir(): string {
  const explicit = process.env.DATA_DIR?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  if (process.env.VERCEL === "1") {
    // Vercel serverless functions cannot write into /var/task.
    return path.resolve("/tmp/dreidel-data");
  }

  return path.resolve(process.cwd(), "data");
}

function now(): number {
  return Date.now();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function normalizeEmail(email: string): string {
  return sanitizeText(email, 200).toLowerCase();
}

function normalizeUsername(username: string): string {
  return sanitizeText(username, 50).replace(/\s+/g, " ");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDreidelValue(value: unknown): value is DreidelValue {
  return typeof value === "string" && DREIDEL_VALUES.includes(value as DreidelValue);
}

function emptyByValue(): Record<DreidelValue, number> {
  return {
    Nun: 0,
    Gimel: 0,
    Hei: 0,
    Shin: 0
  };
}

function parseEmailList(variableName: string): Set<string> {
  const raw = process.env[variableName] ?? "";
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)
  );
}

const ADMIN_EMAILS = parseEmailList("ADMIN_EMAILS");
const DEVELOPER_EMAILS = parseEmailList("DEVELOPER_EMAILS");

function deriveRole(email: string, isFirstUser: boolean): UserRole {
  const normalized = normalizeEmail(email);
  if (DEVELOPER_EMAILS.has(normalized)) {
    return "developer";
  }
  if (ADMIN_EMAILS.has(normalized)) {
    return "admin";
  }
  if (isFirstUser) {
    return "developer";
  }
  return "user";
}

function parseDbNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseDbInt(value: unknown): number {
  return Math.floor(parseDbNumber(value));
}

function parseDbMaybeString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function getDbPool(): Pool | null {
  if (!DB_ENABLED || !DB_URL) {
    return null;
  }

  if (!dbPool) {
    dbPool = new Pool({
      connectionString: DB_URL,
      ssl:
        process.env.DATABASE_SSL_MODE === "disable" || process.env.NODE_ENV !== "production"
          ? undefined
          : { rejectUnauthorized: false }
    });
  }

  return dbPool;
}

async function initDbSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_id TEXT NULL,
      password_hash TEXT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      last_login_at BIGINT NOT NULL,
      total_spins INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      total_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
      value_nun INTEGER NOT NULL DEFAULT 0,
      value_gimel INTEGER NOT NULL DEFAULT 0,
      value_hei INTEGER NOT NULL DEFAULT 0,
      value_shin INTEGER NOT NULL DEFAULT 0
    )
  `);

  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_provider_provider_id_idx ON users(provider, provider_id) WHERE provider_id IS NOT NULL"
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS spins (
      id UUID PRIMARY KEY,
      value TEXT NOT NULL,
      confidence DOUBLE PRECISION NOT NULL,
      spin_rate_at_rest DOUBLE PRECISION NOT NULL,
      linear_speed_at_rest DOUBLE PRECISION NOT NULL,
      model_key TEXT NOT NULL,
      timestamp BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
      username TEXT NULL
    )
  `);

  await pool.query(
    "CREATE INDEX IF NOT EXISTS spins_created_at_idx ON spins(created_at DESC)"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS spins_model_key_idx ON spins(model_key)"
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_intents (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      chain TEXT NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      currency TEXT NOT NULL,
      pay_to_address TEXT NOT NULL,
      payment_uri TEXT NOT NULL,
      status TEXT NOT NULL,
      tx_hash TEXT NULL,
      wallet_address TEXT NULL,
      note TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);

  await pool.query(
    "CREATE INDEX IF NOT EXISTS payment_intents_created_at_idx ON payment_intents(created_at DESC)"
  );
}

async function ensureDbPool(): Promise<Pool | null> {
  const pool = getDbPool();
  if (!pool) {
    return null;
  }

  if (!dbReadyPromise) {
    dbReadyPromise = (async () => {
      await initDbSchema(pool);
      await bootstrapDbFromJsonIfNeeded(pool);
      dbInitError = null;
      dbFallbackActive = false;
    })().catch((error: unknown) => {
      dbInitError = String(error);
      throw error;
    });
  }

  await dbReadyPromise;
  return pool;
}

async function getOperationalDbPool(): Promise<Pool | null> {
  if (!DB_ENABLED) {
    return null;
  }

  try {
    const pool = await ensureDbPool();
    dbFallbackActive = false;
    return pool;
  } catch (error) {
    const detail = dbInitError ?? String(error);
    dbInitError = detail;

    if (DB_FALLBACK_TO_JSON) {
      dbFallbackActive = true;
      return null;
    }

    throw error;
  }
}

async function bootstrapDbFromJsonIfNeeded(pool: Pool): Promise<void> {
  if (!DB_BOOTSTRAP_FROM_JSON) {
    return;
  }

  const [userCountResult, spinCountResult, paymentCountResult] = await Promise.all([
    pool.query<{ total: string }>("SELECT COUNT(*)::text AS total FROM users"),
    pool.query<{ total: string }>("SELECT COUNT(*)::text AS total FROM spins"),
    pool.query<{ total: string }>("SELECT COUNT(*)::text AS total FROM payment_intents")
  ]);

  const userCount = parseDbInt(userCountResult.rows[0]?.total);
  const spinCount = parseDbInt(spinCountResult.rows[0]?.total);
  const paymentCount = parseDbInt(paymentCountResult.rows[0]?.total);

  if (userCount > 0 || spinCount > 0 || paymentCount > 0) {
    return;
  }

  const [userStore, spinStore, paymentStore] = await Promise.all([
    readUserStore(),
    readSpinStore(),
    readPaymentStore()
  ]);

  if (userStore.users.length === 0 && spinStore.items.length === 0 && paymentStore.items.length === 0) {
    return;
  }

  const knownUserIds = new Set(userStore.users.map((user) => user.id));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const user of userStore.users) {
      await client.query(
        `
          INSERT INTO users (
            id, username, email, role, provider, provider_id, password_hash,
            created_at, updated_at, last_login_at, total_spins, wins, total_confidence,
            value_nun, value_gimel, value_hei, value_shin
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          user.id,
          user.username,
          user.email,
          user.role,
          user.provider,
          user.providerId,
          user.passwordHash,
          user.createdAt,
          user.updatedAt,
          user.lastLoginAt,
          user.totalSpins,
          user.wins,
          user.totalConfidence,
          user.valueCounts.Nun,
          user.valueCounts.Gimel,
          user.valueCounts.Hei,
          user.valueCounts.Shin
        ]
      );
    }

    for (const spin of spinStore.items) {
      const userId = spin.userId && knownUserIds.has(spin.userId) ? spin.userId : null;
      await client.query(
        `
          INSERT INTO spins (
            id, value, confidence, spin_rate_at_rest, linear_speed_at_rest, model_key, timestamp, created_at, user_id, username
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          spin.id,
          spin.value,
          spin.confidence,
          spin.spinRateAtRest,
          spin.linearSpeedAtRest,
          spin.modelKey,
          spin.timestamp,
          spin.createdAt,
          userId,
          spin.username
        ]
      );
    }

    for (const payment of paymentStore.items) {
      if (!knownUserIds.has(payment.userId)) {
        continue;
      }

      await client.query(
        `
          INSERT INTO payment_intents (
            id, user_id, username, chain, amount, currency, pay_to_address, payment_uri,
            status, tx_hash, wallet_address, note, created_at, updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          payment.id,
          payment.userId,
          payment.username,
          payment.chain,
          payment.amount,
          payment.currency,
          payment.payToAddress,
          payment.paymentUri,
          payment.status,
          payment.txHash,
          payment.walletAddress,
          payment.note,
          payment.createdAt,
          payment.updatedAt
        ]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function rowToPublicUserFromDb(row: Record<string, unknown>): PublicUser {
  const totalSpins = parseDbInt(row.total_spins);
  const totalConfidence = parseDbNumber(row.total_confidence);
  const averageConfidence = totalSpins > 0 ? Number((totalConfidence / totalSpins).toFixed(4)) : 0;

  return {
    id: String(row.id),
    username: String(row.username),
    email: String(row.email),
    role: row.role as UserRole,
    provider: row.provider as AuthProvider,
    createdAt: parseDbInt(row.created_at),
    lastLoginAt: parseDbInt(row.last_login_at),
    totalSpins,
    wins: parseDbInt(row.wins),
    averageConfidence,
    valueCounts: {
      Nun: parseDbInt(row.value_nun),
      Gimel: parseDbInt(row.value_gimel),
      Hei: parseDbInt(row.value_hei),
      Shin: parseDbInt(row.value_shin)
    }
  };
}

function rowToStoredSpinFromDb(row: Record<string, unknown>): StoredSpinResult {
  return {
    id: String(row.id),
    value: row.value as DreidelValue,
    confidence: parseDbNumber(row.confidence),
    spinRateAtRest: parseDbNumber(row.spin_rate_at_rest),
    linearSpeedAtRest: parseDbNumber(row.linear_speed_at_rest),
    modelKey: String(row.model_key),
    timestamp: parseDbInt(row.timestamp),
    createdAt: parseDbInt(row.created_at),
    userId: parseDbMaybeString(row.user_id),
    username: parseDbMaybeString(row.username)
  };
}

function rowToPaymentIntentFromDb(row: Record<string, unknown>): PaymentIntent {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    username: String(row.username),
    chain: row.chain as PaymentChain,
    amount: parseDbNumber(row.amount),
    currency: String(row.currency),
    payToAddress: String(row.pay_to_address),
    paymentUri: String(row.payment_uri),
    status: row.status as PaymentIntent["status"],
    txHash: parseDbMaybeString(row.tx_hash),
    walletAddress: parseDbMaybeString(row.wallet_address),
    note: String(row.note),
    createdAt: parseDbInt(row.created_at),
    updatedAt: parseDbInt(row.updated_at)
  };
}

export async function getStorageDiagnostics(): Promise<{
  mode: "postgres" | "json";
  ready: boolean;
  error: string | null;
}> {
  if (!DB_ENABLED) {
    return { mode: "json", ready: true, error: null };
  }

  try {
    await ensureDbPool();
    dbFallbackActive = false;
    return { mode: "postgres", ready: true, error: null };
  } catch (error) {
    const detail = dbInitError ?? String(error);
    if (DB_FALLBACK_TO_JSON) {
      dbFallbackActive = true;
      return {
        mode: "json",
        ready: true,
        error: `postgres_unavailable_fallback_json: ${detail}`
      };
    }
    return { mode: "postgres", ready: false, error: detail };
  }
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return fallback;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFileAtomic(file: string, payload: unknown): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${file}.tmp`;
  await writeFile(tempFile, JSON.stringify(payload, null, 2), "utf8");
  await rename(tempFile, file);
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
    isFiniteNumber(candidate.createdAt) &&
    (candidate.userId === null || typeof candidate.userId === "string") &&
    (candidate.username === null || typeof candidate.username === "string")
  );
}

function isUserRole(value: unknown): value is UserRole {
  return value === "user" || value === "admin" || value === "developer";
}

function isAuthProvider(value: unknown): value is AuthProvider {
  return value === "local" || value === "google" || value === "github";
}

function isUserRecord(value: unknown): value is UserRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<UserRecord>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.username === "string" &&
    typeof candidate.email === "string" &&
    isUserRole(candidate.role) &&
    isAuthProvider(candidate.provider) &&
    (candidate.providerId === null || typeof candidate.providerId === "string") &&
    (candidate.passwordHash === null || typeof candidate.passwordHash === "string") &&
    isFiniteNumber(candidate.createdAt) &&
    isFiniteNumber(candidate.updatedAt) &&
    isFiniteNumber(candidate.lastLoginAt) &&
    isFiniteNumber(candidate.totalSpins) &&
    isFiniteNumber(candidate.wins) &&
    isFiniteNumber(candidate.totalConfidence) &&
    !!candidate.valueCounts &&
    isFiniteNumber(candidate.valueCounts.Nun) &&
    isFiniteNumber(candidate.valueCounts.Gimel) &&
    isFiniteNumber(candidate.valueCounts.Hei) &&
    isFiniteNumber(candidate.valueCounts.Shin)
  );
}

function isPaymentChain(value: unknown): value is PaymentChain {
  return value === "solana" || value === "ethereum" || value === "polygon" || value === "base";
}

function isPaymentIntent(value: unknown): value is PaymentIntent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PaymentIntent>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.userId === "string" &&
    typeof candidate.username === "string" &&
    isPaymentChain(candidate.chain) &&
    isFiniteNumber(candidate.amount) &&
    typeof candidate.currency === "string" &&
    typeof candidate.payToAddress === "string" &&
    typeof candidate.paymentUri === "string" &&
    (candidate.status === "created" ||
      candidate.status === "submitted" ||
      candidate.status === "confirmed" ||
      candidate.status === "rejected") &&
    (candidate.txHash === null || typeof candidate.txHash === "string") &&
    (candidate.walletAddress === null || typeof candidate.walletAddress === "string") &&
    typeof candidate.note === "string" &&
    isFiniteNumber(candidate.createdAt) &&
    isFiniteNumber(candidate.updatedAt)
  );
}

async function readSpinStore(): Promise<PersistedSpinStore> {
  const store = await readJsonFile<PersistedSpinStore>(SPINS_FILE, { items: [] });
  const items = Array.isArray(store.items) ? store.items.filter(isStoredSpinResult) : [];
  items.sort((a, b) => b.createdAt - a.createdAt);
  return { items };
}

async function writeSpinStore(store: PersistedSpinStore): Promise<void> {
  await writeJsonFileAtomic(SPINS_FILE, store);
}

async function readUserStore(): Promise<PersistedUserStore> {
  const store = await readJsonFile<PersistedUserStore>(USERS_FILE, { users: [] });
  const users = Array.isArray(store.users) ? store.users.filter(isUserRecord) : [];
  users.sort((a, b) => a.createdAt - b.createdAt);
  return { users };
}

async function writeUserStore(store: PersistedUserStore): Promise<void> {
  await writeJsonFileAtomic(USERS_FILE, store);
}

async function readPaymentStore(): Promise<PersistedPaymentStore> {
  const store = await readJsonFile<PersistedPaymentStore>(PAYMENTS_FILE, { items: [] });
  const items = Array.isArray(store.items) ? store.items.filter(isPaymentIntent) : [];
  items.sort((a, b) => b.createdAt - a.createdAt);
  return { items };
}

async function writePaymentStore(store: PersistedPaymentStore): Promise<void> {
  await writeJsonFileAtomic(PAYMENTS_FILE, store);
}

function sanitizePayload(payload: SpinPayload): SpinPayload {
  return {
    value: payload.value,
    confidence: clamp(payload.confidence, 0, 1),
    spinRateAtRest: clamp(payload.spinRateAtRest, 0, 200),
    linearSpeedAtRest: clamp(payload.linearSpeedAtRest, 0, 200),
    modelKey: sanitizeText(payload.modelKey, 80),
    timestamp: Math.floor(payload.timestamp)
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

  if (typeof candidate.modelKey !== "string" || candidate.modelKey.trim().length === 0) {
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

function toPublicUser(user: UserRecord): PublicUser {
  const averageConfidence = user.totalSpins > 0 ? Number((user.totalConfidence / user.totalSpins).toFixed(4)) : 0;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    provider: user.provider,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    totalSpins: user.totalSpins,
    wins: user.wins,
    averageConfidence,
    valueCounts: { ...user.valueCounts }
  };
}

function makeUniqueUsername(existingUsers: UserRecord[], base: string): string {
  const normalizedBase = normalizeUsername(base).replace(/[^a-zA-Z0-9_\-. ]/g, "").replace(/\s+/g, "-");
  const fallback = normalizedBase.length > 0 ? normalizedBase : `player-${Math.floor(Math.random() * 10000)}`;

  const occupied = new Set(existingUsers.map((user) => user.username.toLowerCase()));
  if (!occupied.has(fallback.toLowerCase())) {
    return fallback;
  }

  let suffix = 2;
  while (suffix < 50_000) {
    const candidate = `${fallback}-${suffix}`;
    if (!occupied.has(candidate.toLowerCase())) {
      return candidate;
    }
    suffix += 1;
  }

  return `${fallback}-${randomUUID().slice(0, 6)}`;
}

async function makeUniqueUsernameDb(
  pool: Pool,
  base: string,
  excludeUserId: string | null
): Promise<string> {
  const normalizedBase = normalizeUsername(base).replace(/[^a-zA-Z0-9_\-. ]/g, "").replace(/\s+/g, "-");
  const fallback = normalizedBase.length > 0 ? normalizedBase : `player-${Math.floor(Math.random() * 10000)}`;
  const loweredFallback = fallback.toLowerCase();

  const firstResult = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM users
      WHERE LOWER(username) = $1
      ${excludeUserId ? "AND id <> $2" : ""}
      LIMIT 1
    `,
    excludeUserId ? [loweredFallback, excludeUserId] : [loweredFallback]
  );

  if (firstResult.rowCount === 0) {
    return fallback;
  }

  let suffix = 2;
  while (suffix < 50_000) {
    const candidate = `${fallback}-${suffix}`;
    const lowered = candidate.toLowerCase();
    const result = await pool.query<{ id: string }>(
      `
        SELECT id
        FROM users
        WHERE LOWER(username) = $1
        ${excludeUserId ? "AND id <> $2" : ""}
        LIMIT 1
      `,
      excludeUserId ? [lowered, excludeUserId] : [lowered]
    );

    if (result.rowCount === 0) {
      return candidate;
    }
    suffix += 1;
  }

  return `${fallback}-${randomUUID().slice(0, 6)}`;
}

function buildNewUser(params: {
  username: string;
  email: string;
  role: UserRole;
  provider: AuthProvider;
  providerId?: string | null;
  passwordHash?: string | null;
}): UserRecord {
  const timestamp = now();
  return {
    id: randomUUID(),
    username: normalizeUsername(params.username),
    email: normalizeEmail(params.email),
    role: params.role,
    provider: params.provider,
    providerId: params.providerId ?? null,
    passwordHash: params.passwordHash ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastLoginAt: timestamp,
    totalSpins: 0,
    wins: 0,
    totalConfidence: 0,
    valueCounts: emptyByValue()
  };
}

export async function findUserById(userId: string): Promise<PublicUser | null> {
  const pool = await getOperationalDbPool();
  if (pool) {
    const result = await pool.query(
      `
        SELECT id, username, email, role, provider, provider_id, password_hash, created_at, updated_at, last_login_at,
               total_spins, wins, total_confidence, value_nun, value_gimel, value_hei, value_shin
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId]
    );

    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? rowToPublicUserFromDb(row) : null;
  }

  const userStore = await readUserStore();
  const found = userStore.users.find((user) => user.id === userId);
  return found ? toPublicUser(found) : null;
}

export async function registerLocalUser(input: {
  username: string;
  email: string;
  password: string;
}): Promise<{ user: PublicUser } | { error: string }> {
  const username = normalizeUsername(input.username);
  const email = normalizeEmail(input.email);
  const password = input.password;

  if (username.length < 3) {
    return { error: "username_too_short" };
  }
  if (email.length < 5 || !email.includes("@")) {
    return { error: "invalid_email" };
  }
  if (password.length < 8) {
    return { error: "password_too_short" };
  }

  const pool = await getOperationalDbPool();
  if (pool) {
    const existingEmail = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1 LIMIT 1", [email]);
    if ((existingEmail.rowCount ?? 0) > 0) {
      return { error: "email_taken" };
    }

    const existingUsername = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE LOWER(username) = $1 LIMIT 1",
      [username.toLowerCase()]
    );
    if ((existingUsername.rowCount ?? 0) > 0) {
      return { error: "username_taken" };
    }

    const countResult = await pool.query<{ total: string }>("SELECT COUNT(*)::text AS total FROM users");
    const userCount = parseDbInt(countResult.rows[0]?.total);
    const role = deriveRole(email, userCount === 0);
    const passwordHash = await bcrypt.hash(password, 10);
    const created = buildNewUser({
      username,
      email,
      role,
      provider: "local",
      passwordHash
    });

    await pool.query(
      `
        INSERT INTO users (
          id, username, email, role, provider, provider_id, password_hash,
          created_at, updated_at, last_login_at, total_spins, wins, total_confidence,
          value_nun, value_gimel, value_hei, value_shin
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      `,
      [
        created.id,
        created.username,
        created.email,
        created.role,
        created.provider,
        created.providerId,
        created.passwordHash,
        created.createdAt,
        created.updatedAt,
        created.lastLoginAt,
        created.totalSpins,
        created.wins,
        created.totalConfidence,
        created.valueCounts.Nun,
        created.valueCounts.Gimel,
        created.valueCounts.Hei,
        created.valueCounts.Shin
      ]
    );

    return { user: toPublicUser(created) };
  }

  const userStore = await readUserStore();

  if (userStore.users.some((user) => user.email === email)) {
    return { error: "email_taken" };
  }
  if (userStore.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    return { error: "username_taken" };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const role = deriveRole(email, userStore.users.length === 0);

  const created = buildNewUser({
    username,
    email,
    role,
    provider: "local",
    passwordHash
  });

  userStore.users.push(created);
  await writeUserStore(userStore);

  return { user: toPublicUser(created) };
}

export async function loginLocalUser(input: {
  identifier: string;
  password: string;
}): Promise<{ user: PublicUser } | { error: string }> {
  const identifier = sanitizeText(input.identifier, 200).toLowerCase();
  const password = input.password;

  const pool = await getOperationalDbPool();
  if (pool) {
    const result = await pool.query(
      `
        SELECT id, username, email, role, provider, provider_id, password_hash, created_at, updated_at, last_login_at,
               total_spins, wins, total_confidence, value_nun, value_gimel, value_hei, value_shin
        FROM users
        WHERE provider = 'local'
          AND (LOWER(email) = $1 OR LOWER(username) = $1)
        LIMIT 1
      `,
      [identifier]
    );

    const row = result.rows[0] as (Record<string, unknown> & { password_hash?: string | null }) | undefined;
    if (!row || typeof row.password_hash !== "string") {
      return { error: "invalid_credentials" };
    }

    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) {
      return { error: "invalid_credentials" };
    }

    const timestamp = now();
    await pool.query("UPDATE users SET last_login_at = $2, updated_at = $2 WHERE id = $1", [row.id, timestamp]);

    const updated = { ...row, last_login_at: timestamp };
    return { user: rowToPublicUserFromDb(updated) };
  }

  const userStore = await readUserStore();
  const user = userStore.users.find((candidate) => {
    const emailMatch = candidate.email.toLowerCase() === identifier;
    const usernameMatch = candidate.username.toLowerCase() === identifier;
    return candidate.provider === "local" && (emailMatch || usernameMatch);
  });

  if (!user || !user.passwordHash) {
    return { error: "invalid_credentials" };
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return { error: "invalid_credentials" };
  }

  user.lastLoginAt = now();
  user.updatedAt = user.lastLoginAt;
  await writeUserStore(userStore);

  return { user: toPublicUser(user) };
}

export async function upsertOAuthUser(input: {
  provider: Exclude<AuthProvider, "local">;
  providerId: string;
  email: string;
  username: string;
}): Promise<PublicUser> {
  const email = normalizeEmail(input.email);

  const pool = await getOperationalDbPool();
  if (pool) {
    const byProvider = await pool.query(
      `
        SELECT id, username, email, role, provider, provider_id, password_hash, created_at, updated_at, last_login_at,
               total_spins, wins, total_confidence, value_nun, value_gimel, value_hei, value_shin
        FROM users
        WHERE provider = $1 AND provider_id = $2
        LIMIT 1
      `,
      [input.provider, input.providerId]
    );

    let row = byProvider.rows[0] as Record<string, unknown> | undefined;

    if (!row) {
      const byEmail = await pool.query(
        `
          SELECT id, username, email, role, provider, provider_id, password_hash, created_at, updated_at, last_login_at,
                 total_spins, wins, total_confidence, value_nun, value_gimel, value_hei, value_shin
          FROM users
          WHERE email = $1
          LIMIT 1
        `,
        [email]
      );
      row = byEmail.rows[0] as Record<string, unknown> | undefined;
    }

    if (row) {
      const timestamp = now();
      const currentUsername = String(row.username);
      const nextUsername =
        !currentUsername || currentUsername.startsWith("player-")
          ? await makeUniqueUsernameDb(pool, input.username, String(row.id))
          : currentUsername;

      await pool.query(
        `
          UPDATE users
          SET provider = $2,
              provider_id = $3,
              email = $4,
              username = $5,
              last_login_at = $6,
              updated_at = $6
          WHERE id = $1
        `,
        [row.id, input.provider, input.providerId, email, nextUsername, timestamp]
      );

      const merged = {
        ...row,
        provider: input.provider,
        provider_id: input.providerId,
        email,
        username: nextUsername,
        last_login_at: timestamp
      };
      return rowToPublicUserFromDb(merged);
    }

    const countResult = await pool.query<{ total: string }>("SELECT COUNT(*)::text AS total FROM users");
    const userCount = parseDbInt(countResult.rows[0]?.total);
    const role = deriveRole(email, userCount === 0);
    const uniqueUsername = await makeUniqueUsernameDb(pool, input.username, null);
    const created = buildNewUser({
      username: uniqueUsername,
      email,
      role,
      provider: input.provider,
      providerId: input.providerId,
      passwordHash: null
    });

    await pool.query(
      `
        INSERT INTO users (
          id, username, email, role, provider, provider_id, password_hash,
          created_at, updated_at, last_login_at, total_spins, wins, total_confidence,
          value_nun, value_gimel, value_hei, value_shin
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      `,
      [
        created.id,
        created.username,
        created.email,
        created.role,
        created.provider,
        created.providerId,
        created.passwordHash,
        created.createdAt,
        created.updatedAt,
        created.lastLoginAt,
        created.totalSpins,
        created.wins,
        created.totalConfidence,
        created.valueCounts.Nun,
        created.valueCounts.Gimel,
        created.valueCounts.Hei,
        created.valueCounts.Shin
      ]
    );

    return toPublicUser(created);
  }

  const userStore = await readUserStore();

  let user = userStore.users.find(
    (candidate) => candidate.provider === input.provider && candidate.providerId === input.providerId
  );

  if (!user) {
    user = userStore.users.find((candidate) => candidate.email === email);
  }

  if (user) {
    user.provider = input.provider;
    user.providerId = input.providerId;
    user.email = email;
    user.lastLoginAt = now();
    user.updatedAt = user.lastLoginAt;
    if (!user.username || user.username.startsWith("player-")) {
      user.username = makeUniqueUsername(userStore.users, input.username);
    }
    await writeUserStore(userStore);
    return toPublicUser(user);
  }

  const role = deriveRole(email, userStore.users.length === 0);
  const created = buildNewUser({
    username: makeUniqueUsername(userStore.users, input.username),
    email,
    role,
    provider: input.provider,
    providerId: input.providerId,
    passwordHash: null
  });

  userStore.users.push(created);
  await writeUserStore(userStore);
  return toPublicUser(created);
}

export async function listSpins(limit: number): Promise<{ items: StoredSpinResult[]; total: number }> {
  const pool = await getOperationalDbPool();
  const safeLimit = clamp(Math.floor(limit), 1, 200);

  if (pool) {
    const [itemsResult, countResult] = await Promise.all([
      pool.query(
        `
          SELECT id, value, confidence, spin_rate_at_rest, linear_speed_at_rest, model_key, timestamp, created_at, user_id, username
          FROM spins
          ORDER BY created_at DESC
          LIMIT $1
        `,
        [safeLimit]
      ),
      pool.query<{ total: string }>("SELECT COUNT(*)::text AS total FROM spins")
    ]);

    return {
      items: itemsResult.rows.map((row) => rowToStoredSpinFromDb(row as Record<string, unknown>)),
      total: parseDbInt(countResult.rows[0]?.total)
    };
  }

  const store = await readSpinStore();
  return {
    items: store.items.slice(0, safeLimit),
    total: store.items.length
  };
}

export async function insertSpin(payload: SpinPayload, user: PublicUser | null): Promise<StoredSpinResult> {
  const normalized = sanitizePayload(payload);
  const pool = await getOperationalDbPool();

  if (pool) {
    const created: StoredSpinResult = {
      ...normalized,
      id: randomUUID(),
      createdAt: now(),
      userId: user?.id ?? null,
      username: user?.username ?? null
    };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO spins (
            id, value, confidence, spin_rate_at_rest, linear_speed_at_rest, model_key, timestamp, created_at, user_id, username
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
          created.id,
          created.value,
          created.confidence,
          created.spinRateAtRest,
          created.linearSpeedAtRest,
          created.modelKey,
          created.timestamp,
          created.createdAt,
          created.userId,
          created.username
        ]
      );

      if (user) {
        await client.query(
          `
            UPDATE users
            SET total_spins = total_spins + 1,
                total_confidence = total_confidence + $2,
                value_nun = value_nun + $3,
                value_gimel = value_gimel + $4,
                value_hei = value_hei + $5,
                value_shin = value_shin + $6,
                wins = wins + $7,
                updated_at = $8
            WHERE id = $1
          `,
          [
            user.id,
            created.confidence,
            created.value === "Nun" ? 1 : 0,
            created.value === "Gimel" ? 1 : 0,
            created.value === "Hei" ? 1 : 0,
            created.value === "Shin" ? 1 : 0,
            created.value === "Gimel" ? 1 : 0,
            now()
          ]
        );
      }

      await client.query("COMMIT");
      return created;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const spinStore = await readSpinStore();
  const created: StoredSpinResult = {
    ...normalized,
    id: randomUUID(),
    createdAt: now(),
    userId: user?.id ?? null,
    username: user?.username ?? null
  };

  spinStore.items.unshift(created);
  if (spinStore.items.length > MAX_STORED_SPINS) {
    spinStore.items.length = MAX_STORED_SPINS;
  }
  await writeSpinStore(spinStore);

  if (user) {
    const userStore = await readUserStore();
    const existing = userStore.users.find((candidate) => candidate.id === user.id);
    if (existing) {
      existing.totalSpins += 1;
      existing.totalConfidence += created.confidence;
      existing.valueCounts[created.value] += 1;
      if (created.value === "Gimel") {
        existing.wins += 1;
      }
      existing.updatedAt = now();
      await writeUserStore(userStore);
    }
  }

  return created;
}

export async function getSpinStats(): Promise<SpinStats> {
  const pool = await getOperationalDbPool();

  if (pool) {
    const [aggregateResult, modelResult, topResult] = await Promise.all([
      pool.query(
        `
          SELECT
            COUNT(*)::text AS total_spins,
            COALESCE(AVG(confidence), 0)::double precision AS average_confidence,
            COALESCE(MAX(timestamp), NULL)::text AS latest_timestamp,
            SUM(CASE WHEN value = 'Nun' THEN 1 ELSE 0 END)::text AS nun_count,
            SUM(CASE WHEN value = 'Gimel' THEN 1 ELSE 0 END)::text AS gimel_count,
            SUM(CASE WHEN value = 'Hei' THEN 1 ELSE 0 END)::text AS hei_count,
            SUM(CASE WHEN value = 'Shin' THEN 1 ELSE 0 END)::text AS shin_count
          FROM spins
        `
      ),
      pool.query<{ model_key: string; count: string }>(
        `
          SELECT model_key, COUNT(*)::text AS count
          FROM spins
          GROUP BY model_key
        `
      ),
      pool.query<{ value: DreidelValue }>(
        `
          SELECT value
          FROM spins
          GROUP BY value
          ORDER BY COUNT(*) DESC, value ASC
          LIMIT 1
        `
      )
    ]);

    const aggregate = aggregateResult.rows[0] as Record<string, unknown> | undefined;
    const totalSpins = parseDbInt(aggregate?.total_spins);
    const averageConfidence = Number(parseDbNumber(aggregate?.average_confidence).toFixed(4));
    const latestTimestamp = aggregate?.latest_timestamp ? parseDbInt(aggregate.latest_timestamp) : null;
    const byValue: Record<DreidelValue, number> = {
      Nun: parseDbInt(aggregate?.nun_count),
      Gimel: parseDbInt(aggregate?.gimel_count),
      Hei: parseDbInt(aggregate?.hei_count),
      Shin: parseDbInt(aggregate?.shin_count)
    };

    const byModel: Record<string, number> = {};
    for (const row of modelResult.rows) {
      byModel[row.model_key] = parseDbInt(row.count);
    }

    return {
      totalSpins,
      averageConfidence,
      byValue,
      byModel,
      latestTimestamp,
      mostFrequentValue: topResult.rows[0]?.value ?? null
    };
  }

  const store = await readSpinStore();
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
  const averageConfidence = totalSpins > 0 ? Number((confidenceAccumulator / totalSpins).toFixed(4)) : 0;

  let mostFrequentValue: DreidelValue | null = null;
  let bestCount = 0;
  for (const value of DREIDEL_VALUES) {
    if (byValue[value] > bestCount) {
      bestCount = byValue[value];
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

export async function getLeaderboard(limit: number): Promise<LeaderboardEntry[]> {
  const pool = await getOperationalDbPool();
  const safeLimit = clamp(Math.floor(limit), 1, 50);

  if (pool) {
    const result = await pool.query(
      `
        SELECT id, username, role, wins, total_spins, total_confidence
        FROM users
      `
    );

    const entries: LeaderboardEntry[] = result.rows.map((row) => {
      const totalSpins = parseDbInt(row.total_spins);
      const averageConfidence = totalSpins > 0 ? parseDbNumber(row.total_confidence) / totalSpins : 0;
      const score = Number((parseDbInt(row.wins) * 12 + totalSpins * 1.3 + averageConfidence * 8).toFixed(4));
      return {
        userId: String(row.id),
        username: String(row.username),
        role: row.role as UserRole,
        wins: parseDbInt(row.wins),
        totalSpins,
        averageConfidence: Number(averageConfidence.toFixed(4)),
        score
      };
    });

    entries.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.wins !== a.wins) {
        return b.wins - a.wins;
      }
      return b.totalSpins - a.totalSpins;
    });

    return entries.slice(0, safeLimit);
  }

  const userStore = await readUserStore();

  const entries: LeaderboardEntry[] = userStore.users.map((user) => {
    const averageConfidence = user.totalSpins > 0 ? user.totalConfidence / user.totalSpins : 0;
    const score = Number((user.wins * 12 + user.totalSpins * 1.3 + averageConfidence * 8).toFixed(4));
    return {
      userId: user.id,
      username: user.username,
      role: user.role,
      wins: user.wins,
      totalSpins: user.totalSpins,
      averageConfidence: Number(averageConfidence.toFixed(4)),
      score
    };
  });

  entries.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.wins !== a.wins) {
      return b.wins - a.wins;
    }
    return b.totalSpins - a.totalSpins;
  });

  return entries.slice(0, safeLimit);
}

function cleanupLobby(): void {
  const threshold = now() - LOBBY_STALE_MS;
  for (const [userId, player] of lobbyPlayers.entries()) {
    if (player.lastSeenAt < threshold) {
      lobbyPlayers.delete(userId);
    }
  }
}

function getLobbySnapshot(): LobbySnapshot {
  cleanupLobby();
  const players = [...lobbyPlayers.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  return {
    roomId: LOBBY_ROOM_ID,
    maxPlayers: LOBBY_MAX_PLAYERS,
    players
  };
}

export function joinLobby(user: PublicUser): { ok: boolean; snapshot: LobbySnapshot; error?: string } {
  cleanupLobby();

  const existing = lobbyPlayers.get(user.id);
  if (existing) {
    existing.lastSeenAt = now();
    existing.role = user.role;
    existing.username = user.username;
    return { ok: true, snapshot: getLobbySnapshot() };
  }

  if (lobbyPlayers.size >= LOBBY_MAX_PLAYERS) {
    return { ok: false, error: "room_full", snapshot: getLobbySnapshot() };
  }

  const timestamp = now();
  lobbyPlayers.set(user.id, {
    userId: user.id,
    username: user.username,
    role: user.role,
    joinedAt: timestamp,
    lastSeenAt: timestamp
  });

  return { ok: true, snapshot: getLobbySnapshot() };
}

export function leaveLobby(user: PublicUser): LobbySnapshot {
  lobbyPlayers.delete(user.id);
  return getLobbySnapshot();
}

export function heartbeatLobby(user: PublicUser): LobbySnapshot {
  const existing = lobbyPlayers.get(user.id);
  if (existing) {
    existing.lastSeenAt = now();
  }
  return getLobbySnapshot();
}

export function listLobbyPlayers(): LobbySnapshot {
  return getLobbySnapshot();
}

function getChainAddress(chain: PaymentChain): string | null {
  if (chain === "solana") {
    return process.env.SOLANA_MERCHANT_ADDRESS ?? null;
  }

  const map: Record<Exclude<PaymentChain, "solana">, string | undefined> = {
    ethereum: process.env.ETHEREUM_MERCHANT_ADDRESS ?? process.env.EVM_MERCHANT_ADDRESS,
    polygon: process.env.POLYGON_MERCHANT_ADDRESS ?? process.env.EVM_MERCHANT_ADDRESS,
    base: process.env.BASE_MERCHANT_ADDRESS ?? process.env.EVM_MERCHANT_ADDRESS
  };

  return map[chain] ?? null;
}

function chainCurrency(chain: PaymentChain): string {
  switch (chain) {
    case "solana":
      return "SOL";
    case "ethereum":
      return "ETH";
    case "polygon":
      return "MATIC";
    case "base":
      return "ETH";
    default:
      return "TOKEN";
  }
}

function evmChainId(chain: Exclude<PaymentChain, "solana">): number {
  switch (chain) {
    case "ethereum":
      return 1;
    case "polygon":
      return 137;
    case "base":
      return 8453;
    default:
      return 1;
  }
}

function buildPaymentUri(chain: PaymentChain, payToAddress: string, amount: number, paymentId: string): string {
  if (chain === "solana") {
    const params = new URLSearchParams();
    params.set("amount", amount.toString());
    params.set("reference", paymentId);
    params.set("label", "Dreidel Physics Lab");
    params.set("message", "Game payment");
    return `solana:${payToAddress}?${params.toString()}`;
  }

  const chainId = evmChainId(chain);
  return `ethereum:${payToAddress}@${chainId}?value=${amount}`;
}

export async function createPaymentIntent(input: {
  user: PublicUser;
  chain: PaymentChain;
  amount: number;
  note?: string;
}): Promise<{ intent: PaymentIntent } | { error: string }> {
  if (!isPaymentChain(input.chain)) {
    return { error: "unsupported_chain" };
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) {
    return { error: "invalid_amount" };
  }

  const payToAddress = getChainAddress(input.chain);
  if (!payToAddress) {
    return { error: "merchant_address_not_configured" };
  }

  const pool = await getOperationalDbPool();
  if (pool) {
    const timestamp = now();
    const intentId = randomUUID();
    const intent: PaymentIntent = {
      id: intentId,
      userId: input.user.id,
      username: input.user.username,
      chain: input.chain,
      amount,
      currency: chainCurrency(input.chain),
      payToAddress,
      paymentUri: buildPaymentUri(input.chain, payToAddress, amount, intentId),
      status: "created",
      txHash: null,
      walletAddress: null,
      note: sanitizeText(input.note ?? "", 160),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await pool.query(
      `
        INSERT INTO payment_intents (
          id, user_id, username, chain, amount, currency, pay_to_address, payment_uri,
          status, tx_hash, wallet_address, note, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      `,
      [
        intent.id,
        intent.userId,
        intent.username,
        intent.chain,
        intent.amount,
        intent.currency,
        intent.payToAddress,
        intent.paymentUri,
        intent.status,
        intent.txHash,
        intent.walletAddress,
        intent.note,
        intent.createdAt,
        intent.updatedAt
      ]
    );

    return { intent };
  }

  const paymentStore = await readPaymentStore();
  const timestamp = now();
  const intentId = randomUUID();

  const intent: PaymentIntent = {
    id: intentId,
    userId: input.user.id,
    username: input.user.username,
    chain: input.chain,
    amount,
    currency: chainCurrency(input.chain),
    payToAddress,
    paymentUri: buildPaymentUri(input.chain, payToAddress, amount, intentId),
    status: "created",
    txHash: null,
    walletAddress: null,
    note: sanitizeText(input.note ?? "", 160),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  paymentStore.items.unshift(intent);
  await writePaymentStore(paymentStore);
  return { intent };
}

export async function listPaymentIntents(input: {
  user: PublicUser;
  limit: number;
  includeAll: boolean;
}): Promise<PaymentIntent[]> {
  const pool = await getOperationalDbPool();
  const safeLimit = clamp(Math.floor(input.limit), 1, 100);

  if (pool) {
    const result = input.includeAll
      ? await pool.query(
          `
            SELECT id, user_id, username, chain, amount, currency, pay_to_address, payment_uri,
                   status, tx_hash, wallet_address, note, created_at, updated_at
            FROM payment_intents
            ORDER BY created_at DESC
            LIMIT $1
          `,
          [safeLimit]
        )
      : await pool.query(
          `
            SELECT id, user_id, username, chain, amount, currency, pay_to_address, payment_uri,
                   status, tx_hash, wallet_address, note, created_at, updated_at
            FROM payment_intents
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2
          `,
          [input.user.id, safeLimit]
        );

    return result.rows.map((row) => rowToPaymentIntentFromDb(row as Record<string, unknown>));
  }

  const paymentStore = await readPaymentStore();
  const filtered = input.includeAll
    ? paymentStore.items
    : paymentStore.items.filter((item) => item.userId === input.user.id);

  return filtered.slice(0, safeLimit);
}

export async function submitPaymentProof(input: {
  user: PublicUser;
  paymentId: string;
  txHash: string;
  walletAddress: string;
}): Promise<{ intent: PaymentIntent } | { error: string }> {
  const paymentId = sanitizeText(input.paymentId, 120);
  const txHash = sanitizeText(input.txHash, 200);
  const walletAddress = sanitizeText(input.walletAddress, 200);

  if (!paymentId || !txHash || !walletAddress) {
    return { error: "missing_fields" };
  }

  const pool = await getOperationalDbPool();
  if (pool) {
    const result = await pool.query(
      `
        SELECT id, user_id, username, chain, amount, currency, pay_to_address, payment_uri,
               status, tx_hash, wallet_address, note, created_at, updated_at
        FROM payment_intents
        WHERE id = $1
        LIMIT 1
      `,
      [paymentId]
    );

    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      return { error: "payment_not_found" };
    }

    const intent = rowToPaymentIntentFromDb(row);
    const isOwner = intent.userId === input.user.id;
    const isAdmin = input.user.role === "admin" || input.user.role === "developer";

    if (!isOwner && !isAdmin) {
      return { error: "forbidden" };
    }

    const updatedAt = now();
    await pool.query(
      `
        UPDATE payment_intents
        SET tx_hash = $2, wallet_address = $3, status = 'submitted', updated_at = $4
        WHERE id = $1
      `,
      [paymentId, txHash, walletAddress, updatedAt]
    );

    return {
      intent: {
        ...intent,
        txHash,
        walletAddress,
        status: "submitted",
        updatedAt
      }
    };
  }

  const paymentStore = await readPaymentStore();
  const intent = paymentStore.items.find((item) => item.id === paymentId);
  if (!intent) {
    return { error: "payment_not_found" };
  }

  const isOwner = intent.userId === input.user.id;
  const isAdmin = input.user.role === "admin" || input.user.role === "developer";

  if (!isOwner && !isAdmin) {
    return { error: "forbidden" };
  }

  intent.txHash = txHash;
  intent.walletAddress = walletAddress;
  intent.status = "submitted";
  intent.updatedAt = now();

  await writePaymentStore(paymentStore);
  return { intent };
}
