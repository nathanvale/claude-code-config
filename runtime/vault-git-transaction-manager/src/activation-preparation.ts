import { chmod, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import {
	createVaultGitPreparedEvidence,
	GIT_OBJECT_ID,
	projectVaultGitPreparedActivationResult,
	VAULT_GIT_ABSENT_LEDGER_GENERATION,
	type VaultGitPreparedActivationResultV3,
	type VaultGitPreparedEvidenceV2,
} from "./activation-contract.ts";
import {
	deriveVaultGitActivationIdentity,
	type ResolvedVaultGitActivationIdentities,
} from "./activation-identity.ts";
import type { VaultGitLiveActivationBindings } from "./activation-authority.ts";
import type {
	VaultGitCheckerFingerprint,
	VaultGitCheckerPort,
	VaultGitProcessPort,
	VaultGitProcessResult,
} from "./ports.ts";
import {
	assertVaultGitSafeRemoteTarget,
	normalizeVaultGitAllowedRemoteHosts,
	VaultGitRemoteSafetyError,
} from "./remote-safety.ts";
import type { VaultGitReceiptStore } from "./store.ts";

const CONTROLLED_GIT_ENVIRONMENT = {
	GIT_CONFIG_COUNT: "3",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_KEY_0: "core.hooksPath",
	GIT_CONFIG_KEY_1: "protocol.ext.allow",
	GIT_CONFIG_KEY_2: "protocol.file.allow",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_VALUE_0: "/dev/null",
	GIT_CONFIG_VALUE_1: "never",
	GIT_CONFIG_VALUE_2: "always",
	GIT_TERMINAL_PROMPT: "0",
	LC_ALL: "C",
} as const;
const ISOLATED_MAIN_REF = "refs/vault-git/activation/main";
const ISOLATED_LEDGER_REF = "refs/vault-git/activation/ledger";

/** Inputs for one foreground, evidence-only activation preparation. */
export interface VaultGitActivationPreparerOptions {
	readonly repositoryPath: string;
	readonly privateStateRoot: string;
	readonly remoteName: string;
	readonly repositoryIdentity: string;
	readonly jobGeneration: number;
	readonly process: VaultGitProcessPort;
	readonly store: VaultGitReceiptStore;
	readonly resolveRepositoryIdentity: () => Promise<string>;
	readonly resolveActivationIdentities: () => Promise<ResolvedVaultGitActivationIdentities>;
	readonly createChecker: (isolatedRepositoryPath: string) => VaultGitCheckerPort;
	readonly clock: () => string;
	/** Injected exact-generation cancellation observation. */
	readonly cancelled?: () => boolean;
	readonly timeouts: {
		readonly localMs: number;
		readonly fetchMs: number;
	};
	readonly gitBinaryPath?: string;
	/** Exact admitted SSH transport closure shared with write-side Git. */
	readonly admittedGitEnvironment?: Readonly<Record<string, string>>;
	/** Exact network hosts admitted before activation preparation contacts Git. */
	readonly allowedRemoteHosts?: readonly string[];
	/** Testable owner for recursive private-workspace removal. */
	readonly removeWorkspace?: (workspace: string) => Promise<void>;
}

/** Evidence-only preparation outcome. */
export type VaultGitActivationPreparationResult =
	| {
			readonly status: "prepared";
			readonly evidence: VaultGitPreparedEvidenceV2;
			readonly result: VaultGitPreparedActivationResultV3;
	  }
	| {
			readonly status: "refused";
			readonly reason:
				| "remote_unavailable"
				| "main_not_aligned"
				| "checker_failed"
				| "identity_changed";
			readonly changedState: "none";
	  }
	| {
			readonly status: "unknown";
			readonly reason:
				| "preparation_timed_out"
				| "preparation_cancelled"
				| "preparation_interrupted";
			readonly changedState: "none";
	  };

/** Bounded isolated preparation boundary. */
export interface VaultGitActivationPreparer {
	/** Inspect remote and checker state without granting write authority. */
	prepare(): Promise<VaultGitActivationPreparationResult>;
	/** Recapture every authoritative binding without publishing new evidence. */
	revalidate(): Promise<VaultGitLiveActivationBindings>;
}

/**
 * Create one activation preparer whose Git and checker writes stay private.
 *
 * @param options - Exact configured identities, state owner, adapters, and clocks
 * @returns Evidence-only preparation operation
 */
export function createVaultGitActivationPreparer(
	options: VaultGitActivationPreparerOptions,
): VaultGitActivationPreparer {
	validateOptions(options);
	const gitBinary = options.gitBinaryPath ?? "/usr/bin/git";
	return {
		prepare: () => executePreparation(options, gitBinary),
		revalidate: () => executeLiveRevalidation(options, gitBinary),
	};
}

async function executePreparation(
	options: VaultGitActivationPreparerOptions,
	gitBinary: string,
): Promise<VaultGitActivationPreparationResult> {
	let workspace: string | null = null;
	try {
		workspace = await createPreparationWorkspace(options);
		const prepared = await collectPreparedEvidence(options, gitBinary, workspace);
		await removePreparationWorkspace(options, workspace);
		workspace = null;
		assertNotCancelled(options);
		await options.store.publishPreparedEvidence(prepared.evidence);
		return prepared;
	} catch (error) {
		if (workspace !== null) {
			try {
				await removePreparationWorkspace(options, workspace);
			} catch {
				return preparationFailureResult(
					new Error("activation preparation cleanup failed"),
				);
			}
		}
		return preparationFailureResult(error);
	}
}

async function executeLiveRevalidation(
	options: VaultGitActivationPreparerOptions,
	gitBinary: string,
): Promise<VaultGitLiveActivationBindings> {
	const workspace = await createPreparationWorkspace(options);
	let live: VaultGitLiveActivationBindings;
	try {
		live = await captureLiveBindings(options, gitBinary, workspace);
	} catch (error) {
		try {
			await removePreparationWorkspace(options, workspace);
		} catch {
			throw new Error("activation preparation cleanup failed");
		}
		throw error;
	}
	try {
		await removePreparationWorkspace(options, workspace);
	} catch {
		throw new Error("activation preparation cleanup failed");
	}
	return live;
}

async function createPreparationWorkspace(
	options: VaultGitActivationPreparerOptions,
): Promise<string> {
	await preparePrivateRoot(options.privateStateRoot);
	assertNotCancelled(options);
	const workspace = await mkdtemp(
		join(options.privateStateRoot, "activation-preparation-"),
	);
	try {
		await chmod(workspace, 0o700);
		return workspace;
	} catch (error) {
		await removePreparationWorkspace(options, workspace).catch(() => undefined);
		throw error;
	}
}

async function removePreparationWorkspace(
	options: VaultGitActivationPreparerOptions,
	workspace: string,
): Promise<void> {
	if (options.removeWorkspace) {
		await options.removeWorkspace(workspace);
		return;
	}
	await rm(workspace, { recursive: true, force: true });
}

async function collectPreparedEvidence(
	options: VaultGitActivationPreparerOptions,
	gitBinary: string,
	workspace: string,
): Promise<
	Extract<VaultGitActivationPreparationResult, { readonly status: "prepared" }>
> {
	const live = await captureLiveBindings(options, gitBinary, workspace);
	await assertPreparableMainState(options, live);
	if (live.repositoryIdentity !== options.repositoryIdentity) {
		throw new PreparationFailure("refused", "identity_changed");
	}
	const capturedAt = options.clock();
	const evidence = createVaultGitPreparedEvidence({
		...live,
		jobGeneration: options.jobGeneration,
		capturedAt,
	});
	assertNotCancelled(options);
	return {
		status: "prepared",
		evidence,
		result: projectVaultGitPreparedActivationResult(evidence, capturedAt),
	};
}

async function captureLiveBindings(
	options: VaultGitActivationPreparerOptions,
	gitBinary: string,
	workspace: string,
): Promise<VaultGitLiveActivationBindings> {
	const localHead = await readCanonicalHead(options, gitBinary);
	const remoteUrl = await readSafeRemote(options, gitBinary);
	const isolatedRepository = join(workspace, "repository");
	await cloneCanonicalRepository(
		options,
		gitBinary,
		isolatedRepository,
		localHead,
	);
	assertNotCancelled(options);
	const remoteState = await inspectRemoteInIsolation(
		options,
		gitBinary,
		workspace,
		remoteUrl,
	);
	assertNotCancelled(options);
	const checkerClosure = await runPinnedChecker(
		options.createChecker(isolatedRepository),
	);
	assertNotCancelled(options);
	const [repositoryIdentity, identities, localHeadAfter] = await Promise.all([
		options.resolveRepositoryIdentity(),
		options.resolveActivationIdentities(),
		readCanonicalHead(options, gitBinary),
	]);
	assertPreparationBindings({
		options,
		identities,
		localHead,
		localHeadAfter,
		remoteUrl,
	});
	return {
		repositoryIdentity,
		...identities,
		localMainHead: localHead,
		remoteMainHead: remoteState.remoteMainHead,
		ledgerGeneration: remoteState.ledgerGeneration,
		checkerClosure,
	};
}

function preparationFailureResult(
	error: unknown,
): VaultGitActivationPreparationResult {
	if (error instanceof PreparationFailure) {
		return {
			status: error.status,
			reason: error.reason,
			changedState: "none",
		} as VaultGitActivationPreparationResult;
	}
	return {
		status: "unknown",
		reason: "preparation_interrupted",
		changedState: "none",
	};
}

async function assertPreparableMainState(
	options: VaultGitActivationPreparerOptions,
	live: VaultGitLiveActivationBindings,
): Promise<void> {
	if (live.localMainHead === live.remoteMainHead) return;
	const loaded = await options.store.load().catch(() => null);
	const receipt = loaded?.status === "loaded" ? loaded.receipt : null;
	// R17 recovery exception: preparation may bind one exact preserved commit
	// to its still-current push_pending receipt. The active receipt continues to
	// block new transaction admission; fresh evidence can authorize only recovery.
	const exactPushPendingRecovery = receipt !== null && [
		receipt.phase === "push_pending",
		receipt.pushOutcome === "unknown",
		receipt.transactionId !== null,
		receipt.remote === options.remoteName,
		receipt.localMainHead === live.remoteMainHead,
		receipt.remoteMainHead === live.remoteMainHead,
		receipt.commitId === live.localMainHead,
		receipt.expectedMainCommit === live.localMainHead,
		receipt.leaseGeneration === live.ledgerGeneration,
	].every(Boolean);
	if (!exactPushPendingRecovery) {
		throw new PreparationFailure("refused", "main_not_aligned");
	}
}

function assertPreparationBindings(input: {
	readonly options: VaultGitActivationPreparerOptions;
	readonly identities: ResolvedVaultGitActivationIdentities;
	readonly localHead: string;
	readonly localHeadAfter: string;
	readonly remoteUrl: string;
}): void {
	const capturedRemoteIdentity = deriveVaultGitActivationIdentity({
		owner: "remote",
		components: [input.options.remoteName, input.remoteUrl],
	});
	const unchanged = [
		input.localHeadAfter === input.localHead,
		input.identities.remoteIdentity === capturedRemoteIdentity,
	].every(Boolean);
	if (!unchanged) {
		throw new PreparationFailure("refused", "identity_changed");
	}
}

class PreparationFailure extends Error {
	constructor(
		readonly status: "refused" | "unknown",
		readonly reason:
			| "remote_unavailable"
			| "main_not_aligned"
			| "checker_failed"
			| "identity_changed"
			| "preparation_timed_out"
			| "preparation_cancelled",
	) {
		super(reason);
	}
}

function assertNotCancelled(options: VaultGitActivationPreparerOptions): void {
	if (options.cancelled?.() === true) {
		throw new PreparationFailure("unknown", "preparation_cancelled");
	}
}

async function preparePrivateRoot(root: string): Promise<void> {
	let metadata = await lstat(root).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return null;
		throw error;
	});
	if (metadata === null) {
		await mkdir(root, { recursive: true, mode: 0o700 });
		metadata = await lstat(root);
	}
	assertPrivateRootMetadata(metadata);
	await chmod(root, 0o700);
	const secured = await lstat(root);
	if (
		secured.dev !== metadata.dev ||
		secured.ino !== metadata.ino ||
		(secured.mode & 0o7777) !== 0o700
	) {
		throw new Error("private activation state unavailable");
	}
	assertPrivateRootMetadata(secured);
}

