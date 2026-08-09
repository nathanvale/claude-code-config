import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import {
	chmod,
	link,
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	unlink,
} from "node:fs/promises";
import { join } from "node:path";
import type { FileHandle } from "node:fs/promises";

import {
	VAULT_GIT_EVENT_TYPES,
	VAULT_GIT_RECEIPT_NEXT_ACTIONS,
	VAULT_GIT_RECEIPT_TRANSITIONS,
	VAULT_GIT_TRANSACTION_PHASES,
	type VaultGitReceipt,
} from "./model.ts";

/**
 * Capability roles issued for one transaction.
 *
 * - `owner` -- may complete, record phases, and close the transaction
 * - `join` -- may only extend owned paths inside the writing phase
 */
export type VaultGitCapabilityRole = "owner" | "join";

/**
 * Structured conflict raised when another writer published the current
 * receipt first. Callers match on the stable `code` instead of message text.
 *
 * @example
 * ```typescript
 * try {
 *   await store.initialize(receipt)
 * } catch (error) {
 *   if (error instanceof VaultGitReceiptExistsError) inspectExisting()
 *   else throw error
 * }
 * ```
 */
export class VaultGitReceiptExistsError extends Error {
	/** Stable machine-readable conflict code. */
	readonly code = "receipt_exists";
	constructor() {
		super("current receipt already exists");
		this.name = "VaultGitReceiptExistsError";
	}
}

/** Stable durable-file category; never emitted by command output. */
export type VaultGitDurabilityTarget = "history" | "current" | "capability";

/** One observable load-bearing filesystem operation. */
export interface VaultGitDurabilityOperation {
	/** Operation completed before the observer runs. */
	readonly kind: "temp_write" | "file_sync" | "rename" | "directory_sync";
	/** Stable file category; never emitted by command output. */
	readonly target: VaultGitDurabilityTarget;
}

/**
 * Load-bearing filesystem durability boundary owned by the receipt store.
 *
 * The store performs every durability-critical operation only through this
 * port, in the fixed order temp write, file sync, atomic publish, parent
 * directory sync. Tests inject a recording or throwing implementation to
 * prove the sequence and fail-closed behavior; production uses
 * {@link createNodeVaultGitDurabilityPort}.
 */
export interface VaultGitDurabilityPort {
	/** Write every byte into an open exclusive temp file. */
	writeTemp(
		handle: FileHandle,
		bytes: Uint8Array,
		target: VaultGitDurabilityTarget,
	): Promise<void>;
	/** Flush written file contents to stable storage before publication. */
	syncFile(handle: FileHandle, target: VaultGitDurabilityTarget): Promise<void>;
	/** Atomically replace the destination with an already-synced temp file. */
	rename(
		from: string,
		to: string,
		target: VaultGitDurabilityTarget,
	): Promise<void>;
	/** Publish an already-synced temp file only when the destination is absent. */
	linkExclusive(
		from: string,
		to: string,
		target: VaultGitDurabilityTarget,
	): Promise<void>;
	/** Flush the directory entry so a publish survives power loss. */
	syncDirectory(path: string, target: VaultGitDurabilityTarget): Promise<void>;
}

/**
 * Create the production durability port backed by real syscalls.
 *
 * @returns Durability port over fsync, rename, link(2), and directory fsync
 *
 * @example
 * ```typescript
 * const store = createReceiptStore({
 *   stateRoot: "/home/agent/.local/state",
 *   repositoryIdentity: "vault@example",
 *   durability: createNodeVaultGitDurabilityPort(),
 * })
 * ```
 */
export function createNodeVaultGitDurabilityPort(): VaultGitDurabilityPort {
	return {
		async writeTemp(handle, bytes) {
			await handle.writeFile(bytes);
		},
		async syncFile(handle) {
			await handle.sync();
		},
		async rename(from, to) {
			await rename(from, to);
		},
		async linkExclusive(from, to) {
			await link(from, to);
		},
		async syncDirectory(path) {
			const directory = await open(path, "r");
			try {
				await directory.sync();
			} finally {
				await directory.close();
			}
		},
	};
}

/** Receipt store construction options. */
export interface VaultGitReceiptStoreOptions {
	/** Injected XDG state root. */
	readonly stateRoot: string;
	/** Stable, non-secret canonical repository identity. */
	readonly repositoryIdentity: string;
	/** Load-bearing durability operations. @defaultValue node syscall port */
	readonly durability?: VaultGitDurabilityPort;
	/** Test interruption and operation-order observer. */
	readonly onDurabilityOperation?: (
		operation: VaultGitDurabilityOperation,
	) => void;
}

