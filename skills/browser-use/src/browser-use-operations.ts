// ---------------------------------------------------------------------------
// Browser Operations (plan U7).
//
// Owns the operate workflow: the runOperate pipeline (read inputs -> load
// binding -> resolve target context -> select page -> run transport) plus the
// failure bridges that map discovery/selection/transport/resolution failures
// onto the operation diagnostic taxonomy, and snapshot bounding. Orchestrates
// every layer below it — imports down into core, runtime, transport, discovery,
// and selection. Single public entry: runOperate.
// ---------------------------------------------------------------------------

import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import {
	type CliWriter,
	type RuntimeActionGuidance,
	createCliRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_USE_OPERATION_CONTRACT_ID,
	BROWSER_USE_OPERATION_SCHEMA_VERSION,
	type BrowserUseCommand,
	browserUseOperationFailureActions,
	browserUseOperationSuccessActions,
} from "./command-contract";
import type {
	BrowserAdapterId,
	BrowserOperationClass,
	BrowserTargetCandidate,
} from "./browser-adapter-router-model";
import { authorizesOperationClass } from "./browser-adapter-router-engine";
import type { McporterCommandResult } from "./mcporter-transport";
import {
	type BrowserOperationTransportFailure,
	type BrowserOperationTransportResult,
	runBrowserUseMcporter,
} from "./browser-use-transport";
import type { ParsedBrowserUseCommand } from "./browser-use-parser";
import {
	type Failure,
	type OutputMode,
	type RawPage,
	BINDING_FAIL_CLOSED_EXIT_CODE,
	RUNTIME_FAILURE_EXIT_CODE,
	USAGE_EXIT_CODE,
	actionFor,
	isJsonObject,
	parseUrlSafe,
	redactUnsafeText,
	stringField,
	targetEnvelopeIdOf,
	toCandidate,
} from "./browser-use-core";
import type { BrowserUseRuntime } from "./browser-use-runtime";
import {
	type HandoffFacts,
	type TargetDiscoveryFailure,
	discoverPages,
	readHandoffFacts,
} from "./browser-use-discovery";
import {
	type OperationResolution,
	type OperationTargetHints,
	type SelectedTargetState,
	type SelectionFailure,
	loadSelectedState,
	resolveOperationTarget,
	resolveStatePath,
	runScopedKey,
} from "./browser-use-selection";
import { retryabilityForRecoverability } from "./runtime-error-retryability";

// ---------------------------------------------------------------------------
// Browser Operations (plan U7, evidence re-based in migration U1).
//
// `browser-use operate snapshot|screenshot|emulate` runs one authorized live
// browser operation. The pipeline reads inputs, loads the Verified Handoff
// Envelope binding, loads the selected-target context, resolves the operation
// target, selects the adapter page, runs the mcporter transport, and emits a
// bounded result. Every failure mode bridges down into the operation failure
// taxonomy (handoff, selection, discovery, transport, resolution).
// ---------------------------------------------------------------------------

const SNAPSHOT_MAX_BYTES = 64 * 1024;
const SNAPSHOT_MAX_LINES = 1000;

type OperationActionId =
	| (typeof browserUseOperationFailureActions)[number]["id"]
	| (typeof browserUseOperationSuccessActions)[number]["id"];

const operationActions = [
	...browserUseOperationFailureActions,
	...browserUseOperationSuccessActions,
] as const;
const operationActionById = new Map(
	operationActions.map((action) => [action.id, action]),
);

type OperationFailure = Failure<OperationActionId>;

type OperationSideEffects = {
	focus?: boolean;
};

type OperationTargetEntry = {
	candidate: BrowserTargetCandidate;
	pageId?: number;
};

type ScreenshotArtifact = {
	path: string;
	relativePath: string;
	root: string;
	format: "png";
	fullPage: boolean;
};

type ViewportEmulation = {
	width: number;
	height: number;
	device_scale_factor: number;
	mobile: boolean;
	touch: boolean;
	landscape: boolean;
	viewport_arg: string;
};

type OperationInputs = {
	operation: BrowserOperationClass;
	screenshot?: ScreenshotArtifact;
	viewport?: ViewportEmulation;
};

type OperationBindingContext = {
	handoff: HandoffFacts;
};

