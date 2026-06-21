import type { BranchStationEvidence } from "@side-quest/cli-command-facade";

export function collectStorybookDoctorEvidence(
	testResults: readonly StationTestResult[],
): BranchStationEvidence[] {
	return testResults.map((r) => ({
		stationId: r.stationId,
		status: r.status,
		observedExitCode: r.exitCode,
		observedEnvelopeStatus: r.envelopeStatus,
		observedResultContractId: r.resultContractId,
		observedErrorCode: r.errorCode,
		rationale: r.rationale,
	}));
}

export type StationTestResult = {
	readonly stationId: string;
	readonly status: "covered" | "skipped" | "declared-unreachable";
	readonly exitCode?: number;
	readonly envelopeStatus?: "ok" | "error";
	readonly resultContractId?: string;
	readonly errorCode?: string;
	readonly rationale?: string;
};
