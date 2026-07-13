import { randomUUID } from "node:crypto";
import { chmod, link, lstat, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import {
	HOOK_PROVENANCE_SCHEMA_VERSION,
	classifyHookOwnership,
	hashHookBytes,
	hookProvenanceIdentity,
	isRecognizedPreProvenanceHook,
	readHookProvenance,
	sameHookProvenanceInspection,
	writeHookProvenance,
	type HookProvenanceIdentity,
	type HookProvenanceInspection,
	type HookProvenanceReceipt,
} from "./hook-provenance.ts";
import { deepFreeze } from "./immutable.ts";
import type { SetupDomainResult, SetupFinding } from "./model.ts";
import { hasErrorCode } from "./path-safety.ts";

/** Mutation route selected from immutable hook and receipt evidence. */
export type HookOperationKind =
	| "install"
	| "backfill_receipt"
	| "migrate"
	| "reconcile"
	| "repair_mode"
	| "recover_pending";

/** Exact destination shape retained for apply-time revalidation. */
export type HookDestinationEvidence =
	| { readonly shape: "missing" }
	| { readonly shape: "file"; readonly digest: string; readonly executable: boolean }
	| { readonly shape: "other" };

/** One hook transaction planned from source, destination, and receipt evidence. */
export interface HookOperation {
	readonly kind: HookOperationKind;
	readonly source: string;
	readonly destination: string;
	readonly source_digest: string;
	readonly identity: HookProvenanceIdentity;
	readonly expected_destination: HookDestinationEvidence;
	readonly expected_receipt: Extract<HookProvenanceInspection, { readonly status: "missing" | "valid" }>;
	readonly mutates_hook: boolean;
}

/** Immutable copied-hook plan consumed by the serialized apply path. */
export interface HookTopologyPlan {
	readonly domain: "hooks";
	readonly operations: readonly HookOperation[];
	readonly findings: readonly SetupFinding[];
	readonly preserved: readonly string[];
}

/** Directory reader seam used to prove source inspection failures. */
export type HookDirectoryReader = (path: string) => Promise<string[]>;

/** Apply-time mutation phases exposed only for deterministic race and failure proof. */
export type HookMutationPhase = "pending_receipt" | "hook_replace" | "stable_receipt";

/** Optional deterministic seam invoked immediately before each atomic replacement. */
export interface ApplyHookTopologyOptions {
	readonly beforeMutation?: (phase: HookMutationPhase, path: string) => Promise<void>;
}

/**
 * Resolve the repository's effective Git hook directory.
 *
 * @param repoRoot - Repository whose Git hook path is selected
 * @returns Absolute hook directory selected by Git
 * @throws {Error} When Git cannot resolve the hook path
 *
 * @example
 * ```typescript
 * const hookDirectory = await resolveGitHookPath(repoRoot)
 * ```
 */
export async function resolveGitHookPath(repoRoot: string): Promise<string> {
	const child = Bun.spawnSync(["git", "-C", repoRoot, "rev-parse", "--git-path", "hooks"], { stdout: "pipe", stderr: "pipe" });
	if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr).trim() || "Git hook path is unavailable.");
	const path = new TextDecoder().decode(child.stdout).trim();
	return isAbsolute(path) ? path : resolve(repoRoot, path);
}

/**
 * Inspect copied hooks and plan only mutations supported by immutable ownership evidence.
 *
 * @param sourceDir - Tracked hook source directory
 * @param destinationDir - Existing canonicalizable Git hook directory
 * @param stateRoot - Setup state root containing hook receipts
 * @param readDirectory - Optional deterministic source-directory reader
 * @returns Frozen hook operations, findings, and preserved paths
 *
 * @example
 * ```typescript
 * const plan = await inspectHookTopology(sourceHooks, gitHooks, stateRoot)
 * ```
 */
