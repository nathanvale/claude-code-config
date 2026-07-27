// ---------------------------------------------------------------------------
// AE12 token-efficiency benchmark harness (release contract R26).
//
// R26: "Agent Browser token-efficiency claims must be supported by repeatable
// same-task measurements of model-visible tokens, wall time, command count, and
// artifact volume."
//
// This module owns the PURE measurement core: given one BenchmarkSample per
// eligible lane (the verbatim caller-visible JSON envelope the CLI returned, the
// wall time, the command count, and the run receipt's artifacts), it computes
// the four AE12 axes and renders a neutral comparison table. It holds NO
// assumption that any lane is cheaper — it only reports measured numbers and
// labels the cheapest axis after the fact.
//
// The live driver (runBenchmarkTask / main) shells the real
// `browser-use task run` front door once per eligible lane against a supplied
// Verified Handoff Envelope, so the numbers come from the same code-owned
// contract a caller uses. When no proof-passing Warm Chrome handoff is
// available, the driver records the gate rather than fabricating a lane result.
//
// Model-visible token proxy: the AE12 contract measures "model-visible tokens".
// A caller (Codex or Claude Code) only ever reads the CLI's JSON result
// envelope — never the raw browser trace, which the shared-run receipt keeps out
// of caller sight by design. So the proxy is the UTF-8 byte length of that
// envelope; token count is approximated as bytes/4 (a stable, model-agnostic
// proxy, explicitly labelled as an approximation).
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";

/** One eligible lane's measured task-run outcome. */
export type BenchmarkSample = {
	/** The lane the task routed to (e.g. "agent-browser"). */
	lane_id: string;
	/** The Task Intent that was run (e.g. "scrape", "debug"). */
	intent: string;
	/**
	 * The verbatim caller-visible JSON the CLI wrote to stdout for this run.
	 * Its UTF-8 byte length is the model-visible token proxy — nothing else the
	 * caller reads exists outside this envelope.
	 */
	result_json: string;
	/** Wall time of the full `browser-use task run` invocation, milliseconds. */
	wall_ms: number;
	/**
	 * Command count: how many CLI invocations the caller issued to complete the
	 * bounded task through this lane (1 for a single `task run`).
	 */
	command_count: number;
	/**
	 * Artifact descriptors from the shared-run receipt's `artifacts[]`. Each
	 * carries a byte size when the run recorded one; a read-only snapshot/console
	 * task typically records zero, which is itself a measured result.
	 */
	artifacts: readonly { readonly bytes?: number }[];
	/** Terminal run state from the receipt (e.g. "confirmed", "not-achieved"). */
	run_state?: string;
};

/** The four AE12 axes computed for one lane. */
export type BenchmarkMeasurement = {
	lane_id: string;
	intent: string;
	/** UTF-8 byte length of the caller-visible JSON envelope. */
	model_visible_bytes: number;
	/** bytes / 4 rounded — a labelled, model-agnostic token proxy. */
	approx_tokens: number;
	wall_ms: number;
	command_count: number;
	artifact_count: number;
	/** Sum of recorded artifact byte sizes (0 when none recorded). */
	artifact_bytes: number;
	run_state: string;
};

/** The neutral comparison: per-lane measurements plus the cheapest lane per
 *  axis. `null` cheapest means a tie or fewer than two lanes. */
export type BenchmarkComparison = {
	contract: "browser-use.ae12-benchmark";
	schema_version: "1";
	task_label: string;
	measurements: readonly BenchmarkMeasurement[];
	cheapest_by_axis: {
		model_visible_bytes: string | null;
		wall_ms: string | null;
		command_count: string | null;
		artifact_bytes: string | null;
	};
	/** True only when >=2 lanes were measured; otherwise the comparison is
	 *  informational (one lane) and no cheaper/costlier claim is licensed. */
	comparison_licensed: boolean;
};

/** UTF-8 byte length (the token proxy denominator). */
export function utf8ByteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

