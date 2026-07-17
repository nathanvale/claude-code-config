import { describe, expect, test } from "bun:test";
import {
	type BrowserUseRuntime,
	decodeStdinChunks,
	runForTest,
} from "./browser-use";
import {
	type OperationResolutionInput,
	resolveOperationTarget,
	runScopedKey,
} from "./browser-use-selection";
import { handoffEvidenceIdOf } from "./browser-use-core";
import {
	enoent,
	makeRuntime,
	parseJson,
	parsedWrite,
	TARGETS_CONTRACT,
} from "./browser-use-test-helpers";
import {
	REAL_VERIFIED_HANDOFF_ENVELOPE,
	verifiedHandoffEnvelope,
} from "./browser-connect-handoff-fixtures";

// =========================================================================
// U6 Browser Target Selection (envelope-era contract from migration U1)
// =========================================================================

type EnvelopeCandidate = {
	candidate_ordinal: number;
	candidate_id: string;
	origin: string;
	path_shape?: string;
	title?: string;
};

// The handoff evidence id browser-use derives from the REAL verified handoff
// capture. Computed through the production hash, not hardcoded, so the
// agree-path cross-check tests bind to the same identity discovery would.
const FIXTURE_ENVELOPE = JSON.parse(REAL_VERIFIED_HANDOFF_ENVELOPE);
const FIXTURE_EVIDENCE_ID = handoffEvidenceIdOf({
	runId: FIXTURE_ENVELOPE.run_id,
	attachmentAdapterId: FIXTURE_ENVELOPE.data.attachment.adapter_id,
	route: FIXTURE_ENVELOPE.data.attachment.route,
	endpointHttp: FIXTURE_ENVELOPE.data.endpoint.http,
	endpointWs: FIXTURE_ENVELOPE.data.endpoint.ws,
	proofContractId: FIXTURE_ENVELOPE.data.proof.environment_contract_id,
	proofSchemaVersion: FIXTURE_ENVELOPE.data.proof.environment_schema_version,
});
const FIXTURE_RUN_ID = FIXTURE_ENVELOPE.run_id as string;

describe("handoff evidence id — golden fixed vector", () => {
	test("handoffEvidenceIdOf reproduces the pinned golden id for a literal input", () => {
		// FIXTURE_EVIDENCE_ID above is computed with the implementation under
		// test, so a field-order or field-omission regression in
		// handoffEvidenceIdOf would change production and fixtures together
		// without failing any test. This literal pins the algorithm itself:
		// if it fails, the identity derivation changed and every persisted
		// binding/state hash breaks — that is a contract rev, not a fixture
		// refresh. Never regenerate this value to make the test pass.
		expect(
			handoffEvidenceIdOf({
				runId: "golden-run",
				attachmentAdapterId: "chrome-devtools",
				route: "cdp",
				endpointHttp: "http://127.0.0.1:53412",
				endpointWs: "ws://127.0.0.1:53412/devtools/browser/golden",
				proofContractId: "warm-chrome.environment",
				proofSchemaVersion: "1",
			}),
		).toBe("ef208426bf7c7dc5f8722f732d8c0976");
	});
});