export async function inspectHookTopology(
	sourceDir: string,
	destinationDir: string,
	stateRoot: string,
	readDirectory: HookDirectoryReader = async (path) => readdir(path),
): Promise<HookTopologyPlan> {
	const operations: HookOperation[] = [];
	const findings: SetupFinding[] = [];
	const preserved: string[] = [];
	let names: string[] = [];
	try {
		names = await readDirectory(sourceDir);
	} catch (error) {
		findings.push(hookSourceFinding(sourceDir, error));
		return deepFreeze({ domain: "hooks", operations, findings, preserved });
	}
	for (const name of names.sort()) {
		const source = join(sourceDir, name);
		if (!(await isRegular(source))) continue;
		const identity = await hookProvenanceIdentity({ stateRoot, hookDirectory: destinationDir, hookName: name });
		const [sourceBytes, destination, receipt] = await Promise.all([
			readFile(source),
			inspectDestination(identity.destination),
			readHookProvenance(identity),
		]);
		const sourceDigest = hashHookBytes(sourceBytes);
		if (receipt.status === "invalid" || destination.shape === "other") {
			preserveUnproven(identity, receipt, findings, preserved);
			continue;
		}
		const operation = classifyOperation({ source, sourceDigest, identity, destination, receipt });
		if (operation) operations.push(operation);
		else if (!isHealthy(destination, receipt, sourceDigest)) preserveUnproven(identity, receipt, findings, preserved);
	}
	return deepFreeze({ domain: "hooks", operations, findings, preserved });
}

/**
 * Apply hook transactions serially and stop after the first changed or failed evidence path.
 *
 * @param plan - Frozen inspection evidence and selected hook operations
 * @param options - Optional mutation seam for deterministic race tests
 * @returns Exact planned, applied, deferred, preserved, and failed paths
 *
 * @example
 * ```typescript
 * const result = await applyHookTopology(plan)
 * ```
 */
export async function applyHookTopology(
	plan: HookTopologyPlan,
	options: ApplyHookTopologyOptions = {},
): Promise<SetupDomainResult> {
	const planned = unique(plan.operations.flatMap(operationPaths));
	const applied: string[] = [];
	const failed: string[] = [];
	const deferred: string[] = [];
	for (let index = 0; index < plan.operations.length; index += 1) {
		const operation = plan.operations[index];
		if (!operation) continue;
		try {
			await applyHookOperation(operation, options, applied);
		} catch (error) {
			failed.push(error instanceof HookMutationError ? error.path : operation.destination);
			deferred.push(...plan.operations.slice(index + 1).flatMap(operationPaths));
			break;
		}
	}
	return { domain: "hooks", planned, applied: unique(applied), deferred: unique(deferred), preserved: plan.preserved, failed: unique(failed) };
}

/**
 * Project an immutable hook plan into the shared read-only domain result shape.
 *
 * Keeps receipt-only backfills and hook-plus-receipt transactions visible to
 * status, check, and preflight callers without duplicating path semantics.
 *
 * @param plan - Hook topology plan produced from current filesystem evidence
 * @returns Read-only domain result with exact planned and preserved paths
 *
 * @example
 * ```typescript
 * const domain = projectHookTopologyPlan(await inspectHookTopology(source, hooks, stateRoot))
 * ```
 */
export function projectHookTopologyPlan(plan: HookTopologyPlan): SetupDomainResult {
	return {
		domain: "hooks",
		planned: unique(plan.operations.flatMap(operationPaths)),
		applied: [],
		deferred: [],
		preserved: plan.preserved,
		failed: [],
	};
}

