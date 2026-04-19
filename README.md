# Dreidel 3D Physics Sim

A browser-based 3D dreidel simulation with rigid-body physics, animated spin/fall behavior, multiple visual model variants, and programmatic value detection once the top settles.

## Features

- Real-time 3D rendering with `three.js`
- Rigid-body physics with `cannon-es`
- Programmatic side detection (`Nun`, `Gimel`, `Hei`, `Shin`) from final orientation
- Multiple visual variants, including external GLB model loading from `public/models`
- Persistent backend API for spin history + statistics (`Express` + JSON file store)
- Browser fallback mode with local history if API is unavailable
- Browser hooks:
  - `window.getLastDreidelResult()`
  - `window.getDreidelStats()`
  - `window.addEventListener("dreidel:settled", ...)`

## Local Development

```bash
npm install
npm run dev
```

This starts:

- frontend: `http://localhost:5173`
- API server: `http://localhost:8787`

Vite proxies `/api/*` requests to the local backend during development.

## Backend API

### `POST /api/results`
Store a spin result.

Body shape:

```json
{
  "value": "Nun",
  "confidence": 0.91,
  "spinRateAtRest": 0.03,
  "linearSpeedAtRest": 0.01,
  "modelKey": "classic",
  "timestamp": 1760000000000
}
```

### `GET /api/results?limit=20`
Returns recent stored results.

### `GET /api/stats`
Returns aggregate stats (`totalSpins`, `averageConfidence`, by-value counts, by-model counts, etc.).

## Data Persistence

- Server-side history is stored in `data/spin-results.json`.
- File is auto-created on first successful `POST /api/results`.

## External 3D Models

Put GLB files in `public/models/` (see `public/models/README.md`) and choose the corresponding `GLB ...` preset in the model picker.

## Build and Checks

```bash
npm run check
npm run build
```

## CI and Deploy

### CI

`/.github/workflows/ci.yml`

- install
- type-check (`client + server`)
- build frontend

### GitHub Pages

`/.github/workflows/deploy-pages.yml`

- deploys `dist/` on pushes to `main`
- uses repo secret `VITE_API_BASE_URL` (optional)

If `VITE_API_BASE_URL` is not set, Pages deployment still works and the app falls back to local browser history.

### Vercel

`/.github/workflows/deploy-vercel.yml`

Required repository secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `VITE_API_BASE_URL` (optional, recommended for external API)
