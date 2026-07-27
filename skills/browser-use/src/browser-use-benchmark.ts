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
// `browser-use task run` front door once per eligible lane against its OWN
// Verified Handoff Envelope, so the numbers come from the same code-owned
// contract a caller uses. A single verified handoff attaches exactly one adapter
// (R11), so a genuine two-lane AE12/R26 comparison needs one handoff per lane
// (repeatable `--handoff`); each lane runs against the handoff whose attachment
// matches it. When no proof-passing Warm Chrome handoff is available for a lane,
// the driver records the gate rather than fabricating a lane result. One handoff
// is the degenerate case: exactly one lane is measured, the rest are gated, and
// no cross-lane comparison is licensed.
//
// Model-visible token proxy: the AE12 contract measures "model-visible tokens".
// A caller (Codex or Claude Code) only ever reads the CLI's JSON result
// envelope — never the raw browser trace, which the shared-run receipt keeps out
// of caller sight by design. So the proxy is the UTF-8 byte length of that
// envelope; token count is approximated as bytes/4 (a stable, model-agnostic
// proxy, explicitly labelled as an approximation).
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

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
	/** Eligible lanes that were NOT measured, with the reason. A single handoff
	 *  binds exactly one adapter (R11), so every other eligible lane is gated on
	 *  its own matching handoff and is never recorded as a measured cost. */
	gated_lanes: readonly { lane_id: string; intent: string; reason: string }[];
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
	gatedLanes: readonly { lane_id: string; intent: string; reason: string }[] = [],
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
		gated_lanes: gatedLanes,
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
	const gated = comparison.gated_lanes.map(
		(g) => `- gated: ${g.lane_id} (${g.intent}) — ${g.reason}`,
	);
	return [header, divider, ...rows, ...gated].join("\n");
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
 * The ONLY run_state that is a successful terminal measurement (R25). `confirmed`
 * is evidence the bounded task achieved its postcondition; `not-achieved`/`unknown`
 * are terminal-but-failed and the blocked states (`awaiting-*`, `needs-human`) are
 * non-terminal refusals. A benchmark sample may be recorded ONLY from a confirmed
 * run, so comparison_licensed (>=2 samples) can never be built from a failed or
 * refused dispatch.
 */
const BENCHMARK_SUCCESS_RUN_STATE = "confirmed";

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

/**
 * Read the adapter id the verified handoff attached (`data.attachment.adapter_id`).
 * The task-run router (R11) refuses any lane whose id != this adapter, so this is
 * the ONLY lane a single handoff can produce a real sample for. Returns undefined
 * when the file is unreadable or the field is absent — the driver then measures no
 * lane rather than recording a mismatch refusal as a lane cost.
 */
export function handoffAdapterId(handoffPath: string): string | undefined {
	let raw: string;
	try {
		raw = readFileSync(handoffPath, "utf8");
	} catch {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as {
			data?: { attachment?: { adapter_id?: unknown } };
		};
		const adapterId = parsed.data?.attachment?.adapter_id;
		return typeof adapterId === "string" ? adapterId : undefined;
	} catch {
		return undefined;
	}
}

/** One verified handoff supplied to the driver: its file path and the adapter
 *  its attachment binds (R11 — one handoff attaches exactly one adapter). */
export type BenchmarkHandoff = {
	handoffPath: string;
	attachedAdapter: string | undefined;
};

/** A supplied handoff whose attached adapter matches no eligible lane, reported
 *  (not measured) so an out-of-scope handoff is visible rather than silent. */
export type SkippedHandoff = {
	handoffPath: string;
	attachedAdapter: string;
	reason: string;
};

/** The driver result: the neutral comparison plus any supplied handoffs that
 *  matched no eligible lane and were therefore skipped. */
export type BenchmarkDriveResult = {
	comparison: BenchmarkComparison;
	skipped_handoffs: readonly SkippedHandoff[];
};

/**
 * Drive the AE12 benchmark over the eligible lanes against a per-lane set of
 * verified handoffs. Each lane runs against the handoff whose
 * attachment.adapter_id matches it (R11); a lane with no matching handoff stays
 * gated (never shelled, so a handoff_lane_mismatch refusal is never recorded as
 * a lane cost). A supplied handoff whose adapter matches no eligible lane is
 * reported in `skipped_handoffs`, not measured as another lane. Two lanes, each
 * with its own matching handoff, produce two real measurements and license the
 * cross-lane comparison. The task runner is injected so the routing is
 * unit-testable without a live browser.
 */
