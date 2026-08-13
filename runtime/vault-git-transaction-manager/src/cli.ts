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
	createVaultOwnedCheckPort,
} from "./git-adapter.ts";
import {
	VAULT_GIT_REPAIR_ACTIONS,
	VAULT_GIT_ACTIVATION_CONFIGURATION_FIELDS,
	createVaultGitActivationRestriction,
	createVaultGitLifecycleResult,
	type VaultGitLifecycleResultPayload,
	type VaultGitActivationConfigurationField,
	type VaultGitNextActionId,
	type VaultGitRepairAction,
	type VaultGitTransactionPhase,
} from "./model.ts";
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
import type { VaultGitRepairResult } from "./repair.ts";
import {
	createVaultGitTaskStore,
	type VaultGitTaskStore,
	type VaultGitTaskTransitionFence,
} from "./task-store.ts";
import {
	VAULT_GIT_TASK_HEARTBEAT_STALE_MS,
	reconcileClosedVaultGitTask,
	reconcileStaleVaultGitTaskFromDoctor,
} from "./task-reconciliation.ts";
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
	"engine.ts",
	"git-adapter.ts",
	"janitor.ts",
	"model.ts",
	"ports.ts",
	"remote-ledger.ts",
	"remote-safety.ts",
	"repair.ts",
	"repository-identity.ts",
	"store.ts",
	"task-repair.ts",
	"task-state.ts",
	"task-reconciliation.ts",
	"task-store.ts",
	"task-worker.ts",
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
const LOCKFILE_REQUIRING_MANIFEST_FIELDS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
	"peerDependenciesMeta",
	"trustedDependencies",
	"bundledDependencies",
	"bundleDependencies",
	"patchedDependencies",
	"overrides",
	"resolutions",
	"catalog",
	"catalogs",
	"workspaces",
] as const;
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
}

/** Process and monotonic-time operations used by foreground task acknowledgement. */
export interface VaultGitBackgroundCompletionRuntime {
	readonly now: () => number;
	readonly sleep: (milliseconds: number) => Promise<void>;
	readonly spawnWorker: typeof spawnBackgroundWorker;
	readonly readProcessIdentity: (pid: number) => string;
	readonly stopUnacknowledgedWorker: (pid: number) => void;
	readonly stopExpiredWorker: typeof stopExpiredUnacknowledgedWorker;
}

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