/** Private capability bytes created for a new receipt. */
export interface VaultGitCapabilities {
	readonly ownerCapability: Uint8Array;
	readonly joinCapability: Uint8Array;
}

/** Valid receipt state loaded from private storage. */
export interface VaultGitReceiptLoaded {
	readonly status: "loaded";
	readonly receipt: VaultGitReceipt;
	readonly history: readonly VaultGitReceipt[];
	readonly historyPaths: readonly string[];
}

/** Fail-closed private receipt load result. */
export type VaultGitReceiptLoadResult =
	| { readonly status: "absent" }
	| VaultGitReceiptLoaded
	| { readonly status: "corrupt"; readonly reason: string }
	| { readonly status: "conflict"; readonly reason: string };

/** Private receipt and capability store. */
export interface VaultGitReceiptStore {
	/** Stable repository identity digest. */
	readonly repositoryId: string;
	/** Private paths for inspection and adapter tests. */
	readonly paths: {
		readonly repositoryRoot: string;
		readonly current: string;
		readonly history: string;
		readonly capabilities: string;
	};
	/** Create first history entry, pointer, and role capabilities. */
	initialize(
		receipt: VaultGitReceipt,
		capabilities?: VaultGitCapabilities,
	): Promise<VaultGitCapabilities>;
	/** Append one revision without replacing immutable history. */
	append(receipt: VaultGitReceipt): Promise<void>;
	/** Load and validate current state and complete history. */
	load(): Promise<VaultGitReceiptLoadResult>;
	/** Resolve one private role file path. */
	capabilityPath(receiptId: string, role: VaultGitCapabilityRole): string;
	/** Read capability bytes for an inherited-descriptor launcher. */
	readCapability(receiptId: string, role: VaultGitCapabilityRole): Promise<Uint8Array>;
	/** Constant-time role validation for bytes read from an inherited descriptor. */
	validateCapability(
		receiptId: string,
		role: VaultGitCapabilityRole,
		candidate: Uint8Array,
	): Promise<boolean>;
}

/** Internal capability-launch request. */
export interface VaultGitCapabilityLaunchRequest {
	readonly receiptId: string;
	readonly role: VaultGitCapabilityRole;
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly timeoutMs: number;
	/** Inherited descriptor number. @defaultValue 3 */
	readonly descriptor?: number;
}

/** Bounded internal capability-launch result. */
export interface VaultGitCapabilityLaunchResult {
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
	readonly timedOut: boolean;
}

/**
 * Create one repository-scoped private receipt store.
 *
 * @param options - Injected XDG root and stable repository identity
 * @returns Crash-safe receipt and capability operations
 * @throws {Error} When the state root or repository identity is empty
 *
 * @example
 * ```typescript
 * const store = createReceiptStore({
 *   stateRoot: "/home/agent/.local/state",
 *   repositoryIdentity: "vault@example",
 * })
 * const loaded = await store.load()
 * if (loaded.status === "absent") await store.initialize(firstReceipt)
 * ```
 */
