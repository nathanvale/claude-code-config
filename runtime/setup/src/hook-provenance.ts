import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { canonicalPath, hasErrorCode } from "./path-safety.ts";

/** Current on-disk hook provenance schema. */
export const HOOK_PROVENANCE_SCHEMA_VERSION = 1 as const;

const HOOK_PROVENANCE_NAMESPACE = "hook-provenance";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PRE_COMMIT_MIGRATION_DIGESTS = new Set([
	"462ff0f88ce44e72474d8aea4a0bbf567962d1604d6b43b955e949d59652eede",
	"c58eb459e043374bf66e5da2a65fe4f9e4d8ce3aca1daeb9127087e296fe517f",
]);

/** Canonical identity and state location for one copied hook. */
export interface HookProvenanceIdentity {
	readonly state_root: string;
	readonly namespace_path: string;
	readonly canonical_hook_directory: string;
	readonly hook_directory_device: number;
	readonly hook_directory_inode: number;
	readonly hook: string;
	readonly destination: string;
	readonly receipt_path: string;
}

/** Stable evidence that the installed bytes were written from a known source. */
export interface StableHookProvenanceReceipt {
	readonly schema_version: typeof HOOK_PROVENANCE_SCHEMA_VERSION;
	readonly state: "stable";
	readonly hook: string;
	readonly destination: string;
	readonly installed_digest: string;
	readonly source_digest: string;
}

/** Prior destination state retained while an atomic hook transition is incomplete. */
export type PendingHookPrior =
	| { readonly state: "missing" }
	| { readonly state: "digest"; readonly digest: string };

/** Recoverable evidence written before replacing copied hook bytes. */
export interface PendingHookProvenanceReceipt {
	readonly schema_version: typeof HOOK_PROVENANCE_SCHEMA_VERSION;
	readonly state: "pending";
	readonly hook: string;
	readonly destination: string;
	readonly prior: PendingHookPrior;
	readonly desired_digest: string;
	readonly source_digest: string;
}

/** Valid receipt states accepted by Setup. */
export type HookProvenanceReceipt = StableHookProvenanceReceipt | PendingHookProvenanceReceipt;

/** Read-only receipt inspection. Invalid evidence grants no ownership. */
export type HookProvenanceInspection =
	| { readonly status: "missing"; readonly path: string }
	| { readonly status: "invalid"; readonly path: string; readonly reason: string }
	| { readonly status: "valid"; readonly path: string; readonly receipt: HookProvenanceReceipt };

/** Destination relationship to valid stable or pending evidence. */
export type HookOwnershipClassification =
	| "stable"
	| "pending_prior"
	| "pending_desired"
	| "unproven";

/**
 * Derive stable provenance identity before the destination itself exists.
 *
 * @param input - Existing hook directory, basename, and Setup state root
 * @returns Canonical destination identity and its deterministic receipt path
 * @throws {Error} When the hook directory is missing or the hook name is not a basename
 *
 * @example
 * ```typescript
 * const identity = await hookProvenanceIdentity({ stateRoot, hookDirectory, hookName: "pre-commit" })
 * ```
 */
export async function hookProvenanceIdentity(input: {
	readonly stateRoot: string;
	readonly hookDirectory: string;
	readonly hookName: string;
}): Promise<HookProvenanceIdentity> {
	if (!validHookName(input.hookName)) throw new Error(`Invalid hook basename: ${input.hookName}`);
	const canonicalHookDirectory = await canonicalPath(input.hookDirectory);
	const directoryEntry = await lstat(canonicalHookDirectory);
	if (!directoryEntry.isDirectory()) throw new Error(`Hook directory is not a directory: ${input.hookDirectory}`);
	const stateRoot = resolve(input.stateRoot);
	const namespacePath = join(stateRoot, HOOK_PROVENANCE_NAMESPACE);
	const key = createHash("sha256")
		.update(canonicalHookDirectory)
		.update("\0")
		.update(input.hookName)
		.digest("hex");
	return {
		state_root: stateRoot,
		namespace_path: namespacePath,
		canonical_hook_directory: canonicalHookDirectory,
		hook_directory_device: Number(directoryEntry.dev),
		hook_directory_inode: Number(directoryEntry.ino),
		hook: input.hookName,
		destination: join(canonicalHookDirectory, input.hookName),
		receipt_path: join(namespacePath, `${input.hookName}-${key}.json`),
	};
}

/**
 * Inspect receipt evidence without creating state or following a linked receipt.
 *
 * @param identity - Canonical hook and receipt identity
 * @returns Missing, invalid, or destination-bound valid evidence
 *
 * @example
 * ```typescript
 * const evidence = await readHookProvenance(identity)
 * ```
 */
