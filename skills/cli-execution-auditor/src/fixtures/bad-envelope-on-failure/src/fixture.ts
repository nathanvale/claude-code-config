#!/usr/bin/env bun
// bad-envelope-on-failure runnable. The `check` command always reports a finding
// (exit 1) — the failure path. Under --json it emits MALFORMED output instead of
// a valid structured error envelope, which the json-valid-under-failure surface
// clause MUST flag. Without the invocation there is nothing to inspect, so the
// finding is surface by construction (KTD4).

const argv = Bun.argv.slice(2);
const json = argv.includes("--json");

// The check "fails" (finding present) → exit 1. This is the enumerated
// `check` / `check --json` invocation's failure path.
if (json) {
	// DEFECT: broken envelope — not valid JSON at all (truncated object).
	process.stdout.write('{"status": "error", "run_id":');
	process.exit(1);
}
process.stdout.write("finding present\n");
process.exit(1);
