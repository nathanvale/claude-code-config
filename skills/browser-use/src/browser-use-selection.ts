// ---------------------------------------------------------------------------
// Browser Target Selection (plan U6 + resolveOperationTarget).
//
// Owns select -> persist -> load -> resolve: accept a selection envelope,
// cross-check it against discovery evidence, write the selected-target state
// file atomically, and project status. Also owns resolveOperationTarget — the
// operation-time precedence resolver (hints vs selected-state vs single
// candidate) — because it depends on this module's state loaders. Imports down
// into core, runtime, and discovery. Public entries: runTargetsSelect,
// runTargetsStatus, resolveOperationTarget.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { join } from "node:path";
import {
	type CliWriter,
	type RuntimeActionGuidance,
	createCliRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_USE_TARGETS_CONTRACT_ID,
	browserUseTargetSelectionFailureActions,
	browserUseTargetSelectionSuccessActions,
} from "./command-contract";
import type {
	BrowserAdapterId,
	BrowserTargetCandidate,
} from "./browser-adapter-router-model";
import type { ParsedBrowserUseCommand } from "./browser-use-parser";
import {
	type Failure,
	type OutputMode,
	type TargetHints,
	TARGET_SELECTION_EXIT_CODE,
	USAGE_EXIT_CODE,
	actionFor,
	candidateMatchesHints,
	isBrowserAdapterId,
	isJsonObject,
	parseUrlSafe,
	redactPathShape,
	redactTitle,
	redactUnsafeText,
	safeJsonObject,
	stringField,
	truncateText,
} from "./browser-use-core";
import type { BrowserUseRuntime } from "./browser-use-runtime";
import {
	readAdapterProofFacts,
	readRouteFacts,
} from "./browser-use-discovery";
import { retryabilityForRecoverability } from "./runtime-error-retryability";

// ---------------------------------------------------------------------------
// Browser Target Selection (plan U6).
//
// `browser-use targets select` turns a route-bound `targets list` success
// envelope plus one selector (a candidate ordinal OR Browser Target Hints) into
// run-scoped selected-target state. `browser-use targets status` projects that
// state for a human. A pure resolver (resolveOperationTarget) is exported for
// the U7 `operate` front door.
//
// Selection discipline (R20, R25, AE5): only route-bound, operation-ready
// candidates are selectable. A recovery-mode envelope (route_bound=false or
// operation_ready=false) is rejected — its candidates are evidence-gathering
// only. The supplied envelope is the candidate source; --route/--adapter-proof,
// when supplied, are cross-checked against the envelope binding and must agree
// (U5 review rigor: require contract identity, reject internally inconsistent
// bindings, fail closed on mismatch).
//
// State discipline: selected state is explicit run state, not ambient latest-tab
// state. It is written owner-only and atomically, carries a short TTL, and binds
// to the run/route/proof/target envelope so `status` and `operate` fail closed
// on stale, mismatched, or cross-run state. Every distinct state cause (missing,
// unreadable, stale, mismatched, cross-run) maps to its own code + continuation.
//
// Privacy (R32, KTD7): state display facts reuse the same redaction the U5
// candidate projection uses — origin plus an optional redacted path shape and a
// length-bounded title. No query strings, fragments, raw page ids, CDP target
// ids, or WebSocket debugger URLs are ever written to state, JSON, or logs.
// ---------------------------------------------------------------------------

// Selected-target state shares the Browser Targets result-contract identity, so
// a foreign or hand-written file cannot pass as selected state.
const SELECTED_TARGET_STATE_CONTRACT_ID = BROWSER_USE_TARGETS_CONTRACT_ID;
const SELECTED_TARGET_STATE_SCHEMA_VERSION = "1";
// Short TTL: selected state binds to a live tab and a fresh proof; a stale
// selection must be re-made rather than silently operated against.
const SELECTED_TARGET_STATE_TTL_MS = 15 * 60_000;

type SelectionActionId =
	| (typeof browserUseTargetSelectionFailureActions)[number]["id"]
	| (typeof browserUseTargetSelectionSuccessActions)[number]["id"];
type SelectionFailureActionId =
	(typeof browserUseTargetSelectionFailureActions)[number]["id"];

const selectionActions = [
	...browserUseTargetSelectionFailureActions,
	...browserUseTargetSelectionSuccessActions,
] as const;
const selectionActionById = new Map(
	selectionActions.map((action) => [action.id, action]),
);

export type SelectionFailure = Failure<SelectionFailureActionId>;

// Run-scoped selected-target state. Written by `targets select`, read by
// `targets status` and (U7) `operate`. Display facts are already redacted; the
// binding mirrors the route-bound discovery binding plus the selected candidate.
export type SelectedTargetState = {
	// The persisted contract id as read. status/operate reject any value other
	// than SELECTED_TARGET_STATE_CONTRACT_ID; carrying the real value (not a
	// constant) is what makes the wrong-contract check observable.
	contract: string;
	schema_version: string;
	run_id: string;
	selected_adapter_id: BrowserAdapterId;
	warm_chrome_run_id: string;
	adapter_proof_id: string;
	verified_endpoint_identity: string;
	route_evidence_hash: string;
	target_envelope_id: string;
	// The selected candidate. candidate_id is the per-envelope id; ordinal is the
	// public handle scoped to target_envelope_id.
	target_candidate_id: string;
	selected_candidate_ordinal: number;
	// Epoch-ms freshness, derived from runtime.now(); no wall-clock formatting.
	emitted_at_ms: number;
	expires_at_ms: number;
	// Redacted display facts (same projection as U5 candidates).
	display: { origin: string; path_shape?: string; title?: string };
};

