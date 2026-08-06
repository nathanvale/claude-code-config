import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";

// Known-good minimal facade contract (R9 oracle). The auditor MUST pass this
// with zero findings. Each bad-* fixture forks ONLY this file (or adds a single
// defective source file) so the corpus isolates one clause per fixture.

type FixtureCommand = "check";
type FixtureContract = CommandFacadeContract<FixtureCommand, "agent", "check">;

export const fixtureContracts = defineCommandFacadeContract(
	{
		check: {
			script: "fixture",
			summary: "A clean minimal facade check command.",
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
			exitCodes: { "0": "Clean.", "1": "Findings.", "2": "Usage error." },
		},
	} as const satisfies Record<FixtureCommand, FixtureContract>,
	{
		path: "src/command-contract.ts",
		writeImplyingMutations: new Set(["write", "destructive"]),
	},
);
