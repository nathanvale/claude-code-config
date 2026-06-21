import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertStationEnvelope,
	buildSkippedStationEvidence,
	buildStationEvidence,
	describeCliProcessRun,
	runCliProcess,
	type CliProcessResult,
	type StationRuntimeEnvelope,
	type StationScenario,
} from "@side-quest/cli-command-facade/testing";
import type { BranchStationEvidence } from "@side-quest/cli-command-facade";
import {
	createCleanupRegistry,
	drainCleanup,
	makeTempDir,
	startFixtureServer,
	writeFakeToolBinary,
	writePackageJson,
} from "@side-quest/cli-test-fixtures";
import {
	storybookDoctorBranchStationCatalog,
	findStorybookDoctorBranchStationCatalogDrift,
	projectStorybookDoctorStationMap,
} from "../src/front-doors/storybook-doctor/branch-station-catalog.ts";

const RUNNER_PATH = fileURLToPath(
	new URL("../src/front-doors/storybook-doctor/cli.ts", import.meta.url),
);
const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url)).replace(
	/\/tests$/,
	"",
);

type StationId =
	(typeof storybookDoctorBranchStationCatalog)[number]["id"];

const MCP_TOOLS_RESPONSE = JSON.stringify({
	jsonrpc: "2.0",
	id: 1,
	result: { tools: [{ name: "screenshot" }, { name: "get_stories" }] },
});

// -- Cleanup --

const registry = createCleanupRegistry();

afterEach(() => {
	drainCleanup(registry);
});

// -- Domain-specific fixture helpers --

function writeStorybookConfig(dir: string, content: string): void {
	const configDir = join(dir, ".storybook");
	mkdirSync(configDir, { recursive: true });
	writeFileSync(join(configDir, "main.ts"), content);
}

function makeFullSetupDir(
	prefix: string,
	overrides: { scripts?: Record<string, string> } = {},
): string {
	const dir = makeTempDir(registry, prefix);
	writePackageJson(dir, {
		name: `test-${prefix}`,
		devDependencies: {
			storybook: "^8.0.0",
			"@storybook/addon-mcp": "^0.1.0",
		},
		scripts: overrides.scripts ?? { storybook: "storybook dev" },
	});
	writeStorybookConfig(
		dir,
		'export default { addons: ["@storybook/addon-mcp"] };',
	);
	return dir;
}

