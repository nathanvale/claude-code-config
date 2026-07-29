import { join } from "node:path";
import type {
	RuntimeErrorRecoverability,
	CliWriter,
} from "@side-quest/cli-command-facade";
import type {
	browserUsePlatformStoreFailureActions,
	browserUsePlatformStoreSuccessActions,
	browserUseRunbookInputFailureActions,
	browserUseTaskRunFailureActions,
	browserUseTaskRunSuccessActions,
} from "./command-contract";
import {
	BINDING_FAIL_CLOSED_EXIT_CODE,
	USAGE_EXIT_CODE,
	stringField,
	targetEnvelopeIdOf,
} from "./browser-use-core";
import type { BrowserAdapterId } from "./discovery-model";
import {
	type AgentBrowserExecutionResult,
	type AgentBrowserTargetResolutionResult,
	type AgentBrowserVerifiedHandoff,
	resolveAgentBrowserTaskTarget,
} from "./browser-use-agent-browser";
import {
	type BrowserUseAuthProvider,
	createBrowserUseAuthProvider,
} from "./browser-use-auth-provider";
import type { HandoffFacts } from "./browser-use-discovery";
import {
	type BrowserUseGenerationRuntime,
	createBrowserUseGenerationRuntime,
} from "./browser-use-generation-runtime";
import {
	type LeaseWriteClaim,
	acquireLease,
	heartbeatLease,
	releaseLease,
	withActivationEpochBarrier,
} from "./browser-use-locks";
import type { BrowserUseMigrationFailure } from "./browser-use-migration-model";
import {
	readActiveCorpusManifest,
	readBrowserUseMigrationStatus,
	readRetainedCorpusGenerationManifest,
	tripActiveGenerationEffectFence,
} from "./browser-use-migration";
import type {
	BrowserUseArtifactReference,
	BrowserUseCallerMetadata,
	BrowserUseRunStructuredResult,
	BrowserUseRunState,
	BrowserUseSharedRun,
	BrowserUseTaskIntent,
} from "./browser-use-run-model";
import {
	type BrowserUseRunbookAuthDelivery,
	type BrowserUseRunbookDiscoveryFailure,
	type BrowserUseRunbookExecutionResult,
	type BrowserUseRunbookExecutionRefusal,
	type BrowserUseRunbookShowResult,
	enforceRunbookInputCustody,
	executePreparedRunbook,
	listEffectiveRunbooks,
	listRunbooks,
	prepareRunbookExecution,
	readPrivateStructuredInput,
	showRunbook,
} from "./browser-use-runbook";
import type {
	BrowserUseRunbookCatalogRow,
	BrowserUseRunbookInputs,
} from "./browser-use-runbook-model";
import { nextRunbookStepAfterExecution } from "./browser-use-runbook-model";
import type { BrowserUseRuntime } from "./browser-use-runtime";
import {
	attestationByDigestFrom,
	createSharedRun,
	leaseKeyForRun,
	loadSharedRun,
	type RunStoreDeps,
} from "./browser-use-runs";
import type { BrowserUseLeasePayload } from "./browser-use-schemas";
import {
	type BrowserUseSensitiveRunGuard,
	beginSensitiveRunGuard,
} from "./browser-use-sensitive-run";
import type {
	ParsedBrowserUseCommand,
} from "./browser-use-parser";

type RunbookPlatformActionId =
	| (typeof browserUsePlatformStoreFailureActions)[number]["id"]
	| (typeof browserUsePlatformStoreSuccessActions)[number]["id"];

type RunbookTaskActionId =
	| (typeof browserUseTaskRunFailureActions)[number]["id"]
	| (typeof browserUseRunbookInputFailureActions)[number]["id"]
	| (typeof browserUseTaskRunSuccessActions)[number]["id"];

/**
 * Driver context consumed by the runbook command module.
 *
 * The CLI driver retains generic writers, runtime construction, and envelope
 * ownership. This context carries only the already-resolved command facts.
 *
 * @internal
 */
export type BrowserUseRunbookCommandInput = {
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>;
	runtime: BrowserUseRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	caller: BrowserUseCallerMetadata;
	durationMs: () => number;
};

/**
 * Generic platform failure requested by runbook orchestration.
 *
 * The browser-use driver renders this through its existing platform envelope
 * owner, preserving JSON/plain parity and action metadata.
 *
 * @internal
 */
export type BrowserUseRunbookCommandFailure = {
	code: string;
	message: string;
	actionId: RunbookPlatformActionId;
	exitCode: number;
	recoverability: RuntimeErrorRecoverability;
};

/**
 * Shared-run failure requested by runbook orchestration.
 *
 * @internal
 */
export type BrowserUseRunbookTaskFailure = {
	code: string;
	message: string;
	actionId: RunbookTaskActionId;
	exitCode: number;
	recoverability: RuntimeErrorRecoverability;
	dataExtra?: Record<string, unknown>;
};

/**
 * Runbook lane outcome translated into shared-run truth.
 *
 * @internal
 */
export type BrowserUseRunbookDispatchMapping =
	| {
			kind: "confirmed";
			executedSteps: number;
			mutationDispatched?: boolean;
	  }
	| {
			kind: "blocked";
			state: BrowserUseRunState;
			continuation: { next_action_id: string; summary: string };
			failure: BrowserUseRunbookTaskFailure;
			mutationDispatched?: boolean;
	  }
	| {
			kind: "terminal";
			state: BrowserUseRunState;
			failure: BrowserUseRunbookTaskFailure;
			mutationDispatched?: boolean;
	  };

/**
 * Sensitive-delivery containment outcome retained by the generic driver.
 *
 * @internal
 */
export type BrowserUseRunbookDeliveryGuardOutcome =
	| { ok: true; guard: BrowserUseSensitiveRunGuard | undefined }
	| {
			ok: false;
			reason:
				| "guard_unavailable"
				| "sentinel_derivation_failed"
				| "sensitive_mark_failed";
	  };

