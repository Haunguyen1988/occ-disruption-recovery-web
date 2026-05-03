-- Optional actual movement timestamps on imported schedule rows.
-- ATD/ATA mark a flight as already operated for recovery calculations.

alter table public.flights
  add column if not exists actual_departure_time timestamptz,
  add column if not exists actual_arrival_time timestamptz;
