import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import {
  createPaymentIntent,
  findUserById,
  getLeaderboard,
  getStorageDiagnostics,
  getSpinStats,
  heartbeatLobby,
  insertSpin,
  joinLobby,
  leaveLobby,
  listLobbyPlayers,
  listPaymentIntents,
  listSpins,
  loginLocalUser,
  parseSpinPayload,
  registerLocalUser,
  submitPaymentProof,
  upsertOAuthUser,
  type PaymentChain,
  type PublicUser
} from "./store.js";

declare global {
  namespace Express {
    interface User extends PublicUser {}

    interface Request {
      authUser?: PublicUser | null;
    }
  }
}

interface AuthClaims {
  sub: string;
  role: PublicUser["role"];
  iat: number;
  exp: number;
}

const PORT = Number(process.env.PORT ?? 8787);
const AUTH_COOKIE_NAME = "dreidel_auth";
const AUTH_COOKIE_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const AUTH_JWT_SECRET = process.env.AUTH_JWT_SECRET ?? "change-this-dev-secret";
const APP_BASE_URL = (process.env.APP_BASE_URL ?? `http://localhost:${PORT}`).trim().replace(/\/$/, "");
const API_BASE_URL = (process.env.API_BASE_URL ?? APP_BASE_URL).trim().replace(/\/$/, "");
const POST_AUTH_REDIRECT_URL =
  (process.env.POST_AUTH_REDIRECT_URL ?? APP_BASE_URL).trim().replace(/\/$/, "") || APP_BASE_URL;

const app = express();
app.set("trust proxy", 1);

function parseCsvEnv(value: string | undefined): Set<string> {
  if (!value) {
    return new Set();
  }

  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  );
}

const ALLOWED_ORIGINS = parseCsvEnv(process.env.CORS_ORIGINS);
if (ALLOWED_ORIGINS.size === 0 && APP_BASE_URL.length > 0) {
  ALLOWED_ORIGINS.add(APP_BASE_URL);
}

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.size === 0 || ALLOWED_ORIGINS.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("cors_origin_not_allowed"));
    }
  })
);

app.use(express.json({ limit: "300kb" }));
app.use(cookieParser());
app.use(passport.initialize());

function getTokenFromRequest(req: Request): string | null {
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
  if (typeof cookieToken === "string" && cookieToken.length > 0) {
    return cookieToken;
  }

  const authHeader = req.get("authorization");
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice("bearer ".length).trim();
  }

  return null;
}

function isSecureCookieRequest(req: Request): boolean {
  if (process.env.FORCE_SECURE_COOKIES === "true") {
    return true;
  }

  if (req.secure) {
    return true;
  }

  const forwarded = req.header("x-forwarded-proto");
  if (forwarded === "https") {
    return true;
  }

  return process.env.NODE_ENV === "production";
}

function signToken(user: PublicUser): string {
  return jwt.sign({ sub: user.id, role: user.role }, AUTH_JWT_SECRET, {
    expiresIn: "14d"
  });
}

function setAuthCookie(req: Request, res: Response, user: PublicUser): void {
  const token = signToken(user);
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookieRequest(req),
    maxAge: AUTH_COOKIE_TTL_MS,
    path: "/"
  });
}

function clearAuthCookie(req: Request, res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    path: "/",
    sameSite: "lax",
    secure: isSecureCookieRequest(req)
  });
}

async function attachAuthUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = getTokenFromRequest(req);
  if (!token) {
    req.authUser = null;
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, AUTH_JWT_SECRET) as AuthClaims;
    if (!decoded || typeof decoded.sub !== "string") {
      req.authUser = null;
      clearAuthCookie(req, res);
      next();
      return;
    }

    const user = await findUserById(decoded.sub);
    req.authUser = user;

    if (!user) {
      clearAuthCookie(req, res);
    }

    next();
  } catch {
    req.authUser = null;
    clearAuthCookie(req, res);
    next();
  }
}

app.use((req, res, next) => {
  void attachAuthUser(req, res, next);
});