type RunbookStateWriteResult =
	| { ok: true; run: BrowserUseSharedRun }
	| { ok: false; failure: BrowserUseRunbookCommandFailure };

type RecordRunbookOutcomeOptions = {
	artifacts?: readonly BrowserUseArtifactReference[];
	guard?: BrowserUseSensitiveRunGuard;
	runbookNextStep?: number;
	heldClaim?: LeaseWriteClaim;
	structuredResults?: readonly BrowserUseRunStructuredResult[];
};

/**
 * Existing driver-owned ports used by runbook command orchestration.
 *
 * @internal
 */
export type BrowserUseRunbookCommandPorts = {
	clock: () => number;
	runtime: Pick<BrowserUseRuntime, "runCommand" | "authTokenRetrieval">;
	store: {
		open: (
			access?: "read" | "write",
		) => Promise<
			| { ok: true; deps: RunStoreDeps }
			| { ok: false; exitCode: number }
		>;
	};
	output: {
		emitPlatformFailure: (
			failure: BrowserUseRunbookCommandFailure,
		) => number;
		emitTaskFailure: (
			runId: string | undefined,
			failure: BrowserUseRunbookTaskFailure,
		) => number;
		emitMigrationFailure: (failure: BrowserUseMigrationFailure) => number;
		emitCatalog: (rows: readonly BrowserUseRunbookCatalogRow[]) => number;
		emitDefinition: (
			shown: Extract<BrowserUseRunbookShowResult, { ok: true }>,
		) => number;
		emitSharedRunSuccess: (input: {
			run: BrowserUseSharedRun;
			continuationId: string;
			dataExtra?: Record<string, unknown>;
			plainExtra?: readonly string[];
		}) => number;
	};
	handoff: {
		acquire: () => Promise<
			| {
					ok: true;
					handoff: HandoffFacts;
					rawHandoffData: unknown;
			  }
			| { ok: false; exitCode: number }
		>;
		checkSameLaneResume: (
			run: BrowserUseSharedRun,
			routedLaneId: string,
			handoff: HandoffFacts,
		) => BrowserUseRunbookTaskFailure | undefined;
	};
	run: {
		isTerminalState: (state: BrowserUseRunState) => boolean;
		platformFailureOf: (
			code: string,
			message: string,
		) => BrowserUseRunbookCommandFailure;
		persistFenced: (
			deps: RunStoreDeps,
			run: BrowserUseSharedRun,
			holderId: string,
			mutate: (current: BrowserUseSharedRun) => BrowserUseSharedRun,
			heldClaim?: LeaseWriteClaim,
		) => Promise<RunbookStateWriteResult>;
		persistMutationDispatch: (
			deps: RunStoreDeps,
			run: BrowserUseSharedRun,
			heldClaim?: LeaseWriteClaim,
		) => Promise<RunbookStateWriteResult>;
		recordOutcome: (
			deps: RunStoreDeps,
			run: BrowserUseSharedRun,
			route: {
				lane_id: BrowserAdapterId;
				source: string;
				intent: BrowserUseTaskIntent;
			},
			mapping: BrowserUseRunbookDispatchMapping,
			options?: RecordRunbookOutcomeOptions,
		) => Promise<number>;
		mapAgentBrowserOutcome: (
			result: AgentBrowserExecutionResult,
		) => BrowserUseRunbookDispatchMapping;
		markGuardForDeliveryOutcome: (
			baseGuard: BrowserUseSensitiveRunGuard | undefined,
			result: AgentBrowserExecutionResult,
		) => BrowserUseRunbookDeliveryGuardOutcome;
		sentinelRegistrationWithheldFailure: (
			reason: Extract<
				BrowserUseRunbookDeliveryGuardOutcome,
				{ ok: false }
			>["reason"],
		) => BrowserUseRunbookTaskFailure;
	};
};

/** Active corpus authority captured once for one runbook command. */
type CapturedActiveGeneration =
	| { status: "missing" }
	| { status: "present"; runtime: BrowserUseGenerationRuntime }
	| {
			status: "failure";
			code: BrowserUseRunbookDiscoveryFailure["code"];
			message: string;
	  };

/**
 * Capture active generation authority once for one command.
 *
 * Corrupt authority fails closed. A truly missing manifest retains the
 * compatibility catalog behavior.
 *
 * @param deps - Admitted store, filesystem, and clock ports
 * @returns Captured authority or a value-safe discovery refusal
 * @internal
 */
async function captureActiveGeneration(
	deps: RunStoreDeps,
): Promise<CapturedActiveGeneration> {
	const status = await readBrowserUseMigrationStatus(deps);
	if (!status.ok) {
		return {
			status: "failure",
			code: "runbook_catalog_drift",
			message: status.message,
		};
	}
	const active = await readActiveCorpusManifest(deps);
	if (active.status === "missing") {
		return status.state.active_generation.state === "never-activated"
			? { status: "missing" }
			: {
					status: "failure",
					code: "runbook_catalog_drift",
					message:
						"completed or interrupted generation authority has no active manifest.",
				};
	}
	if (active.status === "corrupt") {
		return {
			status: "failure",
			code: "runbook_catalog_drift",
			message: active.message,
		};
	}
	const opened = await createBrowserUseGenerationRuntime(deps, active.manifest);
	return opened.ok
		? { status: "present", runtime: opened.runtime }
		: {
				status: "failure",
				code: opened.failure.code,
				message: opened.failure.message,
			};
}

const RUNBOOK_DISPATCH_LEASE_TTL_MS = 600_000;
const RUNBOOK_DISPATCH_HEARTBEAT_INTERVAL_MS =
	RUNBOOK_DISPATCH_LEASE_TTL_MS / 3;

