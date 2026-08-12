import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";

import type { VaultGitTaskState } from "./model.ts";
import {
	createNodeVaultGitDurabilityPort,
	type VaultGitDurabilityPort,
} from "./store.ts";
import {
	advanceVaultGitTaskState,
	createVaultGitTaskClaim,
	createVaultGitTaskState,
	parseVaultGitTaskClaim,
	parseVaultGitTaskState,
	type VaultGitTaskBindingInput,
	type VaultGitTaskClaim,
	type VaultGitTaskStateAdvanceInput,
} from "./task-state.ts";

/** Construction options for one repository-scoped private task store. */
export interface VaultGitTaskStoreOptions {
	/** Injected XDG state root. */
	readonly stateRoot: string;
	/** Stable, non-secret canonical repository identity. */
	readonly repositoryIdentity?: string;
	/** Exact repository namespace already selected by the receipt store. */
	readonly repositoryId?: string;
	/** Load-bearing durability operations. @defaultValue node syscall port */
	readonly durability?: VaultGitDurabilityPort;
}

/** Receipt-scoped input for one background task admission. */
export interface VaultGitTaskAdmissionInput {
	readonly receiptId: string;
	readonly transactionId: string;
	readonly leaseGeneration: string;
	readonly recordedAt: string;
}

/** Exact receipt-selected caller binding for one completion task. */
export interface VaultGitTaskClaimOrJoinInput extends VaultGitTaskBindingInput {
	readonly claimReceiptId: string;
	readonly recordedAt: string;
}

/** Observable result of one compare-and-set task admission. */
export interface VaultGitTaskAdmission {
	readonly status: "created" | "existing";
	readonly state: VaultGitTaskState;
}

/** Observable single-flight decision for one completion task caller. */
export type VaultGitTaskClaimOrJoinResult =
	| { readonly status: "created"; readonly launch: "winner"; readonly state: VaultGitTaskState }
	| { readonly status: "existing"; readonly launch: "joined"; readonly state: VaultGitTaskState }
	| { readonly status: "refused"; readonly launch: "refused"; readonly reason: "task_input_mismatch" };

/** Fail-closed read result for one task. */
export type VaultGitTaskLoadResult =
	| { readonly status: "absent" }
	| { readonly status: "loaded"; readonly state: VaultGitTaskState }
	| { readonly status: "corrupt"; readonly reason: string };

/** Compare-and-set outcome for one durable task transition. */
export type VaultGitTaskTransitionResult =
	| { readonly status: "transitioned"; readonly state: VaultGitTaskState }
	| { readonly status: "stale"; readonly state: VaultGitTaskState };

/** Optional ownership fences applied before one durable task transition. */
export interface VaultGitTaskTransitionFence {
	/**
	 * Launch generation the caller believes it still owns. A transition whose
	 * persisted generation differs is refused as stale, so a superseded worker
	 * cannot terminalize the launch attempt that replaced it.
	 */
	readonly expectedLaunchGeneration?: string | null;
}

/** Private compare-and-set store for receipt-scoped background tasks. */
export interface VaultGitTaskStore {
	readonly repositoryId: string;
	readonly paths: {
		readonly repositoryRoot: string;
		readonly claims: string;
		readonly tasks: string;
	};
	claimPath(receiptId: string): string;
	admit(input: VaultGitTaskAdmissionInput): Promise<VaultGitTaskAdmission>;
	claimOrJoin(input: VaultGitTaskClaimOrJoinInput): Promise<VaultGitTaskClaimOrJoinResult>;
	load(receiptId: string): Promise<VaultGitTaskLoadResult>;
	loadByTaskId(taskId: string): Promise<VaultGitTaskLoadResult>;
	transition(
		taskId: string,
		expectedRevision: number,
		input: VaultGitTaskStateAdvanceInput,
		fence?: VaultGitTaskTransitionFence,
	): Promise<VaultGitTaskTransitionResult>;
}

/**
 * Create one private task store with receipt-scoped claims and append-only task revisions.
 *
 * @param options - Private state root, repository identity, and durability adapter
 * @returns Atomic claim, lookup, and revision-CAS operations
 * @throws {Error} When private storage cannot be validated or published durably
 */
