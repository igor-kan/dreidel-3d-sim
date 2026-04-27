# Zero-Budget Deployment Plan: dreidel-3d-sim

Last updated: 2026-04-20

## Objective
Keep this project at 0 dollars per month while remaining reliably deployable.

## Cheapest Vercel Setup (If Staying on Vercel)
- Use the Hobby plan only.
- Keep deployment type as static whenever possible (no paid add-ons).
- Avoid features that can push usage beyond free quotas: always-on serverless traffic, high-frequency cron jobs, large image transformations, and paid observability products.
- Deploy only required branches (main production plus short-lived preview branches).
- Keep build output lean and cacheable to reduce build minutes.

## Shared-Cloud Savings Strategy
- Use one shared cloud account for all projects instead of per-project paid plans.
- Prefer static hosting for frontends and reuse one shared backend/API layer only when needed.
- Reuse one domain strategy (subdomains) and one CDN/account to reduce operational overhead.

## If Vercel Becomes Too Expensive

### Option A: Cloudflare Pages (Recommended for static or SPA)
1. Create a Pages project connected to this repo.
2. Set framework build command and output directory for this project.
3. Attach a subdomain under your shared domain.
4. Keep all services on Cloudflare free tier where possible.

### Option B: GitHub Pages (Best for pure static sites)
1. Build static assets in GitHub Actions.
2. Publish dist or root static output to Pages.
3. Use custom domain only if needed.

### Option C: Shared single-host deployment
1. Run multiple apps on one host behind Caddy or Nginx using subdomains.
2. Keep one low-resource shared backend for common APIs.
3. Reserve this for projects that cannot run as static sites.

## Required Cost Guardrails
- No paid database or third-party SaaS without explicit approval.
- Prefer free-tier or local-first tooling.
- Any feature with potential recurring cost must include a fallback path.

## Repository Docs Updated
- AGENTS.md: zero-budget engineering policy.
- TASKS.md: operational checklist for low-cost deployment.
- README.md and planning/research docs: links to this policy.
