# Active Context

Last updated: 2026-05-04

## Where The Project Is

The app is a working MVP. It builds, lints, and the current tests pass. The main risk is not basic compilation; it is operational correctness around recovery options, persistence edge cases, and realistic UAT data flow.

The review identified four actionable findings. All four have been fixed, and Phase 2 runtime-smoothness work now includes parser/UI improvements plus an engine schedule index.

All four original review findings have now been addressed in code.

## Latest Upload And Simulate Recheck

- CSV/XLSX upload now normalizes common exported header variants (`Flight ID`, `Aircraft ID`, spaces, dashes, dots, and BOM-prefixed first columns) before schedule/aircraft/disruption parsing.
- `/dashboard/simulate` now shows parser and cross-dataset import issues inline and disables the Run button while any import error remains, avoiding silent partial-data simulations.
- Verification on 2026-05-04: `npm.cmd run lint` passed; targeted CSV parser test passed with escalation after sandbox `spawn EPERM` (28 tests); `npm.cmd run build` passed with escalation after sandbox `.next` unlink `EPERM`.

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
npm.cmd run benchmark:tail
```

All passed on 2026-05-01 after the tail-assignment mode controls pass. The normal suite now reports 104 passed tests plus 1 skipped opt-in benchmark test.

Notes from this verification:

- `npm.cmd run lint` passed in the sandbox.
- `npm.cmd test` needed escalation after a sandbox `spawn EPERM`, then passed: 13 files passed, 1 benchmark file skipped; 104 tests passed, 1 skipped.
- `npm.cmd run build` needed escalation after a sandbox `.next` unlink `EPERM`, then passed.
- `npm.cmd run dev` also needed escalation after a sandbox `spawn EPERM`.
- `npm.cmd run benchmark:tail` needed escalation after a sandbox `spawn EPERM`, then passed and printed the AIMS DayRep metrics table.

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

- Local dev server started successfully on `http://127.0.0.1:3000` with the current `.env.local` Supabase config on 2026-05-02.
- First sandbox dev start failed with `spawn EPERM`; the background dev server started successfully after escalation.
- HTTP smoke checks returned `/login` `200`; `/dashboard`, `/dashboard/data`, and `/dashboard/simulate` returned `307` redirects to `/login`, matching the Supabase auth gate when no session cookie is present.
- Next dev logs showed no SSR/runtime errors during those route hits.
- Full browser-driven UAT still needs a human/browser session. In this Codex session, the Browser plugin skill was available but the Node REPL browser-control tool was not exposed, and no authenticated browser session/credentials were available.

## Latest Auth Gate Fix

- `/dashboard` routes now redirect to `/login` when Supabase is configured and no session exists.
- Production deployments now fail closed when Supabase env vars are missing; dashboard access is locked instead of falling back to stub mode.
- Stub dashboard access is only allowed outside production by default, or with the explicit `NEXT_PUBLIC_ALLOW_STUB_MODE=1` override for controlled demos.
- Landing page no longer shows a generic "Open dashboard" route when auth is required; it sends users to `/login`.
- `/login` shows a configuration error when production auth is missing and only exposes "Open development dashboard" when stub mode is allowed.
- `src/lib/supabase/auth-mode.ts` centralizes auth/stub mode decisions and has unit coverage.
- Verification on 2026-05-02: `npm.cmd run lint` passed; targeted auth-mode test passed with escalation after sandbox `spawn EPERM`; full `npm.cmd test` passed with escalation (14 files passed, 1 skipped; 109 tests passed, 1 skipped); `npm.cmd run build` passed with escalation.

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

## Latest Tail Assignment Optimization MVP