export function createReceiptStore(
	options: VaultGitReceiptStoreOptions,
): VaultGitReceiptStore {
	if (options.stateRoot.length === 0 || options.repositoryIdentity.length === 0) {
		throw new Error("state root and repository identity must not be empty");
	}
	const durability = observedDurabilityPort(
		options.durability ?? createNodeVaultGitDurabilityPort(),
		options.onDurabilityOperation,
	);
	const repositoryId = createHash("sha256")
		.update(options.repositoryIdentity)
		.digest("hex");
	const repositoryRoot = join(
		options.stateRoot,
		"vault-git-transaction-manager",
		repositoryId,
	);
	const paths = {
		repositoryRoot,
		current: join(repositoryRoot, "current.json"),
		history: join(repositoryRoot, "history"),
		capabilities: join(repositoryRoot, "capabilities"),
	} as const;

	async function prepare(): Promise<void> {
		for (const path of [
			join(options.stateRoot, "vault-git-transaction-manager"),
			repositoryRoot,
			paths.history,
			paths.capabilities,
		]) {
			await mkdir(path, { recursive: true, mode: 0o700 });
			const metadata = await lstat(path);
			if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
				throw new Error("private state path is not a directory");
			}
			await chmod(path, 0o700);
			if (((await lstat(path)).mode & 0o777) !== 0o700) {
				throw new Error("private state directory permissions unavailable");
			}
		}
	}

	function capabilityPath(
		receiptId: string,
		role: VaultGitCapabilityRole,
	): string {
		assertReceiptId(receiptId);
		return join(paths.capabilities, `${receiptId}.${role}`);
	}

	return {
		repositoryId,
		paths,
		capabilityPath,
		async initialize(receipt, capabilities = createCapabilities()) {
			validateReceipt(receipt);
			if (receipt.revision !== 1) throw new Error("initial receipt revision must be 1");
			await prepare();
			const existing = await loadReceiptState(paths);
			if (existing.status !== "absent") {
				if (existing.status !== "loaded" || existing.receipt.phase !== "closed") {
					throw new VaultGitReceiptExistsError();
				}
				// A closed pointer may be superseded; losing it mid-crash is safe
				// because the closed chain stays in immutable history.
				await unlink(paths.current).catch((error) => {
					if (!isMissing(error)) throw error;
				});
			}
			// Capabilities land before the pointer publish: an orphan capability
			// file with no pointer is harmless, while a pointer without its
			// capabilities strands the transaction.
			await durableWrite(historyPath(paths.history, receipt), receipt, "history", durability);
			await durableBytes(capabilityPath(receipt.receiptId, "owner"), capabilities.ownerCapability, durability);
			await durableBytes(capabilityPath(receipt.receiptId, "join"), capabilities.joinCapability, durability);
			await durablePublishExclusive(paths.current, receipt, durability);
			return copyCapabilities(capabilities);
		},
		async append(receipt) {
			validateReceipt(receipt);
			await prepare();
			const loaded = await loadReceiptState(paths);
			if (loaded.status !== "loaded") throw new Error(`cannot append receipt: ${loaded.status}`);
			assertAppend(loaded.receipt, receipt);
			await durableWrite(historyPath(paths.history, receipt), receipt, "history", durability);
			await durableWrite(paths.current, receipt, "current", durability);
		},
		async load() {
			return loadReceiptState(paths);
		},
		async readCapability(receiptId, role) {
			const path = capabilityPath(receiptId, role);
			const metadata = await lstat(path);
			if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
				throw new Error("capability file is not private");
			}
			return new Uint8Array(await readFile(path));
		},
		async validateCapability(receiptId, role, candidate) {
			const expected = await this.readCapability(receiptId, role);
			return expected.byteLength === candidate.byteLength && timingSafeEqual(expected, candidate);
		},
	};
}

/**
 * Create independent 256-bit owner and join capability values.
 *
 * Both roles are freshly random so leaking one never derives the other.
 *
 * @returns Private capability bytes for one new receipt
 *
 * @example
 * ```typescript
 * const capabilities = createCapabilities()
 * await store.initialize(receipt, capabilities)
 * ```
 */
export function createCapabilities(): VaultGitCapabilities {
	return {
		ownerCapability: new Uint8Array(randomBytes(32)),
		joinCapability: new Uint8Array(randomBytes(32)),
	};
}

/**
 * Launch one short-lived process with private capability bytes on an inherited
 * descriptor. The launcher itself never copies capability material into argv,
 * environment, or captured output. Same-UID child cooperation remains assumed.
 *
 * @param store - Private receipt store
 * @param request - Role and bounded subprocess request
 * @returns Captured ordinary output and exit state
 * @throws {Error} When the descriptor is outside 3-64 or the timeout is not positive
 * @throws {Error} When the capability file is missing, non-private, or delivery fails
 *
 * @example
 * ```typescript
 * const launched = await launchCapabilityProcess(store, {
 *   receiptId: receipt.receiptId,
 *   role: "owner",
 *   command: process.execPath,
 *   args: ["worker.ts"],
 *   cwd: repositoryRoot,
 *   timeoutMs: 5_000,
 * })
 * if (launched.exitCode !== 0) inspectFailure(launched.stderr)
 * ```
 */
