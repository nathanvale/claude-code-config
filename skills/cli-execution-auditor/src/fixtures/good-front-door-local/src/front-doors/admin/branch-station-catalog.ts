import type { BranchStation } from "@side-quest/cli-command-facade";

export const adminBranchStationCatalog = [
	{
		id: "admin.success",
		command: "admin",
		classification: "required",
		intent: "success",
		trigger: "valid admin command exits clean",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: "fixture.admin",
		mutationExpectation: "none",
	},
] as const satisfies readonly BranchStation[];
