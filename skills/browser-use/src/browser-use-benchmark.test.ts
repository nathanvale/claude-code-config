import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import {
	AE12_ELIGIBLE_LANES,
	type BenchmarkSample,
	collectHandoffPaths,
	compareBenchmark,
	driveBenchmark,
	handoffAdapterId,
	type LiveTaskRunResult,
	measureSample,
	receiptArtifactsOf,
	renderComparisonTable,
	utf8ByteLength,
	validateBenchmarkArgs,
} from "./browser-use-benchmark";

// A fake `browser-use task run` result envelope whose SHAPE matches the real
// caller-visible JSON captured live from a confirmed shared run
// (contract "browser-use.shared-run", data.run.{state,task_intent,adapter_id,
// artifacts[]}). Keeping the fake shaped like the real receipt is what makes
// receiptArtifactsOf's parse path meaningful — a compact stand-in would hide a
// real parse mismatch.
function fakeTaskRunEnvelope(input: {
	intent: string;
	adapter_id: string;
	state: string;
	artifacts: { bytes?: number }[];
}): string {
	return JSON.stringify({
		status: "ok",
		run_id: "00000000-0000-0000-0000-000000000000",
		data: {
			contract: "browser-use.shared-run",
			schema_version: "2",
			run: {
				run_id: "00000000-0000-0000-0000-000000000000",
				state: input.state,
				task_intent: input.intent,
				environment_profile: { environment: "agent-chrome", profile: "default" },
				adapter_id: input.adapter_id,
				handoff_evidence_id: "a82a2b18599940189de974bddbffc3e3",
				mutation_dispatched: false,
				artifacts: input.artifacts,
				revision: 2,
			},
			caller: { label: null },
		},
		duration_ms: 12,
	});
}

describe("AE12 benchmark measurement core", () => {
	test("utf8ByteLength counts bytes not code points (multi-byte proxy honesty)", () => {
		expect(utf8ByteLength("abc")).toBe(3);
		// A 2-byte-per-char string must not be undercounted as 4 code points.
		expect(utf8ByteLength("éé")).toBe(4);
	});

	test("measureSample derives the four AE12 axes from one lane sample", () => {
		const json = fakeTaskRunEnvelope({
			intent: "scrape",
			adapter_id: "agent-browser",
			state: "confirmed",
			artifacts: [{ bytes: 100 }, { bytes: 50 }],
		});
		const sample: BenchmarkSample = {
			lane_id: "agent-browser",
			intent: "scrape",
			result_json: json,
			wall_ms: 900,
			command_count: 1,
			artifacts: [{ bytes: 100 }, { bytes: 50 }],
			run_state: "confirmed",
		};
		const measurement = measureSample(sample);
		expect(measurement.model_visible_bytes).toBe(utf8ByteLength(json));
		expect(measurement.approx_tokens).toBe(
			Math.round(utf8ByteLength(json) / 4),
		);
		expect(measurement.wall_ms).toBe(900);
		expect(measurement.command_count).toBe(1);
		expect(measurement.artifact_count).toBe(2);
		expect(measurement.artifact_bytes).toBe(150);
		expect(measurement.run_state).toBe("confirmed");
	});

	test("artifact_bytes is zero when a read-only run records no artifacts", () => {
		// The real confirmed debug/scrape runs recorded artifacts: [] — a measured
		// result, not a missing measurement.
		const measurement = measureSample({
			lane_id: "chrome-devtools-mcp",
			intent: "debug",
			result_json: "{}",
			wall_ms: 10,
			command_count: 1,
			artifacts: [],
		});
		expect(measurement.artifact_count).toBe(0);
		expect(measurement.artifact_bytes).toBe(0);
		expect(measurement.run_state).toBe("unknown");
	});
});

