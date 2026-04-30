-- =============================================================================
-- UAT cleanup — wipes UAT-generated rows so production demo starts clean.
-- =============================================================================
--
-- Schema notes (as of 0003):
--   * `simulations.created_by`        → uuid (auth.users.id)
--   * `disruption_events.created_by`  → uuid (auth.users.id)
--   * `audit_log.actor`               → uuid (auth.users.id)
--   * `recovery_options`              → cascades from `simulations`
--   * `flights`, `aircraft`           → NO owner column (global state).
--     Wiping these requires a separate decision; we delete only rows whose
--     `flight_id` / `aircraft_id` start with the UAT prefixes used in the
--     fixture CSVs (`UAT-` and `VN-A300`).
--
-- Run AFTER UAT sign-off and AFTER you have exported any audit evidence
-- you want to keep.
-- =============================================================================

with uat_users as (
  select id
    from auth.users
   where email in (
     'uat-controller@vietjet.com',
     'uat-supervisor@vietjet.com',
     'uat-viewer@vietjet.com'
   )
)
delete from public.audit_log
 where actor in (select id from uat_users);

with uat_users as (
  select id
    from auth.users
   where email in (
     'uat-controller@vietjet.com',
     'uat-supervisor@vietjet.com'
   )
)
delete from public.simulations
 where created_by in (select id from uat_users);
-- recovery_options are removed by ON DELETE CASCADE.

with uat_users as (
  select id
    from auth.users
   where email = 'uat-controller@vietjet.com'
)
delete from public.disruption_events
 where created_by in (select id from uat_users)
    or event_id like 'UAT-%';

-- Flights / aircraft don't track owner. Restrict to UAT-prefixed ids and to
-- the broken-schedule fixture's aircraft id.
delete from public.flights
 where flight_id like 'UAT-%';

delete from public.aircraft
 where aircraft_id in ('VN-A300');

-- Optional: clear the AIMS DayRep import if you want to reset the live demo
-- to "no schedule loaded". Uncomment with caution — this wipes ALL flights
-- and aircraft, including any saved by the production controller.
--
-- truncate table public.recovery_options cascade;
-- truncate table public.simulations cascade;
-- truncate table public.disruption_events cascade;
-- truncate table public.flights cascade;
-- truncate table public.aircraft cascade;

-- Verification counts
select 'audit_log (UAT actor)'      as scope, count(*) as rows
  from public.audit_log
 where actor in (select id from auth.users where email like 'uat-%@vietjet.com')
union all
select 'simulations (UAT creator)'  as scope, count(*) as rows
  from public.simulations
 where created_by in (select id from auth.users where email like 'uat-%@vietjet.com')
union all
select 'disruption_events (UAT)'    as scope, count(*) as rows
  from public.disruption_events
 where event_id like 'UAT-%'
union all
select 'flights (UAT-)'             as scope, count(*) as rows
  from public.flights
 where flight_id like 'UAT-%'
union all
select 'aircraft (VN-A300)'         as scope, count(*) as rows
  from public.aircraft
 where aircraft_id = 'VN-A300'
;
