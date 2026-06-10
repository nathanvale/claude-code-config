import type { CommandFacadeContract } from "@side-quest/cli-command-facade";

// bad-exit-floor: forks good-baseline, dropping baseline exit code "2" (usage).
//
// The defect must surface as PARSEABLE drift, not an uncatchable import throw
// (KTD6): the throwing defineCommandFacadeContract would reject this at load
// before the auditor could see it. So the fixture exports the raw contract
// OBJECT (no builder call) — exactly the shape a target's discovery surface
// would emit. The auditor's no-throw parse (in the acquisition worker) then
// finds the missing-baseline drift, and the exit-floor clause flags it.

type FixtureCommand = "check";
type FixtureContract = CommandFacadeContract<FixtureCommand, "agent", "check">;

export const fixtureContracts: Record<FixtureCommand, FixtureContract> = {
	check: {
		script: "fixture",
		summary: "A facade check command missing the usage exit code.",
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
			"--json": { type: "boolean", description: "Emit JSON envelope." },
		},
		// Defect: exit code "2" (usage) is absent — violates the 0/1/2 floor.
		exitCodes: { "0": "Clean.", "1": "Findings." },
	},
};
