import { spawnSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "bun:test";
import type {
	BranchStation,
	BranchStationEvidence,
} from "@side-quest/cli-command-facade";
import {
	assertStationEnvelope,
	buildStationEvidence,
	parseCliProcessJson,
	runCliProcess,
	type CliProcessResult,
	type StationRuntimeEnvelope,
	type StationScenario,
} from "@side-quest/cli-command-facade/testing";

import {
	projectVaultGitStationMap,
	vaultGitBranchStationCatalog,
} from "../src/branch-station-catalog.ts";
import type { VAULT_GIT_STATION_IDS } from "../src/branch-station-catalog.ts";
import { createReceiptStore, launchCapabilityProcess } from "../src/store.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "src", "cli.ts");
const roots: string[] = [];
let sharedFixture: Promise<Fixture> | undefined;

type Station = (typeof vaultGitBranchStationCatalog)[number];
type StationId = (typeof VAULT_GIT_STATION_IDS)[number];

afterEach(async () => {
	sharedFixture = undefined;
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

const scenarios = {
	"status.dashboard": scenario(async (fixture) => fixture.run(["--json"])),
	"status.read_only": scenario(async (fixture) =>
		fixture.run(["status", "--json"]),
	),
	"status.invalid_usage": scenario(async (fixture) =>
		fixture.run(["unknown-command", "--json"]),
	),
	"preview.read_only": scenario(async (fixture) =>
		fixture.run(["preview", "--json"]),
	),
	"doctor.read_only": scenario(async (fixture) =>
		fixture.run(["doctor", "--json"]),
	),
	"commands.discovery": scenario(async (fixture) =>
		fixture.run(["commands", "--json"]),
	),
	"begin.admitted": scenario(
		async (fixture) => fixture.begin("notes/a.md"),
		{ fresh: true },
	),
	"join.joined": scenario(async (fixture) => {
		const transactionId = await fixture.beginTransaction("notes/a.md");
		return fixture.run([
			"join",
			"--transaction-id",
			transactionId,
			"--path",
			"notes/joined.md",
			"--json",
		]);
	}, { fresh: true }),
	"complete.completed": scenario(async (fixture) => {
		const transactionId = await fixture.beginTransaction("notes/a.md");
		await writeFile(join(fixture.clone, "notes", "a.md"), "completed\n");
		return fixture.run([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): complete note",
			"--json",
		]);
	}, { fresh: true }),
	"complete.join_role_refused": scenario(async (fixture) => {
		const transactionId = await fixture.beginTransaction("notes/a.md");
		const remoteMainBefore = fixture.gitBare(["rev-parse", "refs/heads/main"]);
		const result = await fixture.launchWithRole("join", [
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): forbidden close",
			"--json",
		]);
		expect(fixture.gitBare(["rev-parse", "refs/heads/main"])).toBe(
			remoteMainBefore,
		);
		await fixture.assertCapabilityAbsent(result);
		return result;
	}, { fresh: true }),
	"repair.action_required": scenario(async (fixture) =>
		fixture.run(["repair", "--json"]),
	),
	"repair.join_role_refused": scenario(
		async (fixture) => {
			const transactionId = await fixture.beginTransaction("notes/a.md");
			await writeFile(join(fixture.clone, "notes", "a.md"), "check fails\n");
			const completion = await fixture.run([
				"complete",
				"--transaction-id",
				transactionId,
				"--summary",
				"docs(vault): repair note",
				"--json",
			]);
			expect(completion.exitCode).toBe(1);
			const result = await fixture.launchWithRole("join", [
				"repair",
				"resume",
				"--transaction-id",
				transactionId,
				"--json",
			]);
			await fixture.assertCapabilityAbsent(result);
			return result;
		},
		{ checkPasses: false, fresh: true },
	),
	"repair.stale_takeover_usage": scenario(async (fixture) =>
		fixture.run([
			"repair",
			"stale-lease-takeover",
			"--transaction-id",
			"txn_00000000000000000000000000000000",
			"--json",
		]),
	),
	"tidy.invalid_usage": scenario(async (fixture) =>
		fixture.run(["tidy", "--json"]),
	),
	"tidy.unavailable": scenario(async (fixture) =>
		fixture.run(["tidy", "now", "--json"]),
	),
	"janitor.unavailable": scenario(async (fixture) =>
		fixture.run(["janitor", "--json"]),
	),
} as const satisfies Record<StationId, StationScenario<Station>>;

describe("vault-git catalog-driven process boundary", () => {
	test("keeps the scenario map exhaustive with the live catalog", () => {
		expect(Object.keys(scenarios)).toEqual(
			vaultGitBranchStationCatalog.map((station) => station.id),
		);
	});

	test(
		"covers every declared station through a real Bun process",
		async () => {
			const evidence: BranchStationEvidence[] = [];
			for (const station of vaultGitBranchStationCatalog) {
				evidence.push(await scenarios[station.id as StationId].run(station));
			}
			expect(projectVaultGitStationMap(evidence).findings).toEqual([]);
		},
		120_000,
	);

	test("emits identical JSON policy for shell, Claude Code, and Codex labels", async () => {
		const fixture = await createFixture();
		const outputs = await Promise.all(
			["shell", "claude-code", "codex"].map((caller) =>
				fixture.run(["status", "--json", "--run-id", `caller-${caller}`]),
			),
		);
		const projected = outputs.map((result) => {
			const envelope = parseCliProcessJson<Record<string, unknown>>(result);
			const { run_id: _runId, duration_ms: _duration, ...policy } = envelope;
			return policy;
		});
		expect(projected[1]).toEqual(projected[0]);
		expect(projected[2]).toEqual(projected[0]);
	});

	test("keeps foreign flags and malformed transaction ids at stable usage exits", async () => {
		const fixture = await createFixture();
		for (const args of [
			["status", "--force", "--json"],
			[
				"join",
				"--transaction-id",
				"not-a-transaction",
				"--path",
				"notes/a.md",
				"--json",
			],
		]) {
			const result = await fixture.run(args);
			expect(result.exitCode).toBe(2);
			expect(result.stderr).toBe("");
			expect(parseCliProcessJson(result)).toMatchObject({
				status: "error",
				error: { code: "invalid_usage" },
				continuation: { next_action_id: "change_input" },
			});
		}
	});

	test("refuses missing private state without an unexpected failure", async () => {
		const fixture = await createFixture();
		const result = await fixture.run([
			"complete",
			"--transaction-id",
			"txn_00000000000000000000000000000001",
			"--summary",
			"docs(vault): unavailable transaction",
			"--json",
		]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("");
		expect(parseCliProcessJson(result)).toMatchObject({
			status: "error",
			error: { code: "receipt_conflict" },
			data: { outcome: "refused", changed_state: "none" },
		});
	});
});

function scenario(
	run: (fixture: Fixture) => Promise<CliProcessResult>,
	options: {
		readonly checkPasses?: boolean;
		readonly fresh?: boolean;
	} = {},
): StationScenario<Station> {
	return {
		async run(station) {
			let fixturePromise: Promise<Fixture>;
			if (options.fresh) {
				fixturePromise = createFixture(options);
			} else {
				if (!sharedFixture) sharedFixture = createFixture();
				fixturePromise = sharedFixture;
			}
			const fixture = await fixturePromise;
			const result = await run(fixture);
			const envelope = assertStationEnvelope(station, result);
			assertProcessChannels(station, result, envelope);
			if (station.expectedActionId) {
				expect(
					(envelope as {
						continuation?: { next_action_id?: string };
					}).continuation?.next_action_id,
				).toBe(station.expectedActionId);
			}
			return buildStationEvidence(station, result, envelope);
		},
	};
}

function assertProcessChannels(
	station: BranchStation,
	result: CliProcessResult,
	envelope: StationRuntimeEnvelope,
): void {
	expect(result.timedOut).toBe(false);
	expect(result.stderr).toBe("");
	expect(envelope.status).toBe(station.expectedEnvelopeStatus);
	expect(result.stdout.trim().startsWith("{")).toBe(true);
	expect(result.stdout).not.toMatch(/\/private\/|\/Users\//);
}

interface Fixture {
	readonly root: string;
	readonly clone: string;
	readonly stateRoot: string;
	readonly env: NodeJS.ProcessEnv;
	run(args: readonly string[]): Promise<CliProcessResult>;
	begin(path: string): Promise<CliProcessResult>;
	beginTransaction(path: string): Promise<string>;
	launchWithRole(
		role: "owner" | "join",
		args: readonly string[],
	): Promise<CliProcessResult>;
	gitBare(args: readonly string[]): string;
	assertCapabilityAbsent(result: CliProcessResult): Promise<void>;
}

async function createFixture(
	options: { readonly checkPasses?: boolean } = {},
): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), "vault-git-cli-process-"));
	roots.push(root);
	const bare = join(root, "remote.git");
	const clone = join(root, "vault");
	const stateRoot = join(root, "state");
	git(root, ["init", "--bare", bare]);
	git(root, ["clone", bare, clone]);
	git(clone, ["switch", "-c", "main"]);
	git(clone, ["config", "user.name", "Vault CLI Test"]);
	git(clone, ["config", "user.email", "vault-cli@example.invalid"]);
	await mkdir(join(clone, "notes"), { recursive: true });
	await writeFile(join(clone, "notes", "a.md"), "baseline\n");
	await writeFile(
		join(clone, "package.json"),
		`${JSON.stringify(
			{
				private: true,
				scripts: {
					check: `bun -e 'process.exit(${options.checkPasses === false ? 1 : 0})'`,
				},
			},
			null,
			2,
		)}\n`,
	);
	git(clone, ["add", "package.json", "notes/a.md"]);
	git(clone, ["commit", "-m", "chore: initialize vault fixture"]);
	git(clone, ["push", "-u", "origin", "main"]);
	git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);
	const env: NodeJS.ProcessEnv = {
		...process.env,
		VAULT_GIT_REPOSITORY_PATH: clone,
		VAULT_GIT_CHECK_REPOSITORY_PATH: clone,
		VAULT_GIT_STATE_ROOT: stateRoot,
		VAULT_GIT_REPOSITORY_IDENTITY: "fixture-vault",
		VAULT_GIT_ACTOR: "agent-a",
		VAULT_GIT_HOST: "host-a",
		VAULT_GIT_REMOTE: "origin",
	};
	const run = (args: readonly string[]) =>
		runCliProcess({
			label: `vault-git ${args.join(" ")}`,
			argv: ["bun", "run", cliPath, ...args],
			cwd: packageRoot,
			env,
			timeoutMs: 30_000,
		});
	const begin = (path: string) =>
		run([
			"begin",
			"--event",
			"note_created",
			"--path",
			path,
			"--json",
		]);
	const beginTransaction = async (path: string): Promise<string> => {
		const result = await begin(path);
		expect(result.exitCode).toBe(0);
		const envelope = parseCliProcessJson<{
			data?: { transaction_id?: string };
		}>(result);
		const transactionId = envelope.data?.transaction_id;
		if (!transactionId) throw new Error("begin omitted transaction_id");
		return transactionId;
	};
	const store = createReceiptStore({
		stateRoot,
		repositoryIdentity: "fixture-vault",
	});
	const launchWithRole = async (
		role: "owner" | "join",
		args: readonly string[],
	): Promise<CliProcessResult> => {
		const loaded = await store.load();
		if (loaded.status !== "loaded") throw new Error("receipt unavailable");
		const requestArgs = [cliPath, "--run-id", `role-${role}`, ...args];
		const capability = await store.readCapability(loaded.receipt.receiptId, role);
		const encodedCapability = Buffer.from(capability).toString("base64");
		expect(JSON.stringify(requestArgs)).not.toContain(encodedCapability);
		const launched = await launchCapabilityProcess(store, {
			receiptId: loaded.receipt.receiptId,
			role,
			command: process.execPath,
			args: requestArgs,
			cwd: clone,
			timeoutMs: 30_000,
			env,
		});
		return {
			label: `vault-git role=${role} ${args.join(" ")}`,
			argv: [process.execPath, ...requestArgs, "--capability-fd", "3"],
			cwd: clone,
			exitCode: launched.exitCode,
			stdout: launched.stdout,
			stderr: launched.stderr,
			timedOut: launched.timedOut,
			signal: null,
			timeoutMs: 30_000,
		};
	};
	const gitBare = (args: readonly string[]) => git(bare, args);
	const assertCapabilityAbsent = async (
		result: CliProcessResult,
	): Promise<void> => {
		const loaded = await store.load();
		if (loaded.status !== "loaded") throw new Error("receipt unavailable");
		const secret = await store.readCapability(
			loaded.receipt.receiptId,
			"join",
		);
		const encodedSecrets = [
			Buffer.from(secret).toString("base64"),
			Buffer.from(secret).toString("hex"),
		];
		const receiptMaterial = JSON.stringify({
			receipt: loaded.receipt,
			history: loaded.history,
		});
		const ledgerMaterial = gitBare([
			"show",
			"refs/heads/vault-system/transaction-ledger:ledger.json",
		]);
		for (const encoded of encodedSecrets) {
			expect(JSON.stringify(result.argv)).not.toContain(encoded);
			expect(JSON.stringify(env)).not.toContain(encoded);
			expect(result.stdout).not.toContain(encoded);
			expect(result.stderr).not.toContain(encoded);
			expect(receiptMaterial).not.toContain(encoded);
			expect(ledgerMaterial).not.toContain(encoded);
		}
	};
	return {
		root,
		clone,
		stateRoot,
		env,
		run,
		begin,
		beginTransaction,
		launchWithRole,
		gitBare,
		assertCapabilityAbsent,
	};
}

function git(cwd: string, args: readonly string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
	});
	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
		);
	}
	return result.stdout.trim();
}
