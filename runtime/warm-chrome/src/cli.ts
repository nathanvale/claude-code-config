#!/usr/bin/env bun

// U1 scaffold stub. U2 lands the facade command contract; U4 lands the
// runtime seam and real entrypoint. Until then the bin exits with usage
// semantics so a linked bin never pretends to prove anything.
const USAGE_EXIT_CODE = 2;

if (import.meta.main) {
	process.stderr.write(
		"warm-chrome: not yet implemented (scaffold stub; see runtime/warm-chrome)\n",
	);
	process.exit(USAGE_EXIT_CODE);
}