// Route-bound discovery binding parsed from the supplied envelope. Every field
// is required for an operation-ready selection.
type SelectionEnvelopeBinding = {
	runId: string;
	selectedAdapter: BrowserAdapterId;
	warmChromeRunId: string;
	adapterProofId: string;
	verifiedEndpointIdentity: string;
	routeEvidenceHash: string;
	targetEnvelopeId: string;
};

type SelectionEnvelope = {
	binding: SelectionEnvelopeBinding;
	candidates: BrowserTargetCandidate[];
};

export async function runTargetsSelect(input: {
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>;
	runtime: BrowserUseRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	runIdExplicit: boolean;
	durationMs: () => number;
}): Promise<number> {
	const { parsed, runtime } = input;
	const flags = parsed.flagValues;
	const fail = (failure: SelectionFailure) =>
		emitSelectionFailure({
			failure,
			command: "targets-select",
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs(),
		});

	// 1. Read the route-bound targets list success envelope (stdin, else inline
	// env). Empty input is a distinct, recoverable usage failure, not a crash.
	const stdin = await runtime.readStdin();
	const rawEnvelope =
		stdin.trim() !== ""
			? stdin
			: (runtime.env.BROWSER_USE_TARGETS_ENVELOPE_JSON ?? "");
	if (rawEnvelope.trim() === "") {
		return fail({
			code: "target_selection_envelope_invalid",
			message:
				"targets select requires a route-bound targets list success envelope on stdin or BROWSER_USE_TARGETS_ENVELOPE_JSON.",
			actionId: "rerun_route_bound_target_discovery",
			exitCode: TARGET_SELECTION_EXIT_CODE,
			recoverability: "change_input",
		});
	}

	const envelopeParse = parseSelectionEnvelope(rawEnvelope);
	if (!envelopeParse.ok) return fail(envelopeParse.failure);
	const envelope = envelopeParse.envelope;

	// 2. Cross-check supplied route/proof evidence against the envelope binding.
	// The envelope is the candidate source, but a caller may also pass --route /
	// --adapter-proof; if they disagree with what produced the envelope, fail
	// closed rather than selecting against ambiguous evidence (R9 rigor).
	const crossCheck = await crossCheckSelectionEvidence(
		runtime,
		flags,
		envelope.binding,
	);
	if (crossCheck) return fail(crossCheck);

	// 2b. When the caller asserts a run (explicit --run-id / BROWSER_USE_RUN_ID),
	// the envelope's route run must be that run. Selecting an envelope from a
	// different route run into this run's state is a cross-run mistake; fail
	// closed at select time rather than writing state that `status`/`operate`
	// would later reject. With no explicit run id, the envelope's route run is
	// authoritative and is used to correlate the run end to end.
	if (input.runIdExplicit && envelope.binding.runId !== input.runId) {
		return fail({
			code: "target_state_cross_run",
			message:
				"The supplied targets list envelope belongs to a different run than the asserted run id.",
			actionId: "rerun_route_bound_target_discovery",
			exitCode: TARGET_SELECTION_EXIT_CODE,
			recoverability: "change_input",
		});
	}

	// 3. Resolve exactly one candidate from the envelope via ordinal XOR hints.
	const selector = readSelector(flags);
	if (!selector.ok) return fail(selector.failure);
	const resolution = resolveSelectionCandidate(envelope.candidates, selector.value);
	if (!resolution.ok) return fail(resolution.failure);
	const candidate = resolution.candidate;

	// 4. Resolve the state path (--state, else deterministic env-derived path).
	// Key the env-derived path on the canonical invocation run id so `status` and
	// `operate` — which only know the invocation run id, not the envelope —
	// resolve the SAME path. In correct end-to-end use the envelope's route run
	// equals input.runId (enforced above when explicit), so this is coherent; the
	// state's own run_id still records the envelope's route run for provenance.
	const statePath = resolveStatePath(
		flags,
		runtime.env,
		input.runId,
		input.runIdExplicit,
	);
	if (!statePath.ok) return fail(statePath.failure);

	// 5. Assemble and atomically write run-scoped selected state.
	const emittedAtMs = runtime.now();
	const state: SelectedTargetState = {
		contract: SELECTED_TARGET_STATE_CONTRACT_ID,
		schema_version: SELECTED_TARGET_STATE_SCHEMA_VERSION,
		run_id: envelope.binding.runId,
		selected_adapter_id: envelope.binding.selectedAdapter,
		warm_chrome_run_id: envelope.binding.warmChromeRunId,
		adapter_proof_id: envelope.binding.adapterProofId,
		verified_endpoint_identity: envelope.binding.verifiedEndpointIdentity,
		route_evidence_hash: envelope.binding.routeEvidenceHash,
		target_envelope_id: envelope.binding.targetEnvelopeId,
		target_candidate_id: candidate.candidate_id,
		selected_candidate_ordinal: candidate.candidate_ordinal,
		emitted_at_ms: emittedAtMs,
		expires_at_ms: emittedAtMs + SELECTED_TARGET_STATE_TTL_MS,
		display: {
			origin: candidate.origin,
			...(candidate.path_shape ? { path_shape: candidate.path_shape } : {}),
			...(candidate.title ? { title: candidate.title } : {}),
		},
	};

	try {
		await runtime.writeTextFile(statePath.path, `${JSON.stringify(state)}\n`);
	} catch {
		// Conflict / permission / IO failure on the write. The path itself is
		// already redacted before it reaches output; do not echo the OS error.
		return fail({
			code: "target_selection_state_write_failed",
			message: "The run-scoped selected-target state could not be written.",
			actionId: "repair_target_state",
			exitCode: TARGET_SELECTION_EXIT_CODE,
			recoverability: "repair_state",
		});
	}

	return emitSelectionSuccess({
		state,
		outputMode: parsed.outputMode,
		stdout: input.stdout,
		runId: input.runId,
		durationMs: input.durationMs(),
	});
}

