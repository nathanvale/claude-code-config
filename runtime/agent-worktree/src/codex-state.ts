import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const STATE_KEY = "electron-saved-workspace-roots";

function resolveStatePath(): string {
	const codexHome = process.env.CODEX_HOME ?? join(process.env.HOME ?? "", ".codex");
	return join(codexHome, ".codex-global-state.json");
}

async function readState(path: string): Promise<Record<string, unknown>> {
	try {
		return JSON.parse(await readFile(path, "utf-8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

async function writeState(path: string, state: Record<string, unknown>): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(state, null, 2), "utf-8");
}

function getRoots(state: Record<string, unknown>): string[] {
	const roots = state[STATE_KEY];
	return Array.isArray(roots) ? roots.filter((r): r is string => typeof r === "string") : [];
}

/**
 * Register a worktree path in the Codex app's project sidebar.
 *
 * @param worktreePath - Absolute path to the worktree root
 */
export async function registerCodexProject(worktreePath: string): Promise<void> {
	const statePath = resolveStatePath();
	const state = await readState(statePath);
	const roots = getRoots(state);
	if (roots.includes(worktreePath)) return;
	state[STATE_KEY] = [...roots, worktreePath];
	await writeState(statePath, state);
}

/**
 * Remove a worktree path from the Codex app's project sidebar.
 *
 * @param worktreePath - Absolute path to the worktree root
 */
export async function deregisterCodexProject(worktreePath: string): Promise<void> {
	const statePath = resolveStatePath();
	const state = await readState(statePath);
	const roots = getRoots(state);
	const filtered = roots.filter((r) => r !== worktreePath);
	if (filtered.length === roots.length) return;
	state[STATE_KEY] = filtered;
	await writeState(statePath, state);
}
