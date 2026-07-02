import type { BranchStationEvidence } from "@side-quest/cli-command-facade";

export const appBranchStationEvidence = [
	{
		stationId: "app.success",
		status: "covered",
		observedExitCode: 0,
		observedEnvelopeStatus: "ok",
		observedResultContractId: "fixture.app",
	},
] as const satisfies readonly BranchStationEvidence[];
