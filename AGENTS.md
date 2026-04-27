# AGENTS

Last updated: 2026-04-20


<!-- ZERO_BUDGET_POLICY:START -->
Last updated: 2026-04-20

## Zero-Budget Deployment Policy
- Treat 0 dollars per month as a hard constraint for this repository.
- Default deployment target: free-tier static hosting or free-tier Vercel Hobby when static-only.
- Prefer shared infrastructure over new paid services.
- Do not introduce paid recurring dependencies without explicit owner approval.
- Any new deployment/runtime feature must document free-tier limits and rollback steps.
<!-- ZERO_BUDGET_POLICY:END -->

<!-- REPO_DOCS_REFRESH_START -->
# AGENTS

This file contains repository-specific working guidance for coding agents collaborating on **dreidel-3d-sim**.

## Project Snapshot
- Repository: `dreidel-3d-sim`
- Path: `/home/igorkan/repos/dreidel-3d-sim`
- Purpose: A browser-based 3D dreidel game with realistic rigid-body simulation, gesture-based control, multiplayer lobby visibility, auth, leaderboard, and payment intent flows.
- Primary Stack: Node.js, Vite, TypeScript

## External Research Signals
- Origin Remote: `https://github.com/igor-kan/dreidel-3d-sim.git`
- GitHub Slug: `igor-kan/dreidel-3d-sim`
- GitHub Description: 3D dreidel physics simulation with programmatic face detection
- GitHub Homepage: Not set
- GitHub Topics: None detected
- GitHub Last Push Timestamp: 2026-04-19T19:23:14Z

## Local Commands
Setup:
- `npm ci`

Run:
- `npm run dev`

Quality Checks:
- `npm run build`

## Agent Workflow
- Make changes that stay scoped to this repository.
- Prefer small, verifiable increments over large speculative rewrites.
- Update docs and task files in this repository when behavior or interfaces change.
- Avoid destructive git operations unless explicitly requested.

## Definition Of Done
- Relevant commands/tests complete successfully for this repository.
- Documentation reflects implemented behavior.
- Remaining risks and follow-ups are captured in `TASKS.md` and `RESEARCH.md`.
<!-- REPO_DOCS_REFRESH_END -->
