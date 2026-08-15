import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readdir } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";

import {
	createNodeVaultGitDurabilityPort,
	durablePublishExclusive,
	type VaultGitDurabilityPort,
} from "./store.ts";
import {
	advanceVaultGitDoctorTaskState,
	createVaultGitDoctorTaskState,
	digestVaultGitDoctorTaskBinding,
	digestVaultGitDoctorTaskClaimSlot,
	parseVaultGitDoctorTaskState,
	type VaultGitDoctorTaskAdvanceInput,
	type VaultGitDoctorTaskBindingInput,
	type VaultGitDoctorTaskState,
} from "./doctor-task-state.ts";

export interface VaultGitDoctorTaskStore {
	readonly repositoryId: string;
	claimOrJoin(
		binding: VaultGitDoctorTaskBindingInput,
		recordedAt: string,
	): Promise<{
		readonly launch: "winner" | "joined" | "refused";
		readonly state: VaultGitDoctorTaskState;
		readonly reason?: "task_input_mismatch";
	}>;
	loadByTaskId(taskId: string): Promise<
		| { readonly status: "absent" }
		| { readonly status: "corrupt" }
		| { readonly status: "loaded"; readonly state: VaultGitDoctorTaskState }
	>;
	transition(
		taskId: string,
		expectedRevision: number,
		input: VaultGitDoctorTaskAdvanceInput,
		expectedLaunchGeneration?: string | null,
	): Promise<{
		readonly status: "transitioned" | "stale";
		readonly state: VaultGitDoctorTaskState;
	}>;
}

export function createVaultGitDoctorTaskStore(input: {
	readonly stateRoot: string;
	readonly repositoryId: string;
	readonly durability?: VaultGitDurabilityPort;
}): VaultGitDoctorTaskStore {
	if (!/^[0-9a-f]{64}$/u.test(input.repositoryId) || input.stateRoot.length === 0) {
		throw new Error("doctor task store input invalid");
	}
	const durability = input.durability ?? createNodeVaultGitDurabilityPort();
	const managerRoot = join(input.stateRoot, "vault-git-transaction-manager");
	const repositoryRoot = join(managerRoot, input.repositoryId);
	const claims = join(repositoryRoot, "doctor-task-claims");
	const tasks = join(repositoryRoot, "doctor-tasks");

	async function prepare(): Promise<void> {
		for (const path of [managerRoot, repositoryRoot, claims, tasks]) {
			await preparePrivateDirectory(path);
		}
	}

	function taskRoot(taskId: string): string {
		assertTaskId(taskId);
		return join(tasks, taskId);
	}

	function history(taskId: string): string {
		return join(taskRoot(taskId), "history");
	}

	async function loadByTaskId(taskId: string) {
		assertTaskId(taskId);
		try {
			const [rootMetadata, historyMetadata] = await Promise.all([
				lstat(taskRoot(taskId)),
				lstat(history(taskId)),
			]);
			if (
				!rootMetadata.isDirectory() ||
				rootMetadata.isSymbolicLink() ||
				!historyMetadata.isDirectory() ||
				historyMetadata.isSymbolicLink()
			) {
				return { status: "corrupt" as const };
			}
			const latest = (await readdir(history(taskId)))
				.filter((name) => /^\d{12}\.json$/u.test(name))
				.sort()
				.at(-1);
			if (!latest) return { status: "corrupt" as const };
			const state = parseVaultGitDoctorTaskState(
				JSON.parse(await readPrivateFile(join(history(taskId), latest))),
			);
			return state.taskId === taskId
				? { status: "loaded" as const, state }
				: { status: "corrupt" as const };
		} catch (error) {
			return isMissing(error)
				? { status: "absent" as const }
				: { status: "corrupt" as const };
		}
	}

	async function publishState(state: VaultGitDoctorTaskState): Promise<boolean> {
		await prepare();
		await preparePrivateDirectory(taskRoot(state.taskId));
		await preparePrivateDirectory(history(state.taskId));
		return publishExclusiveJson(
			join(
				history(state.taskId),
				`${String(state.revision).padStart(12, "0")}.json`,
			),
			state,
			durability,
			"doctor_task_state",
		);
	}

	return {
		repositoryId: input.repositoryId,
		loadByTaskId,
		async claimOrJoin(binding, recordedAt) {
			const bindingDigest = digestVaultGitDoctorTaskBinding(binding);
			const claimSlotDigest = digestVaultGitDoctorTaskClaimSlot(binding);
			await prepare();
			const candidate = createVaultGitDoctorTaskState({
				taskId: `doctor_task_${randomUUID().replaceAll("-", "")}`,
				binding,
				recordedAt,
			});
			const claimPath = join(claims, `${claimSlotDigest}.json`);
			const created = await publishExclusiveJson(
				claimPath,
				candidate,
				durability,
				"doctor_task_claim",
			);
			if (created) {
				await publishState(candidate);
				return { launch: "winner", state: candidate };
			}
			const existing = parseVaultGitDoctorTaskState(
				JSON.parse(await readPrivateFile(claimPath)),
			);
			if (existing.bindingDigest !== bindingDigest) {
				return {
					launch: "refused",
					reason: "task_input_mismatch",
					state: existing,
				};
			}
			await publishState(existing);
			const loaded = await loadByTaskId(existing.taskId);
			if (loaded.status !== "loaded") {
				throw new Error("doctor task state unavailable");
			}
			return { launch: "joined", state: loaded.state };
		},
		async transition(taskId, expectedRevision, advance, expectedLaunchGeneration) {
			const loaded = await loadByTaskId(taskId);
			if (loaded.status !== "loaded") {
				throw new Error(`doctor task unavailable: ${loaded.status}`);
			}
			if (
				loaded.state.revision !== expectedRevision ||
				(expectedLaunchGeneration !== undefined &&
					loaded.state.launchGeneration !== expectedLaunchGeneration)
			) {
				return { status: "stale", state: loaded.state };
			}
			const next = advanceVaultGitDoctorTaskState(loaded.state, advance);
			if (!(await publishState(next))) {
				const winner = await loadByTaskId(taskId);
				if (winner.status !== "loaded") {
					throw new Error("doctor task CAS winner unavailable");
				}
				return { status: "stale", state: winner.state };
			}
			return { status: "transitioned", state: next };
		},
	};
}

async function preparePrivateDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
		throw new Error("doctor task private directory invalid");
	}
	await chmod(path, 0o700);
}

async function publishExclusiveJson(
	path: string,
	value: unknown,
	durability: VaultGitDurabilityPort,
	target: "doctor_task_claim" | "doctor_task_state",
): Promise<boolean> {
	const bytes = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
	return durablePublishExclusive(
		path,
		bytes,
		target,
		durability,
		async (syncParent) => {
			await syncParent();
			return false;
		},
		(cause) =>
			new Error("Background Doctor task durability unavailable", {
				cause,
			}),
	);
}

async function readPrivateFile(path: string): Promise<string> {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
		throw new Error("doctor task private file invalid");
	}
	const handle: FileHandle = await open(path, "r");
	try {
		return await handle.readFile("utf8");
	} finally {
		await handle.close();
	}
}

function assertTaskId(taskId: string): void {
	if (!/^doctor_task_[0-9a-f]{32}$/u.test(taskId)) {
		throw new Error("doctor task id invalid");
	}
}

function isMissing(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}
