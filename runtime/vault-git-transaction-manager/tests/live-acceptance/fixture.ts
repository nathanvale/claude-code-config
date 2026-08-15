import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import {
	chmod,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "bun:test";
import {
	parseCliProcessJson,
	runCliProcess,
	type CliProcessResult,
} from "@side-quest/cli-command-facade/testing";

import { readVaultGitProcessIdentity } from "../../src/cli.ts";
import { createNodeProcessPort } from "../../src/git-adapter.ts";
import { resolveVaultRepositoryIdentity } from "../../src/repository-identity.ts";
import { createReceiptStore, launchCapabilityProcess } from "../../src/store.ts";
import { admitActivationForTest } from "../activation-fixture.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cliPath = join(packageRoot, "tests", "process-cli.ts");
const roots: string[] = [];
const stateRoots: string[] = [];

/** Terminate matching detached workers, then remove every disposable real-Git root. @internal */
export async function cleanupLiveAcceptanceRoots(): Promise<void> {
	const trackedStateRoots = stateRoots.splice(0);
	const trackedRoots = roots.splice(0);
	await settleFixtureCleanup(
		() => settleCleanupOperations(
			trackedStateRoots.map((stateRoot) => terminateFixtureWorkers(stateRoot)),
			"live-acceptance worker cleanup failed",
		),
		() => settleCleanupOperations(
			trackedRoots.map((root) => rm(root, { recursive: true, force: true })),
			"live-acceptance root cleanup failed",
		),
		"live-acceptance fixture cleanup failed",
	);
}

/**
 * Observe child closure without missing an event emitted before registration.
 *
 * @param child - Spawned process whose terminal event may already have fired
 * @returns Promise settled once the child has exited or closed
 * @internal
 */
export function waitForChildClose(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
	return new Promise<void>((resolveChild) => {
		let resolved = false;
		const resolveOnce = (): void => {
			if (resolved) return;
			resolved = true;
			resolveChild();
		};
		child.once("close", resolveOnce);
		if (child.exitCode !== null || child.signalCode !== null) resolveOnce();
	});
}

/** Disposable public-process fixture backed by a real bare Git remote. @internal */
export interface Fixture {
	readonly root: string;
	readonly bare: string;
	readonly clone: string;
	readonly stateRoot: string;
	readonly env: NodeJS.ProcessEnv;
	readonly checkMarker: string;
	readonly checkLog: string;
	readonly shimMarker: string;
	readonly shimLog: string;
	run(args: readonly string[]): Promise<CliProcessResult>;
	begin(path: string): Promise<string>;
	owner(args: readonly string[]): Promise<CliProcessResult>;
	interruptComplete(transactionId: string): Promise<void>;
	killDuringLaunch(
		transactionId: string,
		summary: string,
		until: "claimed" | "acknowledged",
	): Promise<void>;
	releaseCheck(): Promise<void>;
	git(...args: string[]): string;
	gitBare(...args: string[]): string;
	remoteRefs(): string;
	unrelatedSnapshot(): Promise<unknown>;
}

/** One owner-state-isolated public-process view over a prepared real-Git fixture. @internal */
export interface StateIsolatedFixture {
	readonly stateRoot: string;
	readonly env: NodeJS.ProcessEnv;
	readonly shimMarker: string;
	cleanup(): Promise<void>;
	run(args: readonly string[]): Promise<CliProcessResult>;
}

/** Optional controls for one disposable public-process fixture. @internal */
interface LiveAcceptanceFixtureOptions {
	readonly activate?: boolean;
	readonly blockingCheck?: boolean;
	readonly privateForegroundDelayMs?: number;
	readonly privateLaunchTimeoutMs?: number;
	readonly privateRepairLaunchTimeoutMs?: number;
	readonly privateLegacyRepairLaunchTimeoutMs?: number;
	readonly privateChildDelayMs?: number;
	readonly privateChildMode?: "malformed_ack" | "delayed_repair_result";
	readonly leaseDurationMs?: number;
	readonly profile?: string;
	readonly shimMode?: string;
}

/** Follow an accepted Doctor task through the public inspection surface. @internal */
export async function runDoctorToTerminal(
	fixture: Pick<Fixture, "run">,
	args: readonly string[],
): Promise<CliProcessResult> {
	const accepted = await fixture.run(args);
	if (accepted.exitCode !== 0) return accepted;
	const acceptedData = parseCliProcessJson<{
		data?: { task_id?: string; task_state?: string };
	}>(accepted).data;
	if (
		!acceptedData?.task_id ||
		["closed", "unknown"].includes(acceptedData.task_state ?? "")
	) {
		return accepted;
	}
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const inspection = await fixture.run([
			"doctor",
			"--task-id",
			acceptedData.task_id,
			"--json",
		]);
		const taskState = parseCliProcessJson<{
			data?: { task_state?: string };
		}>(inspection).data?.task_state;
		if (taskState === "closed" || taskState === "unknown") return inspection;
		await Bun.sleep(25);
	}
	throw new Error(`Background Doctor task ${acceptedData.task_id} did not terminate`);
}

