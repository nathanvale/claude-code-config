import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";

import type { VaultGitTaskState } from "./model.ts";
import {
	createNodeVaultGitDurabilityPort,
	durablePublishExclusive,
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

/** Exact receipt-selected caller binding for one completion task. */
export interface VaultGitTaskClaimOrJoinInput extends VaultGitTaskBindingInput {
	readonly claimReceiptId: string;
	/** Current receipt revision; legacy callers default to revision one. */
	readonly receiptRevision?: number;
	readonly recordedAt: string;
}

/** Observable single-flight decision for one completion task caller. */
export type VaultGitTaskClaimOrJoinResult =
	| { readonly status: "created"; readonly launch: "winner"; readonly state: VaultGitTaskState }
	| { readonly status: "existing"; readonly launch: "winner" | "joined"; readonly state: VaultGitTaskState }
	| { readonly status: "refused"; readonly launch: "refused"; readonly reason: "task_input_mismatch" };

/** Exact repaired receipt allowed to authorize one replacement attempt. */
export interface VaultGitTaskAuthorizeRepairInput {
	readonly receiptId: string;
	readonly transactionId: string;
	readonly leaseGeneration: string;
	readonly repairedReceiptRevision: number;
	readonly recordedAt: string;
}

/** Durable authorization publication result. */
export type VaultGitTaskAuthorizeRepairResult =
	| { readonly status: "transitioned" | "existing"; readonly state: VaultGitTaskState }
	| { readonly status: "absent" | "refused" };

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
	claimOrJoin(input: VaultGitTaskClaimOrJoinInput): Promise<VaultGitTaskClaimOrJoinResult>;
	load(receiptId: string): Promise<VaultGitTaskLoadResult>;
	loadByTaskId(taskId: string): Promise<VaultGitTaskLoadResult>;
	/** Explicitly publish revision one from an exact matching immutable claim. */
	materializeClaimState(
		receiptId: string,
		expectedTransactionId: string,
	): Promise<VaultGitTaskLoadResult>;
	authorizeRepair(
		input: VaultGitTaskAuthorizeRepairInput,
	): Promise<VaultGitTaskAuthorizeRepairResult>;
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
		await publishExclusiveJson(
			revisionPath(taskHistory(state.taskId), state.revision),
			state,
			durability,
			"task_state",
		);
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
		async materializeClaimState(receiptId, expectedTransactionId) {
			const claim = await loadClaim(receiptId);
			if (claim.status !== "loaded") return claim;
			const state = taskStateFromClaim(claim.claim);
			if (state.transactionId !== expectedTransactionId) {
				return { status: "loaded", state };
			}
			await ensureInitialState(state);
			return loadByTaskId(claim.claim.taskId);
		},
		async transition(taskId, expectedRevision, input, fence) {
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
				"task_state",
			);
			if (!created) {
				const current = await loadByTaskId(taskId);
				if (current.status !== "loaded") throw new Error("task CAS winner unavailable");
				return { status: "stale", state: current.state };
			}
			return { status: "transitioned", state: next };
		},
		async authorizeRepair(input) {
			const { authorizeVaultGitTaskRepair } = await import("./task-repair.ts");
			assertReceiptId(input.receiptId);
			if (
				!/^txn_[0-9a-f]{32}$/u.test(input.transactionId) ||
				!(/^[0-9a-f]{40}$/u.test(input.leaseGeneration) ||
					/^[0-9a-f]{64}$/u.test(input.leaseGeneration)) ||
				!Number.isSafeInteger(input.repairedReceiptRevision) ||
				input.repairedReceiptRevision < 1
			) {
				return { status: "refused" };
			}
			const claim = await loadClaim(input.receiptId);
			if (claim.status === "absent") return { status: "absent" };
			if (
				claim.status !== "loaded" ||
				claim.claim.transactionId !== input.transactionId ||
				claim.claim.leaseGeneration !== input.leaseGeneration
			) {
				return { status: "refused" };
			}
			await ensureInitialState(taskStateFromClaim(claim.claim));
			const loaded = await loadByTaskId(claim.claim.taskId);
			if (loaded.status !== "loaded" || loaded.state.state !== "repair_needed") {
				return { status: "refused" };
			}
			if (loaded.state.repairAuthorization !== null) {
				return loaded.state.repairAuthorization.repairedReceiptRevision ===
						input.repairedReceiptRevision &&
					loaded.state.repairAuthorization.bindingDigest === claim.claim.bindingDigest
					? { status: "existing", state: loaded.state }
					: { status: "refused" };
			}
			const next = authorizeVaultGitTaskRepair(loaded.state, {
				repairedReceiptRevision: input.repairedReceiptRevision,
				bindingDigest: claim.claim.bindingDigest,
				recordedAt: input.recordedAt,
			});
			const created = await publishExclusiveJson(
				revisionPath(taskHistory(next.taskId), next.revision),
				next,
				durability,
				"task_state",
			);
			if (created) return { status: "transitioned", state: next };
			const current = await loadByTaskId(next.taskId);
			if (current.status !== "loaded") throw new Error("task CAS winner unavailable");
			return current.state.repairAuthorization?.repairedReceiptRevision ===
				input.repairedReceiptRevision
				? { status: "existing", state: current.state }
				: { status: "refused" };
		},
		async claimOrJoin(input) {
			assertReceiptId(input.claimReceiptId);
			assertReceiptId(input.receiptId);
			const receiptRevision = input.receiptRevision ?? 1;
			if (!Number.isSafeInteger(receiptRevision) || receiptRevision < 1) {
				throw new Error("invalid receipt revision");
			}
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
			const created = await publishExclusiveJson(
				claimPath(input.claimReceiptId),
				claim,
				durability,
				"task_claim",
			);
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
			let latest = await loadByTaskId(existing.claim.taskId);
			if (latest.status !== "loaded") throw new Error("existing task state unavailable");
			if (
				latest.state.state === "repair_needed" &&
				latest.state.repairAuthorization?.repairedReceiptRevision ===
					receiptRevision &&
				latest.state.repairAuthorization.bindingDigest === existing.claim.bindingDigest
			) {
				const { consumeVaultGitTaskRepairAuthorization } = await import(
					"./task-repair.ts"
				);
				const next = consumeVaultGitTaskRepairAuthorization(latest.state, {
					repairedReceiptRevision: receiptRevision,
					recordedAt: input.recordedAt,
				});
				const created = await publishExclusiveJson(
					revisionPath(taskHistory(next.taskId), next.revision),
					next,
					durability,
					"task_state",
				);
				if (created) return { status: "existing", launch: "winner", state: next };
				latest = await loadByTaskId(existing.claim.taskId);
				if (latest.status !== "loaded") throw new Error("task CAS winner unavailable");
			}
			return { status: "existing", launch: "joined", state: latest.state };
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
	target: "task_claim" | "task_state",
): Promise<boolean> {
	// A claim/state loser fences the directory and yields (returns false) rather
	// than throwing: contention is the expected outcome of claimOrJoin, not an
	// error. The shared core owns the durability order.
	return await durablePublishExclusive(
		path,
		new TextEncoder().encode(`${JSON.stringify(value)}\n`),
		target,
		durability,
		async (syncParent) => {
			await syncParent();
			return false;
		},
		(cause) =>
			new Error(`${target.replace("_", " ")} durability unavailable`, {
				cause,
			}),
	);
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
