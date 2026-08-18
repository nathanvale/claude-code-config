#!/usr/bin/env bun

import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, openSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

import {
	type CliWriter,
	type RuntimeActionGuidance,
	type RuntimeContinuationGuidance,
	CliUsageError,
	createCliRepairStateRuntimeError,
	createCliRetryRuntimeError,
	createCliRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	createCliUsageRuntimeError,
	createCommandResultData,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	renderCommandUsage,
	usageError,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	VAULT_GIT_COMMANDS,
	createVaultGitActionRef as action,
	parseVaultGitInvocation,
	projectVaultGitCommandDiscoveryTree,
	type ParsedVaultGitInvocation,
	type VaultGitCommand,
	vaultGitActions,
	vaultGitContracts,
} from "./command-contract.ts";
import { createNodeVaultGitRuntime, readInheritedCapability } from "./clock.ts";
import type {
	VaultGitEngineResult,
	VaultGitTransactionEngine,
} from "./engine.ts";
import { createVaultGitTransactionEngine } from "./engine.ts";
import {
	createVaultGitJanitor,
	type VaultGitJanitor,
	type VaultGitJanitorReport,
} from "./janitor.ts";
import {
	createGitAdapter,
	createGitRepositoryAdapter,
	createNodeProcessPort,
} from "./git-adapter.ts";
import { createVaultOwnedCheckPort } from "./validation-candidate.ts";
import { resolveVaultGitInstalledRuntimeRunner } from "./installed-runtime-runner.ts";
import {
	VAULT_GIT_REPAIR_ACTIONS,
	VAULT_GIT_ACTIVATION_CONFIGURATION_FIELDS,
	admitVaultGitCheckCommand,
	createVaultGitActivationRestriction,
	findVaultGitDependencySurface,
	parseVaultGitManifest,
	type VaultGitLifecycleResultPayload,
	type VaultGitActivationConfigurationField,
	type VaultGitNextActionId,
	type VaultGitRepairAction,
	type VaultGitTransactionPhase,
} from "./model.ts";
import {
	// The U1 owner composer is the public lifecycle-result construction path: it
	// projects the authoritative Next Safe Action union from the payload's action
	// ref, derives compat id/summary + facade affordances, and rejects divergence.
	composeVaultGitLifecycleResult as createVaultGitLifecycleResult,
	type VaultGitNextActionRef,
} from "./next-safe-action.ts";
import { resolveVaultRepositoryIdentity } from "./repository-identity.ts";
import {
	createVaultGitActivationAuthority,
	type VaultGitActivationAuthority,
} from "./activation-authority.ts";
import {
	createVaultGitActivationFrontDoor,
	type VaultGitActivationFrontDoor,
	type VaultGitActivationFrontDoorResult,
} from "./activation-front-door.ts";
import {
	resolveVaultGitActivationIdentities,
	resolveVaultGitSshTransportEnvironment,
} from "./activation-identity.ts";
import { createVaultGitActivationPreparer } from "./activation-preparation.ts";
import {
	EVIDENCE_ID,
	parseVaultGitPreparedEvidence,
} from "./activation-contract.ts";
import { renderVaultGitActivationResult } from "./activation-result.ts";
import {
	projectVaultGitActivationRestrictionJson,
	renderVaultGitActivationRestriction,
} from "./activation-restriction.ts";
import {
	VaultRepositoryIdentityUnavailableError,
	type VaultGitCheckerPort,
	type VaultGitProcessPort,
	type VaultGitRuntimePort,
} from "./ports.ts";
import type { VaultGitDoctorResult } from "./doctor.ts";
import {
	createVaultGitDoctorEvidenceSource,
	createVaultGitDoctorFrontDoor,
	type VaultGitDoctorFrontDoor,
	type VaultGitDoctorFrontDoorProjection,
} from "./doctor-front-door.ts";
import {
	createVaultGitDoctorTaskStore,
	type VaultGitDoctorTaskStore,
} from "./doctor-task-store.ts";
import type { VaultGitRepairResult } from "./repair.ts";
import {
	createVaultGitTaskStore,
	type VaultGitTaskStore,
} from "./task-store.ts";
import {
	createVaultGitTaskLifecycle,
	VAULT_GIT_LAUNCH_ACK_WINDOW_MS,
	VAULT_GIT_TASK_HEARTBEAT_STALE_MS,
	reconcileClosedVaultGitTask,
	reconcileStaleVaultGitTaskFromDoctor,
	type VaultGitBackgroundCompletionRuntime as VaultGitTaskLifecycleRuntime,
} from "./task-lifecycle.ts";
import { parseVaultGitTaskWorkerAcknowledgement } from "./task-state.ts";
import {
	createVaultGitTaskWorker,
	type VaultGitTaskWorker,
	type VaultGitTaskWorkerOptions,
} from "./task-worker.ts";
import {
	createReceiptStore,
	launchCapabilityProcess,
	launchDoctorTokenProcess,
	type VaultGitCapabilityLaunchResult,
	type VaultGitCapabilityRole,
	type VaultGitReceiptStore,
} from "./store.ts";
import { evaluateVaultGitWorkerPolicy } from "./worker-policy.ts";

const CLI_PATH = fileURLToPath(import.meta.url);
const VAULT_GIT_DOCTOR_TASK_ID_ENV = "VAULT_GIT_DOCTOR_TASK_ID";
const VAULT_GIT_DOCTOR_TASK_LAUNCH_GENERATION_ENV =
	"VAULT_GIT_DOCTOR_TASK_LAUNCH_GENERATION";
// Production owns this exact closure. Runtime import-graph discovery would make
// admission depend on parser and loader behavior instead of one reviewable list.
const PRODUCTION_EXECUTABLE_SOURCE_NAMES = [
	"activation-authority.ts",
	"activation-contract.ts",
	"activation-front-door.ts",
	"activation-identity.ts",
	"activation-preparation.ts",
	"activation-restriction.ts",
	"activation-result.ts",
	"branch-station-catalog.ts",
	"cli.ts",
	"clock.ts",
	"command-contract.ts",
	"commit-policy.ts",
	"doctor.ts",
	"doctor-front-door.ts",
	"doctor-task-lifecycle.ts",
	"doctor-task-state.ts",
	"doctor-task-store.ts",
	"doctor-worker.ts",
	"engine.ts",
	"git-adapter.ts",
	"installed-runtime-runner.ts",
	"janitor.ts",
	"model.ts",
	"next-safe-action.ts",
	"ports.ts",
	"remote-ledger.ts",
	"remote-safety.ts",
	"repair.ts",
	"repository-identity.ts",
	"store.ts",
	"task-repair.ts",
	"task-state.ts",
	"task-lifecycle.ts",
	"task-store.ts",
	"task-worker.ts",
	"validation-candidate.ts",
	"worker-policy.ts",
] as const;
const CLI_FACADE_EXECUTABLE_SOURCE_NAMES = [
	"baseline-exit-drift.ts",
	"cli-diagnostics.ts",
	"cli-writer.ts",
	"command-contract.ts",
	"command-discovery.ts",
	"command-facade.ts",
	"command-metadata.ts",
	"index.ts",
	"runtime-envelope.ts",
	"runtime-text-safety.ts",
	"station-map.ts",
	"usage.ts",
] as const;
const VAULT_GIT_PACKAGE_ROOT = dirname(dirname(CLI_PATH));
const CLI_FACADE_PACKAGE_ROOT = resolve(
	VAULT_GIT_PACKAGE_ROOT,
	"../cli-command-facade",
);
const REPOSITORY_ROOT = resolve(VAULT_GIT_PACKAGE_ROOT, "../..");

/**
 * Exact source-linked production closure supplied to live activation identity.
 * @internal
 */
export const VAULT_GIT_PRODUCTION_EXECUTABLE_SOURCE_PATHS = Object.freeze([
	...PRODUCTION_EXECUTABLE_SOURCE_NAMES.map((name) =>
		join(VAULT_GIT_PACKAGE_ROOT, "src", name),
	),
	join(VAULT_GIT_PACKAGE_ROOT, "package.json"),
	...CLI_FACADE_EXECUTABLE_SOURCE_NAMES.map((name) =>
		join(CLI_FACADE_PACKAGE_ROOT, "src", name),
	),
	join(CLI_FACADE_PACKAGE_ROOT, "package.json"),
	join(REPOSITORY_ROOT, "bun.lock"),
].sort());

/**
 * Compose the internal acknowledged task worker from production CLI owners.
 *
 * @param options - Existing engine, durable acknowledgement, and FD custody
 * @returns Bounded worker that delegates canonical mutation to the engine
 * @internal
 */
export function createVaultGitCliTaskWorker(
	options: VaultGitTaskWorkerOptions,
): VaultGitTaskWorker {
	return createVaultGitTaskWorker(options);
}
const DEFAULT_REMOTE = "origin";
const DEFAULT_LEGACY_STATE_IDENTITY = "configured-super-vault";
const DEFAULT_LEASE_DURATION_MS = 15 * 60_000;
const DEFAULT_TIMEOUTS = {
	fetchMs: 15_000,
	pushMs: 30_000,
	localMs: 15_000,
} as const;
// Stale takeover performs repeated Doctor proof, ledger validation, one push,
// and outcome reconciliation inside the private child. Its process budget must
// span the whole ceremony rather than reuse one Git push deadline.
const STALE_TAKEOVER_PRIVATE_LAUNCH_TIMEOUT_MS = 120_000;
const RESOLVED_DEPENDENCY_MANIFEST_FIELDS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
] as const;
const DEPENDENCY_FREE_LOCKFILE_ABSENCE_BINDING = Buffer.from(
	"vault-git:dependency-free-lockfile-absence:v1",
	"utf8",
);

/** Complete live CLI composition over the U2-U5 owners. */
export interface VaultGitCliComposition {
	readonly engine: VaultGitTransactionEngine;
	readonly janitor: VaultGitJanitor;
	readonly store: VaultGitReceiptStore;
	/** Private background-task owner; production composition always provides it. */
	readonly taskStore?: VaultGitTaskStore;
	/** Private Background Doctor task owner; production composition always provides it. */
	readonly doctorTaskStore?: VaultGitDoctorTaskStore;
	readonly runtime: VaultGitRuntimePort;
	readonly repositoryPath: string;
	readonly remote: string;
	readonly leaseDurationMs: number;
	readonly privateEntrypointPath?: string;
	/** Exact write-gate validator used before background task admission. */
	readonly activationAuthority?: Pick<VaultGitActivationAuthority, "validate">;
	/** Guarded activation operations; absent when host activation configuration is incomplete. */
	readonly activationFrontDoor?: VaultGitActivationFrontDoor;
	/** Stable public field names missing from activation configuration. */
	readonly activationConfigurationMissing?: readonly VaultGitActivationConfigurationField[];
}

/** Explicit production composition input. */
export interface VaultGitCliCompositionInput {
	readonly repositoryPath: string;
	readonly checkRepositoryPath: string;
	readonly stateRoot: string;
	/** Optional explicit identity seam for isolated tests and embedded callers. */
	readonly repositoryIdentity?: string;
	/** Pre-canonical private-state namespace retained across composition upgrades. */
	readonly privateStateNamespaceIdentity?: string;
	readonly actor: string;
	readonly host: string;
	readonly remote?: string;
	/** Exact network hosts admitted by both preparation and write-side Git. */
	readonly allowedRemoteHosts?: readonly string[];
	readonly leaseDurationMs?: number;
	readonly process?: VaultGitProcessPort;
	readonly runtime?: VaultGitRuntimePort;
	/** Explicit live authority; absence keeps production activation blocked. */
	readonly activationAuthority?: Pick<VaultGitActivationAuthority, "validate">;
	/** Complete owner-controlled configuration for live activation revalidation. */
	readonly activationIdentity?: VaultGitCliActivationIdentityInput;
	/** Stable public field names absent from default host activation configuration. */
	readonly activationConfigurationMissing?: readonly VaultGitActivationConfigurationField[];
	/** Exact entrypoint inherited-descriptor children re-enter through. */
	readonly privateEntrypointPath?: string;
}

/** Non-secret paths and host binding required for live activation trust. */
export interface VaultGitCliActivationIdentityInput {
	readonly hostId: string;
	readonly runtimeBinaryPath: string;
	readonly runtimeVersion: string;
	readonly executablePath: string;
	/** Explicit deterministic production source closure. */
	readonly executableSourcePaths: readonly string[];
	readonly gitBinaryPath: string;
	readonly sshBinaryPath: string;
	readonly sshIdentityFilePath: string;
	readonly sshIdentityPublicKeyPath: string;
	readonly sshKnownHostsPath: string;
}

/** Optional CLI dependencies used by tests and embedded callers. */
export interface VaultGitCliOptions {
	/** Primary output writer. */
	readonly stdout?: CliWriter;
	/** Diagnostic output writer. */
	readonly stderr?: CliWriter;
	/** Clock seam for deterministic envelope durations. */
	readonly now?: () => number;
	/** Precomposed live runtime. */
	readonly composition?: VaultGitCliComposition;
	/** Lazy configured-vault composition seam. */
	readonly resolveComposition?: (
		command: Exclude<VaultGitCommand, "commands">,
	) => Promise<VaultGitCliComposition | null>;
	/** Capability FD reader seam. */
	readonly readCapability?: (descriptor: number) => Promise<Uint8Array>;
	/** Disable the public-to-internal FD launcher in in-process tests. */
	readonly launchPrivate?: boolean;
	/** Human-only review interaction; tests inject explicit decisions. */
	readonly humanActivationReview?: VaultGitHumanActivationReviewPort;
	/** Background completion process and monotonic-time seams for focused tests. */
	readonly backgroundCompletionRuntime?: VaultGitBackgroundCompletionRuntime;
	/** Environment for role dispatch; tests inject worker env without mutating process.env. */
	readonly env?: NodeJS.ProcessEnv;
}

/** Process and monotonic-time operations used by foreground task acknowledgement. */
export type VaultGitBackgroundCompletionRuntime =
	VaultGitTaskLifecycleRuntime<VaultGitCliComposition>;

/** Human-review action selected by the guarded activation journey. */
export type VaultGitHumanActivationReviewAction = "review" | "defer" | "revoke";

/** Human decision returned only from an interactive review surface. */
export type VaultGitHumanActivationDecision =
	| "activate"
	| "defer"
	| "revoke"
	| "cancel";

/** Interactive human-review boundary. Agent and non-TTY callers receive no decision. */
export interface VaultGitHumanActivationReviewPort {
	/** Whether this invocation has a human-owned interactive surface. */
	isInteractive(): boolean;
	/** Ask for one explicit decision after showing only the sanitized result. */
	decide(input: {
		readonly action: VaultGitHumanActivationReviewAction;
		readonly evidenceReference: string;
		readonly result: VaultGitActivationFrontDoorResult;
	}): Promise<VaultGitHumanActivationDecision>;
}

/** Invocation shape after the discovery early return removed `commands`. */
type VaultGitRuntimeInvocation = ParsedVaultGitInvocation & {
	readonly command: Exclude<VaultGitCommand, "commands">;
};

type VaultGitTaskLifecycleDispatch =
	| { readonly role: "launcher" }
	| {
			readonly role: "worker";
			readonly taskId: string;
			readonly launchGeneration: string;
	  };

function isRuntimeInvocation(
	invocation: ParsedVaultGitInvocation,
): invocation is VaultGitRuntimeInvocation {
	return invocation.command !== "commands";
}

function resolveVaultGitTaskLifecycleDispatch(
	environment: NodeJS.ProcessEnv,
): VaultGitTaskLifecycleDispatch {
	const taskId = environment.VAULT_GIT_TASK_ID;
	const launchGeneration = environment.VAULT_GIT_TASK_LAUNCH_GENERATION;
	if (!taskId || !launchGeneration) return { role: "launcher" };
	return { role: "worker", taskId, launchGeneration };
}

/** Captured in-process CLI result. */
export interface VaultGitCliRun {
	/** Process exit code. */
	readonly exitCode: number;
	/** Captured stdout. */
	readonly stdout: string;
	/** Captured stderr. */
	readonly stderr: string;
}

/**
 * Compose repository, checker, ledger, receipt, clock, and engine owners.
 *
 * @param input - Explicit configured-vault identity and process seams
 * @returns Same-root production composition
 * @throws {Error} When repository and check roots resolve differently
 *
 * @example
 * ```typescript
 * const composition = await createVaultGitCliComposition({
 *   repositoryPath: vaultRoot,
 *   checkRepositoryPath: vaultRoot,
 *   stateRoot,
 *   repositoryIdentity: "configured-vault",
 *   actor: "operator",
 *   host: "laptop",
 * })
 * ```
 */