- Added `TAIL_ASSIGNMENT_OPTIMIZED` as a recovery option type and wired it into `generateRecoveryOptions`.
- New `src/lib/engine/tail-assignment/` module implements the first production-shaped MVP from the Tail Assignment Optimization PDF: recovery-horizon network build, safe arc reduction, label-setting path generation, and bounded master path selection.
- AOG not-before constraints now apply only to the disrupted aircraft; if an impacted flight is reassigned to another tail, it can depart at its scheduled time when all connection constraints are met.
- `/dashboard/simulate` has a color mapping for the new option type and long option labels can wrap inside the badge.
- `src/lib/engine/__tests__/tail-assignment-optimizer.test.ts` covers arc reduction, network-level reassignment, and inclusion in ranked simulation output.
- Lint cleanup done while verifying: `scripts/parse-airport-utc.cjs` has a local CJS require lint disable, and simulate what-if ids are generated through a module-level helper to satisfy React purity lint.
- Verification on 2026-04-30: `npm.cmd run lint` passed; `npm.cmd test` passed with escalation (13 files, 101 tests); `npm.cmd run build` passed with escalation after sandbox `.next` unlink EPERM.

## Latest Tail Assignment Connection Fixing

- `optimizeTailAssignment` now runs an initial path/master pass, detects stable flight-to-flight connections across complete top solutions, locks those connections, and reruns path generation/master selection when it preserves the best known cost and does not increase path count.
- `src/lib/engine/tail-assignment/connection-fixing.ts` owns stable connection selection and arc filtering.
- Optimizer options now include connection-fixing metrics in reason codes when applied, and `TailAssignmentOptimizationResult.connectionFixing` exposes initial/final path and search-node counts.
- `src/lib/engine/__tests__/tail-assignment-optimizer.test.ts` now verifies that the stable `F1 -> F2` connection is locked before the second path search.
- `SimulationFeedback.tail_assignment` now carries structured optimizer diagnostics: horizon size, aircraft count, arc reduction, path count, master-search nodes, and connection-fixing before/after counts.
- `/dashboard/simulate` now shows a tail-assignment diagnostics panel using those structured metrics, including best optimized option rank when one is generated.
- UAT smoke now asserts those optimizer scale metrics on the checked-in 325-flight AIMS DayRep sample.
- `docs/UAT_REPORT_TEMPLATE.md` now gives testers fields to record the tail optimizer diagnostics during manual UAT.
- Verification on 2026-05-01: `npm.cmd run lint` passed; `npm.cmd test` passed with escalation after sandbox `spawn EPERM` (13 files, 102 tests); `npm.cmd run build` passed with escalation after sandbox `.next` unlink EPERM.

## Latest Tail Assignment Benchmark Harness And No-Option Diagnostics

- Added `npm.cmd run benchmark:tail`, backed by `scripts/run-tail-benchmark.cjs`.
- Added an opt-in Vitest benchmark at `src/lib/engine/__tests__/tail-assignment-benchmark.test.ts`; it is skipped during the normal suite unless `OCC_TAIL_BENCHMARK=1`. The npm runner sets this flag and accepts `OCC_TAIL_BENCHMARK_AIMS` / `OCC_TAIL_BENCHMARK_DISRUPTION` path overrides for real UAT files.
- The benchmark prints runtime, rank/score delta versus the best non-tail heuristic, horizon size, arc counts, path counts, search nodes, fixed-connection count, and no-option diagnostics for the checked-in AIMS DayRep fixture.
- Tail assignment feedback now includes `no_option_reason`, required/candidate-covered flight counts, complete-solution count, and top blocker reasons. `/dashboard/simulate` shows these when no optimized tail option is generated.
- Latest local benchmark on 2026-05-01: 325 schedule flights, 73 aircraft, 2 impacted flights, 6 ranked options, 329 ms runtime, 211 horizon flights, 59,713 original arcs, 3,945 reduced arcs, 93.0% arc reduction, 4,719 initial/final paths, 1 master-search node, 0 fixed connections. No `TAIL_ASSIGNMENT_OPTIMIZED` option was generated; candidate paths could cover 147/211 required horizon flights, with station continuity mismatch as the top actionable blocker.
- `docs/UAT_REPORT_TEMPLATE.md` now points testers to `npm.cmd run benchmark:tail` for the local sample benchmark table and documents the real-file path overrides.
- Verification on 2026-05-01: `npm.cmd run lint` passed; `npm.cmd test` passed with escalation after sandbox `spawn EPERM` (13 files passed, 1 skipped; 102 tests passed, 1 skipped); `npm.cmd run benchmark:tail` passed with escalation after sandbox `spawn EPERM`; `npm.cmd run build` passed with escalation.