export function driveBenchmark(input: {
	handoffs: readonly BenchmarkHandoff[];
	taskLabel: string;
	browserUseEntry: string;
	runTask: (args: {
		browserUseEntry: string;
		handoffPath: string;
		lane_id: string;
		intent: string;
	}) => LiveTaskRunResult;
}): BenchmarkDriveResult {
	const samples: BenchmarkSample[] = [];
	const gatedLanes: { lane_id: string; intent: string; reason: string }[] = [];
	const matchedHandoffPaths = new Set<string>();

	for (const lane of AE12_ELIGIBLE_LANES) {
		const match = input.handoffs.find(
			(handoff) => handoff.attachedAdapter === lane.lane_id,
		);
		if (match === undefined) {
			const anyReadable = input.handoffs.some(
				(handoff) => handoff.attachedAdapter !== undefined,
			);
			gatedLanes.push({
				lane_id: lane.lane_id,
				intent: lane.intent,
				reason: anyReadable
					? `no supplied --handoff attaches ${lane.lane_id}; this lane needs its own matching handoff (browser-use never substitutes a lane)`
					: "no supplied --handoff has a readable attachment.adapter_id; supply a verified handoff for this lane",
			});
			continue;
		}
		matchedHandoffPaths.add(match.handoffPath);
		const live = input.runTask({
			browserUseEntry: input.browserUseEntry,
			handoffPath: match.handoffPath,
			lane_id: lane.lane_id,
			intent: lane.intent,
		});
		// R25 invariant: only a successful terminal dispatch becomes a measured
		// sample. A nonzero exit means the CLI failed/timed out/refused; gate it
		// before parsing so a failure envelope never licenses a comparison.
		if (live.exit_code !== 0) {
			gatedLanes.push({
				lane_id: lane.lane_id,
				intent: lane.intent,
				reason: `task run exited nonzero (${live.exit_code}); dispatch not counted as a measured sample`,
			});
			continue;
		}
		const receipt = receiptArtifactsOf(live.result_json);
		// A zero exit still carries a run_state that may be non-terminal/refused
		// (a blocked resume, a handoff_lane_mismatch refusal envelope, or a
		// not-achieved/unknown terminal). Only `confirmed` is a real measurement.
		if (receipt.run_state !== BENCHMARK_SUCCESS_RUN_STATE) {
			gatedLanes.push({
				lane_id: lane.lane_id,
				intent: lane.intent,
				reason: `task run did not confirm (run_state=${receipt.run_state ?? "absent"}); dispatch not counted as a measured sample`,
			});
			continue;
		}
		samples.push({
			lane_id: lane.lane_id,
			intent: lane.intent,
			result_json: live.result_json,
			wall_ms: live.wall_ms,
			command_count: 1,
			artifacts: receipt.artifacts,
			run_state: receipt.run_state,
		});
	}

	const eligibleLaneIds = new Set(AE12_ELIGIBLE_LANES.map((l) => l.lane_id));
	const skippedHandoffs: SkippedHandoff[] = [];
	for (const handoff of input.handoffs) {
		if (matchedHandoffPaths.has(handoff.handoffPath)) continue;
		if (handoff.attachedAdapter === undefined) continue;
		if (eligibleLaneIds.has(handoff.attachedAdapter)) continue;
		skippedHandoffs.push({
			handoffPath: handoff.handoffPath,
			attachedAdapter: handoff.attachedAdapter,
			reason: `attaches ${handoff.attachedAdapter}, which is not an AE12 eligible lane; skipped (not measured)`,
		});
	}

	return {
		comparison: compareBenchmark(input.taskLabel, samples, gatedLanes),
		skipped_handoffs: skippedHandoffs,
	};
}

// --- CLI entrypoint ---------------------------------------------------------

/** Collect every `--handoff <path>` occurrence from argv (repeatable, one per
 *  lane). Skips a trailing `--handoff` with no following value. */
export function collectHandoffPaths(args: readonly string[]): string[] {
	const paths: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] !== "--handoff") continue;
		const value = args[i + 1];
		if (value === undefined || value.startsWith("--")) continue;
		paths.push(value);
		i++;
	}
	return paths;
}

const DEFAULT_TASK_LABEL = "bounded read-only localhost snapshot/console-read";

