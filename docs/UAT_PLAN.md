# UAT Plan — OCC Disruption Recovery Web

**Audience:** 2–3 OCC controllers (1 OCC duty controller, 1 OCC supervisor, 1 viewer).
**Duration:** ~90 minutes (60 min execution + 30 min debrief).
**Build under test:** `bootstrap-main` (post Sprint 8-A merge), deployed at `<UAT_URL>`.
**Fixtures:** `public/uat/*` and `src/lib/parsers/__tests__/fixtures/aims_dayrep_sample.xlsx` (real AIMS DayRep, 28-Apr-2026, 325 flights). Tail-assignment focused fixtures: `public/uat/uat_tail_assignment_schedule.csv`, `public/uat/uat_tail_assignment_aircraft.csv`, and `public/uat/uat_scenario_tail_assignment.csv`.

> **Pre-flight (1 day before UAT)**
> 1. Run migrations in `supabase/migrations/` against the UAT Supabase project in order through `0007_actual_times.sql`.
> 2. Run `docs/uat/uat_seed.sql` to provision UAT users (`uat-controller@vietjet.com`, `uat-supervisor@vietjet.com`, `uat-viewer@vietjet.com`) and assign roles.
> 3. Run `docs/uat/uat_preflight_check.sql` and make sure every schema check returns `OK`, while every UAT user row returns `OK`.
> 4. Confirm `<UAT_URL>` is reachable, `/login` works, and the AIMS DayRep upload returns the blue "Loaded 325 flights / 73 aircraft" banner.

---

## Roles under test

| Role | Permissions |
|---|---|
| `controller` | Upload data · Run sim · Save sim · Approve options · See audit |
| `supervisor` | Same as `controller` + drill into audit, revoke approval (if implemented) |
| `viewer` | Read-only; no Save/Approve buttons; can see ranked options + Compare |

---

## Scenarios

Each scenario lists: **Persona · Goal · Steps · Pass criteria · Severity if failed**.
Severity is the *worst-case* impact if the step fails: `Sev1 = blocks rollout`, `Sev2 = required for v1`, `Sev3 = nice-to-have polish`.

---

### S1 — Controller IROPS rapid-response (AOG)

**Persona:** Duty controller. **Goal:** Recover flight after a sudden AOG.

| # | Step | Pass criteria | Sev |
|---|---|---|---|
| 1 | Sign in as `uat-controller@vietjet.com` | Sidebar shows email + `CONTROLLER` badge | Sev1 |
| 2 | `/dashboard/data` → upload `aims_dayrep_sample.xlsx` | Blue banner "AIMS DayRepReport detected · Loaded 325 flights / 73 aircraft / types {A320, A321, A330}" | Sev1 |
| 3 | Click **Save to Supabase** | Toast "Saved to Supabase: 325 flights, 73 aircraft" within ≤10s | Sev1 |
| 4 | Upload `public/uat/uat_scenario_aog.csv` to the Disruption card | 1 disruption parsed, no errors | Sev1 |
| 5 | `/dashboard/simulate` → click **Run simulation** | ≥3 ranked options appear within ≤5s, score ascending (lower = better) | Sev1 |
| 6 | Inspect the top option | Reason codes visible, score breakdown shows components, "swap chain" or "delay only" labelled | Sev2 |
| 7 | Click **Save simulation** | Simulation UUID returned and visible at top of Audit page | Sev1 |
| 8 | Click **Approve** on the top option | Badge **APPROVED**, "Approved ✓" status persists on refresh | Sev1 |
| 9 | `/dashboard/audit` → verify | 1 simulation row + ≥4 activity rows (IMPORT, SIMULATE, APPROVE, +1 IMPORT for AIMS), all attributed to the controller | Sev2 |

**Out of scope this scenario:** weather, multi-event, curfew (covered in S2).

---

### S2 — Controller multi-event with curfew (K10 + K6)

**Persona:** Duty controller. **Goal:** Cascade impact of an AOG + a weather-driven airport closure, with curfew constraint.