export async function readHookProvenance(identity: HookProvenanceIdentity): Promise<HookProvenanceInspection> {
	const identityError = validateIdentity(identity);
	if (identityError) return invalid(identity.receipt_path, identityError);
	const namespaceEntry = await statOrMissing(identity.namespace_path);
	if (namespaceEntry === undefined) return { status: "missing", path: identity.receipt_path };
	if (!namespaceEntry.isDirectory() || namespaceEntry.isSymbolicLink()) {
		return invalid(identity.receipt_path, "provenance namespace is linked or not a directory");
	}
	const entry = await statOrMissing(identity.receipt_path);
	if (entry === undefined) return { status: "missing", path: identity.receipt_path };
	if (!entry.isFile() || entry.isSymbolicLink()) return invalid(identity.receipt_path, "receipt is linked or not a regular file");
	if ((Number(entry.mode) & 0o077) !== 0) return invalid(identity.receipt_path, "receipt permissions are not restrictive");
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(identity.receipt_path, "utf8"));
	} catch {
		return invalid(identity.receipt_path, "receipt is not valid JSON");
	}
	const receipt = parseReceipt(parsed, identity);
	return receipt
		? { status: "valid", path: identity.receipt_path, receipt }
		: invalid(identity.receipt_path, "receipt schema or identity is invalid");
}

/**
 * Atomically replace one receipt after revalidating the caller's inspection.
 *
 * @param identity - Canonical hook and receipt identity
 * @param receipt - Complete destination-bound evidence to persist
 * @param options - Expected prior inspection and optional test seam before replacement
 * @throws {Error} When evidence changed, paths are unsafe, or the atomic write fails
 *
 * @example
 * ```typescript
 * await writeHookProvenance(identity, receipt, { expected: inspection })
 * ```
 */