export function createVaultGitTaskStore(options: VaultGitTaskStoreOptions): VaultGitTaskStore {
	if (
		options.stateRoot.length === 0 ||
		(options.repositoryIdentity === undefined) === (options.repositoryId === undefined)
	) {
		throw new Error("state root and exactly one repository identity must be provided");
	}
	const repositoryId = options.repositoryId ?? createHash("sha256")
		.update(options.repositoryIdentity as string)
		.digest("hex");
	if (!/^[a-f0-9]{64}$/u.test(repositoryId)) {
		throw new Error("repository id must be a lowercase SHA-256 digest");
	}
	const managerRoot = join(options.stateRoot, "vault-git-transaction-manager");
	const repositoryRoot = join(managerRoot, repositoryId);
	const paths = {
		repositoryRoot,
		claims: join(repositoryRoot, "task-claims"),
		tasks: join(repositoryRoot, "tasks"),
	} as const;
	const durability = options.durability ?? createNodeVaultGitDurabilityPort();

	async function prepare(): Promise<void> {
		for (const path of [managerRoot, repositoryRoot, paths.claims, paths.tasks]) {
			await preparePrivateDirectory(path);
		}
	}

	function claimPath(receiptId: string): string {
		assertReceiptId(receiptId);
		return join(paths.claims, `${receiptId}.json`);
	}

	function taskRoot(taskId: string): string {
		assertTaskId(taskId);
		return join(paths.tasks, taskId);
	}

	function taskHistory(taskId: string): string {
		return join(taskRoot(taskId), "history");
	}

	function taskCurrent(taskId: string): string {
		return join(taskRoot(taskId), "current.json");
	}

	async function prepareTask(taskId: string): Promise<void> {
		await prepare();
		await preparePrivateDirectory(taskRoot(taskId));
		await preparePrivateDirectory(taskHistory(taskId));
	}

	async function loadClaim(receiptId: string): Promise<
		| { readonly status: "absent" }
		| { readonly status: "loaded"; readonly claim: VaultGitTaskClaim }
		| { readonly status: "corrupt"; readonly reason: string }
	> {
		let source: string;
		try {
			source = await readPrivateFile(claimPath(receiptId));
		} catch (error) {
			if (isMissing(error)) return { status: "absent" };
			return { status: "corrupt", reason: "task claim unreadable" };
		}
		try {
			const claim = parseVaultGitTaskClaim(JSON.parse(source));
			return claim.receiptId === receiptId
				? { status: "loaded", claim }
				: { status: "corrupt", reason: "task claim receipt mismatch" };
		} catch {
			return { status: "corrupt", reason: "task claim malformed" };
		}
	}

	async function ensureInitialState(state: VaultGitTaskState): Promise<void> {
		await prepareTask(state.taskId);
		const created = await publishExclusiveJson(
			revisionPath(taskHistory(state.taskId), state.revision),
			state,
			durability,
		);
		if (created) await replaceJson(taskCurrent(state.taskId), state, durability);
	}

	async function loadByTaskId(taskId: string): Promise<VaultGitTaskLoadResult> {
		assertTaskId(taskId);
		let names: string[];
		try {
			const rootMetadata = await lstat(taskRoot(taskId));
			const historyMetadata = await lstat(taskHistory(taskId));
			if (
				!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() ||
				!historyMetadata.isDirectory() || historyMetadata.isSymbolicLink()
			) return { status: "corrupt", reason: "task state directory invalid" };
			names = (await readdir(taskHistory(taskId)))
				.filter((name) => /^\d{12}\.json$/.test(name))
				.sort();
		} catch (error) {
			if (isMissing(error)) return { status: "absent" };
			return { status: "corrupt", reason: "task state unreadable" };
		}
		const latest = names.at(-1);
		if (!latest) return { status: "corrupt", reason: "task history empty" };
		try {
			const state = parseVaultGitTaskState(
				JSON.parse(await readPrivateFile(join(taskHistory(taskId), latest))),
			);
			return state.taskId === taskId
				? { status: "loaded", state }
				: { status: "corrupt", reason: "task state id mismatch" };
		} catch {
			return { status: "corrupt", reason: "task state malformed" };
		}
	}

	async function load(receiptId: string): Promise<VaultGitTaskLoadResult> {
		const claim = await loadClaim(receiptId);
		if (claim.status !== "loaded") return claim;
		const loaded = await loadByTaskId(claim.claim.taskId);
		return loaded.status === "absent"
			? { status: "loaded", state: taskStateFromClaim(claim.claim) }
			: loaded;
	}

	return {
		repositoryId,
		paths,
		claimPath,
		load,
		loadByTaskId,
		async transition(taskId, expectedRevision, input, fence) {
			await prepareTask(taskId);
			const loaded = await loadByTaskId(taskId);
			if (loaded.status !== "loaded") throw new Error(`task state unavailable: ${loaded.status}`);
			if (loaded.state.revision !== expectedRevision) return { status: "stale", state: loaded.state };
			if (
				fence?.expectedLaunchGeneration !== undefined &&
				loaded.state.launchGeneration !== fence.expectedLaunchGeneration
			) {
				return { status: "stale", state: loaded.state };
			}
			const next = advanceVaultGitTaskState(loaded.state, input);
			const created = await publishExclusiveJson(
				revisionPath(taskHistory(taskId), next.revision),
				next,
				durability,
			);
			if (!created) {
				const current = await loadByTaskId(taskId);
				if (current.status !== "loaded") throw new Error("task CAS winner unavailable");
				return { status: "stale", state: current.state };
			}
			await replaceJson(taskCurrent(taskId), next, durability);
			return { status: "transitioned", state: next };
		},
		async claimOrJoin(input) {
			assertReceiptId(input.claimReceiptId);
			assertReceiptId(input.receiptId);
			if (input.claimReceiptId !== input.receiptId) {
				return { status: "refused", launch: "refused", reason: "task_input_mismatch" };
			}
			await prepare();
			const state = createVaultGitTaskState({
				taskId: `task_${randomUUID().replaceAll("-", "")}`,
				receiptId: input.receiptId,
				transactionId: input.transactionId,
				leaseGeneration: input.generation,
				recordedAt: input.recordedAt,
			});
			const claim = createVaultGitTaskClaim(state, input);
			const created = await publishExclusiveJson(claimPath(input.claimReceiptId), claim, durability);
			if (created) {
				await ensureInitialState(state);
				return { status: "created", launch: "winner", state };
			}
			const existing = await loadClaim(input.claimReceiptId);
			if (existing.status !== "loaded") throw new Error(`existing task claim unavailable: ${existing.status}`);
			if (existing.claim.bindingDigest !== claim.bindingDigest) {
				return { status: "refused", launch: "refused", reason: "task_input_mismatch" };
			}
			await ensureInitialState(taskStateFromClaim(existing.claim));
			const latest = await loadByTaskId(existing.claim.taskId);
			if (latest.status !== "loaded") throw new Error("existing task state unavailable");
			return { status: "existing", launch: "joined", state: latest.state };
		},
		async admit(input) {
			const binding: VaultGitTaskClaimOrJoinInput = {
				claimReceiptId: input.receiptId,
				receiptId: input.receiptId,
				transactionId: input.transactionId,
				remote: "admission",
				generation: input.leaseGeneration,
				capabilityDigest: "0".repeat(64),
				normalizedInput: "admission",
				recordedAt: input.recordedAt,
			};
			const result = await this.claimOrJoin(binding);
			if (result.status === "refused") throw new Error("task admission binding mismatch");
			return { status: result.status, state: result.state };
		},
	};
}

