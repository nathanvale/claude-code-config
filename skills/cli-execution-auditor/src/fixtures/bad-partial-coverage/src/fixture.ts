#!/usr/bin/env bun
// bad-partial-coverage runnable (heal bug c shape). The `check` command DECLARES
// four test suites but runs only one, then reports healthy (exit 0). It emits a
// coverage signal ("ran 1 of 4") that the declared-coverage-runs surface clause
// MUST flag. Without running the command there is no coverage signal to inspect,
// so the finding is surface by construction (KTD4).

const DECLARED_SUITES = ["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts"];

const argv = Bun.argv.slice(2);
const json = argv.includes("--json");

// DEFECT: exercise only the first suite, but report healthy.
const ran = 1;
const declared = DECLARED_SUITES.length;

if (json) {
	process.stdout.write(
		JSON.stringify({ status: "ok", coverage: `ran ${ran} of ${declared}` }),
	);
} else {
	process.stdout.write(`healthy — coverage ran ${ran} of ${declared} suites\n`);
}
process.exit(0);
