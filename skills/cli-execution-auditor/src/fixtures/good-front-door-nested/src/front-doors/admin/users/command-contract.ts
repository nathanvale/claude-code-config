import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";

type UsersCommand = "users";
type UsersContract = CommandFacadeContract<UsersCommand, "agent", "check">;

export const usersContracts = defineCommandFacadeContract(
	{
		users: {
			script: "users",
			summary: "Check the grouped users CLI Front Door.",
			usage: ["users [--json]"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract: {
				id: "fixture.users",
				kind: "fixture report.",
				schema_version: "1",
			},
			flags: {
				"--json": { type: "boolean", description: "Emit JSON envelope." },
			},
			exitCodes: { "0": "Clean.", "1": "Findings.", "2": "Usage error." },
		},
	} as const satisfies Record<UsersCommand, UsersContract>,
	{
		path: "src/front-doors/admin/users/command-contract.ts",
		writeImplyingMutations: new Set(["write", "destructive"]),
	},
);
