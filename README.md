# OCC Disruption Recovery — Web

Next.js + Supabase + Vercel re-platform of the OCC Disruption Recovery MVP. Designed for small (~10 user) airline OCC internal demo.

> Live demo target: **Vercel** · DB: **Supabase Postgres** · Engine: **TypeScript** · UI: **Next.js 16 App Router + Tailwind**

---

## Features (Sprint 1 + 2)

- **Schedule overview**: Gantt-style rotation timeline (one row per aircraft).
- **Disruption simulation**: 4 IROPS scenarios — AOG, Airport Close, Weather, Late Arrival — with ranked recovery options:
  - `DELAY_ONLY` (impacted-aircraft scoped — bug fix vs Python MVP K2)
  - `SPREAD_DELAY`
  - `DEEP_DELAY`
  - `SINGLE_SWAP` (with downstream rotation re-assignment — bug fix K4)
- **AOG impact detector**: only flights overlapping the AOG window or starting during it are auto-impacted (bug fix K1).
- **METAR / TAF decoder**: structured fields + alerts when below configured minima.
- **NOTAM Q-line decoder**: extracts FIR/airport/Q-code/start/end + categorises into RUNWAY_CLOSED / AERODROME_CLOSED / NAVAID / etc.
- **YAML-driven business rules** (turnaround, swap policy, score weights, curfew, priorities) — editable in-app.
- **CSV / Excel** ingestion + AIMS-style CSV export of approved option.
- **Supabase** auth + 7-table schema + RLS policies (controllers can write, viewers read).

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind v4 |
| Auth + DB | Supabase |
| Parsing | papaparse, xlsx, yaml |
| Hosting | Vercel |

## Running locally

```bash
# 1. Install deps
npm install

# 2. Configure env (optional for local dev — production requires Supabase)
# create .env.local with NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY

# 3. Dev server
npm run dev
```

Open http://localhost:3000. In local development, the dashboard can run in stub mode without Supabase and auto-loads sample AOG data. Production deployments fail closed and require Supabase auth.

## Supabase setup (when ready)

1. Create a free project at https://supabase.com (region: Singapore for VN users).
2. Run the SQL files in `supabase/migrations/` in order through `0007_actual_times.sql` (paste each one into the SQL Editor, or apply them with Supabase CLI).
3. Settings → API → copy `Project URL` and `anon public key` into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. (Optional) Add team users via Supabase Auth dashboard. Default role is `viewer`. Update profile rows to `controller` / `admin` for write access.

## Deploy to Vercel

1. Push to GitHub.
2. https://vercel.com/new → Import the repo.
3. Add env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Complete `docs/PROD_READINESS.md`.
5. Deploy.

## Roadmap

- Sprint 1 (this PR): scaffold, engine port, schedule Gantt, disruption simulation, decoders, sample data.
- Sprint 2: Supabase persistence, audit log, what-if compare 2 options side-by-side.
- Sprint 3: NOTAM batch ingest, METAR scheduled fetch, multi-event simulation.
- Sprint 4: SWAP_CHAIN, CANCEL_OR_FERRY options; preliminary curfew enforcement.
- Phase 3+: crew (FDP) and pax reaccommodation (out of scope for demo).

## Project structure

```
src/
├── app/                  # Next.js App Router pages
│   ├── dashboard/        # /dashboard/* — sidebar layout
│   │   ├── audit/
│   │   ├── data/
│   │   ├── decoders/
│   │   ├── rules/
│   │   ├── schedule/
│   │   └── simulate/
│   ├── login/
│   └── page.tsx          # landing
├── components/           # UI primitives + DataProvider
├── lib/
│   ├── decoders/         # METAR, NOTAM
│   ├── engine/           # impact detector, candidate finder, delay sim, scorer
│   ├── parsers/          # CSV / Excel / YAML
│   ├── supabase/         # server + browser clients
│   ├── types.ts
│   └── utils.ts
data/                     # default rules + sample CSVs
public/                   # served sample CSVs (downloadable)
supabase/migrations/      # SQL migrations
```

## Acknowledgements

Engine logic ported from the original Python MVP (FastAPI + Streamlit). Bug fixes referenced as `K1`/`K2`/`K4` correspond to the review document `OCC_Disruption_Recovery_Review.md`.
