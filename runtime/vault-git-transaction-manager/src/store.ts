import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import {
	chmod,
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
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

/** Capability roles issued for one transaction. */
export type VaultGitCapabilityRole = "owner" | "join";

/** One observable load-bearing filesystem operation. */
export interface VaultGitDurabilityOperation {
	/** Operation completed before the observer runs. */
	readonly kind: "temp_write" | "file_sync" | "rename" | "directory_sync";
	/** Stable file category; never emitted by command output. */
	readonly target: "history" | "current" | "capability";
}

/** Receipt store construction options. */
export interface VaultGitReceiptStoreOptions {
	/** Injected XDG state root. */
	readonly stateRoot: string;
	/** Stable, non-secret canonical repository identity. */
	readonly repositoryIdentity: string;
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
 */
export function createReceiptStore(
	options: VaultGitReceiptStoreOptions,
): VaultGitReceiptStore {
	if (options.stateRoot.length === 0 || options.repositoryIdentity.length === 0) {
		throw new Error("state root and repository identity must not be empty");
	}
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
			if (
				existing.status !== "absent" &&
				(existing.status !== "loaded" || existing.receipt.phase !== "closed")
			) {
				throw new Error("current receipt already exists");
			}
			await durableWrite(historyPath(paths.history, receipt), receipt, "history", options);
			await durableWrite(paths.current, receipt, "current", options);
			await durableBytes(capabilityPath(receipt.receiptId, "owner"), capabilities.ownerCapability, options);
			await durableBytes(capabilityPath(receipt.receiptId, "join"), capabilities.joinCapability, options);
			return copyCapabilities(capabilities);
		},
		async append(receipt) {
			validateReceipt(receipt);
			await prepare();
			const loaded = await loadReceiptState(paths);
			if (loaded.status !== "loaded") throw new Error(`cannot append receipt: ${loaded.status}`);
			assertAppend(loaded.receipt, receipt);
			await durableWrite(historyPath(paths.history, receipt), receipt, "history", options);
			await durableWrite(paths.current, receipt, "current", options);
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

/** Create independent 256-bit owner and join capability values. */
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
		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
		child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
		const capabilityPipe = child.stdio[descriptor];
		if (!capabilityPipe || !("write" in capabilityPipe)) {
			child.kill("SIGKILL");
			reject(new Error("capability descriptor unavailable"));
			return;
		}
		capabilityPipe.end(capability);
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, request.timeoutMs);
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("close", (exitCode) => {
			clearTimeout(timer);
			resolve({ exitCode, stdout, stderr, timedOut });
		});
	});
}

async function durableWrite(
	path: string,
	receipt: VaultGitReceipt,
	target: VaultGitDurabilityOperation["target"],
	options: VaultGitReceiptStoreOptions,
): Promise<void> {
	await durableBytes(path, new TextEncoder().encode(`${JSON.stringify(receipt)}\n`), options, target);
}

async function durableBytes(
	path: string,
	bytes: Uint8Array,
	options: VaultGitReceiptStoreOptions,
	target: VaultGitDurabilityOperation["target"] = "capability",
): Promise<void> {
	if (bytes.byteLength === 0) throw new Error("private file must not be empty");
	const temporary = `${path}.tmp-${randomUUID()}`;
	let handle: FileHandle | undefined;
	try {
		handle = await open(temporary, "wx", 0o600);
		await handle.writeFile(bytes);
		observe(options, { kind: "temp_write", target });
		await handle.sync();
		observe(options, { kind: "file_sync", target });
		await handle.close();
		handle = undefined;
		await rename(temporary, path);
		await chmod(path, 0o600);
		observe(options, { kind: "rename", target });
		const directory = await open(join(path, ".."), "r");
		try {
			await directory.sync();
		} finally {
			await directory.close();
		}
		observe(options, { kind: "directory_sync", target });
	} catch (error) {
		if (handle) await handle.close().catch(() => undefined);
		throw new Error("receipt durability unavailable", { cause: error });
	}
}

function observe(
	options: VaultGitReceiptStoreOptions,
	operation: VaultGitDurabilityOperation,
): void {
	options.onDurabilityOperation?.(operation);
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
			"transition", "recordedAt", "event", "actor", "host", "ownedPaths",
			"localMainHead", "remoteMainHead", "expectedLeaseGeneration",
			"leaseGeneration", "leaseAcquiredAt", "leaseDurationMs", "commitId",
			"nextSafeAction", "diagnosticsReference",
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
	for (const field of ["event", "actor", "host", "localMainHead", "remoteMainHead", "expectedLeaseGeneration", "leaseDurationMs"] as const) {
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
	return typeof value === "string" && !value.startsWith("/") && value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
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
function copyCapabilities(value: VaultGitCapabilities): VaultGitCapabilities { return { ownerCapability: new Uint8Array(value.ownerCapability), joinCapability: new Uint8Array(value.joinCapability) }; }
