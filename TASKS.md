# TASKS

Last updated: 2026-04-20


<!-- ZERO_BUDGET_TASKS:START -->
Last updated: 2026-04-20

## Zero-Budget Deployment Checklist
- [ ] Verify deployment uses free-tier only (no paid Vercel upgrades).
- [ ] Confirm static hosting path is available and documented.
- [ ] Confirm shared-cloud/domain strategy is used where possible.
- [ ] Confirm no paid DB or SaaS dependency is required for core app flow.
- [ ] Validate fallback deployment path from DEPLOYMENT_ZERO_BUDGET.md.
<!-- ZERO_BUDGET_TASKS:END -->

<!-- REPO_DOCS_REFRESH_START -->
# TASKS

Updated: 2026-04-21
Repository: `dreidel-3d-sim`

## Immediate
- [ ] Run and verify setup command(s): `npm ci`
- [ ] Run and verify primary start command(s): `npm run dev`
- [ ] Run quality checks: `npm run build`
- [ ] Confirm key paths are still accurate: `src`, `api`, `server`, `public`, `docs`, `.github/workflows`, `README.md`, `package.json`
- [ ] Validate external metadata assumptions from `RESEARCH.md` against upstream changes.

## Next
- [ ] Prioritize top 3 reliability improvements for this repository.
- [ ] Expand automated tests around highest-risk areas.
- [ ] Tighten command documentation in README for onboarding speed.

## Ongoing Maintenance
- [ ] Keep README and architecture notes synchronized with code changes.
- [ ] Track technical debt and refactor candidates in `PLANNING.md`.
- [ ] Track unknowns and external dependencies in `RESEARCH.md`.

## Completed Recently
- [x] Repository-specific task file refreshed on 2026-04-21.
<!-- REPO_DOCS_REFRESH_END -->