type OperationTargetContext = {
	targetEnvelopeId: string;
	targetEntries: OperationTargetEntry[];
};

type ResolvedOperationTarget = {
	candidate: BrowserTargetCandidate;
	source: "hints" | "selected_state" | "single_candidate";
	pageId: number;
};

export async function runOperate(input: {
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>;
	runtime: BrowserUseRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	runIdExplicit: boolean;
	diagnosticVerbose: boolean;
	durationMs: () => number;
}): Promise<number> {
	const { parsed, runtime } = input;
	const flags = parsed.flagValues;
	// One run id threads the chain (R3): once the binding's handoff run id is
	// inherited below, every emitted envelope — failures after that point and
	// the success — carries it, so the top-level run_id agrees with
	// binding.run_id.
	let runId = input.runId;
	const fail = (failure: OperationFailure, sideEffects: OperationSideEffects = {}) =>
		emitOperationFailure({
			failure,
			command: parsed.command,
			sideEffects,
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId,
			durationMs: input.durationMs(),
		});

	const operationInputs = readOperationInputs({
		command: parsed.command,
		flags,
		env: runtime.env,
		runId: input.runId,
	});
	if (!operationInputs.ok) return fail(operationInputs.failure);

	const binding = await loadOperationBinding({
		runtime,
		flags,
		operation: operationInputs.inputs.operation,
		runId: input.runId,
		runIdExplicit: input.runIdExplicit,
	});
	if (!binding.ok) return fail(binding.failure);
	runId = binding.context.handoff.runId;

	const targetContext = await loadOperationTargetContext(runtime, binding.context);
	if (!targetContext.ok) return fail(targetContext.failure);

	const target = await resolveOperationTargetEntry({
		runtime,
		flags,
		runId: input.runId,
		runIdExplicit: input.runIdExplicit,
		targetEnvelopeId: targetContext.context.targetEnvelopeId,
		targetEntries: targetContext.context.targetEntries,
		handoff: binding.context.handoff,
		now: runtime.now(),
	});
	if (!target.ok) return fail(target.failure);

	const artifactDirectory = operationInputs.inputs.screenshot
		? await ensureScreenshotArtifactDirectory(
				runtime,
				operationInputs.inputs.screenshot,
			)
		: undefined;
	if (artifactDirectory && !artifactDirectory.ok) return fail(artifactDirectory.failure);

	const bringToFront = flags["--bring-to-front"] !== undefined;
	const selectedPage = await selectOperationPage({
		runtime,
		adapter: binding.context.handoff.adapter,
		pageId: target.target.pageId,
		bringToFront,
	});
	if (!selectedPage.ok) return fail(selectedPage.failure);

	const operationCall = await runOperationTransport({
		runtime,
		adapter: binding.context.handoff.adapter,
		operation: operationInputs.inputs.operation,
		screenshot: operationInputs.inputs.screenshot,
		viewport: operationInputs.inputs.viewport,
		verbose: input.diagnosticVerbose,
	});
	if (!operationCall.ok) {
		return fail(operationFailureFromTransport(operationCall.failure), {
			focus: true,
		});
	}
	if (operationCall.result.exitCode !== 0) {
		return fail(
			operationTransportExitedFailure("The adapter Browser Operation call failed."),
			{ focus: true },
		);
	}

	return emitOperationSuccess({
		command: parsed.command,
		operation: operationInputs.inputs.operation,
		adapter: binding.context.handoff.adapter,
		handoff: binding.context.handoff,
		target: target.target.candidate,
		targetSource: target.target.source,
		outputMode: parsed.outputMode,
		stdout: input.stdout,
		runId,
		durationMs: input.durationMs(),
		transportResult: operationCall.result,
		...(operationInputs.inputs.screenshot
			? { screenshot: operationInputs.inputs.screenshot }
			: {}),
		...(operationInputs.inputs.viewport
			? { viewport: operationInputs.inputs.viewport }
			: {}),
		focusSideEffect: bringToFront,
	});
}

