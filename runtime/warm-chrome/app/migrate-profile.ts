#!/usr/bin/env bun

import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	open,
	readdir,
	readlink,
	rename,
	rm,
} from "node:fs/promises";
import { hostname } from "node:os";
import { join, relative, resolve } from "node:path";

const EXIT_BLOCKED = 20;
const TRANSIENT_ROOT_ENTRIES = new Set([
	"DevToolsActivePort",
	"SingletonCookie",
	"SingletonLock",
	"SingletonSocket",
]);

type Invocation = {
	mode: "check" | "apply";
	json: boolean;
};

type SnapshotEntry = {
	path: string;
	type: "directory" | "file" | "symlink" | "other";
	size: number;
	mode: number;
};

class MigrationFailure extends Error {
	constructor(
		readonly code: string,
		readonly nextAction: string,
		readonly exitCode: number = EXIT_BLOCKED,
	) {
		super(code);
	}
}

function parseInvocation(argv: readonly string[]): Invocation | null {
	if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
		return null;
	}
	const check = argv.includes("--check");
	const apply = argv.includes("--apply");
	const known = new Set(["--check", "--apply", "--json"]);
	if (argv.some((arg) => !known.has(arg)) || check === apply) {
		throw new MigrationFailure("invalid_usage", "change_input", 2);
	}
	return { mode: apply ? "apply" : "check", json: argv.includes("--json") };
}

function help(): string {
	return [
		"Usage: bun run app/migrate-profile.ts (--check | --apply) [--json]",
		"",
		"Preserve and migrate the stopped legacy Agent Chrome profile.",
		"--check  Inspect fixed source and destination without writing.",
		"--apply  Stage, verify by metadata, and atomically promote the copy.",
		"--json   Emit one machine-readable result.",
	].join("\n");
}

function emit(json: boolean, payload: Record<string, unknown>): void {
	if (json) {
		process.stdout.write(`${JSON.stringify(payload)}\n`);
		return;
	}
	process.stdout.write(`${String(payload.status)}: ${String(payload.code ?? payload.destination ?? "")}\n`);
}

async function requireDirectory(path: string, code: string): Promise<void> {
	let info: Awaited<ReturnType<typeof lstat>>;
	try {
		info = await lstat(path);
	} catch {
		throw new MigrationFailure(code, "inspect_profile");
	}
	if (!info.isDirectory() || info.isSymbolicLink()) {
		throw new MigrationFailure(code, "inspect_profile");
	}
}

async function requireLegacyPosture(source: string): Promise<void> {
	await requireDirectory(source, "source_unavailable");
	const info = await lstat(source);
	if ((info.mode & 0o777) !== 0o700) {
		throw new MigrationFailure("source_unsafe", "repair_source_permissions");
	}
}