## Latest Tail-Friendly UAT Fixture

- Added `public/uat/uat_tail_assignment_schedule.csv`, `public/uat/uat_tail_assignment_aircraft.csv`, and `public/uat/uat_scenario_tail_assignment.csv`.
- The fixture uses CSV schedule local-time semantics plus UTC disruption times correctly: the AOG on `TAIL-A` impacts `TAIL-F1`, while `TAIL-B` can cover `TAIL-A`'s protected SGN-HAN-HAN-SGN rotation and `TAIL-A` can absorb `TAIL-B`'s later SGN-DAD leg after release.
- `src/lib/engine/__tests__/uat-smoke.test.ts` now asserts the fixture generates `TAIL_ASSIGNMENT_OPTIMIZED` as rank #1, with `TAIL-F1 -> TAIL-B` and `TAIL-G1 -> TAIL-A`, and no no-option reason.
- `docs/UAT_PLAN.md` now has S8, a dedicated tail-assignment optimized recovery scenario. `docs/UAT_REPORT_TEMPLATE.md` includes S8 and tail rank/score-delta fields.
- `npm.cmd run benchmark:tail` now supports CSV benchmark inputs via `OCC_TAIL_BENCHMARK_SCHEDULE`, `OCC_TAIL_BENCHMARK_AIRCRAFT`, and `OCC_TAIL_BENCHMARK_DISRUPTION`, while keeping the AIMS workbook fallback.
- Latest CSV fixture benchmark: 5 flights, 3 aircraft, 1 impacted flight, 7 ranked options, 7 ms runtime, tail rank #1, tail score 318, best non-tail rank #2, best non-tail score 428, score delta -111, 35 original arcs -> 9 reduced arcs, 15 paths, 42 master-search nodes, 1 fixed connection.
- Verification on 2026-05-01: targeted UAT smoke passed (4 tests); `npm.cmd run lint` passed; `npm.cmd test` passed with escalation (13 files passed, 1 skipped; 103 tests passed, 1 skipped); CSV fixture benchmark passed; default AIMS benchmark passed; `npm.cmd run build` passed with escalation.

## Latest Tail Assignment Mode Controls

- Added `TailAssignmentMode` profiles: `fast`, `balanced`, and `deep`.
- `src/lib/engine/tail-assignment/config.ts` owns the profile configs. `balanced` preserves the previous defaults; `fast` uses a shorter horizon and lower path/search caps; `deep` uses a longer horizon and higher path/search caps.
- `runSimulation`, `runMultiEventSimulation`, and `generateRecoveryOptions` now accept optional `tailAssignmentMode`, defaulting to `balanced`.
- `/dashboard/simulate` now has a Fast/Balanced/Deep segmented control beside the Run button, and the tail diagnostics panel shows the mode used for the latest run.
- `npm.cmd run benchmark:tail` accepts `OCC_TAIL_BENCHMARK_MODE=fast|balanced|deep` and prints the selected mode in the metrics table.
- Test coverage now asserts the selected mode is reflected in `SimulationFeedback.tail_assignment.mode`.
- Latest CSV fixture deep-mode benchmark: 5 flights, 3 aircraft, 1 impacted flight, 7 ranked options, 11 ms runtime, tail rank #1, tail score 318, best non-tail score 428, score delta -111, 35 original arcs -> 9 reduced arcs, 15 paths, 42 master-search nodes, 1 fixed connection.
- Latest default AIMS benchmark after mode work: balanced mode, 325 schedule flights, 73 aircraft, 184 ms runtime, no tail option generated, candidate coverage 147/211, top blocker station continuity mismatch.
- Verification on 2026-05-01: `npm.cmd run lint` passed; `npm.cmd test` passed with escalation (13 files passed, 1 skipped; 104 tests passed, 1 skipped); CSV fixture benchmark in deep mode passed; default AIMS benchmark passed; `npm.cmd run build` passed with escalation.

