-- =============================================================================
-- UAT preflight check - read-only verification before a UAT round.
-- =============================================================================
--
-- Run after:
--   1. Applying migrations through 0007_actual_times.sql
--   2. Creating the 3 UAT auth users
--   3. Running uat_seed.sql
--
-- This script does not modify data.
--
-- Interpretation:
--   * Schema/policy checks should all return status = OK.
--   * User rows should all return status = OK.
--   * MISSING_AUTH_USER -> create the auth user in Supabase Authentication.
--   * MISSING_PROFILE_ROW -> confirm handle_new_user/on_auth_user_created works,
--     or create/fix the profile row before rerunning uat_seed.sql.
--   * CHECK_ROLE -> rerun uat_seed.sql or correct the role manually.
-- =============================================================================

select
  check_name,
  case when passed then 'OK' else 'ACTION_REQUIRED' end as status,
  detail
from (
  select
    'public.profiles exists' as check_name,
    to_regclass('public.profiles') is not null as passed,
    'Expected from 0001_init.sql' as detail
  union all
  select
    'public.recovery_options exists',
    to_regclass('public.recovery_options') is not null,
    'Expected from 0001_init.sql'
  union all
  select
    'handle_new_user() exists',
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'handle_new_user'
    ),
    'Expected from 0001_init.sql'
  union all
  select
    'on_auth_user_created trigger exists',
    exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where t.tgname = 'on_auth_user_created'
        and n.nspname = 'auth'
        and c.relname = 'users'
        and not t.tgisinternal
    ),
    'Expected from 0001_init.sql'
  union all
  select
    'curfew_violations column exists',
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'recovery_options'
        and column_name = 'curfew_violations'
    ),
    'Expected from 0002_curfew_and_multi_event.sql'
  union all
  select
    'approval unique index exists',
    exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'recovery_options'
        and indexname = 'recovery_options_one_approved_per_sim_idx'
    ),
    'Expected from 0003_approval_safety.sql'
  union all
  select
    'approve_recovery_option(uuid, text) exists',
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'approve_recovery_option'
        and pg_get_function_identity_arguments(p.oid) =
          'p_simulation_uuid uuid, p_option_id text'
    ),
    'Expected from 0003_approval_safety.sql'
  union all
  select
    'approve_recovery_option granted to authenticated',
    has_function_privilege(
      'authenticated',
      'public.approve_recovery_option(uuid, text)',
      'EXECUTE'
    ),
    'Required for in-app approval'
  union all
  select
    'flight passenger columns exist',
    not exists (
      select 1
      from (
        values
          ('seat_capacity'),
          ('booked_passengers'),
          ('connecting_passengers'),
          ('vip_passengers'),
          ('special_service_passengers')
      ) as required(column_name)
      where not exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'flights'
          and c.column_name = required.column_name
      )
    ),
    'Expected from 0005_passenger_fields.sql'
  union all
  select
    'flight crew columns exist',
    not exists (
      select 1
      from (
        values
          ('captain'),
          ('first_officer')
      ) as required(column_name)
      where not exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'flights'
          and c.column_name = required.column_name
      )
    ),
    'Expected from 0006_crew_fields.sql'
  union all
  select
    'flight actual time columns exist',
    not exists (
      select 1
      from (
        values
          ('actual_departure_time'),
          ('actual_arrival_time')
      ) as required(column_name)
      where not exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'flights'
          and c.column_name = required.column_name
      )
    ),
    'Expected from 0007_actual_times.sql'
  union all
  select
    'RLS enabled on flights',
    exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'flights'
        and c.relrowsecurity
    ),
    'Expected from 0001_init.sql'
  union all
  select
    'RLS enabled on aircraft',
    exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'aircraft'
        and c.relrowsecurity
    ),
    'Expected from 0001_init.sql'
  union all
  select
    'RLS enabled on disruption_events',
    exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'disruption_events'
        and c.relrowsecurity
    ),
    'Expected from 0001_init.sql'
  union all
  select
    'RLS enabled on simulations',
    exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'simulations'
        and c.relrowsecurity
    ),
    'Expected from 0001_init.sql'
  union all
  select
    'RLS enabled on recovery_options',
    exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'recovery_options'
        and c.relrowsecurity
    ),
    'Expected from 0001_init.sql'
  union all
  select
    'RLS enabled on audit_log',
    exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'audit_log'
        and c.relrowsecurity
    ),
    'Expected from 0001_init.sql'
  union all
  select
    'flights_write policy exists',
    exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'flights'
        and policyname = 'flights_write'
    ),
    'Required for controller/admin schedule imports'
  union all
  select
    'aircraft_write policy exists',
    exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'aircraft'
        and policyname = 'aircraft_write'
    ),
    'Required for controller/admin aircraft imports'
  union all
  select
    'disruption_events_write policy exists',
    exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'disruption_events'
        and policyname = 'disruption_events_write'
    ),
    'Required for controller/admin disruption saves'
  union all
  select
    'simulations_write policy exists',
    exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'simulations'
        and policyname = 'simulations_write'
    ),
    'Required for controller/admin simulation saves'
  union all
  select
    'recovery_options_write policy exists',
    exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'recovery_options'
        and policyname = 'recovery_options_write'
    ),
    'Required for controller/admin option persistence and approval'
  union all
  select
    'audit_log_write policy exists',
    exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'audit_log'
        and policyname = 'audit_log_write'
    ),
    'Required for audit trail writes'
) checks
order by check_name;

with expected_users as (
  select *
  from (
    values
      (
        'uat-controller@vietjet.com',
        'controller',
        'Controller should be able to import, simulate, save, and approve.'
      ),
      (
        'uat-supervisor@vietjet.com',
        'controller',
        'Current build maps supervisor persona to controller role.'
      ),
      (
        'uat-viewer@vietjet.com',
        'viewer',
        'Viewer should remain read-only.'
      )
  ) as v(email, expected_role, note)
)
select
  e.email,
  e.expected_role,
  coalesce(p.role, '<missing profile>') as actual_role,
  case
    when u.id is null then 'MISSING_AUTH_USER'
    when p.id is null then 'MISSING_PROFILE_ROW'
    when p.role = e.expected_role then 'OK'
    else 'CHECK_ROLE'
  end as status,
  e.note
from expected_users e
left join auth.users u on u.email = e.email
left join public.profiles p on p.id = u.id
order by e.email;