/** Create one isolated real-Git acceptance fixture. @internal */
export async function createFixture(
	options: LiveAcceptanceFixtureOptions = {},
): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), "vault-git-live-acceptance-"));
	roots.push(root);
	const bare = join(root, "remote.git");
	git(root, "init", "--bare", "--initial-branch=main", bare);
	return createCloneFixture(root, bare, "vault", options);
}

/** Create a second clone sharing a fixture's bare remote. @internal */
export async function createSibling(fixture: Fixture, name: string): Promise<Fixture> {
	return createCloneFixture(fixture.root, fixture.bare, name, {
		profile: `${name}-profile`,
	});
}

/** Fork quiescent receipt state while retaining the source fixture's real Git checkout. @internal */
export async function createStateIsolatedFixture(
	fixture: Fixture,
	ordinal: number,
): Promise<StateIsolatedFixture> {
	if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
		throw new Error("state-isolated fixture ordinal must be a non-negative integer");
	}
	await assertFixtureStateQuiescent(fixture.stateRoot);
	const name = `state-isolated-${ordinal}`;
	const stateRoot = join(fixture.root, `${name}-state`);
	const shimMarker = join(fixture.root, `${name}-shim-marker`);
	const shimLog = join(fixture.root, `${name}-shim-log`);
	await cp(fixture.stateRoot, stateRoot, {
		recursive: true,
		force: false,
		errorOnExist: true,
	});
	try {
		await assertFixtureStateQuiescent(stateRoot);
	} catch (error) {
		await rm(stateRoot, { recursive: true, force: true });
		throw error;
	}
	stateRoots.push(stateRoot);
	const env: NodeJS.ProcessEnv = {
		...fixture.env,
		VAULT_GIT_STATE_ROOT: stateRoot,
		VAULT_GIT_SHIM_MARKER: shimMarker,
		VAULT_GIT_SHIM_LOG: shimLog,
	};
	const run = (args: readonly string[]) =>
		runCliProcess({
			label: `vault-git ${args.join(" ")}`,
			argv: ["bun", "run", cliPath, ...args],
			cwd: packageRoot,
			env,
			timeoutMs: 45_000,
		});
	let cleanupPromise: Promise<void> | undefined;
	const cleanup = (): Promise<void> => {
		cleanupPromise ??= cleanupFixtureState(stateRoot);
		return cleanupPromise;
	};
	return { stateRoot, env, shimMarker, cleanup, run };
}