function readOperationInputs(input: {
	command: BrowserUseCommand;
	flags: Record<string, string>;
	env: Record<string, string | undefined>;
	runId: string;
}): { ok: true; inputs: OperationInputs } | { ok: false; failure: OperationFailure } {
	const operation = operationClassForCommand(input.command);
	const screenshot = input.command === "operate-screenshot"
		? readScreenshotArtifact(input.flags, input.env, input.runId)
		: undefined;
	if (screenshot && !screenshot.ok) return { ok: false, failure: screenshot.failure };

	const viewport = input.command === "operate-emulate"
		? readViewportEmulation(input.flags)
		: undefined;
	if (viewport && !viewport.ok) return { ok: false, failure: viewport.failure };

	return {
		ok: true,
		inputs: {
			operation,
			...(screenshot?.ok ? { screenshot: screenshot.artifact } : {}),
			...(viewport?.ok ? { viewport: viewport.viewport } : {}),
		},
	};
}

async function loadOperationBinding(input: {
	runtime: BrowserUseRuntime;
	flags: Record<string, string>;
	operation: BrowserOperationClass;
	runId: string;
	runIdExplicit: boolean;
}): Promise<
	{ ok: true; context: OperationBindingContext } | { ok: false; failure: OperationFailure }
> {
	const handoffPath = stringField(input.flags["--handoff"]);
	if (!handoffPath) {
		return {
			ok: false,
			failure: operationHandoffInvalidFailure("operate requires --handoff <path>"),
		};
	}

	const parse = await readHandoffFacts(input.runtime, handoffPath);
	if (!parse.ok) {
		return {
			ok: false,
			failure: operationHandoffInvalidFailure(parse.failure.message),
		};
	}
	if (parse.kind === "failed") {
		return {
			ok: false,
			failure: operationHandoffInvalidFailure(
				"the supplied envelope is a browser-connect failure envelope; it authorizes no attachment",
			),
		};
	}
	const handoff = parse.facts;

	// One run id threads the chain (R3): an explicitly asserted run id must be
	// the envelope's run id.
	if (input.runIdExplicit && input.runId !== handoff.runId) {
		return {
			ok: false,
			failure: {
				code: "browser_operation_run_mismatch",
				message:
					"The asserted --run-id does not match the handoff envelope's run id.",
				actionId: "supply_verified_handoff",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}

	// Capability authorization (R5): the envelope authorizes an attachment; the
	// capability set for that adapter is browser-use policy, enforced through
	// the surviving router engine.
	if (
		!authorizesOperationClass(
			{ authorized_capabilities: [...handoff.authorizedCapabilities] },
			input.operation,
		)
	) {
		return {
			ok: false,
			failure: {
				code: "browser_operation_capability_unauthorized",
				message:
					"The verified handoff's adapter does not authorize the requested Browser Operation capability.",
				actionId: "change_operation_input",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}

	return { ok: true, context: { handoff } };
}

async function loadOperationTargetContext(
	runtime: BrowserUseRuntime,
	binding: OperationBindingContext,
): Promise<
	{ ok: true; context: OperationTargetContext } | { ok: false; failure: OperationFailure }
> {
	const discovery = await discoverPages(runtime, binding.handoff.adapter);
	if (!discovery.ok) {
		return { ok: false, failure: operationFailureFromDiscovery(discovery.failure) };
	}

	const targetEnvelopeId = targetEnvelopeIdOf({
		runId: binding.handoff.runId,
		mode: "handoff-bound",
		adapter: binding.handoff.adapter,
		handoffEvidenceId: binding.handoff.handoffEvidenceId,
	});
	const targetEntries = operationTargetEntries(discovery.pages, targetEnvelopeId);
	if (targetEntries.length === 0) {
		return {
			ok: false,
			failure: {
				code: "browser_operation_target_missing",
				message:
					"No operation-ready Browser Target Candidates were discovered through the attached adapter.",
				actionId: "rerun_handoff_bound_target_discovery",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "retry",
			},
		};
	}

	return { ok: true, context: { targetEnvelopeId, targetEntries } };
}

async function resolveOperationTargetEntry(input: {
	runtime: BrowserUseRuntime;
	flags: Record<string, string>;
	runId: string;
	runIdExplicit: boolean;
	targetEnvelopeId: string;
	targetEntries: OperationTargetEntry[];
	handoff: HandoffFacts;
	now: number;
}): Promise<
	{ ok: true; target: ResolvedOperationTarget } | { ok: false; failure: OperationFailure }
> {
	const selectedState = await loadOperationSelectedState({
		runtime: input.runtime,
		flags: input.flags,
		env: input.runtime.env,
		runId: input.runId,
		runIdExplicit: input.runIdExplicit,
		targetEnvelopeId: input.targetEnvelopeId,
		handoff: input.handoff,
		now: input.now,
	});
	if (!selectedState.ok) return { ok: false, failure: selectedState.failure };

	const hints = readOperationHints(input.flags);
	const resolution = resolveOperationTarget({
		hints,
		candidates: input.targetEntries.map((entry) => entry.candidate),
		...(selectedState.state
			? {
					selectedState: {
						target_candidate_id: selectedState.state.target_candidate_id,
						selected_candidate_ordinal:
							selectedState.state.selected_candidate_ordinal,
					},
				}
			: {}),
		handoffBoundFreshBinding: true,
	});
	if (resolution.kind !== "resolved") {
		return {
			ok: false,
			failure: operationFailureFromResolution(resolution, hasOperationHints(hints)),
		};
	}

	const targetEntry = input.targetEntries.find(
		(entry) => entry.candidate.candidate_id === resolution.candidate.candidate_id,
	);
	if (!targetEntry || targetEntry.pageId === undefined) {
		return {
			ok: false,
			failure: {
				code: "browser_operation_target_missing",
				message:
					"The resolved Browser Target no longer carries an adapter page handle; re-run handoff-bound target discovery.",
				actionId: "rerun_handoff_bound_target_discovery",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "retry",
			},
		};
	}

	return {
		ok: true,
		target: {
			candidate: resolution.candidate,
			source: resolution.source,
			pageId: targetEntry.pageId,
		},
	};
}

async function selectOperationPage(input: {
	runtime: BrowserUseRuntime;
	adapter: BrowserAdapterId;
	pageId: number;
	bringToFront: boolean;
}): Promise<{ ok: true } | { ok: false; failure: OperationFailure }> {
	const selectPage = await runBrowserUseMcporter(input.runtime, [
		"call",
		`${input.adapter}.select_page`,
		"--args",
		JSON.stringify({
			pageId: input.pageId,
			bringToFront: input.bringToFront,
		}),
		"--output",
		"json",
	]);
	if (!selectPage.ok) {
		return { ok: false, failure: operationFailureFromTransport(selectPage.failure) };
	}
	if (selectPage.result.exitCode !== 0) {
		return {
			ok: false,
			failure: operationTransportExitedFailure("The adapter select_page call failed."),
		};
	}
	return { ok: true };
}

function operationClassForCommand(command: BrowserUseCommand): BrowserOperationClass {
	if (command === "operate-snapshot") return "snapshot";
	if (command === "operate-screenshot") return "screenshot";
	if (command === "operate-emulate") return "emulate";
	throw new Error(`Unsupported Browser Operation command: ${command}`);
}

function readOperationHints(flags: Record<string, string>): OperationTargetHints {
	return {
		...(stringField(flags["--origin"]) ? { origin: flags["--origin"] } : {}),
		...(stringField(flags["--url-contains"])
			? { urlContains: flags["--url-contains"] }
			: {}),
		...(stringField(flags["--title-contains"])
			? { titleContains: flags["--title-contains"] }
			: {}),
	};
}

function hasOperationHints(hints: OperationTargetHints): boolean {
	return (
		hints.origin !== undefined ||
		hints.urlContains !== undefined ||
		hints.titleContains !== undefined
	);
}

function operationTargetEntries(
	pages: readonly RawPage[],
	targetEnvelopeId: string,
): OperationTargetEntry[] {
	return pages
		.filter((page) => parseUrlSafe(page.url))
		.map((page, index) => ({
			candidate: toCandidate(page, index, targetEnvelopeId, true),
			pageId: parseAdapterPageId(page.id),
		}));
}

function parseAdapterPageId(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

type OperationStateLoad =
	| { ok: true; state?: SelectedTargetState }
	| { ok: false; failure: OperationFailure };

async function loadOperationSelectedState(input: {
	runtime: BrowserUseRuntime;
	flags: Record<string, string>;
	env: Record<string, string | undefined>;
	runId: string;
	runIdExplicit: boolean;
	targetEnvelopeId: string;
	handoff: HandoffFacts;
	now: number;
}): Promise<OperationStateLoad> {
	const hasStateSource =
		stringField(input.flags["--state"]) !== undefined ||
		stringField(input.env.BROWSER_USE_TARGET_STATE_DIR) !== undefined;
	if (!hasStateSource) return { ok: true };

	const statePath = resolveStatePath(
		input.flags,
		input.env,
		input.runId,
		input.runIdExplicit,
	);
	if (!statePath.ok) {
		return { ok: false, failure: operationFailureFromSelection(statePath.failure) };
	}
	const load = await loadSelectedState(input.runtime, statePath.path, {
		now: input.now,
		expectedRunId: input.runIdExplicit ? input.runId : undefined,
	});
	if (!load.ok) {
		return { ok: false, failure: operationFailureFromSelection(load.failure) };
	}
	const state = load.state;
	if (
		state.selected_adapter_id !== input.handoff.adapter ||
		state.verified_endpoint_identity !== input.handoff.verifiedEndpointIdentity ||
		state.handoff_evidence_id !== input.handoff.handoffEvidenceId ||
		state.target_envelope_id !== input.targetEnvelopeId
	) {
		return {
			ok: false,
			failure: {
				code: "target_state_mismatch",
				message:
					"The selected-target state does not match the supplied Verified Handoff Envelope binding.",
				actionId: "refresh_target_selection",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	return { ok: true, state };
}

function readScreenshotArtifact(
	flags: Record<string, string>,
	env: Record<string, string | undefined>,
	runId: string,
): { ok: true; artifact: ScreenshotArtifact } | { ok: false; failure: OperationFailure } {
	const raw = stringField(flags["--out"]);
	if (!raw) {
		return {
			ok: false,
			failure: {
				code: "browser_operation_artifact_path_required",
				message: "operate screenshot requires --out <path>.",
				actionId: "change_operation_input",
				exitCode: USAGE_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	const root = screenshotArtifactRoot(env, runId);
	if (!root.ok) return { ok: false, failure: root.failure };
	const normalized = normalize(raw);
	const segments = normalized.split(/[\\/]+/);
	if (
		raw.includes("\0") ||
		isAbsolute(raw) ||
		normalized === "." ||
		normalized.startsWith("..") ||
		segments.includes("..")
	) {
		return {
			ok: false,
			failure: {
				code: "browser_operation_artifact_path_unsafe",
				message:
					"operate screenshot --out must be a relative path inside the run-scoped artifact root.",
				actionId: "change_operation_input",
				exitCode: USAGE_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	const resolvedRoot = resolve(root.root);
	const artifactPath = resolve(resolvedRoot, normalized);
	const relativeToRoot = relative(resolvedRoot, artifactPath);
	if (
		relativeToRoot === "" ||
		relativeToRoot.startsWith("..") ||
		isAbsolute(relativeToRoot)
	) {
		return {
			ok: false,
			failure: {
				code: "browser_operation_artifact_path_unsafe",
				message:
					"operate screenshot --out must resolve inside the run-scoped artifact root.",
				actionId: "change_operation_input",
				exitCode: USAGE_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	return {
		ok: true,
		artifact: {
			path: artifactPath,
			relativePath: normalized,
			root: resolvedRoot,
			format: "png",
			fullPage: flags["--full-page"] !== undefined,
		},
	};
}

function screenshotArtifactRoot(
	env: Record<string, string | undefined>,
	runId: string,
): { ok: true; root: string } | { ok: false; failure: OperationFailure } {
	const explicit = stringField(env.BROWSER_USE_ARTIFACT_ROOT);
	if (explicit) {
		if (explicit.includes("\0") || !isAbsolute(explicit)) {
			return {
				ok: false,
				failure: {
					code: "browser_operation_artifact_path_unsafe",
					message:
						"BROWSER_USE_ARTIFACT_ROOT must be an absolute run-scoped artifact root.",
					actionId: "change_operation_input",
					exitCode: USAGE_EXIT_CODE,
					recoverability: "change_input",
				},
			};
		}
		return { ok: true, root: explicit };
	}
	return {
		ok: true,
		root: join(tmpdir(), "browser-use-artifacts", runScopedKey(runId)),
	};
}

async function ensureScreenshotArtifactDirectory(
	runtime: BrowserUseRuntime,
	artifact: ScreenshotArtifact,
): Promise<{ ok: true } | { ok: false; failure: OperationFailure }> {
	try {
		await runtime.ensureDirectory(dirname(artifact.path));
		return { ok: true };
	} catch {
		return {
			ok: false,
			failure: {
				code: "browser_operation_artifact_root_unwritable",
				message:
					"Could not create the screenshot artifact directory under the run-scoped artifact root.",
				actionId: "change_operation_input",
				exitCode: RUNTIME_FAILURE_EXIT_CODE,
				recoverability: "repair_state",
			},
		};
	}
}

function readViewportEmulation(
	flags: Record<string, string>,
): { ok: true; viewport: ViewportEmulation } | { ok: false; failure: OperationFailure } {
	const width = positiveIntFlag(flags["--width"]);
	const height = positiveIntFlag(flags["--height"]);
	const dpr = positiveNumberFlag(flags["--dpr"] ?? "1");
	if (!width || !height || !dpr) {
		return {
			ok: false,
			failure: {
				code: "browser_operation_viewport_invalid",
				message:
					"operate emulate requires positive --width, --height, and optional positive --dpr values.",
				actionId: "change_operation_input",
				exitCode: USAGE_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	const mobile = flags["--mobile"] !== undefined;
	const touch = flags["--touch"] !== undefined;
	const landscape = flags["--landscape"] !== undefined;
	const modifiers = [
		mobile ? "mobile" : "",
		touch ? "touch" : "",
		landscape ? "landscape" : "",
	].filter((part) => part !== "");
	const viewportArg = `${width}x${height}x${dpr}${modifiers.length > 0 ? `,${modifiers.join(",")}` : ""}`;
	return {
		ok: true,
		viewport: {
			width,
			height,
			device_scale_factor: dpr,
			mobile,
			touch,
			landscape,
			viewport_arg: viewportArg,
		},
	};
}

function positiveIntFlag(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function positiveNumberFlag(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function runOperationTransport(input: {
	runtime: BrowserUseRuntime;
	adapter: BrowserAdapterId;
	operation: BrowserOperationClass;
	screenshot?: ScreenshotArtifact;
	viewport?: ViewportEmulation;
	verbose: boolean;
}): Promise<BrowserOperationTransportResult> {
	if (input.operation === "snapshot") {
		return runBrowserUseMcporter(input.runtime, [
			"call",
			`${input.adapter}.take_snapshot`,
			"--args",
			JSON.stringify(input.verbose ? { verbose: true } : {}),
			"--output",
			"json",
		]);
	}
	if (input.operation === "screenshot") {
		return runBrowserUseMcporter(input.runtime, [
			"call",
			`${input.adapter}.take_screenshot`,
			"--args",
			JSON.stringify({
				filePath: input.screenshot?.path,
				fullPage: input.screenshot?.fullPage ?? false,
				format: "png",
			}),
			"--output",
			"json",
		]);
	}
	return runBrowserUseMcporter(input.runtime, [
		"call",
		`${input.adapter}.emulate`,
		"--args",
		JSON.stringify({ viewport: input.viewport?.viewport_arg }),
		"--output",
		"json",
	]);
}

function operationHandoffInvalidFailure(detail: string): OperationFailure {
	return {
		code: "browser_operation_handoff_invalid",
		message: `The supplied Verified Handoff Envelope cannot authorize the operation: ${detail}.`,
		actionId: "supply_verified_handoff",
		exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
		recoverability: "change_input",
	};
}

function operationFailureFromSelection(
	failure: SelectionFailure,
): OperationFailure {
	return {
		code: failure.code,
		message: failure.message,
		actionId: failure.actionId,
		exitCode: failure.exitCode,
		recoverability: failure.recoverability,
	};
}

function operationFailureFromDiscovery(
	failure: TargetDiscoveryFailure,
): OperationFailure {
	if (failure.code === "target_discovery_dependency_missing") {
		return dependencyOperationFailure("browser_operation_dependency_missing", failure.message);
	}
	if (failure.code === "target_discovery_command_override_invalid") {
		return dependencyOperationFailure(
			"browser_operation_command_override_invalid",
			failure.message,
		);
	}
	if (failure.code === "target_discovery_transport_timeout") {
		return {
			code: "browser_operation_transport_timeout",
			message: failure.message,
			actionId: "inspect_operation_diagnostics",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "retry",
		};
	}
	return operationTransportExitedFailure(failure.message);
}

function operationFailureFromTransport(
	failure: BrowserOperationTransportFailure,
): OperationFailure {
	if (failure.kind === "dependency_missing") {
		return dependencyOperationFailure(failure.code, failure.hintSummary);
	}
	if (failure.kind === "command_override_invalid") {
		return dependencyOperationFailure(failure.code, failure.hintSummary);
	}
	if (failure.kind === "transport_timeout") {
		return {
			code: failure.code,
			message: failure.hintSummary,
			actionId: "inspect_operation_diagnostics",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "retry",
		};
	}
	return operationTransportExitedFailure(failure.hintSummary);
}

function dependencyOperationFailure(code: string, message: string): OperationFailure {
	return {
		code,
		message,
		actionId: "configure_operation_dependency",
		exitCode: RUNTIME_FAILURE_EXIT_CODE,
		recoverability: "repair_state",
	};
}

function operationTransportExitedFailure(message: string): OperationFailure {
	return {
		code: "browser_operation_transport_failed",
		message,
		actionId: "inspect_operation_diagnostics",
		exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
		recoverability: "retry",
	};
}

function operationFailureFromResolution(
	resolution: Exclude<OperationResolution, { kind: "resolved" }>,
	hasHints: boolean,
): OperationFailure {
	if (resolution.kind === "ambiguous") {
		return {
			code: "browser_operation_target_ambiguous",
			message: `Browser Operation target resolution matched ${resolution.matchCount} candidates.`,
			actionId: hasHints ? "refine_target_hint" : "choose_target_candidate",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		};
	}
	if (resolution.kind === "no_match") {
		return {
			code: "browser_operation_target_no_match",
			message:
				"No Browser Target Candidate matches the supplied operation hints.",
			actionId: "refine_target_hint",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		};
	}
	if (resolution.kind === "selection_moved") {
		return {
			code: "browser_operation_target_moved",
			message:
				"The selected Browser Target is no longer present in the current handoff-bound target set.",
			actionId: "refresh_target_selection",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		};
	}
	return {
		code: "browser_operation_target_missing",
		message:
			"No Browser Target was selected and no single handoff-bound candidate is available.",
		actionId: "choose_target_candidate",
		exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
		recoverability: "change_input",
	};
}

function operationAction(id: OperationActionId): RuntimeActionGuidance {
	return actionFor(operationActionById, id, "operation");
}

function emitOperationFailure(input: {
	failure: OperationFailure;
	command: BrowserUseCommand;
	sideEffects: OperationSideEffects;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const { failure } = input;
	if (input.outputMode === "plain") {
		input.stderr.write(
			`browser_use ${failure.code}: ${redactUnsafeText(failure.message)} action=${failure.actionId} focus_side_effect=${input.sideEffects.focus === true} (run_id=${input.runId})\n`,
		);
		return failure.exitCode;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: failure.exitCode,
			data: {
				command: input.command,
				result_kind: "browser_operation",
				side_effects: { focus: input.sideEffects.focus === true },
			},
			runtime_actions: [operationAction(failure.actionId)],
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

function emitOperationSuccess(input: {
	command: BrowserUseCommand;
	operation: BrowserOperationClass;
	adapter: BrowserAdapterId;
	handoff: HandoffFacts;
	target: BrowserTargetCandidate;
	targetSource: "hints" | "selected_state" | "single_candidate";
	outputMode: OutputMode;
	stdout: CliWriter;
	runId: string;
	durationMs: number;
	transportResult: McporterCommandResult;
	screenshot?: ScreenshotArtifact;
	viewport?: ViewportEmulation;
	focusSideEffect: boolean;
}): number {
	if (input.outputMode === "plain") {
		input.stdout.write(
			[
				"browser_operation_completed",
				`operation=${input.operation}`,
				`adapter=${input.adapter}`,
				`target_source=${input.targetSource}`,
				`candidate_ordinal=${input.target.candidate_ordinal}`,
				`focus_side_effect=${input.focusSideEffect}`,
				"action=inspect_operation_result",
				`run_id=${input.runId}`,
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
				contract: BROWSER_USE_OPERATION_CONTRACT_ID,
				schema_version: BROWSER_USE_OPERATION_SCHEMA_VERSION,
				command: input.command,
				result_kind: "browser_operation",
				operation: input.operation,
				adapter: input.adapter,
				binding: {
					run_id: input.handoff.runId,
					handoff_evidence_id: input.handoff.handoffEvidenceId,
					target_candidate_id: input.target.candidate_id,
				},
				target_source: input.targetSource,
				target: {
					candidate_ordinal: input.target.candidate_ordinal,
					candidate_id: input.target.candidate_id,
					origin: input.target.origin,
					...(input.target.path_shape
						? { path_shape: input.target.path_shape }
						: {}),
					...(input.target.title ? { title: input.target.title } : {}),
				},
				side_effects: {
					focus: input.focusSideEffect,
				},
				...operationPayload(input),
			},
			runtime_actions: [operationAction("inspect_operation_result")],
			continuation: { next_action_id: "inspect_operation_result" },
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return 0;
}

function operationPayload(input: {
	operation: BrowserOperationClass;
	transportResult: McporterCommandResult;
	screenshot?: ScreenshotArtifact;
	viewport?: ViewportEmulation;
}): Record<string, unknown> {
	switch (input.operation) {
		case "snapshot":
			return { snapshot: normalizeSnapshot(input.transportResult.stdout) };
		case "screenshot":
			return {
				screenshot: {
					artifact: input.screenshot
						? {
								path: input.screenshot.path,
								relative_path: input.screenshot.relativePath,
								root: input.screenshot.root,
								format: input.screenshot.format,
								full_page: input.screenshot.fullPage,
							}
						: undefined,
				},
			};
		case "emulate":
			return {
				emulation: {
					viewport: input.viewport
						? {
								width: input.viewport.width,
								height: input.viewport.height,
								device_scale_factor: input.viewport.device_scale_factor,
								mobile: input.viewport.mobile,
								touch: input.viewport.touch,
								landscape: input.viewport.landscape,
							}
						: undefined,
				},
			};
		default: {
			const exhaustive: never = input.operation;
			throw new Error(`Unsupported Browser Operation: ${exhaustive}`);
		}
	}
}

function normalizeSnapshot(stdout: string): Record<string, unknown> {
	const text = extractTextContent(parseTransportOutput(stdout));
	const bounded = boundSnapshotText(text);
	return {
		text: bounded.text,
		line_count: bounded.lineCount,
		byte_count: bounded.byteCount,
		truncated: bounded.truncated,
		limits: {
			max_bytes: SNAPSHOT_MAX_BYTES,
			max_lines: SNAPSHOT_MAX_LINES,
		},
	};
}

function parseTransportOutput(stdout: string): unknown {
	if (stdout.trim() === "") return "";
	try {
		return JSON.parse(stdout);
	} catch {
		return stdout;
	}
}

function extractTextContent(value: unknown): string {
	if (typeof value === "string") return value;
	if (!isJsonObject(value)) return "";
	if (typeof value.text === "string") return value.text;
	if (typeof value.result === "string") return value.result;
	const content = value.content;
	if (Array.isArray(content)) {
		return content
			.flatMap((entry) =>
				isJsonObject(entry) && typeof entry.text === "string" ? [entry.text] : [],
			)
			.join("\n");
	}
	return "";
}

function boundSnapshotText(text: string): {
	text: string;
	lineCount: number;
	byteCount: number;
	truncated: boolean;
} {
	const lines = text.split("\n");
	let bounded = lines.slice(0, SNAPSHOT_MAX_LINES).join("\n");
	let truncated = lines.length > SNAPSHOT_MAX_LINES;
	while (Buffer.byteLength(bounded, "utf-8") > SNAPSHOT_MAX_BYTES) {
		bounded = bounded.slice(0, Math.max(0, bounded.length - 1024));
		truncated = true;
	}
	return {
		text: bounded,
		lineCount: bounded === "" ? 0 : bounded.split("\n").length,
		byteCount: Buffer.byteLength(bounded, "utf-8"),
		truncated,
	};
}
