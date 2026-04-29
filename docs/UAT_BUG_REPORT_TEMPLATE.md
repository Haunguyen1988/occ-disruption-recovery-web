# UAT Bug Report

> Copy this template per defect. One file or issue per defect.

---

## Identity

- **Bug ID:** `UAT-YYYYMMDD-NN` (auto-generated or sequential)
- **Reporter:** `<email>`
- **Date / time (UTC):** `YYYY-MM-DDThh:mm:ssZ`
- **Build under test:** PR or commit SHA (e.g. `bootstrap-main @ 37f90f8`)
- **UAT environment URL:** `<UAT_URL>`

## Classification

- **Severity:** Sev1 / Sev2 / Sev3 (see `UAT_PLAN.md` for definitions)
- **Scenario reference:** S1 / S2 / S3 / S4 / S5 / S6 / S7 / Bug-bash
- **Role under test:** controller / supervisor / viewer
- **Component:** data-upload / simulate / compare / approve / audit / rules / decoders / login / other

## Reproduction

### Pre-conditions
- Logged in as: `<email>` (`<role>`)
- Data state: e.g. AIMS DayRep loaded, UAT seed run, etc.

### Steps
1. …
2. …
3. …

### Expected
What the system should have done.

### Actual
What it actually did. Include exact error text or banner copy.

## Evidence

- **Screenshot / recording:** `<paste link or attach>`
- **Browser console errors:** `<paste relevant log lines>`
- **Network request that failed (if applicable):** `<URL · method · status · response body>`
- **Audit row (if applicable):** `<event_id · entity_type · entity_id · timestamp>`

## Workaround

Any workaround discovered during testing, or "none".

## Triage notes

- **Owner:** `<engineer>`
- **Decision:** fix-now / defer-to-v1.1 / not-a-bug
- **Linked PR:** `<URL>`
- **Closed:** `<date>`
