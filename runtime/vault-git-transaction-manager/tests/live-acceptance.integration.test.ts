import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
	parseCliProcessJson,
	runCliProcess,
	type CliProcessResult,
} from "@side-quest/cli-command-facade/testing";

import { VAULT_GIT_LEDGER_REF } from "../src/model.ts";
import { createReceiptStore, launchCapabilityProcess } from "../src/store.ts";
import { admitActivationForTest } from "./activation-fixture.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "src", "cli.ts");
const roots: string[] = [];

setDefaultTimeout(30_000);

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("live acceptance across real CLI and Git process boundaries", () => {
	test("full success closes atomically and preserves unrelated bytes", async () => {
		const fixture = await createFixture();
		const unrelatedBefore = await fixture.unrelatedSnapshot();
		const remoteBefore = fixture.remoteRefs();
		expect(remoteBefore).not.toMatch(/vault-system\/probe-/);
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "completed event\n");
		const completed = await fixture.owner([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): record accepted event",
			"--json",
		]);
		expect(completed.exitCode).toBe(0);
		expect(parseCliProcessJson(completed)).toMatchObject({
			status: "ok",
			data: { outcome: "completed", phase: "closed", changed_state: "remote" },
		});
		expect(fixture.gitBare("show", "refs/heads/main:notes/event.md")).toBe(
			"completed event",
		);
		expect(
			JSON.parse(fixture.gitBare("show", `${VAULT_GIT_LEDGER_REF}:ledger.json`)),
		).toMatchObject({
			operation: "release",
			lease: { transaction_id: transactionId, state: "released" },
		});
		expect(await fixture.unrelatedSnapshot()).toEqual(unrelatedBefore);

		// The synthetic capability-probe refs must never materialize: the full
		// remote ref set is exactly the contract pair, with no probe residue.
		const remoteAfter = fixture.remoteRefs();
		expect(remoteAfter).not.toMatch(/vault-system\/probe-/);
		expect(
			remoteAfter
				.split("\n")
				.map((line) => line.split("\0")[0])
				.sort(),
		).toEqual(["refs/heads/main", VAULT_GIT_LEDGER_REF].sort());

		// Shim-recorded push mechanics: the capability probe dry-runs TWO
		// synthetic contract-shaped refs before the one real close, and the
		// real close is the exact atomic two-refspec push (KTD4).
		const pushes = await recordedPushes(fixture);
		const dryRuns = pushes.filter((args) => args.includes("--dry-run"));
		const closes = pushes.filter(
			(args) => args.includes("--atomic") && !args.includes("--dry-run"),
		);
		expect(dryRuns.length).toBeGreaterThanOrEqual(1);
		for (const probe of dryRuns) {
			for (const flag of ["--atomic", "--porcelain", "--no-verify"]) {
				expect(probe).toContain(flag);
			}
			expect(probe).toContain("origin");
			const refspecs = probe.filter((argument) => argument.includes(":refs/"));
			expect(refspecs).toHaveLength(2);
			expect(refspecs[0]).toMatch(
				/^[0-9a-f]{40,64}:refs\/heads\/vault-system\/probe-[0-9a-f]{32}\/main$/,
			);
			expect(refspecs[1]).toMatch(
				/^[0-9a-f]{40,64}:refs\/heads\/vault-system\/probe-[0-9a-f]{32}\/transaction-ledger$/,
			);
		}
		expect(closes).toHaveLength(1);
		const close = closes[0] as string[];
		for (const flag of ["--atomic", "--porcelain", "--no-verify"]) {
			expect(close).toContain(flag);
		}
		expect(close).toContain("origin");
		const mainCommit = fixture.gitBare("rev-parse", "refs/heads/main");
		const ledgerCommit = fixture.gitBare("rev-parse", VAULT_GIT_LEDGER_REF);
		expect(close).toContain(`${mainCommit}:refs/heads/main`);
		expect(close).toContain(`${ledgerCommit}:${VAULT_GIT_LEDGER_REF}`);
		// Sequencing: every dry-run probe precedes the sole real atomic close.
		const closeIndex = pushes.indexOf(close);
		for (const probe of dryRuns) {
			expect(pushes.indexOf(probe)).toBeLessThan(closeIndex);
		}
	});

	test("two clones admit exactly one writer and fence the stale generation", async () => {
		const laptop = await createFixture();
		const mini = await createSibling(laptop, "mac-mini");
		const [first, second] = await Promise.all([
			laptop.run(beginArgs("notes/event.md")),
			mini.run(beginArgs("notes/event.md")),
		]);
		const results = [first, second];
		expect(results.filter((result) => result.exitCode === 0)).toHaveLength(1);
		const refusal = results.find((result) => result.exitCode !== 0);
		expect(refusal).toBeDefined();
		expect(parseCliProcessJson(refusal as CliProcessResult)).toMatchObject({
			status: "error",
			data: { outcome: "refused" },
		});
		expect(
			["remote_moved", "lease_active", "lease_generation_stale"],
		).toContain(
			(parseCliProcessJson(refusal as CliProcessResult) as {
				error?: { code?: string };
			}).error?.code ?? "missing_refusal_code",
		);
	});

	test("remote main movement stops completion with deliberate replay guidance", async () => {
		const fixture = await createFixture();
		const sibling = await createSibling(fixture, "remote-writer");
		const unrelatedBefore = await fixture.unrelatedSnapshot();
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "preserve me\n");
		await writeFile(join(sibling.clone, "remote-move.md"), "remote movement\n");
		sibling.git("add", "--", "remote-move.md");
		sibling.git("commit", "-m", "test: move remote main");
		sibling.git("push", "origin", "HEAD:refs/heads/main");
		const refused = await fixture.owner([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): record moved event",
			"--json",
		]);
		expect(refused.exitCode).toBe(1);
		expect(parseCliProcessJson(refused)).toMatchObject({
			status: "error",
			error: { code: "remote_moved" },
			continuation: { next_action_id: "preserve_local_edits" },
			data: { changed_state: "none" },
		});
		expect(await fixture.unrelatedSnapshot()).toEqual(unrelatedBefore);
	});

	test("failed atomic push remains pending without disturbing unrelated state", async () => {
		const fixture = await createFixture({ shimMode: "failed_close" });
		const unrelatedBefore = await fixture.unrelatedSnapshot();
		const transactionId = await fixture.begin("notes/event.md");
		const remoteBefore = fixture.remoteRefs();
		await writeFile(join(fixture.clone, "notes/event.md"), "pending event\n");
		const pending = await fixture.owner([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): record pending event",
			"--json",
		]);
		expect(parseCliProcessJson(pending)).toMatchObject({
			data: {
				transaction_state: "push_pending",
				next_action: { id: "run_doctor" },
			},
		});
		expect(fixture.remoteRefs()).toEqual(remoteBefore);
		expect(await fixture.unrelatedSnapshot()).toEqual(unrelatedBefore);
	});

	test("lost atomic-push acknowledgement closes through doctor and close-verified", async () => {
		const fixture = await createFixture({ shimMode: "lost_ack" });
		const unrelatedBefore = await fixture.unrelatedSnapshot();
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "lost ack event\n");
		const pending = await fixture.owner([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): record lost acknowledgement",
			"--json",
		]);
		expect(parseCliProcessJson(pending)).toMatchObject({
			data: { transaction_state: "push_pending" },
		});
		// Independent bare-remote evidence BEFORE doctor classifies anything:
		// the push landed on the remote even though the acknowledgement was
		// lost, so doctor's later "already closed" verdict rests on real state.
		expect(fixture.gitBare("show", "refs/heads/main:notes/event.md")).toBe(
			"lost ack event",
		);
		expect(
			JSON.parse(fixture.gitBare("show", `${VAULT_GIT_LEDGER_REF}:ledger.json`)),
		).toMatchObject({
			operation: "release",
			lease: { transaction_id: transactionId, state: "released" },
		});
		await rm(fixture.shimMarker, { force: true });
		const doctor = await fixture.run([
			"doctor",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		expect(parseCliProcessJson(doctor)).toMatchObject({
			status: "ok",
			data: {
				finding: "publication_already_closed",
				repair_action: "close-verified",
			},
		});
		const repaired = await fixture.owner([
			"repair",
			"close-verified",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		expect(parseCliProcessJson(repaired)).toMatchObject({
			status: "ok",
			data: { outcome: "repaired", phase: "closed" },
		});
		expect(await fixture.unrelatedSnapshot()).toEqual(unrelatedBefore);
	});

	test(
		"a killed checking phase resumes only through doctor and repair",
		async () => {
			const fixture = await createFixture({ blockingCheck: true });
			const transactionId = await fixture.begin("notes/event.md");
			await writeFile(join(fixture.clone, "notes/event.md"), "resumed event\n");
			await fixture.interruptComplete(transactionId);
			// A direct owner complete must refuse mid-interrupt without touching
			// state: resumption is owned by the doctor/repair path alone.
			const direct = await fixture.owner([
				"complete",
				"--transaction-id",
				transactionId,
				"--summary",
				"docs(vault): bypass doctor",
				"--json",
			]);
			expect(direct.exitCode).toBe(1);
			expect(parseCliProcessJson(direct)).toMatchObject({
				status: "error",
				error: { code: "completion_interrupted" },
				data: { changed_state: "none" },
				continuation: { next_action_id: "run_doctor" },
			});
			delete fixture.env.VAULT_GIT_CHECK_MARKER;
			const doctor = await fixture.run([
				"doctor",
				"--transaction-id",
				transactionId,
				"--json",
			]);
			expect(parseCliProcessJson(doctor)).toMatchObject({
				data: { finding: "checks_interrupted", repair_action: "resume" },
			});
			const resumed = await fixture.owner([
				"repair",
				"resume",
				"--transaction-id",
				transactionId,
				"--json",
			]);
			expect(parseCliProcessJson(resumed)).toMatchObject({
				status: "ok",
				data: { outcome: "repaired" },
			});
			const completed = await fixture.owner([
				"complete",
				"--transaction-id",
				transactionId,
				"--summary",
				"docs(vault): record resumed event",
				"--json",
			]);
			expect(parseCliProcessJson(completed)).toMatchObject({
				status: "ok",
				data: { outcome: "completed", phase: "closed" },
			});
		},
		30_000,
	);

	test("fresh HOME and XDG profiles expose identical discovery and refusal policy", async () => {
		const first = await createFixture({ profile: "profile-a" });
		const second = await createFixture({ profile: "profile-b" });
		const discoveries = await Promise.all([
			first.run(["commands", "--json", "--run-id", "profile-a"]),
			second.run(["commands", "--json", "--run-id", "profile-b"]),
		]);
		expect(projectPolicy(discoveries[1] as CliProcessResult)).toEqual(
			projectPolicy(discoveries[0] as CliProcessResult),
		);
		const refusals = await Promise.all([
			first.run(beginArgs(".git/config", "profile-a-refusal")),
			second.run(beginArgs(".git/config", "profile-b-refusal")),
		]);
		expect(projectPolicy(refusals[1] as CliProcessResult)).toEqual(
			projectPolicy(refusals[0] as CliProcessResult),
		);
	});

	test("atomic capability refusal moves no local or remote ref", async () => {
		const fixture = await createFixture({ shimMode: "atomic_unsupported" });
		const localBefore = fixture.git("rev-parse", "refs/heads/main");
		const remoteBefore = fixture.remoteRefs();
		const statusBefore = fixture.git("status", "--porcelain=v2", "-z");
		const refused = await fixture.run(beginArgs("notes/event.md"));
		expect(refused.exitCode).toBe(1);
		expect(parseCliProcessJson(refused)).toMatchObject({
			error: { code: "host_contract_breach" },
			data: { changed_state: "none" },
		});
		expect(fixture.git("rev-parse", "refs/heads/main")).toBe(localBefore);
		expect(fixture.remoteRefs()).toEqual(remoteBefore);
		expect(fixture.git("status", "--porcelain=v2", "-z")).toBe(statusBefore);
	});

	test("hostile repository and path inputs fail closed without mutation", async () => {
		for (const scenario of hostileScenarios) {
			const fixture = await createFixture();
			await scenario.arrange(fixture);
			const localBefore = fixture.git("rev-parse", "refs/heads/main");
			const remoteBefore = fixture.remoteRefs();
			const statusBefore = fixture.git("status", "--porcelain=v2", "-z");
			const refused = await fixture.run(
				scenario.args ?? beginArgs(scenario.path ?? "notes/event.md"),
			);
			// Assert the MECHANISM, not just failure: the exact refusal code
			// proves the intended guard fired rather than an incidental error.
			expect(refused.exitCode, scenario.name).toBe(
				scenario.expectedCode === "invalid_usage" ? 2 : 1,
			);
			expect(parseCliProcessJson(refused), scenario.name).toMatchObject({
				status: "error",
				error: { code: scenario.expectedCode },
				data: { changed_state: "none" },
			});
			expect(fixture.git("rev-parse", "refs/heads/main"), scenario.name).toBe(
				localBefore,
			);
			expect(fixture.remoteRefs(), scenario.name).toEqual(remoteBefore);
			expect(
				fixture.git("status", "--porcelain=v2", "-z"),
				scenario.name,
			).toBe(statusBefore);
		}
	}, 120_000);

	test("one-ref-only publication is a host contract breach with no retry", async () => {
		const fixture = await createFixture({ shimMode: "partial_close" });
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "partial event\n");
		const breached = await fixture.owner([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): reject partial publication",
			"--json",
		]);
		expect(parseCliProcessJson(breached)).toMatchObject({
			status: "error",
			error: { code: "host_contract_breach" },
			data: { retry_safety: "operator_required" },
			continuation: { next_action_id: "request_operator_review" },
		});
		const doctor = await fixture.run(["doctor", "--json"]);
		expect(parseCliProcessJson(doctor)).toMatchObject({
			data: {
				finding: "remote_contract_breach",
				blockers: ["host_contract_breach"],
			},
		});
		expect(JSON.stringify(parseCliProcessJson(doctor))).not.toContain("retry-push");
	});

	test("unadmitted activation refuses every write command", async () => {
		const fixture = await createFixture({ activate: false });
		const refsBefore = fixture.remoteRefs();
		const localBefore = fixture.git("status", "--porcelain=v2", "-z");
		const transactionId = `txn_${"1".repeat(32)}`;
		const writes = [
			beginArgs("notes/event.md"),
			["join", "--transaction-id", transactionId, "--path", "notes/event.md", "--json"],
			["complete", "--transaction-id", transactionId, "--summary", "docs(vault): blocked", "--json"],
			["repair", "resume", "--transaction-id", transactionId, "--json"],
			["tidy", "now", "--json"],
			["janitor", "--json"],
		];
		for (const args of writes) {
			const refused = await fixture.run(args);
			expect(parseCliProcessJson(refused)).toMatchObject({
				status: "error",
				error: { code: "activation_blocked" },
				data: { changed_state: "none", blockers: ["activation_blocked"] },
			});
		}
		expect(fixture.remoteRefs()).toEqual(refsBefore);
		expect(fixture.git("status", "--porcelain=v2", "-z")).toBe(localBefore);
	});
});