export async function createVaultGitCliComposition(
	input: VaultGitCliCompositionInput,
): Promise<VaultGitCliComposition> {
	return createVaultGitCliCompositionFromSelection(input);
}

type VaultGitPrivateStateSelection = {
	readonly repositoryId: string;
	readonly repositoryIdentity?: string;
	readonly store?: VaultGitReceiptStore;
};

class VaultGitPrivateStateConflictError extends Error {
	constructor() {
		super("canonical and legacy private-state namespaces are both populated");
		this.name = "VaultGitPrivateStateConflictError";
	}
}

async function createVaultGitCliCompositionFromSelection(
	input: VaultGitCliCompositionInput,
	selection?: VaultGitPrivateStateSelection,
): Promise<VaultGitCliComposition> {
	const [repositoryPath, checkRepositoryPath] = await Promise.all([
		realpath(input.repositoryPath),
		realpath(input.checkRepositoryPath),
	]);
	if (repositoryPath !== checkRepositoryPath) {
		throw new Error(
			"vault repository and vault-owned check must resolve to the same root",
		);
	}
	const processPort = input.process ?? createNodeProcessPort();
	const gitBinary = input.activationIdentity?.gitBinaryPath;
	const admittedGitEnvironment = input.activationIdentity
		? await resolveVaultGitSshTransportEnvironment(input.activationIdentity)
		: undefined;
	const resolveRepositoryIdentity = () =>
		resolveVaultRepositoryIdentity({
			repositoryPath,
			process: processPort,
			timeoutMs: DEFAULT_TIMEOUTS.localMs,
			...(gitBinary ? { gitBinary } : {}),
		});
	let repositoryIdentity = input.repositoryIdentity ?? selection?.repositoryIdentity;
	if (repositoryIdentity === undefined) {
		try {
			repositoryIdentity = (await resolveRepositoryIdentity()).identity;
		} catch (error) {
			if (
				!selection?.store ||
				!(error instanceof VaultRepositoryIdentityUnavailableError)
			) {
				throw error;
			}
			repositoryIdentity = `vault-git-recovery:v1:${selection.store.repositoryId}`;
		}
	}
	const runtime =
		input.runtime ??
		createNodeVaultGitRuntime({ actor: input.actor, host: input.host });
	const timeouts = { ...DEFAULT_TIMEOUTS };
	const repository = createGitRepositoryAdapter({
		repositoryPath,
		repositoryIdentity,
		...(input.repositoryIdentity === undefined
			? {
					resolveRepositoryIdentity,
				}
			: {}),
		process: processPort,
		timeouts,
		...(gitBinary ? { gitBinary } : {}),
		...(admittedGitEnvironment ? { admittedGitEnvironment } : {}),
	});
	const git = createGitAdapter({
		repositoryPath,
		process: processPort,
		timeouts,
		...(input.allowedRemoteHosts
			? { allowedRemoteHosts: input.allowedRemoteHosts }
			: {}),
		...(gitBinary ? { gitBinary } : {}),
		...(admittedGitEnvironment ? { admittedGitEnvironment } : {}),
	});
	const selectedStore =
		selection?.store ??
		createReceiptStore({ stateRoot: input.stateRoot, repositoryIdentity });
	if (selection && selectedStore.repositoryId !== selection.repositoryId) {
		throw new VaultGitPrivateStateConflictError();
	}
	const store =
		selection === undefined
			? await selectPrivateStateStore(
			createReceiptStore({
				stateRoot: input.stateRoot,
				repositoryIdentity,
			}),
			createReceiptStore({
				stateRoot: input.stateRoot,
				repositoryIdentity:
					input.privateStateNamespaceIdentity ?? DEFAULT_LEGACY_STATE_IDENTITY,
			}),
			)
			: selectedStore;
	// The vault check runs only under the single admitted runtime binding in
	// activationIdentity; absence fails closed inside the candidate module
	// instead of falling back to the executing image or ambient PATH.
	const check = createVaultOwnedCheckPort({
		repositoryPath: checkRepositoryPath,
		privateStateRoot: store.paths.repositoryRoot,
		process: processPort,
		runtimeBinaryPath: input.activationIdentity?.runtimeBinaryPath ?? null,
		...(gitBinary ? { gitBinary } : {}),
	});
	const taskStore = createVaultGitTaskStore({
		stateRoot: input.stateRoot,
		repositoryId: store.repositoryId,
	});
	const doctorTaskStore = createVaultGitDoctorTaskStore({
		stateRoot: input.stateRoot,
		repositoryId: store.repositoryId,
	});
	const checker = createVaultCheckerPort(
		repositoryPath,
		processPort,
		input.activationIdentity?.runtimeBinaryPath ?? process.execPath,
	);
	const activationRuntime = input.activationAuthority
		? { validation: input.activationAuthority }
		: createConfiguredActivationRuntime({
			input,
			repositoryPath,
			repositoryIdentity,
			processPort,
			store,
			runtime,
			admittedGitEnvironment,
			resolveRepositoryIdentity: async () =>
				(await resolveRepositoryIdentity()).identity,
		});
	const engine = createVaultGitTransactionEngine({
		store,
		repository,
		ledger: { git, clock: runtime },
		runtime,
		repositoryIdentity,
		check,
		activationAuthority: activationRuntime.validation,
	});
	const janitor = createVaultGitJanitor({
		engine,
		checker,
		remote: input.remote ?? DEFAULT_REMOTE,
		leaseDurationMs: input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
	});
	return {
		engine,
		janitor,
		store,
		taskStore,
		doctorTaskStore,
		runtime,
		repositoryPath,
		remote: input.remote ?? DEFAULT_REMOTE,
		leaseDurationMs: input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
		privateEntrypointPath: input.privateEntrypointPath ?? CLI_PATH,
		activationAuthority: activationRuntime.validation,
		...(activationRuntime.frontDoor
			? { activationFrontDoor: activationRuntime.frontDoor }
			: {}),
		...(input.activationConfigurationMissing
			? {
					activationConfigurationMissing:
						input.activationConfigurationMissing,
				}
			: {}),
	};
}

/**
 * Compose the read-only recovery surface from discoverable private state.
 *
 * @param input - Configured vault and private-state roots
 * @returns Recovery composition retaining any discoverable receipt context
 * @throws {Error} When private state cannot be selected safely
 *
 * @example
 * ```typescript
 * const composition = await createVaultGitCliRecoveryComposition(input)
 * const report = await composition.engine.doctor()
 * ```
 */
export async function createVaultGitCliRecoveryComposition(
	input: VaultGitCliCompositionInput,
): Promise<VaultGitCliComposition> {
	if (input.repositoryIdentity !== undefined) {
		return createVaultGitCliComposition(input);
	}
	const selection = await discoverPrivateState(
		input.stateRoot,
		input.privateStateNamespaceIdentity ?? DEFAULT_LEGACY_STATE_IDENTITY,
	);
	return createVaultGitCliCompositionFromSelection(input, selection ?? undefined);
}

async function discoverPrivateState(
	stateRoot: string,
	legacyNamespaceIdentity: string,
): Promise<VaultGitPrivateStateSelection | null> {
	const managerRoot = join(stateRoot, "vault-git-transaction-manager");
	const entries = await readdir(managerRoot, { withFileTypes: true }).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return [];
			throw error;
		},
	);
	const populated = [];
	for (const entry of entries) {
		if (!/^[0-9a-f]{64}$/.test(entry.name) || !entry.isDirectory()) continue;
		const repositoryRoot = join(managerRoot, entry.name);
		if ((await readdir(repositoryRoot)).length > 0) {
			populated.push({ repositoryId: entry.name, repositoryRoot });
		}
	}
	if (populated.length > 1) throw new VaultGitPrivateStateConflictError();
	if (populated.length === 0) return null;
	const [candidate] = populated;
	if (!candidate) return null;
	const legacyStore = createReceiptStore({
		stateRoot,
		repositoryIdentity: legacyNamespaceIdentity,
	});
	if (legacyStore.repositoryId === candidate.repositoryId) {
		return { repositoryId: candidate.repositoryId, store: legacyStore };
	}
	const evidencePath = join(candidate.repositoryRoot, "prepared-evidence.json");
	const metadata = await lstat(evidencePath).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return null;
			throw error;
		},
	);
	if (
		!metadata?.isFile() ||
		metadata.isSymbolicLink() ||
		(metadata.mode & 0o777) !== 0o600
	) {
		return { repositoryId: candidate.repositoryId };
	}
	const evidence = await readFile(evidencePath, "utf8")
		.then((source) => parseVaultGitPreparedEvidence(JSON.parse(source)))
		.catch(() => null);
	if (!evidence) return { repositoryId: candidate.repositoryId };
	const store = createReceiptStore({
		stateRoot,
		repositoryIdentity: evidence.repositoryIdentity,
	});
	return store.repositoryId === candidate.repositoryId
		? {
				repositoryId: candidate.repositoryId,
				repositoryIdentity: evidence.repositoryIdentity,
				store,
			}
		: { repositoryId: candidate.repositoryId };
}

async function selectPrivateStateStore(
	canonicalStore: VaultGitReceiptStore,
	legacyStore: VaultGitReceiptStore,
): Promise<VaultGitReceiptStore> {
	if (canonicalStore.repositoryId === legacyStore.repositoryId) {
		return canonicalStore;
	}
	const [canonicalPopulated, legacyPopulated] = await Promise.all([
		privateStateNamespaceIsPopulated(canonicalStore),
		privateStateNamespaceIsPopulated(legacyStore),
	]);
	if (canonicalPopulated && legacyPopulated) {
		throw new VaultGitPrivateStateConflictError();
	}
	return legacyPopulated ? legacyStore : canonicalStore;
}