function requireUser(req: Request, res: Response): PublicUser | null {
  if (!req.authUser) {
    res.status(401).json({ error: "auth_required" });
    return null;
  }

  return req.authUser;
}

function isAdminOrDeveloper(user: PublicUser): boolean {
  return user.role === "admin" || user.role === "developer";
}

function getProfileEmail(profile: { emails?: Array<{ value?: string }> }, fallback: string): string {
  const preferred = profile.emails?.find((entry) => typeof entry.value === "string" && entry.value.includes("@"));
  if (preferred?.value) {
    return preferred.value.toLowerCase();
  }
  return fallback;
}

function getProfileUsername(profile: {
  displayName?: string;
  username?: string;
  id?: string;
}): string {
  const display = profile.displayName?.trim();
  if (display && display.length >= 3) {
    return display;
  }

  const username = profile.username?.trim();
  if (username && username.length >= 3) {
    return username;
  }

  const shortId = (profile.id ?? "user").slice(0, 8);
  return `player-${shortId}`;
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL =
  process.env.GOOGLE_CALLBACK_URL?.trim() || `${API_BASE_URL}/api/oauth-google-callback`;

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_CALLBACK_URL =
  process.env.GITHUB_CALLBACK_URL?.trim() || `${API_BASE_URL}/api/oauth-github-callback`;

const googleOAuthEnabled = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
const githubOAuthEnabled = Boolean(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET);
const paymentConfig = {
  solana: Boolean(process.env.SOLANA_MERCHANT_ADDRESS),
  ethereum: Boolean(process.env.ETHEREUM_MERCHANT_ADDRESS ?? process.env.EVM_MERCHANT_ADDRESS),
  polygon: Boolean(process.env.POLYGON_MERCHANT_ADDRESS ?? process.env.EVM_MERCHANT_ADDRESS),
  base: Boolean(process.env.BASE_MERCHANT_ADDRESS ?? process.env.EVM_MERCHANT_ADDRESS)
};
type OAuthProfileShape = {
  id: string;
  displayName?: string;
  username?: string;
  emails?: Array<{ value?: string }>;
};

type OAuthDone = (error: Error | null, user?: PublicUser | false) => void;

if (googleOAuthEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID as string,
        clientSecret: GOOGLE_CLIENT_SECRET as string,
        callbackURL: GOOGLE_CALLBACK_URL,
        scope: ["profile", "email"]
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: OAuthProfileShape,
        done: OAuthDone
      ) => {
        try {
          const email = getProfileEmail(profile, `google-${profile.id}@users.noreply.local`);
          const username = getProfileUsername(profile);
          const user = await upsertOAuthUser({
            provider: "google",
            providerId: profile.id,
            email,
            username
          });
          done(null, user);
        } catch (error) {
          done(error as Error);
        }
      }
    )
  );
}

if (githubOAuthEnabled) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: GITHUB_CLIENT_ID as string,
        clientSecret: GITHUB_CLIENT_SECRET as string,
        callbackURL: GITHUB_CALLBACK_URL,
        scope: ["read:user", "user:email"]
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: OAuthProfileShape,
        done: OAuthDone
      ) => {
        try {
          const email = getProfileEmail(profile, `github-${profile.id}@users.noreply.github.com`);
          const username = getProfileUsername(profile);
          const user = await upsertOAuthUser({
            provider: "github",
            providerId: profile.id,
            email,
            username
          });
          done(null, user);
        } catch (error) {
          done(error as Error);
        }
      }
    )
  );
}

app.get("/api/health", async (_req, res) => {
  const storage = await getStorageDiagnostics();
  res.json({
    status: "ok",
    timestamp: Date.now(),
    oauth: {
      google: googleOAuthEnabled,
      github: githubOAuthEnabled
    },
    payments: paymentConfig,
    storage
  });
});

app.get(["/api/auth/me", "/api/auth-me"], (req, res) => {
  res.json({ user: req.authUser ?? null });
});