async function destinationExists(destination: string): Promise<boolean> {
	try {
		await lstat(destination);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

async function requireStopped(source: string): Promise<void> {
	let lock: string;
	try {
		lock = await readlink(join(source, "SingletonLock"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw new MigrationFailure("browser_state_unproven", "inspect_profile_lock");
	}
	const separator = lock.lastIndexOf("-");
	if (separator <= 0 || separator === lock.length - 1) {
		throw new MigrationFailure("browser_state_unproven", "inspect_profile_lock");
	}
	const lockHost = lock.slice(0, separator);
	const pidText = lock.slice(separator + 1);
	if (!/^[0-9]+$/.test(pidText)) {
		throw new MigrationFailure("browser_state_unproven", "inspect_profile_lock");
	}
	const lockPID = Number(pidText);
	if (processIsAlive(lockPID)) {
		throw new MigrationFailure("browser_running", "close_agent_chrome");
	}
	if (lockHost !== hostname()) {
		throw new MigrationFailure("browser_state_unproven", "inspect_profile_lock");
	}
}

function entryType(info: Awaited<ReturnType<typeof lstat>>): SnapshotEntry["type"] {
	if (info.isDirectory()) return "directory";
	if (info.isFile()) return "file";
	if (info.isSymbolicLink()) return "symlink";
	return "other";
}

async function metadataSnapshot(root: string): Promise<SnapshotEntry[]> {
	const entries: SnapshotEntry[] = [];
	const walk = async (path: string): Promise<void> => {
		const info = await lstat(path);
		const relativePath = relative(root, path);
		if (
			relativePath !== "" &&
			!relativePath.includes("/") &&
			TRANSIENT_ROOT_ENTRIES.has(relativePath)
		) {
			return;
		}
		entries.push({
			path: relativePath,
			type: entryType(info),
			size: info.isFile() ? info.size : 0,
			mode: info.mode & 0o777,
		});
		if (!info.isDirectory() || info.isSymbolicLink()) return;
		const children = await readdir(path);
		children.sort();
		for (const child of children) await walk(join(path, child));
	};
	await walk(root);
	return entries;
}

function snapshotsMatch(left: SnapshotEntry[], right: SnapshotEntry[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

async function removeTransientEntries(staging: string): Promise<void> {
	await Promise.all(
		[...TRANSIENT_ROOT_ENTRIES].map((entry) =>
			rm(join(staging, entry), { recursive: true, force: true }),
		),
	);
}

async function durableDirectory(path: string): Promise<void> {
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function runDitto(source: string, staging: string): Promise<void> {
	const child = Bun.spawn(["/usr/bin/ditto", source, staging], {
		env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
		timeout: 120_000,
	});
	if ((await child.exited) !== 0) {
		throw new MigrationFailure("copy_failed", "inspect_diagnostics");
	}
}

async function ensureOwnerRoot(ownerRoot: string): Promise<void> {
	let ownerInfo: Awaited<ReturnType<typeof lstat>>;
	try {
		ownerInfo = await lstat(ownerRoot);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		await mkdir(ownerRoot, { recursive: true, mode: 0o700 });
		ownerInfo = await lstat(ownerRoot);
	}
	if (!ownerInfo.isDirectory() || ownerInfo.isSymbolicLink()) {
		throw new MigrationFailure(
			"destination_owner_unsafe",
			"inspect_destination",
		);
	}
	await chmod(ownerRoot, 0o700);
}

async function migrate(source: string, destination: string): Promise<void> {
	const ownerRoot = resolve(destination, "..");
	await ensureOwnerRoot(ownerRoot);
	const staging = await mkdtemp(join(ownerRoot, ".Chrome User Data.staging-"));
	await chmod(staging, 0o700);
	try {
		const sourceBefore = await metadataSnapshot(source);
		await rm(staging, { recursive: true, force: true });
		await runDitto(source, staging);
		await removeTransientEntries(staging);
		await chmod(staging, 0o700);
		const [sourceAfter, copied] = await Promise.all([
			metadataSnapshot(source),
			metadataSnapshot(staging),
		]);
		if (
			!snapshotsMatch(sourceBefore, sourceAfter) ||
			!snapshotsMatch(sourceBefore, copied)
		) {
			throw new MigrationFailure("copy_verification_failed", "inspect_diagnostics");
		}
		if (await destinationExists(destination)) {
			throw new MigrationFailure("destination_exists", "inspect_destination");
		}
		await rename(staging, destination);
		await durableDirectory(ownerRoot);
	} finally {
		await rm(staging, { recursive: true, force: true }).catch(() => {});
	}
}

async function main(argv: readonly string[]): Promise<number> {
	let invocation: Invocation | null;
	try {
		invocation = parseInvocation(argv);
	} catch (error) {
		const failure = error as MigrationFailure;
		emit(argv.includes("--json"), {
			status: "blocked",
			code: failure.code,
			changed_state: "none",
			next_action: failure.nextAction,
		});
		return failure.exitCode;
	}
	if (!invocation) {
		process.stdout.write(`${help()}\n`);
		return 0;
	}
	if (process.platform !== "darwin") {
		emit(invocation.json, {
			status: "blocked",
			code: "unsupported_platform",
			changed_state: "none",
			next_action: "use_macos",
		});
		return EXIT_BLOCKED;
	}
	const home = process.env.HOME;
	if (!home?.startsWith("/")) {
		emit(invocation.json, {
			status: "blocked",
			code: "home_unavailable",
			changed_state: "none",
			next_action: "set_home",
		});
		return EXIT_BLOCKED;
	}
	const source = join(home, ".agent-warm-profile");
	const destination = join(
		home,
		"Library",
		"Application Support",
		"Agent Chrome",
		"Chrome User Data",
	);
	try {
		await requireLegacyPosture(source);
		if (await destinationExists(destination)) {
			throw new MigrationFailure("destination_exists", "inspect_destination");
		}
		await requireStopped(source);
		if (invocation.mode === "check") {
			emit(invocation.json, {
				status: "preview",
				changed_state: "none",
				source,
				destination,
				source_retained: true,
				next_action: "apply_migration",
			});
			return 0;
		}
		await migrate(source, destination);
		emit(invocation.json, {
			status: "migrated",
			changed_state: "profile_migrated",
			source,
			destination,
			source_retained: true,
			next_action: "prove_new_profile",
		});
		return 0;
	} catch (error) {
		const failure =
			error instanceof MigrationFailure
				? error
				: new MigrationFailure("migration_failed", "inspect_diagnostics");
		emit(invocation.json, {
			status: "blocked",
			code: failure.code,
			changed_state: "none",
			source,
			destination,
			source_retained: true,
			next_action: failure.nextAction,
		});
		return failure.exitCode;
	}
}

process.exitCode = await main(process.argv.slice(2));
