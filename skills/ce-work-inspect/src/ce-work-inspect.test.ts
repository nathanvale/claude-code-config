import { describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("./ce-work-inspect.ts", import.meta.url));

function runCli(args: readonly string[], env: Record<string, string> = {}) {
	return Bun.spawnSync({
		cmd: [process.execPath, "run", CLI_PATH, ...args],
		env: { ...process.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
}

function makeStatusFixture(mode: "active" | "completed" = "active") {
	const fixtureRoot = mkdtempSync(join(tmpdir(), "ce-work-inspect-"));
	const runsRoot = join(fixtureRoot, "ce-work");
	const runId = "run-42";
	const runRoot = join(runsRoot, runId);
	mkdirSync(join(runsRoot, ".locks"), { recursive: true, mode: 0o700 });
	mkdirSync(runRoot, { mode: 0o700 });
	chmodSync(runsRoot, 0o700);
	chmodSync(join(runsRoot, ".locks"), 0o700);
	chmodSync(runRoot, 0o700);
	for (const name of ["manifest.lock", "manifest.json"]) {
		const statePath = join(runRoot, name);
		writeFileSync(statePath, "{}\n", { mode: 0o600 });
		chmodSync(statePath, 0o600);
	}

	const body = {
		run_id: runId,
		revision: 7,
		source: { kind: "plan", digest: "a".repeat(64) },
		units: {
			U1: {
				unit_id: "U1",
				state: "authoring" as string,
				wave: {
					id: "wave-1",
					base: "b".repeat(40),
					position: 0,
					allowed_heads: ["b".repeat(40)],
				},
				workspace: {
					path: join(runRoot, "units", "U1", "workspace"),
					base: "b".repeat(40),
					registered: true,
				},
				attempts: [
					{
						attempt_id: "attempt-1",
						process_state: "running" as string,
						activity: {
							posture: "incremental",
							latest_at: "2026-07-29T12:00:00Z",
						},
					},
				],
				integration: {
					verification: null as Record<string, unknown> | null,
					canonical_commit: null as { commit: string } | null,
				},
			},
			U2: {
				unit_id: "U2",
				state: "integration-pending" as string,
				wave: {
					id: "wave-1",
					base: "b".repeat(40),
					position: 1,
					allowed_heads: ["b".repeat(40)],
				},
				workspace: {
					path: join(runRoot, "units", "U2", "workspace"),
					base: "b".repeat(40),
					registered: true,
				},
				attempts: [
					{
						attempt_id: "attempt-1",
						process_state: "done" as string,
						activity: {
							posture: "hard-only",
							latest_at: "2026-07-29T12:01:00Z",
						},
					},
				],
				integration: {
					verification: null as Record<string, unknown> | null,
					canonical_commit: null as { commit: string } | null,
				},
			},
		},
		integration_lock: null,
		verifications: [] as Array<Record<string, unknown>>,
		blockers: [],
		recovery_path: runRoot,
	};
	if (mode === "completed") {
		const firstCommit = "c".repeat(40);
		const secondCommit = "d".repeat(40);
		body.units.U1.state = "cleaned";
		body.units.U1.attempts[0].process_state = "done";
		body.units.U1.integration.verification = {
			at: "2026-07-29T12:02:00Z",
			digest: "tests-green",
		};
		body.units.U1.integration.canonical_commit = { commit: firstCommit };
		body.units.U2.state = "cleaned";
		body.units.U2.integration.verification = {
			at: "2026-07-29T12:03:00Z",
			digest: "tests-green",
		};
		body.units.U2.integration.canonical_commit = { commit: secondCommit };
		body.verifications.push({
			verification_exit: 0,
			accepted_units: { U2: secondCommit, U1: firstCommit },
			canonical_head: secondCommit,
		});
	}
	const controllerPath = join(fixtureRoot, "unit-workspace.py");
	writeFileSync(
		controllerPath,
		[
			"#!/usr/bin/env python3",
			'import json',
			'print("STATUS")',
			`print(${JSON.stringify(JSON.stringify(body))})`,
			"",
		].join("\n"),
		{ mode: 0o700 },
	);
	chmodSync(controllerPath, 0o700);
	return { controllerPath, runId, runsRoot };
}

describe("ce-work-inspect CLI", () => {
	test("shows discoverable read-only help with no arguments", () => {
		const result = runCli([]);
		const stdout = result.stdout.toString();

		expect(result.exitCode).toBe(0);
		expect(stdout).toContain("Inspect one CE Work run without changing it.");
		expect(stdout).toContain("--run-id <id>");
		expect(stdout).toContain("--json");
		expect(stdout).toContain("Side effects: read-only");
		expect(result.stderr.toString()).toBe("");
	});

	test("summarizes a CE Work wave as stable JSON", () => {
		const fixture = makeStatusFixture();
		const result = runCli(
			[
				"--run-id",
				fixture.runId,
				"--controller",
				fixture.controllerPath,
				"--json",
			],
			{ CE_WORK_RUNS_ROOT: fixture.runsRoot },
		);
		const output = JSON.parse(result.stdout.toString());

		expect(result.exitCode).toBe(0);
		expect(output).toMatchObject({
			contract_id: "ce-work-inspect.result",
			schema_version: "1",
			status: "ok",
			read_only: true,
			run: {
				run_id: fixture.runId,
				revision: 7,
				source_kind: "plan",
			},
			waves: [
				{
					wave_id: "wave-1",
					unit_ids: ["U1", "U2"],
				},
			],
			units: [
				{
					unit_id: "U1",
					state: "authoring",
					process_state: "running",
					ownership: "ce-work-controller",
					verification: "pending",
					next_action: "wait_and_refresh",
				},
				{
					unit_id: "U2",
					state: "integration-pending",
					process_state: "done",
					ownership: "ce-work-controller",
					verification: "pending",
					next_action: "return_to_ce_work",
				},
			],
			verification: { run: "pending" },
			next_action: {
				id: "wait_and_refresh",
			},
		});
		expect(output.inspection_id).toMatch(
			/^ce-work-inspect-[0-9a-f-]{36}$/,
		);
		expect(result.stderr.toString()).toBe("");
	});

	test("reports missing CE state without creating a run root", () => {
		const fixtureRoot = mkdtempSync(join(tmpdir(), "ce-work-inspect-empty-"));
		const runsRoot = join(fixtureRoot, "missing-ce-work");
		const controllerPath = join(fixtureRoot, "unit-workspace.py");
		writeFileSync(controllerPath, "#!/usr/bin/env python3\n", { mode: 0o700 });
		chmodSync(controllerPath, 0o700);

		const result = runCli(
			[
				"--run-id",
				"missing-run",
				"--controller",
				controllerPath,
				"--json",
			],
			{ CE_WORK_RUNS_ROOT: runsRoot },
		);
		const output = JSON.parse(result.stdout.toString());

		expect(result.exitCode).toBe(3);
		expect(output).toMatchObject({
			contract_id: "ce-work-inspect.result",
			schema_version: "1",
			status: "no_run",
			read_only: true,
			error: {
				code: "no_run",
				retry_safe: true,
			},
			next_action: {
				id: "start_or_supply_ce_run",
			},
		});
		expect(existsSync(runsRoot)).toBe(false);
		expect(result.stderr.toString()).toBe("");
	});

	test("renders compact human wave and worktree ownership", () => {
		const fixture = makeStatusFixture();
		const result = runCli(
			[
				"--run-id",
				fixture.runId,
				"--controller",
				fixture.controllerPath,
			],
			{ CE_WORK_RUNS_ROOT: fixture.runsRoot },
		);
		const stdout = result.stdout.toString();

		expect(result.exitCode).toBe(0);
		expect(stdout).toContain("CE Work run run-42 (revision 7)");
		expect(stdout).toContain("Wave wave-1: U1, U2");
		expect(stdout).toContain("U1: authoring; worker running");
		expect(stdout).toContain("owner ce-work-controller; worktree ");
		expect(stdout).toContain("Run verification: pending");
		expect(stdout).toContain("Next: wait_and_refresh");
		expect(result.stderr.toString()).toBe("");
	});

	test("classifies a missing CE Work controller", () => {
		const fixture = makeStatusFixture();
		const missingController = join(
			fixture.runsRoot,
			"missing-unit-workspace.py",
		);
		const result = runCli(
			[
				"--run-id",
				fixture.runId,
				"--controller",
				missingController,
				"--json",
			],
			{ CE_WORK_RUNS_ROOT: fixture.runsRoot },
		);
		const output = JSON.parse(result.stdout.toString());

		expect(result.exitCode).toBe(3);
		expect(output).toMatchObject({
			status: "blocked",
			error: {
				code: "controller_not_found",
				retry_safe: true,
			},
			next_action: {
				id: "update_ce_work",
			},
		});
		expect(result.stderr.toString()).toBe("");
	});

	test("reports current plan-wide verification as complete", () => {
		const fixture = makeStatusFixture("completed");
		const result = runCli(
			[
				"--run-id",
				fixture.runId,
				"--controller",
				fixture.controllerPath,
				"--json",
			],
			{ CE_WORK_RUNS_ROOT: fixture.runsRoot },
		);
		const output = JSON.parse(result.stdout.toString());

		expect(result.exitCode).toBe(0);
		expect(output.verification).toEqual({ run: "passed" });
		expect(output.units).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ unit_id: "U1", verification: "passed" }),
				expect.objectContaining({ unit_id: "U2", verification: "passed" }),
			]),
		);
		expect(output.next_action).toEqual({ id: "run_complete" });
	});

	test("accepts the documented unit filter", () => {
		const fixture = makeStatusFixture();
		const result = runCli(
			[
				"--run-id",
				fixture.runId,
				"--unit-id",
				"U2",
				"--controller",
				fixture.controllerPath,
				"--json",
			],
			{ CE_WORK_RUNS_ROOT: fixture.runsRoot },
		);
		const output = JSON.parse(result.stdout.toString());

		expect(result.exitCode).toBe(0);
		expect(output.units).toEqual([
			expect.objectContaining({ unit_id: "U2" }),
		]);
		expect(output.waves).toEqual([
			expect.objectContaining({ wave_id: "wave-1", unit_ids: ["U2"] }),
		]);
	});

	test("rejects undocumented mutation-like arguments", () => {
		const result = runCli([
			"--run-id",
			"run-42",
			"--controller",
			"/tmp/unit-workspace.py",
			"--resume",
			"--json",
		]);
		const output = JSON.parse(result.stdout.toString());

		expect(result.exitCode).toBe(2);
		expect(output).toMatchObject({
			status: "blocked",
			error: {
				code: "usage_error",
				retry_safe: true,
			},
			next_action: {
				id: "fix_arguments",
			},
		});
	});

	test("classifies partial private state as unreadable", () => {
		const fixtureRoot = mkdtempSync(join(tmpdir(), "ce-work-inspect-partial-"));
		const runsRoot = join(fixtureRoot, "ce-work");
		mkdirSync(runsRoot, { mode: 0o700 });
		chmodSync(runsRoot, 0o700);
		const controllerPath = join(fixtureRoot, "unit-workspace.py");
		writeFileSync(controllerPath, "#!/usr/bin/env python3\n", { mode: 0o700 });
		chmodSync(controllerPath, 0o700);

		const result = runCli(
			[
				"--run-id",
				"partial-run",
				"--controller",
				controllerPath,
				"--json",
			],
			{ CE_WORK_RUNS_ROOT: runsRoot },
		);
		const output = JSON.parse(result.stdout.toString());

		expect(result.exitCode).toBe(4);
		expect(output).toMatchObject({
			status: "blocked",
			error: {
				code: "state_unreadable",
				retry_safe: true,
			},
			next_action: {
				id: "return_to_ce_work_recovery",
			},
		});
		expect(existsSync(join(runsRoot, ".locks"))).toBe(false);
	});
});