async function createCloneFixture(
	root: string,
	bare: string,
	name: string,
	options: LiveAcceptanceFixtureOptions,
): Promise<Fixture> {
	const clone = join(root, name);
	const stateRoot = join(root, `${name}-state`);
	stateRoots.push(stateRoot);
	const profileRoot = join(root, options.profile ?? `${name}-profile`);
	const shimMarker = join(root, `${name}-shim-marker`);
	const shimLog = join(root, `${name}-shim-log`);
	const checkMarker = join(root, `${name}-check-marker`);
	const checkLog = join(root, `${name}-check-log`);
	git(root, "clone", bare, clone);
	git(clone, "config", "user.name", "Vault Acceptance Test");
	git(clone, "config", "user.email", "vault-acceptance@example.invalid");
	if (!hasRef(bare, "refs/heads/main")) {
		await mkdir(join(clone, "notes"), { recursive: true });
		await writeFile(join(clone, "notes/event.md"), "baseline event\n");
		await writeFile(join(clone, "staged.md"), "staged baseline\n");
		await writeFile(join(clone, "unstaged.md"), "unstaged baseline\n");
		await writeFile(
			join(clone, "package.json"),
			`${JSON.stringify(
				{
					private: true,
					scripts: { check: "bun run vault-check.ts" },
				},
				null,
				2,
			)}\n`,
		);
		await writeFile(
			join(clone, "vault-check.ts"),
			[
				'import { appendFile, writeFile } from "node:fs/promises";',
				'import { existsSync } from "node:fs";',
				"const marker = process.env.VAULT_GIT_CHECK_MARKER;",
				"const log = process.env.VAULT_GIT_CHECK_LOG;",
				'if (log) await appendFile(log, "worker\\n");',
				'if (marker) { await writeFile(marker, "checking\\n"); while (!existsSync([marker, ".release"].join(""))) await Bun.sleep(10); }',
			].join("\n"),
		);
		await writeFile(join(clone, "bun.lock"), "{}\n");
		git(
			clone,
			"add",
			"--",
			"notes/event.md",
			"staged.md",
			"unstaged.md",
			"package.json",
			"vault-check.ts",
			"bun.lock",
		);
		git(clone, "commit", "-m", "test: seed live acceptance vault");
		git(clone, "push", "-u", "origin", "HEAD:refs/heads/main");
		git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
	}
	await writeFile(join(clone, "staged.md"), `${name} staged bytes\n`);
	git(clone, "add", "--", "staged.md");
	await writeFile(join(clone, "unstaged.md"), `${name} unstaged bytes\n`);
	await writeFile(join(clone, "untracked.md"), `${name} untracked bytes\n`);
	await mkdir(profileRoot, { recursive: true });
	const realGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
	const shimDirectory = join(root, `${name}-bin`);
	await mkdir(shimDirectory, { recursive: true });
	await writeFile(join(shimDirectory, "git"), gitShimSource());
	await chmod(join(shimDirectory, "git"), 0o755);
	const env: NodeJS.ProcessEnv = {
		...process.env,
		HOME: profileRoot,
		XDG_CONFIG_HOME: join(profileRoot, ".config"),
		XDG_STATE_HOME: join(profileRoot, ".state"),
		PATH: `${shimDirectory}:${process.env.PATH ?? ""}`,
		VAULT_GIT_REPOSITORY_PATH: clone,
		VAULT_GIT_CHECK_REPOSITORY_PATH: clone,
		VAULT_GIT_STATE_ROOT: stateRoot,
		VAULT_GIT_REPOSITORY_IDENTITY: "live-acceptance-vault",
		VAULT_GIT_ACTOR: `agent-${name}`,
		VAULT_GIT_HOST: `host-${name}`,
		VAULT_GIT_REMOTE: "origin",
		VAULT_GIT_REAL_GIT: realGit,
		VAULT_GIT_SHIM_MARKER: shimMarker,
		VAULT_GIT_TEST_HARNESS: "1",
		VAULT_GIT_SHIM_LOG: shimLog,
		VAULT_GIT_CHECK_LOG: checkLog,
		...(options.privateForegroundDelayMs === undefined
			? {}
			: {
					VAULT_GIT_TEST_PRIVATE_FOREGROUND_DELAY_MS: String(
						options.privateForegroundDelayMs,
					),
				}),
		...(options.shimMode ? { VAULT_GIT_SHIM_MODE: options.shimMode } : {}),
		...(options.blockingCheck ? { VAULT_GIT_CHECK_MARKER: checkMarker } : {}),
		...(options.privateLaunchTimeoutMs === undefined
			? {}
			: {
					VAULT_GIT_TEST_PRIVATE_LAUNCH_TIMEOUT_MS: String(
						options.privateLaunchTimeoutMs,
					),
			}),
		...(options.privateRepairLaunchTimeoutMs === undefined
			? {}
			: {
					VAULT_GIT_TEST_PRIVATE_REPAIR_LAUNCH_TIMEOUT_MS: String(
						options.privateRepairLaunchTimeoutMs,
					),
				}),
		...(options.privateLegacyRepairLaunchTimeoutMs === undefined
			? {}
			: {
					VAULT_GIT_TEST_PRIVATE_LEGACY_REPAIR_LAUNCH_TIMEOUT_MS: String(
						options.privateLegacyRepairLaunchTimeoutMs,
					),
				}),
		...(options.privateChildDelayMs === undefined
			? {}
			: {
					VAULT_GIT_TEST_PRIVATE_CHILD_DELAY_MS: String(
						options.privateChildDelayMs,
					),
				}),
		...(options.privateChildMode === undefined
			? {}
			: { VAULT_GIT_TEST_PRIVATE_CHILD_MODE: options.privateChildMode }),
		...(options.leaseDurationMs === undefined
			? {}
			: {
					VAULT_GIT_TEST_LEASE_DURATION_MS: String(options.leaseDurationMs),
				}),
	};
	const repositoryIdentity = (
		await resolveVaultRepositoryIdentity({
			repositoryPath: clone,
			process: createNodeProcessPort(),
			timeoutMs: 5_000,
		})
	).identity;
	const store = createReceiptStore({
		stateRoot,
		repositoryIdentity,
	});
	if (options.activate !== false) await admitActivationForTest(store);
	const run = (args: readonly string[]) =>
		runCliProcess({
			label: `vault-git ${args.join(" ")}`,
			argv: ["bun", "run", cliPath, ...args],
			cwd: packageRoot,
			env,
			timeoutMs: 45_000,
		});
	const begin = async (path: string): Promise<string> => {
		const result = await run(beginArgs(path));
		expect(result.exitCode).toBe(0);
		const transactionId = (
			parseCliProcessJson(result) as { data?: { transaction_id?: string } }
		).data?.transaction_id;
		if (!transactionId) throw new Error("begin omitted transaction id");
		return transactionId;
	};
	const owner = async (args: readonly string[]): Promise<CliProcessResult> => {
		const loaded = await store.load();
		if (loaded.status !== "loaded") throw new Error("owner receipt unavailable");
		const launched = await launchCapabilityProcess(store, {
			receiptId: loaded.receipt.receiptId,
			role: "owner",
			command: process.execPath,
			args: [cliPath, ...args],
			cwd: clone,
			timeoutMs: 45_000,
			env,
		});
		return {
			label: `vault-git owner ${args.join(" ")}`,
			argv: [process.execPath, cliPath, ...args, "--capability-fd", "3"],
			cwd: clone,
			exitCode: launched.exitCode,
			stdout: launched.stdout,
			stderr: launched.stderr,
			timedOut: launched.timedOut,
			signal: null,
			timeoutMs: 45_000,
		};
	};
	const interruptComplete = async (transactionId: string): Promise<void> => {
		const loaded = await store.load();
		if (loaded.status !== "loaded") throw new Error("interrupt receipt unavailable");
		const descriptor = openSync(store.capabilityPath(loaded.receipt.receiptId, "owner"), "r");
		const child = spawn(
			process.execPath,
			[
				cliPath,
				"complete",
				"--transaction-id",
				transactionId,
				"--summary",
				"docs(vault): interrupt checking",
				"--json",
				"--capability-fd",
				"3",
			],
			{ cwd: clone, env, stdio: ["ignore", "pipe", "pipe", descriptor] },
		);
		closeSync(descriptor);
		await waitForFile(checkMarker, 10_000);
		child.kill("SIGKILL");
		await new Promise<void>((resolveChild) => child.once("close", () => resolveChild()));
	};
	// Kill the foreground through the ordinary launch path -- no --capability-fd,
	// so launchBackgroundCompletion actually runs and the detached worker exists.
	const killDuringLaunch = async (
		transactionId: string,
		summary: string,
		until: "claimed" | "acknowledged",
	): Promise<void> => {
		const child = spawn(
			process.execPath,
			[
				"run",
				cliPath,
				"complete",
				"--transaction-id",
				transactionId,
				"--summary",
				summary,
				"--json",
			],
			{ cwd: packageRoot, env, stdio: ["ignore", "pipe", "pipe"] },
		);
		const closed = waitForChildClose(child);
		try {
			await waitForTaskState(
				stateRoot,
				until === "claimed"
					? (state) => state === "claimed" || state === "launching"
					: (state) => state === "in_progress",
				10_000,
			);
		} catch {
			// The kill is the point of this helper. Losing the race to the target
			// state still leaves a dead parent, which the caller's assertions cover.
		} finally {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGKILL");
			}
			await closed;
		}
	};
	return {
		root,
		bare,
		clone,
		stateRoot,
		env,
		checkMarker,
		checkLog,
		shimMarker,
		shimLog,
		run,
		begin,
		owner,
		interruptComplete,
		killDuringLaunch,
		releaseCheck: () => writeFile(`${checkMarker}.release`, "release\n"),
		git: (...args) => git(clone, ...args),
		gitBare: (...args) => git(bare, ...args),
		remoteRefs: () => remoteRefs(bare),
		unrelatedSnapshot: async () => ({
			status: git(
				clone,
				"status",
				"--porcelain=v2",
				"-z",
				"--",
				":(top)",
				":(top,exclude,literal)notes/event.md",
			),
			index: git(
				clone,
				"ls-files",
				"--stage",
				"-z",
				"--",
				":(top)",
				":(top,exclude,literal)notes/event.md",
			),
			staged: await readFile(join(clone, "staged.md"), "hex"),
			unstaged: await readFile(join(clone, "unstaged.md"), "hex"),
			untracked: await readFile(join(clone, "untracked.md"), "hex"),
		}),
	};
}