describe("AE12 benchmark comparison never presumes a cheaper lane", () => {
	test("cheapest-by-axis is derived only from measured numbers", () => {
		const samples: BenchmarkSample[] = [
			{
				lane_id: "agent-browser",
				intent: "scrape",
				result_json: "x".repeat(400),
				wall_ms: 800,
				command_count: 1,
				artifacts: [{ bytes: 0 }],
			},
			{
				lane_id: "chrome-devtools-mcp",
				intent: "debug",
				result_json: "y".repeat(200),
				wall_ms: 1200,
				command_count: 1,
				artifacts: [{ bytes: 0 }],
			},
		];
		const comparison = compareBenchmark("bounded read-only", samples);
		// chrome-devtools smaller envelope -> cheaper on bytes; agent-browser faster
		// -> cheaper on wall. The winner flips per axis: no lane is assumed cheaper.
		expect(comparison.cheapest_by_axis.model_visible_bytes).toBe(
			"chrome-devtools-mcp",
		);
		expect(comparison.cheapest_by_axis.wall_ms).toBe("agent-browser");
		// Equal command count and artifact bytes -> tie -> null (no claim).
		expect(comparison.cheapest_by_axis.command_count).toBeNull();
		expect(comparison.cheapest_by_axis.artifact_bytes).toBeNull();
		expect(comparison.comparison_licensed).toBe(true);
	});

	test("a single lane licenses no cheaper/costlier claim", () => {
		const comparison = compareBenchmark("bounded read-only", [
			{
				lane_id: "agent-browser",
				intent: "scrape",
				result_json: "z".repeat(100),
				wall_ms: 500,
				command_count: 1,
				artifacts: [],
			},
		]);
		expect(comparison.comparison_licensed).toBe(false);
		expect(comparison.cheapest_by_axis.model_visible_bytes).toBeNull();
		expect(comparison.cheapest_by_axis.wall_ms).toBeNull();
	});
});

describe("receiptArtifactsOf parses the real shared-run receipt shape", () => {
	test("extracts artifacts and state from a confirmed task-run envelope", () => {
		const json = fakeTaskRunEnvelope({
			intent: "debug",
			adapter_id: "chrome-devtools-mcp",
			state: "confirmed",
			artifacts: [{ bytes: 42 }],
		});
		const parsed = receiptArtifactsOf(json);
		expect(parsed.run_state).toBe("confirmed");
		expect(parsed.artifacts).toEqual([{ bytes: 42 }]);
	});

	test("a non-JSON or refusal envelope yields empty artifacts, never a throw", () => {
		expect(receiptArtifactsOf("not json").artifacts).toEqual([]);
		expect(
			receiptArtifactsOf(
				JSON.stringify({ status: "error", error: { code: "foreign_listener" } }),
			).artifacts,
		).toEqual([]);
	});
});

describe("AE12 eligible-lane policy", () => {
	test("every implemented read-only lane is eligible", () => {
		const laneIds = AE12_ELIGIBLE_LANES.map((lane) => lane.lane_id);
		expect(laneIds).toContain("agent-browser");
		expect(laneIds).toContain("chrome-devtools-mcp");
		expect(laneIds).toContain("playwright-cdp");
	});
});

describe("renderComparisonTable", () => {
	test("emits one Markdown row per measured lane plus header and divider", () => {
		const table = renderComparisonTable(
			compareBenchmark("t", [
				{
					lane_id: "agent-browser",
					intent: "scrape",
					result_json: "x".repeat(10),
					wall_ms: 1,
					command_count: 1,
					artifacts: [],
					run_state: "confirmed",
				},
			]),
		);
		const lines = table.split("\n");
		expect(lines[0]).toContain("| lane |");
		expect(lines[1]).toContain("---");
		expect(lines[2]).toContain("agent-browser");
		expect(lines).toHaveLength(3);
	});

	test("renders gated lanes as a trailing list below the measured rows", () => {
		const table = renderComparisonTable(
			compareBenchmark(
				"t",
				[
					{
						lane_id: "agent-browser",
						intent: "scrape",
						result_json: "x".repeat(10),
						wall_ms: 1,
						command_count: 1,
						artifacts: [],
						run_state: "confirmed",
					},
				],
				[
					{
						lane_id: "chrome-devtools-mcp",
						intent: "debug",
						reason: "needs its own matching handoff",
					},
				],
			),
		);
		const lines = table.split("\n");
		expect(lines).toHaveLength(4);
		expect(lines[3]).toContain("gated: chrome-devtools-mcp");
		expect(lines[3]).toContain("needs its own matching handoff");
	});
});

