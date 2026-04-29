# UAT artefacts

> Run a User Acceptance Test round with 2–3 OCC controllers in ~90 minutes.

## Files

| File | Purpose |
|---|---|
| `../UAT_PLAN.md` | Test plan with 7 scenarios, severity rubric, sign-off rules |
| `../UAT_BUG_REPORT_TEMPLATE.md` | Per-defect template (copy per bug) |
| `../UAT_REPORT_TEMPLATE.md` | Per-round summary (sign-off) |
| `uat_seed.sql` | Assigns roles to UAT users after they're created in Supabase |
| `uat_cleanup.sql` | Wipes UAT-generated rows after sign-off |
| `../../public/uat/uat_scenario_aog.csv` | S1 disruption fixture (AOG VN-A537) |
| `../../public/uat/uat_scenario_weather.csv` | S2 weather fixture (HAN closure) |
| `../../public/uat/uat_scenario_broken_schedule.csv` | S6 broken-CSV fixture (5 issues) |

## Quick start

1. Pre-flight (a day before): create 3 auth users in Supabase, run `uat_seed.sql`.
2. Open `UAT_PLAN.md` and walk each scenario sequentially with the testers.
3. File defects using `UAT_BUG_REPORT_TEMPLATE.md` (one per issue).
4. Wrap up by filling `UAT_REPORT_TEMPLATE.md` with verdicts + sign-off.
5. After approval, run `uat_cleanup.sql` to reset the database.