## Latest Tail Assignment Ranking Explanation

- `src/lib/option-feedback.ts` now includes `getTailRankingExplanations`, which compares each `TAIL_ASSIGNMENT_OPTIMIZED` option against the best non-tail delay/swap heuristic.
- `/dashboard/simulate` shows the tail ranking summary in the ranked option row and the full explanation in option detail.
- The explanation states whether tail optimization wins, loses, or ties, then lists the biggest lower-cost drivers and tradeoffs from score breakdown components.
- Regression coverage in `src/lib/__tests__/option-feedback.test.ts` verifies both tail-win and tail-loss explanations.
- Verification on 2026-05-02: `npm.cmd run lint` passed; targeted option-feedback test passed with escalation after sandbox `spawn EPERM`; full `npm.cmd test` passed with escalation (13 files passed, 1 skipped; 106 tests passed, 1 skipped); `npm.cmd run build` passed with escalation.

## Latest S8 UAT Documentation Alignment

- `docs/UAT_PLAN.md` S8 now asks testers to verify the ranked-row/detail ranking explanation for the tail option, including score drivers and tradeoffs.
- `docs/UAT_REPORT_TEMPLATE.md` now captures whether the tail ranking explanation was observed and the key driver text.
- CSV S8 benchmark passed on 2026-05-02 with escalation after sandbox `spawn EPERM`: `UAT-TAIL-001`, balanced mode, 5 flights, 3 aircraft, 1 impacted flight, 7 ranked options, 15 ms runtime, tail rank #1, tail score 318, best non-tail score 428, score delta -111.
- Verification after docs update: `npm.cmd run lint` passed on 2026-05-02.

## Latest S8 Local Recheck

- Re-read the memory bank on 2026-05-02 to continue from the current handoff state.
- Browser plugin instructions were available, but the Node REPL browser-control tool was still not exposed in this Codex session, so full manual browser UAT remains blocked without a human/browser session.
- HTTP smoke against the existing dev server returned `/login` `200` and `/dashboard/simulate` `307` for a sessionless request, matching the Supabase auth gate.
- S8 CSV benchmark rerun first hit sandbox `spawn EPERM`, then passed with escalation: `UAT-TAIL-001`, balanced mode, 5 flights, 3 aircraft, 1 impacted flight, 7 ranked options, 8 ms runtime, tail rank #1, tail score 318, best non-tail rank #2, best non-tail score 428, score delta -111.

## Latest Manual UAT Status

- User reported on 2026-05-02 that manual browser testing passed and no further re-check prompt is needed.
- Treat S8 manual UAT as accepted for handoff purposes unless a later user report says otherwise.
- Next focus is production readiness: release checklist, Supabase/Vercel environment hardening, observability, rollback plan, and operational runbooks.

## Latest Production Readiness Docs

- Added `docs/PROD_READINESS.md` as the production release gate covering local verification, S8 benchmark, Supabase preflight, Vercel env configuration, production smoke, observability, rollback, and go/no-go criteria.
- Added `docs/PROD_RELEASE_NOTES_TEMPLATE.md` so each production deployment can record commit, deployment URL, benchmark output, smoke results, caveats, and rollback owner.
- Linked the production readiness checklist from `docs/DEPLOY_VERCEL.md` and `README.md`.
- Updated `docs/uat/README.md` to reference 8 UAT scenarios and the S8 tail-assignment fixture files.

