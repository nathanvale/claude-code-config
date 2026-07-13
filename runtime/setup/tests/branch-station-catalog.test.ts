import { describe, expect, test } from "bun:test";
import type { BranchStation } from "@side-quest/cli-command-facade";

import {
	findSetupBranchStationCatalogDrift,
	projectSetupStationMap,
	setupBranchStationCatalog,
} from "../src/branch-station-catalog.ts";
import {
	SETUP_COMMANDS_CONTRACT_ID,
	SETUP_ACTION_IDS,
	SETUP_COMMANDS,
	SETUP_RESULT_CONTRACT_ID,
} from "../src/model.ts";

const EXPECTED_STATION_IDS = [
	"status.healthy", "status.clean_slate", "status.drift", "status.blocked",
	"status.invalid_target", "status.invalid_usage", "status.runtime_failure",
	"doctor.healthy", "doctor.repairable", "doctor.blocked", "doctor.duplicate_scope",
	"doctor.setup_dependency_unhealthy", "doctor.invalid_target",
	"doctor.stale_operation_lock", "doctor.invalid_usage", "doctor.runtime_failure",
	"sync.check_clean", "sync.check_changes", "sync.check_blocked", "sync.check_invalid_target",
	"sync.applied", "sync.noop", "sync.partial", "sync.blocked", "sync.concurrent_change",
	"sync.operation_busy", "sync.invalid_target", "sync.apply_failure", "sync.hook_failure",
	"sync.instruction_failure", "sync.runbook_failure", "sync.invalid_usage", "sync.runtime_failure",
	"unlink.check_removable", "unlink.check_noop", "unlink.check_blocked", "unlink.check_invalid_target",
	"unlink.removed", "unlink.noop", "unlink.concurrent_change", "unlink.operation_busy",
	"unlink.invalid_target", "unlink.partial_failure", "unlink.invalid_usage", "unlink.runtime_failure",
	"catalog.listed", "catalog.matched", "catalog.blocked", "catalog.not_found", "catalog.invalid_target",
	"catalog.invalid_usage", "catalog.runtime_failure", "commands.catalog",
	"commands.invalid_usage", "commands.runtime_failure",
] as const;

describe("setup Branch Station Catalog", () => {
	test("transcribes every planned terminal station with zero discovery drift", () => {
		expect(setupBranchStationCatalog.map((station) => station.id)).toEqual([
			...EXPECTED_STATION_IDS,
		]);
		expect(findSetupBranchStationCatalogDrift()).toEqual([]);
	});

	test("projects every public command and every station as missing before process evidence", () => {
		const map = projectSetupStationMap();
		expect(Object.keys(map.commands)).toEqual([...SETUP_COMMANDS].sort());
		expect(map.stations).toHaveLength(EXPECTED_STATION_IDS.length);
		expect(map.findings.every((finding) => finding.finding_kind === "missing")).toBe(true);
	});

	test("pins result contracts, baseline exits, errors, actions, and mutation expectations", () => {
		const stations: readonly BranchStation[] = setupBranchStationCatalog;
		const actions = new Set<string>(SETUP_ACTION_IDS);
		for (const station of stations) {
			expect(station.expectedResultContractId).toBe(
				station.id === "commands.catalog"
					? SETUP_COMMANDS_CONTRACT_ID
					: SETUP_RESULT_CONTRACT_ID,
			);
			expect(station.expectedExitCode).toBeDefined();
			expect([0, 1, 2]).toContain(station.expectedExitCode as number);
			expect(station.mutationExpectation.length).toBeGreaterThan(0);
			if (station.expectedActionId) expect(actions.has(station.expectedActionId)).toBe(true);
			if (station.expectedEnvelopeStatus === "error") {
				const expectedCode = station.id.endsWith("check_invalid_target")
					? "invalid_target"
					: station.id.split(".").at(-1);
				expect(station.expectedErrorCode).toBe(expectedCode);
			}
		}
	});
});
