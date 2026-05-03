-- Optional crew pairing inputs on imported schedule rows.
-- Nullable so existing CSV/AIMS exports remain valid.

alter table public.flights
  add column if not exists captain text,
  add column if not exists first_officer text;