// A handoff-bound `targets list` success envelope (the CLI success envelope U5
// emits), as `targets select` receives it on stdin. handoff_bound and
// operation_ready default true; override to forge a recovery envelope for AE5.
// The binding defaults to the identity discovery derives from the REAL
// verified handoff capture, so --handoff cross-check agree-paths hold.
function targetsListEnvelope(input: {
	candidates?: EnvelopeCandidate[];
	handoff_bound?: boolean;
	operation_ready?: boolean;
	binding?: Record<string, unknown>;
	requested_adapter?: string;
	schema_version?: string;
} = {}): string {
	const candidates = input.candidates ?? [
		{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://example.com", path_shape: "/app", title: "App" },
	];
	return JSON.stringify({
		status: "ok",
		run_id: FIXTURE_RUN_ID,
		data: {
			contract: TARGETS_CONTRACT,
			schema_version: input.schema_version ?? "2",
			mode: "handoff-bound",
			handoff_bound: input.handoff_bound ?? true,
			operation_ready: input.operation_ready ?? true,
			requested_adapter: input.requested_adapter ?? "chrome-devtools",
			candidate_count: candidates.length,
			candidates,
			binding: {
				run_id: FIXTURE_RUN_ID,
				selected_adapter_id: "chrome-devtools",
				verified_endpoint_identity: "127.0.0.1:9222",
				handoff_evidence_id: FIXTURE_EVIDENCE_ID,
				target_envelope_id: "env-xyz",
				...input.binding,
			},
		},
	});
}

// Runtime that feeds a selection envelope on stdin and captures the single state
// write (path + parsed contents). readTextFile serves the captured state back so
// status can read what select wrote in the same test.
function selectionRuntime(input: {
	stdin?: string;
	env?: Record<string, string | undefined>;
	now?: () => number;
	files?: Record<string, string>;
	writeThrows?: boolean;
}): {
	runtime: BrowserUseRuntime;
	writes: Array<{ path: string; contents: string }>;
} {
	const writes: Array<{ path: string; contents: string }> = [];
	const files = { ...(input.files ?? {}) };
	const runtime = makeRuntime({
		env: input.env ?? {},
		now: input.now ?? (() => 1_000),
		readStdin: async () => input.stdin ?? "",
		readTextFile: async (path) => {
			if (path in files) return files[path];
			// Mirror node:fs: a missing file rejects with an Error carrying
			// code "ENOENT", so loadSelectedState can map it to target_state_missing
			// rather than the unreadable branch.
			throw enoent(path);
		},
		writeTextFile: async (path, contents) => {
			if (input.writeThrows) throw new Error("EACCES");
			writes.push({ path, contents });
			files[path] = contents;
		},
	});
	return { runtime, writes };
}

describe("U6 target selection — envelope acceptance", () => {
	test("rejects a recovery-mode envelope (AE5)", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ handoff_bound: false, operation_ready: false }),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_recovery_rejected",
		});
		expect(writes).toHaveLength(0);
	});

	test("rejects an operation_ready=false handoff-bound envelope", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope({ handoff_bound: true, operation_ready: false }),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_recovery_rejected",
		});
	});

	test("rejects an envelope missing the Browser Targets contract id", async () => {
		const forged = JSON.parse(targetsListEnvelope());
		delete forged.data.contract;
		const { runtime } = selectionRuntime({ stdin: JSON.stringify(forged) });
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_envelope_invalid",
		});
	});

	test("rejects a v1 (Router-era) envelope schema version", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope({ schema_version: "1" }),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_envelope_invalid",
		});
	});

	test("rejects an internally inconsistent binding (requested_adapter vs binding)", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope({ requested_adapter: "playwright-cdp" }),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_envelope_invalid",
		});
	});

	test("rejects an envelope with duplicate candidate ordinals", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({
				candidates: [
					{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://a.example" },
					{ candidate_ordinal: 1, candidate_id: "cid-2", origin: "https://b.example" },
				],
			}),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_envelope_invalid",
		});
		expect(writes).toHaveLength(0);
	});

	test("rejects an envelope with duplicate candidate ids", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope({
				candidates: [
					{ candidate_ordinal: 1, candidate_id: "dup", origin: "https://a.example" },
					{ candidate_ordinal: 2, candidate_id: "dup", origin: "https://b.example" },
				],
			}),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_envelope_invalid",
		});
	});

	test("rejects a handoff-bound envelope missing the identity slice", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope({ binding: { handoff_evidence_id: "" } }),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_envelope_invalid",
		});
	});

	test("missing envelope on stdin and env fails clearly", async () => {
		const { runtime } = selectionRuntime({ stdin: "" });
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_envelope_invalid",
		});
	});

	test("accepts the envelope inline via BROWSER_USE_TARGETS_ENVELOPE_JSON", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: "",
			env: { BROWSER_USE_TARGETS_ENVELOPE_JSON: targetsListEnvelope() },
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(writes).toHaveLength(1);
	});
});

