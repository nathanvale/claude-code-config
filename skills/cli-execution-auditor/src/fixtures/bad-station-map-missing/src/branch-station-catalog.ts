import type { BranchStation } from "@side-quest/cli-command-facade";

export const fixtureBranchStationCatalog = [
	{
		id: "check.success",
		command: "check",
		classification: "required",
		intent: "success",
		trigger: "valid check command exits clean",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: "fixture.check",
		mutationExpectation: "none",
	},
] as const satisfies readonly BranchStation[];
