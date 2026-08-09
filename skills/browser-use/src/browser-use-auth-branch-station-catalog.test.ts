import { describe, expect, test } from "bun:test";
import type {
	BranchStation,
	BranchStationEvidence,
} from "@side-quest/cli-command-facade";
import {
	browserUseAuthBranchStationCatalog,
	findBrowserUseAuthBranchStationCatalogDrift,
	projectBrowserUseAuthStationMap,
} from "./browser-use-auth-branch-station-catalog";

describe("auth login Branch Station catalog", () => {
	test("catalog reconciles with live command discovery", () => {
		expect(findBrowserUseAuthBranchStationCatalogDrift()).toEqual([]);
		expect(browserUseAuthBranchStationCatalog.map(({ id }) => id)).toEqual([
			"auth-login.help",
			"auth-login.authority_unavailable",
			"auth-login.success",
		]);
	});

	test("station map claims only declared branch coverage", () => {
		const evidence: BranchStationEvidence[] =
			browserUseAuthBranchStationCatalog.map((station: BranchStation) => ({
				stationId: station.id,
				status: "covered",
				observedExitCode: station.expectedExitCode,
				...(station.expectedEnvelopeStatus === undefined
					? {}
					: { observedEnvelopeStatus: station.expectedEnvelopeStatus }),
				...(station.expectedResultContractId === undefined
					? {}
					: { observedResultContractId: station.expectedResultContractId }),
				...(station.expectedActionId === undefined
					? {}
					: { observedActionId: station.expectedActionId }),
				...(station.expectedContinuationId === undefined
					? {}
					: { observedContinuationId: station.expectedContinuationId }),
			}));
		const map = projectBrowserUseAuthStationMap(evidence);
		expect(map.completeness_claim).toBe("declared_branch_coverage");
		expect(map.findings).toEqual([]);
	});
});