function mcpToolsHandler(req: Request): Response {
	const path = new URL(req.url).pathname;
	if (path === "/mcp" && req.method === "POST") {
		return new Response(MCP_TOOLS_RESPONSE, {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}
	return new Response("ok", { status: 200 });
}

function mcpMissingHandler(req: Request): Response {
	const path = new URL(req.url).pathname;
	if (path === "/mcp" && req.method === "POST") {
		return new Response("Not Found", { status: 404 });
	}
	return new Response("ok", { status: 200 });
}

// -- Process runner --

async function runDoctor(
	args: readonly string[],
	options: { label: string; cwd?: string },
): Promise<CliProcessResult> {
	return runCliProcess({
		label: options.label,
		argv: [process.execPath, RUNNER_PATH, ...args],
		cwd: options.cwd ?? PACKAGE_ROOT,
		timeoutMs: 15_000,
	});
}

// -- Assertion helpers --

function expectDataStatus(
	envelope: StationRuntimeEnvelope,
	result: CliProcessResult,
	status: string,
): void {
	expect(
		(envelope.data as Record<string, unknown>)?.status,
		describeCliProcessRun(result),
	).toBe(status);
}

// -- Station scenarios: static/filesystem --

async function runCheckNoPackageJson(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const dir = makeTempDir(registry, "no-pkg");
	const result = await runDoctor(
		["check", "--json", "--repo", dir],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	expectDataStatus(envelope, result, "blocked");
	return buildStationEvidence(station, result, envelope);
}

async function runCheckNoStorybookConfig(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const dir = makeTempDir(registry, "no-sb-config");
	writePackageJson(dir, {
		name: "test-no-config",
		devDependencies: {
			storybook: "^8.0.0",
			"@storybook/addon-mcp": "^0.1.0",
		},
	});
	const result = await runDoctor(
		["check", "--json", "--repo", dir],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	expectDataStatus(envelope, result, "blocked");
	return buildStationEvidence(station, result, envelope);
}

async function runCheckNoStorybookDependency(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const dir = makeTempDir(registry, "no-sb-dep");
	writePackageJson(dir, { name: "test-no-dep" });
	writeStorybookConfig(dir, "export default { addons: [] };");
	const result = await runDoctor(
		["check", "--json", "--repo", dir],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	expectDataStatus(envelope, result, "blocked");
	return buildStationEvidence(station, result, envelope);
}

async function runCheckNoMcpAddonDependency(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const dir = makeTempDir(registry, "no-mcp-dep");
	writePackageJson(dir, {
		name: "test-no-mcp-dep",
		devDependencies: { storybook: "^8.0.0" },
	});
	writeStorybookConfig(
		dir,
		'export default { addons: ["@storybook/addon-mcp"] };',
	);
	const result = await runDoctor(
		["check", "--json", "--repo", dir],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	expectDataStatus(envelope, result, "blocked");
	return buildStationEvidence(station, result, envelope);
}

async function runCheckNoMcpAddonConfig(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const dir = makeTempDir(registry, "no-mcp-config");
	writePackageJson(dir, {
		name: "test-no-mcp-config",
		devDependencies: {
			storybook: "^8.0.0",
			"@storybook/addon-mcp": "^0.1.0",
		},
	});
	writeStorybookConfig(dir, "export default { addons: [] };");
	const result = await runDoctor(
		["check", "--json", "--repo", dir],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	expectDataStatus(envelope, result, "blocked");
	return buildStationEvidence(station, result, envelope);
}

async function runCheckNonLoopbackUrl(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const dir = makeFullSetupDir("non-loopback");
	const result = await runDoctor(
		["check", "--json", "--url", "http://192.168.1.100:6006", "--repo", dir],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	expectDataStatus(envelope, result, "blocked");
	return buildStationEvidence(station, result, envelope);
}

async function runCheckInvalidRepo(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const dir = makeTempDir(registry, "invalid-repo");
	const result = await runDoctor(
		["check", "--json", "--repo", join(dir, "nonexistent-subdir")],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	expectDataStatus(envelope, result, "blocked");
	return buildStationEvidence(station, result, envelope);
}

// -- Station scenarios: help/version/commands --

async function runCommandsDiscoveryJson(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const result = await runDoctor(
		["commands", "--json"],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	return buildStationEvidence(station, result, envelope);
}

async function runCheckHelpTopLevel(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const result = await runDoctor(["--help"], { label: station.id });
	expect(result.exitCode, describeCliProcessRun(result)).toBe(
		station.expectedExitCode,
	);
	expect(result.stdout, describeCliProcessRun(result)).toContain("Usage:");
	return buildStationEvidence(station, result, {});
}

async function runCheckVersionStdout(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const result = await runDoctor(["--version"], { label: station.id });
	expect(result.exitCode, describeCliProcessRun(result)).toBe(
		station.expectedExitCode,
	);
	expect(result.stdout, describeCliProcessRun(result)).toContain(
		"storybook-doctor",
	);
	return buildStationEvidence(station, result, {});
}

// -- Station scenarios: fixture-server-backed --

async function runCheckReady(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const dir = makeFullSetupDir("ready");
	const { url } = startFixtureServer(registry, mcpToolsHandler);
	const result = await runDoctor(
		["check", "--json", "--url", url, "--repo", dir],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	const data = envelope.data as Record<string, unknown>;
	expect(data?.status, describeCliProcessRun(result)).toMatch(
		/^(ready|degraded)$/,
	);
	return buildStationEvidence(station, result, envelope);
}

async function runCheckNoStorybookScript(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const dir = makeFullSetupDir("no-script", { scripts: {} });
	const { url } = startFixtureServer(registry, mcpToolsHandler);
	const result = await runDoctor(
		["check", "--json", "--url", url, "--repo", dir],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	const data = envelope.data as Record<string, unknown>;
	expect(data?.status, describeCliProcessRun(result)).toBe("degraded");
	const findings = data?.findings as Array<Record<string, unknown>> | undefined;
	expect(
		findings?.some((f) => f.id === "no_storybook_script"),
		describeCliProcessRun(result),
	).toBe(true);
	return buildStationEvidence(station, result, envelope);
}

async function runCheckNoLiveSession(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const dir = makeFullSetupDir("no-session");
	const { url, server } = startFixtureServer(registry, mcpToolsHandler);
	server.stop(true);
	const result = await runDoctor(
		["check", "--json", "--url", url, "--repo", dir],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	expectDataStatus(envelope, result, "blocked");
	const findings = (envelope.data as Record<string, unknown>)?.findings as
		| Array<Record<string, unknown>>
		| undefined;
	expect(
		findings?.some((f) => f.id === "no_live_session"),
		describeCliProcessRun(result),
	).toBe(true);
	return buildStationEvidence(station, result, envelope);
}

async function runCheckManagerOkMcpMissing(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const dir = makeFullSetupDir("manager-ok-mcp-missing");
	const { url } = startFixtureServer(registry, mcpMissingHandler);
	const result = await runDoctor(
		["check", "--json", "--url", url, "--repo", dir],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	expectDataStatus(envelope, result, "blocked");
	const findings = (envelope.data as Record<string, unknown>)?.findings as
		| Array<Record<string, unknown>>
		| undefined;
	expect(
		findings?.some((f) => f.id === "manager_ok_mcp_missing"),
		describeCliProcessRun(result),
	).toBe(true);
	return buildStationEvidence(station, result, envelope);
}

async function runCheckMcpToolsReady(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const dir = makeFullSetupDir("mcp-ready");
	const { url } = startFixtureServer(registry, mcpToolsHandler);
	const result = await runDoctor(
		["check", "--json", "--url", url, "--repo", dir],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	const data = envelope.data as Record<string, unknown>;
	expect(data?.status, describeCliProcessRun(result)).toMatch(
		/^(ready|degraded)$/,
	);
	const findings = data?.findings as Array<Record<string, unknown>> | undefined;
	expect(
		findings?.some((f) => f.id === "mcp_tools_ready"),
		describeCliProcessRun(result),
	).toBe(true);
	return buildStationEvidence(station, result, envelope);
}

// -- Station scenarios: deep doctor with fixture server --

async function runDeepReadyWithLocalDoctor(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const dir = makeFullSetupDir("deep-ready");
	writeFakeToolBinary(dir, "storybook", "#!/bin/sh\necho 'Everything looks good'\nexit 0\n");
	const { url } = startFixtureServer(registry, mcpToolsHandler);
	const result = await runDoctor(
		["deep", "--json", "--url", url, "--repo", dir],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	const data = envelope.data as Record<string, unknown>;
	expect(data?.status, describeCliProcessRun(result)).toMatch(
		/^(ready|degraded)$/,
	);
	const deep = data?.deep as Record<string, unknown> | undefined;
	expect(deep?.local_binary_found, describeCliProcessRun(result)).toBe(true);
	expect(deep?.doctor_exit_code, describeCliProcessRun(result)).toBe(0);
	return buildStationEvidence(station, result, envelope);
}

async function runDeepLocalStorybookBinaryMissing(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const dir = makeFullSetupDir("deep-no-binary");
	const { url } = startFixtureServer(registry, mcpToolsHandler);
	const result = await runDoctor(
		["deep", "--json", "--url", url, "--repo", dir],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	const data = envelope.data as Record<string, unknown>;
	expect(data?.status, describeCliProcessRun(result)).toBe("degraded");
	const findings = data?.findings as Array<Record<string, unknown>> | undefined;
	expect(
		findings?.some((f) => f.id === "local_storybook_binary_missing"),
		describeCliProcessRun(result),
	).toBe(true);
	return buildStationEvidence(station, result, envelope);
}

async function runDeepStorybookDoctorNonzero(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const dir = makeFullSetupDir("deep-nonzero");
	writeFakeToolBinary(dir, "storybook", "#!/bin/sh\necho 'Found issues' >&2\nexit 1\n");
	const { url } = startFixtureServer(registry, mcpToolsHandler);
	const result = await runDoctor(
		["deep", "--json", "--url", url, "--repo", dir],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	const data = envelope.data as Record<string, unknown>;
	expect(data?.status, describeCliProcessRun(result)).toBe("degraded");
	const findings = data?.findings as Array<Record<string, unknown>> | undefined;
	expect(
		findings?.some((f) => f.id === "storybook_doctor_nonzero"),
		describeCliProcessRun(result),
	).toBe(true);
	const deep = data?.deep as Record<string, unknown> | undefined;
	expect(deep?.doctor_exit_code, describeCliProcessRun(result)).toBe(1);
	return buildStationEvidence(station, result, envelope);
}

async function runDeepDebugOutputTruncated(
	station: (typeof storybookDoctorBranchStationCatalog)[number],
): Promise<BranchStationEvidence> {
	const dir = makeFullSetupDir("deep-truncated");
	const hugeOutput = "A".repeat(16_384);
	writeFakeToolBinary(
		dir,
		"storybook",
		`#!/bin/sh\nprintf '%s' '${hugeOutput}'\nexit 0\n`,
	);
	const { url } = startFixtureServer(registry, mcpToolsHandler);
	const result = await runDoctor(
		["deep", "--json", "--url", url, "--repo", dir],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	const data = envelope.data as Record<string, unknown>;
	const findings = data?.findings as Array<Record<string, unknown>> | undefined;
	expect(
		findings?.some((f) => f.id === "debug_output_truncated"),
		describeCliProcessRun(result),
	).toBe(true);
	const deep = data?.deep as Record<string, unknown> | undefined;
	expect(deep?.truncated, describeCliProcessRun(result)).toBe(true);
	return buildStationEvidence(station, result, envelope);
}

// -- Station scenario map --

const REQUIRES_RUNTIME_ENVIRONMENT = "requires specific runtime environment state (commandExists)";

const stationScenarios: Record<StationId, StationScenario> = {
	"check.ready": { run: runCheckReady },
	"check.no_package_json": { run: runCheckNoPackageJson },
	"check.no_storybook_config": { run: runCheckNoStorybookConfig },
	"check.no_storybook_dependency": { run: runCheckNoStorybookDependency },
	"check.no_mcp_addon_dependency": { run: runCheckNoMcpAddonDependency },
	"check.no_mcp_addon_config": { run: runCheckNoMcpAddonConfig },
	"check.no_storybook_script": { run: runCheckNoStorybookScript },
	"check.no_live_session": { run: runCheckNoLiveSession },
	"check.non_loopback_url": { run: runCheckNonLoopbackUrl },
	"check.manager_ok_mcp_missing": { run: runCheckManagerOkMcpMissing },
	"check.mcp_tools_ready": { run: runCheckMcpToolsReady },
	"check.mcporter_missing_raw_mcp_ready": {
		run: (s) =>
			Promise.resolve(buildSkippedStationEvidence(s, REQUIRES_RUNTIME_ENVIRONMENT)),
	},
	"check.tmux_missing_hint": {
		run: (s) =>
			Promise.resolve(buildSkippedStationEvidence(s, REQUIRES_RUNTIME_ENVIRONMENT)),
	},
	"deep.ready_with_local_doctor": { run: runDeepReadyWithLocalDoctor },
	"deep.local_storybook_binary_missing": { run: runDeepLocalStorybookBinaryMissing },
	"deep.storybook_doctor_nonzero": { run: runDeepStorybookDoctorNonzero },
	"deep.debug_output_truncated": { run: runDeepDebugOutputTruncated },
	"commands.discovery_json": { run: runCommandsDiscoveryJson },
	"check.help_top_level": { run: runCheckHelpTopLevel },
	"check.version_stdout": { run: runCheckVersionStdout },
	"check.test_tools_missing": {
		run: (s) =>
			Promise.resolve(buildSkippedStationEvidence(s, REQUIRES_RUNTIME_ENVIRONMENT)),
	},
	"check.a11y_missing": {
		run: (s) =>
			Promise.resolve(buildSkippedStationEvidence(s, REQUIRES_RUNTIME_ENVIRONMENT)),
	},
	"check.invalid_repo": { run: runCheckInvalidRepo },
};

// -- Tests --

describe("storybook-doctor Branch Station integration", () => {
	test("every catalog station has a process-boundary scenario row", () => {
		expect(Object.keys(stationScenarios).sort()).toEqual(
			storybookDoctorBranchStationCatalog
				.map((station) => station.id)
				.sort(),
		);
	});

	test(
		"catalog-driven process-boundary rows cover reachable stations",
		async () => {
			const evidence: BranchStationEvidence[] = [];

			for (const station of storybookDoctorBranchStationCatalog) {
				const scenario = stationScenarios[station.id];
				evidence.push(await scenario.run(station));
			}

			const map = projectStorybookDoctorStationMap(evidence);
			expect(map.drift).toEqual([]);

			const covered = evidence.filter((r) => r.status === "covered");
			const skipped = evidence.filter((r) => r.status === "skipped");

			expect(covered.length).toBeGreaterThanOrEqual(18);
			expect(skipped.length).toBeLessThanOrEqual(4);

			for (const skip of skipped) {
				expect(skip.rationale).toBeTruthy();
			}

			expect(
				map.stations
					.filter(
						(s) =>
							s.evidence.status === "covered" ||
							s.evidence.status === "skipped",
					)
					.length,
			).toBe(storybookDoctorBranchStationCatalog.length);
		},
		120_000,
	);

	test("catalog validates against live command discovery", () => {
		const drift = findStorybookDoctorBranchStationCatalogDrift();
		const commandDrift = drift.filter(
			(d) => d.category === "station_references_unknown_command",
		);
		expect(commandDrift).toEqual([]);
	});
});
