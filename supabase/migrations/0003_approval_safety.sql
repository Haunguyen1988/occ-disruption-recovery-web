-- =============================================================================
-- Sprint 5 (C) approval safety
-- =============================================================================
-- Makes recovery option approval atomic and prevents stale option ids from
-- clearing an existing approval.
-- =============================================================================

-- Clean up any historical duplicate approvals before adding the uniqueness
-- guard. Keep the most recently approved row per simulation.
with ranked as (
  select
    id,
    row_number() over (
      partition by simulation_id
      order by approved_at desc nulls last, id desc
    ) as rn
  from public.recovery_options
  where approved = true
)
update public.recovery_options
set approved = false,
    approved_by = null,
    approved_at = null
where id in (select id from ranked where rn > 1);

create unique index if not exists recovery_options_one_approved_per_sim_idx
  on public.recovery_options(simulation_id)
  where approved = true;

create or replace function public.approve_recovery_option(
  p_simulation_uuid uuid,
  p_option_id text
)
returns table (
  option_row_id bigint,
  simulation_row_id bigint
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_simulation_id bigint;
  v_option_row_id bigint;
begin
  select s.id
    into v_simulation_id
  from public.simulations s
  where s.uuid = p_simulation_uuid;

  if v_simulation_id is null then
    raise exception 'Simulation not found' using errcode = 'P0002';
  end if;

  select ro.id
    into v_option_row_id
  from public.recovery_options ro
  where ro.simulation_id = v_simulation_id
    and ro.option_id = p_option_id;

  if v_option_row_id is null then
    raise exception 'Recovery option not found' using errcode = 'P0002';
  end if;

  update public.recovery_options
  set approved = false,
      approved_by = null,
      approved_at = null
  where simulation_id = v_simulation_id
    and id <> v_option_row_id
    and approved = true;

  update public.recovery_options
  set approved = true,
      approved_by = auth.uid(),
      approved_at = now()
  where id = v_option_row_id
  returning id into v_option_row_id;

  if v_option_row_id is null then
    raise exception 'Recovery option approval failed' using errcode = 'P0001';
  end if;

  return query select v_option_row_id, v_simulation_id;
end;
$$;

grant execute on function public.approve_recovery_option(uuid, text) to authenticated;