async function cleanupFixtureState(stateRoot: string): Promise<void> {
	await settleFixtureCleanup(
		() => terminateFixtureWorkers(stateRoot),
		async () => {
			await rm(stateRoot, { recursive: true, force: true });
			removeTrackedPath(stateRoots, stateRoot);
		},
		"state-isolated fixture cleanup failed",
	);
}

/** Run root removal even when worker cleanup fails, then preserve every failure. @internal */
export async function settleFixtureCleanup(
	terminateWorkers: () => Promise<void>,
	removeRoots: () => Promise<void>,
	message: string,
): Promise<void> {
	const failures: unknown[] = [];
	try {
		await terminateWorkers();
	} catch (error) {
		failures.push(error);
	}
	try {
		await removeRoots();
	} catch (error) {
		failures.push(error);
	}
	throwCleanupFailures(failures, message);
}

async function settleCleanupOperations(
	operations: readonly Promise<unknown>[],
	message: string,
): Promise<void> {
	const failures = (await Promise.allSettled(operations))
		.filter(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		)
		.map((result) => result.reason);
	throwCleanupFailures(failures, message);
}

function throwCleanupFailures(failures: readonly unknown[], message: string): void {
	if (failures.length === 0) return;
	if (failures.length === 1) throw failures[0];
	throw new AggregateError(failures, message);
}