/** Compute the four AE12 axes for one lane sample. */
export function measureSample(sample: BenchmarkSample): BenchmarkMeasurement {
	const bytes = utf8ByteLength(sample.result_json);
	const artifactBytes = sample.artifacts.reduce(
		(sum, artifact) => sum + (artifact.bytes ?? 0),
		0,
	);
	return {
		lane_id: sample.lane_id,
		intent: sample.intent,
		model_visible_bytes: bytes,
		approx_tokens: Math.round(bytes / 4),
		wall_ms: sample.wall_ms,
		command_count: sample.command_count,
		artifact_count: sample.artifacts.length,
		artifact_bytes: artifactBytes,
		run_state: sample.run_state ?? "unknown",
	};
}

/** Return the lane_id with the strictly-smallest value of `axis`, or null on a
 *  tie or when fewer than two lanes exist (no cheaper claim is then licensed). */
function cheapestBy(
	measurements: readonly BenchmarkMeasurement[],
	axis: (measurement: BenchmarkMeasurement) => number,
): string | null {
	if (measurements.length < 2) return null;
	let best = measurements[0];
	let tie = false;
	for (const measurement of measurements.slice(1)) {
		if (axis(measurement) < axis(best)) {
			best = measurement;
			tie = false;
		} else if (axis(measurement) === axis(best)) {
			tie = true;
		}
	}
	return tie ? null : best.lane_id;
}

/**
 * Build the neutral comparison over N lane samples. Makes NO prior assumption
 * about which lane is cheaper — the cheapest lane per axis is derived only from
 * the measured numbers, and a tie yields null (no claim).
 */
export function compareBenchmark(
	taskLabel: string,
	samples: readonly BenchmarkSample[],
): BenchmarkComparison {
	const measurements = samples.map(measureSample);
	return {
		contract: "browser-use.ae12-benchmark",
		schema_version: "1",
		task_label: taskLabel,
		measurements,
		cheapest_by_axis: {
			model_visible_bytes: cheapestBy(measurements, (m) => m.model_visible_bytes),
			wall_ms: cheapestBy(measurements, (m) => m.wall_ms),
			command_count: cheapestBy(measurements, (m) => m.command_count),
			artifact_bytes: cheapestBy(measurements, (m) => m.artifact_bytes),
		},
		comparison_licensed: measurements.length >= 2,
	};
}

/** Render the comparison as a fixed-width Markdown table for the evidence doc. */
export function renderComparisonTable(comparison: BenchmarkComparison): string {
	const header =
		"| lane | intent | model-visible bytes | approx tokens | wall ms | commands | artifacts | artifact bytes | state |";
	const divider =
		"| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |";
	const rows = comparison.measurements.map(
		(m) =>
			`| ${m.lane_id} | ${m.intent} | ${m.model_visible_bytes} | ${m.approx_tokens} | ${m.wall_ms} | ${m.command_count} | ${m.artifact_count} | ${m.artifact_bytes} | ${m.run_state} |`,
	);
	return [header, divider, ...rows].join("\n");
}

// --- Live driver -----------------------------------------------------------

/** Eligible lanes for the AE12 bounded read-only task and the intent that
 *  routes to each. Playwright is intentionally absent: it is registered but not
 *  installed on this host (an operator gate), so it cannot produce a live
 *  sample and the harness records that rather than inventing one. */
export const AE12_ELIGIBLE_LANES: ReadonlyArray<{
	lane_id: string;
	intent: string;
}> = [
	{ lane_id: "agent-browser", intent: "scrape" },
	{ lane_id: "chrome-devtools-mcp", intent: "debug" },
];

/** One live task-run result plus the wall time the driver measured. */
export type LiveTaskRunResult = {
	lane_id: string;
	intent: string;
	exit_code: number;
	result_json: string;
	wall_ms: number;
};