function isRuntimeInvocation(
	invocation: ParsedVaultGitInvocation,
): invocation is VaultGitRuntimeInvocation {
	return invocation.command !== "commands";
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
	const check = createVaultOwnedCheckPort({
		repositoryPath: checkRepositoryPath,
		process: processPort,
		timeoutMs: DEFAULT_TIMEOUTS.localMs,
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
	const taskStore = createVaultGitTaskStore({
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

	try {
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
	const activationIdentity = resolveDefaultActivationIdentity();
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
		host: process.env.VAULT_GIT_HOST ?? hostname(),
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

function resolveDefaultActivationIdentity():
	| {
			readonly status: "configured";
			readonly value: VaultGitCliActivationIdentityInput;
	  }
	| {
			readonly status: "missing";
			readonly missingConfiguration: readonly VaultGitActivationConfigurationField[];
		  } {
	const hostId = process.env.VAULT_GIT_HOST;
	const sshIdentityFilePath = process.env.VAULT_GIT_SSH_IDENTITY_FILE_PATH;
	const sshIdentityPublicKeyPath = process.env.VAULT_GIT_SSH_PUBLIC_KEY_PATH;
	const sshKnownHostsPath = process.env.VAULT_GIT_SSH_KNOWN_HOSTS_PATH;
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
			gitBinaryPath: process.env.VAULT_GIT_GIT_BINARY_PATH ?? "/usr/bin/git",
			sshBinaryPath: process.env.VAULT_GIT_SSH_BINARY_PATH ?? "/usr/bin/ssh",
			sshIdentityFilePath,
			sshIdentityPublicKeyPath,
			sshKnownHostsPath,
		},
	};
}

/**
 * Create the shell-free process adapter for the external structured checker.
 *
 * @param repositoryPath - Canonical configured vault root
 * @param processPort - Bounded scrubbed subprocess boundary
 * @returns Fingerprint, check, registry, and exact repair operations
 * @throws When fingerprint source files are missing or unreadable, dependency
 * or workspace metadata has no valid bun.lock, or the package.json check
 * script does not name exactly one repository-relative entrypoint file
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
	const run = (args: readonly string[]) =>
		processPort.run({
			command: runtimeBinaryPath,
			args,
			cwd: repositoryPath,
			env: {
				LC_ALL: "C",
				PATH: `${dirname(runtimeBinaryPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
			},
			environmentMode: "isolated",
			timeoutMs: DEFAULT_TIMEOUTS.localMs,
		});
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
		runCheck() {
			return run(["run", "check", "--json"]);
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
	const manifest = parseManifest(manifestBytes);
	const dependencySurface = LOCKFILE_REQUIRING_MANIFEST_FIELDS.find((field) =>
		Object.hasOwn(manifest, field),
	);
	if (dependencySurface !== undefined) {
		throw new Error(
			`bun.lock is required when package.json declares ${dependencySurface}`,
		);
	}
}

function parseManifest(manifestBytes: Uint8Array): Record<string, unknown> {
	let manifest: unknown;
	try {
		manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
	} catch {
		throw new Error("vault package manifest is not valid JSON");
	}
	if (
		typeof manifest !== "object" ||
		manifest === null ||
		Array.isArray(manifest)
	) {
		throw new Error("vault package manifest is not an object");
	}
	return manifest as Record<string, unknown>;
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
	const manifest = parseManifest(manifestBytes);
	const dependencySurface = LOCKFILE_REQUIRING_MANIFEST_FIELDS.find((field) =>
		Object.hasOwn(manifest, field),
	);
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
 * Resolve the one repository-relative script file the package.json check
 * script executes. Admission fails closed when zero or multiple candidate
 * files appear, so an unresolvable checker surface can never be admitted.
 */
function resolveCheckEntrypoint(manifestBytes: Uint8Array): string {
	let manifest: unknown;
	try {
		manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
	} catch {
		throw new Error("vault package manifest is not valid JSON");
	}
	const scripts =
		typeof manifest === "object" && manifest !== null && !Array.isArray(manifest)
			? (manifest as Record<string, unknown>).scripts
			: undefined;
	const script =
		typeof scripts === "object" && scripts !== null && !Array.isArray(scripts)
			? (scripts as Record<string, unknown>).check
			: undefined;
	if (typeof script !== "string" || script.trim().length === 0) {
		throw new Error("vault check script is unavailable");
	}
	const candidates = [
		...new Set(
			script
				.split(/\s+/)
				.filter(
					(token) =>
						/^[A-Za-z0-9][A-Za-z0-9_./-]*\.(?:ts|mts|cts|js|mjs|cjs)$/.test(token) &&
						token
							.split("/")
							.every(
								(segment) =>
									segment.length > 0 &&
									segment !== "." &&
									segment !== ".." &&
									segment.toLowerCase() !== ".git",
							),
				),
		),
	];
	const entrypoint = candidates[0];
	if (candidates.length !== 1 || !entrypoint) {
		throw new Error(
			"vault check script does not resolve to one repository-relative entrypoint",
		);
	}
	return entrypoint;
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
	if (invocation.taskId && !/^task_[0-9a-f]{32}$/.test(invocation.taskId)) {
		throw usageError("--task-id must be an opaque vault task id");
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

async function launchBackgroundCompletion(input: EmitContext & {
	readonly composition: VaultGitCliComposition;
	readonly invocation: VaultGitRuntimeInvocation & { readonly command: "complete" };
	readonly args: readonly string[];
	readonly backgroundRuntime: VaultGitBackgroundCompletionRuntime;
	readonly stderr: CliWriter;
}): Promise<number> {
	// One foreground budget covers receipt loading, stale-launch recovery,
	// replacement launch, and acknowledgement. Recovery must not reset it.
	const acknowledgementDeadline = input.backgroundRuntime.now() + 1_500;
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
			next_action: action("inspect_status"),
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
	const admission = await taskStore.claimOrJoin({
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
	});
	if (admission.status === "refused") {
		const payload = createVaultGitLifecycleResult({
			command: "complete",
			outcome: "refused",
			phase: loaded.receipt.phase,
			write_permission: "denied",
			changed_state: "none",
			retry_safety: "operator_required",
			blockers: ["task_input_mismatch"],
			transaction_id: loaded.receipt.transactionId,
			next_action: action("inspect_status"),
		});
		return emitPayload({ ...input, payload, success: false, errorCode: "task_input_mismatch" });
	}
	let state = admission.state;
	let launchWinner = admission.launch === "winner" || state.state === "claimed";
	if (
		admission.launch === "joined" &&
		state.state === "launching" &&
		state.launchExpiresAt !== null &&
		Date.parse(state.launchExpiresAt) <= input.now()
	) {
		const stopped = await input.backgroundRuntime.stopExpiredWorker(
			state.workerPid,
			state.workerProcessIdentity,
		);
		if (stopped) {
			const recovered = await taskStore.transition(state.taskId, state.revision,
				state.launchAttempt < 2 ? {
				state: "claimed",
				phase: "admitted",
				updatedAt: new Date(input.now()).toISOString(),
				heartbeatAt: null,
				checkpoint: null,
				launchGeneration: null,
				launchExpiresAt: null,
				workerPid: null,
				workerProcessIdentity: null,
			} : {
				state: "repair_needed",
				phase: "terminal",
				updatedAt: new Date(input.now()).toISOString(),
				heartbeatAt: null,
				checkpoint: null,
				launchGeneration: state.launchGeneration,
				launchExpiresAt: null,
				workerPid: null,
				workerProcessIdentity: null,
				terminalResult: {
					outcome: "refused",
					phase: "blocked",
					changedState: "none",
					blocker: "worker_launch_protocol_failed",
					retrySafety: "operator_required",
				},
			});
			state = recovered.state;
			launchWinner = recovered.status === "transitioned" && state.state === "claimed";
		}
	}
	if (launchWinner) {
		const launchGeneration = `launch_${randomUUID().replaceAll("-", "")}`;
		const launchedAt = new Date(input.now());
		const launching = await taskStore.transition(state.taskId, state.revision, {
			state: "launching",
			phase: "admitted",
			updatedAt: launchedAt.toISOString(),
			heartbeatAt: null,
			checkpoint: null,
			launchGeneration,
			launchExpiresAt: new Date(launchedAt.getTime() + 1_500).toISOString(),
			workerPid: null,
			workerProcessIdentity: null,
			launchAttempt: state.launchAttempt + 1,
		});
		state = launching.state;
		launchWinner = launching.status === "transitioned";
		let spawnedWorkerPid: number | null = null;
		if (launchWinner) try {
			spawnedWorkerPid = input.backgroundRuntime.spawnWorker(
				input.composition,
				loaded.receipt.receiptId,
				state.taskId,
				launchGeneration,
				input.args,
			);
			const workerPid = spawnedWorkerPid;
			const workerProcessIdentity = input.backgroundRuntime.readProcessIdentity(workerPid);
			const registered = await taskStore.transition(state.taskId, state.revision, {
				state: "launching",
				phase: "admitted",
				updatedAt: new Date(input.now()).toISOString(),
				heartbeatAt: null,
				checkpoint: null,
				launchGeneration,
				launchExpiresAt: state.launchExpiresAt,
				workerPid,
				workerProcessIdentity,
			});
			if (registered.status !== "transitioned") {
				input.backgroundRuntime.stopUnacknowledgedWorker(workerPid);
			} else {
				state = registered.state;
			}
			spawnedWorkerPid = null;
		} catch {
			if (spawnedWorkerPid !== null) {
				input.backgroundRuntime.stopUnacknowledgedWorker(spawnedWorkerPid);
			}
			await transitionTaskUntilSettled(taskStore, state.taskId, {
				state: "repair_needed",
				phase: "terminal",
				updatedAt: new Date(input.now()).toISOString(),
				heartbeatAt: null,
				checkpoint: null,
				launchGeneration,
				launchExpiresAt: null,
				workerPid: null,
				workerProcessIdentity: null,
				terminalResult: {
					outcome: "refused",
					phase: "blocked",
					changedState: "none",
					blocker: "worker_launch_failed",
					retrySafety: "operator_required",
				},
			}, { expectedLaunchGeneration: launchGeneration });
		}
	}
	while (
		state.state !== "in_progress" &&
		input.backgroundRuntime.now() < acknowledgementDeadline
	) {
		await input.backgroundRuntime.sleep(10);
		const current = await taskStore.loadByTaskId(state.taskId);
		if (current.status !== "loaded") break;
		state = current.state;
		if (state.state === "repair_needed" || state.state === "unknown") break;
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
	if (state.state !== "in_progress") {
		const payload = createVaultGitLifecycleResult({
			command: "complete",
			outcome: "refused",
			phase: loaded.receipt.phase,
			write_permission: "denied",
			changed_state: "none",
			retry_safety: "operator_required",
			blockers: ["worker_launch_protocol_failed"],
			transaction_id: loaded.receipt.transactionId,
			task_id: state.taskId,
			task_attempt_number: state.attemptNumber,
			task_previous_failure: state.previousTerminalResult,
			task_state: state.state,
			task_phase: state.phase,
			lease_generation: state.leaseGeneration,
			next_action: action("run_doctor", "Run doctor to inspect the unacknowledged worker launch."),
		});
		return emitPayload({ ...input, payload, success: false, errorCode: "worker_launch_protocol_failed" });
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
		next_action: action("inspect_status", "Inspect this task for durable progress."),
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
			if (
				process.env.VAULT_GIT_TASK_ID &&
				process.env.VAULT_GIT_TASK_LAUNCH_GENERATION
			) {
				return {
					kind: "engine",
					value: await executeBackgroundWorkerCompletion(
						invocation as VaultGitRuntimeInvocation & { readonly command: "complete" },
						composition,
						readCapability,
						process.env.VAULT_GIT_TASK_ID,
						process.env.VAULT_GIT_TASK_LAUNCH_GENERATION,
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
				const value = await composition.engine.doctor({
					transactionId: invocation.transactionId,
					issueTakeoverToken: false,
				});
				// Both reconciliations are advisory private bookkeeping: the worker
				// and the next doctor run reach the same terminal state. Losing a
				// CAS race must never discard the diagnosis the operator asked for.
				await reconcileTaskClosure(composition, value).catch(() => undefined);
				await reconcileStaleTaskAfterDoctor(composition, value).catch(() => undefined);
				await authorizeTaskRepairForWritingReceipt(
					composition,
					invocation.transactionId,
					value,
				).catch(() => undefined);
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

async function authorizeTaskRepairForWritingReceipt(
	composition: VaultGitCliComposition,
	transactionId: string | undefined,
	result: VaultGitDoctorResult | VaultGitRepairResult,
): Promise<void> {
	const repairResultEligible =
		result.status === "repaired" && result.state === "active";
	const doctorResultEligible =
		result.status === "diagnosed" &&
		result.state === "repairable" &&
		result.repairAction === "resume";
	if (
		!composition.taskStore ||
		(!repairResultEligible && !doctorResultEligible) ||
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

async function executeBackgroundWorkerCompletion(
	invocation: VaultGitRuntimeInvocation & { readonly command: "complete" },
	composition: VaultGitCliComposition,
	readCapability: (descriptor: number) => Promise<Uint8Array>,
	taskId: string,
	launchGeneration: string,
): Promise<VaultGitEngineResult> {
	const taskStore = requireTaskStore(composition);
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	try {
		const worker = createVaultGitCliTaskWorker({
			engine: composition.engine,
			now: () => composition.runtime.now(),
			readCapability: (descriptor) => readCapability(descriptor),
			acknowledge: async (acknowledgement) => {
				let loaded = await taskStore.loadByTaskId(acknowledgement.taskId);
				const registrationDeadline = performance.now() + 1_500;
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
		await transitionTaskUntilSettled(taskStore, taskId, {
			state: terminalState,
			phase: "terminal",
			updatedAt: composition.runtime.now().toISOString(),
			heartbeatAt: composition.runtime.now().toISOString(),
			checkpoint: result.phase,
			launchGeneration,
			launchExpiresAt: null,
			workerPid: process.pid,
			terminalResult: {
				outcome: result.status === "inspected" ? "read_only" : result.status,
				phase: result.phase,
				changedState: result.changedState,
				blocker: result.blocker ?? null,
				retrySafety: result.retrySafety,
			},
		}, { expectedLaunchGeneration: launchGeneration });
		return result;
	} catch (error) {
		await transitionTaskUntilSettled(taskStore, taskId, {
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
		}, { expectedLaunchGeneration: launchGeneration }).catch(() => undefined);
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

async function transitionTaskUntilSettled(
	store: VaultGitTaskStore,
	taskId: string,
	input: import("./task-state.ts").VaultGitTaskStateAdvanceInput,
	fence?: VaultGitTaskTransitionFence,
): Promise<void> {
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const current = await store.loadByTaskId(taskId);
		if (current.status !== "loaded" || current.state.phase === "terminal") return;
		// A superseded launch generation must never terminalize the attempt that
		// replaced it, so the fence refuses instead of retrying onto a new revision.
		if (
			fence?.expectedLaunchGeneration !== undefined &&
			current.state.launchGeneration !== fence.expectedLaunchGeneration
		) return;
		const transitioned = await store.transition(
			taskId,
			current.state.revision,
			input,
			fence,
		);
		if (transitioned.status === "transitioned") return;
	}
	throw new Error("task terminal transition contention exceeded");
}

function requireTaskStore(composition: VaultGitCliComposition): VaultGitTaskStore {
	if (!composition.taskStore) throw new Error("background task store unavailable");
	return composition.taskStore;
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
			runtime_actions: [runtimeAction(payload.next_action)],
			continuation: { next_action_id: payload.next_action.id },
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
	const payload = payloadForRuntime(input.invocation.command, input.result, input.now());
	const success =
		input.result.kind === "engine"
			? input.result.value.status !== "refused"
			: input.result.kind === "task"
				? true
				: input.result.kind === "task_missing" || input.result.kind === "task_corrupt"
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
	const runtime = runtimeAction(next);
	const errorCode = input.result.errorCode ?? "activation_restricted";
	if (input.invocation.json) {
		const envelope = input.result.success
			? createCliRuntimeSuccessEnvelope({
					run_id: input.runId,
					data: input.result.value,
					runtime_actions: [runtime],
					continuation: { next_action_id: next.id },
				})
			: createCliRuntimeErrorEnvelope({
					run_id: input.runId,
					process_exit_code: 1,
					error: activationRuntimeError(input.runId, errorCode),
					data: input.result.value,
					runtime_actions: [runtime],
					continuation: { next_action_id: next.id },
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
	result: Exclude<RuntimeResult, { readonly kind: "activation" }>,
	now: number,
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
			next_action: action("change_input", "Use the opaque task ID returned by complete."),
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
					: action("inspect_status", "Inspect this task again for durable progress.");
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
			transaction_id: value.transactionId,
			transaction_state: value.state,
			next_action: action(value.nextAction.id, value.nextAction.summary),
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
			next_action: action(value.nextAction.id, value.nextAction.summary),
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
			repair_action: value.action,
			next_action: action(value.nextAction.id, value.nextAction.summary),
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
			next_action: action(value.nextAction.id, value.nextAction.summary),
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
	const runtime = runtimeAction(input.payload.next_action);
	if (input.invocation.json) {
		const envelope = input.success
			? createCliRuntimeSuccessEnvelope({
					run_id: input.runId,
					data,
					runtime_actions: [runtime],
					continuation: { next_action_id: input.payload.next_action.id },
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
					runtime_actions: [runtime],
					continuation: { next_action_id: input.payload.next_action.id },
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

function action(id: VaultGitNextActionId, summary?: string) {
	const declared = vaultGitActions.find((candidate) => candidate.id === id);
	if (!declared) {
		// Every next-action id exists in the declared affordances by
		// construction; a miss means the model-to-cli coupling broke.
		throw new Error(
			`vault-git next action ${id} is missing from the declared affordances`,
		);
	}
	return { id, summary: summary ?? declared.summary };
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

function envelopeRuntime(input: EmitContext) {
	return {
		runId: input.runId,
		durationMs: Math.max(0, input.now() - input.startedAt),
	};
}

function renderLifecycleResult(result: VaultGitLifecycleResultPayload): string {
	return [
		`command: ${result.command}`,
		`outcome: ${result.outcome}`,
		`phase: ${result.phase}`,
		`write_permission: ${result.write_permission}`,
		`changed_state: ${result.changed_state}`,
		`retry_safety: ${result.retry_safety}`,
		...(result.transaction_id ? [`transaction_id: ${result.transaction_id}`] : []),
		...(result.task_id ? [`task_id: ${result.task_id}`] : []),
		...(result.task_attempt_number
			? [`task_attempt_number: ${result.task_attempt_number}`]
			: []),
		...(result.task_previous_failure
			? [
					`task_previous_failure: ${result.task_previous_failure.blocker ?? result.task_previous_failure.outcome}`,
				]
			: []),
		...(result.task_state ? [`task_state: ${result.task_state}`] : []),
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
		const next = runtimeAction(payload.next_action);
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
				runtime_actions: [next],
				continuation: { next_action_id: "change_input" },
			}),
			envelopeRuntime(input),
		);
	} else {
		input.stderr.write(`${message}\nnext: change_input\n`);
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
		next_action: action("inspect_status"),
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