| # | Step | Pass criteria | Sev |
|---|---|---|---|
| 1 | Continuing as controller, on `/dashboard/simulate` | Auto-loaded sample disruption visible | Sev2 |
| 2 | Click **+ Add what-if event** → fill `AIRPORT_CLOSE` HAN start `2026-04-28T15:00:00Z` end `2026-04-28T17:00:00Z` | Event card appears, button label updates to **Run multi-event (2)** | Sev1 |
| 3 | Click **Run multi-event (2)** | Impacted-flights count includes both the AOG aircraft *and* HAN-departure flights during the closure window | Sev1 |
| 4 | `/dashboard/rules` → confirm `enforce_curfew: true` and at least one airport curfew defined | YAML loads without parse error | Sev2 |
| 5 | Add an extra what-if AOG covering 13:00Z–17:00Z on a wide-body, then re-run | At least one option shows **CURFEW ×N** badge with `curfew_component > 0` in score breakdown | Sev2 |
| 6 | Tick 2 options → **Open compare →** | Compare page opens, "Curfew violations" row shows correct counts and Δ | Sev2 |
| 7 | Save sim + approve the lower-curfew option | Audit page shows the second simulation + approve event | Sev2 |

---

### S3 — Controller what-if compare 2 options

**Persona:** Duty controller. **Goal:** Pick the better of two recovery candidates.

| # | Step | Pass criteria | Sev |
|---|---|---|---|
| 1 | Auto-load AOG sample on `/dashboard/simulate` | Without uploading anything, ranked options visible | Sev2 |
| 2 | Tick checkbox on Option #1, then Option #3 | Counter "Compare 2/2 selected", **Open compare →** enabled | Sev2 |
| 3 | Click **Open compare →** | Compare page renders 2 cards side-by-side with 9-row Δ table | Sev2 |
| 4 | Verify Δ math | For at least 2 numeric rows (`total_delay`, `score`), Δ = B − A is correct | Sev2 |
| 5 | Verify winner highlight | Card with the *lower* score has emerald border | Sev3 |
| 6 | Try untick one option | Counter drops to 1/2, Compare button disables | Sev3 |

---

### S4 — Supervisor audit + approval drill

**Persona:** Supervisor. **Goal:** Verify post-event audit trail completeness for compliance.

| # | Step | Pass criteria | Sev |
|---|---|---|---|
| 1 | Sign in as `uat-supervisor@vietjet.com` | Sidebar shows email + `CONTROLLER` (or `SUPERVISOR` if role exists) | Sev1 |
| 2 | `/dashboard/audit` → filter rows from S1/S2/S3 | All actions (IMPORT, SIMULATE, APPROVE) appear with: actor email, timestamp (UTC), entity_type, entity_id | Sev1 |
| 3 | Click on any APPROVE row | Drill-down shows: simulation UUID, option index, score, approver email, approved_at | Sev2 |
| 4 | Verify timestamps are UTC ISO 8601 with `Z` suffix | All datetime values include explicit `Z` | Sev2 |
| 5 | Re-run a simulation | New row added at the top of Audit; old rows unaffected | Sev2 |
| 6 | Sign out | Redirects to `/login` | Sev2 |

---

### S5 — Viewer least-privilege (role gating)

**Persona:** Viewer. **Goal:** Confirm the principle of least privilege is enforced in the UI.

| # | Step | Pass criteria | Sev |
|---|---|---|---|
| 1 | Sign in as `uat-viewer@vietjet.com` | Sidebar shows email + `VIEWER` badge | Sev1 |
| 2 | `/dashboard/data` | **Save to Supabase** button hidden or disabled | Sev1 |
| 3 | `/dashboard/simulate` → run simulation | Simulation runs; ranked options appear; **Save simulation** and **Approve** buttons hidden | Sev1 |
| 4 | `/dashboard/audit` | Page loads; all rows visible; no edit affordances | Sev2 |
| 5 | Try directly POSTing to a save endpoint (optional, only if technically inclined) | Server returns 403 or equivalent guarded response | Sev1 |

---

### S6 — CSV upload error handling

**Persona:** Controller. **Goal:** Confirm upload validation produces actionable errors, not stack traces.

| # | Step | Pass criteria | Sev |
|---|---|---|---|
| 1 | Upload `public/uat/uat_scenario_broken_schedule.csv` to the Schedule card | IssuesPanel lists ≥3 issues with `row N / col X / value="..."` chips | Sev2 |
| 2 | Verify only valid rows are imported | Counter shows imported < total rows | Sev2 |
| 3 | **Save to Supabase** is disabled while errors present | Button greyed; tooltip explains why | Sev2 |
| 4 | Click **Paste from Excel** → paste 2 valid rows | Dialog accepts TSV input; rows pass through validator | Sev3 |
| 5 | Click **Download template** on each card (Schedule / Aircraft / Disruption) | 3 CSV files download; each starts with the documented header | Sev3 |