/**
 * Shell the real `browser-use task run` front door once for one lane against a
 * supplied Verified Handoff Envelope path. The caller owns minting the handoff
 * (via `browser-connect connect <adapter> --json`); this driver never launches
 * or proves a browser itself. Returns the verbatim envelope and wall time.
 */
export function runBenchmarkTask(input: {
	browserUseEntry: string;
	handoffPath: string;
	lane_id: string;
	intent: string;
}): LiveTaskRunResult {
	const start = performance.now();
	const spawned = spawnSync(
		"bun",
		[
			input.browserUseEntry,
			"task",
			"run",
			"--intent",
			input.intent,
			"--lane",
			input.lane_id,
			"--handoff",
			input.handoffPath,
			"--json",
		],
		{ encoding: "utf8", timeout: 120_000 },
	);
	const wall = Math.round(performance.now() - start);
	return {
		lane_id: input.lane_id,
		intent: input.intent,
		exit_code: spawned.status ?? -1,
		result_json: spawned.stdout ?? "",
		wall_ms: wall,
	};
}

/** Parse a live task-run envelope into the run receipt's artifacts and state so
 *  measureSample can score artifact volume from the real shared-run receipt. */
export function receiptArtifactsOf(
	resultJson: string,
): { artifacts: { bytes?: number }[]; run_state?: string } {
	try {
		const parsed = JSON.parse(resultJson) as {
			data?: {
				run?: { artifacts?: { bytes?: number }[]; state?: string };
			};
		};
		const run = parsed.data?.run;
		return {
			artifacts: Array.isArray(run?.artifacts) ? run.artifacts : [],
			...(run?.state !== undefined ? { run_state: run.state } : {}),
		};
	} catch {
		return { artifacts: [] };
	}
}

// --- CLI entrypoint ---------------------------------------------------------

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const handoffIndex = args.indexOf("--handoff");
	const browserUseEntry =
		new URL("./browser-use.ts", import.meta.url).pathname;

	if (args.includes("--help") || handoffIndex === -1) {
		process.stdout.write(
			[
				"AE12 token-efficiency benchmark (release contract R26).",
				"",
				"Usage:",
				"  bun browser-use-benchmark.ts --handoff <verified-handoff.json> [--task-label <label>]",
				"",
				"Prerequisite: mint a Verified Handoff Envelope for the lane under test with",
				"  browser-connect connect <adapter> --json",
				"against a proof-passing Warm Chrome. Without one, task run cannot execute and",
				"this harness records the gate instead of fabricating a lane result.",
				"",
				`Eligible lanes: ${AE12_ELIGIBLE_LANES.map((l) => `${l.lane_id}(${l.intent})`).join(", ")}`,
				"playwright-cdp is registered-but-not-installed (operator gate) and is skipped.",
			].join("\n") + "\n",
		);
		return;
	}

	const handoffPath = args[handoffIndex + 1] as string;
	const labelIndex = args.indexOf("--task-label");
	const taskLabel =
		labelIndex === -1
			? "bounded read-only localhost snapshot/console-read"
			: (args[labelIndex + 1] as string);

	const samples: BenchmarkSample[] = [];
	for (const lane of AE12_ELIGIBLE_LANES) {
		const live = runBenchmarkTask({
			browserUseEntry,
			handoffPath,
			lane_id: lane.lane_id,
			intent: lane.intent,
		});
		const receipt = receiptArtifactsOf(live.result_json);
		samples.push({
			lane_id: lane.lane_id,
			intent: lane.intent,
			result_json: live.result_json,
			wall_ms: live.wall_ms,
			command_count: 1,
			artifacts: receipt.artifacts,
			...(receipt.run_state !== undefined ? { run_state: receipt.run_state } : {}),
		});
	}
	const comparison = compareBenchmark(taskLabel, samples);
	process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
	process.stdout.write(`\n${renderComparisonTable(comparison)}\n`);
}

if (import.meta.main) {
	await main();
}
