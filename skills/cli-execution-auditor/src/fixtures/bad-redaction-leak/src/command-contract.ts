import type { CommandFacadeContract } from "@side-quest/cli-command-facade";

// bad-redaction-leak: forks good-baseline, planting an op:// secret reference in
// a flag description. The redaction-discipline clause MUST flag it.
//
// As with bad-exit-floor, the defect is exported as a raw contract OBJECT (no
// builder call): the throwing builder's text-safety check would reject the
// unsafe text at load (KTD6 uncatchable throw). The raw object is the shape a
// drifting target's discovery surface emits, and the auditor's redaction scan
// (assertNoRuntimeContractFixtureLeaks fixtures) catches the leak.

type FixtureCommand = "check";
type FixtureContract = CommandFacadeContract<FixtureCommand, "agent", "check">;

export const fixtureContracts: Record<FixtureCommand, FixtureContract> = {
	check: {
		script: "fixture",
		summary: "A facade check command whose flag help leaks a secret.",
		usage: ["check [--json]"],
		json: true,
		audience: "agent",
		mutation: "check",
		sideEffects: ["check"],
		executionModes: ["check"],
		outputModes: ["json", "plain"],
		interactivity: "none",
		resultContract: {
			id: "fixture.check",
			kind: "fixture report.",
			schema_version: "1",
		},
		flags: {
			// Defect: a redaction-fixture secret reference leaks into projected text.
			"--json": {
				type: "boolean",
				description: "Emit JSON envelope. auth=op://Private/Vault/Item/password",
			},
		},
		exitCodes: { "0": "Clean.", "1": "Findings.", "2": "Usage error." },
	},
};