async function privateStateNamespaceIsPopulated(
	store: VaultGitReceiptStore,
): Promise<boolean> {
	try {
		return (await readdir(store.paths.repositoryRoot)).length > 0;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

function createConfiguredActivationRuntime(input: {
	readonly input: VaultGitCliCompositionInput;
	readonly repositoryPath: string;
	readonly repositoryIdentity: string;
	readonly processPort: VaultGitProcessPort;
	readonly store: VaultGitReceiptStore;
	readonly runtime: VaultGitRuntimePort;
	readonly admittedGitEnvironment?: Readonly<Record<string, string>>;
	readonly resolveRepositoryIdentity: () => Promise<string>;
}): {
	readonly validation: Pick<VaultGitActivationAuthority, "validate">;
	readonly frontDoor?: VaultGitActivationFrontDoor;
} {
	const identity = input.input.activationIdentity;
	if (!identity) {
		const missingConfiguration = input.input.activationConfigurationMissing;
		return {
			validation: {
				async validate() {
				return missingConfiguration && missingConfiguration.length > 0
					? {
							status: "denied" as const,
							reason: "configuration_missing" as const,
							missingConfiguration,
						}
					: {
							status: "denied" as const,
							reason: "revalidation_unavailable" as const,
						};
				},
			},
		};
	}
	const remoteName = input.input.remote ?? DEFAULT_REMOTE;
	const preparer = createVaultGitActivationPreparer({
		repositoryPath: input.repositoryPath,
		privateStateRoot: input.input.stateRoot,
		remoteName,
		...(input.input.allowedRemoteHosts
			? { allowedRemoteHosts: input.input.allowedRemoteHosts }
			: {}),
		repositoryIdentity: input.repositoryIdentity,
		jobGeneration: 1,
		process: input.processPort,
		store: input.store,
		resolveRepositoryIdentity: input.resolveRepositoryIdentity,
		resolveActivationIdentities: () =>
			resolveVaultGitActivationIdentities({
				repositoryPath: input.repositoryPath,
				stateRoot: input.input.stateRoot,
				remoteName,
				...identity,
				process: input.processPort,
				timeoutMs: DEFAULT_TIMEOUTS.localMs,
			}),
		createChecker: (isolatedRepositoryPath) =>
			createVaultCheckerPort(
				isolatedRepositoryPath,
				input.processPort,
				identity.runtimeBinaryPath,
			),
		clock: () => input.runtime.now().toISOString(),
		timeouts: DEFAULT_TIMEOUTS,
		gitBinaryPath: identity.gitBinaryPath,
		...(input.admittedGitEnvironment
			? { admittedGitEnvironment: input.admittedGitEnvironment }
			: {}),
	});
	const frontDoor = createVaultGitActivationFrontDoor({
		store: input.store,
		preparer,
		clock: () => input.runtime.now().toISOString(),
		createAuthority: (validateHumanCapability) =>
			createVaultGitActivationAuthority({
				store: input.store,
				clock: () => input.runtime.now().toISOString(),
				validateHumanCapability,
				revalidate: preparer.revalidate,
			}),
	});
	return { validation: frontDoor, frontDoor };
}

function createTerminalActivationReviewPort(): VaultGitHumanActivationReviewPort {
	return {
		isInteractive: () =>
			process.stdin.isTTY === true && process.stderr.isTTY === true,
		async decide(input) {
			process.stderr.write(renderVaultGitActivationResult(input.result));
			const choices =
				input.action === "review"
					? "Activate or Defer"
					: input.action === "defer"
						? "Defer"
						: "Revoke";
			const terminal = createInterface({
				input: process.stdin,
				output: process.stderr,
			});
			try {
				const answer = (await terminal.question(`Type ${choices}: `))
					.trim()
					.toLowerCase();
				return ["activate", "defer", "revoke"].includes(answer)
					? (answer as VaultGitHumanActivationDecision)
					: "cancel";
			} finally {
				terminal.close();
			}
		},
	};
}

/** Render bounded root help from the live facade contracts. */
export function renderVaultGitHelp(): string {
	return [
		"vault-git - transact and repair the configured Super-vault safely",
		"",
		"Usage:",
		"  vault-git",
		...VAULT_GIT_COMMANDS.flatMap((command) =>
			vaultGitContracts[command].usage.map((usage) => `  ${usage}`),
		),
		"",
		"No arguments show a read-only dashboard with one next safe action.",
	].join("\n");
}

/** Run the vault-git CLI and return its process exit code. */
export async function main(
	argv: readonly string[],
	options: VaultGitCliOptions = {},
): Promise<number> {
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	const now = options.now ?? Date.now;
	const humanActivationReview =
		options.humanActivationReview ?? createTerminalActivationReviewPort();
	let diagnostics: ReturnType<typeof parseCliDiagnosticArgv>;
	try {
		diagnostics = parseCliDiagnosticArgv(argv);
	} catch (error) {
		const fallback = parseCliDiagnosticFallbackArgv(argv);
		return emitUsageFailure({
			error,
			argv,
			stdout,
			stderr,
			runId: fallback.options.runId,
			startedAt: fallback.options.startedAtMs,
			now,
		});
	}

	const args = diagnostics.argv;
	if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
		const helpCommand = args[0] === "help" ? args[1] : args[0];
		if (
			helpCommand &&
			VAULT_GIT_COMMANDS.includes(helpCommand as VaultGitCommand)
		) {
			stdout.write(
				renderCommandUsage(vaultGitContracts[helpCommand as VaultGitCommand]),
			);
		} else {
			stdout.write(`${renderVaultGitHelp()}\n`);
		}
		return 0;
	}

	let invocation: ParsedVaultGitInvocation;
	try {
		invocation = parseVaultGitInvocation(args);
		validateInvocation(invocation);
	} catch (error) {
		return emitUsageFailure({
			error,
			argv: args,
			stdout,
			stderr,
			runId: diagnostics.options.runId,
			startedAt: diagnostics.options.startedAtMs,
			now,
		});
	}

	if (!isRuntimeInvocation(invocation)) {
		return emitDiscovery({
			stdout,
			runId: diagnostics.options.runId,
			startedAt: diagnostics.options.startedAtMs,
			now,
		});
	}

	let composition: VaultGitCliComposition | null;
	try {
		composition =
			options.composition ??
			(await (options.resolveComposition ?? resolveDefaultComposition)(
				invocation.command,
			));
	} catch (error) {
		if (error instanceof VaultGitPrivateStateConflictError) {
			return emitPrivateStateConflict({
				invocation,
				stdout,
				stderr,
				runId: diagnostics.options.runId,
				startedAt: diagnostics.options.startedAtMs,
				now,
			});
		}
		if (error instanceof VaultRepositoryIdentityUnavailableError) {
			return emitActivationUnavailable({
				invocation,
				stdout,
				stderr,
				runId: diagnostics.options.runId,
				startedAt: diagnostics.options.startedAtMs,
				now,
			});
		}
		composition = null;
	}
	if (!composition) {
		return emitUnconfigured({
			invocation,
			stdout,
			stderr,
			runId: diagnostics.options.runId,
			startedAt: diagnostics.options.startedAtMs,
			now,
		});
	}
	const environment = options.env ?? process.env;
	const taskLifecycleDispatch = resolveVaultGitTaskLifecycleDispatch(environment);

	try {
		if (
			options.launchPrivate !== false &&
			invocation.command === "doctor" &&
			invocation.taskId === undefined &&
			environment[VAULT_GIT_DOCTOR_TASK_ID_ENV] === undefined
		) {
			const admitted = await composeVaultGitDoctorFrontDoor(
				composition,
				now,
				environment,
			).admitForeground({
				transactionId: invocation.transactionId,
				args,
			});
			if (admitted.kind === "projected") {
				return emitPayload({
					invocation,
					stdout,
					stderr,
					runId: diagnostics.options.runId,
					startedAt: diagnostics.options.startedAtMs,
					now,
					payload: admitted.projection.payload,
					success: admitted.projection.success,
					errorCode: admitted.projection.errorCode,
				});
			}
		}
		if (
			options.launchPrivate !== false &&
			invocation.command === "complete" &&
			invocation.capabilityFd === undefined
		) {
			const activation = composition.activationAuthority
				? await composition.activationAuthority.validate("continuation")
				: { status: "admitted" as const };
			if (activation.status !== "admitted") {
				const inspected = await composition.engine.inspect();
				return emitRuntimeResult({
					invocation,
					result: {
						kind: "engine",
						value: { ...inspected, status: "refused" },
					},
					stdout,
					stderr,
					runId: diagnostics.options.runId,
					startedAt: diagnostics.options.startedAtMs,
					now,
				});
			}
			return launchBackgroundCompletion({
				composition,
				invocation: invocation as VaultGitRuntimeInvocation & { readonly command: "complete" },
				args,
				backgroundRuntime:
					options.backgroundCompletionRuntime ??
					DEFAULT_BACKGROUND_COMPLETION_RUNTIME,
				stdout,
				stderr,
				runId: diagnostics.options.runId,
				startedAt: diagnostics.options.startedAtMs,
				now,
			});
		}
		if (
			options.launchPrivate !== false &&
			invocation.capabilityFd === undefined &&
			needsPrivateLaunch(invocation)
		) {
			const launched = await launchPrivateInvocation(
				composition,
				invocation,
				args,
				diagnostics.options.runId,
			);
			if (launched) {
				const parseable =
					!invocation.json || isSingleJsonEnvelope(launched.launch.stdout);
				if (launched.launch.timedOut || !parseable) {
					// A killed or garbled private child proves nothing about the
					// remote outcome; synthesize one structured refusal instead of
					// forwarding truncated child bytes.
					return emitIndeterminateLaunch({
						invocation,
						phase: launched.phase,
						stdout,
						stderr,
						runId: diagnostics.options.runId,
						startedAt: diagnostics.options.startedAtMs,
						now,
					});
				}
				stdout.write(launched.launch.stdout);
				stderr.write(launched.launch.stderr);
				return launched.launch.exitCode ?? 1;
			}
		}

		const result = await executeInvocation(
			invocation,
			composition,
			options.readCapability ?? readInheritedCapability,
			humanActivationReview,
			taskLifecycleDispatch,
			environment,
			now,
		);
		return emitRuntimeResult({
			invocation,
			result,
			stdout,
			stderr,
			runId: diagnostics.options.runId,
			startedAt: diagnostics.options.startedAtMs,
			now,
		});
	} catch {
		return emitUnexpectedFailure({
			invocation,
			stdout,
			stderr,
			runId: diagnostics.options.runId,
			startedAt: diagnostics.options.startedAtMs,
			now,
		});
	}
}

/** Run the CLI with captured writers and deterministic run correlation. */
export async function runVaultGitForTest(
	argv: readonly string[],
	options: {
		readonly runId?: string;
		readonly composition?: VaultGitCliComposition;
		readonly resolveComposition?: (
			command: Exclude<VaultGitCommand, "commands">,
		) => Promise<VaultGitCliComposition | null>;
		readonly readCapability?: (descriptor: number) => Promise<Uint8Array>;
		readonly launchPrivate?: boolean;
		readonly humanActivationReview?: VaultGitHumanActivationReviewPort;
		readonly backgroundCompletionRuntime?: VaultGitBackgroundCompletionRuntime;
		readonly env?: NodeJS.ProcessEnv;
	} = {},
): Promise<VaultGitCliRun> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const runId = options.runId ?? "vault-git-test";
	const exitCode = await main(["--run-id", runId, ...argv], {
		stdout,
		stderr,
		now: () => 0,
		resolveComposition: options.resolveComposition ?? (async () => null),
		...(options.composition ? { composition: options.composition } : {}),
		...(options.readCapability
			? { readCapability: options.readCapability }
			: {}),
		...(options.launchPrivate === undefined
			? {}
			: { launchPrivate: options.launchPrivate }),
		...(options.humanActivationReview
			? { humanActivationReview: options.humanActivationReview }
			: {}),
		...(options.backgroundCompletionRuntime
			? { backgroundCompletionRuntime: options.backgroundCompletionRuntime }
			: {}),
		...(options.env ? { env: options.env } : {}),
	});
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

async function resolveDefaultComposition(
	command: Exclude<VaultGitCommand, "commands">,
): Promise<VaultGitCliComposition | null> {
	const repositoryPath =
		process.env.VAULT_GIT_REPOSITORY_PATH ??
		(await resolveConfiguredVaultRoot(process.env.VAULT_GIT_CONFIG_PATH));
	if (!repositoryPath) return null;
	const stateRoot =
		process.env.VAULT_GIT_STATE_ROOT ??
		process.env.XDG_STATE_HOME ??
		join(homedir(), ".local", "state");
	const activationIdentity = await resolveDefaultActivationIdentity(
		process.env,
		homedir(),
	);
	const allowedRemoteHosts = resolveDefaultAllowedRemoteHosts();
	const input: VaultGitCliCompositionInput = {
		repositoryPath,
		checkRepositoryPath:
			process.env.VAULT_GIT_CHECK_REPOSITORY_PATH ?? repositoryPath,
		stateRoot,
		privateStateNamespaceIdentity:
			process.env.VAULT_GIT_REPOSITORY_IDENTITY ??
			DEFAULT_LEGACY_STATE_IDENTITY,
		actor: process.env.VAULT_GIT_ACTOR ?? process.env.USER ?? "operator",
		host:
			activationIdentity.status === "configured"
				? activationIdentity.value.hostId
				: (process.env.VAULT_GIT_HOST ?? hostname()),
		remote: process.env.VAULT_GIT_REMOTE ?? DEFAULT_REMOTE,
		...(allowedRemoteHosts ? { allowedRemoteHosts } : {}),
		...(activationIdentity.status === "configured"
			? { activationIdentity: activationIdentity.value }
			: {
					activationConfigurationMissing:
						activationIdentity.missingConfiguration,
				}),
	};
	return ["status", "preview", "doctor"].includes(command)
		? createVaultGitCliRecoveryComposition(input)
		: createVaultGitCliComposition(input);
}

function resolveDefaultAllowedRemoteHosts(): readonly string[] | undefined {
	const configured = process.env.VAULT_GIT_ALLOWED_REMOTE_HOSTS;
	if (configured === undefined) return undefined;
	// Exact DNS names only. Empty entries remain visible to constructor
	// validation so a malformed owner-controlled admission fails closed.
	return configured.split(",").map((host) => host.trim());
}

type ResolvedDefaultActivationIdentity =
	| {
			readonly status: "configured";
			readonly value: VaultGitCliActivationIdentityInput;
	  }
	| {
			readonly status: "missing";
			readonly missingConfiguration: readonly VaultGitActivationConfigurationField[];
	  };

/**
 * Resolve the default activation identity from the fixture environment lane
 * or, when every fixture variable is unset, the persisted Vault Git Host
 * Enrollment lane. Production daily-driver execution leaves the four legacy
 * activation variables unset.
 * @internal
 */
export async function resolveDefaultActivationIdentity(
	env: Readonly<Record<string, string | undefined>>,
	homeDir: string,
	executingPath?: string,
): Promise<ResolvedDefaultActivationIdentity> {
	const hostId = env.VAULT_GIT_HOST;
	const sshIdentityFilePath = env.VAULT_GIT_SSH_IDENTITY_FILE_PATH;
	const sshIdentityPublicKeyPath = env.VAULT_GIT_SSH_PUBLIC_KEY_PATH;
	const sshKnownHostsPath = env.VAULT_GIT_SSH_KNOWN_HOSTS_PATH;
	const configured: Record<
		VaultGitActivationConfigurationField,
		string | undefined
	> = {
		host_identity: hostId,
		ssh_identity_file: sshIdentityFilePath,
		ssh_public_key: sshIdentityPublicKeyPath,
		ssh_known_hosts: sshKnownHostsPath,
	};
	const missingConfiguration = VAULT_GIT_ACTIVATION_CONFIGURATION_FIELDS.filter(
		(field) => !configured[field],
	);
	if (
		missingConfiguration.length ===
		VAULT_GIT_ACTIVATION_CONFIGURATION_FIELDS.length
	) {
		return resolvePersistedActivationIdentity({
			configRoot: join(
				env.XDG_CONFIG_HOME ?? join(homeDir, ".config"),
				"context",
				"vault-git",
			),
			dataRoot: join(
				env.XDG_DATA_HOME ?? join(homeDir, ".local", "share"),
				"context",
				"vault-git",
			),
			gitBinaryPath: env.VAULT_GIT_GIT_BINARY_PATH ?? "/usr/bin/git",
			sshBinaryPath: env.VAULT_GIT_SSH_BINARY_PATH ?? "/usr/bin/ssh",
			...(executingPath === undefined ? {} : { executingPath }),
		});
	}
	if (
		missingConfiguration.length > 0 ||
		!hostId ||
		!sshIdentityFilePath ||
		!sshIdentityPublicKeyPath ||
		!sshKnownHostsPath
	) {
		return { status: "missing", missingConfiguration };
	}
	return {
		status: "configured",
		value: {
			hostId,
			runtimeBinaryPath: process.execPath,
			runtimeVersion: Bun.version,
			executablePath: CLI_PATH,
			executableSourcePaths: VAULT_GIT_PRODUCTION_EXECUTABLE_SOURCE_PATHS,
			gitBinaryPath: env.VAULT_GIT_GIT_BINARY_PATH ?? "/usr/bin/git",
			sshBinaryPath: env.VAULT_GIT_SSH_BINARY_PATH ?? "/usr/bin/ssh",
			sshIdentityFilePath,
			sshIdentityPublicKeyPath,
			sshKnownHostsPath,
		},
	};
}

const PERSISTED_HOST_HANDLE_PATTERN = /^host_[a-f0-9]{32}$/;
const PERSISTED_RUNTIME_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Resolve activation identity input from the persisted Activation
 * Configuration and the exact content-addressed selected Installed Runtime.
 *
 * Setup owns these record schemas
 * (runtime/setup/src/vault-git-host-enrollment.ts); this is a read-only
 * fail-closed projection of their smallest stable shape. Persisted enrollment
 * configures activation only when the executing image is the selected
 * Installed Runtime by canonical real path; a source-run invocation (Bun
 * interpreter executing checkout source) must fail closed to missing rather
 * than admit the unchanged installed file.
 * @internal
 */
export async function resolvePersistedActivationIdentity(options: {
	readonly configRoot: string;
	readonly dataRoot: string;
	readonly gitBinaryPath?: string;
	readonly sshBinaryPath?: string;
	/** Executing program image; defaults to `process.execPath`. */
	readonly executingPath?: string;
}): Promise<ResolvedDefaultActivationIdentity> {
	const missing = {
		status: "missing",
		missingConfiguration: VAULT_GIT_ACTIVATION_CONFIGURATION_FIELDS,
	} as const;
	const [activation, selection] = await Promise.all([
		readPersistedOwnerJson(join(options.configRoot, "activation.json")).then(
			parsePersistedActivation,
		),
		readPersistedOwnerJson(
			join(options.configRoot, "runtime-selection.json"),
		).then(parsePersistedSelection),
	]);
	if (!activation || !selection) return missing;
	const executablePath = join(
		options.dataRoot,
		"runtimes",
		selection.selectedDigest,
		"vault-git",
	);
	if (!(await installedRuntimeMatches(executablePath, selection.selectedDigest))) {
		return missing;
	}
	const executingPath = options.executingPath ?? process.execPath;
	if (!(await executingImageIsInstalledRuntime(executingPath, executablePath))) {
		return missing;
	}
	return {
		status: "configured",
		value: {
			hostId: activation.hostHandle,
			runtimeBinaryPath: executingPath,
			runtimeVersion: Bun.version,
			executablePath,
			executableSourcePaths: [executablePath],
			gitBinaryPath: options.gitBinaryPath ?? "/usr/bin/git",
			sshBinaryPath: options.sshBinaryPath ?? "/usr/bin/ssh",
			sshIdentityFilePath: activation.sshIdentityFilePath,
			sshIdentityPublicKeyPath: activation.sshPublicKeyPath,
			sshKnownHostsPath: activation.sshKnownHostsPath,
		},
	};
}

async function readPersistedOwnerJson(path: string): Promise<unknown> {
	try {
		const entry = await lstat(path, { bigint: true });
		if (
			entry.isSymbolicLink() ||
			!entry.isFile() ||
			(entry.mode & 0o077n) !== 0n
		) {
			return undefined;
		}
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return undefined;
	}
}

function parsePersistedActivation(value: unknown):
	| {
			readonly hostHandle: string;
			readonly sshIdentityFilePath: string;
			readonly sshPublicKeyPath: string;
			readonly sshKnownHostsPath: string;
	  }
	| undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const expectedKeys = [
		"host_handle",
		"schema_version",
		"ssh_identity_file_path",
		"ssh_known_hosts_path",
		"ssh_public_key_path",
	];
	const paths = [
		record.ssh_identity_file_path,
		record.ssh_public_key_path,
		record.ssh_known_hosts_path,
	];
	if (
		Object.keys(record).sort().join("\0") !== expectedKeys.join("\0") ||
		record.schema_version !== 1 ||
		typeof record.host_handle !== "string" ||
		!PERSISTED_HOST_HANDLE_PATTERN.test(record.host_handle) ||
		!paths.every((path) => typeof path === "string" && isAbsolute(path))
	) {
		return undefined;
	}
	return {
		hostHandle: record.host_handle,
		sshIdentityFilePath: record.ssh_identity_file_path as string,
		sshPublicKeyPath: record.ssh_public_key_path as string,
		sshKnownHostsPath: record.ssh_known_hosts_path as string,
	};
}

function parsePersistedSelection(
	value: unknown,
): { readonly selectedDigest: string } | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).sort().join("\0") !==
			["prior_digest", "schema_version", "selected_digest"].join("\0") ||
		record.schema_version !== 1 ||
		typeof record.selected_digest !== "string" ||
		!PERSISTED_RUNTIME_DIGEST_PATTERN.test(record.selected_digest) ||
		!(record.prior_digest === null ||
			(typeof record.prior_digest === "string" &&
				PERSISTED_RUNTIME_DIGEST_PATTERN.test(record.prior_digest)))
	) {
		return undefined;
	}
	return { selectedDigest: record.selected_digest };
}

/**
 * Symlink aliases of the same installed image may pass; a different image,
 * including the Bun interpreter on a source run, must fail closed.
 */
async function executingImageIsInstalledRuntime(
	executingPath: string,
	installedPath: string,
): Promise<boolean> {
	try {
		const [executingRealPath, installedRealPath] = await Promise.all([
			realpath(executingPath),
			realpath(installedPath),
		]);
		return executingRealPath === installedRealPath;
	} catch {
		return false;
	}
}

async function installedRuntimeMatches(
	path: string,
	digest: string,
): Promise<boolean> {
	try {
		const entry = await lstat(path);
		if (
			entry.isSymbolicLink() ||
			!entry.isFile() ||
			(entry.mode & 0o111) === 0
		) {
			return false;
		}
		return (
			createHash("sha256").update(await readFile(path)).digest("hex") === digest
		);
	} catch {
		return false;
	}
}

/**
 * Create the shell-free process adapter for the external structured checker.
 *
 * @param repositoryPath - Canonical configured vault root
 * @param processPort - Bounded scrubbed subprocess boundary
 * @returns Fingerprint, check, registry, and exact repair operations
 * @throws When fingerprint source files are missing or unreadable, dependency
 * or workspace metadata has no valid bun.lock, the package.json check
 * script does not name exactly one repository-relative entrypoint file, or
 * the admitted installed-runtime runner is unusable at execution time
 *
 * @example
 * ```typescript
 * const checker = createVaultCheckerPort(vaultRoot, createNodeProcessPort(), process.execPath)
 * const result = await checker.runCheck()
 * ```
 */
