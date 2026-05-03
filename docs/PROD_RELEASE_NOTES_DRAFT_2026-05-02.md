# Production Release Notes Draft - 2026-05-02

## Release

- Release tag: `TBD`
- Commit: `4cf6e1dc321e3506b59401dc05d5e2a6bfe71eaf` plus current uncommitted release-candidate changes
- Branch: `bootstrap-main`
- Vercel deployment URL: `TBD`
- Supabase project: `TBD`
- Release owner: `TBD`
- Rollback owner: `TBD`
- Release date/time: `2026-05-03 11:07 Asia/Bangkok local verification refresh`

## Verification

- `npm.cmd run verify:prod`: PASS on 2026-05-03 after DEEP_DELAY verification alignment and lint cleanup
- `npm.cmd run lint`: PASS on 2026-05-03 with no warnings
- `npm.cmd test`: PASS on 2026-05-03, 15 files passed, 1 benchmark file skipped; 131 tests passed, 1 skipped
- `npm.cmd run build`: PASS on 2026-05-03
- S8 manual browser UAT: PASS, user-reported on 2026-05-02
- Supabase preflight SQL: `TBD` against target Supabase project

## Tail Assignment Benchmark

- Scenario: `UAT-TAIL-001`
- Mode: `balanced`
- Schedule flights: `5`
- Aircraft: `3`
- Impacted flights: `1`
- Ranked options: `7`
- Runtime: `19 ms`
- Tail rank: `1`
- Tail score: `2387`
- Best non-tail rank: `3`
- Best non-tail score: `23215`
- Score delta: `-20828`
- Horizon flights / aircraft: `5 / 3`
- Arc reduction: `35 -> 9`, `74%`
- Paths / search nodes: `15 / 42`
- Fixed connections: `1`
- No-option reason: `none`
- Top blocker diagnostic: `Start arc blocked: aircraft not positioned at flight origin`

## Production Smoke

- Viewer sign-in and read-only access: `TBD`
- Controller sign-in: `TBD`
- S8 import and simulation: `TBD`
- Save to Supabase: `TBD`
- Approve option: `TBD`
- Audit detail: `TBD`
- Compare reload from saved simulation: `TBD`

## Changes

- User-facing changes:
  - Tail-assignment optimized recovery is available with Fast/Balanced/Deep modes and ranked-option explanations.
  - Simulate page surfaces passenger-impact metrics for ranked options and details.
  - DEEP_DELAY now labels the selected low-priority flight while preserving the full flight impact plan.
  - Audit detail and compare reload support saved simulation review workflows.
  - Production auth fails closed when Supabase env vars are missing.

- Operational changes:
  - `npm.cmd run verify:prod` runs lint, tests, production build, and deterministic S8 benchmark.
  - The stale unused partial-swap helper was removed, so lint is clean for the release gate.
  - Production readiness checklist and release notes template are available under `docs/`.
  - UAT preflight validates schema, auth trigger, RLS/write policies, approval RPC, and passenger/crew/actual-time columns.

- Database changes:
  - Apply migrations through `supabase/migrations/0007_actual_times.sql`.
  - `0005_passenger_fields.sql` adds nullable non-negative passenger fields to `public.flights`.
  - `0006_crew_fields.sql` adds nullable `captain` and `first_officer` fields to `public.flights`.
  - `0007_actual_times.sql` adds nullable `actual_departure_time` and `actual_arrival_time` fields to `public.flights`.

- Known caveats:
  - Full production smoke still requires target Vercel URL, Supabase project, and authenticated user accounts.
  - `npm.cmd test`, `npm.cmd run build`, and `npm.cmd run benchmark:tail` can hit sandbox-only `EPERM`; rerun with escalation in Codex sessions.
  - Current release notes use the local base commit plus uncommitted release-candidate changes until a final commit/tag is cut.

## Rollback

- Previous known-good Vercel deployment: `TBD`
- Supabase backup timestamp: `TBD`
- Rollback decision notes:
  - Prefer Vercel instant rollback for app regressions.
  - Treat Supabase migrations as forward-fix by default unless a tested rollback SQL exists.
  - If writes or approval flows misbehave after migration, pause user access first, preserve audit data, then choose forward fix or database restore.