function removeTrackedPath(paths: string[], target: string): void {
	const index = paths.indexOf(target);
	if (index >= 0) paths.splice(index, 1);
}

/** Host and path attacks every workflow must reject without mutation. @internal */
export const hostileScenarios: readonly {
	readonly name: string;
	readonly path?: string;
	readonly args?: readonly string[];
	readonly expectedCode: string;
	readonly arrange: (fixture: Fixture) => Promise<void>;
}[] = [
	{
		name: "core.hooksPath",
		expectedCode: "host_contract_breach",
		arrange: async (fixture) => {
			fixture.git("config", "--local", "core.hooksPath", "hostile-hooks");
		},
	},
	{
		name: "credential helper",
		expectedCode: "host_contract_breach",
		arrange: async (fixture) => {
			fixture.git("config", "--local", "credential.helper", "!false");
		},
	},
	{
		name: "repository hook",
		expectedCode: "host_contract_breach",
		arrange: async (fixture) => {
			const hook = join(fixture.clone, ".git/hooks/pre-commit");
			await writeFile(hook, "#!/bin/sh\nexit 1\n");
			await chmod(hook, 0o755);
		},
	},
	{
		name: "ext transport",
		expectedCode: "host_contract_breach",
		arrange: async (fixture) => {
			fixture.git("remote", "set-url", "origin", "ext::false");
		},
	},
	{
		name: "embedded credentials",
		expectedCode: "host_contract_breach",
		arrange: async (fixture) => {
			fixture.git(
				"remote",
				"set-url",
				"origin",
				"https://fixture-user:fixture-pass@example.invalid/vault.git",
			);
		},
	},
	{
		name: "insteadOf rewrite",
		expectedCode: "host_contract_breach",
		arrange: async (fixture) => {
			fixture.git(
				"config",
				"--local",
				"url.https://mirror.invalid/.insteadOf",
				"https://origin.invalid/",
			);
		},
	},
	{
		name: "core.sshCommand",
		expectedCode: "host_contract_breach",
		arrange: async (fixture) => {
			fixture.git("config", "--local", "core.sshCommand", "true");
		},
	},
	{
		name: "symlink escape",
		path: "escaped/event.md",
		expectedCode: "owned_path_not_admitted",
		arrange: async (fixture) => {
			await symlink(dirname(fixture.root), join(fixture.clone, "escaped"));
		},
	},
	{
		name: "option-shaped path",
		args: ["begin", "--event", "note_created", "--path", "--force", "--json"],
		expectedCode: "invalid_usage",
		arrange: async () => {},
	},
	{
		name: "option-shaped inline path",
		args: ["begin", "--event", "note_created", "--path=--force", "--json"],
		expectedCode: "invalid_usage",
		arrange: async () => {},
	},
];

/** Build the public begin argv used by acceptance rows. @internal */
export function beginArgs(path: string, runId?: string): string[] {
	return [
		"begin",
		"--event",
		"note_created",
		"--path",
		path,
		"--json",
		...(runId ? ["--run-id", runId] : []),
	];
}