export function createVaultCheckerPort(
	repositoryPath: string,
	processPort: VaultGitProcessPort,
	runtimeBinaryPath: string = process.execPath,
): VaultGitCheckerPort {
	const run = async (args: readonly string[]) => {
		const runner = await resolveVaultGitInstalledRuntimeRunner(
			runtimeBinaryPath,
		);
		if (runner.status !== "resolved") {
			throw new Error(`vault checker runtime unusable: ${runner.reason}`);
		}
		return processPort.run({
			command: runner.command,
			args,
			cwd: repositoryPath,
			env: runner.environment,
			environmentMode: "isolated",
			timeoutMs: DEFAULT_TIMEOUTS.localMs,
		});
	};
	return {
		async fingerprint() {
			// KTD10 admission covers the executed surface: the entrypoint is the
			// file the package.json check script actually names, and the
			// dependency bundle spans package.json, the exact valid bun.lock or a
			// classified dependency-free absence binding, bunfig.toml when present,
			// and every TypeScript module under scripts/ the checker could import.
			const manifestBytes = await readFile(join(repositoryPath, "package.json"));
			const entrypointPath = resolveCheckEntrypoint(manifestBytes);
			const entrypoint = await readFile(join(repositoryPath, entrypointPath));
			const lockfile = await readCheckerLockfileBinding(
				repositoryPath,
				manifestBytes,
			);
			const bundle: Array<{ readonly path: string; readonly bytes: Buffer }> = [
				{ path: "package.json", bytes: manifestBytes },
				lockfile,
			];
			// The checker reads this deterministic contract as runtime input. Bind it
			// with code and lock bytes so schema drift always invalidates admission.
			const checkerDataPaths = ["schemas/frontmatter-contract.json"] as const;
			for (const path of checkerDataPaths) {
				bundle.push({ path, bytes: await readFile(join(repositoryPath, path)) });
			}
			const bunfig = await readFile(join(repositoryPath, "bunfig.toml")).catch(
				(error: NodeJS.ErrnoException) => {
					if (error.code === "ENOENT") return null;
					throw error;
				},
			);
			if (bunfig !== null) bundle.push({ path: "bunfig.toml", bytes: bunfig });
			const scriptNames = (
				await readdir(join(repositoryPath, "scripts"), { recursive: true }).catch(
					(error: NodeJS.ErrnoException) => {
						if (error.code === "ENOENT") return [] as string[];
						throw error;
					},
				)
			)
				.map((name) => String(name).split("\\").join("/"))
				.filter((name) => name.endsWith(".ts"))
				.sort();
			for (const name of scriptNames) {
				bundle.push({
					path: `scripts/${name}`,
					bytes: await readFile(join(repositoryPath, "scripts", name)),
				});
			}
			const dependencyHash = createHash("sha256");
			for (const { path, bytes } of bundle) {
				dependencyHash.update(path).update("\0").update(bytes).update("\0");
			}
			return {
				entrypointHash: createHash("sha256").update(entrypoint).digest("hex"),
				dependencyBundleHash: dependencyHash.digest("hex"),
			};
		},
		async runCheck() {
			// Never dispatch through `run check`: bun's run-script lane prepends
			// the machine-shared /tmp bun-node shim ahead of the isolated PATH,
			// handing nested `bun` to ambient bytes instead of the verified alias.
			const manifest = parseVaultGitManifest(
				await readFile(join(repositoryPath, "package.json")),
			);
			// The spawned line is rebuilt from the same admission the fingerprint
			// entrypoint comes from; the raw manifest string never reaches exec.
			const admission = admitCheckCommand(manifest);
			return run(["exec", `${admission.commandLine} --json`]);
		},
		readRepairRegistry() {
			return run(["run", "scripts/vault-repair-registry.ts"]);
		},
		applyRepair(request) {
			return run([
				"run",
				"scripts/vault-repair-registry.ts",
				"--apply",
				request.repairId,
				"--file",
				request.file,
				"--field",
				request.field,
				"--root",
				repositoryPath,
			]);
		},
	};
}

async function readCheckerLockfileBinding(
	repositoryPath: string,
	manifestBytes: Buffer,
): Promise<{ readonly path: string; readonly bytes: Buffer }> {
	const lockfileBytes = await readFile(join(repositoryPath, "bun.lock")).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return null;
			throw error;
		},
	);
	if (lockfileBytes !== null) {
		assertValidBunLockfile(lockfileBytes, manifestBytes);
		return { path: "bun.lock:present", bytes: lockfileBytes };
	}
	assertDependencyFreeManifest(manifestBytes);
	return {
		path: "bun.lock:absent",
		bytes: DEPENDENCY_FREE_LOCKFILE_ABSENCE_BINDING,
	};
}

function assertDependencyFreeManifest(manifestBytes: Uint8Array): void {
	const manifest = parseVaultGitManifest(manifestBytes);
	const dependencySurface = findVaultGitDependencySurface(manifest);
	if (dependencySurface !== undefined) {
		throw new Error(
			`bun.lock is required when package.json declares ${dependencySurface}`,
		);
	}
}

function assertValidBunLockfile(
	lockfileBytes: Uint8Array,
	manifestBytes: Uint8Array,
): void {
	let lockfile: unknown;
	try {
		lockfile = Bun.JSONC.parse(Buffer.from(lockfileBytes).toString("utf8"));
	} catch {
		throw new Error("bun.lock is not valid JSONC");
	}
	if (typeof lockfile !== "object" || lockfile === null || Array.isArray(lockfile)) {
		throw new Error("bun.lock contract is invalid");
	}
	const record = lockfile as Record<string, unknown>;
	if (
		record.lockfileVersion !== 1 ||
		record.configVersion !== 1 ||
		typeof record.workspaces !== "object" ||
		record.workspaces === null ||
		Array.isArray(record.workspaces)
	) {
		throw new Error("bun.lock contract is invalid");
	}
	const manifest = parseVaultGitManifest(manifestBytes);
	const dependencySurface = findVaultGitDependencySurface(manifest);
	const packages = record.packages;
	if (
		dependencySurface !== undefined &&
		(typeof packages !== "object" ||
			packages === null ||
			Array.isArray(packages))
	) {
		throw new Error("bun.lock dependency contract is invalid");
	}
	assertDeclaredDependencyResolutions(manifest, record);
}

function assertDeclaredDependencyResolutions(
	manifest: Readonly<Record<string, unknown>>,
	lockfile: Readonly<Record<string, unknown>>,
): void {
	const workspaces = lockfile.workspaces as Readonly<Record<string, unknown>>;
	const rootWorkspace = workspaces[""];
	const packages = lockfile.packages;
	for (const field of RESOLVED_DEPENDENCY_MANIFEST_FIELDS) {
		if (!Object.hasOwn(manifest, field)) continue;
		const dependencies = manifest[field];
		if (
			typeof dependencies !== "object" ||
			dependencies === null ||
			Array.isArray(dependencies)
		) {
			throw new Error(`package.json ${field} is not an object`);
		}
		const entries = Object.entries(dependencies);
		if (entries.length === 0) continue;
		if (
			typeof rootWorkspace !== "object" ||
			rootWorkspace === null ||
			Array.isArray(rootWorkspace) ||
			typeof packages !== "object" ||
			packages === null ||
			Array.isArray(packages)
		) {
			throw new Error("bun.lock dependency resolution is invalid");
		}
		const lockedDependencies = (
			rootWorkspace as Readonly<Record<string, unknown>>
		)[field];
		if (
			typeof lockedDependencies !== "object" ||
			lockedDependencies === null ||
			Array.isArray(lockedDependencies)
		) {
			throw new Error("bun.lock dependency resolution is invalid");
		}
		for (const [name, specifier] of entries) {
			const resolution = (packages as Readonly<Record<string, unknown>>)[name];
			if (
				typeof specifier !== "string" ||
				(lockedDependencies as Readonly<Record<string, unknown>>)[name] !==
					specifier ||
				!Array.isArray(resolution) ||
				typeof resolution[0] !== "string" ||
				resolution[0].length === 0
			) {
				throw new Error("bun.lock dependency resolution is invalid");
			}
		}
	}
}

/**
 * Admit the manifest check script through the shared single-command owner or
 * fail closed with the exact checker-lane refusal. Fingerprint and execution
 * both consume this one admission, so the hashed entrypoint and the spawned
 * command line cannot diverge.
 */
function admitCheckCommand(manifest: Readonly<Record<string, unknown>>) {
	const admission = admitVaultGitCheckCommand(manifest);
	if (admission.status === "admitted") return admission;
	switch (admission.reason) {
		case "script_unavailable":
			throw new Error("vault check script is unavailable");
		case "shell_grammar_rejected":
			throw new Error(
				"vault check script is broader than one admitted command",
			);
		case "entrypoint_unresolved":
			throw new Error(
				"vault check script does not resolve to one repository-relative entrypoint",
			);
	}
}

/**
 * Resolve the one repository-relative script file the package.json check
 * script executes. Admission fails closed when zero or multiple candidate
 * files appear, so an unresolvable checker surface can never be admitted.
 */
function resolveCheckEntrypoint(manifestBytes: Uint8Array): string {
	return admitCheckCommand(parseVaultGitManifest(manifestBytes)).entrypoint;
}

async function resolveConfiguredVaultRoot(
	explicitConfigPath?: string,
): Promise<string | null> {
	const configPath =
		explicitConfigPath ??
		join(
			process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
			"context",
			"vault.md",
		);
	const source = await readFile(configPath, "utf8").catch(() => null);
	if (!source) return null;
	const declarations: string[] = [];
	for (const line of source.split(/\r?\n/)) {
		const match = line.match(
			/^\s*(?:[-*]\s*)?(?:configured\s+)?vault\s+root\s*:\s*[`"']?(.+?)[`"']?\s*$/i,
		);
		const candidate = match?.[1]?.trim();
		if (candidate) declarations.push(candidate);
	}
	const [candidate] = declarations;
	return declarations.length === 1 && candidate && isAbsolute(candidate)
		? candidate
		: null;
}

function validateInvocation(invocation: ParsedVaultGitInvocation): void {
	if (invocation.transactionId && !/^txn_[0-9a-f]{32}$/.test(invocation.transactionId)) {
		throw usageError("--transaction-id must be an opaque vault transaction id");
	}
	if (
		invocation.taskId &&
		!((invocation.command === "doctor"
			? /^doctor_task_[0-9a-f]{32}$/u
			: /^task_[0-9a-f]{32}$/u
		).test(invocation.taskId))
	) {
		throw usageError("--task-id must be an opaque command-owned task id");
	}
	if (invocation.command === "begin") {
		if (!invocation.event) throw usageError("begin requires --event");
		if (invocation.paths.length === 0) throw usageError("begin requires --path");
	}
	if (invocation.command === "join") {
		if (!invocation.transactionId) throw usageError("join requires --transaction-id");
		if (invocation.paths.length === 0) throw usageError("join requires --path");
	}
	if (invocation.command === "complete") {
		if (!invocation.transactionId) throw usageError("complete requires --transaction-id");
		if (!invocation.summary) throw usageError("complete requires --summary");
	}
	if (
		invocation.command === "activation" &&
		["review", "defer", "revoke"].includes(
			invocation.activationAction ?? "inspect",
		) &&
		(!invocation.evidenceReference ||
			!EVIDENCE_ID.test(invocation.evidenceReference))
	) {
		throw usageError(
			"activation review actions require an opaque V2 evidence reference",
		);
	}
	if (invocation.command === "repair") {
		// Only the generation-bound takeover requires the transaction selector;
		// other repairs may resume a pre-acknowledgement receipt that never
		// received a transaction id to echo.
		if (invocation.repairAction === "stale-lease-takeover") {
			if (!invocation.transactionId) {
				throw usageError(
					"repair stale-lease-takeover requires --transaction-id",
				);
			}
			if (!invocation.priorWriterStopped) {
				throw usageError(
					"repair stale-lease-takeover requires --prior-writer-stopped",
				);
			}
		}
	}
}

function needsPrivateLaunch(invocation: ParsedVaultGitInvocation): boolean {
	return ["join", "repair"].includes(invocation.command);
}

/** Private-launch outcome plus the last durable phase known before the child ran. */
interface VaultGitPrivateLaunchOutcome {
	readonly launch: VaultGitCapabilityLaunchResult;
	readonly phase: VaultGitTransactionPhase;
}

async function launchPrivateInvocation(
	composition: VaultGitCliComposition,
	invocation: ParsedVaultGitInvocation,
	args: readonly string[],
	runId: string,
): Promise<VaultGitPrivateLaunchOutcome | null> {
	const loaded = await composition.store.load();
	if (loaded.status !== "loaded") return null;
	const phase = loaded.receipt.phase;
	const childArgs = [
		composition.privateEntrypointPath ?? CLI_PATH,
		"--run-id",
		runId,
		...args,
	];
	if (invocation.repairAction === "stale-lease-takeover") {
		const doctor = await composition.engine.doctor({
			transactionId: invocation.transactionId,
			issueTakeoverToken: true,
		});
		if (
			doctor.repairAction !== "stale-lease-takeover" ||
			!doctor.transactionId ||
			!doctor.ledgerGeneration ||
			!doctor.takeoverTokenIssued
		) {
			return null;
		}
		return {
			phase,
			launch: await launchDoctorTokenProcess(composition.store, {
				transactionId: doctor.transactionId,
				ledgerGeneration: doctor.ledgerGeneration,
				command: process.execPath,
				args: childArgs,
				cwd: composition.repositoryPath,
				timeoutMs: STALE_TAKEOVER_PRIVATE_LAUNCH_TIMEOUT_MS,
			}),
		};
	}
	const role: VaultGitCapabilityRole =
		invocation.command === "join" ? "join" : "owner";
	return {
		phase,
		launch: await launchCapabilityProcess(composition.store, {
			receiptId: loaded.receipt.receiptId,
			role,
			command: process.execPath,
			args: childArgs,
			cwd: composition.repositoryPath,
			timeoutMs: DEFAULT_TIMEOUTS.pushMs,
		}),
	};
}

/** True when stdout carries exactly one parseable JSON envelope object. */
function isSingleJsonEnvelope(output: string): boolean {
	const trimmed = output.trim();
	if (trimmed.length === 0) return false;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
	} catch {
		return false;
	}
}

/**
 * Compose the deep Doctor owner from the live composition. The CLI supplies
 * only IO adapters (spawn, process identity, clocks); admission, inspection,
 * terminal projection, and Doctor Continuation mapping live in the owner.
 */
function composeVaultGitDoctorFrontDoor(
	composition: VaultGitCliComposition,
	now: () => number,
	environment: NodeJS.ProcessEnv,
): VaultGitDoctorFrontDoor {
	return createVaultGitDoctorFrontDoor({
		store: composition.store,
		taskStore: requireDoctorTaskStore(composition),
		runtime: {
			now: () => performance.now(),
			recordedAt: () => composition.runtime.now(),
			sleep: (milliseconds) => Bun.sleep(milliseconds),
			spawnWorker: (context, taskId, launchGeneration, args) =>
				spawnBackgroundDoctorWorker(
					context,
					taskId,
					launchGeneration,
					args,
					environment,
				),
			readProcessIdentity: readVaultGitProcessIdentity,
			stopUnacknowledgedWorker,
			stopExpiredWorker: stopExpiredUnacknowledgedWorker,
			processIdentityMatches,
		},
		spawnContext: composition,
		now,
		...(composition.taskStore
			? {
					evidence: createVaultGitDoctorEvidenceSource({
						completionTasks: composition.taskStore,
						privateStateRoot: composition.store.paths.repositoryRoot,
						now: () => composition.runtime.now(),
					}),
				}
			: {}),
	});
}