function classifyOperation(input: {
	readonly source: string;
	readonly sourceDigest: string;
	readonly identity: HookProvenanceIdentity;
	readonly destination: HookDestinationEvidence;
	readonly receipt: Extract<HookProvenanceInspection, { readonly status: "missing" | "valid" }>;
}): HookOperation | undefined {
	const common = {
		source: input.source,
		destination: input.identity.destination,
		source_digest: input.sourceDigest,
		identity: input.identity,
		expected_destination: input.destination,
		expected_receipt: input.receipt,
	};
	if (input.destination.shape === "missing") {
		if (input.receipt.status === "missing") return { ...common, kind: "install", mutates_hook: true };
		const ownership = classifyHookOwnership(input.receipt.receipt, undefined);
		if (ownership === "pending_prior") return { ...common, kind: "recover_pending", mutates_hook: true };
		if (input.receipt.receipt.state === "stable") return { ...common, kind: "install", mutates_hook: true };
		return undefined;
	}
	if (input.destination.shape !== "file") return undefined;
	if (input.receipt.status === "missing") {
		if (input.destination.digest === input.sourceDigest) {
			return { ...common, kind: input.destination.executable ? "backfill_receipt" : "repair_mode", mutates_hook: !input.destination.executable };
		}
		return isRecognizedPreProvenanceHook(input.identity.hook, input.destination.digest)
			? { ...common, kind: "migrate", mutates_hook: true }
			: undefined;
	}
	const ownership = classifyHookOwnership(input.receipt.receipt, input.destination.digest);
	if (ownership === "unproven") return undefined;
	if (input.receipt.receipt.state === "pending") {
		return {
			...common,
			kind: "recover_pending",
			mutates_hook: input.destination.digest !== input.sourceDigest || !input.destination.executable,
		};
	}
	if (input.destination.digest !== input.sourceDigest) return { ...common, kind: "reconcile", mutates_hook: true };
	if (!input.destination.executable) return { ...common, kind: "repair_mode", mutates_hook: true };
	return undefined;
}

async function applyHookOperation(
	operation: HookOperation,
	options: ApplyHookTopologyOptions,
	applied: string[],
): Promise<void> {
	let destination = operation.expected_destination;
	let receipt = operation.expected_receipt;
	await assertEvidence(operation, destination, receipt);

	if (receipt.status === "valid" && receipt.receipt.state === "pending") {
		const ownership = classifyHookOwnership(
			receipt.receipt,
			destination.shape === "file" ? destination.digest : undefined,
		);
		if (ownership === "pending_desired" && destination.shape === "file") {
			receipt = await persistStable(operation, destination.digest, receipt.receipt.source_digest, destination, receipt, options, applied);
		} else if (ownership === "pending_prior" && destination.shape === "file") {
			receipt = await persistStable(operation, destination.digest, destination.digest, destination, receipt, options, applied);
		} else if (ownership !== "pending_prior" || destination.shape !== "missing") {
			throw new HookMutationError(operation.destination, "pending ownership changed");
		}
	}

	destination = await inspectDestination(operation.destination);
	await assertEvidence(operation, destination, receipt);
	if (destination.shape === "file" && destination.digest === operation.source_digest && destination.executable) {
		if (receipt.status === "valid" && receipt.receipt.state === "stable" && receipt.receipt.installed_digest === operation.source_digest) return;
		await persistStable(operation, operation.source_digest, operation.source_digest, destination, receipt, options, applied);
		return;
	}

	if (destination.shape === "other") throw new HookMutationError(operation.destination, "destination shape changed");
	if (destination.shape === "file" && destination.digest !== operation.source_digest) {
		const proven = receipt.status === "valid" && receipt.receipt.state === "stable"
			&& classifyHookOwnership(receipt.receipt, destination.digest) === "stable";
		if (!proven && !isRecognizedPreProvenanceHook(operation.identity.hook, destination.digest)) {
			throw new HookMutationError(operation.destination, "destination ownership changed");
		}
	}

	const pending: HookProvenanceReceipt = {
		schema_version: HOOK_PROVENANCE_SCHEMA_VERSION,
		state: "pending",
		hook: operation.identity.hook,
		destination: operation.identity.destination,
		prior: destination.shape === "missing" ? { state: "missing" } : { state: "digest", digest: destination.digest },
		desired_digest: operation.source_digest,
		source_digest: operation.source_digest,
	};
	receipt = await persistReceipt(operation, pending, destination, receipt, "pending_receipt", options, applied);
	await replaceHook(operation, destination, receipt, options);
	pushUnique(applied, operation.destination);
	destination = await inspectDestination(operation.destination);
	if (destination.shape !== "file" || destination.digest !== operation.source_digest || !destination.executable) {
		throw new HookMutationError(operation.destination, "hook replacement did not reach desired evidence");
	}
	await persistStable(operation, operation.source_digest, operation.source_digest, destination, receipt, options, applied);
}