describe("handoffAdapterId reads the verified handoff's attachment adapter", () => {
	const dir = mkdtempSync(join(tmpdir(), "ae12-handoff-"));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	function writeHandoff(name: string, body: unknown): string {
		const path = join(dir, name);
		writeFileSync(path, JSON.stringify(body));
		return path;
	}

	test("returns data.attachment.adapter_id from a verified handoff envelope", () => {
		const path = writeHandoff("verified.json", {
			status: "ok",
			data: {
				contract_id: "browser-connect.handoff",
				attachment: { adapter_id: "chrome-devtools-mcp" },
			},
		});
		expect(handoffAdapterId(path)).toBe("chrome-devtools-mcp");
	});

	test("returns undefined when the file is missing", () => {
		expect(handoffAdapterId(join(dir, "does-not-exist.json"))).toBeUndefined();
	});

	test("returns undefined when the adapter id is absent or non-string", () => {
		const noField = writeHandoff("no-field.json", { data: { attachment: {} } });
		expect(handoffAdapterId(noField)).toBeUndefined();
		const nonString = writeHandoff("non-string.json", {
			data: { attachment: { adapter_id: 42 } },
		});
		expect(handoffAdapterId(nonString)).toBeUndefined();
		const notJson = join(dir, "not-json.json");
		writeFileSync(notJson, "not json at all");
		expect(handoffAdapterId(notJson)).toBeUndefined();
	});
});

