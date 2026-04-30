# Active Context

Last updated: 2026-04-30

## Where The Project Is

The app is a working MVP. It builds, lints, and the current tests pass. The main risk is not basic compilation; it is operational correctness around recovery options, persistence edge cases, and realistic UAT data flow.

The review identified four actionable findings. All four have been fixed, and Phase 2 runtime-smoothness work now includes parser/UI improvements plus an engine schedule index.

All four original review findings have now been addressed in code.

## What Not To Forget

- The existing `.brain/` folder is local session noise, not the durable memory bank. It is now ignored by git.
- `package-lock.json` was already modified before the memory-bank work. Treat it as user-owned until clarified.
- The app uses Next.js 16. Follow `AGENTS.md` and inspect local Next docs before framework-specific code changes.
- Use `npm.cmd` instead of `npm` in PowerShell.

## Last Known Commands

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

All passed on 2026-04-30 after the simulation-feedback improvement. After the latest suite, full test count is now 84.

Notes from this verification:

- `npm.cmd run lint` passed in the sandbox.
- `npm.cmd test` needed escalation after a sandbox `spawn EPERM`, then passed: 10 files, 84 tests.
- `npm.cmd run build` needed escalation after a sandbox `.next` unlink `EPERM`, then passed.
- `npm.cmd run dev` also needed escalation after a sandbox `spawn EPERM`.

## Latest Phase 2 Changes

- `DataProvider` uses the single `DEFAULT_RULES_YAML` from `src/lib/parsers/rules.ts`.
- Rules YAML is validated structurally. Invalid edits show an error and the engine keeps the last valid rules snapshot.
- Schedule and aircraft previews on `/dashboard/data` render 100 rows per page.
- `GanttSchedule` has stable timeline width and horizontal scrolling for longer schedules.

## Latest Approval Safety Changes

- `approveOption` now calls `approveRecoveryOptionAtomic`.
- `approveRecoveryOptionAtomic` wraps the `approve_recovery_option` Supabase RPC and returns failure for stale option ids or missing migrations.
- `supabase/migrations/0003_approval_safety.sql` adds the atomic approval function and a partial unique index allowing only one approved option per simulation.

## Latest Supabase Load Error Changes

- `loadOperationalData` now returns `{ data, error }` instead of silently mapping failed queries to empty arrays.
- `collectOperationalLoadErrors` aggregates source-specific Supabase errors and has unit coverage.
- `DashboardLayout` shows an operational data error banner when Supabase data cannot be loaded.

## Latest Font Build Changes

- `src/app/layout.tsx` no longer imports `next/font/google`.
- `src/app/globals.css` defines system sans and mono font stacks for Tailwind font tokens.
- Search for `next/font/google`, `fonts.googleapis`, `font-geist`, and `Geist` returns no source matches.

## Latest UAT Smoke Changes

- `src/lib/engine/__tests__/uat-smoke.test.ts` reads the actual checked-in `public/uat` files instead of duplicated inline rows.
- The smoke suite verifies broken schedule import behavior, AIMS duplicate flight-id protection, the AOG scenario, and combined AOG + HAN closure simulation.
- Targeted UAT smoke test passed: 3 tests.
- Full test suite passed after this change: 8 files, 76 tests.

## Latest Engine Smoothness Changes

- `src/lib/engine/schedule-index.ts` builds reusable `flightsById`, `flightsByStd`, and `rotationsByAircraft` indexes.
- `runSimulation` and `runMultiEventSimulation` now build the schedule index once and pass it through impact detection, delay simulation, candidate finding, and recovery option generation.
- Existing public engine APIs still accept the same inputs; optional index parameters are internal/performance-friendly.
- Verification after this change: `npm.cmd run lint` passed, `npm.cmd test` passed (8 files, 76 tests), and `npm.cmd run build` passed.

## Latest Documentation Alignment Changes

