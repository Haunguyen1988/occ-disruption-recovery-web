# Production Readiness Checklist

Use this before sharing a production URL with OCC users. The goal is a controlled release: known code, known database shape, known users, observable failures, and a rollback path.

## Release Gate

- [ ] Pick the release branch/commit and create a release tag.
- [ ] Confirm S8 manual browser UAT has passed.
- [ ] Run the local production verification suite:
  ```powershell
  npm.cmd run verify:prod
  ```
- [ ] If the combined verification script cannot be used, run the individual commands:
  ```powershell
  npm.cmd run lint
  npm.cmd test
  npm.cmd run build
  $env:OCC_TAIL_BENCHMARK_SCHEDULE='public/uat/uat_tail_assignment_schedule.csv'
  $env:OCC_TAIL_BENCHMARK_AIRCRAFT='public/uat/uat_tail_assignment_aircraft.csv'
  $env:OCC_TAIL_BENCHMARK_DISRUPTION='public/uat/uat_scenario_tail_assignment.csv'
  npm.cmd run benchmark:tail
  ```
- [ ] Record the benchmark summary in the release note: scenario, mode, runtime, tail rank, tail score, best non-tail rank/score, score delta, horizon size, arc reduction, path/search-node counts, fixed connections, and blocker diagnostics.
- [ ] Fill out `docs/PROD_RELEASE_NOTES_TEMPLATE.md` for the release.

Expected S8 benchmark shape for the current passenger-scored release candidate:

- Scenario: `UAT-TAIL-001`
- Mode: `balanced`
- Tail option rank: `1`
- Tail score: `2387`
- Best non-tail rank: `3`
- Best non-tail score: `23215`
- Score delta: `-20828`
- Horizon flights / aircraft: `5 / 3`
- Arc reduction: `35 -> 9`, about `74%`
- Paths / search nodes: `15 / 42`
- Fixed connections: `1`

Runtime varies by machine; the checked-in S8 fixture should remain comfortably sub-second. Treat rank #1 and the score delta direction as the release-critical assertions.

## Supabase Production Preflight

- [ ] Back up the Supabase project before applying migrations or seed changes.
- [ ] Apply migrations in order:
  - `supabase/migrations/0001_init.sql`
  - `supabase/migrations/0002_curfew_and_multi_event.sql`
  - `supabase/migrations/0003_approval_safety.sql`
  - `supabase/migrations/0004_airports.sql`
  - `supabase/migrations/0005_passenger_fields.sql`
  - `supabase/migrations/0006_crew_fields.sql`
  - `supabase/migrations/0007_actual_times.sql`
- [ ] Create production auth users in Supabase Authentication.
- [ ] Set production roles in `public.profiles`:
  - `viewer` for read-only users
  - `controller` for users who can save and approve
  - `admin` for audit/admin owners
- [ ] Run `docs/uat/uat_preflight_check.sql` against the production Supabase project.
- [ ] Confirm every schema, trigger, RLS, policy, and RPC row returns `OK`.
- [ ] Confirm every required production user has an expected role.
- [ ] Do not add `SUPABASE_SERVICE_ROLE_KEY` to Vercel. The app uses signed-in users, RLS, and the anon key.
- [ ] Do not set `NEXT_PUBLIC_ALLOW_STUB_MODE=1` in production.

## Vercel Configuration

- [ ] Set Node.js version to `22` if Vercel does not infer it correctly.
- [ ] Configure only these required environment variables for Production:

| Name | Expected value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-id>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon publishable key |

- [ ] Set the same variables for Preview if PR previews should use Supabase.
- [ ] Confirm `/login` does not show a development dashboard bypass in Production.
- [ ] Confirm Vercel build command and install command remain framework defaults unless there is a documented reason to override them.
- [ ] Deploy from the tagged release commit.

## Production Smoke Test

Run this immediately after deploy:

- [ ] Open `/login`; sign in as a `viewer`.
- [ ] Confirm `/dashboard` loads and read-only actions are correctly restricted.
- [ ] Sign in as a `controller`.
- [ ] Load the S8 UAT schedule, aircraft, and disruption CSVs.
- [ ] Run simulation in `Balanced` mode.
- [ ] Confirm `TAIL_ASSIGNMENT_OPTIMIZED` ranks first.
- [ ] Confirm the ranked-row/detail explanation is visible and understandable.
- [ ] Save to Supabase.
- [ ] Approve one option.
- [ ] Open audit and confirm the saved simulation, approval metadata, UTC timestamps, option details, and audit rows are visible.
- [ ] Confirm compare opens from the saved simulation and survives refresh.

## Observability

Minimum production monitoring should answer these questions:

- Can users sign in?
- Can operational data load from Supabase?
- Can simulations complete for realistic files?
- Can controllers save and approve?
- Are approval RPC failures or missing migrations visible?

Recommended setup:

- [ ] Enable Vercel runtime logs and retain the deployment URL in the release note.
- [ ] Add an error tracker such as Sentry before broader rollout.
- [ ] Track failures by route/action: import, simulate, save, approve, audit load, compare load.
- [ ] For simulation failures, capture non-sensitive diagnostics: scenario id, disruption type, schedule row count, aircraft row count, selected tail-assignment mode, and error message.
- [ ] Do not log raw passenger data, private operational files, auth tokens, API keys, or full uploaded file contents.

## Rollback Plan

- [ ] Keep the previous known-good Vercel deployment available.
- [ ] If the new deployment fails before database writes, roll back in Vercel to the previous deployment.
- [ ] If the issue appears after migrations or writes, pause user access first, then decide between forward fix and database restore.
- [ ] Treat Supabase migrations as forward-fix by default unless a tested rollback SQL exists.
- [ ] Keep the Supabase backup timestamp, release tag, Vercel deployment URL, and operator sign-off in the release note.

## Go/No-Go

Go only when all are true:

- Automated verification passed.
- S8 manual UAT passed.
- Supabase preflight passed.
- Production smoke passed for viewer and controller roles.
- Rollback owner and steps are known.
- Any remaining caveats are documented in the release note.

No-go examples:

- Missing approval RPC or RLS policies.
- Save/approve fails for a controller.
- Audit cannot show saved simulations.
- S8 tail option does not rank first on the checked-in fixture.
- Vercel is running with missing or wrong Supabase env vars.
