import { describe, expect, test } from "bun:test";
import type { BranchStation, BranchStationEvidence } from "@side-quest/cli-command-facade";

import {
	VAULT_GIT_STATION_IDS,
	findVaultGitBranchStationCatalogDrift,
	projectVaultGitStationMap,
	vaultGitBranchStationCatalog,
} from "../src/branch-station-catalog.ts";
import {
	VAULT_GIT_COMMANDS,
	projectVaultGitCommandDiscoveryTree,
} from "../src/command-contract.ts";

const stations: readonly BranchStation[] = vaultGitBranchStationCatalog;

describe("vault-git Branch Station Catalog", () => {
	test("declares every U1 read, discovery, refusal, and usage station", () => {
		expect(VAULT_GIT_STATION_IDS).toEqual([
			"status.dashboard",
			"status.read_only",
			"status.invalid_usage",
			"preview.read_only",
			"doctor.read_only",
			"commands.discovery",
			"begin.unavailable",
			"join.unavailable",
			"complete.unavailable",
			"repair.unavailable",
			"tidy.invalid_usage",
			"tidy.unavailable",
			"janitor.unavailable",
		]);
	});

	test("reconciles the catalog against live command discovery", () => {
		expect(findVaultGitBranchStationCatalogDrift()).toEqual([]);
		const discovery = projectVaultGitCommandDiscoveryTree();
		const commands = new Set<string>(VAULT_GIT_COMMANDS);
		for (const station of stations) {
			expect(commands.has(station.command)).toBe(true);
			expect(discovery.commands[station.command as never]).toBeDefined();
			expect(station.id.split(".")[0]).toBe(station.command);
		}
	});

	test("projects only declared branch coverage", () => {
		const stationMap = projectVaultGitStationMap();
		expect(stationMap.completeness_claim).toBe("declared_branch_coverage");
		expect(stationMap.stations).toHaveLength(VAULT_GIT_STATION_IDS.length);
		expect(stationMap.findings.every((finding) => finding.finding_kind === "missing")).toBe(
			true,
		);
	});

	test("accepts matching synthetic evidence for every declared station", () => {
		const evidence: BranchStationEvidence[] = vaultGitBranchStationCatalog.map(
			(station) => ({
				stationId: station.id,
				status: "covered",
				...(station.expectedExitCode === undefined
					? {}
					: { observedExitCode: station.expectedExitCode }),
				...(station.expectedEnvelopeStatus === undefined
					? {}
					: { observedEnvelopeStatus: station.expectedEnvelopeStatus }),
				...(station.expectedResultContractId === undefined
					? {}
					: { observedResultContractId: station.expectedResultContractId }),
				...(station.expectedErrorCode === undefined
					? {}
					: { observedErrorCode: station.expectedErrorCode }),
			}),
		);
		expect(projectVaultGitStationMap(evidence).findings).toEqual([]);
	});

	test("keeps every mutating station at a no-write unavailable outcome", () => {
		const mutating = stations.filter((station) =>
			["begin", "join", "complete", "repair", "tidy", "janitor"].includes(
				station.command,
			),
		);
		for (const station of mutating) {
			if (station.intent === "usage_failure") continue;
			expect(station.expectedEnvelopeStatus).toBe("error");
			expect(station.expectedErrorCode).toBe("runtime_unavailable");
			expect(station.mutationExpectation).toBe("refuses_before_state_access");
		}
	});
});