/** Remove run-local fields before comparing public policy envelopes. @internal */
export function projectPolicy(result: CliProcessResult): Record<string, unknown> {
	const envelope = parseCliProcessJson<Record<string, unknown>>(result);
	const { run_id: _runId, duration_ms: _duration, error, ...policy } = envelope;
	if (!error || typeof error !== "object" || Array.isArray(error)) return policy;
	const { run_id: _errorRunId, ...errorPolicy } = error as Record<string, unknown>;
	return { ...policy, error: errorPolicy };
}

function git(cwd: string, ...args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	});
	if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
	return result.stdout.trim();
}

function hasRef(bare: string, ref: string): boolean {
	return spawnSync("git", ["show-ref", "--verify", "--quiet", ref], {
		cwd: bare,
	}).status === 0;
}

function remoteRefs(bare: string): string {
	// ALL remote refs, not just the contract pair: a synthetic capability-probe
	// ref materializing anywhere on the remote must fail the before/after
	// snapshot comparisons, proving the probe stays dry-run only.
	return git(bare, "for-each-ref", "--format=%(refname)%00%(objectname)");
}

/** Every git push argv the shim observed, in invocation order. @internal */
export async function recordedPushes(fixture: Fixture): Promise<string[][]> {
	const raw = await readFile(fixture.shimLog, "utf8").catch(() => "");
	return raw
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as string[]);
}

/** Wait for a process-boundary marker emitted by the fixture. @internal */
export async function waitForFile(path: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await Bun.file(path).exists()) return;
		await Bun.sleep(10);
	}
	throw new Error(`timed out waiting for ${path}`);
}

/** Read every durable task record the private state root currently holds. @internal */
export async function readTaskStates(
	stateRoot: string,
	timeoutMs = 5_000,
): Promise<
	readonly {
		taskId: string;
		state: string;
		phase: string;
		workerPid: number | null;
		workerProcessIdentity: string | null;
	}[]
> {
	const managerRoot = join(stateRoot, "vault-git-transaction-manager");
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const repositories = await readdir(managerRoot).catch(() => []);
		const states: {
			taskId: string;
			state: string;
			phase: string;
			workerPid: number | null;
			workerProcessIdentity: string | null;
		}[] = [];
		for (const repository of repositories) {
			const tasks = join(managerRoot, repository, "tasks");
			for (const taskId of await readdir(tasks).catch(() => [])) {
				const record = await readLatestTaskRevision(
					join(tasks, taskId, "history"),
				);
				if (!record || record.taskId !== taskId) continue;
				states.push({
					taskId,
					state: record.state,
					phase: record.phase,
					workerPid: record.workerPid,
					workerProcessIdentity: record.workerProcessIdentity,
				});
			}
		}
		if (states.length > 0) return states;
		await Bun.sleep(10);
	}
	throw new Error("timed out waiting for durable task history");
}

/** Count durable Doctor task directories beneath one private state root. @internal */
export async function countDoctorTasks(stateRoot: string): Promise<number> {
	const managerRoot = join(stateRoot, "vault-git-transaction-manager");
	let count = 0;
	for (const repository of await readdir(managerRoot).catch(() => [])) {
		count += (
			await readdir(join(managerRoot, repository, "doctor-tasks")).catch(
				() => [],
			)
		).length;
	}
	return count;
}

/**
 * Inject malformed terminal evidence for public fail-closed acceptance.
 *
 * @param stateRoot - Fixture-private state root
 * @param taskId - Exact Doctor task whose latest revision will be corrupted
 * @param privateText - Sentinel that public output must never expose
 * @returns Promise settled after the malformed revision is written
 * @internal
 */
export async function corruptDoctorTaskTerminal(
	stateRoot: string,
	taskId: string,
	privateText: string,
): Promise<void> {
	const managerRoot = join(stateRoot, "vault-git-transaction-manager");
	for (const repository of await readdir(managerRoot)) {
		const history = join(managerRoot, repository, "doctor-tasks", taskId, "history");
		const latest = (await readdir(history).catch(() => []))
			.filter((name) => /^\d{12}\.json$/u.test(name))
			.sort()
			.at(-1);
		if (!latest) continue;
		const path = join(history, latest);
		const record = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
		const terminalResult = record.terminalResult;
		if (!terminalResult || typeof terminalResult !== "object") {
			throw new Error("Doctor terminal result unavailable for corruption proof");
		}
		record.terminalResult = {
			...terminalResult,
			privateEvidence: privateText,
			nextAction: {
				id: "run_repair",
				summary: privateText,
			},
		};
		await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
		return;
	}
	throw new Error("Doctor task history unavailable for corruption proof");
}