app.post(["/api/auth/register", "/api/auth-register"], async (req, res) => {
  try {
    const body = req.body as Partial<{ username: string; email: string; password: string }>;
    if (
      typeof body.username !== "string" ||
      typeof body.email !== "string" ||
      typeof body.password !== "string"
    ) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }

    const result = await registerLocalUser({
      username: body.username,
      email: body.email,
      password: body.password
    });

    if ("error" in result) {
      res.status(400).json(result);
      return;
    }

    setAuthCookie(req, res, result.user);
    res.status(201).json({ user: result.user });
  } catch (error) {
    res.status(500).json({ error: "register_failed", detail: String(error) });
  }
});

app.post(["/api/auth/login", "/api/auth-login"], async (req, res) => {
  try {
    const body = req.body as Partial<{ identifier: string; password: string }>;
    if (typeof body.identifier !== "string" || typeof body.password !== "string") {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }

    const result = await loginLocalUser({
      identifier: body.identifier,
      password: body.password
    });

    if ("error" in result) {
      res.status(401).json(result);
      return;
    }

    setAuthCookie(req, res, result.user);
    res.json({ user: result.user });
  } catch (error) {
    res.status(500).json({ error: "login_failed", detail: String(error) });
  }
});

app.post(["/api/auth/logout", "/api/auth-logout"], (req, res) => {
  if (req.authUser) {
    leaveLobby(req.authUser);
  }

  clearAuthCookie(req, res);
  res.json({ ok: true });
});

if (googleOAuthEnabled) {
  app.get(
    ["/api/auth/oauth/google", "/api/oauth-google"],
    passport.authenticate("google", {
      session: false,
      scope: ["profile", "email"]
    })
  );

  app.get(
    ["/api/auth/oauth/google/callback", "/api/oauth-google-callback"],
    passport.authenticate("google", {
      session: false,
      failureRedirect: `${POST_AUTH_REDIRECT_URL}?oauth=failed&provider=google`
    }),
    (req, res) => {
      const user = req.user;
      if (!user) {
        res.redirect(`${POST_AUTH_REDIRECT_URL}?oauth=failed&provider=google`);
        return;
      }

      setAuthCookie(req, res, user);
      res.redirect(`${POST_AUTH_REDIRECT_URL}?oauth=ok&provider=google`);
    }
  );
} else {
  app.get(["/api/auth/oauth/google", "/api/oauth-google"], (_req, res) => {
    res.status(503).json({ error: "google_oauth_not_configured" });
  });

  app.get(["/api/auth/oauth/google/callback", "/api/oauth-google-callback"], (_req, res) => {
    res.redirect(`${POST_AUTH_REDIRECT_URL}?oauth=disabled&provider=google`);
  });
}

if (githubOAuthEnabled) {
  app.get(
    ["/api/auth/oauth/github", "/api/oauth-github"],
    passport.authenticate("github", {
      session: false,
      scope: ["read:user", "user:email"]
    })
  );

  app.get(
    ["/api/auth/oauth/github/callback", "/api/oauth-github-callback"],
    passport.authenticate("github", {
      session: false,
      failureRedirect: `${POST_AUTH_REDIRECT_URL}?oauth=failed&provider=github`
    }),
    (req, res) => {
      const user = req.user;
      if (!user) {
        res.redirect(`${POST_AUTH_REDIRECT_URL}?oauth=failed&provider=github`);
        return;
      }

      setAuthCookie(req, res, user);
      res.redirect(`${POST_AUTH_REDIRECT_URL}?oauth=ok&provider=github`);
    }
  );
} else {
  app.get(["/api/auth/oauth/github", "/api/oauth-github"], (_req, res) => {
    res.status(503).json({ error: "github_oauth_not_configured" });
  });

  app.get(["/api/auth/oauth/github/callback", "/api/oauth-github-callback"], (_req, res) => {
    res.redirect(`${POST_AUTH_REDIRECT_URL}?oauth=disabled&provider=github`);
  });
}

app.get("/api/results", async (req, res) => {
  try {
    const queryLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
    const results = await listSpins(queryLimit);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: "failed_to_list_results", detail: String(error) });
  }
});

app.get("/api/stats", async (_req, res) => {
  try {
    const stats = await getSpinStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: "failed_to_compute_stats", detail: String(error) });
  }
});

