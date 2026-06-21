import type { BranchStationEvidence } from "@side-quest/cli-command-facade";

export const adminBranchStationEvidence = [
	{
		stationId: "admin.success",
		status: "covered",
		observedExitCode: 0,
		observedEnvelopeStatus: "ok",
		observedResultContractId: "fixture.admin",
	},
] as const satisfies readonly BranchStationEvidence[];