function assertPrivateRootMetadata(metadata: Awaited<ReturnType<typeof lstat>>): void {
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
		throw new Error("private activation state unavailable");
	}
}

async function readCanonicalHead(
	options: VaultGitActivationPreparerOptions,
	gitBinary: string,
): Promise<string> {
	const result = await runGit(
		options,
		gitBinary,
		options.repositoryPath,
		["rev-parse", "--verify", "refs/heads/main^{commit}"],
		options.timeouts.localMs,
	);
	return objectId(result.stdout);
}

async function readSafeRemote(
	options: VaultGitActivationPreparerOptions,
	gitBinary: string,
): Promise<string> {
	try {
		return await assertVaultGitSafeRemoteTarget({
			remote: options.remoteName,
			timeoutMs: options.timeouts.localMs,
			allowedRemoteHosts: normalizeVaultGitAllowedRemoteHosts(
				options.allowedRemoteHosts ?? [],
			),
			runGit: (args, timeoutMs) =>
				options.process.run({
					command: gitBinary,
					args,
					cwd: options.repositoryPath,
					env: {
						...CONTROLLED_GIT_ENVIRONMENT,
						...options.admittedGitEnvironment,
					},
					timeoutMs,
				}),
		});
	} catch (error) {
		if (
			error instanceof VaultGitRemoteSafetyError &&
			error.kind === "unavailable"
		) {
			throw new PreparationFailure("unknown", "preparation_timed_out");
		}
		throw new PreparationFailure("refused", "remote_unavailable");
	}
}

