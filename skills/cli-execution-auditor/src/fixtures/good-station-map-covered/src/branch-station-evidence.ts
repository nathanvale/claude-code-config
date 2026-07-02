import type { BranchStationEvidence } from "@side-quest/cli-command-facade";

export const fixtureBranchStationEvidence = [
	{
		stationId: "check.zeta",
		status: "covered",
		observedExitCode: 0,
		observedEnvelopeStatus: "ok",
		observedResultContractId: "fixture.check",
	},
	{
		stationId: "check.alpha",
		status: "covered",
		observedExitCode: 2,
		observedEnvelopeStatus: "error",
		observedResultContractId: "fixture.check",
		observedErrorCode: "usage_error",
	},
] as const satisfies readonly BranchStationEvidence[];