async function readLatestTaskRevision(history: string): Promise<{
	readonly taskId: string;
	readonly state: string;
	readonly phase: string;
	readonly workerPid: number | null;
	readonly workerProcessIdentity: string | null;
} | null> {
	const latest = (await readdir(history).catch(() => []))
		.filter((name) => /^\d{12}\.json$/.test(name))
		.sort()
		.at(-1);
	if (!latest) return null;
	const source = await readFile(join(history, latest), "utf8").catch(() => "");
	if (!source) return null;
	try {
		const record = JSON.parse(source) as Record<string, unknown>;
		if (
			typeof record.taskId !== "string" ||
			typeof record.state !== "string" ||
			typeof record.phase !== "string" ||
			(record.workerPid !== null &&
				(typeof record.workerPid !== "number" ||
					!Number.isSafeInteger(record.workerPid) ||
					record.workerPid <= 0)) ||
			(record.workerProcessIdentity !== null &&
				(typeof record.workerProcessIdentity !== "string" ||
					!/^[0-9a-f]{64}$/u.test(record.workerProcessIdentity))) ||
			(record.workerPid === null) !== (record.workerProcessIdentity === null)
		) {
			return null;
		}
		return {
			taskId: record.taskId,
			state: record.state,
			phase: record.phase,
			workerPid: record.workerPid as number | null,
			workerProcessIdentity: record.workerProcessIdentity as string | null,
		};
	} catch {
		return null;
	}
}

async function terminateFixtureWorkers(stateRoot: string): Promise<void> {
	const managerRoot = join(stateRoot, "vault-git-transaction-manager");
	for (const repository of await readdir(managerRoot).catch(() => [])) {
		for (const family of ["tasks", "doctor-tasks"] as const) {
			const tasks = join(managerRoot, repository, family);
			for (const taskId of await readdir(tasks).catch(() => [])) {
				const record = await readLatestTaskRevision(
					join(tasks, taskId, "history"),
				);
				if (
					record?.workerPid === null ||
					record?.workerPid === undefined ||
					record.workerProcessIdentity === null
				) {
					continue;
				}
				await terminateMatchingWorkerGroup(
					record.workerPid,
					record.workerProcessIdentity,
				);
			}
		}
	}
}

async function assertFixtureStateQuiescent(stateRoot: string): Promise<void> {
	const managerRoot = join(stateRoot, "vault-git-transaction-manager");
	for (const repository of await readdir(managerRoot).catch(() => [])) {
		for (const family of ["tasks", "doctor-tasks"] as const) {
			const tasks = join(managerRoot, repository, family);
			for (const taskId of await readdir(tasks).catch(() => [])) {
				const record = await readLatestTaskRevision(
					join(tasks, taskId, "history"),
				);
				if (
					record?.workerPid !== null &&
					record?.workerPid !== undefined &&
					record.workerProcessIdentity !== null
				) {
					throw new Error(
						"state-isolated fixture source must be quiescent before copying",
					);
				}
			}
		}
	}
}

async function terminateMatchingWorkerGroup(
	pid: number,
	expectedIdentity: string,
): Promise<void> {
	if (observeWorkerProcess(pid, expectedIdentity) !== "matching") return;
	try {
		process.kill(-pid, "SIGKILL");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") {
			if (observeWorkerProcess(pid, expectedIdentity) !== "matching") return;
			process.kill(pid, "SIGKILL");
		} else {
			throw error;
		}
	}
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		if (observeWorkerProcess(pid, expectedIdentity) === "absent") return;
		await Bun.sleep(10);
	}
	throw new Error(`fixture worker ${pid} survived cleanup`);
}