describe("U6 target selection — candidate ordinal", () => {
	const TWO = [
		{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://a.example", path_shape: "/one", title: "One" },
		{ candidate_ordinal: 2, candidate_id: "cid-2", origin: "https://b.example", path_shape: "/two", title: "Two" },
	];

	test("selects the candidate by ordinal scoped to the supplied envelope", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: TWO }),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "2", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const state = parsedWrite(writes[0]);
		expect(state.selected_candidate_ordinal).toBe(2);
		expect(state.target_candidate_id).toBe("cid-2");
		expect(state.display.origin).toBe("https://b.example");
	});

	test("an ordinal not in the envelope fails with choose_target_candidate", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: TWO }),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "5", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_selection_candidate_invalid" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"choose_target_candidate",
		);
		expect(writes).toHaveLength(0);
	});

	test("a non-integer candidate ordinal fails", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: TWO }),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "abc", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_candidate_invalid",
		});
	});
});

describe("U6 target selection — Browser Target Hints", () => {
	const THREE = [
		{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://app.example", path_shape: "/dashboard", title: "Dashboard" },
		{ candidate_ordinal: 2, candidate_id: "cid-2", origin: "https://app.example", path_shape: "/settings", title: "Settings" },
		{ candidate_ordinal: 3, candidate_id: "cid-3", origin: "https://docs.example", path_shape: "/guide", title: "Guide" },
	];

	test("selects by unique origin hint", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: THREE }),
		});
		const result = await runForTest(
			["targets", "select", "--origin", "https://docs.example", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(parsedWrite(writes[0]).selected_candidate_ordinal).toBe(3);
	});

	test("selects by unique URL substring hint", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: THREE }),
		});
		const result = await runForTest(
			["targets", "select", "--url-contains", "/settings", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(parsedWrite(writes[0]).selected_candidate_ordinal).toBe(2);
	});

	test("selects by unique title substring hint", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: THREE }),
		});
		const result = await runForTest(
			["targets", "select", "--title-contains", "Guide", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(parsedWrite(writes[0]).selected_candidate_ordinal).toBe(3);
	});

	test("ambiguous hints fail with refine_target_hint and write nothing", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: THREE }),
		});
		// origin matches two candidates.
		const result = await runForTest(
			["targets", "select", "--origin", "https://app.example", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_selection_hint_ambiguous" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"refine_target_hint",
		);
		expect(writes).toHaveLength(0);
	});

	test("hints matching nothing fail with target_selection_hint_no_match", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: THREE }),
		});
		const result = await runForTest(
			["targets", "select", "--title-contains", "Nonexistent", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_selection_hint_no_match" });
		// Generic miss routes to refine_target_hint, NOT the --show-url recovery.
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"refine_target_hint",
		);
	});

	test("a candidate ordinal does not count as a hint (mutually exclusive)", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: THREE }),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--origin", "https://app.example", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_candidate_invalid",
		});
	});

	test("no selector at all fails clearly", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: THREE }),
		});
		const result = await runForTest(
			["targets", "select", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_candidate_invalid",
		});
	});

	test("a --url-contains path hint against an envelope with no path detail fails clearly (finding #4)", async () => {
		// Candidates without path_shape (envelope produced without --show-url). A
		// path-targeting hint can't match and must say so, pointing at --show-url —
		// not return a misleading generic hint-no-match.
		const noPathShape = [
			{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://app.example", title: "Dashboard" },
			{ candidate_ordinal: 2, candidate_id: "cid-2", origin: "https://docs.example", title: "Guide" },
		];
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: noPathShape }),
		});
		const result = await runForTest(
			["targets", "select", "--url-contains", "/settings", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_selection_hint_no_match" });
		expect((json.error as Record<string, string>).message).toContain("--show-url");
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"rerun_handoff_bound_target_discovery",
		);
		expect(writes).toHaveLength(0);
	});

	test("a --url-contains hint that matches an origin still works without path detail", async () => {
		const noPathShape = [
			{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://app.example", title: "Dashboard" },
			{ candidate_ordinal: 2, candidate_id: "cid-2", origin: "https://docs.example", title: "Guide" },
		];
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: noPathShape }),
		});
		const result = await runForTest(
			["targets", "select", "--url-contains", "docs.example", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(parsedWrite(writes[0]).selected_candidate_ordinal).toBe(2);
	});

	test("a MIXED envelope where the target lacks path detail still surfaces the --show-url recovery (R3)", async () => {
		// One candidate has path_shape, the target candidate does not. The path hint
		// can't match the target; the per-candidate guard must still point at
		// --show-url, not a generic refine_target_hint (the old global guard missed
		// this because anyPathShape was true).
		const mixed = [
			{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://app.example", path_shape: "/dashboard", title: "Dashboard" },
			{ candidate_ordinal: 2, candidate_id: "cid-2", origin: "https://b.example", title: "B" },
		];
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: mixed }),
		});
		const result = await runForTest(
			["targets", "select", "--url-contains", "/settings", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_selection_hint_no_match" });
		expect((json.error as Record<string, string>).message).toContain("--show-url");
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"rerun_handoff_bound_target_discovery",
		);
		expect(writes).toHaveLength(0);
	});

	test("an origin-substring --url-contains selects the matching candidate, not a wrong origin coincidence (R3)", async () => {
		// "account" appears in candidate 1's origin. The hint resolves candidate 1
		// by a legitimate origin match; it must not be suppressed by, nor mis-route
		// to, another candidate. (Guards against the matchesOrigin wrong-select.)
		const noPathShape = [
			{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://account.example", title: "Account" },
			{ candidate_ordinal: 2, candidate_id: "cid-2", origin: "https://b.example", title: "B" },
		];
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: noPathShape }),
		});
		const result = await runForTest(
			["targets", "select", "--url-contains", "account", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(parsedWrite(writes[0]).selected_candidate_ordinal).toBe(1);
	});
});