function spawnBackgroundDoctorWorker(
	composition: VaultGitCliComposition,
	taskId: string,
	launchGeneration: string,
	args: readonly string[],
	environment: NodeJS.ProcessEnv,
): number {
	const child = spawn(
		process.execPath,
		[join(dirname(CLI_PATH), "doctor-worker.ts"), ...args],
		{
			cwd: composition.repositoryPath,
			env: {
				...projectVaultGitBackgroundWorkerEnvironment(environment),
				[VAULT_GIT_DOCTOR_TASK_ID_ENV]: taskId,
				[VAULT_GIT_DOCTOR_TASK_LAUNCH_GENERATION_ENV]: launchGeneration,
				VAULT_GIT_DOCTOR_TASK_REPOSITORY_ID:
					requireDoctorTaskStore(composition).repositoryId,
				VAULT_GIT_DOCTOR_TASK_DELEGATE_ENTRYPOINT:
					composition.privateEntrypointPath ?? CLI_PATH,
			},
			stdio: "ignore",
			detached: true,
		},
	);
	child.once("error", () => undefined);
	if (child.pid === undefined) {
		throw new Error("Background Doctor worker pid unavailable");
	}
	child.unref();
	return child.pid;
}

async function launchBackgroundCompletion(input: EmitContext & {
	readonly composition: VaultGitCliComposition;
	readonly invocation: VaultGitRuntimeInvocation & { readonly command: "complete" };
	readonly args: readonly string[];
	readonly backgroundRuntime: VaultGitBackgroundCompletionRuntime;
	readonly stderr: CliWriter;
}): Promise<number> {
	const acknowledgementStartedAt = input.backgroundRuntime.now();
	const loaded = await input.composition.store.load();
	if (
		loaded.status !== "loaded" ||
		!loaded.receipt.transactionId ||
		!loaded.receipt.leaseGeneration ||
		loaded.receipt.transactionId !== input.invocation.transactionId
	) {
		const payload = createVaultGitLifecycleResult({
			command: "complete",
			outcome: "refused",
			phase: loaded.status === "loaded" ? loaded.receipt.phase : "blocked",
			write_permission: "denied",
			changed_state: "none",
			retry_safety: "same_input_safe",
			blockers: ["receipt_conflict"],
			transaction_id: input.invocation.transactionId,
			// Transaction-receipt inspection: no background task, so inspect_status
			// projects the transaction status continuation.
			next_action: action("inspect_status", undefined, {
				result_kind: "transaction_receipt",
			}),
		});
		return emitPayload({ ...input, payload, success: false, errorCode: "receipt_conflict" });
	}
	let capability: Uint8Array;
	try {
		capability = await input.composition.store.readCapability(
			loaded.receipt.receiptId,
			"owner",
		);
	} catch (error) {
		return emitBackgroundCapabilityReadFailure(input, loaded.receipt.phase,
			isMissingFileError(error) ? "capability_missing" : "receipt_conflict");
	}
	if (capability.byteLength === 0) {
		return emitBackgroundCapabilityReadFailure(
			input,
			loaded.receipt.phase,
			"capability_missing",
		);
	}
	const capabilityDigest = createHash("sha256").update(capability).digest("hex");
	const taskStore = requireTaskStore(input.composition);
	const lifecycle = createVaultGitTaskLifecycle({
		role: "launcher",
		store: taskStore,
		runtime: input.backgroundRuntime,
		spawnContext: input.composition,
		recordedAt: () => new Date(input.now()),
	});
	const lifecycleOutcome = await lifecycle.launch({
		acknowledgementStartedAt,
		admission: {
			claimReceiptId: loaded.receipt.receiptId,
			receiptId: loaded.receipt.receiptId,
			receiptRevision: loaded.receipt.revision,
			transactionId: loaded.receipt.transactionId,
			remote: input.composition.remote,
			generation: loaded.receipt.leaseGeneration,
			capabilityDigest,
			normalizedInput: JSON.stringify({
				command: "complete",
				summary: input.invocation.summary,
			}),
			recordedAt: new Date(input.now()).toISOString(),
		},
		createLaunchGeneration: () =>
			`launch_${randomUUID().replaceAll("-", "")}`,
		args: input.args,
	});
	if (
		lifecycleOutcome.kind === "refused" &&
		lifecycleOutcome.reason === "task_input_mismatch"
	) {
		const payload = createVaultGitLifecycleResult({
			command: "complete",
			outcome: "refused",
			phase: loaded.receipt.phase,
			write_permission: "denied",
			changed_state: "none",
			retry_safety: "operator_required",
			blockers: ["task_input_mismatch"],
			transaction_id: loaded.receipt.transactionId,
			// Transaction-receipt inspection of the conflicting prior transaction.
			next_action: action("inspect_status", undefined, {
				result_kind: "transaction_receipt",
			}),
		});
		return emitPayload({ ...input, payload, success: false, errorCode: "task_input_mismatch" });
	}
	const state = lifecycleOutcome.state;
	if (!state) {
		const payload = createVaultGitLifecycleResult({
			command: "complete",
			outcome: "refused",
			phase: loaded.receipt.phase,
			write_permission: "denied",
			changed_state: "none",
			retry_safety: "operator_required",
			blockers: ["worker_launch_protocol_failed"],
			transaction_id: loaded.receipt.transactionId,
			next_action: action(
				"run_doctor",
				"Run doctor to inspect the unacknowledged worker launch.",
			),
		});
		return emitPayload({
			...input,
			payload,
			success: false,
			errorCode: "worker_launch_protocol_failed",
		});
	}
	if (state.phase === "terminal") {
		const payload = payloadForRuntime("complete", { kind: "task", value: state }, input.now());
		return emitPayload({
			...input,
			payload,
			success: state.state === "closed",
			errorCode: state.terminalResult?.blocker ?? "worker_lost",
		});
	}
	if (
		lifecycleOutcome.kind === "refused" ||
		state.state !== "in_progress"
	) {
		const blocker = "worker_launch_protocol_failed";
		const payload = createVaultGitLifecycleResult({
			command: "complete",
			outcome: "refused",
			phase: loaded.receipt.phase,
			write_permission: "denied",
			changed_state: "none",
			retry_safety: "operator_required",
			blockers: [blocker],
			transaction_id: loaded.receipt.transactionId,
			task_id: state.taskId,
			task_attempt_number: state.attemptNumber,
			task_previous_failure: state.previousTerminalResult,
			task_state: state.state,
			task_phase: state.phase,
			lease_generation: state.leaseGeneration,
			next_action: action("run_doctor", "Run doctor to inspect the unacknowledged worker launch."),
		});
		return emitPayload({ ...input, payload, success: false, errorCode: blocker });
	}
	const payload = createVaultGitLifecycleResult({
		command: "complete",
		outcome: "advanced",
		phase: state.checkpoint ?? "checking",
		write_permission: "denied",
		changed_state: "local",
		retry_safety: "same_input_safe",
		blockers: [],
		transaction_id: state.transactionId,
		task_id: state.taskId,
		task_attempt_number: state.attemptNumber,
		task_previous_failure: state.previousTerminalResult,
		lease_generation: state.leaseGeneration,
		task_state: state.state,
		task_phase: state.phase,
		task_heartbeat_at: state.heartbeatAt,
		task_checkpoint: state.checkpoint,
		task_elapsed_ms: Math.max(0, input.now() - Date.parse(state.recordedAt)),
		task_terminal_result: state.terminalResult,
		foreground_non_vault_work_allowed: true,
		// A background Completion Task was admitted: inspect_status splits by Task
		// kind to inspect_completion_task.
		next_action: action("inspect_status", "Inspect this task for durable progress.", {
			result_kind: "completion_task",
		}),
	});
	return emitPayload({ ...input, payload, success: true, errorCode: "" });
}

function emitBackgroundCapabilityReadFailure(
	input: EmitContext & {
		readonly invocation: VaultGitRuntimeInvocation & { readonly command: "complete" };
		readonly stderr: CliWriter;
	},
	phase: VaultGitTransactionPhase,
	blocker: "capability_missing" | "receipt_conflict",
): number {
	const payload = createVaultGitLifecycleResult({
		command: "complete",
		outcome: "refused",
		phase,
		write_permission: "denied",
		changed_state: "none",
		retry_safety: "operator_required",
		blockers: [blocker],
		transaction_id: input.invocation.transactionId,
		next_action: action("run_doctor"),
	});
	return emitPayload({ ...input, payload, success: false, errorCode: blocker });
}

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}

function spawnBackgroundWorker(
	composition: VaultGitCliComposition,
	receiptId: string,
	taskId: string,
	launchGeneration: string,
	args: readonly string[],
): number {
	const descriptor = 3;
	const capabilityFd = openSync(
		composition.store.capabilityPath(receiptId, "owner"),
		constants.O_RDONLY | constants.O_NOFOLLOW,
	);
	try {
		const stdio: Array<"ignore" | number> = ["ignore", "ignore", "ignore", capabilityFd];
		const child = spawn(
			process.execPath,
			[
				composition.privateEntrypointPath ?? CLI_PATH,
				...args,
				"--capability-fd",
				String(descriptor),
			],
			{
				cwd: composition.repositoryPath,
				env: {
					...projectVaultGitBackgroundWorkerEnvironment(process.env),
					VAULT_GIT_TASK_ID: taskId,
					VAULT_GIT_TASK_LAUNCH_GENERATION: launchGeneration,
				},
				stdio,
				detached: true,
			},
		);
		if (child.pid === undefined) throw new Error("background worker pid unavailable");
		child.unref();
		return child.pid;
	} finally {
		closeSync(capabilityFd);
	}
}

function isProcessAlive(pid: number | null): boolean {
	if (pid === null) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function stopUnacknowledgedWorker(pid: number): void {
	try {
		process.kill(-pid, "SIGTERM");
	} catch {
		// The child may already have exited. It never crossed the durable gate.
	}
}

/** Injectable process-identity sources used by portability tests. */
export interface VaultGitProcessIdentitySources {
	readonly platform?: NodeJS.Platform;
	readonly readLinuxProcStat?: (pid: number) => string;
	readonly readPsStart?: (pid: number, env: NodeJS.ProcessEnv) => string | null;
}

/**
 * Hash one PID with its OS-owned process start identity.
 * Linux prefers /proc start ticks; other hosts and restricted /proc use ps.
 */
export function readVaultGitProcessIdentity(
	pid: number,
	sources: VaultGitProcessIdentitySources = {},
): string {
	let started: string | null = null;
	if ((sources.platform ?? process.platform) === "linux") {
		try {
			const stat = (sources.readLinuxProcStat ?? ((candidatePid) =>
				readFileSync(`/proc/${candidatePid}/stat`, "utf8")))(pid);
			started = parseLinuxProcessStartTicks(stat);
		} catch {
			// Restricted or racing /proc falls back to the portable ps contract.
		}
	}
	if (started === null) {
		const environment = { ...process.env, LC_ALL: "C" };
		started = (sources.readPsStart ?? readPsProcessStart)(pid, environment);
	}
	if (started === null || started.length === 0) {
		throw new Error("background worker identity unavailable");
	}
	return createHash("sha256").update(`${pid}\0${started}`).digest("hex");
}

function parseLinuxProcessStartTicks(stat: string): string | null {
	const commandEnd = stat.lastIndexOf(")");
	if (commandEnd < 0) return null;
	// Fields after comm begin at field 3 (state); starttime is field 22.
	const fields = stat.slice(commandEnd + 1).trim().split(/\s+/);
	const startTicks = fields[19];
	return startTicks && /^\d+$/.test(startTicks) ? startTicks : null;
}

function readPsProcessStart(pid: number, env: NodeJS.ProcessEnv): string | null {
	const output = Bun.spawnSync(["/bin/ps", "-o", "lstart=", "-p", String(pid)], {
		env,
	});
	if (output.exitCode !== 0) return null;
	const started = output.stdout.toString().trim();
	return started.length > 0 ? started : null;
}

function processIdentityMatches(pid: number, expected: string): boolean {
	try {
		return isProcessAlive(pid) && readVaultGitProcessIdentity(pid) === expected;
	} catch {
		return false;
	}
}

async function stopExpiredUnacknowledgedWorker(
	pid: number | null,
	expectedIdentity: string | null,
): Promise<boolean> {
	if (pid === null || expectedIdentity === null) return true;
	if (!processIdentityMatches(pid, expectedIdentity)) return true;
	stopUnacknowledgedWorker(pid);
	const gracefulDeadline = performance.now() + 250;
	while (processIdentityMatches(pid, expectedIdentity) && performance.now() < gracefulDeadline) {
		await Bun.sleep(10);
	}
	if (!processIdentityMatches(pid, expectedIdentity)) return true;
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		// A concurrent retry may have observed the same exact process exit.
	}
	const forcedDeadline = performance.now() + 500;
	while (processIdentityMatches(pid, expectedIdentity) && performance.now() < forcedDeadline) {
		await Bun.sleep(10);
	}
	return !processIdentityMatches(pid, expectedIdentity);
}

const DEFAULT_BACKGROUND_COMPLETION_RUNTIME: VaultGitBackgroundCompletionRuntime = {
	now: () => performance.now(),
	sleep: (milliseconds) => Bun.sleep(milliseconds),
	spawnWorker: spawnBackgroundWorker,
	readProcessIdentity: readVaultGitProcessIdentity,
	stopUnacknowledgedWorker,
	stopExpiredWorker: stopExpiredUnacknowledgedWorker,
};

const BACKGROUND_WORKER_ENVIRONMENT_NAMES = [
	"HOME",
	"LANG",
	"LC_ALL",
	"PATH",
	"TMPDIR",
	"USER",
	"XDG_CONFIG_HOME",
	"XDG_STATE_HOME",
	"VAULT_GIT_ACTOR",
	"VAULT_GIT_ALLOWED_REMOTE_HOSTS",
	"VAULT_GIT_CHECK_REPOSITORY_PATH",
	"VAULT_GIT_CONFIG_PATH",
	"VAULT_GIT_GIT_BINARY_PATH",
	"VAULT_GIT_HOST",
	"VAULT_GIT_REMOTE",
	"VAULT_GIT_REPOSITORY_IDENTITY",
	"VAULT_GIT_REPOSITORY_PATH",
	"VAULT_GIT_SSH_BINARY_PATH",
	"VAULT_GIT_SSH_IDENTITY_FILE_PATH",
	"VAULT_GIT_SSH_KNOWN_HOSTS_PATH",
	"VAULT_GIT_SSH_PUBLIC_KEY_PATH",
	"VAULT_GIT_STATE_ROOT",
] as const;

/**
 * Process-fixture controls. These redirect git resolution, child behaviour, and
 * engine interruption, so a worker holding an owner capability must admit them
 * only when the fixture harness explicitly opts in. Never add one of these to
 * BACKGROUND_WORKER_ENVIRONMENT_NAMES: that list is forwarded unconditionally.
 */
const BACKGROUND_WORKER_TEST_ENVIRONMENT_NAMES = [
	"VAULT_GIT_CHECK_LOG",
	"VAULT_GIT_CHECK_MARKER",
	"VAULT_GIT_REAL_GIT",
	"VAULT_GIT_SHIM_LOG",
	"VAULT_GIT_SHIM_MARKER",
	"VAULT_GIT_SHIM_MODE",
	"VAULT_GIT_TEST_INTERRUPT_GATE",
	"VAULT_GIT_TEST_INTERRUPT_POINT",
	"VAULT_GIT_TEST_PRIVATE_CHILD_MODE",
] as const;

/**
 * Explicit opt-in a fixture sets to admit test controls into a detached worker.
 * @internal
 */
export const VAULT_GIT_TEST_HARNESS_ENVIRONMENT_NAME = "VAULT_GIT_TEST_HARNESS";

/** Project the exact non-secret environment admitted to a detached worker. @internal */
export function projectVaultGitBackgroundWorkerEnvironment(
	source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
	const scrubbed: NodeJS.ProcessEnv = {};
	for (const name of BACKGROUND_WORKER_ENVIRONMENT_NAMES) {
		const value = source[name];
		if (value !== undefined) scrubbed[name] = value;
	}
	if (source[VAULT_GIT_TEST_HARNESS_ENVIRONMENT_NAME] !== "1") return scrubbed;
	scrubbed[VAULT_GIT_TEST_HARNESS_ENVIRONMENT_NAME] = "1";
	for (const name of BACKGROUND_WORKER_TEST_ENVIRONMENT_NAMES) {
		const value = source[name];
		if (value !== undefined) scrubbed[name] = value;
	}
	return scrubbed;
}

type RuntimeResult =
	| { readonly kind: "engine"; readonly value: VaultGitEngineResult }
	| { readonly kind: "task"; readonly value: import("./model.ts").VaultGitTaskState }
	| { readonly kind: "task_missing"; readonly taskId: string }
	| { readonly kind: "task_corrupt"; readonly taskId: string }
	| {
			readonly kind: "doctor_projection";
			readonly value: VaultGitDoctorFrontDoorProjection;
	  }
	| { readonly kind: "doctor"; readonly value: VaultGitDoctorResult }
	| { readonly kind: "repair"; readonly value: VaultGitRepairResult }
	| { readonly kind: "janitor"; readonly value: VaultGitJanitorReport }
	| {
			readonly kind: "activation";
			readonly value: VaultGitActivationFrontDoorResult;
			readonly success: boolean;
			readonly errorCode?: string;
	  };