export async function launchCapabilityProcess(
	store: VaultGitReceiptStore,
	request: VaultGitCapabilityLaunchRequest,
): Promise<VaultGitCapabilityLaunchResult> {
	const descriptor = request.descriptor ?? 3;
	if (!Number.isSafeInteger(descriptor) || descriptor < 3 || descriptor > 64) {
		throw new Error("capability descriptor must be between 3 and 64");
	}
	if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) {
		throw new Error("capability launch timeout must be positive");
	}
	const capability = await store.readCapability(request.receiptId, request.role);
	const stdio: Array<"ignore" | "pipe"> = ["ignore", "pipe", "pipe"];
	while (stdio.length <= descriptor) stdio.push("pipe");
	return new Promise((resolve, reject) => {
		const child = spawn(
			request.command,
			[...request.args, "--capability-fd", String(descriptor)],
			{ cwd: request.cwd, stdio },
		);
		let stdout = "";
		let stderr = "";
		let settled = false;
		let timedOut = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (result: VaultGitCapabilityLaunchResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};
		const fail = (error: Error): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.kill("SIGKILL");
			reject(error);
		};
		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
		child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
		const capabilityPipe = child.stdio[descriptor];
		if (!capabilityPipe || !("write" in capabilityPipe)) {
			fail(new Error("capability descriptor unavailable"));
			return;
		}
		// The error listener must exist before end(): a child that exits without
		// reading the descriptor raises EPIPE, which would otherwise crash the
		// process as an unhandled stream error.
		capabilityPipe.on("error", (error) => {
			fail(new Error("capability delivery failed", { cause: error }));
		});
		capabilityPipe.end(capability);
		timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, request.timeoutMs);
		child.once("error", (error) => {
			fail(error instanceof Error ? error : new Error(String(error)));
		});
		child.once("close", (exitCode) => {
			finish({ exitCode, stdout, stderr, timedOut });
		});
	});
}

async function durableWrite(
	path: string,
	receipt: VaultGitReceipt,
	target: VaultGitDurabilityTarget,
	durability: VaultGitDurabilityPort,
): Promise<void> {
	await durableBytes(path, new TextEncoder().encode(`${JSON.stringify(receipt)}\n`), durability, target);
}

/**
 * Publish one file only when no file exists at the destination.
 *
 * Preserves the temp-write, file-sync, atomic-publish, parent-sync durability
 * order: link(2) publishes the already-synced inode and fails with EEXIST
 * when a concurrent writer won, so a racing loser can never overwrite.
 */
async function durablePublishExclusive(
	path: string,
	receipt: VaultGitReceipt,
	durability: VaultGitDurabilityPort,
): Promise<void> {
	const bytes = new TextEncoder().encode(`${JSON.stringify(receipt)}\n`);
	const temporary = `${path}.tmp-${randomUUID()}`;
	let handle: FileHandle | undefined;
	try {
		handle = await open(temporary, "wx", 0o600);
		await durability.writeTemp(handle, bytes, "current");
		await durability.syncFile(handle, "current");
		await handle.close();
		handle = undefined;
		try {
			await durability.linkExclusive(temporary, path, "current");
		} catch (error) {
			if (isExists(error)) throw new VaultGitReceiptExistsError();
			throw error;
		}
		await durability.syncDirectory(join(path, ".."), "current");
	} catch (error) {
		if (handle) await handle.close().catch(() => undefined);
		await unlink(temporary).catch(() => undefined);
		if (error instanceof VaultGitReceiptExistsError) throw error;
		throw new Error("receipt durability unavailable", { cause: error });
	}
	await unlink(temporary).catch(() => undefined);
}

async function durableBytes(
	path: string,
	bytes: Uint8Array,
	durability: VaultGitDurabilityPort,
	target: VaultGitDurabilityTarget = "capability",
): Promise<void> {
	if (bytes.byteLength === 0) throw new Error("private file must not be empty");
	const temporary = `${path}.tmp-${randomUUID()}`;
	let handle: FileHandle | undefined;
	try {
		handle = await open(temporary, "wx", 0o600);
		await durability.writeTemp(handle, bytes, target);
		await durability.syncFile(handle, target);
		await handle.close();
		handle = undefined;
		await durability.rename(temporary, path, target);
		await chmod(path, 0o600);
		await durability.syncDirectory(join(path, ".."), target);
	} catch (error) {
		if (handle) await handle.close().catch(() => undefined);
		await unlink(temporary).catch(() => undefined);
		throw new Error("receipt durability unavailable", { cause: error });
	}
}

