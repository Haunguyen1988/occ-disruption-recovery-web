# Improvement Plan

Last updated: 2026-04-30

Goal: make the existing app smoother, safer, and easier to operate without changing its core MVP shape.

## Phase 1: Correctness And Safety

Priority: highest

1. Done 2026-04-29: fix `SINGLE_SWAP` downstream feasibility.
   - Add helpers that validate candidate aircraft assignments by time overlap, station continuity, and turnaround.
   - Skip or downgrade swap options that cannot cover downstream rotation safely.
   - Add tests for target-leg feasible but downstream-conflicting candidates.
   - Acceptance: no generated swap option assigns an aircraft to overlapping legs or impossible stations.

2. Done 2026-04-29: make approval update safe.
   - Verify target option exists before clearing previous approval.
   - Prefer an RPC/transaction for "clear previous then approve selected".
   - Return failure if zero rows are updated.
   - Acceptance: stale option id cannot clear current approval and cannot produce a false audit entry.

3. Done 2026-04-29: surface Supabase load failures.
   - Capture `error` from flights, aircraft, and disruption queries.
   - Return an explicit load error state to dashboard layout/provider.
   - Show actionable UI message instead of empty data.
   - Acceptance: RLS/schema/network failures are visible to the user and logs.

## Phase 2: Runtime Smoothness

Priority: high

1. Partially done 2026-04-29: reduce heavy client work on large datasets.
   - Memoize derived indexes by aircraft and flight id.
   - Consider moving simulation to a Web Worker if AIMS files become large.
   - Acceptance: importing and simulating a full DayRep does not freeze the UI.
   - Done so far: rules are no longer reparsed on every provider render; schedule/aircraft previews render one page at a time; engine simulation now builds one schedule index per run and reuses it across impact detection, delay simulation, candidate finding, and option generation.

2. Done initial pass 2026-04-29: improve large table/timeline rendering.
   - Add pagination or virtualization for schedule previews.
   - Keep Gantt rows stable with fixed row height and horizontal scrolling.
   - Acceptance: large schedule pages remain scrollable and responsive.

3. Done initial pass 2026-04-29: avoid repeated rule parsing.
   - Keep one default rules source.
   - Validate YAML with user-facing parser errors instead of silently falling back.
   - Acceptance: invalid rules are visible and cannot quietly change engine results.

## Phase 3: Deployability

Priority: medium

1. Done 2026-04-29: remove build-time network dependency for fonts.
   - Vendor fonts and switch to `next/font/local`, or accept system fonts.
   - Acceptance: `npm.cmd run build` works without network.

2. Harden CI.
   - Add a regression test for each review finding as it is fixed.
   - Keep `npm ci`, lint, test, and build as required gates.
   - Acceptance: CI catches the known failure modes before merge.
   - Done so far: unit/regression coverage exists for the review findings, and `src/lib/engine/__tests__/uat-smoke.test.ts` exercises the checked-in UAT CSVs plus the AIMS DayRep sample.

## Phase 4: OCC Operator Experience

Priority: medium

1. Improve simulation feedback.
   - Show when no feasible swap exists and why.
   - Show risky options with constraint reasons near the recommendation.
   - Acceptance: controller can understand why an option was rejected or ranked lower.
   - Done 2026-04-30: simulation results now include single-swap feasibility diagnostics, the simulate page shows blocked candidate reasons, and ranked options surface compact risk/penalty watchouts near the recommendation.

2. Persist compare inputs.
   - Use saved simulation details when available instead of only `sessionStorage`.
   - Acceptance: compare view can survive refresh when launched from a saved simulation.
   - Done 2026-04-30: `/dashboard/compare` now reloads from saved-simulation query params (`simulation`, `a`, `b`) when available, while preserving the old `sessionStorage` fallback for unsaved local compares.

3. Improve audit drilldown.
   - Add a route for saved simulation detail.
   - Acceptance: audit users can inspect old options without rerunning the simulation.
   - Done 2026-04-30: `/dashboard/audit/[uuid]` now shows saved simulation detail, approved-option metadata, related audit rows, and saved option changes. The audit list also supports text filtering and shows UTC ISO timestamps.

## Suggested Work Order

1. Done: P1 `SINGLE_SWAP` fix plus tests.
2. Done initial pass: default rules consolidation, YAML error UI, preview pagination, Gantt horizontal scroll.
3. Done: P2 approval safety plus tests and migration.
4. Done: P2 Supabase error surfacing.
5. Done: font offline build.
6. Done: add automated UAT smoke coverage for checked-in UAT fixtures and AIMS sample.
7. Next optional: run browser UAT and deeper large-data worker/index optimization if real AIMS files still feel slow.

Documentation follow-up done 2026-04-30: README, Vercel deployment, and UAT pre-flight docs now reference migrations through `0003_approval_safety.sql` and no longer require `SUPABASE_SERVICE_ROLE_KEY`.
