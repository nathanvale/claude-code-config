import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";

type AdminCommand = "admin";
type AdminContract = CommandFacadeContract<AdminCommand, "agent", "check">;

export const adminContracts = defineCommandFacadeContract(
	{
		admin: {
			script: "admin",
			summary: "Check the admin CLI Front Door.",
			usage: ["admin [--json]"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract: {
				id: "fixture.admin",
				kind: "fixture report.",
				schema_version: "1",
			},
			flags: {
				"--json": { type: "boolean", description: "Emit JSON envelope." },
			},
			exitCodes: { "0": "Clean.", "1": "Findings.", "2": "Usage error." },
		},
	} as const satisfies Record<AdminCommand, AdminContract>,
	{
		path: "src/front-doors/admin/command-contract.ts",
		writeImplyingMutations: new Set(["write", "destructive"]),
	},
);
