// target-contract — acquire a facade target's contract safely (plan KTD6).
//
// Importing a target's contract module directly is unsafe two ways:
//   1. No naming convention — `healSkillContracts`, `fallowRunnerContracts`,
//      `testRunnerContracts` are all ad hoc; no manifest points to the export.
//   2. Targets build their contract with the THROWING defineCommandFacadeContract
//      at module top-level, so importing a *drifting* target throws
//      CliRuntimeContractError at load — before the auditor can detect the drift
//      it exists to find.
//
// Resolution (KTD6 intent, adapted to the no-discovery-subcommand reality): run
// the acquisition in a SUBPROCESS that imports the target's command-contract
// module, finds the contract object BY SHAPE (not by export name), validates it
// with the NO-THROW parseCommandFacadeContract, and prints the result as JSON. A
// drifting target's drift becomes captured data on stdout; a hard load throw
// becomes a captured error on the subprocess — never a crash of the auditor.

import { dirname, join } from "node:path";

const ACQUIRE_WORKER = join(
	dirname(Bun.fileURLToPath(import.meta.url)),
	"acquire-contract-worker.ts",
);

/** A facade command contract, shaped as the target declares it. */
// biome-ignore lint/suspicious/noExplicitAny: the target's contract is foreign data.
export type AcquiredCommandContract = Record<string, any>;

export type ContractAcquisition =
	| {
			ok: true;
			/** The contract object, keyed by command name. */
			contracts: Record<string, AcquiredCommandContract>;
			/** Drift issues from the no-throw parse (empty when the contract is clean). */
			driftCodes: string[];
	  }
	| {
			ok: false;
			/** Why acquisition failed (no contract module, hard load throw, etc.). */
			reason: string;
			/** Drift codes if the failure was a parse drift surfaced as data. */
			driftCodes?: string[];
	  };

/**
 * Acquire a target's contract by spawning the worker. `contractPath` is the
 * target's command-contract.ts (resolved by the engine via lane detection).
 */
export async function acquireTargetContract(contractPath: string): Promise<ContractAcquisition> {
	const proc = Bun.spawn(["bun", "run", ACQUIRE_WORKER, contractPath], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	if (exitCode !== 0) {
		// A hard load throw (drifting target built with defineCommandFacadeContract)
		// lands here as captured stderr — data, not an auditor crash.
		return {
			ok: false,
			reason: stderr.trim() || `acquisition worker exited ${exitCode}`,
		};
	}

	try {
		const parsed = JSON.parse(stdout) as ContractAcquisition;
		return parsed;
	} catch {
		return { ok: false, reason: `acquisition worker produced unparseable output` };
	}
}

/**
 * Find the facade contract export in a target module by SHAPE, not name (KTD6:
 * no naming convention). The contract is the exported object whose values all
 * look like facade command contracts (have `script`, `summary`, `flags`,
 * `exitCodes`). Returns the first such export, or null.
 */
export function findContractByShape(
	moduleExports: Record<string, unknown>,
): Record<string, AcquiredCommandContract> | null {
	for (const value of Object.values(moduleExports)) {
		if (!value || typeof value !== "object") continue;
		const entries = Object.values(value as Record<string, unknown>);
		if (entries.length === 0) continue;
		const allLookLikeContracts = entries.every((entry) => isCommandContractShape(entry));
		if (allLookLikeContracts) {
			return value as Record<string, AcquiredCommandContract>;
		}
	}
	return null;
}

function isCommandContractShape(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.script === "string" &&
		typeof record.summary === "string" &&
		typeof record.flags === "object" &&
		typeof record.exitCodes === "object"
	);
}
