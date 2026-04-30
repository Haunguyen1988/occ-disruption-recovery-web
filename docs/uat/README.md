# UAT artefacts

> Run a User Acceptance Test round with 2–3 OCC controllers in ~90 minutes.

## Files

| File | Purpose |
|---|---|
| `../UAT_PLAN.md` | Test plan with 7 scenarios, severity rubric, sign-off rules |
| `../UAT_BUG_REPORT_TEMPLATE.md` | Per-defect template (copy per bug) |
| `../UAT_REPORT_TEMPLATE.md` | Per-round summary (sign-off) |
| `uat_seed.sql` | Assigns roles to UAT users after they're created in Supabase |
| `uat_preflight_check.sql` | Read-only check for migrations, approval RPC, and UAT user roles |
| `uat_cleanup.sql` | Wipes UAT-generated rows after sign-off |
| `../../public/uat/uat_scenario_aog.csv` | S1 disruption fixture (AOG VN-A537) |
| `../../public/uat/uat_scenario_weather.csv` | S2 weather fixture (HAN closure) |
| `../../public/uat/uat_scenario_broken_schedule.csv` | S6 broken-CSV fixture (5 issues) |

## Quick start

1. Pre-flight (a day before): apply Supabase migrations through `0003_approval_safety.sql`, create 3 auth users in Supabase, run `uat_seed.sql`, then run `uat_preflight_check.sql`.
2. Open `UAT_PLAN.md` and walk each scenario sequentially with the testers.
3. File defects using `UAT_BUG_REPORT_TEMPLATE.md` (one per issue).
4. Wrap up by filling `UAT_REPORT_TEMPLATE.md` with verdicts + sign-off.
5. After approval, run `uat_cleanup.sql` to reset the database.

## Preflight status guide

- Schema and policy rows from `uat_preflight_check.sql` should all show `OK`.
- `MISSING_AUTH_USER` means the user does not exist yet in Supabase Authentication.
- `MISSING_PROFILE_ROW` means the auth user exists but the `profiles` row is missing; check `handle_new_user` / `on_auth_user_created`, then rerun `uat_seed.sql`.
- `CHECK_ROLE` means the `profiles.role` value does not match the expected UAT persona; rerun `uat_seed.sql` or correct the role manually.