describe("driveBenchmark runs each lane against its own matching handoff (R11)", () => {
	// A fake runner records which lanes were shelled and returns a confirmed
	// envelope for whichever lane it is asked to run. A refusal/mismatch lane is
	// never passed here — driveBenchmark must gate it before shelling.
	function fakeRunner(shelled: string[]) {
		return (args: { lane_id: string; intent: string }): LiveTaskRunResult => {
			shelled.push(args.lane_id);
			return {
				lane_id: args.lane_id,
				intent: args.intent,
				exit_code: 0,
				result_json: fakeTaskRunEnvelope({
					intent: args.intent,
					adapter_id: args.lane_id,
					state: "confirmed",
					artifacts: [],
				}),
				wall_ms: 100,
			};
		};
	}

	test("three matching handoffs produce three real measurements and license the comparison", () => {
		const shelled: string[] = [];
		const { comparison, skipped_handoffs } = driveBenchmark({
			handoffs: [
				{
					handoffPath: "/verified-agent-browser.json",
					attachedAdapter: "agent-browser",
				},
				{
					handoffPath: "/verified-chrome-devtools.json",
					attachedAdapter: "chrome-devtools-mcp",
				},
				{
					handoffPath: "/verified-playwright.json",
					attachedAdapter: "playwright-cdp",
				},
			],
			taskLabel: "bounded read-only",
			browserUseEntry: "/entry.ts",
			runTask: fakeRunner(shelled),
		});
		// Each lane was shelled against its OWN matching handoff.
		expect(shelled.sort()).toEqual([
			"agent-browser",
			"chrome-devtools-mcp",
			"playwright-cdp",
		]);
		expect(comparison.measurements.map((m) => m.lane_id).sort()).toEqual([
			"agent-browser",
			"chrome-devtools-mcp",
			"playwright-cdp",
		]);
		expect(comparison.gated_lanes).toEqual([]);
		expect(skipped_handoffs).toEqual([]);
		// Two real measurements license the cross-lane comparison.
		expect(comparison.comparison_licensed).toBe(true);
	});

	test("each lane runs against the handoff whose attachment matches it (paths not swapped)", () => {
		const seen: { lane_id: string; handoffPath: string }[] = [];
		const runTask = (args: {
			lane_id: string;
			intent: string;
			handoffPath: string;
		}): LiveTaskRunResult => {
			seen.push({ lane_id: args.lane_id, handoffPath: args.handoffPath });
			return {
				lane_id: args.lane_id,
				intent: args.intent,
				exit_code: 0,
				result_json: fakeTaskRunEnvelope({
					intent: args.intent,
					adapter_id: args.lane_id,
					state: "confirmed",
					artifacts: [],
				}),
				wall_ms: 100,
			};
		};
		driveBenchmark({
			handoffs: [
				{
					handoffPath: "/chrome-devtools.json",
					attachedAdapter: "chrome-devtools-mcp",
				},
				{
					handoffPath: "/agent-browser.json",
					attachedAdapter: "agent-browser",
				},
				{
					handoffPath: "/playwright.json",
					attachedAdapter: "playwright-cdp",
				},
			],
			taskLabel: "bounded read-only",
			browserUseEntry: "/entry.ts",
			runTask,
		});
		expect(
			seen.find((s) => s.lane_id === "agent-browser")?.handoffPath,
		).toBe("/agent-browser.json");
		expect(
			seen.find((s) => s.lane_id === "chrome-devtools-mcp")?.handoffPath,
		).toBe("/chrome-devtools.json");
		expect(
			seen.find((s) => s.lane_id === "playwright-cdp")?.handoffPath,
		).toBe("/playwright.json");
	});

	test("a handoff whose adapter matches no eligible lane is skipped (reported, not measured)", () => {
		const shelled: string[] = [];
		const { comparison, skipped_handoffs } = driveBenchmark({
			handoffs: [
				{
					handoffPath: "/verified-agent-browser.json",
					attachedAdapter: "agent-browser",
				},
				{
					handoffPath: "/verified-unknown.json",
					attachedAdapter: "unknown-adapter",
				},
			],
			taskLabel: "bounded read-only",
			browserUseEntry: "/entry.ts",
			runTask: fakeRunner(shelled),
		});
		// Only the eligible lane's handoff was shelled; the out-of-scope one was not.
		expect(shelled).toEqual(["agent-browser"]);
		expect(comparison.measurements.map((m) => m.lane_id)).toEqual([
			"agent-browser",
		]);
		// The out-of-scope handoff is reported, not measured as another lane.
		expect(skipped_handoffs.map((s) => s.attachedAdapter)).toEqual([
			"unknown-adapter",
		]);
		expect(skipped_handoffs[0]?.handoffPath).toBe("/verified-unknown.json");
		expect(comparison.gated_lanes.map((g) => g.lane_id)).toEqual([
			"chrome-devtools-mcp",
			"playwright-cdp",
		]);
		// Only one real lane sample -> no cross-lane comparison licensed.
		expect(comparison.comparison_licensed).toBe(false);
	});

	test("degenerate single handoff measures only the matching lane; the other is gated, comparison unlicensed", () => {
		const shelled: string[] = [];
		const { comparison, skipped_handoffs } = driveBenchmark({
			handoffs: [
				{
					handoffPath: "/verified-agent-browser.json",
					attachedAdapter: "agent-browser",
				},
			],
			taskLabel: "bounded read-only",
			browserUseEntry: "/entry.ts",
			runTask: fakeRunner(shelled),
		});
		// Only the matching lane was ever shelled — the unmatched lane never runs,
		// so a handoff_lane_mismatch refusal cannot be recorded as a lane cost.
		expect(shelled).toEqual(["agent-browser"]);
		expect(comparison.measurements.map((m) => m.lane_id)).toEqual([
			"agent-browser",
		]);
		expect(skipped_handoffs).toEqual([]);
		// The other eligible lane is recorded as gated, not measured.
		expect(comparison.gated_lanes.map((g) => g.lane_id)).toEqual([
			"chrome-devtools-mcp",
			"playwright-cdp",
		]);
		expect(comparison.gated_lanes[0]?.reason).toContain("chrome-devtools-mcp");
		// A single real lane sample licenses no cross-lane comparison.
		expect(comparison.comparison_licensed).toBe(false);
		expect(comparison.cheapest_by_axis.model_visible_bytes).toBeNull();
		expect(comparison.cheapest_by_axis.wall_ms).toBeNull();
	});

	test("a handoff whose adapter matches no eligible lane measures nothing and licenses nothing", () => {
		const shelled: string[] = [];
		const { comparison, skipped_handoffs } = driveBenchmark({
			handoffs: [
				{
					handoffPath: "/verified-unknown.json",
					attachedAdapter: "unknown-adapter",
				},
			],
			taskLabel: "bounded read-only",
			browserUseEntry: "/entry.ts",
			runTask: fakeRunner(shelled),
		});
		expect(shelled).toEqual([]);
		expect(comparison.measurements).toEqual([]);
		expect(comparison.gated_lanes.map((g) => g.lane_id)).toEqual(
			AE12_ELIGIBLE_LANES.map((l) => l.lane_id),
		);
		expect(skipped_handoffs.map((s) => s.attachedAdapter)).toEqual([
			"unknown-adapter",
		]);
		expect(comparison.comparison_licensed).toBe(false);
	});

	test("an unreadable handoff (no adapter) gates every lane rather than fabricating a sample", () => {
		const shelled: string[] = [];
		const { comparison, skipped_handoffs } = driveBenchmark({
			handoffs: [{ handoffPath: "/missing.json", attachedAdapter: undefined }],
			taskLabel: "bounded read-only",
			browserUseEntry: "/entry.ts",
			runTask: fakeRunner(shelled),
		});
		expect(shelled).toEqual([]);
		expect(comparison.measurements).toEqual([]);
		expect(comparison.gated_lanes).toHaveLength(AE12_ELIGIBLE_LANES.length);
		expect(comparison.gated_lanes[0]?.reason).toContain(
			"readable attachment.adapter_id",
		);
		// An unreadable handoff carries no adapter, so it is not a "skipped" match.
		expect(skipped_handoffs).toEqual([]);
		expect(comparison.comparison_licensed).toBe(false);
	});

	test("no handoffs at all gates every lane", () => {
		const shelled: string[] = [];
		const { comparison } = driveBenchmark({
			handoffs: [],
			taskLabel: "bounded read-only",
			browserUseEntry: "/entry.ts",
			runTask: fakeRunner(shelled),
		});
		expect(shelled).toEqual([]);
		expect(comparison.gated_lanes).toHaveLength(AE12_ELIGIBLE_LANES.length);
		expect(comparison.comparison_licensed).toBe(false);
	});
});

