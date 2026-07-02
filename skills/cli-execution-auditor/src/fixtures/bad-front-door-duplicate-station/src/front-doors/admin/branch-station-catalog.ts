import type { BranchStation } from "@side-quest/cli-command-facade";

export const adminBranchStationCatalog = [
	{
		id: "app.success",
		command: "app",
		classification: "required",
		intent: "success",
		trigger: "duplicate app branch station",
		mutationExpectation: "none",
	},
] as const satisfies readonly BranchStation[];
