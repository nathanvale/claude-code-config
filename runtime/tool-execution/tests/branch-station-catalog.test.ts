import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
	findBranchStationCatalogDrift,
	projectStationMap,
	type BranchStationEvidence,
} from "@side-quest/cli-command-facade";
import {
	assertStationEnvelope,
	buildStationEvidence,
	parseCliProcessJson,
	runCliProcess,
	type StationScenario,
} from "@side-quest/cli-command-facade/testing";
import {
	TOOL_EXECUTION_BRANCH_STATIONS,
	TOOL_EXECUTION_STATION_CONTINUATIONS,
} from "../src/branch-station-catalog.ts";
import { TOOL_EXECUTION_DISCOVERY } from "../src/command-contract.ts";
import type { ExecutionReceipt } from "../src/model.ts";
import { createReceiptStore } from "../src/receipt-store.ts";

const packageRoot = new URL("..", import.meta.url).pathname;

type ToolExecutionStation = (typeof TOOL_EXECUTION_BRANCH_STATIONS)[number];
type ToolExecutionStationId = ToolExecutionStation["id"];

test("the Branch Station catalog aligns with discovery and complete synthetic evidence", () => {
	const evidence: BranchStationEvidence[] = TOOL_EXECUTION_BRANCH_STATIONS.map(
		(station) => ({
			stationId: station.id,
			status: "covered",
			...(station.expectedExitCode === undefined
				? {}
				: { observedExitCode: station.expectedExitCode }),
			...(station.expectedEnvelopeStatus
				? { observedEnvelopeStatus: station.expectedEnvelopeStatus }
				: {}),
			...(station.expectedResultContractId
				? { observedResultContractId: station.expectedResultContractId }
				: {}),
			...(station.expectedErrorCode
				? { observedErrorCode: station.expectedErrorCode }
				: {}),
		}),
	);

	expect(
		findBranchStationCatalogDrift({
			discovery: TOOL_EXECUTION_DISCOVERY,
			catalog: TOOL_EXECUTION_BRANCH_STATIONS,
			evidence,
		}),
	).toEqual([]);
	expect(
		projectStationMap({
			discovery: TOOL_EXECUTION_DISCOVERY,
			catalog: TOOL_EXECUTION_BRANCH_STATIONS,
			evidence,
		}).findings,
	).toEqual([]);
	expect(Object.keys(TOOL_EXECUTION_STATION_CONTINUATIONS).sort()).toEqual(
		TOOL_EXECUTION_BRANCH_STATIONS.map((station) => station.id).sort(),
	);
});

const stationScenarios = {
	"contract.success": processStation(["contract", "--json"]),
	"checkpoint.read": statefulStation(),
	"checkpoint.write": statefulStation(),
	"checkpoint.usage_error": statefulStation(),
	"prepare.success": statefulStation(),
	"prepare.policy_refused": statefulStation(),
	"approve.success": statefulStation(),
	"approve.denied": statefulStation(),
	"approve.decision_required": statefulStation(),
	"call.success": statefulStation(),
	"call.transport_failure": statefulStation(),
	"call.jsonrpc_error": statefulStation(),
	"call.tool_error": statefulStation(),
	"call.unknown": statefulStation(),
	"call.approval_refused": statefulStation(),
	"observe.success": statefulStation(),
	"observe.mismatch": statefulStation(),
	"resume.terminal_noop": statefulStation(),
	"resume.unknown_blocked": statefulStation(),
	"resume.retry_prepared": statefulStation(),
	"receipts.success": processStation(["receipts", "--json"]),
} satisfies Record<
	ToolExecutionStationId,
	StationScenario<ToolExecutionStation>
>;

test("station scenarios stay exhaustive with the Branch Station catalog", () => {
	expect(Object.keys(stationScenarios).sort()).toEqual(
		TOOL_EXECUTION_BRANCH_STATIONS.map((station) => station.id).sort(),
	);
});

test("catalog-driven process proof covers every station", async () => {
	const evidence: BranchStationEvidence[] = [];
	for (const station of TOOL_EXECUTION_BRANCH_STATIONS) {
		evidence.push(await stationScenarios[station.id].run(station));
	}

	const map = projectStationMap({
		discovery: TOOL_EXECUTION_DISCOVERY,
		catalog: TOOL_EXECUTION_BRANCH_STATIONS,
		evidence,
	});
	expect(map.drift).toEqual([]);
	expect(map.stations.every((station) => station.evidence.status === "covered")).toBe(true);
	expect(map.findings).toEqual([]);
}, 15_000);

function processStation(
	args: readonly string[],
): StationScenario<ToolExecutionStation> {
	return {
		run: async (station) => runStationProcess(station, args),
	};
}
function statefulStation(): StationScenario<ToolExecutionStation> {
	return { run: runStatefulStation };
}