/** Kill only the worker whose durable pid and process identity still match. @internal */
export async function killWorkerForTask(
	stateRoot: string,
	taskId: string,
	timeoutMs: number,
): Promise<void> {
	if (!/^task_[0-9a-f]{32}$/.test(taskId)) throw new Error("invalid task id");
	const managerRoot = join(stateRoot, "vault-git-transaction-manager");
	const deadline = Date.now() + timeoutMs;
	let worker: { readonly pid: number; readonly identity: string } | null = null;
	while (Date.now() < deadline && worker === null) {
		for (const repository of await readdir(managerRoot).catch(() => [])) {
			const record = await readLatestTaskRevision(
				join(managerRoot, repository, "tasks", taskId, "history"),
			);
			if (
				record?.taskId === taskId &&
				record.workerPid !== null &&
				record.workerProcessIdentity !== null
			) {
				worker = {
					pid: record.workerPid,
					identity: record.workerProcessIdentity,
				};
				break;
			}
		}
		if (worker === null) await Bun.sleep(10);
	}
	if (worker === null) throw new Error("durable task omitted worker identity");
	if (observeWorkerProcess(worker.pid, worker.identity) !== "matching") {
		throw new Error("durable worker process identity did not match");
	}
	try {
		process.kill(worker.pid, "SIGKILL");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") {
			throw new Error("durable worker pid was already absent", { cause: error });
		}
		throw error;
	}
	const exitDeadline = Date.now() + timeoutMs;
	while (Date.now() < exitDeadline) {
		const observed = observeWorkerProcess(worker.pid, worker.identity);
		if (observed === "absent") return;
		if (observed === "mismatch") {
			throw new Error("durable worker process identity changed after SIGKILL");
		}
		await Bun.sleep(10);
	}
	throw new Error("durable worker pid survived SIGKILL");
}

/** Observe whether an exact fixture worker identity still owns its recorded pid. @internal */
export function observeWorkerProcess(
	pid: number,
	expectedIdentity: string,
): "matching" | "absent" | "mismatch" {
	try {
		process.kill(pid, 0);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return "absent";
		throw error;
	}
	try {
		return readVaultGitProcessIdentity(pid) === expectedIdentity
			? "matching"
			: "mismatch";
	} catch (error) {
		try {
			process.kill(pid, 0);
		} catch (probeError) {
			if ((probeError as NodeJS.ErrnoException).code === "ESRCH") return "absent";
		}
		throw error;
	}
}

/** Wait until any durable task reaches a caller-selected state. @internal */
export async function waitForTaskState(
	stateRoot: string,
	matches: (state: string) => boolean,
	timeoutMs: number,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const states = await readTaskStates(stateRoot);
		if (states.some((task) => matches(task.state))) return;
		await Bun.sleep(10);
	}
	throw new Error("timed out waiting for durable task state");
}

function gitShimSource(): string {
	return `#!/usr/bin/env bun
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const args = Bun.argv.slice(2);
const realGit = process.env.VAULT_GIT_REAL_GIT ?? "/usr/bin/git";
const mode = process.env.VAULT_GIT_SHIM_MODE;
const marker = process.env.VAULT_GIT_SHIM_MARKER ?? "";
const log = process.env.VAULT_GIT_SHIM_LOG ?? "";
if (log && args[0] === "push") appendFileSync(log, JSON.stringify(args) + "\\n");
const atomic = args[0] === "push" && args.includes("--atomic");
const dryRun = args.includes("--dry-run");
if (mode === "atomic_unsupported" && atomic && dryRun) {
  process.stderr.write("fatal: the receiving end does not support atomic push\\n");
  process.exit(1);
}
// Every network verb fails as if the host were unreachable, so the real
// transport classifier runs against a genuine failure instead of a fake port.
if (mode === "remote_offline" && ["push", "fetch", "ls-remote"].includes(args[0] ?? "")) {
  process.stderr.write("fatal: unable to access remote: Could not resolve host\\n");
  process.exit(128);
}
if (mode === "doctor_blocking" && marker && ["fetch", "ls-remote"].includes(args[0] ?? "")) {
  writeFileSync(marker, "doctor remote check blocked\\n");
  while (!existsSync(marker + ".release")) await Bun.sleep(10);
}
if (mode === "lost_ack" && marker && existsSync(marker) && ["fetch", "ls-remote"].includes(args[0] ?? "")) {
  process.stderr.write("fatal: simulated reconciliation outage\\n");
  process.exit(1);
}
if (atomic && !dryRun && mode === "failed_close") {
  process.stderr.write("fatal: simulated push failure\\n");
  process.exit(1);
}
if (atomic && !dryRun && mode === "partial_close") {
  const remote = args.find((arg, index) => index > 0 && !arg.startsWith("-"));
  const main = args.find((arg) => arg.endsWith(":refs/heads/main"));
  if (!remote || !main) process.exit(2);
  const result = Bun.spawnSync([realGit, "push", "--porcelain", "--no-verify", remote, main], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  process.exit(result.exitCode === 0 ? 1 : result.exitCode);
}
const result = Bun.spawnSync([realGit, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
if (atomic && !dryRun && mode === "lost_ack" && result.exitCode === 0) {
  writeFileSync(marker, "remote accepted; acknowledgement lost\\n");
  process.exit(1);
}
process.exit(result.exitCode);
`;
}
