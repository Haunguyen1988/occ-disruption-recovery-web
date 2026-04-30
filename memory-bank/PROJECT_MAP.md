# Project Map

## Routes

- `src/app/page.tsx`: landing page.
- `src/app/dashboard/layout.tsx`: loads Supabase session and operational data, then wraps dashboard in `DataProvider`.
- `src/app/dashboard/page.tsx`: overview and active disruption snapshot.
- `src/app/dashboard/schedule/page.tsx`: Gantt schedule.
- `src/app/dashboard/simulate/page.tsx`: recovery simulation, multi-event what-if, save/approve/export.
- `src/app/dashboard/compare/page.tsx`: side-by-side comparison using `sessionStorage`.
- `src/app/dashboard/data/page.tsx`: CSV/XLSX/AIMS import, preview, validation, Supabase save.
- `src/app/dashboard/rules/page.tsx`: edit engine YAML rules locally.
- `src/app/dashboard/audit/page.tsx`: saved simulations and audit feed.
- `src/app/dashboard/decoders/page.tsx`: METAR/TAF and NOTAM decoding.

## Core Modules

- `src/components/data-context.tsx`: client-side data state, sample loading, parsing actions, local rules.
- `src/components/gantt-schedule.tsx`: schedule timeline visualization.
- `src/lib/engine/*`: impact detection, recovery option generation, delay simulation, scoring, time/curfew helpers.
- `src/lib/parsers/*`: generic CSV/XLSX parser, AIMS DayRep parser, rules parser.
- `src/lib/supabase/*`: server/browser clients and data queries.
- `src/app/actions.ts`: server actions for persistence, approval, audit export.
- `supabase/migrations/*`: database schema and curfew support.

## Data Flow

1. Dashboard layout gets session and operational data from Supabase when configured.
2. `DataProvider` seeds client state or auto-loads sample data in stub mode.
3. Import page can replace schedule, aircraft, disruption, and parser issues.
4. Simulate page runs engine in the browser against current provider state.
5. Controller/admin users can persist operational data, simulations, approvals, and export audit entries through server actions.

## Important Local Patterns

- Use `npm.cmd` on Windows PowerShell.
- Keep engine behavior covered with Vitest in `src/lib/engine/__tests__`.
- Keep parser behavior covered with Vitest in `src/lib/parsers/__tests__`.
- Next.js 16 has changed conventions. Before Next-specific edits, read relevant docs under `node_modules/next/dist/docs/`.
