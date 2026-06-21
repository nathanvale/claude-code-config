import type { BranchStation } from "@side-quest/cli-command-facade";

export const appBranchStationCatalog = [
	{
		id: "app.success",
		command: "app",
		classification: "required",
		intent: "success",
		trigger: "valid app command exits clean",
		mutationExpectation: "none",
	},
] as const satisfies readonly BranchStation[];