## Latest PROD Verification Script

- Added `scripts/run-prod-verify.cjs` and `npm.cmd run verify:prod`.
- The script runs lint, unit/smoke tests, production build, and the deterministic S8 tail-assignment benchmark with the fixture env vars preconfigured.
- Updated `docs/PROD_READINESS.md` and `docs/PROD_RELEASE_NOTES_TEMPLATE.md` to use `npm.cmd run verify:prod`.
- Verification on 2026-05-02: first sandbox run passed lint but hit Vitest `spawn EPERM`; rerun with escalation passed all 4 steps. Final result: 13 test files passed, 1 benchmark file skipped in the normal suite; 106 tests passed, 1 skipped; production build passed; S8 benchmark passed with 8 ms runtime, tail rank #1, tail score 318, best non-tail score 428, score delta -111.

## Latest Passenger Impact MVP

- Added `src/lib/engine/passenger-impact.ts` to estimate affected passengers, passenger-delay minutes, misconnect-risk passengers, priority passenger score, and top passenger-impact flights for each recovery option.
- `FlightLeg` now supports optional passenger fields: `seat_capacity`, `booked_passengers`, `connecting_passengers`, `vip_passengers`, and `special_service_passengers`.
- `RecoveryOption` now carries optional `passenger_impact`.
- `option-scorer` now adds `passenger_delay_component`, `passenger_priority_component`, and `misconnect_risk_component` to score breakdowns.
- Rules YAML now includes optional `passenger_rules` plus passenger scoring weights. Existing rules remain compatible because passenger rules/weights are optional and the scorer has defaults.
- `/dashboard/simulate` now shows estimated affected pax in ranked rows and a passenger-impact panel in option detail with affected pax, pax-delay minutes, misconnect risk, priority score, and top impacted flights.
- Verification on 2026-05-02: `npm.cmd run lint` passed; targeted passenger/rules tests passed with escalation after sandbox `spawn EPERM`; full `npm.cmd test` passed with escalation (15 files passed, 1 skipped; 112 tests passed, 1 skipped); `npm.cmd run build` passed with escalation.

## Latest Passenger Import Persistence

- CSV schedule import now parses optional passenger fields: `seat_capacity`, `booked_passengers`, `connecting_passengers`, `vip_passengers`, and `special_service_passengers`.
- Invalid optional passenger values warn and are ignored instead of dropping otherwise valid schedule rows.
- AIMS DayRep import now reads passenger fields when extended exports include known aliases such as `SEATS`, `PAX`, `CONN PAX`, `VIP`, and `SSR`.
- `persistSchedule` now writes passenger fields to Supabase, and `loadOperationalData` hydrates them back into `FlightLeg`.
- Added `supabase/migrations/0005_passenger_fields.sql` with nullable non-negative passenger columns on `public.flights`.
- Schedule sample/template CSVs now include passenger columns, and deployment/UAT docs now tell operators to apply migrations through `0005_passenger_fields.sql`.
- UAT preflight now checks the passenger columns exist.
- Verification on 2026-05-02: targeted parser tests first hit sandbox `spawn EPERM`, then passed with escalation (2 files, 31 tests); `npm.cmd run lint` passed; full `npm.cmd test` first hit sandbox `spawn EPERM`, then passed with escalation (15 files passed, 1 skipped; 115 tests passed, 1 skipped); `npm.cmd run build` first hit sandbox `.next` unlink `EPERM`, then passed with escalation after a TypeScript alias-set fix.

## Latest Production Release Notes Draft