/** Wrap a durability port so each completed operation notifies the observer. */
function observedDurabilityPort(
	port: VaultGitDurabilityPort,
	observer?: (operation: VaultGitDurabilityOperation) => void,
): VaultGitDurabilityPort {
	if (!observer) return port;
	return {
		async writeTemp(handle, bytes, target) {
			await port.writeTemp(handle, bytes, target);
			observer({ kind: "temp_write", target });
		},
		async syncFile(handle, target) {
			await port.syncFile(handle, target);
			observer({ kind: "file_sync", target });
		},
		async rename(from, to, target) {
			await port.rename(from, to, target);
			observer({ kind: "rename", target });
		},
		async linkExclusive(from, to, target) {
			await port.linkExclusive(from, to, target);
			observer({ kind: "rename", target });
		},
		async syncDirectory(path, target) {
			await port.syncDirectory(path, target);
			observer({ kind: "directory_sync", target });
		},
	};
}

async function loadReceiptState(paths: VaultGitReceiptStore["paths"]): Promise<VaultGitReceiptLoadResult> {
	let currentText: string;
	try {
		currentText = await readPrivateText(paths.current);
	} catch (error) {
		if (isMissing(error)) return { status: "absent" };
		return { status: "corrupt", reason: "current receipt unreadable" };
	}
	const current = parseReceipt(currentText);
	if (!current) return { status: "corrupt", reason: "current receipt malformed" };
	try {
		await Promise.all([
			assertPrivateDirectory(paths.repositoryRoot),
			assertPrivateDirectory(paths.history),
			assertPrivateDirectory(paths.capabilities),
		]);
	} catch {
		return { status: "corrupt", reason: "private receipt directory permissions invalid" };
	}
	let names: string[];
	try {
		names = (await readdir(paths.history)).filter((name) => name.endsWith(".json")).sort();
	} catch {
		return { status: "corrupt", reason: "receipt history unreadable" };
	}
	const history: VaultGitReceipt[] = [];
	const historyPaths: string[] = [];
	for (const name of names) {
		const path = join(paths.history, name);
		const parsed = parseReceipt(await readPrivateText(path).catch(() => ""));
		if (!parsed) return { status: "corrupt", reason: "receipt history malformed" };
		if (parsed.receiptId !== current.receiptId) continue;
		history.push(parsed);
		historyPaths.push(path);
	}
	if (history.length === 0) return { status: "conflict", reason: "current receipt lacks history" };
	for (let index = 0; index < history.length; index++) {
		if (history[index]?.revision !== index + 1) return { status: "conflict", reason: "receipt history revision gap" };
		if (index > 0) {
			const previous = history[index - 1];
			const next = history[index];
			if (!previous || !next) return { status: "conflict", reason: "receipt history missing" };
			try { assertAppend(previous, next); } catch { return { status: "conflict", reason: "receipt history conflicts" }; }
		}
	}
	const matching = history.find((entry) => entry.revision === current.revision);
	if (!matching || JSON.stringify(matching) !== JSON.stringify(current)) {
		return { status: "conflict", reason: "current pointer conflicts with history" };
	}
	// A history entry may have landed before an interrupted pointer update.
	const latest = history.at(-1);
	if (!latest) return { status: "conflict", reason: "current receipt lacks history" };
	return { status: "loaded", receipt: latest, history, historyPaths };
}

async function readPrivateText(path: string): Promise<string> {
	const metadata = await lstat(path);
	if (
		!metadata.isFile() ||
		metadata.isSymbolicLink() ||
		(metadata.mode & 0o777) !== 0o600
	) {
		throw new Error("private receipt permissions invalid");
	}
	return readFile(path, "utf8");
}

async function assertPrivateDirectory(path: string): Promise<void> {
	const metadata = await lstat(path);
	if (
		!metadata.isDirectory() ||
		metadata.isSymbolicLink() ||
		(metadata.mode & 0o777) !== 0o700
	) {
		throw new Error("private state directory permissions invalid");
	}
}

function historyPath(directory: string, receipt: VaultGitReceipt): string {
	return join(directory, `${receipt.receiptId}-${String(receipt.revision).padStart(8, "0")}.json`);
}

function parseReceipt(text: string): VaultGitReceipt | null {
	try {
		const value: unknown = JSON.parse(text);
		validateReceipt(value);
		return value;
	} catch {
		return null;
	}
}