async function cloneCanonicalRepository(
	options: VaultGitActivationPreparerOptions,
	gitBinary: string,
	destination: string,
	localHead: string,
): Promise<void> {
	await runGit(
		options,
		gitBinary,
		options.privateStateRoot,
		[
			"clone",
			"--no-local",
			"--no-hardlinks",
			"--no-checkout",
			"--config",
			"core.hooksPath=/dev/null",
			"--config",
			"core.fsmonitor=false",
			"--",
			options.repositoryPath,
			destination,
		],
		options.timeouts.localMs,
	);
	await runGit(
		options,
		gitBinary,
		destination,
		["checkout", "--detach", localHead],
		options.timeouts.localMs,
	);
}

async function inspectRemoteInIsolation(
	options: VaultGitActivationPreparerOptions,
	gitBinary: string,
	workspace: string,
	remoteUrl: string,
): Promise<{
	readonly remoteMainHead: string;
	readonly ledgerGeneration: string;
}> {
	const repository = join(workspace, "remote.git");
	await runGit(
		options,
		gitBinary,
		workspace,
		["init", "--bare", repository],
		options.timeouts.localMs,
	);
	const advertised = await runGit(
		options,
		gitBinary,
		repository,
		[
			"ls-remote",
			"--refs",
			remoteUrl,
			"refs/heads/main",
			"refs/heads/vault-system/transaction-ledger",
		],
		options.timeouts.fetchMs,
	);
	const remoteRefs = parsePreparationRemoteRefs(advertised.stdout);
	await runGit(
		options,
		gitBinary,
		repository,
		[
			"fetch",
			"--no-tags",
			"--no-write-fetch-head",
			remoteUrl,
			`+refs/heads/main:${ISOLATED_MAIN_REF}`,
			...(remoteRefs.ledgerGeneration === null
				? []
				: [
						`+refs/heads/vault-system/transaction-ledger:${ISOLATED_LEDGER_REF}`,
					]),
		],
		options.timeouts.fetchMs,
	);
	const [main, ledger] = await Promise.all([
		runGit(
			options,
			gitBinary,
			repository,
			["rev-parse", "--verify", `${ISOLATED_MAIN_REF}^{commit}`],
			options.timeouts.localMs,
		),
		remoteRefs.ledgerGeneration === null
			? Promise.resolve(null)
			: runGit(
					options,
					gitBinary,
					repository,
					["rev-parse", "--verify", `${ISOLATED_LEDGER_REF}^{commit}`],
					options.timeouts.localMs,
				),
	]);
	const fetchedMain = objectId(main.stdout);
	const fetchedLedger =
		ledger === null
			? VAULT_GIT_ABSENT_LEDGER_GENERATION
			: objectId(ledger.stdout);
	if (
		fetchedMain !== remoteRefs.mainHead ||
		(remoteRefs.ledgerGeneration !== null &&
			fetchedLedger !== remoteRefs.ledgerGeneration)
	) {
		throw new PreparationFailure("refused", "remote_unavailable");
	}
	return {
		remoteMainHead: fetchedMain,
		ledgerGeneration: fetchedLedger,
	};
}

