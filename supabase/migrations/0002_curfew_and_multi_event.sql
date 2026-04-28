-- =============================================================================
-- Sprint 4 (B) — curfew_violations + multi-event support
-- =============================================================================
-- Adds the `curfew_violations` column to recovery_options so saved simulations
-- preserve K6 curfew counts. Idempotent: safe to run multiple times.
-- =============================================================================

alter table public.recovery_options
  add column if not exists curfew_violations int not null default 0;
