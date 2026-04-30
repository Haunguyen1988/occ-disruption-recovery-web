# Memory Bank

Last updated: 2026-04-30

This folder is the project handoff state for future Codex sessions. Start here before changing code.

## Current State

- App: OCC Disruption Recovery web MVP for small airline OCC demo.
- Stack: Next.js 16 App Router, React 19, Tailwind v4, Supabase SSR, TypeScript, Vitest.
- Core behavior: load schedule/aircraft/disruption data, run recovery simulations, compare options, save/audit via Supabase when configured.
- Stub mode works without Supabase and auto-loads AOG sample data.
- Git worktree before this memory-bank update already had `package-lock.json` modified and `.brain/` untracked. Do not revert those unless the user asks.

## Latest Verification

Commands run on 2026-04-30 after the simulation-feedback improvement:

- `npm.cmd run lint`: passed.
- `npm.cmd run dev`: required escalation because sandboxed `next dev` hit `spawn EPERM`; local server then came up at `http://127.0.0.1:3000`.
- `npm.cmd test`: passed, 10 test files and 84 tests. The first sandbox run hit `spawn EPERM`; rerun with escalation passed.
- `npm.cmd run build`: passed. The first sandbox run hit `.next` unlink `EPERM`; rerun with escalation passed.

Known local caveats:

- `npm` in PowerShell is blocked by execution policy. Use `npm.cmd ...`.
- Next dev/Vitest/Next build can hit sandbox-only `EPERM` on process spawn or `.next` cleanup; rerun with escalation when needed.

## Most Important Findings

1. Fixed on 2026-04-29: `SINGLE_SWAP` can no longer create overlapping aircraft schedules for the candidate downstream rotation. See `src/lib/engine/recovery-option-generator.ts`.
2. Initial Phase 2 pass completed on 2026-04-29: rules parsing is centralized and validated, invalid YAML keeps the last valid rules snapshot, import previews are paginated, and Gantt has stable horizontal scrolling.
3. Fixed on 2026-04-29: `approveOption` now uses an atomic Supabase RPC and a partial unique index so stale/wrong option ids cannot clear existing approvals. See `src/lib/supabase/approval.ts` and `supabase/migrations/0003_approval_safety.sql`.
4. Fixed on 2026-04-29: Supabase operational-data query errors are surfaced as a dashboard banner instead of empty data. See `src/lib/supabase/queries.ts` and `src/app/dashboard/layout.tsx`.
5. Fixed on 2026-04-29: production build no longer depends on Google Fonts. `src/app/layout.tsx` uses no `next/font/google`, and `src/app/globals.css` defines system sans/mono font stacks.
6. Updated on 2026-04-30: README, deploy, and UAT docs now tell operators to run migrations through `0003_approval_safety.sql` and avoid `SUPABASE_SERVICE_ROLE_KEY`.
7. Updated on 2026-04-30: audit-page setup copy and approval-RPC error messaging now point operators to migrations through `0003_approval_safety.sql`.
8. Updated on 2026-04-30: UAT now includes a read-only `docs/uat/uat_preflight_check.sql` for verifying migration artifacts and seeded user roles before the round starts.
9. Updated on 2026-04-30: the UAT preflight check also covers auth trigger, RLS, and write-policy presence, and the UAT README now explains every preflight status outcome.
10. Updated on 2026-04-30: dashboard auth gating is now enforced in `src/app/dashboard/layout.tsx`, and the login page only offers unauthenticated dashboard access in stub mode.
11. Updated on 2026-04-30: audit pages now support UTC ISO timestamps, text filtering, and a saved-simulation drilldown route at `src/app/dashboard/audit/[uuid]/page.tsx`.
12. Updated on 2026-04-30: compare now survives refresh for saved simulations via `/dashboard/compare?simulation=<uuid>&a=<id>&b=<id>`, while preserving the `sessionStorage` fallback for unsaved local compares.
13. Updated on 2026-04-30: simulation results now explain blocked single-swap candidates and surface risk/penalty watchouts directly in the ranked options list on `src/app/dashboard/simulate/page.tsx`.

## Recommended Next Step

All four original review findings are addressed. Recommended next step:

- Do an end-to-end UAT pass with real/sized AIMS exports.
- Capture whether operators still need more explanation around curfew/risk scoring after trying the new simulation feedback.
- Continue deeper large-data optimization only if real AIMS files still feel slow.
