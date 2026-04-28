-- OCC Disruption Recovery — initial schema
-- Run with: supabase db push  (or paste into Supabase SQL Editor)

-- =========================
-- Roles via profiles table
-- =========================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'viewer' check (role in ('viewer','controller','admin')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================
-- Operational data
-- =========================
create table if not exists public.aircraft (
  id bigserial primary key,
  aircraft_id text not null unique,
  aircraft_type text not null,
  current_station text not null,
  available_from timestamptz not null,
  status text not null default 'ACTIVE',
  next_maintenance_time timestamptz,
  restriction text,
  created_at timestamptz not null default now()
);

create table if not exists public.flights (
  id bigserial primary key,
  flight_id text not null unique,
  flight_number text not null,
  origin text not null,
  destination text not null,
  std timestamptz not null,
  sta timestamptz not null,
  aircraft_id text not null,
  aircraft_type text not null,
  priority_level int not null default 3,
  load_factor numeric(3,2) not null default 0,
  is_international boolean not null default false,
  is_last_flight_of_day boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists flights_aircraft_idx on public.flights(aircraft_id);
create index if not exists flights_std_idx on public.flights(std);

create table if not exists public.disruption_events (
  id bigserial primary key,
  event_id text not null unique,
  event_type text not null check (event_type in ('AOG','AIRPORT_CLOSE','WEATHER','LATE_ARRIVAL')),
  affected_aircraft text,
  affected_airport text,
  affected_flight_id text,
  start_time timestamptz not null,
  end_time timestamptz not null,
  severity text not null,
  description text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- =========================
-- Simulation results (immutable history)
-- =========================
create table if not exists public.simulations (
  id bigserial primary key,
  uuid uuid not null default gen_random_uuid() unique,
  disruption_event_id bigint references public.disruption_events(id) on delete set null,
  result_json jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists public.recovery_options (
  id bigserial primary key,
  simulation_id bigint not null references public.simulations(id) on delete cascade,
  option_id text not null,
  option_type text not null,
  rank int,
  score numeric,
  risk_level text,
  total_delay_minutes int,
  max_delay_minutes int,
  impacted_flight_count int,
  swap_count int,
  recommendation text,
  reason_codes jsonb,
  score_breakdown jsonb,
  flight_changes jsonb,
  aircraft_changes jsonb,
  approved boolean not null default false,
  approved_by uuid references auth.users(id),
  approved_at timestamptz
);

create index if not exists recovery_options_sim_idx on public.recovery_options(simulation_id);

-- =========================
-- Audit log (append-only)
-- =========================
create table if not exists public.audit_log (
  id bigserial primary key,
  actor uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- =========================
-- RLS
-- =========================
alter table public.profiles enable row level security;
alter table public.aircraft enable row level security;
alter table public.flights enable row level security;
alter table public.disruption_events enable row level security;
alter table public.simulations enable row level security;
alter table public.recovery_options enable row level security;
alter table public.audit_log enable row level security;

-- Profiles: every signed-in user can read; only self can update non-role fields.
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid());

-- Operational data: any signed-in user can read; controllers/admins can write.
do $$
declare t text;
begin
  for t in select unnest(array['aircraft','flights','disruption_events','simulations','recovery_options','audit_log']) loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format($f$create policy %I_write on public.%I for all to authenticated using (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('controller','admin'))
    ) with check (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('controller','admin'))
    )$f$, t, t);
  end loop;
end $$;
