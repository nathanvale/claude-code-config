import { describe, expect, test } from "bun:test";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";
import { type BrowserUseCommand, browserUseContracts } from "./command-contract";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

// Per-module tests for browser-use-parser.ts (carved from U3 blocks, plan U9).
// The parser is exercised through runForTest (the full CLI), so coverage of
// argv parsing, help, version, and dry-run envelopes attributes here. The U3
// command-contract + barrel-re-export assertions stay in browser-use.test.ts.

describe("U3 help and version", () => {
	// Scenario 1: root help renders both families.
	test("--help renders targets and operate families", async () => {
		const result = await runForTest(["--help"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("warm");
		expect(result.stdout).toContain("targets");
		expect(result.stdout).toContain("operate");
	});

	// Scenario 8: root help points back to the route-bound prerequisites.
	test("--help points back to browser-adapter-router prepare and route", async () => {
		const result = await runForTest(["--help"], makeRuntime());
		expect(result.stdout).toContain("browser-adapter-router prepare");
		expect(result.stdout).toContain("browser-adapter-router route");
		// Does not copy the route evidence schema, only a pointer.
		expect(result.stdout).not.toContain("preconditions");
		expect(result.stdout).not.toContain("adapter_proof_id");
	});

	// Scenario 2: version JSON parses with name and version.
	test("--version --json emits parseable JSON with name and version", async () => {
		const result = await runForTest(["--version", "--json"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(parseJson(result.stdout)).toMatchObject({
			status: "ok",
			data: { name: "browser-use", version: "0.1.0" },
		});
	});

	test("--version plain emits stable text", async () => {
		const result = await runForTest(["--version"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("browser-use 0.1.0\n");
	});

	// Scenario 3: targets family help renders list, select, status.
	test("targets --help renders list, select, and status", async () => {
		const result = await runForTest(["targets", "--help"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("list");
		expect(result.stdout).toContain("select");
		expect(result.stdout).toContain("status");
		expect(result.stdout).toContain("browser-adapter-router");
	});

	test("warm --help renders start without route prerequisite text", async () => {
		const result = await runForTest(["warm", "--help"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("start");
		expect(result.stdout).not.toContain("browser-adapter-router");
	});

	// Scenario 4: operate family help renders snapshot, screenshot, emulate.
	test("operate --help renders snapshot, screenshot, and emulate", async () => {
		const result = await runForTest(["operate", "--help"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("snapshot");
		expect(result.stdout).toContain("screenshot");
		expect(result.stdout).toContain("emulate");
		expect(result.stdout).toContain("browser-adapter-router");
	});

	test("subcommand help advertises every declared flag and the route pointer", async () => {
		const cases: Array<[string[], BrowserUseCommand]> = [
			[["warm", "start", "--help"], "warm-start"],
			[["targets", "list", "--help"], "targets-list"],
			[["targets", "select", "--help"], "targets-select"],
			[["targets", "status", "--help"], "targets-status"],
			[["operate", "snapshot", "--help"], "operate-snapshot"],
			[["operate", "screenshot", "--help"], "operate-screenshot"],
			[["operate", "emulate", "--help"], "operate-emulate"],
		];
		for (const [argv, command] of cases) {
			const result = await runForTest(argv, makeRuntime());
			expect(result.exitCode).toBe(0);
			assertCommandHelpFlagSurface({
				command,
				contract: browserUseContracts[command],
				help: result.stdout,
			});
			if (command === "warm-start") {
				expect(result.stdout).toContain("9222");
				expect(result.stdout).toContain("~/.agent-warm-profile");
				expect(result.stdout).not.toContain("9223");
				expect(result.stdout).not.toContain("browser-adapter-router");
			} else {
				expect(result.stdout).toContain("browser-adapter-router");
			}
		}
	});
});

// =========================================================================
// Parser acceptance / rejection
// =========================================================================

describe("U3 parser", () => {
	test("missing family is a usage error", async () => {
		const result = await runForTest([], makeRuntime());
		expect(result.exitCode).toBe(2);
		expect(`${result.stdout}\n${result.stderr}`).toContain("missing command family");
	});

	test("family without subcommand is a usage error", async () => {
		const targets = await runForTest(["targets", "--json"], makeRuntime());
		expect(targets.exitCode).toBe(2);
		expect(`${targets.stdout}\n${targets.stderr}`).toContain("missing subcommand");

		const operate = await runForTest(["operate", "--json"], makeRuntime());
		expect(operate.exitCode).toBe(2);
		expect(`${operate.stdout}\n${operate.stderr}`).toContain("missing subcommand");
	});

	// Scenario 6: undeclared flags are rejected (exit 2) for every subcommand.
	test("each subcommand rejects an undeclared flag with a usage error", async () => {
		const cases: Array<{ argv: string[]; rejected: string }> = [
			{ argv: ["warm", "start", "--state", "state.json", "--json"], rejected: "--state" },
			{ argv: ["targets", "list", "--bogus", "--dry-run", "--json"], rejected: "--bogus" },
			{ argv: ["targets", "select", "--bogus", "--dry-run", "--json"], rejected: "--bogus" },
			{ argv: ["targets", "status", "--bogus", "--json"], rejected: "--bogus" },
			{ argv: ["operate", "snapshot", "--bogus", "--dry-run", "--json"], rejected: "--bogus" },
			{
				argv: ["operate", "screenshot", "--out", "x.png", "--bogus", "--dry-run", "--json"],
				rejected: "--bogus",
			},
			{ argv: ["operate", "emulate", "--bogus", "--dry-run", "--json"], rejected: "--bogus" },
		];
		for (const { argv, rejected } of cases) {
			const result = await runForTest(argv, makeRuntime());
			expect(result.exitCode).toBe(2);
			expect(`${result.stdout}\n${result.stderr}`).toContain(
				`unknown option: ${rejected}`,
			);
		}
	});

	test("declared flags are accepted without a usage error", async () => {
		const result = await runForTest(
			["targets", "list", "--mode", "route-bound", "--show-url", "--dry-run", "--json"],
			makeRuntime(),
		);
		expect(`${result.stdout}\n${result.stderr}`).not.toContain("unknown option");
		expect(result.exitCode).toBe(0);
	});

	test("warm start accepts declared readiness flags", async () => {
		const cases: string[][] = [
			["warm", "start", "--json"],
			["warm", "start", "--plain"],
			["warm", "start", "--port", "9223", "--json"],
			["warm", "start", "--endpoint", "http://127.0.0.1:9223", "--json"],
			["warm", "start", "--profile", "/tmp/agent-warm-profile", "--json"],
			["warm", "start", "--adapter", "chrome-devtools", "--json"],
			["warm", "start", "--repair-adapter-config", "--json"],
		];
		for (const argv of cases) {
			const result = await runForTest(argv, makeRuntime());
			expect(`${result.stdout}\n${result.stderr}`).not.toContain("unknown option");
			expect(result.exitCode).not.toBe(2);
		}
	});

	// Regression: family/subcommand resolve POSITIONALLY, so a flag value equal
	// to a reserved word must not be misread as the command.
	test("a flag value equal to a subcommand name does not change the resolved command", async () => {
		const result = await runForTest(
			["targets", "select", "--state", "status", "--candidate", "select", "--dry-run", "--json"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(0);
		expect(parseJson(result.stdout).data).toMatchObject({
			command: "targets-select",
			result_kind: "browser_targets",
		});
	});

	// Regression: a flag value equal to the family/subcommand word survives into
	// value pairing rather than being stripped from rest.
	test("a flag value equal to the family word is not stripped", async () => {
		const result = await runForTest(
			["targets", "select", "--origin", "targets", "--dry-run", "--json"],
			makeRuntime(),
		);
		expect(`${result.stdout}\n${result.stderr}`).not.toContain("unknown option");
		expect(result.exitCode).toBe(0);
	});

	// Regression: a value-bearing flag consumes its value even when the value
	// itself starts with "--" (declared type drives the skip, not token shape).
	test("a value beginning with -- is consumed as the flag value", async () => {
		const result = await runForTest(
			["operate", "snapshot", "--title-contains", "--beta", "--dry-run", "--json"],
			makeRuntime(),
		);
		expect(`${result.stdout}\n${result.stderr}`).not.toContain("unknown option");
		expect(result.exitCode).toBe(0);
	});

	// Regression: output mode keys on the resolved command, not an argv token
	// scan, so a "status" flag value does not flip a non-status command to plain.
	test("a flag value of 'status' does not flip output mode to plain", async () => {
		const result = await runForTest(
			["operate", "snapshot", "--url-contains", "status", "--dry-run"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(0);
		// JSON envelope is parseable (default machine-first mode preserved).
		expect(parseJson(result.stdout).status).toBe("ok");
	});

	// targets status defaults to a plain human projection (no --dry-run flag on
	// status). With no state path or state, U6 emits a plain-text failure to
	// stderr; stdout stays empty (not a JSON envelope), preserving the default.
	test("targets status defaults to plain output", async () => {
		const result = await runForTest(["targets", "status"], makeRuntime());
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("browser_use target_selection_state_path_missing");
		// Plain default: stdout is not a JSON envelope.
		expect(result.stdout).toBe("");
	});
});

// =========================================================================
// Dry-run / mock envelopes
// =========================================================================

describe("U3 dry-run envelopes", () => {
	// Scenario 7: dry-run success without live browser calls.
	test("dry-run emits a success envelope for targets and operate", async () => {
		const targets = await runForTest(
			["targets", "list", "--dry-run", "--json"],
			makeRuntime(),
		);
		const targetsJson = parseJson(targets.stdout);
		expect(targets.exitCode).toBe(0);
		expect(targetsJson.status).toBe("ok");
		expect(targetsJson.data).toMatchObject({
			result_kind: "browser_targets",
			mode: "dry_run",
		});

		const operate = await runForTest(
			["operate", "snapshot", "--dry-run", "--json"],
			makeRuntime(),
		);
		const operateJson = parseJson(operate.stdout);
		expect(operate.exitCode).toBe(0);
		expect(operateJson.status).toBe("ok");
		expect(operateJson.data).toMatchObject({
			result_kind: "browser_operation",
			mode: "dry_run",
		});
	});

	// Scenario 7: dry-run failure without live browser calls.
	test("dry-run with mock failure outcome emits an error envelope", async () => {
		const runtime = makeRuntime({ env: { BROWSER_USE_MOCK_OUTCOME: "failure" } });
		const result = await runForTest(
			["operate", "screenshot", "--out", "shot.png", "--dry-run", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.status).toBe("error");
		expect(json.error).toMatchObject({ code: "browser_use_mock_failure" });
	});

	test("without dry-run operate requires live route evidence", async () => {
		const result = await runForTest(
			["operate", "snapshot", "--json"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.status).toBe("error");
		expect(json.error).toMatchObject({ code: "browser_operation_route_invalid" });
	});
});