async function persistStable(
	operation: HookOperation,
	installedDigest: string,
	sourceDigest: string,
	destination: HookDestinationEvidence,
	receipt: Extract<HookProvenanceInspection, { readonly status: "missing" | "valid" }>,
	options: ApplyHookTopologyOptions,
	applied: string[],
): Promise<Extract<HookProvenanceInspection, { readonly status: "valid" }>> {
	return persistReceipt(operation, {
		schema_version: HOOK_PROVENANCE_SCHEMA_VERSION,
		state: "stable",
		hook: operation.identity.hook,
		destination: operation.identity.destination,
		installed_digest: installedDigest,
		source_digest: sourceDigest,
	}, destination, receipt, "stable_receipt", options, applied);
}

async function persistReceipt(
	operation: HookOperation,
	next: HookProvenanceReceipt,
	destination: HookDestinationEvidence,
	receipt: Extract<HookProvenanceInspection, { readonly status: "missing" | "valid" }>,
	phase: Extract<HookMutationPhase, "pending_receipt" | "stable_receipt">,
	options: ApplyHookTopologyOptions,
	applied: string[],
): Promise<Extract<HookProvenanceInspection, { readonly status: "valid" }>> {
	await assertEvidence(operation, destination, receipt);
	try {
		await writeHookProvenance(operation.identity, next, {
			expected: receipt,
			beforeRename: async () => {
				await options.beforeMutation?.(phase, operation.identity.receipt_path);
				await assertSourceAndDestination(operation, destination);
			},
		});
	} catch (error) {
		if (error instanceof HookMutationError) throw error;
		throw new HookMutationError(operation.identity.receipt_path, error instanceof Error ? error.message : String(error));
	}
	pushUnique(applied, operation.identity.receipt_path);
	const current = await readHookProvenance(operation.identity);
	if (current.status !== "valid" || !sameHookProvenanceInspection(current, {
		status: "valid",
		path: operation.identity.receipt_path,
		receipt: next,
	})) {
		throw new HookMutationError(operation.identity.receipt_path, "receipt replacement did not reach desired evidence");
	}
	return current;
}

async function replaceHook(
	operation: HookOperation,
	destination: HookDestinationEvidence,
	receipt: Extract<HookProvenanceInspection, { readonly status: "valid" }>,
	options: ApplyHookTopologyOptions,
): Promise<void> {
	await assertEvidence(operation, destination, receipt);
	const bytes = await readFile(operation.source);
	if (hashHookBytes(bytes) !== operation.source_digest) throw new HookMutationError(operation.source, "source changed");
	const temporaryPath = join(dirname(operation.destination), `.${basename(operation.destination)}.${randomUUID()}.tmp`);
	try {
		await writeFile(temporaryPath, bytes, { flag: "wx", mode: 0o755 });
		await chmod(temporaryPath, 0o755);
		await options.beforeMutation?.("hook_replace", operation.destination);
		await assertEvidence(operation, destination, receipt);
		if (destination.shape === "missing") {
			await link(temporaryPath, operation.destination);
			await rm(temporaryPath);
		} else {
			await rename(temporaryPath, operation.destination);
		}
	} catch (error) {
		if (await sameHookDirectory(operation.identity)) await rm(temporaryPath, { force: true });
		if (error instanceof HookMutationError) throw error;
		throw new HookMutationError(operation.destination, error instanceof Error ? error.message : String(error));
	}
}

async function assertEvidence(
	operation: HookOperation,
	destination: HookDestinationEvidence,
	receipt: Extract<HookProvenanceInspection, { readonly status: "missing" | "valid" }>,
): Promise<void> {
	await assertSourceAndDestination(operation, destination);
	const currentReceipt = await readHookProvenance(operation.identity);
	if (!sameHookProvenanceInspection(currentReceipt, receipt)) throw new HookMutationError(operation.identity.receipt_path, "receipt changed");
}

