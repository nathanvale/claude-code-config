# Findings Schema

Illustrative shape — authoritative field list lives in the ledger runbook and any
code-owned schema that enforces it.

## Phase 1 Finding (per failing test)

```json
{
  "ac_id": "AC-042",
  "tier": "component",
  "status": "FAIL",
  "error": "Expected 'Approved' but received 'approved'",
  "fixture_path": "src/__tests__/fixtures/reviewer-queue.json"
}
```

Fields:
- `ac_id` — Jira AC identifier (string)
- `tier` — `component` | `live-host` | `backend-gated`
- `status` — `FAIL` | `BLOCKED` | `MISSING_FIXTURE` | `FLAKE`
- `error` — first assertion failure or error message (string)
- `fixture_path` — path to existing fixture, or null if missing

## Phase 2 Triage Manifest

```json
{
  "run_at": "<iso-timestamp>",
  "total": 12,
  "findings": [
    {
      "ac_id": "AC-042",
      "tier": "component",
      "status": "FAIL",
      "tag": "fixable-now",
      "root_cause": "case-normalisation missing in status display",
      "fix_hint": "toLowerCase() before render or normalise in parser",
      "fixture_path": "src/__tests__/fixtures/reviewer-queue.json"
    }
  ]
}
```

Tags:
- `fixable-now` — root cause in frontend code; fixture exists; no backend dependency
- `needs-fixture` — AC is testable but real-data fixture not yet captured
- `blocked-backend` — AC requires a live backend call or missing API data
- `flake` — intermittent; needs isolation before verdict

## Phase 3 Delta Report (stdout)

```
Convergence delta — <date>
  Moved to PASS:    8
  Moved to FAIL:    2
  Moved to BLOCKED: 1
  No change:        1

Open root-cause clusters:
  1. case-normalisation (AC-042, AC-044) — fixable-now
  2. missing fixture for bulk-upload (AC-061) — needs-fixture

Next actions (by unblocking impact):
  1. Fix case-normalisation → closes 2 ACs
  2. Harvest bulk-upload fixture from matest → unblocks AC-061
  3. Escalate AC-058 to backend team → blocked-backend
```
