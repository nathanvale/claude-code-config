import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { SetupScope } from "./model.ts";
import { canonicalPath, hasErrorCode } from "./path-safety.ts";

interface LockOwner {
	readonly pid: number;
	readonly token: string;
	readonly acquired_at: string;
}

export type OperationLockResult =
	| { readonly status: "acquired"; readonly path: string; readonly release: () => Promise<void> }
	| { readonly status: "busy" | "stale"; readonly path: string; readonly owner?: Partial<LockOwner> };

/** Read-only lock state used by doctor without creating or reclaiming evidence. */
export type OperationLockInspection =
	| { readonly status: "missing"; readonly path: string }
	| { readonly status: "busy"; readonly path: string; readonly owner?: Partial<LockOwner> }
	| { readonly status: "stale"; readonly path: string; readonly owner?: Partial<LockOwner> };

/**
 * Inspect lock evidence without creating or reclaiming state.
 *
 * @param input - Scope, target, state root, and optional process probe
 * @returns Missing, busy, or stale evidence for the selected scope lock
 *
 * @example
 * ```typescript
 * await inspectOperationLock({ scope: "user", targetAnchor: home, stateRoot })
 * ```
 */
export async function inspectOperationLock(input: {
	readonly scope: SetupScope;
	readonly targetAnchor: string;
	readonly stateRoot: string;
	readonly isProcessAlive?: (pid: number) => boolean;
}): Promise<OperationLockInspection> {
	const canonicalTarget = input.scope === "project"
		? await canonicalPath(input.targetAnchor)
		: resolve(input.targetAnchor);
	const path = `${resolve(input.stateRoot)}/${lockName(input.scope, canonicalTarget)}`;
	return inspectLockPath(path, input.isProcessAlive);
}

/**
 * Enumerate stale canonical-id visibility locks without creating or reclaiming state.
 *
 * @param input - Existing state root and optional process probe
 * @returns Deterministically ordered stale visibility-lock evidence
 *
 * @example
 * ```typescript
 * await inspectStaleVisibilityLocks({ stateRoot })
 * ```
 */
export async function inspectStaleVisibilityLocks(input: {
	readonly stateRoot: string;
	readonly isProcessAlive?: (pid: number) => boolean;
}): Promise<readonly Extract<OperationLockInspection, { readonly status: "stale" }>[]> {
	const stateRoot = resolve(input.stateRoot);
	let names: string[];
	try {
		names = await readdir(stateRoot);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return [];
		throw error;
	}
	const inspections = await Promise.all(names
		.filter((name) => /^visibility-[a-f0-9]{20}\.lock$/u.test(name))
		.sort((left, right) => left.localeCompare(right))
		.map((name) => inspectLockPath(`${stateRoot}/${name}`, input.isProcessAlive)));
	return inspections.filter(
		(inspection): inspection is Extract<OperationLockInspection, { readonly status: "stale" }> =>
			inspection.status === "stale",
	);
}

async function inspectLockPath(
	path: string,
	isProcessAlive?: (pid: number) => boolean,
): Promise<OperationLockInspection> {
	let owner: Partial<LockOwner> | undefined;
	try {
		owner = await readOwner(path);
		await lstat(path);
	} catch {
		return { status: "missing", path };
	}
	const alive = typeof owner?.pid === "number" && (isProcessAlive ?? processAlive)(owner.pid);
	return alive
		? { status: "busy", path, ...(owner ? { owner } : {}) }
		: { status: "stale", path, ...(owner ? { owner } : {}) };
}

/** Acquire one atomic mkdir lock. Existing stale evidence is diagnosed, never reclaimed. */
export async function acquireOperationLock(input: {
	readonly scope: SetupScope;
	readonly targetAnchor: string;
	readonly stateRoot: string;
	readonly pid?: number;
	readonly token?: string;
	readonly isProcessAlive?: (pid: number) => boolean;
}): Promise<OperationLockResult> {
	await mkdir(input.stateRoot, { recursive: true });
	const canonicalTarget = input.scope === "project" ? await canonicalPath(input.targetAnchor) : resolve(input.targetAnchor);
	return acquireNamedLock({
		name: lockName(input.scope, canonicalTarget),
		stateRoot: input.stateRoot,
		pid: input.pid,
		token: input.token,
		isProcessAlive: input.isProcessAlive,
	});
}