function parsePreparationRemoteRefs(source: string): {
	readonly mainHead: string;
	readonly ledgerGeneration: string | null;
} {
	const refs = new Map<string, string>();
	for (const line of source.trim().split(/\r?\n/).filter(Boolean)) {
		const [head, ref, extra] = line.split("\t");
		if (
			extra !== undefined ||
			head === undefined ||
			ref === undefined ||
			refs.has(ref)
		) {
			throw new PreparationFailure("refused", "remote_unavailable");
		}
		refs.set(ref, objectId(head));
	}
	const mainHead = refs.get("refs/heads/main");
	if (mainHead === undefined || refs.size > 2) {
		throw new PreparationFailure("refused", "remote_unavailable");
	}
	return {
		mainHead,
		ledgerGeneration:
			refs.get("refs/heads/vault-system/transaction-ledger") ?? null,
	};
}

async function runPinnedChecker(
	checker: VaultGitCheckerPort,
): Promise<VaultGitCheckerFingerprint> {
	const before = await checker.fingerprint();
	const result = await checker.runCheck();
	assertCheckerResult(result);
	const after = await checker.fingerprint();
	const unchanged = [
		after.entrypointHash === before.entrypointHash,
		after.dependencyBundleHash === before.dependencyBundleHash,
	].every(Boolean);
	if (!unchanged) {
		throw new PreparationFailure("refused", "checker_failed");
	}
	return before;
}

