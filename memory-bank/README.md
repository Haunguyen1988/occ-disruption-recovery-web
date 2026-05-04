# Memory Bank

Last updated: 2026-05-04

This folder is the project handoff state for future Codex sessions. Start here before changing code.

## Current State

- App: OCC Disruption Recovery web MVP for small airline OCC demo.
- Stack: Next.js 16 App Router, React 19, Tailwind v4, Supabase SSR, TypeScript, Vitest.
- Core behavior: load schedule/aircraft/disruption data, run recovery simulations, compare options, save/audit via Supabase when configured.
- Stub mode works without Supabase and auto-loads AOG sample data.
- Git worktree before this memory-bank update already had `package-lock.json` modified and `.brain/` untracked. Do not revert those unless the user asks.

## Latest Verification

Latest release-gate recheck on 2026-05-03:

- `npm.cmd run verify:prod`: passed with escalation after an initial sandbox Vitest `spawn EPERM`. It ran lint, the normal test suite, production build, and deterministic S8 benchmark.
- Lint was clean with no warnings after removing the unused `createPartialSwapHybrid` helper.
- Normal tests passed: 15 test files passed plus 1 skipped opt-in benchmark file; 131 tests passed and 1 benchmark test skipped.
- Production build passed.
- S8 benchmark result: `UAT-TAIL-001`, balanced mode, 5 flights, 3 aircraft, 1 impacted flight, 7 ranked options, 19 ms runtime, tail rank #1, tail score 2387, best non-tail rank #3, best non-tail score 23215, score delta -20828, 35 -> 9 arcs, 15 paths, 42 search nodes, 1 fixed connection.
- Before the final pass, a stale `DEEP_DELAY` upgrade-verification assertion was fixed. `DEEP_DELAY` now marks the selected low-priority flight while still carrying the full flight impact plan.
- Production readiness docs now use the current passenger-scored S8 benchmark values, and the release-notes template captures the full optimizer diagnostics printed by the benchmark.
- Upload/simulate recheck on 2026-05-04: CSV/XLSX upload now normalizes common exported headers such as `Flight ID`, trims/BOM-strips columns, and `/dashboard/simulate` surfaces parser/cross-dataset issues and blocks simulation while import errors remain. Verification: `npm.cmd run lint` passed, targeted CSV parser test passed with escalation after sandbox `spawn EPERM`, and `npm.cmd run build` passed with escalation after sandbox `.next` unlink `EPERM`.

Earlier commands run on 2026-05-02 after the tail-assignment ranking explanation and S8 UAT-doc alignment pass:

