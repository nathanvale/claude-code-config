import { describe, expect, test } from "bun:test";
import {
	AE12_ELIGIBLE_LANES,
	type BenchmarkSample,
	compareBenchmark,
	measureSample,
	receiptArtifactsOf,
	renderComparisonTable,
	utf8ByteLength,
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
			schema_version: "1",
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
	test("playwright-cdp is intentionally excluded (registered-but-not-installed)", () => {
		const laneIds = AE12_ELIGIBLE_LANES.map((lane) => lane.lane_id);
		expect(laneIds).toContain("agent-browser");
		expect(laneIds).toContain("chrome-devtools-mcp");
		expect(laneIds).not.toContain("playwright-cdp");
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
});