- Added `docs/PROD_RELEASE_NOTES_DRAFT_2026-05-02.md`.
- The draft records local branch `bootstrap-main`, base commit `4cf6e1dc321e3506b59401dc05d5e2a6bfe71eaf`, current verification results, S8 manual UAT acceptance, and the latest S8 benchmark.
- Real deployment fields remain `TBD`: release tag, Vercel deployment URL, Supabase project, release owner, rollback owner, Supabase preflight result, production smoke results, previous known-good deployment, and Supabase backup timestamp.
- Earlier S8 benchmark rerun on 2026-05-02 first hit sandbox `spawn EPERM`, then passed with escalation: `UAT-TAIL-001`, balanced mode, 5 flights, 3 aircraft, 1 impacted flight, 7 ranked options, 6 ms runtime, tail rank #1, tail score 2387, best non-tail rank #3, best non-tail score 15521, score delta -13134. Scores are higher than pre-passenger-import notes because passenger scoring is now included; the 2026-05-03 production gate recheck below has the current release-draft values.

## Latest Import Quality Report

- `validateDataset` now warns when passenger counts are internally inconsistent: booked passengers exceed seat capacity, connecting/VIP/special-service passenger counts exceed booked passengers, or booked/capacity implies a load factor that differs from `load_factor` by more than 15 percentage points.
- Added `summarizeScheduleQuality` to report passenger coverage, missing passenger data, fallback rows that will use load factor, and per-field passenger counts.
- `/dashboard/data` now shows an import quality report after schedule load and expands the schedule preview with `pax`, `conn`, and `VIP/SSR` columns.
- These warnings do not block Save to Supabase; parser errors and cross-dataset errors still do.
- Verification on 2026-05-02: targeted CSV parser test first hit sandbox `spawn EPERM`, then passed with escalation (23 tests); `npm.cmd run lint` passed; full `npm.cmd test` first hit sandbox `spawn EPERM`, then passed with escalation (15 files passed, 1 skipped; 118 tests passed, 1 skipped); `npm.cmd run build` first hit sandbox `.next` unlink `EPERM`, then passed with escalation.

## Latest Swap-Chain Visibility Fix

- `/dashboard/simulate` now labels option detail as `Flight impact plan` and, for `SWAP_CHAIN`, renders a third `Other affected flights` group for impacted flights not included in the primary swap or displaced-coverage groups. This keeps the displayed tables aligned with the full `option.flight_changes` count.
- Verification on 2026-05-02: `npm.cmd run lint` passed with the existing unused `createPartialSwapHybrid` warning; targeted swap-chain engine test first hit sandbox `spawn EPERM`, then passed with escalation.

## Latest Multi-Event Delay Window Fix

- `ImpactedFlight` now carries an optional event-specific `blocking_end_time`, so multi-event recovery can delay each flight from the event that actually affected it instead of the latest end time across all events.
- AOG and airport/weather direct impacts set `blocking_end_time` to that event's end. Downstream rotation impacts use `null`, which means they are tracked for propagation but are not independently forced to wait until the combined multi-event end.
- `simulateDelayOnly`, `simulateSpreadDelay`, `simulateDeepDelay`, and tail-assignment path labeling now use the per-flight block end where available.
- Added a regression test for AOG 17:00-23:50 plus weather 16:00-17:00, asserting the weather flight does not get delayed until the AOG clears.
- Verification on 2026-05-02: `npm.cmd run lint` passed with the existing unused `createPartialSwapHybrid` warning; targeted regression passed with escalation after sandbox `spawn EPERM`; `npm.cmd test -- src/lib/engine/__tests__/engine.test.ts src/lib/engine/__tests__/tail-assignment-optimizer.test.ts` passed with escalation, 28 tests.

## Latest Crew-Continuity Swap Constraint

