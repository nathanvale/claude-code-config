# Browser Use Platform Durable-Record Fixtures

Durable-record fixtures for Platform U2 (XDG store and resumable-run
substrate). Owner test: `skills/browser-use/src/browser-use-schemas.test.ts`
(parse matrix + the V5 redaction sweep). Other U2 platform tests may add
fixtures here; every fixture must pass `findRedactionViolations` with zero
findings except `redaction-violation.json`.

## Contents

- `shared-run-valid.json` — one valid shared-run record in canonical
  `encodeDurableRecord` form (byte-exact round-trip is asserted).
- `shared-run-corrupt.json.txt` — truncated JSON; the parse matrix's
  `record_json_invalid` case. Named `.json.txt` so Biome's JSON parser skips
  the intentional truncation; the V5 sweep still walks its raw text.
- `record-wrong-kind.json` — a valid activation-epoch record; the
  `record_kind_mismatch` case when parsed as `shared-run`.
- `shared-run-version-2.json` — schema_version `"2"`; the
  `record_version_unsupported` case.
- `tombstone-pending.json` / `tombstone-complete.json` — the two-phase
  retention tombstone pair (R29).
- `artifact-manifest.json` — one full artifact manifest (R29).
- `artifact-manifest-present.json` / `artifact-bytes-present.txt` — a
  manifest whose `content_hash` is the real sha256 of the bytes fixture;
  the retention four-way truth's "present" case. Owner test:
  `browser-use-retention.test.ts` (S17).
- `redaction-violation.json` — guard-proving fixture ONLY: its
  `"password": "fixture-sentinel-not-a-secret"` sentinel exists so the V5
  sweep proves `findRedactionViolations` rejects it. Never a real credential.

No fixture may contain a real credential, `ws://` endpoint, or `op://`
reference — the V5 sweep enforces this mechanically over every file here
(raw text and, where parsable, structured keys), excluding only this README.