/** Acquire canonical-id locks in stable order after the caller's scope lock. */
export async function acquireVisibilityLocks(input: {
	readonly canonicalIds: readonly string[];
	readonly stateRoot: string;
	readonly pid?: number;
	readonly isProcessAlive?: (pid: number) => boolean;
}): Promise<OperationLockResult> {
	await mkdir(input.stateRoot, { recursive: true });
	const ids = [...new Set(input.canonicalIds)].sort((left, right) => left.localeCompare(right));
	const acquired: Extract<OperationLockResult, { status: "acquired" }>[] = [];
	for (const id of ids) {
		const lock = await acquireNamedLock({
			name: visibilityLockName(id),
			stateRoot: input.stateRoot,
			pid: input.pid,
			isProcessAlive: input.isProcessAlive,
		});
		if (lock.status !== "acquired") {
			await releaseLocks(acquired);
			return lock;
		}
		acquired.push(lock);
	}
	return {
		status: "acquired",
		path: ids.length === 0 ? resolve(input.stateRoot) : acquired.map((lock) => lock.path).join(","),
		release: async () => releaseLocks(acquired),
	};
}

async function releaseLocks(
	locks: readonly Extract<OperationLockResult, { status: "acquired" }>[],
): Promise<void> {
	let firstFailure: unknown;
	for (let index = locks.length - 1; index >= 0; index -= 1) {
		try {
			await locks[index]?.release();
		} catch (error) {
			firstFailure ??= error;
		}
	}
	if (firstFailure !== undefined) throw firstFailure;
}

async function acquireNamedLock(input: {
	readonly name: string;
	readonly stateRoot: string;
	readonly pid?: number;
	readonly token?: string;
	readonly isProcessAlive?: (pid: number) => boolean;
}): Promise<OperationLockResult> {
	const lockPath = `${resolve(input.stateRoot)}/${input.name}`;
	const pid = input.pid ?? process.pid;
	const token = input.token ?? randomUUID();
	try {
		await mkdir(lockPath);
	} catch (error) {
		if (!hasErrorCode(error, "EEXIST")) throw error;
		const owner = await readOwner(lockPath);
		const alive = typeof owner?.pid === "number" && (input.isProcessAlive ?? processAlive)(owner.pid);
		return { status: alive ? "busy" : "stale", path: lockPath, ...(owner ? { owner } : {}) };
	}
	const owner: LockOwner = { pid, token, acquired_at: new Date().toISOString() };
	try {
		await writeFile(`${lockPath}/owner.json`, `${JSON.stringify(owner)}\n`, { flag: "wx" });
	} catch (error) {
		await rm(lockPath, { recursive: true, force: true });
		throw error;
	}
	return {
		status: "acquired",
		path: lockPath,
		release: async () => {
			const current = await readOwner(lockPath);
			if (current?.token !== token) return;
			await rm(lockPath, { recursive: true, force: true });
		},
	};
}

function lockName(scope: SetupScope, targetAnchor: string): string {
	if (scope === "user") return "user.lock";
	const canonical = resolve(targetAnchor);
	const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 20);
	return `project-${digest}.lock`;
}

function visibilityLockName(canonicalId: string): string {
	const digest = createHash("sha256").update(canonicalId).digest("hex").slice(0, 20);
	return `visibility-${digest}.lock`;
}

async function readOwner(lockPath: string): Promise<Partial<LockOwner> | undefined> {
	try {
		const parsed = JSON.parse(await readFile(`${lockPath}/owner.json`, "utf8")) as Partial<LockOwner>;
		return parsed && typeof parsed === "object" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return hasErrorCode(error, "EPERM");
	}
}