async function runStatefulStation(
	station: ToolExecutionStation,
): Promise<BranchStationEvidence> {
	const stateRoot = await mkdtemp(join(tmpdir(), `tool-execution-${station.id}-`));
	const env: Record<string, string | undefined> = {
		...process.env,
		XDG_STATE_HOME: stateRoot,
	};
	const checkpointPath = join(stateRoot, "checkpoint.json");
	const requestPath = join(stateRoot, "request.json");
	const observationPath = join(stateRoot, "observation.json");
	env.HOME = await installCanonicalWrapperFixture(
		stateRoot,
		"firecrawl",
		"exit 99",
	);

	switch (station.id) {
		case "checkpoint.read":
			await writeCheckpointFixture(checkpointPath);
			await runSetupProcess(["checkpoint", "--input", checkpointPath, "--json"], env);
			return runStationProcess(station, ["checkpoint", "--json"], env);
		case "checkpoint.write":
			await writeCheckpointFixture(checkpointPath);
			return runStationProcess(
				station,
				["checkpoint", "--input", checkpointPath, "--json"],
				env,
			);
		case "checkpoint.usage_error":
			await writeFile(checkpointPath, "{}");
			return runStationProcess(
				station,
				["checkpoint", "--input", checkpointPath, "--json"],
				env,
			);
		case "prepare.success":
			await setupPreparedFixture(checkpointPath, requestPath, env, "search");
			return runStationProcess(
				station,
				["prepare", "--input", requestPath, "--json"],
				env,
			);
		case "prepare.policy_refused":
			await setupPreparedFixture(checkpointPath, requestPath, env, "search_with_options");
			return runStationProcess(
				station,
				["prepare", "--input", requestPath, "--json"],
				 env,
			);
		case "approve.success":
		case "approve.denied":
		case "approve.decision_required": {
			await setupPreparedFixture(checkpointPath, requestPath, env, "search");
			const prepared = await runSetupProcess(
				["prepare", "--input", requestPath, "--json"],
				env,
			);
			const envelope = parseCliProcessJson<{
				data: { receipt: { receipt_id: string } };
			}>(prepared);
			return runStationProcess(
				station,
				[
					"approve",
					"--receipt",
					envelope.data.receipt.receipt_id,
					...(station.id === "approve.success"
						? ["--approve"]
						: station.id === "approve.denied"
							? ["--deny"]
							: []),
					"--json",
				],
				env,
			);
		}
		case "call.success":
		case "call.transport_failure":
		case "call.jsonrpc_error":
		case "call.tool_error":
		case "call.unknown":
		case "call.approval_refused": {
			const unknown = station.id === "call.unknown";
			const fixtureHome = await installCanonicalWrapperFixture(
				stateRoot,
				"firecrawl",
				station.id === "call.approval_refused"
					? "exit 99"
					: providerFixtureScript(station.id),
			);
			env.HOME = fixtureHome;
			await setupPreparedFixture(
				checkpointPath,
				requestPath,
				env,
				"search",
				unknown ? 50 : undefined,
			);
			const prepared = await runSetupProcess(
				["prepare", "--input", requestPath, "--json"],
				env,
			);
			const envelope = parseCliProcessJson<{
				data: { receipt: { receipt_id: string } };
			}>(prepared);
			if (station.id !== "call.approval_refused") {
				await runSetupProcess(
					[
						"approve",
						"--receipt",
						envelope.data.receipt.receipt_id,
						"--approve",
						"--json",
					],
					env,
				);
			}
			return runStationProcess(
				station,
				[
					"call",
					"--receipt",
					envelope.data.receipt.receipt_id,
					"--input",
					requestPath,
					"--json",
				],
				env,
			);
		}
		case "observe.success":
		case "observe.mismatch":
			await writeNativeObservationFixtures(
				checkpointPath,
				observationPath,
				station.id === "observe.mismatch",
			);
			await runSetupProcess(["checkpoint", "--input", checkpointPath, "--json"], env);
			return runStationProcess(
				station,
				["observe", "--input", observationPath, "--json"],
				env,
			);
		case "resume.terminal_noop":
		case "resume.unknown_blocked":
		case "resume.retry_prepared": {
			const receipt = executionReceiptFixture(
				station.id === "resume.terminal_noop" ? "terminal" : "unknown",
			);
			await createReceiptStore(join(stateRoot, "tool-execution", "receipts")).write(
				receipt,
			);
			return runStationProcess(
				station,
				[
					"resume",
					"--receipt",
					receipt.receipt_id,
					...(station.id === "resume.retry_prepared" ? ["--approve-retry"] : []),
					"--json",
				],
				env,
			);
		}
		default:
			throw new Error(`No stateful station fixture for ${station.id}`);
	}
}

async function runStationProcess(
	station: ToolExecutionStation,
	args: readonly string[],
	env: Record<string, string | undefined> = process.env,
): Promise<BranchStationEvidence> {
	const result = await runCliProcess({
		label: station.id,
		argv: [process.execPath, "run", "src/cli.ts", ...args],
		cwd: packageRoot,
		env,
	});
	const envelope = assertStationEnvelope(station, result);
	return buildStationEvidence(station, result, envelope);
}

async function runSetupProcess(
	args: readonly string[],
	env: Record<string, string | undefined>,
) {
	return runCliProcess({
		label: `setup ${args[0]}`,
		argv: [process.execPath, "run", "src/cli.ts", ...args],
		cwd: packageRoot,
		env,
	});
}

