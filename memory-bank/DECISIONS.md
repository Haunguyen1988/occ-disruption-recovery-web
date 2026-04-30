# Decisions

Last updated: 2026-04-29

## Durable Memory Location

Use `memory-bank/` for project memory that should survive future sessions and be committed with the repo.

Do not use `.brain/` as the source of truth. It appears to be local session state and is ignored by git.

## Review Outcome

The review produced a prioritized improvement backlog and this memory bank.

The first code fix completed from that backlog was the P1 `SINGLE_SWAP` downstream feasibility fix. `SINGLE_SWAP` now validates the candidate aircraft timeline across the full downstream rotation before generating a swap option.

The first Phase 2 runtime pass completed on 2026-04-29. It favored low-risk client improvements over adding a Web Worker: centralized rules defaults, visible YAML validation, last-valid rules behavior, paginated import previews, and stable Gantt horizontal scroll.

The approval-safety fix completed on 2026-04-29. The app now uses a Supabase RPC (`approve_recovery_option`) for the clear-and-approve operation, plus a partial unique index to prevent more than one approved option per simulation.

The Supabase load-error surfacing fix completed on 2026-04-29. Operational data load now returns an explicit `{ data, error }` result, and dashboard layout shows a visible banner for failed Supabase queries.

The font build fix completed on 2026-04-29. The app uses system font stacks instead of `next/font/google`, removing the build-time fetch to Google Fonts.

## Verification Baseline

Current baseline is green:

- lint passes;
- unit tests pass, 73 tests as of 2026-04-29;
- production build passes.

Any future fix should keep this baseline green and add targeted tests for changed behavior.
