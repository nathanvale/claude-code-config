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
	test("declares every complete CLI read, mutation, refusal, and usage station", () => {
		expect(VAULT_GIT_STATION_IDS).toEqual([
			"status.dashboard",
			"status.read_only",
			"status.invalid_usage",
			"activation.inspect",
			"activation.prepare",
			"activation.review_noninteractive",
			"activation.review_activate",
			"activation.defer",
			"activation.revoke",
			"activation.invalid_usage",
			"preview.read_only",
			"doctor.private_task_reconciliation",
			"commands.discovery",
			"begin.admitted",
			"join.joined",
			"complete.completed",
			"complete.join_role_refused",
			"repair.action_required",
			"repair.join_role_refused",
			"repair.stale_takeover_usage",
			"tidy.invalid_usage",
			"tidy.preview",
			"janitor.preview",
		]);
	});

	test("declares Doctor's bounded owner-private evidence write without canonical authority", () => {
		const doctor = stations.find(
			(station) => station.id === "doctor.private_task_reconciliation",
		);
		expect(doctor).toMatchObject({
			command: "doctor",
			mutationExpectation: "owner_private_task_evidence_only",
		});
		expect(doctor?.trigger).toContain("without canonical, vault, or remote mutation");
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

	test("removes the U7 runtime-unavailable worker stations", () => {
		const unavailable = stations.filter(
			(station) => station.expectedErrorCode === "runtime_unavailable",
		);
		expect(unavailable.map((station) => station.id)).toEqual([]);
	});
});
