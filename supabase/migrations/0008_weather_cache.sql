-- Weather ingestion cache for server-side METAR/TAF refresh jobs.

create table if not exists public.weather_reports (
  id bigserial primary key,
  airport_icao text not null,
  airport_iata text not null,
  provider text not null,
  product text not null check (product in ('METAR','TAF','MODEL_FORECAST')),
  raw_text text not null,
  issued_at timestamptz,
  observed_at timestamptz,
  valid_from timestamptz,
  valid_to timestamptz,
  flight_category text,
  visibility_m int,
  ceiling_ft int,
  wind_dir_deg int,
  wind_speed_kt int,
  wind_gust_kt int,
  qnh_hpa numeric,
  weather_codes jsonb not null default '[]'::jsonb,
  parsed_json jsonb not null default '{}'::jsonb,
  source_url text not null,
  fetched_at timestamptz not null,
  stale_after timestamptz not null,
  report_hash text not null,
  created_at timestamptz not null default now(),
  unique(provider, product, airport_icao, report_hash)
);

create index if not exists weather_reports_airport_product_idx
  on public.weather_reports(airport_icao, product, fetched_at desc);

create table if not exists public.weather_alerts (
  id bigserial primary key,
  airport_icao text not null,
  airport_iata text not null,
  severity text not null check (severity in ('INFO','WATCH','WARNING','CRITICAL')),
  alert_type text not null,
  message text not null,
  window_start timestamptz not null,
  window_end timestamptz,
  source_report_hash text not null,
  source_report_id bigint references public.weather_reports(id) on delete set null,
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  unique(source_report_hash, alert_type, message)
);

create index if not exists weather_alerts_airport_idx
  on public.weather_alerts(airport_icao, created_at desc);

alter table public.weather_reports enable row level security;
alter table public.weather_alerts enable row level security;

drop policy if exists weather_reports_select on public.weather_reports;
create policy weather_reports_select on public.weather_reports
  for select to authenticated using (true);

drop policy if exists weather_alerts_select on public.weather_alerts;
create policy weather_alerts_select on public.weather_alerts
  for select to authenticated using (true);

drop policy if exists weather_reports_write on public.weather_reports;
create policy weather_reports_write on public.weather_reports
  for all to authenticated using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('controller','admin'))
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('controller','admin'))
  );

drop policy if exists weather_alerts_write on public.weather_alerts;
create policy weather_alerts_write on public.weather_alerts
  for all to authenticated using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('controller','admin'))
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('controller','admin'))
  );
