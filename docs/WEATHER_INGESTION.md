# Weather Ingestion

The app fetches live aviation weather server-side for:

- `VVTS` / `SGN`
- `VVNB` / `HAN`
- `VVDN` / `DAD`

Primary provider: NOAA AviationWeather Data API.

## Environment

```env
WEATHER_AIRPORTS=VVTS,VVNB,VVDN
WEATHER_CRON_SECRET=change-me
SUPABASE_SERVICE_ROLE_KEY=service-role-key-for-cron-writes
```

`SUPABASE_SERVICE_ROLE_KEY` is optional in local stub mode. Without it, live
weather can still be fetched, but cron/cache writes may not persist in
Supabase.

## Routes

- `GET /api/weather`: authenticated dashboard read; return cached Supabase weather when available, otherwise fetch live.
- `POST /api/weather/refresh`: controller/admin manual refresh; fetch live and attempt to persist reports/alerts.
- `GET /api/cron/weather`: Vercel Cron endpoint. In production, send `Authorization: Bearer WEATHER_CRON_SECRET`.

## Supabase

Run migrations through `supabase/migrations/0008_weather_cache.sql`.

The cache stores:

- `weather_reports`: METAR/TAF raw and normalized fields.
- `weather_alerts`: low visibility, ceiling, thunderstorm, CB, wind, IFR, stale-data alerts.

## Notes

NOAA AviationWeather does not allow browser CORS, so all provider calls stay on
the server. The UI only calls internal Next routes.