describe("driveBenchmark records ONLY successful terminal dispatches (R25)", () => {
	// A runner that returns a caller-supplied exit_code and run_state per lane so
	// a failed/refused/non-terminal dispatch can be exercised. A confirmed lane
	// returns a real shared-run envelope; a non-confirmed lane returns the given
	// state (e.g. a needs-human blocked resume or a not-achieved terminal).
	function outcomeRunner(
		outcomes: Record<string, { exit_code: number; state: string }>,
	) {
		return (args: { lane_id: string; intent: string }): LiveTaskRunResult => {
			const outcome = outcomes[args.lane_id] ?? { exit_code: 0, state: "confirmed" };
			return {
				lane_id: args.lane_id,
				intent: args.intent,
				exit_code: outcome.exit_code,
				result_json: fakeTaskRunEnvelope({
					intent: args.intent,
					adapter_id: args.lane_id,
					state: outcome.state,
					artifacts: [],
				}),
				wall_ms: 100,
			};
		};
	}

	const allHandoffs = [
		{ handoffPath: "/agent-browser.json", attachedAdapter: "agent-browser" },
		{
			handoffPath: "/chrome-devtools.json",
			attachedAdapter: "chrome-devtools-mcp",
		},
		{
			handoffPath: "/playwright.json",
			attachedAdapter: "playwright-cdp",
		},
	];

	test("a matched lane with a nonzero exit_code is gated while successful peers remain measured", () => {
		const { comparison } = driveBenchmark({
			handoffs: allHandoffs,
			taskLabel: "bounded read-only",
			browserUseEntry: "/entry.ts",
			runTask: outcomeRunner({
				"chrome-devtools-mcp": { exit_code: 7, state: "confirmed" },
			}),
		});
		expect(comparison.measurements.map((m) => m.lane_id).sort()).toEqual([
			"agent-browser",
			"playwright-cdp",
		]);
		expect(comparison.gated_lanes.map((g) => g.lane_id)).toEqual([
			"chrome-devtools-mcp",
		]);
		expect(comparison.gated_lanes[0]?.reason).toContain("exited nonzero (7)");
		expect(comparison.comparison_licensed).toBe(true);
	});

	test("a matched lane whose run_state is a blocked/refused/non-terminal outcome is gated, not sampled", () => {
		const { comparison } = driveBenchmark({
			handoffs: allHandoffs,
			taskLabel: "bounded read-only",
			browserUseEntry: "/entry.ts",
			// zero exit but a blocked resume state (needs-human) and a not-achieved
			// terminal — neither is a successful measurement.
			runTask: outcomeRunner({
				"agent-browser": { exit_code: 0, state: "needs-human" },
				"chrome-devtools-mcp": { exit_code: 0, state: "not-achieved" },
				"playwright-cdp": { exit_code: 0, state: "needs-human" },
			}),
		});
		expect(comparison.measurements).toEqual([]);
		expect(comparison.gated_lanes.map((g) => g.lane_id).sort()).toEqual([
			"agent-browser",
			"chrome-devtools-mcp",
			"playwright-cdp",
		]);
		expect(
			comparison.gated_lanes.some((g) => g.reason.includes("needs-human")),
		).toBe(true);
		expect(
			comparison.gated_lanes.some((g) => g.reason.includes("not-achieved")),
		).toBe(true);
		expect(comparison.comparison_licensed).toBe(false);
	});

	test("three confirmed zero-exit dispatches produce three samples and license the comparison", () => {
		const { comparison } = driveBenchmark({
			handoffs: allHandoffs,
			taskLabel: "bounded read-only",
			browserUseEntry: "/entry.ts",
			// default outcome is confirmed/zero-exit for both lanes.
			runTask: outcomeRunner({}),
		});
		expect(comparison.measurements.map((m) => m.lane_id).sort()).toEqual([
			"agent-browser",
			"chrome-devtools-mcp",
			"playwright-cdp",
		]);
		expect(comparison.gated_lanes).toEqual([]);
		expect(comparison.comparison_licensed).toBe(true);
	});
});

