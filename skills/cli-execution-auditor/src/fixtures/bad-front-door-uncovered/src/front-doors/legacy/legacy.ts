#!/usr/bin/env bun
// A real, shippable front-door CLI with NO command-contract.ts beside it. The
// audit universe is contract-derived, so without reconciliation this surface is
// silently excluded — the auditor would report the target clean while legacy
// goes unaudited (adversarial finding A: silent coverage drop).

function main(): number {
	const json = Bun.argv.includes("--json");
	if (json) {
		// Deliberately NOT a valid runtime envelope — proof this surface would slip
		// through json-valid-under-failure if it were never exercised.
		process.stdout.write('{"legacy": true}\n');
	} else {
		process.stdout.write("legacy clean\n");
	}
	return 0;
}

process.exit(main());