function validateReceipt(value: unknown): asserts value is VaultGitReceipt {
	if (!isRecord(value)) throw new Error("receipt must be an object");
	if (
		!hasExactKeys(value, [
			"schemaVersion", "receiptId", "transactionId", "revision", "phase",
			"transition", "recordedAt", "event", "actor", "host", "remote",
			"ownedPaths", "localMainHead", "remoteMainHead",
			"expectedLeaseGeneration", "leaseGeneration", "leaseAcquiredAt",
			"leaseDurationMs", "commitId", "nextSafeAction",
			"diagnosticsReference",
		]) ||
		value.schemaVersion !== 1 ||
		!isReceiptId(value.receiptId) ||
		(value.transactionId !== null && !isTransactionId(value.transactionId)) ||
		!Number.isSafeInteger(value.revision) || (value.revision as number) < 1 ||
		!VAULT_GIT_TRANSACTION_PHASES.includes(value.phase as never) ||
		value.phase === "unavailable" || value.phase === "inspecting" ||
		!VAULT_GIT_RECEIPT_TRANSITIONS.includes(value.transition as never) ||
		!isIso(value.recordedAt) ||
		!VAULT_GIT_EVENT_TYPES.includes(value.event as never) ||
		!isOneLine(value.actor) || !isOneLine(value.host) ||
		!isOneLine(value.remote) ||
		!Array.isArray(value.ownedPaths) || value.ownedPaths.length === 0 ||
		!value.ownedPaths.every(isOwnedPathReceipt) ||
		!isObjectId(value.localMainHead) || !isObjectId(value.remoteMainHead) ||
		!isNullableObjectId(value.expectedLeaseGeneration) || !isNullableObjectId(value.leaseGeneration) ||
		(value.leaseAcquiredAt !== null && !isIso(value.leaseAcquiredAt)) ||
		!Number.isSafeInteger(value.leaseDurationMs) || (value.leaseDurationMs as number) <= 0 ||
		!isNullableObjectId(value.commitId) ||
		!VAULT_GIT_RECEIPT_NEXT_ACTIONS.includes(value.nextSafeAction as never) ||
		!/^receipt:receipt_[0-9a-f]{32}$/.test(String(value.diagnosticsReference))
	) throw new Error("receipt schema invalid");
}

function assertAppend(previous: VaultGitReceipt, next: VaultGitReceipt): void {
	if (next.revision !== previous.revision + 1 || next.receiptId !== previous.receiptId) throw new Error("receipt revision conflict");
	for (const field of ["event", "actor", "host", "remote", "localMainHead", "remoteMainHead", "expectedLeaseGeneration", "leaseDurationMs"] as const) {
		if (next[field] !== previous[field]) throw new Error(`immutable receipt field changed: ${field}`);
	}
	if (previous.transactionId !== null && next.transactionId !== previous.transactionId) throw new Error("transaction id changed");
	if (previous.leaseGeneration !== null && next.leaseGeneration !== previous.leaseGeneration) throw new Error("lease generation changed");
	const previousPaths = new Map(previous.ownedPaths.map((path) => [path.path, path]));
	for (const [path, entry] of previousPaths) {
		if (JSON.stringify(next.ownedPaths.find((candidate) => candidate.path === path)) !== JSON.stringify(entry)) throw new Error("owned path changed");
	}
}

function isOwnedPathReceipt(value: unknown): boolean {
	return isRecord(value) && hasExactKeys(value, ["path", "baselineHash", "admittedNewFile"]) && isOwnedPath(value.path) && (value.baselineHash === null || isObjectId(value.baselineHash)) && typeof value.admittedNewFile === "boolean" && (value.baselineHash === null) === value.admittedNewFile;
}

function isOwnedPath(value: unknown): value is string {
	if (typeof value !== "string" || value.startsWith("/")) return false;
	const segments = value.split("/");
	if (segments[0] === ".git") return false;
	return segments.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function assertReceiptId(value: string): void { if (!isReceiptId(value)) throw new Error("invalid receipt id"); }
function isReceiptId(value: unknown): value is string { return typeof value === "string" && /^receipt_[0-9a-f]{32}$/.test(value); }
function isTransactionId(value: unknown): value is string { return typeof value === "string" && /^txn_[0-9a-f]{32}$/.test(value); }
function isObjectId(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{40,64}$/.test(value); }
function isNullableObjectId(value: unknown): boolean { return value === null || isObjectId(value); }
function isIso(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value; }
function isOneLine(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && !/[\r\n\0]/.test(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function isMissing(error: unknown): boolean { return isRecord(error) && error.code === "ENOENT"; }
function isExists(error: unknown): boolean { return isRecord(error) && error.code === "EEXIST"; }
function copyCapabilities(value: VaultGitCapabilities): VaultGitCapabilities { return { ownerCapability: new Uint8Array(value.ownerCapability), joinCapability: new Uint8Array(value.joinCapability) }; }