function startRunbookDispatchLeaseHeartbeat(
	deps: RunStoreDeps,
	lease: BrowserUseLeasePayload,
	platformFailureOf: BrowserUseRunbookCommandPorts["run"]["platformFailureOf"],
): {
	failure: () => BrowserUseRunbookCommandFailure | undefined;
	stop: () => Promise<BrowserUseLeasePayload>;
} {
	let currentLease = lease;
	let failure: BrowserUseRunbookCommandFailure | undefined;
	let stopRequested = false;
	let wake: (() => void) | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const completed = (async () => {
		while (!stopRequested) {
			await new Promise<void>((resolve) => {
				const finishWait = () => {
					if (timer !== undefined) clearTimeout(timer);
					timer = undefined;
					wake = undefined;
					resolve();
				};
				wake = finishWait;
				timer = setTimeout(
					finishWait,
					RUNBOOK_DISPATCH_HEARTBEAT_INTERVAL_MS,
				);
			});
			if (stopRequested) break;
			const renewed = await heartbeatLease(deps, currentLease, {
				ttlMs: RUNBOOK_DISPATCH_LEASE_TTL_MS,
			});
			if (!renewed.ok) {
				const message =
					"message" in renewed
						? renewed.message
						: renewed.continuation.summary;
				failure = platformFailureOf(renewed.code, message);
				break;
			}
			currentLease = renewed.lease;
		}
	})();
	return {
		failure: () => failure,
		stop: async () => {
			stopRequested = true;
			wake?.();
			await completed;
			return currentLease;
		},
	};
}

function runbookTargetRepairMapping(
	result: Extract<AgentBrowserTargetResolutionResult, { ok: false }>,
): BrowserUseRunbookDispatchMapping {
	return {
		kind: "blocked",
		state: "needs-human",
		continuation: {
			next_action_id: "restore_bound_runbook_target",
			summary:
				"Restore the exact tab bound to this run, then resume with the same verified handoff; otherwise start a new run.",
		},
		mutationDispatched: result.mutation_dispatched,
		failure: {
			code: result.code,
			message: result.message,
			actionId: "restore_bound_runbook_target",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "repair_state",
			dataExtra: {
				lane_outcome: result.code,
				external_effect: "none",
			},
		},
	};
}

function mapRunbookAgentBrowserOutcome(
	result: AgentBrowserExecutionResult,
	ports: BrowserUseRunbookCommandPorts,
): BrowserUseRunbookDispatchMapping {
	if (
		!result.ok &&
		(result.code === "agent_browser_target_unavailable" ||
			result.code === "agent_browser_target_ambiguous" ||
			result.code === "agent_browser_target_moved")
	) {
		return runbookTargetRepairMapping(result);
	}
	return ports.run.mapAgentBrowserOutcome(result);
}

function buildRunbookAuthDelivery(
	provider: BrowserUseAuthProvider,
): BrowserUseRunbookAuthDelivery {
	void provider;
	return async () => ({
		ok: false,
		message:
			"the native Browser Authentication capability is present, but the runbook lane's live sensitive-interval delivery (verified-target proof and confidential-field hook) is not wired here yet. Complete the authentication transaction for this runbook lane before running a confidential runbook.",
	});
}

function persistRunbookPrivateState(
	ports: BrowserUseRunbookCommandPorts,
	deps: RunStoreDeps,
	run: BrowserUseSharedRun,
	mutate: (current: BrowserUseSharedRun) => BrowserUseSharedRun,
	heldClaim?: LeaseWriteClaim,
): Promise<RunbookStateWriteResult> {
	return ports.run.persistFenced(
		deps,
		run,
		`runbook-state-${run.run_id}`,
		mutate,
		heldClaim,
	);
}

function runbookResumeCursorOf(run: BrowserUseSharedRun): number {
	if (run.runbook_progress !== undefined) {
		return run.runbook_progress.next_step;
	}
	const id = run.continuation?.next_action_id ?? "";
	const match = id.match(/^runbook-resume:(\d+)$/);
	return match ? Number(match[1]) : 0;
}

/**
 * Map a runbook refusal onto the driver-owned platform failure contract.
 *
 * @param code - Runbook discovery or execution refusal code
 * @param message - Redaction-safe refusal message
 * @returns Generic failure rendered by the browser-use driver
 * @internal
 */
function runbookCommandFailureOf(
	code: BrowserUseRunbookExecutionRefusal["code"],
	message: string,
): BrowserUseRunbookCommandFailure {
	switch (code) {
		case "runbook_not_found":
		case "runbook_inactive":
		case "runbook_id_invalid":
		case "runbook_input_missing":
		case "runbook_input_rejected":
		case "runbook_resume_out_of_range":
			return {
				code,
				message,
				actionId: "supply_run_id",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "change_input",
			};
		case "runbook_record_corrupt":
		case "runbook_record_invalid":
		case "runbook_invalid":
		case "runbook_catalog_drift":
			return {
				code,
				message,
				actionId: "inspect_corrupt_store_record",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			};
		default:
			return {
				code,
				message,
				actionId: "inspect_shared_run",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			};
	}
}

/**
 * Run the read-only runbook catalog command.
 *
 * @param ports - Existing store and output owners
 * @returns Process exit code
 * @internal
 */
async function runRunbookList(
	ports: BrowserUseRunbookCommandPorts,
): Promise<number> {
	const store = await ports.store.open();
	if (!store.ok) return store.exitCode;
	const active = await captureActiveGeneration(store.deps);
	if (active.status === "failure") {
		return ports.output.emitPlatformFailure(
			runbookCommandFailureOf(active.code, active.message),
		);
	}
	const listed =
		active.status === "present"
			? await listEffectiveRunbooks(
					store.deps.fs,
					store.deps.paths.data.root,
					active.runtime.activeGenerationSeam,
				)
			: {
					ok: true as const,
					rows: await listRunbooks(
						store.deps.fs,
						store.deps.paths.data.root,
					),
				};
	if (!listed.ok) {
		return ports.output.emitPlatformFailure(
			runbookCommandFailureOf(
				listed.failure.code,
				listed.failure.message,
			),
		);
	}
	return ports.output.emitCatalog(listed.rows);
}