interface Fixture {
	readonly root: string;
	readonly bare: string;
	readonly clone: string;
	readonly stateRoot: string;
	readonly env: NodeJS.ProcessEnv;
	readonly shimMarker: string;
	readonly shimLog: string;
	run(args: readonly string[]): Promise<CliProcessResult>;
	begin(path: string): Promise<string>;
	owner(args: readonly string[]): Promise<CliProcessResult>;
	interruptComplete(transactionId: string): Promise<void>;
	git(...args: string[]): string;
	gitBare(...args: string[]): string;
	remoteRefs(): string;
	unrelatedSnapshot(): Promise<unknown>;
}

async function createFixture(
	options: {
		readonly activate?: boolean;
		readonly blockingCheck?: boolean;
		readonly profile?: string;
		readonly shimMode?: string;
	} = {},
): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), "vault-git-live-acceptance-"));
	roots.push(root);
	const bare = join(root, "remote.git");
	git(root, "init", "--bare", "--initial-branch=main", bare);
	return createCloneFixture(root, bare, "vault", options);
}

async function createSibling(fixture: Fixture, name: string): Promise<Fixture> {
	return createCloneFixture(fixture.root, fixture.bare, name, {
		profile: `${name}-profile`,
	});
}

async function createCloneFixture(
	root: string,
	bare: string,
	name: string,
	options: {
		readonly activate?: boolean;
		readonly blockingCheck?: boolean;
		readonly profile?: string;
		readonly shimMode?: string;
	},
): Promise<Fixture> {
	const clone = join(root, name);
	const stateRoot = join(root, `${name}-state`);
	const profileRoot = join(root, options.profile ?? `${name}-profile`);
	const shimMarker = join(root, `${name}-shim-marker`);
	const shimLog = join(root, `${name}-shim-log`);
	const checkMarker = join(root, `${name}-check-marker`);
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
				'import { existsSync } from "node:fs";',
				'import { writeFile } from "node:fs/promises";',
				"const marker = process.env.VAULT_GIT_CHECK_MARKER;",
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
		VAULT_GIT_SHIM_LOG: shimLog,
		...(options.shimMode ? { VAULT_GIT_SHIM_MODE: options.shimMode } : {}),
		...(options.blockingCheck ? { VAULT_GIT_CHECK_MARKER: checkMarker } : {}),
	};
	const store = createReceiptStore({
		stateRoot,
		repositoryIdentity: "live-acceptance-vault",
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
	return {
		root,
		bare,
		clone,
		stateRoot,
		env,
		shimMarker,
		shimLog,
		run,
		begin,
		owner,
		interruptComplete,
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

const hostileScenarios: readonly {
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

function beginArgs(path: string, runId?: string): string[] {
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

function projectPolicy(result: CliProcessResult): Record<string, unknown> {
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

/** Every git push argv the shim observed, in invocation order. */
async function recordedPushes(fixture: Fixture): Promise<string[][]> {
	const raw = await readFile(fixture.shimLog, "utf8").catch(() => "");
	return raw
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as string[]);
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await Bun.file(path).exists()) return;
		await Bun.sleep(10);
	}
	throw new Error(`timed out waiting for ${path}`);
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