describe("validateBenchmarkArgs gates missing/empty --handoff with a nonzero exit", () => {
	test("--help returns the help kind (usage to stdout, exit 0)", () => {
		expect(validateBenchmarkArgs(["--help"])).toEqual({ kind: "help" });
	});

	test("zero --handoff is a usage error with a nonzero exit (never a zero-exit empty benchmark)", () => {
		const parsed = validateBenchmarkArgs(["--task-label", "x"]);
		expect(parsed.kind).toBe("error");
		if (parsed.kind !== "error") throw new Error("expected error");
		expect(parsed.exit_code).toBeGreaterThan(0);
		expect(parsed.message).toContain("at least one --handoff");
	});

	test("a trailing valueless --handoff is rejected with a nonzero exit", () => {
		const parsed = validateBenchmarkArgs(["--handoff"]);
		expect(parsed.kind).toBe("error");
		if (parsed.kind !== "error") throw new Error("expected error");
		expect(parsed.exit_code).toBeGreaterThan(0);
		// A --handoff immediately followed by another flag is likewise valueless.
		const parsed2 = validateBenchmarkArgs(["--handoff", "--task-label", "x"]);
		expect(parsed2.kind).toBe("error");
	});

	test("a valid --handoff resolves to a run request with the parsed task label", () => {
		const parsed = validateBenchmarkArgs([
			"--handoff",
			"/a.json",
			"--task-label",
			"my label",
		]);
		expect(parsed).toEqual({
			kind: "run",
			handoffPaths: ["/a.json"],
			taskLabel: "my label",
		});
	});

	test("a trailing valueless --task-label falls back to the default rather than casting undefined", () => {
		const parsed = validateBenchmarkArgs(["--handoff", "/a.json", "--task-label"]);
		expect(parsed.kind).toBe("run");
		if (parsed.kind !== "run") throw new Error("expected run");
		expect(parsed.taskLabel.length).toBeGreaterThan(0);
	});
});

describe("collectHandoffPaths gathers repeatable --handoff occurrences", () => {
	test("collects every --handoff value in order", () => {
		expect(
			collectHandoffPaths([
				"--handoff",
				"/a.json",
				"--task-label",
				"x",
				"--handoff",
				"/b.json",
			]),
		).toEqual(["/a.json", "/b.json"]);
	});

	test("returns empty when no --handoff present", () => {
		expect(collectHandoffPaths(["--task-label", "x"])).toEqual([]);
	});

	test("skips a trailing --handoff with no following value", () => {
		expect(collectHandoffPaths(["--handoff"])).toEqual([]);
		expect(collectHandoffPaths(["--handoff", "--task-label"])).toEqual([]);
	});
});