describe("U6 target selection — state write", () => {
	test("missing --state and missing env state path fails clearly", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_state_path_missing",
		});
		expect(writes).toHaveLength(0);
	});

	test("derives a deterministic state path from BROWSER_USE_TARGET_STATE_DIR and the canonical run id", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
			// The asserted run id matches the envelope's run (correct end-to-end
			// use); the env-derived path keys on the canonical run id so
			// status/operate resolve the same file.
			env: { BROWSER_USE_TARGET_STATE_DIR: "/tmp/states", BROWSER_USE_RUN_ID: FIXTURE_RUN_ID },
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(writes[0].path).toBe(
			`/tmp/states/browser-use-target-state-${runScopedKey(FIXTURE_RUN_ID)}.json`,
		);
	});

	test("env-derived state paths hash explicit run ids before building filenames", async () => {
		const runId = "handoff.run_77-abc";
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({
				binding: { run_id: runId },
			}),
			env: {
				BROWSER_USE_TARGET_STATE_DIR: "/tmp/states",
				BROWSER_USE_RUN_ID: runId,
			},
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(writes[0].path).toBe(
			`/tmp/states/browser-use-target-state-${runScopedKey(runId)}.json`,
		);
		expect(writes[0].path).not.toContain(runId);
	});

	test("selecting an envelope from a different run than the asserted run id fails cross-run", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
			env: { BROWSER_USE_TARGET_STATE_DIR: "/tmp/states", BROWSER_USE_RUN_ID: "run-77" },
		});
		// Envelope's binding.run_id is the fixture run, asserted run is "run-77".
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_cross_run",
		});
		expect(writes).toHaveLength(0);
	});

	test("env state dir WITHOUT an explicit run id fails closed, never keys on a random id (R1)", async () => {
		// No --state, BROWSER_USE_TARGET_STATE_DIR set, but no --run-id / env run id.
		// The diagnostic run id is a random per-invocation UUID; keying the path on
		// it would make a separate status process look in a different file. Fail
		// clearly instead of writing to an unreplayable path.
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
			env: { BROWSER_USE_TARGET_STATE_DIR: "/tmp/states" },
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_selection_state_path_missing" });
		expect((json.error as Record<string, string>).message).toContain("explicit run id");
		expect(writes).toHaveLength(0);
	});

	test("the --run-id flag (not only env) drives the select-time cross-run guard (R2)", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
		});
		// Envelope run is the fixture run; assert a different run via the FLAG.
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--run-id", "other-run", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_cross_run",
		});
		expect(writes).toHaveLength(0);
	});

	test("with no run id set, select writes without a spurious cross-run failure (R2)", async () => {
		// runIdExplicit must be false here (no --run-id flag, no env). Previously a
		// raw argv substring scan could flip it true and reject a valid selection as
		// cross-run; with an explicit --state path and no asserted run, select
		// succeeds.
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(writes).toHaveLength(1);
	});

	test("a --run-id token smuggled past `--` does NOT produce a spurious cross-run (R2)", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
		});
		// The diagnostic layer leaves a post-`--` --run-id unresolved (run id stays
		// random), and parsedRunIdFlag stops at `--`, so runIdExplicit is false. The
		// trailing token is then an unknown positional → a loud usage error (exit 2),
		// NOT a silent/spurious target_state_cross_run (exit 20).
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json", "--", "--run-id"],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		const json = parseJson(result.stdout);
		expect((json.error as Record<string, string> | undefined)?.code).not.toBe(
			"target_state_cross_run",
		);
		expect(writes).toHaveLength(0);
	});

	test("written state carries run id, handoff binding, target envelope id, expiry, candidate id, and redacted display facts", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
			now: () => 1_000,
		});
		await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		const state = parsedWrite(writes[0]);
		expect(state).toMatchObject({
			contract: TARGETS_CONTRACT,
			schema_version: "2",
			run_id: FIXTURE_RUN_ID,
			selected_adapter_id: "chrome-devtools",
			verified_endpoint_identity: "127.0.0.1:9222",
			handoff_evidence_id: FIXTURE_EVIDENCE_ID,
			target_envelope_id: "env-xyz",
			target_candidate_id: "cid-1",
			selected_candidate_ordinal: 1,
			emitted_at_ms: 1_000,
		});
		// Short TTL applied.
		expect(state.expires_at_ms).toBeGreaterThan(state.emitted_at_ms);
		expect(state.display).toMatchObject({ origin: "https://example.com", path_shape: "/app", title: "App" });
	});

	test("selection sanitizes forged display fields before writing state", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({
				candidates: [
					{
						candidate_ordinal: 1,
						candidate_id: "cid-1",
						origin: "https://example.com",
						path_shape: "/app?token=secret-token#frag",
						title: "Dashboard ?token=secret-token#frag",
					},
				],
			}),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const state = parsedWrite(writes[0]);
		expect(state.display).toEqual({
			origin: "https://example.com",
			title: "Dashboard",
		});
		expect(writes[0].contents).not.toContain("secret-token");
		expect(writes[0].contents).not.toContain("#frag");
	});

	test("state contents end with a trailing newline (single atomic write)", async () => {
		const { runtime, writes } = selectionRuntime({ stdin: targetsListEnvelope() });
		await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(writes).toHaveLength(1);
		expect(writes[0].contents.endsWith("\n")).toBe(true);
	});

	test("the real stdin decoder keeps a multi-byte codepoint split across chunk boundaries intact (finding #5)", () => {
		// Exercise the concrete decoder, not a pre-decoded string. Encode a
		// multi-byte payload, then split it MID-CODEPOINT across two chunks; a
		// per-chunk decode would corrupt the boundary character, the byte-join
		// decode must not.
		const text = "ダッシュボード — café";
		const bytes = new TextEncoder().encode(text);
		// Find a split index that lands inside a multi-byte sequence (continuation
		// byte 0x80-0xBF), guaranteeing the boundary straddles a codepoint.
		const splitAt = Array.from(bytes).findIndex(
			(b, i) => i > 0 && b >= 0x80 && b <= 0xbf,
		);
		expect(splitAt).toBeGreaterThan(0);
		const chunks = [bytes.slice(0, splitAt), bytes.slice(splitAt)];
		expect(decodeStdinChunks(chunks)).toBe(text);
		// And a single chunk decodes identically.
		expect(decodeStdinChunks([bytes])).toBe(text);
	});

	test("a multi-byte UTF-8 title round-trips end-to-end into state (finding #5)", async () => {
		const title = "ダッシュボード — café";
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({
				candidates: [
					{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://example.com", path_shape: "/app", title },
				],
			}),
		});
		await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(parsedWrite(writes[0]).display.title).toBe(title);
	});

	test("a write failure (conflict/permission) fails closed with repair_target_state", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope(),
			writeThrows: true,
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_selection_state_write_failed" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"repair_target_state",
		);
	});

	test("a supplied --handoff that disagrees with the envelope binding fails closed", async () => {
		// The cross-check handoff derives a different evidence id (mutated run id
		// changes the hash), so it cannot vouch for this envelope.
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
			files: {
				"/h.json": verifiedHandoffEnvelope((envelope) => {
					envelope.run_id = "some-other-run";
				}),
			},
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--handoff", "/h.json", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_envelope_invalid",
		});
		expect(writes).toHaveLength(0);
	});

	test("a supplied --handoff that agrees with the envelope binding is accepted", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--handoff", "/h.json", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(writes).toHaveLength(1);
	});

	test("a supplied --handoff that is a failure envelope cannot vouch for the selection", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
			files: {
				"/h.json": verifiedHandoffEnvelope((envelope) => {
					envelope.data.outcome = "failed";
					envelope.data.failure_class = "environment-absent";
					envelope.data.next_action_id = "launch_agent_chrome";
				}),
			},
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--handoff", "/h.json", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_envelope_invalid",
		});
		expect(writes).toHaveLength(0);
	});

	test("never writes adapter page ids, query strings, or fragments into state", async () => {
		// The envelope candidate carries only redacted display facts already, but
		// assert the state file contains none of the raw-handle shapes regardless.
		const { runtime, writes } = selectionRuntime({ stdin: targetsListEnvelope() });
		await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		for (const token of ["?token", "#frag", "ws://", "devtools/page", "sessionid"]) {
			expect(writes[0].contents).not.toContain(token);
		}
	});
});