async function executeInvocation(
	invocation: VaultGitRuntimeInvocation,
	composition: VaultGitCliComposition,
	readCapability: (descriptor: number) => Promise<Uint8Array>,
	humanActivationReview: VaultGitHumanActivationReviewPort,
	taskLifecycleDispatch: VaultGitTaskLifecycleDispatch,
	environment: NodeJS.ProcessEnv,
	now: () => number,
): Promise<RuntimeResult> {
	switch (invocation.command) {
		case "begin":
			return {
				kind: "engine",
				value: await composition.engine.begin({
					event: requirePresent(invocation.event, "begin event"),
					requestedPaths: invocation.paths,
					remote: composition.remote,
					leaseDurationMs: composition.leaseDurationMs,
				}),
			};
		case "join":
			return {
				kind: "engine",
				value: await composition.engine.join({
					transactionId: requirePresent(
						invocation.transactionId,
						"join transaction",
					),
					requestedPaths: invocation.paths,
					remote: composition.remote,
					capability: await readInvocationCapability(
						invocation.capabilityFd,
						readCapability,
					),
				}),
			};
		case "complete":
			if (taskLifecycleDispatch.role === "worker") {
				return {
					kind: "engine",
					value: await executeBackgroundWorkerCompletion(
						invocation as VaultGitRuntimeInvocation & { readonly command: "complete" },
						composition,
						readCapability,
						taskLifecycleDispatch,
					),
				};
			}
			return {
				kind: "engine",
				value: await composition.engine.complete({
					transactionId: requirePresent(
						invocation.transactionId,
						"complete transaction",
					),
					remote: composition.remote,
					capability: await readInvocationCapability(
						invocation.capabilityFd,
						readCapability,
					),
					summary: invocation.summary,
				}),
			};
		case "status":
			if (invocation.taskId) {
				const loaded = await requireTaskStore(composition).loadByTaskId(invocation.taskId);
				if (loaded.status === "absent") {
					return { kind: "task_missing", taskId: invocation.taskId };
				}
				if (loaded.status === "corrupt") {
					return { kind: "task_corrupt", taskId: invocation.taskId };
				}
				return { kind: "task", value: loaded.state };
			}
			return { kind: "engine", value: await composition.engine.inspect() };
		case "activation":
			return executeActivationInvocation(
				invocation,
				composition,
				humanActivationReview,
			);
		case "preview":
			// Preview honors its transaction selector: naming another
			// transaction refuses with transaction_mismatch instead of echoing
			// the current transaction's state.
			return {
				kind: "engine",
				value: await composition.engine.inspect(
					invocation.transactionId === undefined
						? {}
						: { transactionId: invocation.transactionId },
				),
			};
		case "doctor":
			{
				if (invocation.taskId) {
					return {
						kind: "doctor_projection",
						value: await composeVaultGitDoctorFrontDoor(
							composition,
							now,
							environment,
						).inspectDoctorTask({ taskId: invocation.taskId }),
					};
				}
				const taskId = environment[VAULT_GIT_DOCTOR_TASK_ID_ENV];
				const launchGeneration =
					environment[VAULT_GIT_DOCTOR_TASK_LAUNCH_GENERATION_ENV];
				const doctorInvocation = invocation as VaultGitRuntimeInvocation & {
					readonly command: "doctor";
				};
				const value =
					taskId && launchGeneration
						? await composeVaultGitDoctorFrontDoor(
								composition,
								now,
								environment,
							).runWorker({
								taskId,
								launchGeneration,
								workerPid: process.pid,
								diagnose: () =>
									executeAuthoritativeDoctor(doctorInvocation, composition),
							})
						: await executeAuthoritativeDoctor(
								doctorInvocation,
								composition,
							);
				return {
					kind: "doctor",
					value,
				};
			}
		case "repair": {
			const action = requirePresent(invocation.repairAction, "repair action");
			const privateBytes = await readInvocationCapability(
				invocation.capabilityFd,
				readCapability,
			);
			let expectedLedgerGeneration: string | undefined;
			if (action === "stale-lease-takeover") {
				const doctor = await composition.engine.doctor({
						transactionId: invocation.transactionId,
						issueTakeoverToken: false,
					});
				if (
					doctor.repairAction === "stale-lease-takeover" &&
					doctor.ledgerGeneration
				) {
					const proof = await composition.store.readDoctorProof(
						requirePresent(invocation.transactionId, "repair transaction"),
						doctor.ledgerGeneration,
					);
					expectedLedgerGeneration = proof.ledgerGeneration;
				}
			}
			if (action === "resume") {
				const incompatible = await incompatibleRepairTaskRefusal(
					composition,
					invocation.transactionId,
				);
				// Refuse BEFORE engine.repair. Repair moves the Transaction Receipt to
				// writing, but a legacy task cannot accept revision-bound authorization,
				// so authorizing after the mutation would strand the transaction with a
				// writing receipt and no Repair Authorization.
				if (incompatible) return { kind: "repair", value: incompatible };
			}
			const value = await composition.engine.repair({
				action,
				transactionId: invocation.transactionId,
				remote: composition.remote,
				...(action === "stale-lease-takeover"
					? {
						doctorToken: privateBytes,
						expectedLedgerGeneration,
						priorWriterStopped: invocation.priorWriterStopped,
					}
					: { capability: privateBytes }),
			});
			if (action === "resume") {
				composition.runtime.interrupt(
					"after_repair_receipt_before_task_authorization",
				);
				await authorizeTaskRepairForWritingReceipt(
					composition,
					invocation.transactionId,
					value,
				);
			}
			await reconcileTaskClosure(composition, value).catch(() => undefined);
			return {
				kind: "repair",
				value,
			};
		}
		case "tidy":
			return {
				kind: "janitor",
				value: await composition.janitor.run({ trigger: "tidy_now" }),
			};
		case "janitor":
			return {
				kind: "janitor",
				value: await composition.janitor.run({ trigger: "nightly" }),
			};
	}
}

/**
 * Fail-closed compatibility gate run BEFORE `engine.repair` for `repair resume`.
 *
 * A Completion Task persisted by schema 1, or by schema 2 before the
 * receiptRevision field existed, normalizes receiptRevision to null. Such a task
 * stays inspectable but can never accept revision-bound Repair Authorization.
 * Repairing first would advance the Transaction Receipt to writing and only then
 * discover the task cannot be authorized, stranding the transaction. Returning a
 * named refusal here leaves the receipt byte-identical and publishes nothing.
 *
 * @returns One `receipt_conflict` refusal, or null when repair may proceed
 */
async function incompatibleRepairTaskRefusal(
	composition: VaultGitCliComposition,
	transactionId: string | undefined,
): Promise<VaultGitRepairResult | null> {
	const taskStore = composition.taskStore;
	if (!taskStore) return null;
	const receipt = await composition.store.load();
	if (receipt.status !== "loaded") return null;
	if (
		transactionId !== undefined &&
		receipt.receipt.transactionId !== transactionId
	) return null;
	const loaded = await taskStore.load(receipt.receipt.receiptId);
	// An absent task keeps the existing non-task repair path; only a present but
	// revision-incompatible task blocks the mutation.
	if (loaded.status !== "loaded" || loaded.state.receiptRevision !== null) {
		return null;
	}
	return {
		status: "refused",
		action: "resume",
		// The gate refuses before any classification, so it claims no reconciled
		// transaction state; the durable receipt phase is reported unchanged.
		state: "unknown",
		phase: receipt.receipt.phase,
		changedState: "none",
		retrySafety: "operator_required",
		blocker: "receipt_conflict",
		nextAction: {
			id: "request_operator_review",
			summary:
				"Ask an operator to review the legacy completion task before repair.",
		},
		...(receipt.receipt.transactionId
			? { transactionId: receipt.receipt.transactionId }
			: {}),
		diagnosticsReference: receipt.receipt.diagnosticsReference,
	};
}

async function authorizeTaskRepairForWritingReceipt(
	composition: VaultGitCliComposition,
	transactionId: string | undefined,
	result: VaultGitRepairResult,
): Promise<void> {
	if (
		!composition.taskStore ||
		result.status !== "repaired" ||
		result.state !== "active" ||
		result.phase !== "writing" ||
		!transactionId
	) return;
	const receipt = await composition.store.load();
	if (
		receipt.status !== "loaded" ||
		receipt.receipt.phase !== "writing" ||
		receipt.receipt.transactionId !== transactionId ||
		receipt.receipt.leaseGeneration === null
	) {
		throw new Error("repaired receipt unavailable for task authorization");
	}
	const authorization = await composition.taskStore.authorizeRepair({
		receiptId: receipt.receipt.receiptId,
		transactionId,
		leaseGeneration: receipt.receipt.leaseGeneration,
		repairedReceiptRevision: receipt.receipt.revision,
		recordedAt: composition.runtime.now().toISOString(),
	});
	if (authorization.status === "refused") {
		throw new Error("repaired task authorization refused");
	}
}

async function executeAuthoritativeDoctor(
	invocation: VaultGitRuntimeInvocation & { readonly command: "doctor" },
	composition: VaultGitCliComposition,
): Promise<VaultGitDoctorResult> {
	const value = await composition.engine.doctor({
		transactionId: invocation.transactionId,
		issueTakeoverToken: false,
	});
	await reconcileTaskClosure(composition, value).catch(() => undefined);
	await reconcileStaleTaskAfterDoctor(composition, value).catch(() => undefined);
	return value;
}

async function executeBackgroundWorkerCompletion(
	invocation: VaultGitRuntimeInvocation & { readonly command: "complete" },
	composition: VaultGitCliComposition,
	readCapability: (descriptor: number) => Promise<Uint8Array>,
	taskLifecycleDispatch: Extract<
		VaultGitTaskLifecycleDispatch,
		{ readonly role: "worker" }
	>,
): Promise<VaultGitEngineResult> {
	const taskStore = requireTaskStore(composition);
	const { taskId, launchGeneration } = taskLifecycleDispatch;
	const taskLifecycle = createVaultGitTaskLifecycle({
		role: taskLifecycleDispatch.role,
		store: taskStore,
		runtime: DEFAULT_BACKGROUND_COMPLETION_RUNTIME,
		spawnContext: composition,
		recordedAt: () => composition.runtime.now(),
	});
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	try {
		const worker = createVaultGitCliTaskWorker({
			engine: composition.engine,
			now: () => composition.runtime.now(),
			readCapability: (descriptor) => readCapability(descriptor),
			acknowledge: async (acknowledgement) => {
				let loaded = await taskStore.loadByTaskId(acknowledgement.taskId);
				const registrationDeadline =
					performance.now() + VAULT_GIT_LAUNCH_ACK_WINDOW_MS;
				while (
					loaded.status === "loaded" &&
					loaded.state.state === "launching" &&
					loaded.state.launchGeneration === acknowledgement.launchGeneration &&
					loaded.state.workerPid === null &&
					performance.now() < registrationDeadline
				) {
					await Bun.sleep(10);
					loaded = await taskStore.loadByTaskId(acknowledgement.taskId);
				}
				if (
					loaded.status !== "loaded" ||
					loaded.state.state !== "launching" ||
					loaded.state.launchGeneration !== acknowledgement.launchGeneration ||
					loaded.state.workerPid !== process.pid ||
					loaded.state.workerProcessIdentity === null
				) return { schemaVersion: 1, status: "stale" };
				const transitioned = await taskStore.transition(
					loaded.state.taskId,
					loaded.state.revision,
					{
						state: "in_progress",
						phase: "running",
						updatedAt: acknowledgement.acknowledgedAt,
						heartbeatAt: acknowledgement.acknowledgedAt,
						checkpoint: "checking",
						launchGeneration: acknowledgement.launchGeneration,
						launchExpiresAt: null,
						workerPid: process.pid,
						workerProcessIdentity: loaded.state.workerProcessIdentity,
					},
				);
				return transitioned.status === "transitioned"
					? {
						schemaVersion: 1,
						status: "transitioned",
						acknowledgement: parseVaultGitTaskWorkerAcknowledgement({
							schemaVersion: 1,
							...acknowledgement,
						}),
					}
					: { schemaVersion: 1, status: "stale" };
			},
			onAcknowledged: () => {
				heartbeat = setInterval(() => {
					void updateTaskHeartbeat(
						taskStore,
						composition.store,
						taskId,
						launchGeneration,
						() => composition.runtime.now(),
					);
				}, 5_000);
				heartbeat.unref();
			},
		});
		const { result } = await worker.run({
			launch: "winner",
			taskId,
			launchGeneration,
			capabilityDescriptor: requirePresent(invocation.capabilityFd, "capability descriptor"),
			transactionId: requirePresent(invocation.transactionId, "complete transaction"),
			remote: composition.remote,
			summary: invocation.summary,
		});
		const terminalState =
			result.status === "completed"
				? "closed"
				: result.phase === "push_pending" || result.changedState === "partial"
					? "unknown"
					: "repair_needed";
		await taskLifecycle.terminalize({
			taskId,
			advance: {
				state: terminalState,
				phase: "terminal",
				updatedAt: composition.runtime.now().toISOString(),
				heartbeatAt: composition.runtime.now().toISOString(),
				checkpoint: result.phase,
				launchGeneration,
				launchExpiresAt: null,
				workerPid: process.pid,
				terminalResult: {
					outcome:
						result.status === "inspected" ? "read_only" : result.status,
					phase: result.phase,
					changedState: result.changedState,
					blocker: result.blocker ?? null,
					retrySafety: result.retrySafety,
					...(result.validationFailure
						? { validationFailure: result.validationFailure }
						: {}),
				},
			},
			fence: { expectedLaunchGeneration: launchGeneration },
		});
		return result;
	} catch (error) {
		await taskLifecycle
			.terminalize({
				taskId,
				advance: {
					state: "repair_needed",
					phase: "terminal",
					updatedAt: composition.runtime.now().toISOString(),
					heartbeatAt: composition.runtime.now().toISOString(),
					checkpoint: "checking",
					launchGeneration,
					launchExpiresAt: null,
					workerPid: process.pid,
					terminalResult: {
						outcome: "refused",
						phase: "checking",
						changedState: "none",
						blocker: "human_required",
						retrySafety: "operator_required",
					},
				},
				fence: { expectedLaunchGeneration: launchGeneration },
			})
			.catch(() => undefined);
		throw error;
	} finally {
		if (heartbeat) clearInterval(heartbeat);
	}
}

async function reconcileTaskClosure(
	composition: VaultGitCliComposition,
	result: VaultGitDoctorResult | VaultGitRepairResult,
): Promise<void> {
	if (!composition.taskStore || result.state !== "closed" || result.phase !== "closed") return;
	const receipt = await composition.store.load();
	if (
		receipt.status !== "loaded" ||
		receipt.receipt.phase !== "closed" ||
		!receipt.receipt.transactionId
	) return;
	await reconcileClosedVaultGitTask(composition.taskStore, {
		receiptId: receipt.receipt.receiptId,
		transactionId: receipt.receipt.transactionId,
		changedState: result.changedState,
		recordedAt: composition.runtime.now().toISOString(),
	});
}

async function reconcileStaleTaskAfterDoctor(
	composition: VaultGitCliComposition,
	result: VaultGitDoctorResult,
): Promise<void> {
	if (!composition.taskStore || !result.transactionId || result.state === "closed") return;
	const receipt = await composition.store.load();
	if (
		receipt.status !== "loaded" ||
		receipt.receipt.transactionId !== result.transactionId
	) return;
	await reconcileStaleVaultGitTaskFromDoctor(
		composition.taskStore,
		receipt.receipt.receiptId,
		result,
		composition.runtime.now().toISOString(),
		isProcessAlive,
	);
}

async function updateTaskHeartbeat(
	store: VaultGitTaskStore,
	receiptStore: VaultGitReceiptStore,
	taskId: string,
	launchGeneration: string,
	now: () => Date,
): Promise<void> {
	const current = await store.loadByTaskId(taskId);
	if (
		current.status !== "loaded" ||
		current.state.state !== "in_progress" ||
		current.state.launchGeneration !== launchGeneration
	) return;
	const receipt = await receiptStore.load();
	const checkpoint =
		receipt.status === "loaded" &&
		receipt.receipt.transactionId === current.state.transactionId
			? receipt.receipt.phase
			: current.state.checkpoint;
	const recordedAt = now().toISOString();
	await store.transition(taskId, current.state.revision, {
		state: "in_progress",
		phase: "running",
		updatedAt: recordedAt,
		heartbeatAt: recordedAt,
		checkpoint,
		launchGeneration,
		launchExpiresAt: null,
		workerPid: current.state.workerPid,
		workerProcessIdentity: current.state.workerProcessIdentity,
	}).catch(() => undefined);
}