function assertCheckerResult(result: {
	readonly timedOut: boolean;
	readonly exitCode: number | null;
	readonly stdout: string;
}): void {
	if (result.timedOut) {
		throw new PreparationFailure("unknown", "preparation_timed_out");
	}
	if (![result.exitCode === 0, isSuccessfulCheckerJson(result.stdout)].every(Boolean)) {
		throw new PreparationFailure("refused", "checker_failed");
	}
}

async function runGit(
	options: VaultGitActivationPreparerOptions,
	gitBinary: string,
	cwd: string,
	args: readonly string[],
	timeoutMs: number,
): Promise<VaultGitProcessResult> {
	const result = await options.process.run({
		command: gitBinary,
		args,
		cwd,
		env: {
			...CONTROLLED_GIT_ENVIRONMENT,
			...options.admittedGitEnvironment,
		},
		timeoutMs,
	});
	if (result.timedOut) {
		throw new PreparationFailure("unknown", "preparation_timed_out");
	}
	if (result.exitCode !== 0) {
		throw new PreparationFailure("refused", "remote_unavailable");
	}
	return result;
}

function objectId(value: string): string {
	const candidate = value.trim();
	if (!GIT_OBJECT_ID.test(candidate)) {
		throw new PreparationFailure("refused", "remote_unavailable");
	}
	return candidate;
}

function isSuccessfulCheckerJson(source: string): boolean {
	const value = parseJson(source);
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return record.schema_version === 1 &&
		Array.isArray(record.findings) &&
		record.findings.length === 0;
}

function parseJson(source: string): unknown {
	try {
		return JSON.parse(source);
	} catch {
		return null;
	}
}

function validateOptions(options: VaultGitActivationPreparerOptions): void {
	normalizeVaultGitAllowedRemoteHosts(options.allowedRemoteHosts ?? []);
	const valid = [
		isAbsolute(options.repositoryPath),
		isAbsolute(options.privateStateRoot),
		options.remoteName.trim().length > 0,
		options.repositoryIdentity.trim().length > 0,
		Number.isSafeInteger(options.jobGeneration),
		options.jobGeneration > 0,
		options.timeouts.localMs > 0,
		options.timeouts.fetchMs > 0,
	].every(Boolean);
	if (!valid) {
		throw new Error("activation preparation configuration invalid");
	}
}
