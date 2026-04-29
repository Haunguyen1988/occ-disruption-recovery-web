# UAT Report

> Fill in after every UAT round. One file per round, e.g. `UAT_REPORT_2026-04-30.md`.

---

## Round identity

- **Date:** `YYYY-MM-DD`
- **Build under test:** `<branch>@<commit>` (e.g. `bootstrap-main@37f90f8`)
- **Environment:** UAT (`<UAT_URL>`)
- **Testers:** `<name (role)>` × N
- **Facilitator:** `<name>`
- **Duration:** `<min>` (planned `<min>`)

---

## Scenario verdicts

| ID | Scenario | Persona | Result | Sev1 fails | Sev2 fails | Sev3 fails | Notes |
|---|---|---|---|---|---|---|---|
| S1 | IROPS rapid-response (AOG) | controller | PASS / FAIL | 0 | 0 | 0 | |
| S2 | Multi-event + curfew (K10/K6) | controller | PASS / FAIL | 0 | 0 | 0 | |
| S3 | What-if compare 2 options | controller | PASS / FAIL | 0 | 0 | 0 | |
| S4 | Audit + approval drill | supervisor | PASS / FAIL | 0 | 0 | 0 | |
| S5 | Viewer least-privilege | viewer | PASS / FAIL | 0 | 0 | 0 | |
| S6 | CSV upload error handling | controller | PASS / FAIL | 0 | 0 | 0 | |
| S7 | Timezone-aware display | controller | PASS / FAIL | 0 | 0 | 0 | |

A scenario is **PASS** only when every Sev1 step passed.

---

## Bug bash log

| Bug ID | Reporter | Scenario | Severity | Component | Title | Status |
|---|---|---|---|---|---|---|
| UAT-YYYYMMDD-01 | | bug-bash | Sev2 | | | open |
| UAT-YYYYMMDD-02 | | S2 | Sev1 | | | open |

---

## Operational metrics observed

> Eyeballed during the round, not formal benchmarks. Useful for trend over time.

- Time-to-first-ranked-option after **Run simulation**: `_s` (target ≤ 5s on 325-flight schedule)
- Time-to-save-to-Supabase from **Save to Supabase** click: `_s` (target ≤ 10s)
- Number of audit rows produced per scenario: `_` (target ≥ steps that mutated data)
- Errors observed in browser console outside expected flows: `_` (target 0)

---

## Sign-off

### Per-tester

> Each tester writes 2 lines: "ok to v1?" verdict + caveats.

- `<name> (controller)`: …
- `<name> (supervisor)`: …
- `<name> (viewer)`: …

### Facilitator summary

- **Sev1 outstanding:** `<count>`
- **Sev2 outstanding:** `<count>`
- **Decision:** GO / GO-WITH-CAVEATS / NO-GO
- **Caveats / required follow-ups before launch:** …

### Linked artefacts

- Recordings: `<links>`
- Screenshots folder: `<link>`
- Bug reports: `<links>`