async function preparePrivateDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("private task state path is not a directory");
	await chmod(path, 0o700);
	if (((await lstat(path)).mode & 0o777) !== 0o700) throw new Error("private task state directory permissions unavailable");
}

async function publishExclusiveJson(
	path: string,
	value: unknown,
	durability: VaultGitDurabilityPort,
): Promise<boolean> {
	const temporary = `${path}.tmp-${randomUUID()}`;
	let handle: FileHandle | undefined;
	try {
		handle = await open(temporary, "wx", 0o600);
		await durability.writeTemp(handle, new TextEncoder().encode(`${JSON.stringify(value)}\n`), "task_claim");
		await durability.syncFile(handle, "task_claim");
		await handle.close();
		handle = undefined;
		try {
			await durability.linkExclusive(temporary, path, "task_claim");
		} catch (error) {
			if (!isExists(error)) throw error;
			await durability.syncDirectory(join(path, ".."), "task_claim");
			return false;
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

async function replaceJson(path: string, value: unknown, durability: VaultGitDurabilityPort): Promise<void> {
	const temporary = `${path}.tmp-${randomUUID()}`;
	let handle: FileHandle | undefined;
	try {
		handle = await open(temporary, "wx", 0o600);
		await durability.writeTemp(handle, new TextEncoder().encode(`${JSON.stringify(value)}\n`), "task_claim");
		await durability.syncFile(handle, "task_claim");
		await handle.close();
		handle = undefined;
		await durability.rename(temporary, path, "task_claim");
		await durability.syncDirectory(join(path, ".."), "task_claim");
	} catch (error) {
		throw new Error("task state durability unavailable", { cause: error });
	} finally {
		if (handle) await handle.close().catch(() => undefined);
		await unlink(temporary).catch(() => undefined);
	}
}

function revisionPath(history: string, revision: number): string {
	return join(history, `${String(revision).padStart(12, "0")}.json`);
}

function taskStateFromClaim(claim: VaultGitTaskClaim): VaultGitTaskState {
	const { bindingDigest: _bindingDigest, ...state } = claim;
	return parseVaultGitTaskState(state);
}

async function readPrivateFile(path: string): Promise<string> {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
		throw new Error("private task state permissions invalid");
	}
	return readFile(path, "utf8");
}

function assertReceiptId(value: string): void {
	if (!/^receipt_[0-9a-f]{32}$/.test(value)) throw new Error("invalid receipt id");
}

function assertTaskId(value: string): void {
	if (!/^task_[0-9a-f]{32}$/.test(value)) throw new Error("invalid task id");
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