export async function runTargetsStatus(input: {
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>;
	runtime: BrowserUseRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	runIdExplicit: boolean;
	durationMs: () => number;
}): Promise<number> {
	const { parsed, runtime } = input;
	const flags = parsed.flagValues;
	const fail = (failure: SelectionFailure) =>
		emitSelectionFailure({
			failure,
			command: "targets-status",
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs(),
		});

	const statePath = resolveStatePath(
		flags,
		runtime.env,
		input.runId,
		input.runIdExplicit,
	);
	if (!statePath.ok) return fail(statePath.failure);

	// Cross-run check keys on the canonical invocation run id (input.runId, which
	// the facade resolves from --run-id OR BROWSER_USE_RUN_ID), gated on it being
	// EXPLICIT. The facade's per-invocation random id would force a spurious
	// cross-run failure on every ad-hoc status call, so an unset run id skips the
	// check; an explicitly-asserted run id makes a state from another run a real
	// cross-run mismatch — covering both the flag and env sources (finding #2).
	const load = await loadSelectedState(runtime, statePath.path, {
		now: runtime.now(),
		expectedRunId: input.runIdExplicit ? input.runId : undefined,
	});
	if (!load.ok) return fail(load.failure);

	return emitStatusSuccess({
		state: load.state,
		now: runtime.now(),
		outputMode: parsed.outputMode,
		stdout: input.stdout,
		runId: input.runId,
		durationMs: input.durationMs(),
	});
}

// --- Selection envelope parsing --------------------------------------------

type SelectionEnvelopeParse =
	| { ok: true; envelope: SelectionEnvelope }
	| { ok: false; failure: SelectionFailure };