async function writeCheckpointFixture(path: string): Promise<void> {
	await writeFile(
		path,
		JSON.stringify({
			schema_version: 1,
			id: "u5",
			position: 5,
			total: 13,
			objective: "Prove deterministic tool execution.",
			owner: "runtime/tool-execution",
			expected: "Lifecycle tests pass.",
			stop: "Any result class overlaps.",
			rollback: "Abort the worktree.",
			next: "Implement provider packages.",
			active: true,
		}),
	);
}

async function setupPreparedFixture(
	checkpointPath: string,
	requestPath: string,
	env: Record<string, string | undefined>,
	operation: string,
	deadlineMs?: number,
): Promise<void> {
	await writeCheckpointFixture(checkpointPath);
	await writeFile(
		requestPath,
		JSON.stringify({
			adapter: "firecrawl-cli",
			route: "firecrawl.search",
			checkpoint_id: "u5",
			qualification_cell: {
				lane: "explicit_cli",
				client: "tool-execution",
				provider: "firecrawl",
				route: "firecrawl.search",
			},
			request: {
				operation: operation === "search_with_options" ? "search" : operation,
				query: "bounded public test query",
				...(operation === "search_with_options" ? { options: { limit: 1 } } : {}),
			},
			...(deadlineMs === undefined ? {} : { deadline_ms: deadlineMs }),
		}),
	);
	await runSetupProcess(
		["checkpoint", "--input", checkpointPath, "--json"],
		env,
	);
}

async function installCanonicalWrapperFixture(
	stateRoot: string,
	name: "firecrawl" | "mcporter-mac-mini",
	script: string,
): Promise<string> {
	const home = join(stateRoot, "fixture-home");
	const bin = join(home, "code", "dotfiles", "bin");
	await mkdir(bin, { recursive: true });
	const executable = join(bin, name);
	await writeFile(executable, `#!/bin/sh\n${script}\n`);
	await chmod(executable, 0o700);
	return home;
}

function providerFixtureScript(stationId: ToolExecutionStationId): string {
	switch (stationId) {
		case "call.success":
			return `printf '%s' '{"data":[]}'`;
		case "call.transport_failure":
			return "exit 7";
		case "call.jsonrpc_error":
			return `printf '%s' '{"jsonrpc":"2.0","id":1,"error":{"code":-32000}}'`;
		case "call.tool_error":
			return `printf '%s' '{"isError":true,"content":[]}'`;
		case "call.unknown":
			return "sleep 2";
		default:
			throw new Error(`No provider fixture for ${stationId}`);
	}
}

async function writeNativeObservationFixtures(
	checkpointPath: string,
	observationPath: string,
	mismatch: boolean,
): Promise<void> {
	const cell = {
		lane: "codex_desktop",
		client: "codex-desktop",
		provider: "firecrawl",
		route: "native.firecrawl.search",
	};
	const binding = {
		qualification_cell: cell,
		client: "codex-desktop",
		process_identity: "fresh-process-1",
		query_fingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
		config_fingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		route: "native.firecrawl.search",
		evidence_source: "private-receipt-1",
		max_age_ms: 60_000,
	};
	await writeFile(
		checkpointPath,
		JSON.stringify({
			schema_version: 1,
			id: "native-v1",
			position: 10,
			total: 13,
			objective: "Prove one native qualification cell.",
			owner: "tool-execution",
			expected: "Fresh evidence is recorded.",
			stop: "Any provenance field differs.",
			rollback: "Preserve the private receipt and stop.",
			next: "Review the qualification result.",
			active: true,
			native_observation_binding: binding,
		}),
	);
	await writeFile(
		observationPath,
		JSON.stringify({
			qualification_cell: cell,
			client: "codex-desktop",
			process_identity: "fresh-process-1",
			invoked_at: new Date().toISOString(),
			query_fingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
			config_fingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			route: mismatch ? "native.other.search" : "native.firecrawl.search",
			evidence_source: "private-receipt-1",
			result: {
				class: "successful_tool_result",
				result_fingerprint: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
			},
		}),
	);
}

function executionReceiptFixture(
	state: "terminal" | "unknown",
): ExecutionReceipt {
	return {
		schema_version: 1,
		receipt_id: `catalog-${state}`,
		attempt: 1,
		adapter: "mcporter-cli",
		route: "mcporter.firecrawl.search",
		checkpoint_id: "u5",
		qualification_cell: {
			lane: "explicit_cli",
			client: "tool-execution",
			provider: "firecrawl",
			route: "mcporter.firecrawl.search",
		},
		request_fingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		config_fingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		state,
		created_at: "2026-08-09T00:00:00.000Z",
		updated_at: "2026-08-09T00:01:00.000Z",
		...(state === "terminal"
			? {
					terminal_reason: "successful_tool_result",
					result: {
						class: "successful_tool_result" as const,
						result_fingerprint: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
					},
				}
			: { terminal_reason: "post_dispatch_interruption" }),
	};
}