/** Rendered usage text (also the body of a usage error). */
export const BENCHMARK_USAGE =
	[
		"AE12 token-efficiency benchmark (release contract R26).",
		"",
		"Usage:",
		"  bun browser-use-benchmark.ts --handoff <verified-handoff.json> [--handoff <another.json> ...] [--task-label <label>]",
		"",
		"Repeat --handoff once per lane: a single verified handoff attaches exactly",
		"one adapter (R11), so a genuine two-lane comparison needs one handoff per",
		"lane. Each lane runs against the handoff whose attachment.adapter_id matches",
		"it; a lane with no matching handoff stays gated, and a handoff matching no",
		"eligible lane is reported and skipped. One handoff is the degenerate case:",
		"one lane measured, the rest gated, no cross-lane comparison licensed.",
		"",
		"Prerequisite: mint a Verified Handoff Envelope for each lane under test with",
		"  browser-connect connect <adapter> --json",
		"against a proof-passing Warm Chrome. Without one, task run cannot execute and",
		"this harness records the gate instead of fabricating a lane result.",
		"",
		`Eligible lanes: ${AE12_ELIGIBLE_LANES.map((l) => `${l.lane_id}(${l.intent})`).join(", ")}`,
		"playwright-cdp is registered-but-not-installed (operator gate) and is skipped.",
	].join("\n") + "\n";

/** Parsed, validated CLI request. One of:
 *  - `help`: print usage to stdout, exit 0.
 *  - `error`: print message to stderr, exit `exit_code` (nonzero).
 *  - `run`: resolved handoff paths + task label ready to drive. */
export type BenchmarkArgs =
	| { kind: "help" }
	| { kind: "error"; message: string; exit_code: number }
	| { kind: "run"; handoffPaths: string[]; taskLabel: string };

/**
 * Validate argv BEFORE any dispatch. Rejects a missing/empty --handoff with a
 * usage error and a nonzero exit rather than proceeding to driveBenchmark with
 * zero handoffs (which would silently gate every lane and emit an unlicensed
 * comparison as if that were a normal result). A trailing --handoff with no
 * following value is dropped by collectHandoffPaths, so it too lands here as
 * "zero handoffs" and is rejected. --task-label is resolved with a default
 * guard so an absent value is never cast to string.
 */
export function validateBenchmarkArgs(args: readonly string[]): BenchmarkArgs {
	if (args.includes("--help")) return { kind: "help" };

	const handoffPaths = collectHandoffPaths(args);
	if (handoffPaths.length === 0) {
		return {
			kind: "error",
			exit_code: 2,
			message:
				"error: at least one --handoff <verified-handoff.json> is required (a trailing --handoff with no path is rejected).\n\n" +
				BENCHMARK_USAGE,
		};
	}
	if (handoffPaths.some((path) => path.trim() === "")) {
		return {
			kind: "error",
			exit_code: 2,
			message:
				"error: --handoff values must be non-empty paths.\n\n" + BENCHMARK_USAGE,
		};
	}

	const labelIndex = args.indexOf("--task-label");
	// A trailing `--task-label` with no following value must not cast undefined
	// to string; fall back to the default label when the value is absent.
	const taskLabel =
		labelIndex === -1
			? DEFAULT_TASK_LABEL
			: (args[labelIndex + 1] ?? DEFAULT_TASK_LABEL);

	return { kind: "run", handoffPaths, taskLabel };
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const parsed = validateBenchmarkArgs(args);

	if (parsed.kind === "help") {
		process.stdout.write(BENCHMARK_USAGE);
		return;
	}
	if (parsed.kind === "error") {
		process.stderr.write(parsed.message);
		process.exitCode = parsed.exit_code;
		return;
	}

	const browserUseEntry = new URL("./browser-use.ts", import.meta.url).pathname;

	// R11: each verified handoff attaches exactly one adapter, and the task-run
	// router refuses any lane whose id != that adapter (handoff_lane_mismatch).
	// driveBenchmark runs each lane against its own matching handoff and gates the
	// rest, so a refusal envelope is never recorded as a measured lane cost. Two
	// matching handoffs yield two real measurements and license the comparison.
	const handoffs: BenchmarkHandoff[] = parsed.handoffPaths.map((handoffPath) => ({
		handoffPath,
		attachedAdapter: handoffAdapterId(handoffPath),
	}));
	const { comparison, skipped_handoffs } = driveBenchmark({
		handoffs,
		taskLabel: parsed.taskLabel,
		browserUseEntry,
		runTask: runBenchmarkTask,
	});
	process.stdout.write(
		`${JSON.stringify({ ...comparison, skipped_handoffs }, null, 2)}\n`,
	);
	process.stdout.write(`\n${renderComparisonTable(comparison)}\n`);
}

if (import.meta.main) {
	await main();
}
