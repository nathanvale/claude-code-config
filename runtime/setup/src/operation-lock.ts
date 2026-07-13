import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { SetupScope } from "./model.ts";

interface LockOwner {
	readonly pid: number;
	readonly token: string;
	readonly acquired_at: string;
}

export type OperationLockResult =
	| { readonly status: "acquired"; readonly path: string; readonly release: () => Promise<void> }
	| { readonly status: "busy" | "stale"; readonly path: string; readonly owner?: Partial<LockOwner> };

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
	const lockPath = `${resolve(input.stateRoot)}/${lockName(input.scope, canonicalTarget)}`;
	const pid = input.pid ?? process.pid;
	const token = input.token ?? randomUUID();
	try {
		await mkdir(lockPath);
	} catch (error) {
		if (!hasCode(error, "EEXIST")) throw error;
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
			await rm(lockPath, { recursive: true });
		},
	};
}

function lockName(scope: SetupScope, targetAnchor: string): string {
	if (scope === "user") return "user.lock";
	const canonical = resolve(targetAnchor);
	const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 20);
	return `project-${digest}.lock`;
}

async function canonicalPath(path: string): Promise<string> {
	try {
		return await import("node:fs/promises").then(({ realpath }) => realpath(path));
	} catch {
		return resolve(path);
	}
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
		return hasCode(error, "EPERM");
	}
}

function hasCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