describe("U6 target status — projection and distinct failures", () => {
	// A valid persisted state, as select wrote it.
	function stateFile(overrides: Record<string, unknown> = {}): string {
		return JSON.stringify({
			contract: TARGETS_CONTRACT,
			schema_version: "2",
			run_id: FIXTURE_RUN_ID,
			selected_adapter_id: "chrome-devtools",
			verified_endpoint_identity: "127.0.0.1:53412",
			handoff_evidence_id: FIXTURE_EVIDENCE_ID,
			target_envelope_id: "env-xyz",
			target_candidate_id: "cid-1",
			selected_candidate_ordinal: 1,
			emitted_at_ms: 1_000,
			expires_at_ms: 1_000 + 15 * 60_000,
			display: { origin: "https://example.com", path_shape: "/app", title: "App" },
			...overrides,
		});
	}

	test("projects fresh selected state as JSON", async () => {
		const { runtime } = selectionRuntime({
			files: { "/state.json": stateFile() },
			now: () => 2_000,
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, any>;
		expect(data.selected_target).toMatchObject({
			run_id: FIXTURE_RUN_ID,
			candidate_ordinal: 1,
			target_envelope_id: "env-xyz",
		});
		expect(data.selected_target.expires_in_ms).toBeGreaterThan(0);
	});

	test("round-trips state written by select (plain default projection)", async () => {
		const { runtime } = selectionRuntime({ stdin: targetsListEnvelope() });
		await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json"],
			runtime,
		);
		const status = await runForTest(
			["targets", "status", "--state", "/state.json"],
			runtime,
		);
		expect(status.exitCode).toBe(0);
		expect(status.stdout).toContain("browser_target_state");
		expect(status.stdout).toContain(`run_id=${FIXTURE_RUN_ID}`);
	});

	test("missing state fails with target_state_missing", async () => {
		const { runtime } = selectionRuntime({ files: {} });
		const result = await runForTest(
			["targets", "status", "--state", "/absent.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_state_missing" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"refresh_target_selection",
		);
	});

	test("unreadable/malformed state fails with target_state_unreadable", async () => {
		const { runtime } = selectionRuntime({
			files: { "/state.json": "{ not json" },
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_unreadable",
		});
	});

	test("state status sanitizes forged persisted display fields", async () => {
		const { runtime } = selectionRuntime({
			files: {
				"/state.json": stateFile({
					display: {
						origin: "https://example.com",
						path_shape: "/app?token=secret-token#frag",
						title: "Dashboard ?token=secret-token#frag",
					},
				}),
			},
			now: () => 2_000,
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Dashboard");
		expect(result.stdout).not.toContain("secret-token");
		expect(result.stdout).not.toContain("#frag");
	});

	test("a non-ENOENT read error (e.g. EACCES) fails with target_state_unreadable, not missing", async () => {
		// A read that fails for a reason other than file-not-found must NOT be
		// reported as "missing"; the state may exist but be unreadable. Distinct
		// code + repair continuation (thread #3).
		const readError = Object.assign(new Error("EACCES: permission denied"), {
			code: "EACCES",
		});
		const runtime = makeRuntime({
			readStdin: async () => "",
			readTextFile: async () => {
				throw readError;
			},
			writeTextFile: async () => {},
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_state_unreadable" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"repair_target_state",
		);
	});

	test("a state file with the wrong contract fails with target_state_mismatch", async () => {
		const { runtime } = selectionRuntime({
			files: { "/state.json": stateFile({ contract: "some.other.contract" }) },
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_mismatch",
		});
	});

	test("expired state fails with target_state_stale", async () => {
		const { runtime } = selectionRuntime({
			files: { "/state.json": stateFile() },
			now: () => 1_000 + 15 * 60_000 + 1,
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_stale",
		});
	});

	test("cross-run state fails with target_state_cross_run when a run id is set", async () => {
		const { runtime } = selectionRuntime({
			files: { "/state.json": stateFile({ run_id: "other-run" }) },
			env: { BROWSER_USE_RUN_ID: "this-run" },
			now: () => 2_000,
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_cross_run",
		});
	});

	test("cross-run is detected when the run id is asserted via the --run-id flag (not only env) (finding #2)", async () => {
		const { runtime } = selectionRuntime({
			files: { "/state.json": stateFile({ run_id: "other-run" }) },
			now: () => 2_000,
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--run-id", "this-run", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_cross_run",
		});
	});

	test("a state file written by an incompatible schema_version fails with target_state_mismatch (finding #7)", async () => {
		const { runtime } = selectionRuntime({
			files: { "/state.json": stateFile({ schema_version: "999" }) },
			now: () => 2_000,
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_mismatch",
		});
	});

	test("a v1 (Router-era) state file fails with target_state_mismatch", async () => {
		// State written before the migration carries schema_version "1" and the
		// proof/route tuple; it must be re-selected, never half-read.
		const { runtime } = selectionRuntime({
			files: {
				"/state.json": stateFile({
					schema_version: "1",
					warm_chrome_run_id: "warm-1",
					adapter_proof_id: "proof-abc",
					route_evidence_hash: "hash-xyz",
				}),
			},
			now: () => 2_000,
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_mismatch",
		});
	});

	test("a status path-missing failure is labeled command=targets-status, not targets-select (finding #6)", async () => {
		const { runtime } = selectionRuntime({ files: {} });
		// No --state, no state dir: resolveStatePath fails with a target_selection_*
		// code, but the command label must still reflect the invoked command.
		const result = await runForTest(["targets", "status", "--json"], runtime);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_selection_state_path_missing" });
		expect((json.data as Record<string, unknown>).command).toBe("targets-status");
	});

	test("status round-trips select's env-derived path under a coherent run id (finding #1)", async () => {
		const env = {
			BROWSER_USE_TARGET_STATE_DIR: "/tmp/states",
			BROWSER_USE_RUN_ID: FIXTURE_RUN_ID,
		};
		const { runtime } = selectionRuntime({ stdin: targetsListEnvelope(), env });
		const select = await runForTest(
			["targets", "select", "--candidate", "1", "--json"],
			runtime,
		);
		expect(select.exitCode).toBe(0);
		// Same runtime (shares the files map + env): status with no --state derives
		// the same env-keyed path select wrote, and reads it back.
		const status = await runForTest(["targets", "status", "--json"], runtime);
		expect(status.exitCode).toBe(0);
		expect(
			(parseJson(status.stdout).data as Record<string, any>).selected_target.run_id,
		).toBe(FIXTURE_RUN_ID);
	});
});

describe("U6 operation-time target resolution (resolveOperationTarget)", () => {
	const CANDIDATES = [
		{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://a.example", path_shape: "/one", title: "One" },
		{ candidate_ordinal: 2, candidate_id: "cid-2", origin: "https://b.example", path_shape: "/two", title: "Two" },
	];

	function input(overrides: Partial<OperationResolutionInput>): OperationResolutionInput {
		return {
			hints: {},
			candidates: CANDIDATES,
			handoffBoundFreshBinding: true,
			...overrides,
		};
	}

	test("per-operation hints win over selected state", async () => {
		const resolution = resolveOperationTarget(
			input({
				hints: { origin: "https://b.example" },
				selectedState: { target_candidate_id: "cid-1", selected_candidate_ordinal: 1 },
			}),
		);
		expect(resolution).toMatchObject({ kind: "resolved", source: "hints" });
		if (resolution.kind === "resolved") {
			expect(resolution.candidate.candidate_ordinal).toBe(2);
		}
	});

	test("a failed hint does NOT fall back to selected state (AE8)", async () => {
		// Hint matches >1 (ambiguous): even though selected state exists, resolution
		// fails on the hints rather than using the selection.
		const ambiguous = resolveOperationTarget(
			input({
				candidates: [
					{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://app.example", path_shape: "/x", title: "X" },
					{ candidate_ordinal: 2, candidate_id: "cid-2", origin: "https://app.example", path_shape: "/y", title: "Y" },
				],
				hints: { origin: "https://app.example" },
				selectedState: { target_candidate_id: "cid-1", selected_candidate_ordinal: 1 },
			}),
		);
		expect(ambiguous.kind).toBe("ambiguous");

		// Hint matches nothing: also no fallback.
		const noMatch = resolveOperationTarget(
			input({
				hints: { titleContains: "Nope" },
				selectedState: { target_candidate_id: "cid-1", selected_candidate_ordinal: 1 },
			}),
		);
		expect(noMatch.kind).toBe("no_match");
	});

	test("with no hints, resolves the selected state", async () => {
		const resolution = resolveOperationTarget(
			input({
				selectedState: { target_candidate_id: "cid-2", selected_candidate_ordinal: 2 },
			}),
		);
		expect(resolution).toMatchObject({ kind: "resolved", source: "selected_state" });
		if (resolution.kind === "resolved") {
			expect(resolution.candidate.candidate_id).toBe("cid-2");
		}
	});

	test("exactly-one-candidate fallback runs only with handoff-bound fresh binding", async () => {
		const single = [CANDIDATES[0]];
		const fresh = resolveOperationTarget(
			input({ candidates: single, handoffBoundFreshBinding: true }),
		);
		expect(fresh).toMatchObject({ kind: "resolved", source: "single_candidate" });

		// Not fresh / not handoff-bound: no fallback, even with a single candidate.
		const stale = resolveOperationTarget(
			input({ candidates: single, handoffBoundFreshBinding: false }),
		);
		expect(stale.kind).toBe("no_target");
	});

	test("no hints, no selected state, many candidates is ambiguous", async () => {
		const resolution = resolveOperationTarget(
			input({ handoffBoundFreshBinding: true }),
		);
		expect(resolution.kind).toBe("ambiguous");
	});

	test("selected state whose candidate left the set surfaces selection_moved, not a silent rebind", async () => {
		const resolution = resolveOperationTarget(
			input({
				selectedState: { target_candidate_id: "gone", selected_candidate_ordinal: 9 },
			}),
		);
		// Distinct from a hint miss (no_match): U7 maps this to refresh_target_selection.
		expect(resolution.kind).toBe("selection_moved");
	});

	test("selected state does NOT rebind to a reused ordinal on a different candidate (finding #3)", async () => {
		// Original selection was cid-1 at ordinal 1. The new candidate set dropped
		// cid-1 but a DIFFERENT candidate now holds ordinal 1. Matching on ordinal
		// would silently rebind to the wrong page; only candidate_id may match.
		const resolution = resolveOperationTarget(
			input({
				candidates: [
					{ candidate_ordinal: 1, candidate_id: "cid-NEW", origin: "https://evil.example", path_shape: "/x", title: "X" },
				],
				selectedState: { target_candidate_id: "cid-1", selected_candidate_ordinal: 1 },
			}),
		);
		expect(resolution.kind).toBe("selection_moved");
	});
});
