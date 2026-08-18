import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Fail-closed classification of Vault Git durable work evidence. */
export type VaultGitWorkState = "clear" | "active" | "uncertain";

// Smallest stable projection of the vault-git store layout and phase
// vocabulary; the schema owner is runtime/vault-git-transaction-manager
// (store.ts, task-state.ts, doctor-task-state.ts). Do not widen this into a
// shared schema import — Setup only needs terminal-versus-active evidence.
const ACTIVE_RECEIPT_PHASES = new Set([
	"unavailable",
	"inspecting",
	"intent_durable",
	"leased",
	"writing",
	"checking",
	"committing",
	"push_pending",
	"repairable",
	"human_required",
	"blocked",
]);
const TERMINAL_RECEIPT_PHASE = "closed";
const ACTIVE_TASK_PHASES = new Set(["admitted", "running"]);
const TERMINAL_TASK_PHASE = "terminal";
const TASK_KIND_DIRECTORIES = ["tasks", "doctor-tasks"] as const;
const MAX_DIRECTORY_ENTRIES = 1024;

/**
 * Classify Vault Git durable state under one XDG state root.
 *
 * Returns `clear` only for proven terminal-or-absent evidence, `active` for a
 * proven open receipt or nonterminal Completion or Doctor Task, and
 * `uncertain` for every missing, malformed, unsafe, or unknown evidence shape.
 */
export async function inspectVaultGitWorkState(
	stateRoot: string,
): Promise<VaultGitWorkState> {
	const managerRoot = join(stateRoot, "vault-git-transaction-manager");
	let managerEntry: Awaited<ReturnType<typeof lstat>>;
	try {
		managerEntry = await lstat(managerRoot);
	} catch (error) {
		return isMissing(error) ? "clear" : "uncertain";
	}
	if (managerEntry.isSymbolicLink() || !managerEntry.isDirectory()) {
		return "uncertain";
	}
	const repositories = await listEntries(managerRoot);
	if (repositories === undefined) return "uncertain";
	let workState: VaultGitWorkState = "clear";
	for (const repository of repositories) {
		const repositoryState = await inspectRepository(join(managerRoot, repository));
		if (repositoryState === "uncertain") return "uncertain";
		if (repositoryState === "active") workState = "active";
	}
	return workState;
}

async function inspectRepository(
	repositoryRoot: string,
): Promise<VaultGitWorkState> {
	let repositoryEntry: Awaited<ReturnType<typeof lstat>>;
	try {
		repositoryEntry = await lstat(repositoryRoot);
	} catch {
		return "uncertain";
	}
	if (repositoryEntry.isSymbolicLink() || !repositoryEntry.isDirectory()) {
		return "uncertain";
	}
	let workState: VaultGitWorkState = "clear";
	const receiptState = await inspectReceipt(join(repositoryRoot, "current.json"));
	if (receiptState === "uncertain") return "uncertain";
	if (receiptState === "active") workState = "active";
	for (const kind of TASK_KIND_DIRECTORIES) {
		const kindState = await inspectTaskKind(join(repositoryRoot, kind));
		if (kindState === "uncertain") return "uncertain";
		if (kindState === "active") workState = "active";
	}
	return workState;
}

async function inspectReceipt(receiptPath: string): Promise<VaultGitWorkState> {
	const phase = await readPhase(receiptPath);
	if (phase === "absent") return "clear";
	if (phase === undefined) return "uncertain";
	if (phase === TERMINAL_RECEIPT_PHASE) return "clear";
	return ACTIVE_RECEIPT_PHASES.has(phase) ? "active" : "uncertain";
}

async function inspectTaskKind(kindRoot: string): Promise<VaultGitWorkState> {
	try {
		const kindEntry = await lstat(kindRoot);
		if (kindEntry.isSymbolicLink() || !kindEntry.isDirectory()) return "uncertain";
	} catch (error) {
		return isMissing(error) ? "clear" : "uncertain";
	}
	const taskIds = await listEntries(kindRoot);
	if (taskIds === undefined) return "uncertain";
	let workState: VaultGitWorkState = "clear";
	for (const taskId of taskIds) {
		const taskState = await inspectTask(join(kindRoot, taskId, "history"));
		if (taskState === "uncertain") return "uncertain";
		if (taskState === "active") workState = "active";
	}
	return workState;
}

async function inspectTask(historyRoot: string): Promise<VaultGitWorkState> {
	const revisions = await listEntries(historyRoot);
	if (revisions === undefined) return "uncertain";
	const latest = revisions.filter((name) => name.endsWith(".json")).sort().at(-1);
	if (latest === undefined) return "uncertain";
	const phase = await readPhase(join(historyRoot, latest));
	if (phase === undefined || phase === "absent") return "uncertain";
	if (phase === TERMINAL_TASK_PHASE) return "clear";
	return ACTIVE_TASK_PHASES.has(phase) ? "active" : "uncertain";
}

/** Read one evidence file's `phase` string; `absent` for ENOENT, undefined when unproven. */
async function readPhase(path: string): Promise<string | "absent" | undefined> {
	let entry: Awaited<ReturnType<typeof lstat>>;
	try {
		entry = await lstat(path);
	} catch (error) {
		return isMissing(error) ? "absent" : undefined;
	}
	if (entry.isSymbolicLink() || !entry.isFile()) return undefined;
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return undefined;
		}
		const phase = (parsed as Record<string, unknown>).phase;
		return typeof phase === "string" ? phase : undefined;
	} catch {
		return undefined;
	}
}

async function listEntries(path: string): Promise<readonly string[] | undefined> {
	try {
		const entries = await readdir(path);
		return entries.length > MAX_DIRECTORY_ENTRIES ? undefined : entries.sort();
	} catch {
		return undefined;
	}
}

function isMissing(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
	);
}