- `npm.cmd run lint`: passed.
- `npm.cmd test`: passed with escalation, 13 test files plus 1 skipped opt-in benchmark file; 106 tests passed and 1 benchmark test skipped. A targeted test run first hit sandbox `spawn EPERM`; rerun with escalation passed.
- `npm.cmd run build`: passed with escalation.
- `npm.cmd run benchmark:tail` with the S8 CSV fixture passed with escalation after sandbox `spawn EPERM`: `UAT-TAIL-001`, balanced mode, 5 flights, 3 aircraft, 1 impacted flight, 7 ranked options, 15 ms runtime, tail rank #1, tail score 318, best non-tail score 428, score delta -111.
- Recheck on 2026-05-02: S8 CSV `npm.cmd run benchmark:tail` again needed escalation after sandbox `spawn EPERM` and passed in 8 ms with tail rank #1, tail score 318, best non-tail score 428, score delta -111. HTTP smoke returned `/login` `200` and sessionless `/dashboard/simulate` `307` to login.
- User reported on 2026-05-02 that manual browser testing passed; do not ask to repeat S8 manual UAT unless new evidence appears.
- `npm.cmd run verify:prod`: passed with escalation on 2026-05-02 after sandbox Vitest `spawn EPERM`; it ran lint, tests, production build, and S8 benchmark. S8 benchmark result: 8 ms runtime, tail rank #1, tail score 318, best non-tail score 428, score delta -111.
- Previous `npm.cmd run benchmark:tail`: passed with escalation after sandbox `spawn EPERM`; checked-in AIMS DayRep sample measured 329 ms runtime, 59,713 -> 3,945 arcs, 4,719 final paths, and no generated tail-optimized option for the sample AOG fixture. No-option diagnostics show candidate paths can cover 147/211 horizon flights, with station continuity mismatch as the top blocker.

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
14. Updated on 2026-05-01: tail-assignment optimization now applies a guarded connection-fixing pass that locks stable flight-to-flight links across top complete solutions, reruns path/master search, and reports initial/final optimizer metrics.
15. Updated on 2026-05-01: tail-assignment optimizer diagnostics are now structured in `SimulationFeedback.tail_assignment`, shown on `/dashboard/simulate`, covered by AIMS UAT smoke assertions, and listed in the UAT report template.
16. Updated on 2026-05-01: `npm.cmd run benchmark:tail` now runs an opt-in benchmark and prints tail optimizer runtime/rank/arc/path/search-node metrics for the checked-in AIMS DayRep fixture; `OCC_TAIL_BENCHMARK_AIMS` and `OCC_TAIL_BENCHMARK_DISRUPTION` can point it at real local files.
17. Updated on 2026-05-01: tail-assignment feedback and `/dashboard/simulate` now explain no-option outcomes with a reason, candidate-covered versus required horizon flights, complete-solution count, and top blocker reasons.
18. Updated on 2026-05-01: `public/uat/uat_tail_assignment_*` fixtures and `uat_scenario_tail_assignment.csv` now provide a small deterministic S8 UAT scenario where `TAIL_ASSIGNMENT_OPTIMIZED` ranks #1 and beats the best non-tail heuristic by 111 score points.
19. Updated on 2026-05-01: tail assignment now supports `Fast`, `Balanced`, and `Deep` modes in the engine, Simulate UI, diagnostics, and `benchmark:tail` via `OCC_TAIL_BENCHMARK_MODE`.
20. Updated on 2026-05-02: `/dashboard/simulate` now explains why each `TAIL_ASSIGNMENT_OPTIMIZED` option wins, loses, or ties against the best delay/swap heuristic, including score-breakdown drivers and tradeoffs.
21. Updated on 2026-05-02: S8 UAT docs and the report template now ask testers to verify and record the tail ranking explanation.
22. Updated on 2026-05-02: user reported manual browser UAT passed; next work should shift to production readiness rather than asking for another S8 manual run.
23. Updated on 2026-05-02: added `docs/PROD_READINESS.md` and `docs/PROD_RELEASE_NOTES_TEMPLATE.md`, and linked the readiness checklist from Vercel deploy docs and README.
24. Updated on 2026-05-02: updated `docs/uat/README.md` to reference 8 UAT scenarios and the S8 tail-assignment fixture files.
25. Updated on 2026-05-02: added `npm.cmd run verify:prod`, backed by `scripts/run-prod-verify.cjs`, and verified it passes with escalation.
26. Updated on 2026-05-02: hardened login/dashboard access for production. Production now fails closed when Supabase env vars are missing, the landing page routes auth-required users to `/login`, and stub dashboard access is only available outside production by default or via explicit `NEXT_PUBLIC_ALLOW_STUB_MODE=1`.
27. Updated on 2026-05-02: added passenger impact MVP. The scorer now estimates affected pax, pax-delay minutes, misconnect risk, priority passenger score, and top passenger-impact flights; `/dashboard/simulate` surfaces the metrics in ranked rows and option detail.
28. Updated on 2026-05-02: CSV and extended AIMS imports now populate optional passenger fields, Supabase persistence/load round-trips those fields via `0005_passenger_fields.sql`, and UAT/deploy docs now point migrations through 0005.
29. Updated on 2026-05-02: added `docs/PROD_RELEASE_NOTES_DRAFT_2026-05-02.md` with local verification, S8 manual UAT acceptance, the latest passenger-scored S8 benchmark, and placeholders for real Vercel/Supabase release details.
30. Updated on 2026-05-02: `/dashboard/data` now shows an import quality report with passenger coverage/fallback metrics and passenger preview columns; dataset validation warns on inconsistent passenger counts and load-factor mismatches.
31. Updated on 2026-05-03: `DEEP_DELAY` now marks the selected low-priority flight even when propagation already imposes a larger delay, and the upgrade-verification test now checks that marker instead of assuming only one flight change.
32. Updated on 2026-05-03: the unused `createPartialSwapHybrid` helper was removed and lint is clean for the production gate.
33. Updated on 2026-05-03: `docs/PROD_READINESS.md` and `docs/PROD_RELEASE_NOTES_TEMPLATE.md` were aligned with the latest passenger-scored S8 benchmark and optimizer diagnostic fields.

## Recommended Next Step

All four original review findings are addressed. Recommended next step:

- Run the target-environment parts of `docs/PROD_READINESS.md` for Supabase/Vercel.
- Fill in the remaining `docs/PROD_RELEASE_NOTES_DRAFT_2026-05-02.md` placeholders after the target deployment, Supabase preflight, production smoke, owners, and backup timestamp are known.
- Continue deeper large-data optimization only if real PROD-like AIMS exports still feel slow.