---

### S7 — Timezone-aware display sanity (Sprint 8-A)

**Persona:** Controller. **Goal:** Ensure airport-local display matches the AIMS DayRep numbers.

| # | Step | Pass criteria | Sev |
|---|---|---|---|
| 1 | After uploading the AIMS DayRep | Schedule preview header reads "STD (origin local)" / "STA (dest local)" | Sev2 |
| 2 | Pick any HAN→ICN or HAN→NRT leg in the preview | STD column shows the same HH:MM the controller sees in the AIMS report at HAN; STA column shows the destination-local arrival time | Sev2 |
| 3 | `/dashboard/schedule` → Gantt → hover any leg | Tooltip shows `<flightnr> · ORG→DEST · HH:MM ORG / HH:MM DEST · …`; hour ticks across the top remain in UTC | Sev2 |
| 4 | Footer caption | "Canvas: UTC · Tooltip: airport-local" caption is visible | Sev3 |
| 5 | Add an NRT curfew (e.g. 23:00–06:00) in `/dashboard/rules`, run sim with a flight whose STA at NRT falls in that window | At least one option flags `CURFEW ×N` driven by NRT (not by VN-only airports) | Sev2 |

---

### S8 — Aircraft recovery optimized recovery

**Persona:** Duty controller. **Goal:** Verify the network optimizer can build and rank feasible aircraft recovery paths, not only delay/swap heuristics.

| # | Step | Pass criteria | Sev |
|---|---|---|---|
| 1 | `/dashboard/data` → upload `public/uat/uat_tail_assignment_schedule.csv` as Schedule | 5 flights imported, no parse errors | Sev1 |
| 2 | Upload `public/uat/uat_tail_assignment_aircraft.csv` as Aircraft | 3 aircraft imported, no parse errors | Sev1 |
| 3 | Upload `public/uat/uat_scenario_tail_assignment.csv` as Disruption | 1 AOG disruption parsed, no errors | Sev1 |
| 4 | `/dashboard/simulate` → keep **Balanced** selected, then click **Run simulation** | `TAIL_ASSIGNMENT_OPTIMIZED` appears and is ranked #1 | Sev1 |
| 5 | Inspect the aircraft recovery diagnostics panel | It shows horizon metrics, arc reduction, path counts, and no no-option warning | Sev2 |
| 6 | Inspect the ranked option row and open option details | Ranking explanation says the tail option wins against the best non-tail delay/swap heuristic and lists the main score drivers/tradeoffs | Sev2 |
| 7 | Inspect flight changes in option details | Flight `TAIL-F1` is reassigned to `TAIL-B`, and `TAIL-G1` is reassigned to `TAIL-A` | Sev2 |
| 8 | Compare against Delay Only | Tail option has lower score than the best non-tail heuristic | Sev2 |
| 9 | Re-run in **Fast** and **Deep** modes | Diagnostics panel mode label updates; ranked options still render without UI freeze | Sev2 |

---

## Defect classification

- **Sev1 — Blocks rollout.** Login broken, save fails, audit empty, role gating bypassed, data corruption.
- **Sev2 — Required for v1.** Engine math wrong, score drift, missing audit field, incorrect tz display, curfew not firing.
- **Sev3 — Polish.** UI text, copy, layout, sort order, tooltip wording.

A scenario passes only when *every* Sev1 step passes. A Sev2 step that fails should be filed and triaged within 1 business day. Sev3 issues are batched into a polish PR.

---

## Bug bash protocol

1. **Timebox**: 30 minutes after scenarios are complete. Each tester explores freely.
2. **Reporting channel**: file each defect using `docs/UAT_BUG_REPORT_TEMPLATE.md` in a shared folder (or open a GitHub issue using the same fields).
3. **Triage call**: 15 minutes at the end. Walk every Sev1/Sev2 issue and assign owner.
4. **Sign-off**: tester writes 2-line "ok to v1?" verdict in `docs/UAT_REPORT_TEMPLATE.md` and emails to PM.

---

## Cleanup after UAT

When sign-off is in, run `docs/uat/uat_cleanup.sql` to wipe UAT data so the production demo starts from a clean slate.