async function assertSourceAndDestination(operation: HookOperation, destination: HookDestinationEvidence): Promise<void> {
	if (!(await sameHookDirectory(operation.identity))) {
		throw new HookMutationError(operation.destination, "hook directory changed");
	}
	let sourceDigest: string;
	try {
		sourceDigest = hashHookBytes(await readFile(operation.source));
	} catch {
		throw new HookMutationError(operation.source, "source changed");
	}
	if (sourceDigest !== operation.source_digest) throw new HookMutationError(operation.source, "source changed");
	if (!sameDestination(await inspectDestination(operation.destination), destination)) {
		throw new HookMutationError(operation.destination, "destination changed");
	}
}

async function sameHookDirectory(identity: HookProvenanceIdentity): Promise<boolean> {
	try {
		const entry = await lstat(identity.canonical_hook_directory);
		return entry.isDirectory()
			&& !entry.isSymbolicLink()
			&& Number(entry.dev) === identity.hook_directory_device
			&& Number(entry.ino) === identity.hook_directory_inode;
	} catch {
		return false;
	}
}

function sameDestination(left: HookDestinationEvidence, right: HookDestinationEvidence): boolean {
	if (left.shape !== right.shape) return false;
	if (left.shape !== "file" || right.shape !== "file") return true;
	return left.digest === right.digest && left.executable === right.executable;
}

async function inspectDestination(path: string): Promise<HookDestinationEvidence> {
	try {
		const stat = await lstat(path);
		if (!stat.isFile() || stat.isSymbolicLink()) return { shape: "other" };
		return {
			shape: "file",
			digest: hashHookBytes(await readFile(path)),
			executable: (stat.mode & 0o111) !== 0,
		};
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return { shape: "missing" };
		return { shape: "other" };
	}
}

function isHealthy(
	destination: HookDestinationEvidence,
	receipt: Extract<HookProvenanceInspection, { readonly status: "missing" | "valid" }>,
	sourceDigest: string,
): boolean {
	return destination.shape === "file"
		&& destination.executable
		&& destination.digest === sourceDigest
		&& receipt.status === "valid"
		&& receipt.receipt.state === "stable"
		&& receipt.receipt.installed_digest === destination.digest;
}

function preserveUnproven(
	identity: HookProvenanceIdentity,
	receipt: HookProvenanceInspection,
	findings: SetupFinding[],
	preserved: string[],
): void {
	findings.push({
		id: "hook_ownership_unproven",
		owner: "external",
		path: identity.destination,
		summary: "Git hook ownership is unproven; existing state is preserved.",
		why: receipt.status === "invalid" ? receipt.reason : "Destination bytes do not match current, migration, or recorded ownership evidence.",
		repair: "human_repair",
	});
	pushUnique(preserved, identity.destination);
	if (receipt.status !== "missing") pushUnique(preserved, receipt.path);
}

function operationPaths(operation: HookOperation): string[] {
	return operation.mutates_hook
		? [operation.destination, operation.identity.receipt_path]
		: [operation.identity.receipt_path];
}

function unique(paths: readonly string[]): string[] {
	return [...new Set(paths)];
}

function pushUnique(paths: string[], path: string): void {
	if (!paths.includes(path)) paths.push(path);
}

async function isRegular(path: string): Promise<boolean> {
	try { return (await lstat(path)).isFile(); } catch { return false; }
}

function hookSourceFinding(path: string, error: unknown): SetupFinding {
	const summary = hasErrorCode(error, "ENOENT")
		? "Git hook source directory is missing."
		: hasErrorCode(error, "EACCES") || hasErrorCode(error, "EPERM")
			? "Git hook source directory is unreadable."
			: hasErrorCode(error, "ENOTDIR")
				? "Git hook source path is not a directory."
				: "Git hook source directory could not be inspected.";
	return {
		id: "hook_unhealthy",
		owner: "setup.hooks",
		path,
		summary,
		why: error instanceof Error ? error.message : String(error),
		repair: "repair_hooks",
	};
}

class HookMutationError extends Error {
	readonly path: string;

	constructor(path: string, message: string) {
		super(message);
		this.path = path;
	}
}