function requireTaskStore(composition: VaultGitCliComposition): VaultGitTaskStore {
	if (!composition.taskStore) throw new Error("background task store unavailable");
	return composition.taskStore;
}

function requireDoctorTaskStore(
	composition: VaultGitCliComposition,
): VaultGitDoctorTaskStore {
	if (!composition.doctorTaskStore) {
		throw new Error("Background Doctor task store unavailable");
	}
	return composition.doctorTaskStore;
}

async function executeActivationInvocation(
	invocation: VaultGitRuntimeInvocation,
	composition: VaultGitCliComposition,
	humanReview: VaultGitHumanActivationReviewPort,
): Promise<Extract<RuntimeResult, { readonly kind: "activation" }>> {
	const frontDoor = composition.activationFrontDoor;
	if (!frontDoor) {
		const missing = composition.activationConfigurationMissing ?? [];
		const cause = missing.length > 0
			? "configuration_missing"
			: "revalidation_unavailable";
		return activationRuntimeResult(
			projectVaultGitActivationRestrictionJson(
				createVaultGitActivationRestriction({
					stoppedAction: activationStoppedAction(invocation),
					cause,
					...(cause === "configuration_missing"
						? { missingConfiguration: missing }
						: {}),
				}),
			),
			invocation.activationAction === "inspect",
		);
	}
	const action = invocation.activationAction ?? "inspect";
	if (action === "inspect") {
		return activationRuntimeResult(await frontDoor.inspect(), true);
	}
	if (action === "prepare") {
		const result = await frontDoor.prepare();
		return activationRuntimeResult(result, result.status !== "restricted");
	}
	const evidenceReference = requirePresent(
		invocation.evidenceReference,
		"activation evidence reference",
	);
	if (invocation.noInput || !humanReview.isInteractive()) {
		return activationRuntimeResult(humanCapabilityRestriction(action), false);
	}
	const decision = await humanReview.decide({
		action,
		evidenceReference,
		result: await frontDoor.inspect(),
	});
	if (
		(action === "review" && decision !== "activate" && decision !== "defer") ||
		(action === "defer" && decision !== "defer") ||
		(action === "revoke" && decision !== "revoke")
	) {
		return activationRuntimeResult(humanCapabilityRestriction(action), false);
	}
	const result =
		action === "revoke"
			? await frontDoor.revoke({ evidenceReference })
			: await frontDoor.review({
					evidenceReference,
					decision: action === "defer" ? "defer" : decision as "activate" | "defer",
				});
	return activationRuntimeResult(result, result.status !== "restricted");
}

function activationRuntimeResult(
	value: VaultGitActivationFrontDoorResult,
	success: boolean,
): Extract<RuntimeResult, { readonly kind: "activation" }> {
	return {
		kind: "activation",
		value,
		success,
		...(success || value.status !== "restricted"
			? {}
			: { errorCode: value.cause.id }),
	};
}

function humanCapabilityRestriction(
	action: VaultGitHumanActivationReviewAction,
): VaultGitActivationFrontDoorResult {
	return projectVaultGitActivationRestrictionJson(
		createVaultGitActivationRestriction({
			stoppedAction:
				action === "revoke"
					? "activation_revocation"
					: "activation_admission",
			cause: "human_capability_required",
		}),
	);
}

function activationStoppedAction(
	invocation: ParsedVaultGitInvocation,
): "activation_preparation" | "activation_admission" | "activation_revocation" {
	if (invocation.activationAction === "prepare") return "activation_preparation";
	if (invocation.activationAction === "revoke") return "activation_revocation";
	return "activation_admission";
}

function requirePresent<T>(value: T | undefined, label: string): T {
	if (value === undefined) throw new Error(`${label} is unavailable`);
	return value;
}

async function readInvocationCapability(
	descriptor: number | undefined,
	readCapability: (descriptor: number) => Promise<Uint8Array>,
): Promise<Uint8Array> {
	return descriptor === undefined
		? new Uint8Array()
		: readCapability(descriptor);
}

function emitDiscovery(input: EmitContext): number {
	const payload = createVaultGitLifecycleResult({
		command: "commands",
		outcome: "discovered",
		// Successful non-transactional reads share the phase status emits when
		// no transaction exists; "unavailable" stays refusal vocabulary.
		phase: "blocked",
		write_permission: "denied",
		changed_state: "none",
		retry_safety: "same_input_safe",
		blockers: [],
		next_action: action("inspect_commands"),
	});
	const data = createCommandResultData(vaultGitContracts.commands, {
		...payload,
		commands: projectVaultGitCommandDiscoveryTree().commands,
	});
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data,
			...facadeAffordances(payload.next_action),
		}),
		envelopeRuntime(input),
	);
	return 0;
}

function emitUnconfigured(input: EmitContext & {
	readonly invocation: VaultGitRuntimeInvocation;
	readonly stderr: CliWriter;
}): number {
	const readOnly = ["status", "preview", "doctor"].includes(
		input.invocation.command,
	);
	const payload = createVaultGitLifecycleResult({
		command: input.invocation.command,
		outcome: readOnly ? "read_only" : "refused",
		phase: "blocked",
		write_permission: "denied",
		changed_state: "none",
		retry_safety: "same_input_unsafe",
		blockers: ["vault_unconfigured"],
		next_action: action("inspect_configured_vault"),
	});
	return emitPayload({
		...input,
		payload,
		success: readOnly,
		errorCode: "vault_unconfigured",
	});
}

function emitActivationUnavailable(input: EmitContext & {
	readonly invocation: VaultGitRuntimeInvocation;
	readonly stderr: CliWriter;
}): number {
	const readOnly = ["status", "preview", "doctor"].includes(
		input.invocation.command,
	);
	const restriction = createVaultGitActivationRestriction({
		stoppedAction: "vault_write",
		cause: "revalidation_unavailable",
	});
	const payload = createVaultGitLifecycleResult({
		command: input.invocation.command,
		outcome: readOnly ? "read_only" : "refused",
		phase: "blocked",
		write_permission: "denied",
		changed_state: "none",
		retry_safety: "same_input_safe",
		blockers: ["activation_blocked"],
		next_action: action(restriction.nextAction.id),
		activation_restriction:
			projectVaultGitActivationRestrictionJson(restriction),
	});
	return emitPayload({
		...input,
		payload,
		success: readOnly,
		errorCode: "activation_blocked",
	});
}

function emitPrivateStateConflict(input: EmitContext & {
	readonly invocation: VaultGitRuntimeInvocation;
	readonly stderr: CliWriter;
}): number {
	const readOnly = ["status", "preview", "doctor"].includes(
		input.invocation.command,
	);
	const payload = createVaultGitLifecycleResult({
		command: input.invocation.command,
		outcome: readOnly ? "read_only" : "refused",
		phase: "human_required",
		write_permission: "denied",
		changed_state: "none",
		retry_safety: "operator_required",
		blockers: ["receipt_conflict"],
		next_action: action("inspect_private_receipt"),
	});
	return emitPayload({
		...input,
		payload,
		success: readOnly,
		errorCode: "receipt_conflict",
	});
}

function emitRuntimeResult(input: EmitContext & {
	readonly invocation: VaultGitRuntimeInvocation;
	readonly result: RuntimeResult;
	readonly stderr: CliWriter;
}): number {
	if (input.result.kind === "activation") {
		return emitActivationRuntimeResult({ ...input, result: input.result });
	}
	if (input.invocation.command === "activation") {
		throw new Error("activation invocation returned a lifecycle result");
	}
	if (input.result.kind === "doctor_projection") {
		// The deep Doctor owner already projected payload, success, and error
		// code; the adapter only renders.
		return emitPayload({ ...input, ...input.result.value });
	}
	const payload = payloadForRuntime(
		input.invocation.command,
		input.result,
		input.now(),
		input.invocation.transactionId,
	);
	const success =
		input.result.kind === "engine"
			? input.result.value.status !== "refused"
			: input.result.kind === "task"
				? true
				: input.result.kind === "task_missing" ||
						input.result.kind === "task_corrupt"
					? false
			: input.result.kind === "doctor"
				? true
				: input.result.kind === "repair"
					? input.result.value.status === "repaired"
					: input.result.value.status !== "refused";
	const errorCode = payload.blockers[0] ?? "runtime_unavailable";
	return emitPayload({ ...input, payload, success, errorCode });
}

function emitActivationRuntimeResult(input: EmitContext & {
	readonly invocation: VaultGitRuntimeInvocation;
	readonly result: Extract<RuntimeResult, { readonly kind: "activation" }>;
	readonly stderr: CliWriter;
}): number {
	const next = input.result.value.next_action;
	const affordances = facadeAffordances(next);
	const errorCode = input.result.errorCode ?? "activation_restricted";
	if (input.invocation.json) {
		const envelope = input.result.success
			? createCliRuntimeSuccessEnvelope({
					run_id: input.runId,
					data: input.result.value,
					...affordances,
				})
			: createCliRuntimeErrorEnvelope({
					run_id: input.runId,
					process_exit_code: 1,
					error: activationRuntimeError(input.runId, errorCode),
					data: input.result.value,
					...affordances,
				});
		writeJsonEnvelope(input.stdout, envelope, envelopeRuntime(input));
	} else if (input.result.success) {
		input.stdout.write(renderVaultGitActivationResult(input.result.value));
	} else {
		input.stderr.write(renderVaultGitActivationResult(input.result.value));
	}
	return input.result.success ? 0 : 1;
}

function activationRuntimeError(runId: string, code: string) {
	const common = {
		run_id: runId,
		code,
		message: "Activation stopped at its guarded human or evidence boundary.",
		exit_code: 1,
	} as const;
	if (
		code === "configuration_missing" ||
		code === "admission_missing" ||
		code === "revalidation_unavailable"
	) {
		return createCliRetryRuntimeError(common);
	}
	if (
		code === "evidence_changed" ||
		code === "binding_changed" ||
		code === "invalidated"
	) {
		return createCliRepairStateRuntimeError(common);
	}
	return createCliRuntimeError({
		...common,
		recoverability: "contact_support",
		retryable: false,
	});
}

type RuntimePayload = VaultGitLifecycleResultPayload & {
	readonly janitor_report?: ReturnType<typeof projectJanitorReport>;
	readonly worker_eligibility?: ReturnType<typeof projectWorkerEligibility>;
};

function payloadForRuntime(
	command: Exclude<VaultGitCommand, "activation">,
	result: Exclude<
		RuntimeResult,
		{ readonly kind: "activation" } | { readonly kind: "doctor_projection" }
	>,
	now: number,
	invocationTransactionId?: string,
): RuntimePayload {
	if (result.kind === "task_missing") {
		return createVaultGitLifecycleResult({
			command,
			outcome: "refused",
			phase: "checking",
			write_permission: "denied",
			changed_state: "none",
			retry_safety: "same_input_safe",
			blockers: ["task_not_found"],
			task_id: result.taskId,
			foreground_non_vault_work_allowed: true,
			// Correcting a missing Completion Task id: change_input splits by Task kind
			// to correct_completion_task_id.
			next_action: action("change_input", "Use the opaque task ID returned by complete.", {
				result_kind: "completion_task",
			}),
		});
	}
	if (result.kind === "task_corrupt") {
		return createVaultGitLifecycleResult({
			command,
			outcome: "refused",
			phase: "human_required",
			write_permission: "denied",
			changed_state: "none",
			retry_safety: "operator_required",
			blockers: ["receipt_corrupt"],
			task_id: result.taskId,
			foreground_non_vault_work_allowed: true,
			next_action: action("inspect_private_receipt"),
		});
	}
	if (result.kind === "task") {
		const value = result.value;
		const stale =
			value.state === "in_progress" &&
			value.heartbeatAt !== null &&
			now - Date.parse(value.heartbeatAt) > VAULT_GIT_TASK_HEARTBEAT_STALE_MS;
		const nextAction =
			value.state === "closed"
				? action("none")
				: value.state === "repair_needed" || value.state === "unknown" || stale
					? action("run_doctor")
					: action(
							"inspect_status",
							"Inspect this task again for durable progress.",
							// Legacy inspect_status splits by Task kind: this is a Completion
							// Task, so the authoritative union is inspect_completion_task.
							{ result_kind: "completion_task" },
						);
		return createVaultGitLifecycleResult({
			command,
			outcome: value.terminalResult?.outcome ?? (value.state === "closed" ? "completed" : "read_only"),
			phase: value.checkpoint ?? (value.state === "claimed" || value.state === "launching" ? "writing" : "checking"),
			write_permission: "denied",
			changed_state: value.terminalResult?.changedState ?? "none",
			retry_safety: value.terminalResult?.retrySafety ?? "same_input_safe",
			blockers: value.terminalResult?.blocker ? [value.terminalResult.blocker] : [],
			transaction_id: value.transactionId,
			task_id: value.taskId,
			task_attempt_number: value.attemptNumber,
			task_previous_failure: value.previousTerminalResult,
			lease_generation: value.leaseGeneration,
			task_state: value.state,
			task_phase: value.phase,
			task_heartbeat_at: value.heartbeatAt,
			task_checkpoint: value.checkpoint,
			task_elapsed_ms: Math.max(0, now - Date.parse(value.recordedAt)),
			task_terminal_result: value.terminalResult,
			foreground_non_vault_work_allowed: true,
			next_action: nextAction,
		});
	}
	if (result.kind === "engine") {
		const value = result.value;
		const nextAction =
			value.nextAction.id === "run_repair"
				? action("run_doctor")
				: action(
						value.nextAction.id,
						value.nextAction.summary,
						engineNextActionContext(command, value.nextAction.id),
					);
		const outcome =
			value.status === "inspected"
				? "read_only"
				: value.status === "advanced"
					? "advanced"
					: value.status;
		const payload = createVaultGitLifecycleResult({
			command,
			outcome,
			phase: value.phase,
			write_permission: value.writePermission,
			changed_state: value.changedState,
			retry_safety: value.retrySafety,
			blockers: value.blocker ? [value.blocker] : [],
			// A superseded/quarantined engine result omits its own transaction id, but
			// the invocation carried the exact one (e.g. host_quarantined ->
			// reconcile_quarantine needs it to build a runnable continuation). Fall back
			// to the invocation transaction id so the continuation does not fail closed.
			transaction_id: value.transactionId ?? invocationTransactionId,
			transaction_state: value.state,
			next_action: nextAction,
			...(value.activationRestriction
				? {
						activation_restriction:
							projectVaultGitActivationRestrictionJson(
								value.activationRestriction,
							),
					}
				: {}),
		});
		return command === "complete" && value.status === "completed"
			? { ...payload, worker_eligibility: projectWorkerEligibility() }
			: payload;
	}
	if (result.kind === "doctor") {
		const value = result.value;
		return createVaultGitLifecycleResult({
			command,
			outcome: "read_only",
			phase: value.phase,
			write_permission: "denied",
			changed_state: value.changedState,
			retry_safety: value.retrySafety,
			blockers: value.blocker ? [value.blocker] : [],
			transaction_id: value.transactionId,
			transaction_state: value.state,
			repair_action: value.repairAction,
			finding: value.finding,
			next_action: action(
				value.nextAction.id,
				value.nextAction.summary,
				engineNextActionContext(command, value.nextAction.id),
			),
			...(value.activationRestriction
				? {
						activation_restriction:
							projectVaultGitActivationRestrictionJson(
								value.activationRestriction,
							),
					}
				: {}),
		});
	}
	if (result.kind === "repair") {
		const value = result.value;
		// The engine's receipt-owned transaction identity is authoritative; the
		// caller's invocation selector is only a fallback and never overrides it.
		const repairTransactionId = value.transactionId ?? invocationTransactionId;
		return createVaultGitLifecycleResult({
			command,
			outcome: value.status,
			phase: value.phase,
			write_permission:
				value.status === "repaired" &&
				value.action === "resume" &&
				value.state === "active" &&
				value.phase === "writing" &&
				value.nextAction.id === "complete_transaction"
					? "owner"
					: "denied",
			changed_state: value.changedState,
			retry_safety: value.retrySafety,
			blockers: value.blocker ? [value.blocker] : [],
			transaction_state: value.state,
			// The repaired transaction id, so a continuation that binds it (e.g.
			// reconcile_quarantine) projects a real invoke rather than failing closed.
			...(repairTransactionId
				? { transaction_id: repairTransactionId }
				: {}),
			repair_action: value.action,
			next_action: action(
				value.nextAction.id,
				value.nextAction.summary,
				engineNextActionContext(command, value.nextAction.id),
			),
			...(value.activationRestriction
				? {
						activation_restriction:
							projectVaultGitActivationRestrictionJson(
								value.activationRestriction,
							),
					}
				: {}),
		});
	}
	const value = result.value;
	const privateChanged =
		value.privateHygiene.capabilityFiles > 0 ||
		value.privateHygiene.doctorTokenRecords > 0 ||
		value.privateHygiene.janitorReports > 0;
	// Preflight and transaction blockers take precedence; the skipped-repair
	// scan is the fallback and picks the first mappable reason, not index 0.
	const skippedBlocker = value.skippedRepairs
		.map((repair) =>
			repair.reason === "checker_unadmitted" ||
			repair.reason === "checker_changed" ||
			repair.reason === "checker_output_invalid"
				? repair.reason
				: repair.reason === "repair_refused"
					? ("checker_repair_refused" as const)
					: undefined,
		)
		.find((candidate) => candidate !== undefined);
	const blocker = value.blocker ?? skippedBlocker;
	// Acyclic recovery invariant (ADR-0002 U4): a Janitor refusal never points
	// back to Janitor. The transient remote outage becomes an operator-owned
	// prerequisite instead of a run_janitor self-loop.
	const janitorRemoteRetry = value.nextAction.id === "retry_remote";
	return {
		...createVaultGitLifecycleResult({
			command,
			outcome:
				value.status === "repaired"
					? "repaired"
					: value.status === "refused"
						? "refused"
						: "read_only",
			phase: value.status === "repaired" ? "closed" : "blocked",
			write_permission: "denied",
			changed_state:
				value.changedState !== undefined && value.changedState !== "none"
					? value.changedState
					: privateChanged
						? "local"
						: "none",
			retry_safety:
				value.status === "refused"
					? "operator_required"
					: value.skippedRepairs.length > 0
						? "same_input_unsafe"
						: "same_input_safe",
			blockers: blocker ? [blocker] : [],
			next_action: janitorRemoteRetry
				? action(
						"request_operator_review",
						"Restore remote access, then rerun the scheduled Janitor.",
					)
				: action(value.nextAction.id, value.nextAction.summary),
			...(value.activationRestriction
				? {
						activation_restriction:
							projectVaultGitActivationRestrictionJson(
								value.activationRestriction,
							),
					}
				: {}),
		}),
		janitor_report: projectJanitorReport(value),
		worker_eligibility: projectWorkerEligibility(
			value.trigger,
			value.vaultPosture === "read_only",
		),
	};
}

