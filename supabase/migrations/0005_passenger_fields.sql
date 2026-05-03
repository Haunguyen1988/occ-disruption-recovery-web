-- Optional passenger-impact inputs on imported schedule rows.
-- Keep nullable so existing CSV/AIMS exports remain valid.

alter table public.flights
  add column if not exists seat_capacity int check (seat_capacity is null or seat_capacity >= 0),
  add column if not exists booked_passengers int check (booked_passengers is null or booked_passengers >= 0),
  add column if not exists connecting_passengers int check (connecting_passengers is null or connecting_passengers >= 0),
  add column if not exists vip_passengers int check (vip_passengers is null or vip_passengers >= 0),
  add column if not exists special_service_passengers int check (special_service_passengers is null or special_service_passengers >= 0);
