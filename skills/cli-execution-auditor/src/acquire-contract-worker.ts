#!/usr/bin/env bun
// acquire-contract-worker — runs in a SUBPROCESS (plan KTD6).
//
// Imports a target's command-contract module, finds its facade contract by
// shape, runs the no-throw parse, and prints a ContractAcquisition JSON to
// stdout. Isolation is the point: if importing the target THROWS (a drifting
// target built with the throwing defineCommandFacadeContract), the crash is
// confined to this worker — the parent reads a non-zero exit + stderr and
// records ok:false, instead of the auditor itself dying at load.

import { parseCommandFacadeContract } from "@side-quest/cli-command-facade";
import { type ContractAcquisition, findContractByShape } from "./target-contract.ts";

async function main(): Promise<void> {
	const contractPath = Bun.argv[2];
	if (!contractPath) {
		process.stderr.write("acquire-contract-worker: missing contract path argument\n");
		process.exit(2);
	}

	// The import may throw (drifting target). Let it: the parent treats a non-zero
	// exit as ok:false with the captured stderr. We do NOT catch here, so the
	// throw's own message reaches stderr verbatim.
	const moduleExports = (await import(contractPath)) as Record<string, unknown>;

	const shape = findContractByShape(moduleExports);
	if (shape.kind === "none") {
		const result: ContractAcquisition = {
			ok: false,
			reason: "no facade contract export found (no object whose values are command contracts)",
		};
		process.stdout.write(JSON.stringify(result));
		return;
	}
	if (shape.kind === "ambiguous") {
		const result: ContractAcquisition = {
			ok: false,
			reason: `ambiguous facade contract: ${shape.count} shape-matching exports — export exactly one command contract object so the auditor exercises the real surface, not a decoy`,
		};
		process.stdout.write(JSON.stringify(result));
		return;
	}

	// The acquired contract is foreign runtime data shaped like a facade contract;
	// parseCommandFacadeContract is exactly what validates that shape, so the cast
	// is the boundary between untyped acquisition and typed validation.
	const parsed = parseCommandFacadeContract(
		// biome-ignore lint/suspicious/noExplicitAny: foreign contract validated by this call.
		shape.contracts as any,
	);
	const contracts = shape.contracts;
	const driftCodes = parsed.ok ? [] : parsed.issues.map((issue) => issue.category);
	const result: ContractAcquisition = { ok: true, contracts, driftCodes };
	process.stdout.write(JSON.stringify(result));
}

await main();