/**
 * Run the read-only runbook definition command.
 *
 * @param input - Resolved runbook command context
 * @param ports - Existing store and output owners
 * @returns Process exit code
 * @internal
 */
async function runRunbookShow(
	input: BrowserUseRunbookCommandInput,
	ports: BrowserUseRunbookCommandPorts,
): Promise<number> {
	const store = await ports.store.open();
	if (!store.ok) return store.exitCode;
	const active = await captureActiveGeneration(store.deps);
	if (active.status === "failure") {
		return ports.output.emitPlatformFailure(
			runbookCommandFailureOf(active.code, active.message),
		);
	}
	const serviceId = stringField(input.parsed.flagValues["--service"]) ?? "";
	const flowId = stringField(input.parsed.flagValues["--flow"]) ?? "";
	const shown = await showRunbook(
		store.deps.fs,
		store.deps.paths.data.root,
		{ serviceId, flowId },
		active.status === "present"
			? active.runtime.activeGenerationSeam
			: undefined,
	);
	if (!shown.ok) {
		return ports.output.emitPlatformFailure(
			runbookCommandFailureOf(shown.failure.code, shown.failure.message),
		);
	}
	return ports.output.emitDefinition(shown);
}

/**
 * Parse repeatable ordinary runbook input bindings.
 *
 * Values remain private to orchestration; malformed diagnostics reveal only
 * the input id.
 *
 * @param pairs - Repeated `<id>=<value>` bindings
 * @returns Parsed inputs or a value-safe usage refusal
 * @internal
 */
function parseRunbookInputs(
	pairs: readonly string[],
):
	| { ok: true; inputs: BrowserUseRunbookInputs }
	| { ok: false; message: string } {
	const inputs: Record<string, string> = {};
	for (const pair of pairs) {
		const equals = pair.indexOf("=");
		if (equals <= 0) {
			return {
				ok: false,
				message: `each --input must be <id>=<value>; received ${sanitizeInputPairForError(pair)}.`,
			};
		}
		inputs[pair.slice(0, equals)] = pair.slice(equals + 1);
	}
	return { ok: true, inputs };
}

type PrivateRunbookInputBinding = {
	inputId: string;
	filePath: string;
};

/**
 * Parse private input ids and paths without opening value-bearing files.
 *
 * @param pairs - Repeated `<id>=<absolute-path>` bindings
 * @returns Shape-checked bindings or a path/value-safe refusal
 * @internal
 */
function parsePrivateRunbookInputBindings(
	pairs: readonly string[],
):
	| {
			ok: true;
			bindings: readonly PrivateRunbookInputBinding[];
	  }
	| { ok: false; code: string; message: string } {
	const inputIds = new Set<string>();
	const bindings: PrivateRunbookInputBinding[] = [];
	for (const pair of pairs) {
		const equals = pair.indexOf("=");
		if (equals <= 0 || equals === pair.length - 1) {
			return {
				ok: false,
				code: "private_input_shape_invalid",
				message:
					"each --input-file must be <id>=<absolute-path>; private paths and values are withheld.",
			};
		}
		const inputId = pair.slice(0, equals);
		if (inputIds.has(inputId)) {
			return {
				ok: false,
				code: "private_input_shape_invalid",
				message: "a private input id may be supplied only once.",
			};
		}
		inputIds.add(inputId);
		bindings.push({
			inputId,
			filePath: pair.slice(equals + 1),
		});
	}
	return { ok: true, bindings };
}

/**
 * Read custody-approved private runbook input files.
 *
 * @param bindings - Shape-checked bindings approved against the runbook
 * @param inputRoot - Admitted owner-only private input root
 * @returns Structured inputs or a path/value-safe refusal
 * @internal
 */
async function readPrivateRunbookInputs(
	bindings: readonly PrivateRunbookInputBinding[],
	inputRoot: string,
): Promise<
	| { ok: true; inputs: BrowserUseRunbookInputs }
	| { ok: false; code: string; message: string }
> {
	const inputs: Record<string, unknown> = {};
	for (const binding of bindings) {
		const read = await readPrivateStructuredInput({
			inputId: binding.inputId,
			inputRoot,
			filePath: binding.filePath,
		});
		if (!read.ok) {
			return {
				ok: false,
				code: read.refusal.code,
				message: read.refusal.message,
			};
		}
		Object.assign(inputs, read.inputs);
	}
	return { ok: true, inputs };
}