- README Supabase setup now tells operators to run migrations in order through `0003_approval_safety.sql`.
- README and Vercel deployment docs no longer tell operators to configure `SUPABASE_SERVICE_ROLE_KEY`.
- UAT pre-flight docs now include `0003_approval_safety.sql` before UAT seeding.
- `docs/uat/uat_cleanup.sql` schema note now references 0003.
- Audit-page setup guidance now tells operators to run migrations through `0003_approval_safety.sql`.
- Missing approval RPC errors now tell operators exactly which migration cutoff to apply.
- `docs/uat/uat_preflight_check.sql` now provides a read-only schema/user-role check before UAT starts.
- The UAT preflight check now also validates auth trigger presence, RLS enablement, and key `*_write` policies so Save/Approve failures can be caught before the round starts.
- `docs/uat/README.md` now explains how to interpret `ACTION_REQUIRED`, `MISSING_AUTH_USER`, `MISSING_PROFILE_ROW`, and `CHECK_ROLE`.

## Latest Local UAT Smoke

- Local dev server started successfully on `http://127.0.0.1:3000` with the current `.env.local` Supabase config.
- HTTP smoke checks for `/login`, `/dashboard`, and `/dashboard/audit` returned `200`.
- Next dev logs showed no SSR/runtime errors during those route hits.
- Full browser-driven UAT still needs a human/browser session; this Codex session could only do HTTP-level smoke because in-app browser control was unavailable.

## Latest Auth Gate Fix

- `/dashboard` routes now redirect to `/login` when Supabase is configured and no session exists.
- `/login` no longer shows "Continue without signing in" while Supabase auth is enabled; that bypass remains available only in stub mode.
- Verification on 2026-04-30: `curl` to `/dashboard` returned `307` with `location: /login`, `/login` no longer exposed the bypass link, `npm.cmd run lint` passed, and `npm.cmd run build` passed.

## Latest Audit Drilldown Fix

- `/dashboard/audit` now supports text filtering across saved simulations and activity rows.
- Audit timestamps now render as UTC ISO 8601 strings with `Z` suffix, matching the UAT requirement.
- Saved simulation UUIDs and related audit rows now link to `/dashboard/audit/[uuid]`.
- `/dashboard/audit/[uuid]` shows simulation summary, approved-option metadata (`rank`, `score`, `approved_by_email`, `approved_at`), related audit rows, and saved option/flight-change details without rerunning the engine.
- Verification on 2026-04-30: `npm.cmd run lint` passed and `npm.cmd run build` passed.

## Latest Compare Persistence Fix

- `/dashboard/compare` now supports saved-simulation reloads via `?simulation=<uuid>&a=<option_id>&b=<option_id>`.
- `Simulate -> Open compare` now uses saved simulation query params when a simulation UUID exists, while keeping the old `sessionStorage` fallback for unsaved local compares.
- `src/lib/compare.ts` now owns compare hydration and option-selection helpers, with coverage in `src/lib/__tests__/compare.test.ts`.
- Verification on 2026-04-30: `npm.cmd run lint` passed, `npm.cmd test` passed with escalation (9 files, 80 tests), and `npm.cmd run build` passed with escalation.

## Latest Simulation Feedback Improvement

- `SimulationResult` now carries `feedback` describing the single-swap target flight, how many candidate aircraft were checked, and why blocked candidates could not cover the full downstream rotation.
- `generateRecoveryOptions` now keeps evaluating swap candidates after early downstream failures, still returning at most 3 feasible swap options while preserving diagnostics for the operator.
- `/dashboard/simulate` now shows a single-swap feasibility panel plus compact watchouts on ranked options so curfew/risk penalties are visible before opening detail.
- `src/lib/option-feedback.ts` now centralizes ranked-option watchouts, with regression coverage in `src/lib/__tests__/option-feedback.test.ts`.
- Verification on 2026-04-30: `npm.cmd run lint` passed, `npm.cmd test` passed with escalation (10 files, 84 tests), and `npm.cmd run build` passed with escalation.

Verification after this alignment pass:

- `npm.cmd run lint` passed on 2026-04-30.
- `npm.cmd test` passed on 2026-04-30 with escalation: 10 files, 84 tests.
- `npm.cmd run build` passed on 2026-04-30 with escalation.

## Next Coding Task

No original review item remains. Deployment/UAT docs are aligned with the 0003 approval-safety migration, compare persistence survives refresh for saved simulations, and simulation feedback now explains blocked swap candidates. Suggested next work:

1. Run a manual end-to-end UAT pass in the browser against realistic AIMS exports.
2. Capture operator notes from that round, especially whether the new swap-feasibility panel and ranked-option watchouts are enough.
3. If large AIMS files still feel slow, revisit Web Worker/index optimization from Phase 2.
