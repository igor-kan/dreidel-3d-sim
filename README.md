# Dreidel 3D Physics Arena

A browser-based 3D dreidel game with realistic rigid-body simulation, gesture-based control, multiplayer lobby visibility, auth, leaderboard, and payment intent flows.

## Core Gameplay Controls

- Camera rotate: drag anywhere in the viewport
- Camera zoom: wheel (desktop) or pinch (mobile)
- Tilt setup: drag from the center of the dreidel body
- Spin launch: drag from the top stem outward
- Programmatic value detection after settle (`Nun`, `Gimel`, `Hei`, `Shin`)

To keep outcomes fair, non-admin launches always include random perturbation and cannot force deterministic landings.

## Features

- `three.js` rendering + `cannon-es` physics
- Multiple dreidel models (procedural + external GLB assets)
- Local/register login, Google OAuth, GitHub OAuth
- Roles: `user`, `admin`, `developer`
- Admin/developer-only manual slider launch controls
- Lobby view with up to 8 concurrent players
- Leaderboard from persisted user stats
- Payment intents for Solana, Ethereum, Polygon, Base
- Persistence supports:
  - Postgres via `DATABASE_URL` (recommended for production)
  - JSON file fallback for local/dev
- JSON fallback files:
  - `data/spin-results.json`
  - `data/users.json`
  - `data/payment-intents.json`

## Free Dreidel Models + Authoring Docs

- Free model sources and download format guide: `docs/DREIDEL_MODEL_DOWNLOADS.md`
- Build your own spinnable model guide: `docs/BUILD_SPINNABLE_DREIDEL_MODEL.md`
- Source attribution: `public/models/ATTRIBUTION.md`

Runtime recommendation: ship dreidel models as `.glb`.

## Local Development

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:8787`

## Environment Variables

Use `.env` (or Vercel project env) for production setup.

```bash
# Core
APP_BASE_URL=https://your-app.example
API_BASE_URL=https://your-app.example
AUTH_JWT_SECRET=replace-with-long-random-secret
CORS_ORIGINS=https://your-app.example,https://www.your-app.example
DATABASE_URL=postgres://user:password@host:5432/dbname
# Optional: disable SSL for local postgres only
DATABASE_SSL_MODE=disable
# Optional: if Postgres is down/misconfigured, continue using JSON fallback
DB_FALLBACK_TO_JSON=true
# Optional: auto-import existing JSON data into empty Postgres tables
DB_BOOTSTRAP_FROM_JSON=true

# OAuth (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=https://your-app.example/api/oauth-google-callback

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_CALLBACK_URL=https://your-app.example/api/oauth-github-callback

# Payment merchant addresses
SOLANA_MERCHANT_ADDRESS=
ETHEREUM_MERCHANT_ADDRESS=
POLYGON_MERCHANT_ADDRESS=
BASE_MERCHANT_ADDRESS=
# Optional fallback for EVM chains
EVM_MERCHANT_ADDRESS=

# Optional role bootstrap lists
ADMIN_EMAILS=admin@example.com
DEVELOPER_EMAILS=dev@example.com
```

## API Overview

- Auth
  - `GET /api/auth-me`
  - `POST /api/auth-register`
  - `POST /api/auth-login`
  - `POST /api/auth-logout`
  - `GET /api/oauth-google`
  - `GET /api/oauth-github`
- Spins/Stats
  - `POST /api/results`
  - `GET /api/results?limit=20`
  - `GET /api/stats`
  - `GET /api/health` (includes oauth/payment/storage readiness)
- Lobby/Leaderboard
  - `GET /api/lobby`
  - `POST /api/lobby-join`
  - `POST /api/lobby-heartbeat`
  - `POST /api/lobby-leave`
  - `GET /api/leaderboard?limit=20`
- Payments
  - `GET /api/payments-intents`
  - `POST /api/payments-intents`
  - `POST /api/payments-submit`

## Build and Checks

```bash
npm run check
npm run build
```

## Vercel Deployment

This repo includes a Vercel serverless API entrypoint at `api/[...all].ts` that serves the Express API routes.

Deploy manually:

```bash
vercel --prod
```

Or use GitHub Actions workflow:

- `.github/workflows/deploy-vercel.yml`


<!-- ZERO_BUDGET_README:START -->
## Zero-Budget Deployment

This repository is maintained under a strict 0 dollars per month deployment policy.

- Primary policy and migration options: DEPLOYMENT_ZERO_BUDGET.md
- Agent rules and constraints: AGENTS.md
- Execution checklist: TASKS.md

If Vercel no longer fits free-tier limits, migrate to Cloudflare Pages or GitHub Pages per the runbook.
<!-- ZERO_BUDGET_README:END -->

<!-- REPO_ANALYSIS_OVERVIEW_START -->
## Repository Analysis Snapshot

Generated: 2026-04-21

- Primary stack: Node.js, Vite, TypeScript
- Key paths: `src`, `api`, `server`, `public`, `docs`, `.github/workflows`, `README.md`, `package.json`
- Files scanned (capped): 60
- Test signal: No obvious automated test structure detected
- CI workflows present: Yes
- GitHub slug: igor-kan/dreidel-3d-sim
- GitHub last push: 2026-04-19T19:23:14Z

### Quick Commands

Setup:
- `npm ci`

Run:
- `npm run dev`

Quality:
- `npm run build`

### Companion Docs

- `AGENTS.md`
- `TASKS.md`
- `PLANNING.md`
- `RESEARCH.md`
- `PROJECT_BRIEF.md`

### Web Research References

- Origin remote: `https://github.com/igor-kan/dreidel-3d-sim.git`
- GitHub homepage: Not set
- `Node.js: https://nodejs.org/en/docs`
- `Vite: https://vite.dev/guide/`
- `TypeScript: https://www.typescriptlang.org/docs/`
<!-- REPO_ANALYSIS_OVERVIEW_END -->
