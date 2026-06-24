import { afterEach, describe, expect, test } from "bun:test";
import type {
	BranchStation,
	BranchStationEvidence,
} from "@side-quest/cli-command-facade";
import {
	assertStationEnvelope,
	buildStationEvidence,
	type CliProcessResult,
} from "@side-quest/cli-command-facade/testing";
import { runForTest } from "./browser-use";
import type { BrowserUseRuntime } from "./browser-use-runtime";
import {
	cleanupWarmRuntimePaths,
	configStdout,
	okCommand,
	warmRuntime,
} from "./browser-use-warm-test-helpers";
import {
	browserUseWarmStartBranchStationCatalog,
	findBrowserUseWarmStartBranchStationCatalogDrift,
	projectBrowserUseWarmStartStationMap,
} from "./browser-use-warm-station-catalog";

afterEach(async () => {
	await cleanupWarmRuntimePaths();
});

describe("browser-use warm start Branch Station integration", () => {
	test("scenario map keys match station ids exactly", () => {
		expect(Object.keys(stationScenarios).sort()).toEqual(
			browserUseWarmStartBranchStationCatalog
				.map((station) => station.id)
				.sort(),
		);
	});

	test("catalog-driven warm start scenarios cover every required station", async () => {
		const evidence: BranchStationEvidence[] = [];
		for (const station of browserUseWarmStartBranchStationCatalog) {
			evidence.push(await stationScenarios[station.id](station));
		}

		expect(findBrowserUseWarmStartBranchStationCatalogDrift(evidence)).toEqual([]);
		const map = projectBrowserUseWarmStartStationMap(evidence);
		expect(map.findings).toEqual([]);
		expect(
			map.stations.every((station) => station.evidence.status === "covered"),
		).toBe(true);
	});
});

const stationScenarios: Record<
	(typeof browserUseWarmStartBranchStationCatalog)[number]["id"],
	(station: BranchStation) => Promise<BranchStationEvidence>
> = {
	"warm-start.ready": async (station) => {
		const { runtime } = await warmRuntime();
		return runStation(station, runtime, [
			"warm",
			"start",
			"--profile",
			runtime.env.BROWSER_USE_PROFILE_DIR ?? "",
			"--json",
		]);
	},
	"warm-start.stale_config": async (station) => {
		const { runtime } = await warmRuntime({
			commandResponses: {
				"mcporter config get chrome-devtools --json": [
					okCommand(configStdout("9223")),
				],
			},
		});
		return runStation(station, runtime, [
			"warm",
			"start",
			"--profile",
			runtime.env.BROWSER_USE_PROFILE_DIR ?? "",
			"--json",
		]);
	},
	"warm-start.repair_config": async (station) => {
		const { runtime } = await warmRuntime({
			commandResponses: {
				"mcporter config get chrome-devtools --json": [
					okCommand(configStdout("9223")),
					okCommand(configStdout("9223")),
					okCommand(configStdout("9222")),
				],
				"mcporter config set chrome-devtools --browserUrl http://127.0.0.1:9222 --json": [
					okCommand("{}"),
				],
				"mcporter call chrome-devtools.list_pages --args {} --output json": [
					okCommand(JSON.stringify({ pages: [{ id: "page-1" }] })),
				],
			},
		});
		return runStation(station, runtime, [
			"warm",
			"start",
			"--profile",
			runtime.env.BROWSER_USE_PROFILE_DIR ?? "",
			"--repair-adapter-config",
			"--json",
		]);
	},
	"warm-start.repair_abort": async (station) => {
		const { runtime } = await warmRuntime({
			commandResponses: {
				"mcporter config get chrome-devtools --json": [
					okCommand(configStdout("9223")),
					okCommand(JSON.stringify({ args: ["chrome-devtools-mcp"] })),
				],
			},
		});
		return runStation(station, runtime, [
			"warm",
			"start",
			"--profile",
			runtime.env.BROWSER_USE_PROFILE_DIR ?? "",
			"--repair-adapter-config",
			"--json",
		]);
	},
	"warm-start.sticky_daemon_retry": async (station) => {
		const { runtime } = await warmRuntime({
			commandResponses: {
				"mcporter config get chrome-devtools --json": [
					okCommand(configStdout("9222")),
					okCommand(configStdout("9222")),
				],
				"mcporter call chrome-devtools.list_pages --args {} --output json": [
					{ exitCode: 1, stdout: "", stderr: "connection failed" },
					okCommand(JSON.stringify({ pages: [{ id: "page-1" }] })),
				],
				"mcporter daemon restart": [okCommand("{}")],
			},
		});
		return runStation(station, runtime, [
			"warm",
			"start",
			"--profile",
			runtime.env.BROWSER_USE_PROFILE_DIR ?? "",
			"--json",
		]);
	},
	"warm-start.inspect_diagnostics": async (station) => {
		const { runtime } = await warmRuntime({
			commandResponses: {
				"mcporter config get chrome-devtools --json": [
					okCommand(configStdout("9222")),
				],
				"mcporter call chrome-devtools.list_pages --args {} --output json": [
					{ exitCode: 1, stdout: "", stderr: "", timedOut: true },
				],
			},
		});
		return runStation(station, runtime, [
			"warm",
			"start",
			"--profile",
			runtime.env.BROWSER_USE_PROFILE_DIR ?? "",
			"--json",
		]);
	},
};

async function runStation(
	station: BranchStation,
	runtime: BrowserUseRuntime,
	argv: string[],
): Promise<BranchStationEvidence> {
	const result = await runForTest(argv, runtime);
	const processResult: CliProcessResult = {
		label: station.id,
		argv: ["browser-use", ...argv],
		cwd: process.cwd(),
		exitCode: result.exitCode,
		stdout: result.stdout,
		stderr: result.stderr,
		timedOut: false,
		signal: null,
		timeoutMs: 0,
	};
	const envelope = assertStationEnvelope(station, processResult);
	return buildStationEvidence(station, processResult, envelope);
}