// Parse and validate the supplied route-bound targets list success envelope.
// Rejects recovery-mode envelopes (AE5), envelopes missing the Browser Targets
// result-contract identity, and internally inconsistent bindings.
function parseSelectionEnvelope(raw: string): SelectionEnvelopeParse {
	const invalid = (detail: string): SelectionEnvelopeParse => ({
		ok: false,
		failure: {
			code: "target_selection_envelope_invalid",
			message: `The supplied targets list envelope is invalid: ${detail}.`,
			actionId: "rerun_route_bound_target_discovery",
			exitCode: TARGET_SELECTION_EXIT_CODE,
			recoverability: "change_input",
		},
	});
	const value = safeJsonObject(raw);
	if (!value) return invalid("not a JSON object");
	if (value.status !== "ok") return invalid("status is not ok");
	const data = isJsonObject(value.data) ? value.data : undefined;
	if (!data) return invalid("data is missing");
	// Require the Browser Targets result-contract identity. A missing contract is
	// rejected outright, not waved through (U5 review rigor).
	if (data.contract !== SELECTED_TARGET_STATE_CONTRACT_ID) {
		return invalid("data.contract is not the Browser Targets contract");
	}
	// AE5 / R25: only route-bound, operation-ready candidates are selectable.
	if (data.route_bound !== true || data.operation_ready !== true) {
		return {
			ok: false,
			failure: {
				code: "target_selection_recovery_rejected",
				message:
					"The supplied targets list output is recovery-mode (evidence-gathering only); selection requires route-bound, operation-ready candidates.",
				actionId: "rerun_route_bound_target_discovery",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	const binding = isJsonObject(data.binding) ? data.binding : undefined;
	if (!binding) return invalid("binding is missing");
	const selectedAdapter = binding.selected_adapter_id;
	if (!isBrowserAdapterId(selectedAdapter)) {
		return invalid("binding selected adapter is missing or unknown");
	}
	// requested_adapter must agree with the binding's selected adapter; a mismatch
	// is an internally inconsistent envelope and must not authorize a selection.
	if (
		data.requested_adapter !== undefined &&
		data.requested_adapter !== selectedAdapter
	) {
		return invalid(
			"requested_adapter disagrees with binding selected_adapter_id",
		);
	}
	const runId = stringField(binding.run_id);
	const warmChromeRunId = stringField(binding.warm_chrome_run_id);
	const adapterProofId = stringField(binding.adapter_proof_id);
	const verifiedEndpointIdentity = stringField(
		binding.verified_endpoint_identity,
	);
	const targetEnvelopeId = stringField(binding.target_envelope_id);
	// Route-bound bindings carry the route slice (R18); a route-bound envelope
	// without it is internally inconsistent.
	const routeEvidenceHash = stringField(binding.route_evidence_hash);
	if (
		!runId ||
		!warmChromeRunId ||
		!adapterProofId ||
		!verifiedEndpointIdentity ||
		!targetEnvelopeId ||
		!routeEvidenceHash
	) {
		return invalid("binding fields are incomplete for an operation-ready route");
	}
	const candidates = parseEnvelopeCandidates(data.candidates);
	if (!candidates) return invalid("candidates are missing or malformed");
	if (candidates.length === 0) return invalid("candidate set is empty");
	// Ordinals and candidate ids must be unique within the envelope: `--candidate
	// <ordinal>` and hint resolution both assume one candidate per handle, so a
	// duplicate would let resolveSelectionCandidate silently pick the first match.
	// Reject the malformed envelope rather than resolve ambiguously.
	const seenOrdinals = new Set<number>();
	const seenIds = new Set<string>();
	for (const candidate of candidates) {
		if (seenOrdinals.has(candidate.candidate_ordinal)) {
			return invalid("duplicate candidate_ordinal in envelope");
		}
		if (seenIds.has(candidate.candidate_id)) {
			return invalid("duplicate candidate_id in envelope");
		}
		seenOrdinals.add(candidate.candidate_ordinal);
		seenIds.add(candidate.candidate_id);
	}
	// candidate_count, when present, must match the candidate array length.
	if (
		typeof data.candidate_count === "number" &&
		data.candidate_count !== candidates.length
	) {
		return invalid("candidate_count does not match the candidate array");
	}
	return {
		ok: true,
		envelope: {
			binding: {
				runId,
				selectedAdapter,
				warmChromeRunId,
				adapterProofId,
				verifiedEndpointIdentity,
				routeEvidenceHash,
				targetEnvelopeId,
			},
			candidates,
		},
	};
}

// Parse the candidate array from the supplied envelope into display-safe
// candidates. Only the public candidate facts are read; any extra fields are
// dropped. Ordinals must be present and positive.
function parseEnvelopeCandidates(
	value: unknown,
): BrowserTargetCandidate[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const candidates: BrowserTargetCandidate[] = [];
	for (const entry of value) {
		if (!isJsonObject(entry)) return undefined;
			const ordinal = entry.candidate_ordinal;
			const candidateId = stringField(entry.candidate_id);
			if (typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 1) {
				return undefined;
			}
			if (!candidateId) return undefined;
			const display = safeDisplayFacts(candidateId, entry);
			if (!display) return undefined;
			candidates.push({
				candidate_ordinal: ordinal,
				candidate_id: candidateId,
				origin: display.origin,
				...(display.path_shape ? { path_shape: display.path_shape } : {}),
				...(display.title ? { title: display.title } : {}),
			});
		}
		return candidates;
	}

function safeDisplayFacts(
	candidateId: string,
	display: Record<string, unknown>,
): { origin: string; path_shape?: string; title?: string } | undefined {
	const candidateUrl = parseUrlSafe(candidateId);
	if (candidateUrl) {
		return {
			origin: candidateUrl.origin,
			path_shape: redactPathShape(candidateUrl),
			title: safeDisplayTitle(display.title),
		};
	}

	const origin = safeDisplayOrigin(display.origin);
	if (!origin) return undefined;
	const pathShape = safeDisplayPathShape(display.path_shape);
	const title = safeDisplayTitle(display.title);
	return {
		origin,
		...(pathShape ? { path_shape: pathShape } : {}),
		...(title ? { title } : {}),
	};
}

function safeDisplayOrigin(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const parsed = parseUrlSafe(value);
	if (!parsed || parsed.origin !== value) return undefined;
	return parsed.origin;
}

function safeDisplayPathShape(value: unknown): string | undefined {
	if (typeof value !== "string" || value.trim() === "") return undefined;
	if (value.includes("?") || value.includes("#")) return undefined;
	if (value.length > 140) return undefined;
	return truncateText(value.trim(), 120);
}

function safeDisplayTitle(value: unknown): string | undefined {
	return typeof value === "string" ? redactTitle(value) : undefined;
}

// --- Route/proof cross-check (optional, fail-closed on disagreement) -------

// When the caller also supplies --route / --adapter-proof, they must agree with
// the envelope's binding. The envelope already encodes which route+proof
// produced it; a contradicting flag is a caller mistake we must not silently
// discard. Returns a failure when supplied evidence disagrees, else undefined.
async function crossCheckSelectionEvidence(
	runtime: BrowserUseRuntime,
	flags: Record<string, string>,
	binding: SelectionEnvelopeBinding,
): Promise<SelectionFailure | undefined> {
	const proofPath = flags["--adapter-proof"];
	if (proofPath) {
		const proofParse = await readAdapterProofFacts(runtime, proofPath);
		if (!proofParse.ok) {
			return {
				code: "target_selection_envelope_invalid",
				message:
					"The supplied --adapter-proof could not be validated against the selection envelope.",
				actionId: "change_selection_input",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			};
		}
		const proof = proofParse.facts;
		if (
			proof.adapter !== binding.selectedAdapter ||
			proof.adapterProofId !== binding.adapterProofId ||
			proof.verifiedEndpointIdentity !== binding.verifiedEndpointIdentity ||
			proof.warmChromeRunId !== binding.warmChromeRunId
		) {
			return {
				code: "target_selection_envelope_invalid",
				message:
					"The supplied --adapter-proof does not match the selection envelope binding.",
				actionId: "change_selection_input",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			};
		}
	}
	const routePath = flags["--route"];
	if (routePath) {
		const routeParse = await readRouteFacts(runtime, routePath);
		if (!routeParse.ok) {
			return {
				code: "target_selection_envelope_invalid",
				message:
					"The supplied --route could not be validated against the selection envelope.",
				actionId: "change_selection_input",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			};
		}
		const route = routeParse.facts;
		// Compare the FULL route binding, not a subset. readRouteFacts already
		// parsed warm_chrome_run_id and verified_endpoint_identity; omitting them
		// would let a route that agrees on adapter/proof/hash but disagrees on the
		// warm-Chrome run or endpoint pass the cross-check and bind selected state
		// to the wrong endpoint facts.
		if (
			route.selectedAdapter !== binding.selectedAdapter ||
			route.adapterProofId !== binding.adapterProofId ||
			route.warmChromeRunId !== binding.warmChromeRunId ||
			route.verifiedEndpointIdentity !== binding.verifiedEndpointIdentity ||
			route.routeEvidenceHash !== binding.routeEvidenceHash ||
			route.runId !== binding.runId
		) {
			return {
				code: "target_selection_envelope_invalid",
				message:
					"The supplied --route does not match the selection envelope binding.",
				actionId: "change_selection_input",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			};
		}
	}
	return undefined;
}

// --- Selector (ordinal XOR hints) ------------------------------------------

// Browser Target Hints (R22). Origin / URL substring / title substring. The
// candidate ordinal is a precise handle, NOT a hint (plan: "Candidate ordinal
// does not count as a Browser Target Hint").
type Selector =
	| { kind: "ordinal"; ordinal: number }
	| { kind: "hints"; hints: TargetHints };

type SelectorRead =
	| { ok: true; value: Selector }
	| { ok: false; failure: SelectionFailure };

// Read the selector from flags. A candidate ordinal and hints are mutually
// exclusive (the ordinal is exact; mixing them is ambiguous intent). Exactly one
// selector must be supplied.
function readSelector(flags: Record<string, string>): SelectorRead {
	const candidateRaw = flags["--candidate"];
	const hints: TargetHints = {
		...(stringField(flags["--origin"])
			? { origin: flags["--origin"] }
			: {}),
		...(stringField(flags["--url-contains"])
			? { urlContains: flags["--url-contains"] }
			: {}),
		...(stringField(flags["--title-contains"])
			? { titleContains: flags["--title-contains"] }
			: {}),
	};
	const hasHints =
		hints.origin !== undefined ||
		hints.urlContains !== undefined ||
		hints.titleContains !== undefined;

	if (candidateRaw !== undefined) {
		if (hasHints) {
			return {
				ok: false,
				failure: selectionUsageFailure(
					"--candidate and Browser Target Hints are mutually exclusive; supply one selector.",
				),
			};
		}
		const ordinal = Number(candidateRaw);
		if (
			!Number.isInteger(ordinal) ||
			ordinal < 1 ||
			`${ordinal}` !== candidateRaw.trim()
		) {
			return {
				ok: false,
				failure: {
					code: "target_selection_candidate_invalid",
					message:
						"--candidate must be a positive integer candidate ordinal scoped to the supplied envelope.",
					actionId: "choose_target_candidate",
					exitCode: TARGET_SELECTION_EXIT_CODE,
					recoverability: "change_input",
				},
			};
		}
		return { ok: true, value: { kind: "ordinal", ordinal } };
	}

	if (!hasHints) {
		return {
			ok: false,
			failure: selectionUsageFailure(
				"targets select requires a --candidate ordinal or at least one Browser Target Hint (--origin, --url-contains, --title-contains).",
			),
		};
	}
	return { ok: true, value: { kind: "hints", hints } };
}

type CandidateResolution =
	| { ok: true; candidate: BrowserTargetCandidate }
	| { ok: false; failure: SelectionFailure };

// Resolve exactly one candidate. Ordinal must exist in the supplied envelope;
// hints must match exactly one candidate (zero -> no_match, >1 -> ambiguous).
function resolveSelectionCandidate(
	candidates: BrowserTargetCandidate[],
	selector: Selector,
): CandidateResolution {
	if (selector.kind === "ordinal") {
		const candidate = candidates.find(
			(c) => c.candidate_ordinal === selector.ordinal,
		);
		if (!candidate) {
			return {
				ok: false,
				failure: {
					code: "target_selection_candidate_invalid",
					message: `No candidate with ordinal ${selector.ordinal} exists in the supplied envelope.`,
					actionId: "choose_target_candidate",
					exitCode: TARGET_SELECTION_EXIT_CODE,
					recoverability: "change_input",
				},
			};
		}
		return { ok: true, candidate };
	}
	const matches = candidates.filter((c) => candidateMatchesHints(c, selector.hints));
	if (matches.length === 0) {
		// A --url-contains hint matches against origin + redacted path_shape, and
		// path_shape exists only when the envelope was produced with
		// `targets list --show-url`. When the hint matched nothing, distinguish two
		// causes (finding #4): if the substring is NOT present in any origin (so it
		// targets a path) AND at least one candidate carries no path_shape, the miss
		// is plausibly because that candidate's path detail is absent — point the
		// caller at --show-url rather than telling them to refine a hint that can
		// never match. Otherwise it is a genuine refine-the-hint miss. Reasoning
		// from the actual match outcome (not a global pre-check) avoids both the
		// mixed-envelope gap and the origin-coincidence wrong-select.
		const urlContains = selector.hints.urlContains;
		if (urlContains !== undefined) {
			const needle = urlContains.toLowerCase();
			const matchesAnyOrigin = candidates.some((c) =>
				c.origin.toLowerCase().includes(needle),
			);
			const anyMissingPathShape = candidates.some(
				(c) => c.path_shape === undefined,
			);
			if (!matchesAnyOrigin && anyMissingPathShape) {
				return {
					ok: false,
					failure: {
						code: "target_selection_hint_no_match",
						message:
							"--url-contains matched no candidate, and the supplied envelope carries no path detail for some targets. Re-run targets list with --show-url, then select against that envelope.",
						actionId: "rerun_route_bound_target_discovery",
						exitCode: TARGET_SELECTION_EXIT_CODE,
						recoverability: "change_input",
					},
				};
			}
		}
		return {
			ok: false,
			failure: {
				code: "target_selection_hint_no_match",
				message:
					"No Browser Target Candidate matches the supplied hints in the route-bound envelope.",
				actionId: "refine_target_hint",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	if (matches.length > 1) {
		return {
			ok: false,
			failure: {
				code: "target_selection_hint_ambiguous",
				message: `Browser Target Hints matched ${matches.length} candidates; refine the hint or pick a candidate ordinal.`,
				actionId: "refine_target_hint",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	return { ok: true, candidate: matches[0] };
}

// A candidate matches the hints when every supplied hint matches. Origin is an
// exact (case-insensitive) match; URL/title substrings match against the
// redacted display facts only — there is no raw url to match against, by design
// (R32). URL-substring matches against origin + path_shape.
// --- State path resolution -------------------------------------------------

type StatePathResult =
	| { ok: true; path: string }
	| { ok: false; failure: SelectionFailure };

// Resolve the run-scoped state path. --state wins. Otherwise derive
// deterministically from BROWSER_USE_TARGET_STATE_DIR and the run id — but ONLY
// when the run id is EXPLICIT. The diagnostic run id is a fresh random UUID per
// invocation when unset, so keying the env-derived path on a non-explicit run id
// would make select and a separate status process resolve different files; the
// state would then never be found. Require --state or an explicit run id, and
// fail clearly otherwise — state is never placed under a random, unreplayable id.
export function resolveStatePath(
	flags: Record<string, string>,
	env: Record<string, string | undefined>,
	runId: string,
	runIdExplicit: boolean,
): StatePathResult {
	const explicit = stringField(flags["--state"]);
	if (explicit) return { ok: true, path: explicit };
	const dir = stringField(env.BROWSER_USE_TARGET_STATE_DIR);
	if (dir && runIdExplicit && stringField(runId)) {
		return {
			ok: true,
			path: join(dir, `browser-use-target-state-${runScopedKey(runId)}.json`),
		};
	}
	const detail =
		dir && !runIdExplicit
			? "set an explicit run id (--run-id or BROWSER_USE_RUN_ID) so the env-derived path is stable across commands"
			: "supply --state <path> or set BROWSER_USE_TARGET_STATE_DIR with an explicit run id";
	return {
		ok: false,
		failure: {
			code: "target_selection_state_path_missing",
			message: `No selected-target state path: ${detail}.`,
			actionId: "change_selection_input",
			exitCode: TARGET_SELECTION_EXIT_CODE,
			recoverability: "change_input",
		},
	};
}

export function runScopedKey(runId: string): string {
	return createHash("sha256").update(runId).digest("hex").slice(0, 32);
}

// --- State load + validation (status, and U7 operate reuse) ----------------

type StateLoad =
	| { ok: true; state: SelectedTargetState }
	| { ok: false; failure: SelectionFailure };

// Load selected state and fail closed, distinctly, on every cause: missing,
// unreadable/malformed, stale (expired), mismatched (wrong contract/shape), and
// cross-run (state run id disagrees with the expected run id).
export async function loadSelectedState(
	runtime: BrowserUseRuntime,
	path: string,
	check: { now: number; expectedRunId?: string },
): Promise<StateLoad> {
	let raw: string;
	try {
		raw = await runtime.readTextFile(path);
	} catch (error) {
		// Distinguish "no state selected yet" (ENOENT) from "state exists but the
		// file could not be read" (permission, EISDIR, other IO). The contract
		// promises distinct target_state_missing vs target_state_unreadable
		// outcomes; collapsing both into "missing" sends the wrong recovery.
		const code =
			error && typeof error === "object" && "code" in error
				? String((error as { code?: unknown }).code)
				: undefined;
		if (code === "ENOENT") {
			return {
				ok: false,
				failure: {
					code: "target_state_missing",
					message:
						"No run-scoped selected-target state was found; select a Browser Target first.",
					actionId: "refresh_target_selection",
					exitCode: TARGET_SELECTION_EXIT_CODE,
					recoverability: "change_input",
				},
			};
		}
		return {
			ok: false,
			failure: {
				code: "target_state_unreadable",
				message:
					"The selected-target state file could not be read; repair or replace it before retrying.",
				actionId: "repair_target_state",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "repair_state",
			},
		};
	}
	const parsed = parseSelectedState(raw);
	if (!parsed) {
		return {
			ok: false,
			failure: {
				code: "target_state_unreadable",
				message:
					"The selected-target state file is unreadable or malformed; reselect a Browser Target.",
				actionId: "refresh_target_selection",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "repair_state",
			},
		};
	}
	if (parsed.contract !== SELECTED_TARGET_STATE_CONTRACT_ID) {
		return {
			ok: false,
			failure: {
				code: "target_state_mismatch",
				message:
					"The state file is not run-scoped selected-target state (wrong contract); reselect a Browser Target.",
				actionId: "refresh_target_selection",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "repair_state",
			},
		};
	}
	// Enforce the schema version, not just its presence. A state file written by a
	// different (future/older) build may carry incompatible field semantics under
	// the same contract id; treat a version it does not recognize as a mismatch
	// rather than operating against a shape it does not understand (finding #7).
	if (parsed.schema_version !== SELECTED_TARGET_STATE_SCHEMA_VERSION) {
		return {
			ok: false,
			failure: {
				code: "target_state_mismatch",
				message:
					"The selected-target state was written by an incompatible schema version; reselect a Browser Target.",
				actionId: "refresh_target_selection",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "repair_state",
			},
		};
	}
	if (
		check.expectedRunId !== undefined &&
		parsed.run_id !== check.expectedRunId
	) {
		return {
			ok: false,
			failure: {
				code: "target_state_cross_run",
				message:
					"The selected-target state belongs to a different run; reselect a Browser Target for this run.",
				actionId: "refresh_target_selection",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	if (check.now >= parsed.expires_at_ms) {
		return {
			ok: false,
			failure: {
				code: "target_state_stale",
				message:
					"The run-scoped selected-target state has expired; reselect a Browser Target.",
				actionId: "refresh_target_selection",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	return { ok: true, state: parsed };
}

// Parse persisted state strictly. Any missing/typewrong field returns undefined
// (-> target_state_unreadable), never a partial state object.
function parseSelectedState(raw: string): SelectedTargetState | undefined {
	const value = safeJsonObject(raw);
	if (!value) return undefined;
	const contract = stringField(value.contract);
	const schemaVersion = stringField(value.schema_version);
	const runId = stringField(value.run_id);
	const selectedAdapter = value.selected_adapter_id;
	const warmChromeRunId = stringField(value.warm_chrome_run_id);
	const adapterProofId = stringField(value.adapter_proof_id);
	const verifiedEndpointIdentity = stringField(value.verified_endpoint_identity);
	const routeEvidenceHash = stringField(value.route_evidence_hash);
	const targetEnvelopeId = stringField(value.target_envelope_id);
	const targetCandidateId = stringField(value.target_candidate_id);
	const ordinal = value.selected_candidate_ordinal;
	const emittedAtMs = value.emitted_at_ms;
	const expiresAtMs = value.expires_at_ms;
	const display = isJsonObject(value.display) ? value.display : undefined;
	if (
		!contract ||
		!schemaVersion ||
		!runId ||
		!isBrowserAdapterId(selectedAdapter) ||
		!warmChromeRunId ||
		!adapterProofId ||
		!verifiedEndpointIdentity ||
		!routeEvidenceHash ||
		!targetEnvelopeId ||
		!targetCandidateId ||
		typeof ordinal !== "number" ||
		!Number.isInteger(ordinal) ||
		ordinal < 1 ||
		typeof emittedAtMs !== "number" ||
		typeof expiresAtMs !== "number" ||
		!display
	) {
		return undefined;
	}
	const safeDisplay = safeDisplayFacts(targetCandidateId, display);
	if (!safeDisplay) return undefined;
	return {
		contract,
		schema_version: schemaVersion,
		run_id: runId,
		selected_adapter_id: selectedAdapter,
		warm_chrome_run_id: warmChromeRunId,
		adapter_proof_id: adapterProofId,
		verified_endpoint_identity: verifiedEndpointIdentity,
		route_evidence_hash: routeEvidenceHash,
		target_envelope_id: targetEnvelopeId,
		target_candidate_id: targetCandidateId,
		selected_candidate_ordinal: ordinal,
		emitted_at_ms: emittedAtMs,
		expires_at_ms: expiresAtMs,
		display: {
			origin: safeDisplay.origin,
			...(safeDisplay.path_shape ? { path_shape: safeDisplay.path_shape } : {}),
			...(safeDisplay.title ? { title: safeDisplay.title } : {}),
		},
	};
}

// --- Operation-time target resolution (pure; exported for U7 operate) ------

// Per-operation Browser Target Hints supplied directly to `operate` (U7), the
// same hint surface `select` accepts.
export type OperationTargetHints = TargetHints;

// The route-bound discovery context an operation already holds: its candidate
// set and whether the discovery binding is fresh. Selected state is optional;
// hints are optional. U7 owns the I/O that produces these; this resolver is pure.
export type OperationResolutionInput = {
	hints: OperationTargetHints;
	candidates: readonly BrowserTargetCandidate[];
	// Run-scoped selected state, when present and already validated fresh by the
	// caller (loadSelectedState). A stale/missing state is passed as undefined.
	selectedState?: {
		target_candidate_id: string;
		selected_candidate_ordinal: number;
	};
	// True only for a fresh, route-bound discovery binding. The exactly-one
	// fallback is gated on this (R: "Exactly-one-candidate fallback runs only with
	// route-bound discovery and fresh binding").
	routeBoundFreshBinding: boolean;
};

export type OperationResolution =
	| { kind: "resolved"; source: "hints" | "selected_state" | "single_candidate"; candidate: BrowserTargetCandidate }
	| { kind: "ambiguous"; matchCount: number }
	// Per-operation hints matched no candidate (-> refine_target_hint in U7).
	| { kind: "no_match" }
	// Selected state's candidate is no longer in the candidate set; the selection
	// must be re-made (-> refresh_target_selection in U7), distinct from a hint
	// miss so U7 maps each cause to its own continuation (finding #3 / altitude).
	| { kind: "selection_moved" }
	| { kind: "no_target" };

// Resolve the Browser Operation Target. Precedence (plan U6 + AE7, AE8):
//   1. Per-operation hints win over selected state. If hints are supplied, they
//      decide the outcome — a hint that matches nothing or many does NOT fall
//      back to selected state (AE8); it fails on the hints.
//   2. With no hints, use selected state when present.
//   3. With no hints and no selected state, the exactly-one-candidate fallback
//      applies ONLY when the discovery binding is route-bound and fresh.
export function resolveOperationTarget(
	input: OperationResolutionInput,
): OperationResolution {
	const hasHints =
		input.hints.origin !== undefined ||
		input.hints.urlContains !== undefined ||
		input.hints.titleContains !== undefined;

	if (hasHints) {
		const matches = input.candidates.filter((c) =>
			candidateMatchesHints(c, input.hints),
		);
		if (matches.length === 1) {
			return { kind: "resolved", source: "hints", candidate: matches[0] };
		}
		if (matches.length === 0) return { kind: "no_match" };
		// >1: ambiguous, and explicitly NO fallback to selected state (AE8).
		return { kind: "ambiguous", matchCount: matches.length };
	}

	if (input.selectedState) {
		// Match ONLY on the stable per-envelope candidate id, never the ordinal.
		// Ordinals are dense positions reassigned each discovery run, so a tab that
		// closed can leave its ordinal pointing at a DIFFERENT page; matching on
		// ordinal would silently rebind the selection to that other page (finding
		// #3). candidate_id is content-derived and unique to one target, so a miss
		// here means the selected target genuinely left the set.
		const candidate = input.candidates.find(
			(c) => c.candidate_id === input.selectedState?.target_candidate_id,
		);
		if (candidate) {
			return { kind: "resolved", source: "selected_state", candidate };
		}
		// Selected state exists but its candidate is not in the current candidate
		// set — the tab list changed. Surface as a moved selection that must be
		// re-made, distinct from a hint miss, so U7 can map it to
		// refresh_target_selection rather than refine_target_hint.
		return { kind: "selection_moved" };
	}

	if (input.routeBoundFreshBinding && input.candidates.length === 1) {
		return {
			kind: "resolved",
			source: "single_candidate",
			candidate: input.candidates[0],
		};
	}
	if (input.candidates.length > 1) {
		return { kind: "ambiguous", matchCount: input.candidates.length };
	}
	return { kind: "no_target" };
}


// --- Selection failure builders + emitters ---------------------------------

function selectionUsageFailure(message: string): SelectionFailure {
	return {
		code: "target_selection_candidate_invalid",
		message,
		actionId: "change_selection_input",
		exitCode: USAGE_EXIT_CODE,
		recoverability: "change_input",
	};
}

function selectionAction(id: SelectionActionId): RuntimeActionGuidance {
	return actionFor(selectionActionById, id, "target selection");
}

function emitSelectionSuccess(input: {
	state: SelectedTargetState;
	outputMode: OutputMode;
	stdout: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const { state } = input;
	if (input.outputMode === "plain") {
		input.stdout.write(
			[
				"browser_target_selected",
				`run_id=${state.run_id}`,
				`adapter=${state.selected_adapter_id}`,
				`candidate_ordinal=${state.selected_candidate_ordinal}`,
				`target_envelope_id=${state.target_envelope_id}`,
				`origin=${state.display.origin}`,
				`expires_at_ms=${state.expires_at_ms}`,
				`action=operate_selected_browser_target`,
				`duration_ms=${input.durationMs}`,
			].join(" ") + "\n",
		);
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data: {
				command: "targets-select",
				result_kind: "browser_targets",
				selected_target: selectedTargetView(state),
			},
			runtime_actions: [
				selectionAction("operate_selected_browser_target"),
				selectionAction("inspect_selected_target_state"),
			],
			continuation: { next_action_id: "operate_selected_browser_target" },
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return 0;
}

function emitStatusSuccess(input: {
	state: SelectedTargetState;
	now: number;
	outputMode: OutputMode;
	stdout: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const { state } = input;
	const expiresInMs = Math.max(0, state.expires_at_ms - input.now);
	if (input.outputMode === "plain") {
		input.stdout.write(
			[
				"browser_target_state",
				`run_id=${state.run_id}`,
				`adapter=${state.selected_adapter_id}`,
				`candidate_ordinal=${state.selected_candidate_ordinal}`,
				`origin=${state.display.origin}`,
				state.display.path_shape ? `path_shape=${state.display.path_shape}` : "",
				`expires_in_ms=${expiresInMs}`,
			]
				.filter((part) => part !== "")
				.join(" ") + "\n",
		);
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data: {
				command: "targets-status",
				result_kind: "browser_targets",
				selected_target: {
					...selectedTargetView(state),
					expires_in_ms: expiresInMs,
				},
			},
			runtime_actions: [selectionAction("operate_selected_browser_target")],
			continuation: { next_action_id: "operate_selected_browser_target" },
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return 0;
}

// Public projection of selected state. Already-redacted display facts plus the
// binding ids; no raw page/CDP handles ever exist in the state to leak.
function selectedTargetView(state: SelectedTargetState): Record<string, unknown> {
	return {
		run_id: state.run_id,
		selected_adapter_id: state.selected_adapter_id,
		adapter_proof_id: state.adapter_proof_id,
		route_evidence_hash: state.route_evidence_hash,
		target_envelope_id: state.target_envelope_id,
		target_candidate_id: state.target_candidate_id,
		candidate_ordinal: state.selected_candidate_ordinal,
		emitted_at_ms: state.emitted_at_ms,
		expires_at_ms: state.expires_at_ms,
		display: state.display,
	};
}

function emitSelectionFailure(input: {
	failure: SelectionFailure;
	// The invoking command, passed explicitly by the caller. Inferring it from the
	// failure code prefix is wrong: `targets status` can fail with a
	// `target_selection_*` code (e.g. state_path_missing), which would mislabel the
	// envelope as `targets-select` (finding #6).
	command: "targets-select" | "targets-status";
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const { failure, command } = input;
	if (input.outputMode === "plain") {
		input.stderr.write(
			`browser_use ${failure.code}: ${redactUnsafeText(failure.message)} action=${failure.actionId} (run_id=${input.runId})\n`,
		);
		return failure.exitCode;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: failure.exitCode,
			data: { command, result_kind: "browser_targets" },
			runtime_actions: [selectionAction(failure.actionId)],
			continuation: { next_action_id: failure.actionId },
			error: createCliRuntimeError({
				run_id: input.runId,
				code: failure.code,
				message: redactUnsafeText(failure.message),
				exit_code: failure.exitCode,
				severity: "error",
				...retryabilityForRecoverability(failure.recoverability),
				failure_domain: "browser_use",
			}),
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return failure.exitCode;
}