export async function writeHookProvenance(
	identity: HookProvenanceIdentity,
	receipt: HookProvenanceReceipt,
	options: {
		readonly expected: Extract<HookProvenanceInspection, { readonly status: "missing" | "valid" }>;
		readonly beforeRename?: (temporaryPath: string) => Promise<void>;
	},
): Promise<void> {
	const identityError = validateIdentity(identity);
	if (identityError) throw new Error(identityError);
	if (!parseReceipt(receipt, identity)) throw new Error("Refusing to write invalid hook provenance receipt");
	await ensureStateDirectory(identity.state_root);
	await ensureStateDirectory(identity.namespace_path);
	const temporaryPath = join(identity.namespace_path, `.${basename(identity.receipt_path)}.${randomUUID()}.tmp`);
	try {
		await writeFile(temporaryPath, `${JSON.stringify(receipt)}\n`, { flag: "wx", mode: 0o600 });
		await chmod(temporaryPath, 0o600);
		await options.beforeRename?.(temporaryPath);
		const current = await readHookProvenance(identity);
		if (!sameHookProvenanceInspection(current, options.expected)) throw new Error("Hook provenance changed during atomic write");
		await rename(temporaryPath, identity.receipt_path);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

/**
 * Classify current destination bytes against valid receipt evidence.
 *
 * @param receipt - Valid stable or pending evidence
 * @param destinationDigest - Current digest, or undefined when destination is missing
 * @returns The exact owned transition state, otherwise `unproven`
 *
 * @example
 * ```typescript
 * const state = classifyHookOwnership(receipt, currentDigest)
 * ```
 */
export function classifyHookOwnership(
	receipt: HookProvenanceReceipt,
	destinationDigest: string | undefined,
): HookOwnershipClassification {
	if (receipt.state === "stable") return destinationDigest === receipt.installed_digest ? "stable" : "unproven";
	if (destinationDigest === receipt.desired_digest) return "pending_desired";
	if (receipt.prior.state === "missing") return destinationDigest === undefined ? "pending_prior" : "unproven";
	return destinationDigest === receipt.prior.digest ? "pending_prior" : "unproven";
}

/**
 * Hash hook bytes using the receipt contract's SHA-256 encoding.
 *
 * @param bytes - Exact hook payload bytes
 * @returns Lowercase hexadecimal SHA-256 digest
 *
 * @example
 * ```typescript
 * const digest = hashHookBytes(await Bun.file(path).bytes())
 * ```
 */
export function hashHookBytes(bytes: string | Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Recognize only the two frozen pre-provenance pre-commit payloads.
 *
 * @param hook - Hook basename being inspected
 * @param digest - Exact installed payload digest
 * @returns Whether Setup may bootstrap ownership from frozen migration evidence
 *
 * @example
 * ```typescript
 * isRecognizedPreProvenanceHook("pre-commit", digest)
 * ```
 */
export function isRecognizedPreProvenanceHook(hook: string, digest: string): boolean {
	return hook === "pre-commit" && PRE_COMMIT_MIGRATION_DIGESTS.has(digest);
}

/**
 * Compare receipt inspections using the provenance schema's typed fields.
 *
 * @param left - First missing, invalid, or valid inspection
 * @param right - Second missing, invalid, or valid inspection
 * @returns Whether both inspections describe the same receipt evidence
 *
 * @example
 * ```typescript
 * if (!sameHookProvenanceInspection(current, expected)) throw new Error("receipt changed")
 * ```
 */
export function sameHookProvenanceInspection(
	left: HookProvenanceInspection,
	right: HookProvenanceInspection,
): boolean {
	if (left.status !== right.status || left.path !== right.path) return false;
	if (left.status === "missing" || right.status === "missing") return true;
	if (left.status === "invalid" || right.status === "invalid") {
		return left.status === "invalid" && right.status === "invalid" && left.reason === right.reason;
	}
	return sameReceipt(left.receipt, right.receipt);
}

function parseReceipt(value: unknown, identity: HookProvenanceIdentity): HookProvenanceReceipt | undefined {
	if (!record(value)) return undefined;
	if (value.schema_version !== HOOK_PROVENANCE_SCHEMA_VERSION || value.hook !== identity.hook || value.destination !== identity.destination) return undefined;
	if (!digest(value.source_digest)) return undefined;
	if (value.state === "stable") {
		if (!exactKeys(value, ["schema_version", "state", "hook", "destination", "installed_digest", "source_digest"])) return undefined;
		return digest(value.installed_digest) ? value as unknown as StableHookProvenanceReceipt : undefined;
	}
	if (value.state !== "pending" || !exactKeys(value, ["schema_version", "state", "hook", "destination", "prior", "desired_digest", "source_digest"])) return undefined;
	if (!digest(value.desired_digest) || !record(value.prior)) return undefined;
	if (value.prior.state === "missing" && exactKeys(value.prior, ["state"])) return value as unknown as PendingHookProvenanceReceipt;
	if (value.prior.state === "digest" && exactKeys(value.prior, ["state", "digest"]) && digest(value.prior.digest)) return value as unknown as PendingHookProvenanceReceipt;
	return undefined;
}

function validateIdentity(identity: HookProvenanceIdentity): string | undefined {
	if (!validHookName(identity.hook)) return "invalid hook basename";
	if (!Number.isSafeInteger(identity.hook_directory_device) || !Number.isSafeInteger(identity.hook_directory_inode)) {
		return "invalid hook directory identity";
	}
	if (identity.destination !== join(identity.canonical_hook_directory, identity.hook)) return "destination does not match hook identity";
	if (identity.namespace_path !== join(identity.state_root, HOOK_PROVENANCE_NAMESPACE)) return "namespace escapes state root";
	if (dirname(identity.receipt_path) !== identity.namespace_path) return "receipt escapes provenance namespace";
	return undefined;
}

function validHookName(value: string): boolean {
	return value !== "" && value !== "." && value !== ".." && basename(value) === value && !value.includes("\0");
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digest(value: unknown): value is string {
	return typeof value === "string" && SHA256_PATTERN.test(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function invalid(path: string, reason: string): HookProvenanceInspection {
	return { status: "invalid", path, reason };
}

async function statOrMissing(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
	try {
		return await lstat(path);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return undefined;
		throw error;
	}
}

async function ensureStateDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	const entry = await lstat(path);
	if (!entry.isDirectory() || entry.isSymbolicLink() || (Number(entry.mode) & 0o022) !== 0) {
		throw new Error(`Unsafe hook provenance state directory: ${path}`);
	}
}

function sameReceipt(left: HookProvenanceReceipt, right: HookProvenanceReceipt): boolean {
	if (
		left.schema_version !== right.schema_version
		|| left.state !== right.state
		|| left.hook !== right.hook
		|| left.destination !== right.destination
		|| left.source_digest !== right.source_digest
	) return false;
	if (left.state === "stable" || right.state === "stable") {
		return left.state === "stable" && right.state === "stable"
			&& left.installed_digest === right.installed_digest;
	}
	if (left.desired_digest !== right.desired_digest || left.prior.state !== right.prior.state) return false;
	return left.prior.state === "missing" || (
		right.prior.state === "digest" && left.prior.digest === right.prior.digest
	);
}
