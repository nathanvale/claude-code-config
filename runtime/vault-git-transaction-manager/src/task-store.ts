import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";

import type { VaultGitTaskState } from "./model.ts";
import {
	createNodeVaultGitDurabilityPort,
	type VaultGitDurabilityPort,
} from "./store.ts";
import {
	createVaultGitTaskState,
	parseVaultGitTaskState,
} from "./task-state.ts";

/** Construction options for one repository-scoped private task store. */
export interface VaultGitTaskStoreOptions {
	/** Injected XDG state root. */
	readonly stateRoot: string;
	/** Stable, non-secret canonical repository identity. */
	readonly repositoryIdentity: string;
	/** Load-bearing durability operations. @defaultValue node syscall port */
	readonly durability?: VaultGitDurabilityPort;
}

/** Receipt-scoped input for one background task admission. */
export interface VaultGitTaskAdmissionInput {
	/** Receipt that may own at most one admitted background task. */
	readonly receiptId: string;
	/** Injected ISO timestamp retained only when this admission wins. */
	readonly recordedAt: string;
}

/** Observable result of one compare-and-set task admission. */
export interface VaultGitTaskAdmission {
	/** Whether this caller created the claim or joined the stored winner. */
	readonly status: "created" | "existing";
	/** Immutable task state selected by the receipt claim. */
	readonly state: VaultGitTaskState;
}

/** Fail-closed read result for one receipt-scoped task claim. */
export type VaultGitTaskLoadResult =
	| { readonly status: "absent" }
	| { readonly status: "loaded"; readonly state: VaultGitTaskState }
	| { readonly status: "corrupt"; readonly reason: string };

/** Private compare-and-set store for receipt-scoped background tasks. */
export interface VaultGitTaskStore {
	/** Stable repository identity digest shared with the receipt store. */
	readonly repositoryId: string;
	/** Private paths exposed for inspection and adapter tests. */
	readonly paths: {
		readonly repositoryRoot: string;
		readonly claims: string;
	};
	/** Resolve the private immutable claim path for one receipt. */
	claimPath(receiptId: string): string;
	/** Atomically create or load the one task claimed by a receipt. */
	admit(input: VaultGitTaskAdmissionInput): Promise<VaultGitTaskAdmission>;
	/** Load the task claimed by one receipt without changing it. */
	load(receiptId: string): Promise<VaultGitTaskLoadResult>;
}

/**
 * Create one private task store whose claim file is the initial task state.
 *
 * Publishing the state itself with link-based compare-and-set avoids a split
 * claim/state transaction: concurrent callers observe one complete immutable
 * record and one independently generated opaque task id.
 *
 * @param options - Injected private state root and repository identity
 * @returns Receipt-scoped task admission and read operations
 * @throws {Error} When private storage or durable publication is unavailable
 *
 * @example
 * ```typescript
 * const store = createVaultGitTaskStore({
 *   stateRoot: "/home/agent/.local/state",
 *   repositoryIdentity: "vault@example",
 * })
 * const admission = await store.admit({
 *   receiptId: "receipt_22222222222222222222222222222222",
 *   recordedAt: "2026-08-12T11:45:00.000Z",
 * })
 * ```
 */
export function createVaultGitTaskStore(
	options: VaultGitTaskStoreOptions,
): VaultGitTaskStore {
	if (options.stateRoot.length === 0 || options.repositoryIdentity.length === 0) {
		throw new Error("state root and repository identity must not be empty");
	}
	const repositoryId = createHash("sha256")
		.update(options.repositoryIdentity)
		.digest("hex");
	const managerRoot = join(options.stateRoot, "vault-git-transaction-manager");
	const repositoryRoot = join(managerRoot, repositoryId);
	const paths = {
		repositoryRoot,
		claims: join(repositoryRoot, "task-claims"),
	} as const;
	const durability = options.durability ?? createNodeVaultGitDurabilityPort();

	async function prepare(): Promise<void> {
		for (const path of [managerRoot, repositoryRoot, paths.claims]) {
			await mkdir(path, { recursive: true, mode: 0o700 });
			const metadata = await lstat(path);
			if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
				throw new Error("private task state path is not a directory");
			}
			await chmod(path, 0o700);
			if (((await lstat(path)).mode & 0o777) !== 0o700) {
				throw new Error("private task state directory permissions unavailable");
			}
		}
	}

	function claimPath(receiptId: string): string {
		assertReceiptId(receiptId);
		return join(paths.claims, `${receiptId}.json`);
	}

	async function load(receiptId: string): Promise<VaultGitTaskLoadResult> {
		let source: string;
		try {
			source = await readPrivateTaskState(claimPath(receiptId));
		} catch (error) {
			if (isMissing(error)) return { status: "absent" };
			return { status: "corrupt", reason: "task claim unreadable" };
		}
		try {
			const state = parseVaultGitTaskState(JSON.parse(source));
			if (state.receiptId !== receiptId) {
				return { status: "corrupt", reason: "task claim receipt mismatch" };
			}
			return { status: "loaded", state };
		} catch {
			return { status: "corrupt", reason: "task claim malformed" };
		}
	}

	return {
		repositoryId,
		paths,
		claimPath,
		load,
		async admit(input) {
			await prepare();
			const state = createVaultGitTaskState({
				taskId: `task_${randomUUID().replaceAll("-", "")}`,
				receiptId: input.receiptId,
				recordedAt: input.recordedAt,
			});
			const created = await publishTaskClaim(
				claimPath(input.receiptId),
				state,
				durability,
			);
			if (created) return { status: "created", state };
			const existing = await load(input.receiptId);
			if (existing.status !== "loaded") {
				throw new Error(`existing task claim unavailable: ${existing.status}`);
			}
			return { status: "existing", state: existing.state };
		},
	};
}

async function publishTaskClaim(
	path: string,
	state: VaultGitTaskState,
	durability: VaultGitDurabilityPort,
): Promise<boolean> {
	const bytes = new TextEncoder().encode(`${JSON.stringify(state)}\n`);
	const temporary = `${path}.tmp-${randomUUID()}`;
	let handle: FileHandle | undefined;
	try {
		handle = await open(temporary, "wx", 0o600);
		await durability.writeTemp(handle, bytes, "task_claim");
		await durability.syncFile(handle, "task_claim");
		await handle.close();
		handle = undefined;
		try {
			await durability.linkExclusive(temporary, path, "task_claim");
		} catch (error) {
			if (isExists(error)) {
				await durability.syncDirectory(join(path, ".."), "task_claim");
				return false;
			}
			throw error;
		}
		await durability.syncDirectory(join(path, ".."), "task_claim");
		return true;
	} catch (error) {
		throw new Error("task claim durability unavailable", { cause: error });
	} finally {
		if (handle) await handle.close().catch(() => undefined);
		await unlink(temporary).catch(() => undefined);
	}
}

async function readPrivateTaskState(path: string): Promise<string> {
	const metadata = await lstat(path);
	if (
		!metadata.isFile() ||
		metadata.isSymbolicLink() ||
		(metadata.mode & 0o777) !== 0o600
	) {
		throw new Error("private task claim permissions invalid");
	}
	return readFile(path, "utf8");
}

function assertReceiptId(value: string): void {
	if (!/^receipt_[0-9a-f]{32}$/.test(value)) {
		throw new Error("invalid receipt id");
	}
}

function isMissing(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOENT";
}

function isExists(error: unknown): boolean {
	return isRecord(error) && error.code === "EEXIST";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