app.post("/api/results", async (req, res) => {
  try {
    const payload = parseSpinPayload(req.body);
    if (!payload) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }

    const inserted = await insertSpin(payload, req.authUser ?? null);
    res.status(201).json({ item: inserted });
  } catch (error) {
    res.status(500).json({ error: "failed_to_insert_result", detail: String(error) });
  }
});

app.get("/api/leaderboard", async (req, res) => {
  try {
    const queryLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
    const leaderboard = await getLeaderboard(queryLimit);
    res.json({ items: leaderboard });
  } catch (error) {
    res.status(500).json({ error: "failed_to_fetch_leaderboard", detail: String(error) });
  }
});

app.get(["/api/lobby", "/api/lobby-state"], (_req, res) => {
  res.json(listLobbyPlayers());
});

app.post(["/api/lobby/join", "/api/lobby-join"], (req, res) => {
  const user = requireUser(req, res);
  if (!user) {
    return;
  }

  const joined = joinLobby(user);
  if (!joined.ok) {
    res.status(409).json(joined);
    return;
  }

  res.json(joined.snapshot);
});

app.post(["/api/lobby/heartbeat", "/api/lobby-heartbeat"], (req, res) => {
  const user = requireUser(req, res);
  if (!user) {
    return;
  }

  res.json(heartbeatLobby(user));
});

app.post(["/api/lobby/leave", "/api/lobby-leave"], (req, res) => {
  const user = requireUser(req, res);
  if (!user) {
    return;
  }

  res.json(leaveLobby(user));
});

app.get(["/api/payments/intents", "/api/payments-intents"], async (req, res) => {
  try {
    const user = requireUser(req, res);
    if (!user) {
      return;
    }

    const queryLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
    const includeAll =
      isAdminOrDeveloper(user) && typeof req.query.all === "string" && req.query.all.toLowerCase() === "true";

    const items = await listPaymentIntents({
      user,
      limit: queryLimit,
      includeAll
    });

    res.json({ items });
  } catch (error) {
    res.status(500).json({ error: "failed_to_fetch_payments", detail: String(error) });
  }
});

app.post(["/api/payments/intents", "/api/payments-intents"], async (req, res) => {
  try {
    const user = requireUser(req, res);
    if (!user) {
      return;
    }

    const body = req.body as Partial<{ chain: PaymentChain; amount: number | string; note: string }>;
    const chain = body.chain;
    const amount = Number(body.amount);

    if (typeof chain !== "string") {
      res.status(400).json({ error: "invalid_chain" });
      return;
    }

    const created = await createPaymentIntent({
      user,
      chain: chain as PaymentChain,
      amount,
      note: typeof body.note === "string" ? body.note : ""
    });

    if ("error" in created) {
      res.status(400).json(created);
      return;
    }

    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: "failed_to_create_payment", detail: String(error) });
  }
});

app.post(["/api/payments/submit", "/api/payments-submit"], async (req, res) => {
  try {
    const user = requireUser(req, res);
    if (!user) {
      return;
    }

    const body = req.body as Partial<{ paymentId: string; txHash: string; walletAddress: string }>;
    if (
      typeof body.paymentId !== "string" ||
      typeof body.txHash !== "string" ||
      typeof body.walletAddress !== "string"
    ) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }

    const submitted = await submitPaymentProof({
      user,
      paymentId: body.paymentId,
      txHash: body.txHash,
      walletAddress: body.walletAddress
    });

    if ("error" in submitted) {
      const status = submitted.error === "forbidden" ? 403 : 400;
      res.status(status).json(submitted);
      return;
    }

    res.json(submitted);
  } catch (error) {
    res.status(500).json({ error: "failed_to_submit_payment", detail: String(error) });
  }
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode = error.message === "cors_origin_not_allowed" ? 403 : 500;
  res.status(statusCode).json({
    error: statusCode === 403 ? "cors_origin_not_allowed" : "internal_server_error",
    detail: error.message
  });
});

if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => {
    console.log(`[dreidel-api] listening on http://localhost:${PORT}`);
  });
}

export default app;
