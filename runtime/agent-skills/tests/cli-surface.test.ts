import { describe, expect, test } from "bun:test";
import {
	projectCommandDiscoveryTree,
	renderCommandUsage,
} from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";

import {
	findAgentSkillsBranchStationCatalogDrift,
	projectAgentSkillsStationMap,
} from "../src/branch-station-catalog.ts";
import {
	agentSkillsContractEntries,
	agentSkillsContracts,
} from "../src/command-contract.ts";

describe("agent-skills CLI surface", () => {
	test("every advertised flag appears in rendered help", () => {
		for (const command of Object.keys(agentSkillsContracts) as Array<
			keyof typeof agentSkillsContracts
		>) {
			const help = renderCommandUsage(agentSkillsContracts[command]);
			assertCommandHelpFlagSurface({
				command,
				contract: agentSkillsContracts[command],
				help,
			});
		}
	});

	test("facade discovery exposes every public command", () => {
		const discovery = projectCommandDiscoveryTree(agentSkillsContractEntries);

		expect(Object.keys(discovery.commands).sort()).toEqual([
			"commands",
			"ignore",
			"list",
			"status",
			"sync",
			"unlink",
		]);
		expect(discovery.commands.sync?.usage).toContain(
			"agent-skills sync --check --json",
		);
	});

	test("mutating commands declare write side effects and safe actions", () => {
		for (const command of ["sync", "ignore", "unlink"] as const) {
			expect(agentSkillsContracts[command].sideEffects).toContain("write");
		}
		expect(agentSkillsContracts.sync.actionAffordances?.failure?.[0]?.id).toBe(
			"inspect_blocker",
		);
		expect(agentSkillsContracts.ignore.actionAffordances?.success?.[0]?.id).toBe(
			"sync",
		);
	});

	test("Branch Station Catalog reconciles with discovery metadata", () => {
		expect(findAgentSkillsBranchStationCatalogDrift()).toEqual([]);
		const stationMap = projectAgentSkillsStationMap();

		expect(stationMap.findings.map((finding) => finding.station_id).sort()).toEqual(
			[
				"status.clean",
				"status.invalid_config",
				"sync.invalid_usage",
				"sync.needs_sync",
				"sync.synced",
				"sync.unmanaged_blocker",
			],
		);
	});
});
