import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const scriptPath = resolve(import.meta.dir, "archived-sessions.ts");
const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function createStateDatabase(): string {
	const directory = mkdtempSync(resolve(tmpdir(), "session-picker-test-"));
	temporaryDirectories.push(directory);
	const path = resolve(directory, "state_5.sqlite");
	const database = new Database(path, { create: true });
	database.exec(`
		CREATE TABLE threads (
			id TEXT PRIMARY KEY,
			recency_at_ms INTEGER NOT NULL,
			archived INTEGER NOT NULL,
			source TEXT NOT NULL,
			thread_source TEXT,
			cwd TEXT NOT NULL,
			title TEXT NOT NULL,
			preview TEXT NOT NULL,
			is_pinned INTEGER NOT NULL DEFAULT 0
		)
	`);
	const insert = database.prepare(`
		INSERT INTO threads (
			id, recency_at_ms, archived, source, thread_source,
			cwd, title, preview, is_pinned
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);
	insert.run(
		"archived-newer",
		3000,
		1,
		"vscode",
		"user",
		"/repo/newer",
		`Newer\n archived\t task ${"x".repeat(140)}`,
		`Newer\n safe\t preview ${"y".repeat(520)}`,
		0,
	);
	insert.run(
		"archived-older",
		2000,
		1,
		"vscode",
		"subagent",
		"/repo/older",
		"Older delegated task",
		"Older safe preview",
		1,
	);
	insert.run(
		"archived-cli",
		2500,
		1,
		"cli",
		"user",
		"/repo/cli",
		"Archived CLI task",
		"CLI safe preview",
		0,
	);
	insert.run(
		"internal-worker",
		4000,
		1,
		'{"subagent":{"thread_spawn":{"depth":1}}}',
		"subagent",
		"/repo/internal",
		"Internal worker",
		"Internal instructions",
		0,
	);
	insert.run(
		"active-task",
		5000,
		0,
		"vscode",
		"user",
		"/repo/active",
		"Active task",
		"Active preview",
		0,
	);
	database.close();
	return path;
}

function createLegacyStateDatabase(): string {
	const directory = mkdtempSync(resolve(tmpdir(), "session-picker-legacy-test-"));
	temporaryDirectories.push(directory);
	const path = resolve(directory, "state_5.sqlite");
	const database = new Database(path, { create: true });
	database.exec(`
		CREATE TABLE threads (
			id TEXT PRIMARY KEY,
			updated_at_ms INTEGER NOT NULL,
			archived INTEGER NOT NULL,
			source TEXT NOT NULL,
			thread_source TEXT,
			cwd TEXT NOT NULL,
			title TEXT NOT NULL,
			preview TEXT NOT NULL
		)
	`);
	database
		.prepare(`
			INSERT INTO threads (
				id, updated_at_ms, archived, source, thread_source,
				cwd, title, preview
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`)
		.run(
			"legacy-archived",
			6000,
			1,
			"vscode",
			"user",
			"/repo/legacy",
			"Legacy archived task",
			"Legacy safe preview",
		);
	database.close();
	return path;
}

function createIncompatibleStateDatabase(): string {
	const directory = mkdtempSync(resolve(tmpdir(), "session-picker-incompatible-test-"));
	temporaryDirectories.push(directory);
	const path = resolve(directory, "state_5.sqlite");
	const database = new Database(path, { create: true });
	database.exec("CREATE TABLE threads (id TEXT PRIMARY KEY)");
	database.close();
	return path;
}

function runCommand(arguments_: string[], environment: Record<string, string> = {}) {
	return Bun.spawnSync([process.execPath, "run", scriptPath, ...arguments_], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, ...environment },
	});
}

function expectErrorEnvelope(
	result: ReturnType<typeof runCommand>,
	exitCode: number,
	category: string,
) {
	expect(result.exitCode).toBe(exitCode);
	expect(new TextDecoder().decode(result.stderr)).toBe("");
	const envelope = JSON.parse(new TextDecoder().decode(result.stdout));
	expect(envelope.status).toBe("error");
	expect(envelope.error.category).toBe(category);
	expect(envelope.error.changed_state).toBe("none");
	return envelope;
}

describe("session-picker archived discovery", () => {
	test("renders discoverable read-only help", () => {
		const result = runCommand(["--help"]);
		const help = new TextDecoder().decode(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(help).toContain("archived --json");
		expect(help).toContain("--limit");
		expect(help).toContain("--database");
		expect(help).toContain("Read-only");
	});

	test("lists user-facing archived Codex tasks newest first", () => {
		const databasePath = createStateDatabase();
		const result = runCommand([
			"archived",
			"--database",
			databasePath,
			"--limit",
			"3",
			"--json",
		]);

		expect(result.exitCode).toBe(0);
		expect(new TextDecoder().decode(result.stderr)).toBe("");
		const envelope = JSON.parse(new TextDecoder().decode(result.stdout));
		expect(envelope.status).toBe("ok");
		expect(envelope.action).toBe("archived");
		expect(envelope.side_effects).toBe("none");
		expect(envelope.run_id).toMatch(/^[0-9a-f-]{36}$/);
		expect(envelope.data.source_availability).toBe("ready");
		expect(envelope.data.sessions).toEqual([
			{
				id: "archived-newer",
				updated_at_ms: 3000,
				archived: true,
				source: "codex",
				thread_source: "user",
				cwd: "/repo/newer",
				title: `Newer archived task ${"x".repeat(99)}…`,
				summary: `Newer safe preview ${"y".repeat(480)}…`,
				pinned: false,
			},
			{
				id: "archived-cli",
				updated_at_ms: 2500,
				archived: true,
				source: "codex",
				thread_source: "user",
				cwd: "/repo/cli",
				title: "Archived CLI task",
				summary: "CLI safe preview",
				pinned: false,
			},
			{
				id: "archived-older",
				updated_at_ms: 2000,
				archived: true,
				source: "codex",
				thread_source: "subagent",
				cwd: "/repo/older",
				title: "Older delegated task",
				summary: "Older safe preview",
				pinned: true,
			},
		]);
	});

	test("reports a repairable unavailable source without mutation", () => {
		const result = runCommand([
			"archived",
			"--database",
			"/missing/state_5.sqlite",
			"--json",
		]);

		const envelope = expectErrorEnvelope(result, 3, "source_unavailable");
		expect(envelope.error.retry_safe).toBe(true);
		expect(envelope.error.next_action).toContain("Codex Desktop");
	});

	test("resolves the configured Codex state owner without a path argument", () => {
		const databasePath = createStateDatabase();
		const result = runCommand(["archived", "--limit", "1", "--json"], {
			SESSION_PICKER_CODEX_STATE_DB: databasePath,
		});

		expect(result.exitCode).toBe(0);
		const envelope = JSON.parse(new TextDecoder().decode(result.stdout));
		expect(envelope.data.sessions.map((session: { id: string }) => session.id)).toEqual([
			"archived-newer",
		]);
	});

	test("rejects an invalid result limit with structured repair guidance", () => {
		const result = runCommand(["archived", "--limit", "0", "--json"]);

		const envelope = expectErrorEnvelope(result, 2, "invalid_usage");
		expect(envelope.error.retry_safe).toBe(true);
		expect(envelope.error.next_action).toContain("1 and 200");
	});

	test("rejects unknown flags instead of silently changing the contract", () => {
		const result = runCommand(["archived", "--bogus", "--json"]);
		const envelope = expectErrorEnvelope(result, 2, "invalid_usage");

		expect(envelope.error.next_action).toContain("archived --json");
	});

	test("rejects a missing database flag value as invalid usage", () => {
		const result = runCommand(["archived", "--database", "--json"]);
		const envelope = expectErrorEnvelope(result, 2, "invalid_usage");

		expect(envelope.error.next_action).toContain("archived --json");
	});

	test("reads the legacy Codex thread schema without losing recency", () => {
		const databasePath = createLegacyStateDatabase();
		const result = runCommand([
			"archived",
			"--database",
			databasePath,
			"--json",
		]);

		expect(result.exitCode).toBe(0);
		const envelope = JSON.parse(new TextDecoder().decode(result.stdout));
		expect(envelope.data.sessions).toEqual([
			{
				id: "legacy-archived",
				updated_at_ms: 6000,
				archived: true,
				source: "codex",
				thread_source: "user",
				cwd: "/repo/legacy",
				title: "Legacy archived task",
				summary: "Legacy safe preview",
				pinned: false,
			},
		]);
	});

	test("reports an incompatible source schema without exposing a stack trace", () => {
		const databasePath = createIncompatibleStateDatabase();
		const result = runCommand([
			"archived",
			"--database",
			databasePath,
			"--json",
		]);

		const envelope = expectErrorEnvelope(result, 4, "source_incompatible");
		expect(envelope.error.retry_safe).toBe(false);
		expect(envelope.error.next_action).toContain("Codex Desktop");
	});
});
