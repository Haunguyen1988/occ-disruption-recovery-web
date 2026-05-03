# Improvement Plan

Last updated: 2026-05-03

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

## Phase 5: Tail Assignment Optimization

Priority: high

1. Done 2026-04-30: add MVP tail-assignment optimizer.
   - Build recovery-horizon aircraft/flight network.
   - Apply safe arc reduction before path generation.
   - Generate feasible aircraft paths with label-setting and dominance-style path limiting.
   - Select one path per aircraft with a bounded master search so recovery-horizon flights are covered once.
   - Emit `TAIL_ASSIGNMENT_OPTIMIZED` recovery options with reason-code diagnostics.
   - Acceptance: optimizer options obey station continuity, turnaround, type compatibility, maintenance buffer, and AOG not-before semantics.

2. Done initial pass 2026-05-01: add connection fixing.
   - Detect stable high-confidence flight-to-flight connections from the best generated solutions.
   - Lock selected connections and rerun path generation/master selection.
   - Acceptance: fewer candidate paths are needed on larger AIMS exports without losing feasible high-quality options.
   - Done so far: optimizer locks connections that appear across complete top solutions, reruns path/master search only when best known cost is preserved and path count does not increase, and reports initial/final path and search-node metrics through `SimulationFeedback.tail_assignment`.

3. Done initial pass 2026-05-01: expose optimizer diagnostics for UAT.
   - Add a Simulate-page diagnostics panel for horizon size, arc reduction, path counts, master-search nodes, and connection fixing.
   - Add AIMS DayRep smoke assertions so the 325-flight fixture exercises the structured metrics.
   - Add UAT report fields so testers can capture those numbers manually.
   - Acceptance: operators can see optimizer scale/risk indicators without reading long reason-code strings.

4. Initial harness done 2026-05-01: benchmark with real AIMS scale.
   - Capture arc counts, path counts, search nodes, runtime, and score delta versus existing heuristics.
   - Acceptance: UI remains responsive for realistic DayRep-sized imports, or the optimizer moves behind a Web Worker/time budget.
   - Done so far: `npm.cmd run benchmark:tail` runs an opt-in Vitest benchmark against the checked-in 325-flight AIMS DayRep fixture and prints runtime, rank/score delta, arc/path/search-node metrics, connection-fixing counts, and no-option diagnostics. `OCC_TAIL_BENCHMARK_AIMS` and `OCC_TAIL_BENCHMARK_DISRUPTION` can point it at real local files. Latest local run took 329 ms and reduced 59,713 arcs to 3,945; the checked-in AOG fixture did not produce a tail-optimized option, and diagnostics show candidate paths can cover 147/211 required horizon flights with station continuity mismatch as the top blocker.

5. Done initial pass 2026-05-01: explain no-option tail-assignment outcomes.
   - Add `no_option_reason`, required/candidate-covered flight counts, complete-solution count, and top actionable blocker reasons to `SimulationFeedback.tail_assignment`.
   - Show the no-option explanation on `/dashboard/simulate`.
   - Acceptance: when no tail option is generated, operators see whether the issue is incomplete coverage, no eligible horizon data, or no meaningful changes.

6. Done initial pass 2026-05-01: add a tail-friendly UAT fixture.
   - Add schedule, aircraft, and disruption CSV fixtures under `public/uat`.
   - Add automated smoke coverage proving `TAIL_ASSIGNMENT_OPTIMIZED` is generated and ranked #1.
   - Add UAT S8 plus report fields for tail option rank and score delta.
   - Acceptance: testers can run a small deterministic scenario where tail optimization appears and beats the best non-tail heuristic.
   - Latest fixture benchmark: 5 flights, 3 aircraft, 7 ms runtime, tail rank #1, score 318 vs best non-tail score 428, score delta -111, 35 -> 9 arcs, 15 paths, 42 master-search nodes, 1 fixed connection.

7. Done initial pass 2026-05-01: add operator optimization modes.
   - Add `fast`, `balanced`, and `deep` tail-assignment profiles.
   - Wire optional `tailAssignmentMode` through engine APIs, Simulate UI, feedback diagnostics, and benchmark env.
   - Acceptance: operators can trade speed/search depth without changing YAML rules, and benchmark output records the selected mode.
   - Latest fixture deep-mode benchmark: 11 ms runtime, tail rank #1, score 318 vs best non-tail score 428, score delta -111.

8. Done initial pass 2026-05-02: add tail ranking explanations.
   - Compare each `TAIL_ASSIGNMENT_OPTIMIZED` option against the best non-tail delay/swap heuristic.
   - Show whether the optimized option wins, loses, or ties, plus the biggest score-breakdown drivers and tradeoffs.
   - Acceptance: operators can understand why tail optimization ranked above or below delay/swap options without manually comparing score tables.
   - UAT docs now ask testers to verify and record the explanation in S8.
   - Verification: `npm.cmd run lint`, `npm.cmd test`, `npm.cmd run build`, and the S8 CSV `npm.cmd run benchmark:tail` pass ran on 2026-05-02.

## Suggested Work Order

1. Done: P1 `SINGLE_SWAP` fix plus tests.
2. Done initial pass: default rules consolidation, YAML error UI, preview pagination, Gantt horizontal scroll.
3. Done: P2 approval safety plus tests and migration.
4. Done: P2 Supabase error surfacing.
5. Done: font offline build.
6. Done: add automated UAT smoke coverage for checked-in UAT fixtures and AIMS sample.
7. Done: tail-assignment optimization MVP wired into recovery options.
8. Done initial pass: connection fixing for `TAIL_ASSIGNMENT_OPTIMIZED`.
9. Done initial pass: structured optimizer diagnostics in simulation feedback and UI.
10. Done initial pass: no-option diagnostics for `TAIL_ASSIGNMENT_OPTIMIZED`.
11. Done initial pass: tail-friendly UAT fixture/scenario that generates `TAIL_ASSIGNMENT_OPTIMIZED`.
12. Done initial pass: operator optimization modes (`Fast`, `Balanced`, `Deep`).
13. Done initial pass: ranking explanations for why tail options win or lose.
14. Done initial pass: passenger fields flow from CSV/extended AIMS imports through Supabase persistence.
15. Done initial pass: production release notes draft captures local verification and the latest S8 benchmark, with target-environment placeholders.
16. Done initial pass: import quality report surfaces passenger coverage/fallback metrics and warns on inconsistent passenger counts.
17. Done 2026-05-03: local production gate rechecked with `npm.cmd run verify:prod`; lint, tests, build, and S8 benchmark passed.
18. Done 2026-05-03: production readiness docs and release-notes template now match the current passenger-scored S8 benchmark output.
19. Next: run production readiness against the target environment and real-data benchmarks before deciding on Web Worker support or deeper pruning.

Documentation follow-up done 2026-04-30: README, Vercel deployment, and UAT pre-flight docs now reference migrations through `0003_approval_safety.sql` and no longer require `SUPABASE_SERVICE_ROLE_KEY`.
