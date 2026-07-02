import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";

type AppCommand = "app";
type AppContract = CommandFacadeContract<AppCommand, "agent", "check">;

export const appContracts = defineCommandFacadeContract(
	{
		app: {
			script: "app",
			summary: "Check the app CLI Front Door.",
			usage: ["app [--json]"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract: {
				id: "fixture.app",
				kind: "fixture report.",
				schema_version: "1",
			},
			flags: {
				"--json": { type: "boolean", description: "Emit JSON envelope." },
			},
			exitCodes: { "0": "Clean.", "1": "Findings.", "2": "Usage error." },
		},
	} as const satisfies Record<AppCommand, AppContract>,
	{
		path: "src/front-doors/app/command-contract.ts",
		writeImplyingMutations: new Set(["write", "destructive"]),
	},
);