- `FlightLeg` now supports optional `captain` and `first_officer` fields, parsed from CSV columns `captain` / `first_officer` and extended AIMS aliases such as `CAPT`, `CAPTAIN`, `FO`, and `FIRST OFFICER`.
- `SINGLE_SWAP` and `SWAP_CHAIN` cluster generation now rejects a downstream/displaced cluster when any crew data is present but CAPT+FO are not the same across every leg in that cluster. This prevents recommending split rotations when the crew pairing would not stay together.
- Supabase persistence/load now round-trips `captain` and `first_officer`; added `supabase/migrations/0006_crew_fields.sql`, updated sample/template CSVs, deployment/UAT docs, and UAT preflight checks to require migrations through 0006.
- Verification on 2026-05-02: `npm.cmd run lint` passed with the existing unused `createPartialSwapHybrid` warning; targeted crew parser/engine tests passed with escalation after sandbox `spawn EPERM`; `npm.cmd test -- src/lib/engine/__tests__/engine.test.ts src/lib/parsers/__tests__/csv.test.ts` passed with escalation, 48 tests; `npm.cmd run build` passed with escalation after sandbox `.next` unlink `EPERM`.

## Latest Aircraft Recovery Multi-Objective Optimizer

- The existing tail-assignment path/master optimizer now runs multiple aircraft-recovery objective profiles: `balanced`, `min_delay`, `min_swap`, `risk_averse`, and `protect_priority`.
- Each optimized option includes a reason code naming the profile, and duplicate optimized solutions are deduped before ranking so OCC sees a broader aircraft-recovery tradeoff set without repeated identical plans.
- `/dashboard/simulate` now labels the diagnostics panel as `Aircraft recovery optimization` while preserving the existing `TAIL_ASSIGNMENT_OPTIMIZED` option type for compatibility.
- Verification on 2026-05-02: `npm.cmd run lint` passed with the existing unused `createPartialSwapHybrid` warning; `npm.cmd test -- src/lib/engine/__tests__/engine.test.ts src/lib/engine/__tests__/tail-assignment-optimizer.test.ts src/lib/engine/__tests__/uat-smoke.test.ts` passed with escalation, 34 tests; `npm.cmd run build` passed with escalation; default AIMS benchmark passed at 807 ms; S8 CSV benchmark passed at 11 ms with optimized option rank #1 and score delta -20828 versus best heuristic.

## Latest ATA Completion And AOG Airport Filter

- `FlightLeg` now supports optional `actual_departure_time` and `actual_arrival_time`; CSV, AIMS DayRep, Supabase persistence/load, sample data, UAT preflight, and deployment docs now include these fields through `supabase/migrations/0007_actual_times.sql`.
- `actual_departure_time` / ATD and `actual_arrival_time` / ATA mark a flight as already operated for recovery calculations. Operated flights are excluded from direct event impact detection, downstream delay propagation, downstream swap rotations, and the tail-assignment recovery horizon.
- AOG direct impact detection now respects the selected `affected_airport`: when an AOG event names an airport, only flights touching that airport by origin or destination can be directly impacted by that AOG. Unrelated-airport flights are no longer pulled in by time overlap alone.
- Verification on 2026-05-02: `npm.cmd run lint` passed with the existing unused `createPartialSwapHybrid` warning; targeted ATA/AOG airport/parser tests passed with escalation after sandbox `spawn EPERM`; broader engine/tail/parser/UAT tests passed with escalation, 62 tests; `npm.cmd run build` passed with escalation after sandbox `.next` unlink `EPERM`; `npm.cmd run benchmark:tail` passed with escalation after sandbox `spawn EPERM`.
- ATD follow-up verification on 2026-05-02: targeted impact/tail/parser tests passed with escalation, 60 tests; `npm.cmd run build` passed with escalation after sandbox `.next` unlink `EPERM`.

## Latest Production Gate Recheck