function projectJanitorReport(report: VaultGitJanitorReport) {
	return {
		status: report.status,
		trigger: report.trigger,
		stale_receipts: report.staleReceipts,
		lease_anomalies: report.leaseAnomalies,
		push_pending: report.pushPending,
		proposed_transaction_groups: report.proposedTransactionGroups.map(
			(group) => ({ files: group.files, repair_ids: group.repairIds }),
		),
		skipped_repairs: report.skippedRepairs.map((repair) => ({
			owner: repair.owner,
			finding_id: repair.findingId,
			repair_id: repair.repairId,
			reason: repair.reason,
		})),
		private_hygiene: {
			capability_files: report.privateHygiene.capabilityFiles,
			doctor_token_records: report.privateHygiene.doctorTokenRecords,
			janitor_reports: report.privateHygiene.janitorReports,
		},
		vault_posture: report.vaultPosture,
		foreground_non_vault_work_allowed:
			report.foregroundNonVaultWorkAllowed,
	};
}

function projectWorkerEligibility(
	trigger: "transaction_close" | "tidy_now" | "nightly" = "transaction_close",
	leaseHeld = false,
) {
	const decision = evaluateVaultGitWorkerPolicy({ trigger, leaseHeld });
	return {
		eligible: decision.eligible,
		trigger: decision.trigger,
		requires_new_transaction: decision.requiresNewTransaction,
		vault_posture: decision.vaultPosture,
		foreground_non_vault_work_allowed:
			decision.foregroundNonVaultWorkAllowed,
		next_action: decision.nextAction,
	};
}

interface EmitContext {
	readonly stdout: CliWriter;
	readonly runId: string;
	readonly startedAt: number;
	readonly now: () => number;
}

function emitPayload(input: EmitContext & {
	readonly invocation: VaultGitRuntimeInvocation;
	readonly stderr: CliWriter;
	readonly payload: VaultGitLifecycleResultPayload;
	readonly success: boolean;
	readonly errorCode: string;
}): number {
	const data = createCommandResultData(
		vaultGitContracts.status,
		input.payload,
	);
	const affordances = facadeAffordances(input.payload.next_action);
	if (input.invocation.json) {
		const envelope = input.success
			? createCliRuntimeSuccessEnvelope({
					run_id: input.runId,
					data,
					...affordances,
				})
			: createCliRuntimeErrorEnvelope({
					run_id: input.runId,
					process_exit_code: 1,
					error: runtimeError(
						input.runId,
						input.errorCode,
						input.payload.retry_safety,
					),
					data,
					...affordances,
				});
		writeJsonEnvelope(input.stdout, envelope, envelopeRuntime(input));
	} else if (input.success) {
		input.stdout.write(renderLifecycleResult(input.payload));
	} else {
		input.stderr.write(renderLifecycleResult(input.payload));
	}
	return input.success ? 0 : 1;
}

function runtimeError(
	runId: string,
	code: string,
	retrySafety: VaultGitLifecycleResultPayload["retry_safety"],
) {
	const common = {
		run_id: runId,
		code,
		message: `The transaction runtime refused this command with ${code}.`,
		exit_code: 1,
	} as const;
	if (retrySafety === "same_input_safe") {
		return createCliRetryRuntimeError(common);
	}
	if (retrySafety === "operator_required") {
		return createCliRuntimeError({
			...common,
			recoverability: "contact_support",
			retryable: false,
		});
	}
	return createCliRepairStateRuntimeError(common);
}

/**
 * Deterministic continuation context for an engine/doctor/repair-emitted action id
 * from the emitting command. The engine emits a small set of legacy contextual ids
 * (`inspect_status`, `retry_remote`, `change_owned_paths`, `run_repair`) whose
 * authoritative split is fixed by where they were produced:
 *  - inspect_status here is always a transaction/receipt-state inspection.
 *  - retry_remote is a begin retry from `begin`, else an inspect-time remote retry.
 *  - change_owned_paths is a begin correction from `begin`, else a join correction.
 *  - run_repair carries its repair action through the payload (repair_action), so it
 *    needs no context here.
 * A non-contextual id returns undefined and projects directly.
 */
function engineNextActionContext(
	command: VaultGitCommand,
	id: VaultGitNextActionId,
): VaultGitNextActionRef["context"] {
	switch (id) {
		case "inspect_status":
			return { result_kind: "transaction_receipt" };
		case "retry_remote":
			return { result_kind: command === "begin" ? "begin" : "inspect" };
		case "change_owned_paths":
			return { emission_command: command === "join" ? "join" : "begin" };
		default:
			return undefined;
	}
}

function runtimeAction(input: {
	readonly id: VaultGitNextActionId;
	readonly summary: string;
}): RuntimeActionGuidance {
	const declared = vaultGitActions.find(({ id }) => id === input.id);
	return {
		id: input.id,
		summary: input.summary,
		side_effects: declared?.sideEffects ?? ["read", "check"],
	};
}

/**
 * Facade affordances for a next-action union, ready to spread into an envelope:
 *  - Runnable: one runtime action plus a continuation that references it by id.
 *  - Legitimate terminal none (`id === action_id`): no runtime action and no
 *    continuation — both fields are omitted (the facade rejects an empty
 *    `runtime_actions` array, so it must be absent, not `[]`).
 *  - Fail-closed unavailable: no runtime action, plus a `requires_operator`
 *    continuation carrying one sanitized `continuation_unavailable` constraint.
 */
function facadeAffordances(next: {
	readonly kind: string;
	readonly id: VaultGitNextActionId;
	readonly action_id: string;
	readonly summary: string;
}): {
	readonly runtime_actions?: readonly RuntimeActionGuidance[];
	readonly continuation?: RuntimeContinuationGuidance;
} {
	if (next.kind !== "none") {
		return {
			runtime_actions: [runtimeAction(next)],
			continuation: { next_action_id: next.id },
		};
	}
	const continuation = continuationFor(next);
	return continuation ? { continuation } : {};
}

/**
 * Facade continuation guidance for a next-action union, in three cases:
 *  - Runnable (invoke/needs_input/needs_human): reference the derived runtime
 *    action by id.
 *  - Legitimate terminal none (`id === action_id`, e.g. `none` or
 *    `continue_outer_transaction`): a stop with nothing to run and nothing to
 *    escalate; omit the continuation entirely (undefined).
 *  - Fail-closed unavailable (semantic `action_id === "none"` while the compat id is
 *    a real action): the projection could not resolve to a continuation, so require
 *    operator review with one sanitized `continuation_unavailable` constraint.
 * Returns undefined to omit the continuation; envelope sites spread it conditionally.
 */
function continuationFor(next: {
	readonly kind: string;
	readonly id: VaultGitNextActionId;
	readonly action_id: string;
}): RuntimeContinuationGuidance | undefined {
	if (next.kind !== "none") return { next_action_id: next.id };
	const failedClosed = next.action_id === "none" && next.id !== "none";
	if (!failedClosed) return undefined;
	return {
		requires_operator: true,
		constraints: [
			{
				id: "continuation_unavailable",
				summary:
					"No safe continuation is available; operator review is required.",
			},
		],
	};
}

function envelopeRuntime(input: EmitContext) {
	return {
		runId: input.runId,
		durationMs: Math.max(0, input.now() - input.startedAt),
	};
}

function lifecycleLine(
	label: string,
	value: string | number | boolean | null | undefined,
): readonly string[] {
	return value === undefined || value === null ? [] : [`${label}: ${value}`];
}

function renderLifecycleResult(result: VaultGitLifecycleResultPayload): string {
	const previousFailure = result.task_previous_failure;
	return [
		`command: ${result.command}`,
		`outcome: ${result.outcome}`,
		`phase: ${result.phase}`,
		`write_permission: ${result.write_permission}`,
		`changed_state: ${result.changed_state}`,
		`retry_safety: ${result.retry_safety}`,
		...lifecycleLine("transaction_id", result.transaction_id),
		...lifecycleLine("task_id", result.task_id),
		...lifecycleLine("task_generation", result.task_generation),
		...lifecycleLine("task_revision", result.task_revision),
		...lifecycleLine("task_poll_after", result.task_poll_after),
		...lifecycleLine(
			"task_observation_expires_at",
			result.task_observation_expires_at,
		),
		...lifecycleLine("task_attempt_number", result.task_attempt_number),
		...lifecycleLine(
			"task_previous_failure",
			previousFailure?.blocker ?? previousFailure?.outcome,
		),
		...lifecycleLine("task_state", result.task_state),
		...lifecycleLine("task_phase", result.task_phase),
		...lifecycleLine("task_heartbeat_at", result.task_heartbeat_at),
		...lifecycleLine("task_checkpoint", result.task_checkpoint),
		...lifecycleLine("task_elapsed_ms", result.task_elapsed_ms),
		...lifecycleLine(
			"task_terminal_result",
			result.task_terminal_result
				? JSON.stringify(result.task_terminal_result)
				: undefined,
		),
		...lifecycleLine("transaction_state", result.transaction_state),
		...lifecycleLine("finding", result.finding),
		...lifecycleLine("repair_action", result.repair_action),
		...lifecycleLine(
			"foreground_non_vault_work_allowed",
			result.foreground_non_vault_work_allowed,
		),
		...(result.activation_restriction
			? [renderVaultGitActivationRestriction(result.activation_restriction)]
			: []),
		`next: ${result.next_action.id}`,
		"",
	].join("\n");
}

function emitUsageFailure(input: {
	error: unknown;
	argv: readonly string[];
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	startedAt: number;
	now: () => number;
}): number {
	const message =
		input.error instanceof CliUsageError || input.error instanceof Error
			? input.error.message
			: String(input.error);
	const payload = createVaultGitLifecycleResult({
		command: commandFromArgv(input.argv),
		outcome: "invalid_usage",
		phase: "blocked",
		write_permission: "denied",
		changed_state: "none",
		retry_safety: "same_input_safe",
		blockers: [],
		next_action: {
			id: "change_input",
			summary: usageFailureSummary(input.argv, message),
		},
	});
	const data = createCommandResultData(vaultGitContracts.status, payload);
	if (input.argv.includes("--json")) {
		writeJsonEnvelope(
			input.stdout,
			createCliRuntimeErrorEnvelope({
				run_id: input.runId,
				process_exit_code: 2,
				error: createCliUsageRuntimeError({
					run_id: input.runId,
					code: "invalid_usage",
					message: toStructuredUsageMessage(message),
				}),
				data,
				...facadeAffordances(payload.next_action),
			}),
			envelopeRuntime(input),
		);
	} else {
		input.stderr.write(`${message}\nnext: ${payload.next_action.action_id}\n`);
	}
	return 2;
}

function usageFailureSummary(argv: readonly string[], message: string): string {
	if (argv[0] !== "repair") {
		return "Correct the command arguments and retry parsing.";
	}
	const namedAction = argv[1];
	if (
		namedAction !== undefined &&
		VAULT_GIT_REPAIR_ACTIONS.includes(namedAction as VaultGitRepairAction)
	) {
		// The action is already named; point at the exact missing or invalid
		// flag instead of re-suggesting an action choice.
		const sanitized = toStructuredUsageMessage(message);
		return sanitized.trim().length > 0
			? sanitized
			: "Correct the repair flags shown in the command help.";
	}
	return "Choose one engine-owned repair action from the command help.";
}

/**
 * Refuse deterministically when a private child was killed or emitted
 * unparseable output. The remote outcome is unknown, so the envelope reports
 * an indeterminate partial change and routes through doctor.
 */
function emitIndeterminateLaunch(input: EmitContext & {
	readonly invocation: VaultGitRuntimeInvocation;
	readonly stderr: CliWriter;
	readonly phase: VaultGitTransactionPhase;
}): number {
	const payload = createVaultGitLifecycleResult({
		command: input.invocation.command,
		outcome: "refused",
		phase: input.phase,
		write_permission: "denied",
		changed_state: "partial",
		retry_safety: "operator_required",
		blockers: ["remote_unavailable"],
		next_action: action(
			"run_doctor",
			"Run doctor to reconcile the interrupted private launch outcome.",
		),
	});
	return emitPayload({
		...input,
		payload,
		success: false,
		errorCode: "remote_unavailable",
	});
}

function emitUnexpectedFailure(input: EmitContext & {
	readonly invocation: VaultGitRuntimeInvocation;
	readonly stderr: CliWriter;
}): number {
	input.stderr.write(
		"vault-git: unexpected runtime failure; inspect the run correlation\n",
	);
	const payload = createVaultGitLifecycleResult({
		command: input.invocation.command,
		outcome: "refused",
		phase: "blocked",
		write_permission: "denied",
		changed_state: "none",
		retry_safety: "operator_required",
		blockers: ["human_required"],
		// Fallback transaction-status inspection after an unexpected failure.
		next_action: action("inspect_status", undefined, {
			result_kind: "transaction_receipt",
		}),
	});
	return emitPayload({
		...input,
		payload,
		success: false,
		errorCode: "unexpected_runtime_failure",
	});
}

/** Redact rejected tokens from structured usage errors. */
function toStructuredUsageMessage(message: string): string {
	const withoutRejectedValue = message.replace(/\s*\(got: .*\)$/, "");
	if (/[\\/]/.test(withoutRejectedValue)) {
		return "Invalid command usage; run help for the accepted commands and flags.";
	}
	return withoutRejectedValue;
}

function commandFromArgv(argv: readonly string[]): VaultGitCommand {
	const candidate = argv[0];
	if (candidate === undefined || candidate.startsWith("-")) return "status";
	return VAULT_GIT_COMMANDS.includes(candidate as VaultGitCommand)
		? (candidate as VaultGitCommand)
		: "status";
}

class BufferWriter implements CliWriter {
	private readonly chunks: string[] = [];

	write(chunk: string): true {
		this.chunks.push(chunk);
		return true;
	}

	toString(): string {
		return this.chunks.join("");
	}
}

if (import.meta.main) {
	process.exit(await main(Bun.argv.slice(2)));
}
