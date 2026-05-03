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
| S8 | Tail-assignment optimized recovery | controller | PASS / FAIL | 0 | 0 | 0 | |

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
> Local benchmark helper: run `npm.cmd run benchmark:tail` and paste the table below when using the checked-in AIMS DayRep sample.
> For real exports, set `OCC_TAIL_BENCHMARK_AIMS` and `OCC_TAIL_BENCHMARK_DISRUPTION` to local file paths before running the helper. For CSV fixtures, set `OCC_TAIL_BENCHMARK_SCHEDULE`, `OCC_TAIL_BENCHMARK_AIRCRAFT`, and `OCC_TAIL_BENCHMARK_DISRUPTION`. Set `OCC_TAIL_BENCHMARK_MODE=fast|balanced|deep` to benchmark a specific optimizer mode.

- Time-to-first-ranked-option after **Run simulation**: `_s` (target ≤ 5s on 325-flight schedule)
- Tail optimizer horizon shown on Simulate page: `_ flights / _ aircraft`
- Tail optimizer mode: `fast / balanced / deep`
- Tail optimizer arc reduction: `_ -> _ arcs (_% removed)`
- Tail optimizer paths / master-search nodes: `_ paths / _ nodes`
- Tail optimizer connection fixing: `_ locked` or `not applied`
- Tail optimized option generated / rank: `yes/no`, rank `_`
- Tail score delta vs best non-tail heuristic: `_`
- Tail ranking explanation observed: `wins / loses / ties / missing`; key driver text: `_`
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