- Continued from the production-readiness handoff on 2026-05-03.
- First sandbox `npm.cmd run verify:prod` rerun still hit Vitest `spawn EPERM`; rerun with escalation reached the real suite and exposed one stale upgrade-verification assertion for `DEEP_DELAY`.
- `simulateDeepDelay` now always marks the selected low-priority/low-load flight with `Deep-delay selected low-priority flight`, even when baseline delay propagation is already larger than the deep-delay floor. Its risk level now reflects the actual selected delay after propagation.
- `src/lib/engine/__tests__/upgrade-verification.test.ts` now verifies that selected flight marker while allowing `DEEP_DELAY` to retain the full flight impact plan.
- Removed the unused `createPartialSwapHybrid` helper and stale partial-swap test comments, clearing the existing lint warning.
- Targeted verification passed on 2026-05-03 with escalation: upgrade-verification test, then engine/tail/UAT/upgrade regression run with 4 files and 47 tests.
- Final `npm.cmd run verify:prod` passed on 2026-05-03 with escalation: lint clean, 15 test files passed plus 1 skipped benchmark file, 131 tests passed plus 1 skipped, production build passed, and S8 benchmark passed.
- Latest S8 benchmark in that final verify: `UAT-TAIL-001`, balanced mode, 5 flights, 3 aircraft, 1 impacted flight, 7 ranked options, 19 ms runtime, tail rank #1, tail score 2387, best non-tail rank #3, best non-tail score 23215, score delta -20828, 35 -> 9 arcs, 15 paths, 42 search nodes, 1 fixed connection.
- `docs/PROD_RELEASE_NOTES_DRAFT_2026-05-02.md` was refreshed with the 2026-05-03 local verification and benchmark values. Target-environment fields remain `TBD`.
- Follow-up docs alignment on 2026-05-03 updated `docs/PROD_READINESS.md` so the expected S8 benchmark shape matches the current passenger-scored release candidate instead of the old pre-passenger scores. `docs/PROD_RELEASE_NOTES_TEMPLATE.md` now includes the same benchmark detail fields as the draft: best non-tail rank, horizon size, arc reduction, paths/search nodes, fixed connections, no-option reason, and top blocker diagnostic.

Verification after this alignment pass:

- `npm.cmd run lint` passed on 2026-04-30.
- `npm.cmd test` passed on 2026-04-30 with escalation: 13 files, 101 tests.
- `npm.cmd run build` passed on 2026-04-30 with escalation.
- `npm.cmd run lint` passed on 2026-05-01.
- `npm.cmd test` passed on 2026-05-01 with escalation: 13 files, 102 tests.
- `npm.cmd run build` passed on 2026-05-01 with escalation.
- `npm.cmd run lint` passed on 2026-05-02.
- `npm.cmd test` passed on 2026-05-02 with escalation: 13 files passed, 1 skipped; 106 tests passed, 1 skipped.
- `npm.cmd run build` passed on 2026-05-02 with escalation.
- `npm.cmd run benchmark:tail` for the S8 CSV fixture passed on 2026-05-02 with escalation.
- `npm.cmd run verify:prod` passed on 2026-05-02 with escalation.
- Auth/login hardening verification passed on 2026-05-02: lint, targeted auth test, full test, and build.
- Passenger impact MVP verification passed on 2026-05-02: lint, targeted tests, full test, and build.
- Passenger import persistence verification passed on 2026-05-02: lint, targeted parser tests, full test, and build.
- Production release notes draft created on 2026-05-02 and S8 benchmark rerun passed with escalation.
- Import quality report verification passed on 2026-05-02: lint, targeted parser test, full test, and build.
- Production gate recheck passed on 2026-05-03: `npm.cmd run verify:prod` with escalation; lint clean, 15 test files passed plus 1 skipped benchmark file, 131 tests passed plus 1 skipped, build passed, S8 benchmark passed.

## Next Coding Task

Tail assignment optimization MVP is now in the engine pipeline and S8 manual UAT has been accepted. Suggested next work:

1. Run the production readiness checklist for the target Supabase/Vercel environment.
2. Fill in the remaining production release note placeholders once the target Vercel/Supabase environment, release owner, rollback owner, smoke result, and backup timestamp are known.
3. Add a time-budget/worker-ready guard only if real PROD-like AIMS exports show UI stalls.