async function runRunbookRun(
	input: BrowserUseRunbookCommandInput,
	ports: BrowserUseRunbookCommandPorts,
): Promise<number> {
	const flags = input.parsed.flagValues;
	const serviceId = stringField(flags["--service"]) ?? "";
	const flowId = stringField(flags["--flow"]) ?? "";

	const parsedInputs = parseRunbookInputs(
		input.parsed.repeatedFlagValues["--input"] ?? [],
	);
	if (!parsedInputs.ok) {
		return ports.output.emitTaskFailure(undefined, {
			code: "task_run_lane_refused",
			message: parsedInputs.message,
			actionId: "change_task_run_input",
			exitCode: USAGE_EXIT_CODE,
			recoverability: "change_input",
		});
	}
	const privateInputBindings = parsePrivateRunbookInputBindings(
		input.parsed.repeatedFlagValues["--input-file"] ?? [],
	);
	if (!privateInputBindings.ok) {
		return ports.output.emitTaskFailure(undefined, {
			code: privateInputBindings.code,
			message: privateInputBindings.message,
			actionId: "change_runbook_input",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		});
	}

	const readStore = await ports.store.open();
	if (!readStore.ok) return readStore.exitCode;
	let deps: RunStoreDeps = { ...readStore.deps, clock: ports.clock };
	const runFlag = stringField(flags["--run"]);
	const explicitTabId = stringField(flags["--tab"]);
	let run: BrowserUseSharedRun | undefined;
	let resumeFromStep = 0;
	if (runFlag !== undefined) {
		const loaded = await loadSharedRun(deps, runFlag);
		if (!loaded.ok) {
			return ports.output.emitPlatformFailure(
				ports.run.platformFailureOf(loaded.code, loaded.message),
			);
		}
		if (ports.run.isTerminalState(loaded.run.state)) {
			if (loaded.run.state === "confirmed") {
				return ports.output.emitSharedRunSuccess({
					run: loaded.run,
					continuationId: "inspect_task_run_result",
					dataExtra: {
						selected_lane: "agent-browser",
						lane_source: "intent-preferred",
						external_effect: "none",
						executed_steps: 0,
						resume: "confirmed-no-op",
					},
					plainExtra: [
						"selected_lane=agent-browser",
						"lane_source=intent-preferred",
						"external_effect=none",
						"executed_steps=0",
						"resume=confirmed-no-op",
					],
				});
			}
			return ports.output.emitTaskFailure(loaded.run.run_id, {
				code: "task_run_effect_unknown",
				message: `run ${loaded.run.run_id} holds terminal truth ${loaded.run.state}; terminal truth never re-enters execution.`,
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "none",
			});
		}
		if (loaded.run.runbook_target_binding === undefined) {
			return ports.output.emitTaskFailure(loaded.run.run_id, {
				code: "agent_browser_target_moved",
				message:
					"the existing run has no durable target binding and cannot be resumed safely; start a replacement run.",
				actionId: "restore_bound_runbook_target",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
				dataExtra: {
					lane_outcome: "agent_browser_target_moved",
					external_effect: "none",
				},
			});
		}
		run = loaded.run;
		resumeFromStep = runbookResumeCursorOf(loaded.run);
	}

	const active = await captureActiveGeneration(deps);
	if (active.status === "failure") {
		return ports.output.emitPlatformFailure(
			runbookCommandFailureOf(active.code, active.message),
		);
	}
	let generationRuntime: BrowserUseGenerationRuntime | undefined =
		active.status === "present" ? active.runtime : undefined;
	if (run !== undefined) {
		if (run.run_execution_binding !== undefined) {
			const retained = await readRetainedCorpusGenerationManifest(deps, {
				generationId: run.run_execution_binding.generation_id,
				activationEpoch: run.run_execution_binding.activation_epoch,
			});
			if (retained.status !== "present") {
				return ports.output.emitTaskFailure(run.run_id, {
					code:
						retained.status === "corrupt"
							? "resume_generation_drift"
							: "resume_generation_unavailable",
					message:
						retained.status === "corrupt"
							? retained.message
							: "the pinned retained generation is unavailable; current authority is not a fallback.",
					actionId: "inspect_task_run_result",
					exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
					recoverability: "repair_state",
				});
			}
			const openedRetained = await createBrowserUseGenerationRuntime(
				deps,
				{
					...retained.manifest,
					generation_content_hash:
						retained.identity.generation_content_hash,
					candidate_manifest_digest:
						retained.identity.candidate_manifest_digest,
					activation_epoch: retained.identity.activation_epoch,
				},
				{ verifyShippedCatalog: false },
			);
			if (!openedRetained.ok) {
				return ports.output.emitPlatformFailure(
					runbookCommandFailureOf(
						openedRetained.failure.code,
						openedRetained.failure.message,
					),
				);
			}
			generationRuntime = openedRetained.runtime;
		} else if (active.status === "present") {
			return ports.output.emitTaskFailure(run.run_id, {
				code: "resume_binding_invalid",
				message:
					"the run predates immutable generation binding and cannot resume after corpus activation.",
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			});
		}
	}

	const shown = await showRunbook(
		deps.fs,
		deps.paths.data.root,
		{ serviceId, flowId },
		generationRuntime?.activeGenerationSeam,
	);
	if (!shown.ok) {
		if (
			shown.failure.code === "runbook_not_found" ||
			shown.failure.code === "runbook_inactive" ||
			shown.failure.code === "runbook_id_invalid"
		) {
			return ports.output.emitTaskFailure(run?.run_id, {
				code: shown.failure.code,
				message: shown.failure.message,
				actionId: "change_task_run_input",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "change_input",
			});
		}
		return ports.output.emitPlatformFailure(
			runbookCommandFailureOf(
				shown.failure.code,
				shown.failure.message,
			),
		);
	}
	const custody = enforceRunbookInputCustody(shown.runbook, {
		publicInputIds: Object.keys(parsedInputs.inputs),
		privateInputIds: privateInputBindings.bindings.map(
			(binding) => binding.inputId,
		),
	});
	if (!custody.ok) {
		return ports.output.emitTaskFailure(run?.run_id, {
			code: custody.refusal.code,
			message: custody.refusal.message,
			actionId: "change_runbook_input",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		});
	}
	const privateInputs = await readPrivateRunbookInputs(
		privateInputBindings.bindings,
		join(deps.paths.resolution.roots.runtime, "private-inputs"),
	);
	if (!privateInputs.ok) {
		return ports.output.emitTaskFailure(run?.run_id, {
			code: privateInputs.code,
			message: privateInputs.message,
			actionId: "change_runbook_input",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		});
	}
	const runbookInputs: BrowserUseRunbookInputs = {
		...parsedInputs.inputs,
		...privateInputs.inputs,
	};

	const generationBinding = generationRuntime?.bindingIdentityFor({
		serviceId,
		flowId,
	});
	if (generationBinding !== undefined && "code" in generationBinding) {
		return ports.output.emitPlatformFailure(
			runbookCommandFailureOf(
				generationBinding.code,
				generationBinding.message,
			),
		);
	}
	const prepared = await prepareRunbookExecution(
		deps.fs,
		deps.paths.data.root,
		{
			serviceId,
			flowId,
			inputs: runbookInputs,
			resumeFromStep,
			...(generationRuntime === undefined
				? {}
				: {
						activeGenerationSeam:
							generationRuntime.activeGenerationSeam,
						actionSeam: generationRuntime.actionGenerationSeam,
						generationBinding,
					}),
		},
	);
	if (!prepared.ok) {
		if (
			prepared.refusal.code === "runbook_not_found" ||
			prepared.refusal.code === "runbook_inactive" ||
			prepared.refusal.code === "runbook_id_invalid" ||
			prepared.refusal.code === "runbook_input_missing" ||
			prepared.refusal.code === "runbook_input_rejected" ||
			prepared.refusal.code === "runbook_resume_out_of_range"
		) {
			return ports.output.emitTaskFailure(run?.run_id, {
				code: prepared.refusal.code,
				message: prepared.refusal.message,
				actionId: "change_task_run_input",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "change_input",
			});
		}
		return ports.output.emitPlatformFailure(
			runbookCommandFailureOf(
				prepared.refusal.code,
				prepared.refusal.message,
			),
		);
	}
	if (run?.run_execution_binding !== undefined) {
		const expected = run.run_execution_binding;
		const observed = prepared.execution_binding;
		if (
			observed === undefined ||
			observed.schema_version !== expected.schema_version ||
			observed.generation_id !== expected.generation_id ||
			observed.activation_epoch !== expected.activation_epoch ||
			observed.service_id !== expected.service_id ||
			observed.flow_id !== expected.flow_id ||
			observed.runbook_version !== expected.runbook_version ||
			observed.runbook_digest !== expected.runbook_digest ||
			observed.action_registry_digest !== expected.action_registry_digest ||
			observed.normalized_input_digest !==
				expected.normalized_input_digest ||
			observed.governed_input_artifact_ref !==
				expected.governed_input_artifact_ref ||
			observed.item_key_digest !== expected.item_key_digest ||
			observed.target_scope !== expected.target_scope ||
			observed.postcondition.id !== expected.postcondition.id ||
			observed.postcondition.summary !== expected.postcondition.summary
		) {
			return ports.output.emitTaskFailure(run.run_id, {
				code: "resume_binding_invalid",
				message:
					"the retained generation, flow, inputs, item keys, target scope, or postcondition do not match the run's immutable execution binding.",
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			});
		}
	}

	const acquired = await ports.handoff.acquire();
	if (!acquired.ok) return acquired.exitCode;
	const handoff = acquired.handoff;
	const rawHandoffData = acquired.rawHandoffData;
	if (handoff.adapter !== "agent-browser") {
		return ports.output.emitTaskFailure(run?.run_id, {
			code: "task_run_handoff_lane_mismatch",
			message: `runbook execution runs on the agent-browser lane; the verified handoff attached adapter ${handoff.adapter}.`,
			actionId: "supply_matching_handoff",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		});
	}
	if (run !== undefined) {
		const check = ports.handoff.checkSameLaneResume(
			run,
			"agent-browser",
			handoff,
		);
		if (check !== undefined) {
			return ports.output.emitTaskFailure(run.run_id, check);
		}
	}
	const plan = prepared.plan;
	if (
		run?.runbook_progress !== undefined &&
		(run.runbook_progress.service_id !== plan.service_id ||
			run.runbook_progress.flow_id !== plan.flow_id ||
			run.runbook_progress.runbook_version !== plan.version ||
			run.runbook_progress.total_steps !== plan.total_steps)
	) {
		return ports.output.emitTaskFailure(run.run_id, {
			code: "runbook_progress_identity_mismatch",
			message:
				"the resumed run is bound to a different runbook identity or version.",
			actionId: "inspect_task_run_result",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "repair_state",
		});
	}

	const writeStore = await ports.store.open("write");
	if (!writeStore.ok) return writeStore.exitCode;
	const writeDeps: RunStoreDeps = {
		...writeStore.deps,
		clock: ports.clock,
	};
	if (run?.run_execution_binding !== undefined) {
		const retained = await readRetainedCorpusGenerationManifest(writeDeps, {
			generationId: run.run_execution_binding.generation_id,
			activationEpoch: run.run_execution_binding.activation_epoch,
		});
		if (retained.status !== "present") {
			return ports.output.emitTaskFailure(run.run_id, {
				code:
					retained.status === "corrupt"
						? "resume_generation_drift"
						: "resume_generation_unavailable",
				message:
					retained.status === "corrupt"
						? retained.message
						: "the pinned retained generation became unavailable before write authority was acquired.",
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			});
		}
	} else {
		const observedActive = await captureActiveGeneration(writeDeps);
		if (observedActive.status === "failure") {
			return ports.output.emitPlatformFailure(
				runbookCommandFailureOf(
					observedActive.code,
					observedActive.message,
				),
			);
		}
		const activeChanged =
			observedActive.status !== active.status ||
			(observedActive.status === "present" &&
				active.status === "present" &&
				(observedActive.runtime.manifest.generation_id !==
					active.runtime.manifest.generation_id ||
					observedActive.runtime.manifest.activation_epoch !==
						active.runtime.manifest.activation_epoch ||
					observedActive.runtime.manifest.generation_content_hash !==
						active.runtime.manifest.generation_content_hash ||
					observedActive.runtime.manifest.candidate_manifest_digest !==
						active.runtime.manifest.candidate_manifest_digest));
		if (activeChanged) {
			return ports.output.emitTaskFailure(run?.run_id, {
				code: "migration_activation_conflict",
				message:
					"active generation authority changed before write access was acquired.",
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "retry",
			});
		}
	}
	deps = writeDeps;

	if (run !== undefined && plan.steps.length === 0) {
		return await ports.run.recordOutcome(
			deps,
			run,
			{
				lane_id: "agent-browser",
				source: "intent-preferred",
				intent: "runbook-execution",
			},
			{
				kind: "confirmed",
				executedSteps: 0,
				mutationDispatched: run.mutation_dispatched,
			},
			{ runbookNextStep: plan.total_steps },
		);
	}

	const targetEnvelopeId = targetEnvelopeIdOf({
		runId: run?.run_id ?? handoff.runId,
		mode: "handoff-bound",
		adapter: "agent-browser",
		handoffEvidenceId: handoff.handoffEvidenceId,
	});
	const storedBinding = run?.runbook_target_binding;
	if (run === undefined && generationRuntime !== undefined) {
		const tripped = await tripActiveGenerationEffectFence(deps, {
			generationId: generationRuntime.manifest.generation_id,
			activationEpoch: generationRuntime.manifest.activation_epoch,
			effectKind: "external-dispatch",
			effectRef: handoff.runId,
		});
		if (!tripped.ok) {
			return ports.output.emitMigrationFailure(tripped);
		}
	}
	const targetResolution = await resolveAgentBrowserTaskTarget(
		{ runCommand: ports.runtime.runCommand },
		{
			handoff: rawHandoffData as AgentBrowserVerifiedHandoff,
			run_id: run?.run_id ?? handoff.runId,
			allowed_origins: plan.allowed_origins,
			steps: plan.steps,
			target:
				explicitTabId !== undefined
					? {
							kind: "exact",
							tab_id: explicitTabId,
							target_envelope_id: targetEnvelopeId,
						}
					: {
							kind: "auto",
							target_envelope_id: targetEnvelopeId,
							...(storedBinding !== undefined
								? {
										bound_target_candidate_id:
											storedBinding.binding_id,
									}
								: {}),
						},
		},
	);
	if (!targetResolution.ok) {
		if (run === undefined) {
			const actionId =
				explicitTabId !== undefined
					? "change_task_run_input"
					: targetResolution.code === "agent_browser_connection_unstable"
						? "refresh_runbook_handoff"
						: "prepare_unique_runbook_target";
			return ports.output.emitTaskFailure(undefined, {
				code: targetResolution.code,
				message: targetResolution.message,
				actionId,
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability:
					actionId === "refresh_runbook_handoff"
						? "repair_state"
						: "change_input",
				dataExtra: { external_effect: "none" },
			});
		}
		return await ports.run.recordOutcome(
			deps,
			run,
			{
				lane_id: "agent-browser",
				source: "intent-preferred",
				intent: "runbook-execution",
			},
			runbookTargetRepairMapping(targetResolution),
			{ runbookNextStep: resumeFromStep },
		);
	}
	if (
		run !== undefined &&
		storedBinding !== undefined &&
		storedBinding.binding_id !== targetResolution.binding.target_candidate_id
	) {
		const mismatchSubject =
			explicitTabId === undefined
				? "the automatically resolved target"
				: "the explicit --tab target";
		const moved: Extract<AgentBrowserTargetResolutionResult, { ok: false }> = {
			ok: false,
			code: "agent_browser_target_moved",
			outcome: "not-achieved",
			message: `${mismatchSubject} does not match the target bound to this run.`,
			executed_steps: 0,
			mutation_dispatched: false,
		};
		return await ports.run.recordOutcome(
			deps,
			run,
			{
				lane_id: "agent-browser",
				source: "intent-preferred",
				intent: "runbook-execution",
			},
			runbookTargetRepairMapping(moved),
			{ runbookNextStep: resumeFromStep },
		);
	}

	const progress = {
		schema_version: "1" as const,
		service_id: plan.service_id,
		flow_id: plan.flow_id,
		runbook_version: plan.version,
		next_step: resumeFromStep,
		total_steps: plan.total_steps,
	};
	const planMayMutate = plan.steps.some(
		(step) =>
			step.kind === "click-semantic" ||
			step.kind === "fill" ||
			(step.kind === "evaluate" && step.effect === "mutation"),
	);
	const durableTargetBinding = {
		schema_version: "1",
		mode: explicitTabId === undefined ? "automatic" : "exact",
		binding_id: targetResolution.binding.target_candidate_id,
	} as const;
	if (run === undefined) {
		const createInput = {
			run_id: handoff.runId,
			state: "running",
			task_intent: "runbook-execution",
			environment_profile: {
				environment: handoff.environmentName,
				profile: handoff.environmentProfile,
			},
			adapter_id: "agent-browser",
			handoff_evidence_id: handoff.handoffEvidenceId,
			runbook_target_binding: durableTargetBinding,
			runbook_progress: progress,
			...(prepared.execution_binding === undefined
				? {}
				: {
						run_execution_binding:
							prepared.execution_binding,
						...(planMayMutate
							? {
									postcondition:
										prepared.execution_binding
											.postcondition,
								}
							: {}),
					}),
			mutation_dispatched: false,
			artifacts: [],
		} as const;
		const created =
			generationRuntime === undefined
				? await createSharedRun(deps, createInput)
				: await withActivationEpochBarrier(
						deps,
						{
							holderId: `generation-run-create-${handoff.runId}`,
						},
						async () => {
							const observed =
								await readActiveCorpusManifest(deps);
							if (
								observed.status !== "present" ||
								observed.manifest.generation_id !==
									generationRuntime.manifest.generation_id ||
								observed.manifest.activation_epoch !==
									generationRuntime.manifest.activation_epoch
							) {
								return {
									ok: false as const,
									code: "migration_activation_conflict" as const,
									message:
										"active generation changed before the run record could bind.",
								};
							}
							return await createSharedRun(deps, createInput);
						},
					);
		if (!created.ok) {
			if (
				created.code === "migration_activation_conflict" ||
				created.code === "epoch_store_failed"
			) {
				return ports.output.emitTaskFailure(undefined, {
					code: created.code,
					message: created.message,
					actionId: "inspect_task_run_result",
					exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
					recoverability:
						created.code === "migration_activation_conflict"
							? "retry"
							: "repair_state",
				});
			}
			return ports.output.emitPlatformFailure(
				ports.run.platformFailureOf(created.code, created.message),
			);
		}
		run = created.run;
	} else if (run.runbook_progress === undefined) {
		const upgraded = await persistRunbookPrivateState(
			ports,
			deps,
			run,
			(current) => ({
				...current,
				...(current.runbook_progress === undefined
					? { runbook_progress: progress }
					: {}),
			}),
		);
		if (!upgraded.ok) {
			return ports.output.emitPlatformFailure(upgraded.failure);
		}
		run = upgraded.run;
	}

	const dispatchLease = await acquireLease(deps, {
		key: leaseKeyForRun(run),
		holderId: `runbook-dispatch-${run.run_id}`,
		ttlMs: RUNBOOK_DISPATCH_LEASE_TTL_MS,
	});
	if (!dispatchLease.ok) {
		return ports.output.emitPlatformFailure(
			ports.run.platformFailureOf(
				dispatchLease.code,
				dispatchLease.code === "lease_held"
					? dispatchLease.continuation.summary
					: dispatchLease.message,
			),
		);
	}
	const dispatchClaim: LeaseWriteClaim = {
		fencing_token: dispatchLease.lease.fencing_token,
		activation_epoch: dispatchLease.lease.activation_epoch,
		holderId: dispatchLease.lease.holder_id,
	};
	const dispatchHeartbeat = startRunbookDispatchLeaseHeartbeat(
		deps,
		dispatchLease.lease,
		ports.run.platformFailureOf,
	);
	try {
		const guardResult = beginSensitiveRunGuard(run.run_id);
		const guard = guardResult.ok ? guardResult.guard : undefined;
		const tokenRetrieval = ports.runtime.authTokenRetrieval;
		const authProvider =
			tokenRetrieval !== undefined
				? createBrowserUseAuthProvider({
						store: deps,
						tokenRetrieval,
						attestationByDigest: attestationByDigestFrom(deps),
					})
				: undefined;

		let dispatchRun = run;
		let mutationMarkerFailure:
			| BrowserUseRunbookCommandFailure
			| undefined;
		const outcome: BrowserUseRunbookExecutionResult =
			await executePreparedRunbook(
				{
					runtime: {
						runCommand: ports.runtime.runCommand,
						beforeMutationDispatch: async ({ run_id }) => {
							if (run_id !== dispatchRun.run_id) {
								return { ok: false };
							}
							const marked =
								await ports.run.persistMutationDispatch(
									deps,
									dispatchRun,
									dispatchClaim,
								);
							if (!marked.ok) {
								mutationMarkerFailure = marked.failure;
								return { ok: false };
							}
							dispatchRun = marked.run;
							return { ok: true };
						},
					},
					...(authProvider !== undefined
						? {
								authDelivery:
									buildRunbookAuthDelivery(authProvider),
							}
						: {}),
					afterNeutralOpen: async (nextStep) => {
						const checkpointed =
							await persistRunbookPrivateState(
								ports,
								deps,
								dispatchRun,
								(current) => ({
									...current,
									runbook_progress:
										current.runbook_progress === undefined
											? progress
											: {
													...current.runbook_progress,
													next_step: nextStep,
												},
								}),
								dispatchClaim,
							);
						if (!checkpointed.ok) return false;
						dispatchRun = checkpointed.run;
						return true;
					},
				},
				{
					plan,
					handoff:
						rawHandoffData as AgentBrowserVerifiedHandoff,
					runId: run.run_id,
					targetTabId: targetResolution.target_tab_id,
					expectedTargetUrl: targetResolution.target_url,
				},
			);
		if (mutationMarkerFailure !== undefined) {
			return ports.output.emitPlatformFailure(
				mutationMarkerFailure,
			);
		}
		if (!outcome.ok) {
			return ports.output.emitPlatformFailure(
				runbookCommandFailureOf(
					outcome.refusal.code,
					outcome.refusal.message,
				),
			);
		}
		const heartbeatFailure = dispatchHeartbeat.failure();
		if (heartbeatFailure !== undefined) {
			return ports.output.emitPlatformFailure(heartbeatFailure);
		}

		const dispatchGuard =
			ports.run.markGuardForDeliveryOutcome(
				guard,
				outcome.result,
			);
		if (!dispatchGuard.ok) {
			return ports.output.emitTaskFailure(
				run.run_id,
				ports.run.sentinelRegistrationWithheldFailure(
					dispatchGuard.reason,
				),
			);
		}
		const mapping = mapRunbookAgentBrowserOutcome(
			outcome.result,
			ports,
		);
		const nextStep = nextRunbookStepAfterExecution(
			outcome.plan,
			outcome.result.executed_steps,
		);
		return await ports.run.recordOutcome(
			deps,
			dispatchRun,
			{
				lane_id: "agent-browser",
				source: "intent-preferred",
				intent: "runbook-execution",
			},
			mapping,
			{
				...(dispatchGuard.guard !== undefined
					? { guard: dispatchGuard.guard }
					: {}),
				runbookNextStep: nextStep,
				heldClaim: dispatchClaim,
				structuredResults: outcome.structured_results ?? [],
			},
		);
	} finally {
		const currentDispatchLease = await dispatchHeartbeat.stop();
		await releaseLease(deps, currentDispatchLease);
	}
}

function sanitizeInputPairForError(pair: string): string {
	const equals = pair.indexOf("=");
	return equals > 0
		? `${pair.slice(0, equals)}=[redacted]`
		: "[redacted]";
}

/**
 * Execute one live runbook family command through the extracted owner.
 *
 * The browser-use driver supplies generic store, handoff, output, clock, run,
 * and runtime ports in one plain object. This module owns family ordering.
 *
 * @param input - Resolved runbook command facts
 * @param ports - Existing driver and runtime seams
 * @returns Process exit code
 * @internal
 *
 * @example
 * ```typescript
 * await runBrowserUseRunbookCommand(input, ports)
 * ```
 */
export async function runBrowserUseRunbookCommand(
	input: BrowserUseRunbookCommandInput,
	ports: BrowserUseRunbookCommandPorts,
): Promise<number> {
	if (input.parsed.command === "runbook-list") {
		return runRunbookList(ports);
	}
	if (input.parsed.command === "runbook-show") {
		return runRunbookShow(input, ports);
	}
	return runRunbookRun(input, ports);
}
