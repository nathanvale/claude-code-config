import type { BranchStation } from "@side-quest/cli-command-facade";

export const fixtureBranchStationCatalog = [
	{
		id: "check.zeta",
		command: "check",
		classification: "required",
		intent: "success",
		trigger: "valid check command exits clean",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: "fixture.check",
		mutationExpectation: "none",
	},
	{
		id: "check.alpha",
		command: "check",
		classification: "required",
		intent: "usage_failure",
		trigger: "invalid check flag returns usage envelope",
		expectedExitCode: 2,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: "fixture.check",
		expectedErrorCode: "usage_error",
		mutationExpectation: "blocked_before_write",
	},
] as const satisfies readonly BranchStation[];
