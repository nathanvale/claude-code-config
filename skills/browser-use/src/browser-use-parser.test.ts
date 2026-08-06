import { describe, expect, test } from "bun:test";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";
import { type BrowserUseCommand, browserUseContracts } from "./command-contract";
import { runForTest } from "./browser-use";
import { parseBrowserUseArgv } from "./browser-use-parser";
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
		expect(result.stdout).toContain("targets");
		expect(result.stdout).toContain("operate");
	});

	// Scenario 8 (rewritten for the single front door, design brief D2): root
	// help is agent-first and never teaches a secondary CLI. The envelope
	// prerequisite pointer moved to the advanced leaf/family help of the
	// commands that consume --handoff (asserted in the platform contract tests).
	test("--help is the single agent-first front door", async () => {
		const result = await runForTest(["--help"], makeRuntime());
		expect(result.stdout).toContain("Start here (for AI agents)");
		expect(result.stdout).toContain("browser-use guide");
		expect(result.stdout).not.toContain("browser-connect");
		// Does not copy the envelope schema, only pointers.
		expect(result.stdout).not.toContain("browser_entry_mode");
		expect(result.stdout).not.toContain("probe_executable");
		// R4: no dangling references to the deleted Router chain.
		expect(result.stdout).not.toContain("browser-adapter-router");
		expect(result.stdout).not.toContain("preflight-browser-adapter");
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
		expect(result.stdout).toContain("browser-connect");
	});

	// Scenario 4: operate family help renders snapshot, screenshot, emulate.
	test("operate --help renders snapshot, screenshot, and emulate", async () => {
		const result = await runForTest(["operate", "--help"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("snapshot");
		expect(result.stdout).toContain("screenshot");
		expect(result.stdout).toContain("emulate");
		expect(result.stdout).toContain("browser-connect");
	});

	test("subcommand help advertises every declared flag and the handoff pointer", async () => {
		const cases: Array<[string[], BrowserUseCommand]> = [
			[["targets", "list", "--help"], "targets-list"],
			[["targets", "select", "--help"], "targets-select"],
			[["targets", "status", "--help"], "targets-status"],
			[["operate", "snapshot", "--help"], "operate-snapshot"],
			[["operate", "screenshot", "--help"], "operate-screenshot"],
			[["operate", "emulate", "--help"], "operate-emulate"],
			[["runbook", "schema", "--help"], "runbook-schema"],
			[["runbook", "validate", "--help"], "runbook-validate"],
			[["runbook", "apply", "--help"], "runbook-apply"],
			[["runbook", "delete", "--help"], "runbook-delete"],
			[["runbook", "list", "--help"], "runbook-list"],
			[["runbook", "show", "--help"], "runbook-show"],
			[["runbook", "activate", "--help"], "runbook-activate"],
			[["runbook", "run", "--help"], "runbook-run"],
			[["action", "schema", "--help"], "action-schema"],
			[["action", "validate", "--help"], "action-validate"],
			[["action", "apply", "--help"], "action-apply"],
			[["action", "status", "--help"], "action-status"],
		];
		for (const [argv, command] of cases) {
			const result = await runForTest(argv, makeRuntime());
			expect(result.exitCode).toBe(0);
			assertCommandHelpFlagSurface({
				command,
				contract: browserUseContracts[command],
				help: result.stdout,
			});
			// The mint-an-envelope prerequisite is contract-driven: rendered only
			// for commands that accept --handoff (targets status reads selected
			// state and carries no connection prerequisite).
			if (!("--handoff" in (browserUseContracts[command].flags ?? {}))) {
				expect(result.stdout).not.toContain("Prerequisite:");
			} else if (command === "targets-list" || command === "runbook-run") {
				expect(result.stdout).toContain("attaches automatically");
				expect(result.stdout).not.toContain("browser-connect connect");
			} else {
				expect(result.stdout).toContain("browser-connect");
			}
		}
	});
});

// =========================================================================
// Parser acceptance / rejection
// =========================================================================

describe("U3 parser", () => {
	test("freeform auth login requires bounded authority inputs", () => {
		expect(
			parseBrowserUseArgv([
				"auth", "login", "--handoff", "handoff.json",
				"--service", "github", "--allowed-origin", "https://github.com",
				"--caller", "release-agent", "--json",
			]),
		).toMatchObject({ kind: "command", command: "auth-login" });

		const cases: Array<{ argv: string[]; message: string }> = [
			{
				argv: ["auth", "login", "--service", "github", "--allowed-origin", "https://github.com"],
				message: "auth login requires --handoff",
			},
			{
				argv: ["auth", "login", "--handoff", "handoff.json", "--allowed-origin", "https://github.com"],
				message: "auth login requires --service",
			},
			{
				argv: ["auth", "login", "--handoff", "handoff.json", "--service", "github"],
				message: "auth login requires --allowed-origin",
			},
		];
		for (const { argv, message } of cases) {
			expect(() => parseBrowserUseArgv(argv)).toThrow(message);
		}
	});

	test("every runbook and action leaf accepts its complete advertised flag surface", () => {
		const digest = "a".repeat(64);
		const cases: Array<{ argv: string[]; command: BrowserUseCommand }> = [
			{
				argv: ["runbook", "schema", "--caller", "test", "--json", "--plain"],
				command: "runbook-schema",
			},
			{
				argv: [
					"runbook", "validate", "--file", "draft.json",
					"--caller", "test", "--json", "--plain",
				],
				command: "runbook-validate",
			},
			{
				argv: [
					"runbook", "apply", "--file", "draft.json",
					"--expected-record-digest", digest,
					"--caller", "test", "--json", "--plain",
				],
				command: "runbook-apply",
			},
			{
				argv: [
					"runbook", "delete", "--service", "service", "--flow", "flow",
					"--expected-record-digest", digest,
					"--caller", "test", "--json", "--plain",
				],
				command: "runbook-delete",
			},
			{
				argv: ["runbook", "list", "--caller", "test", "--json", "--plain"],
				command: "runbook-list",
			},
			{
				argv: [
					"runbook", "show", "--service", "service", "--flow", "flow",
					"--caller", "test", "--json", "--plain",
				],
				command: "runbook-show",
			},
			{
				argv: [
					"runbook", "activate", "--catalog-digest", digest,
					"--expected-epoch", "0", "--caller", "test", "--json", "--plain",
				],
				command: "runbook-activate",
			},
			{
				argv: [
					"runbook", "run", "--service", "service", "--flow", "flow",
					"--input", "name=value", "--input-file", "private=/private/input.json",
					"--handoff", "handoff.json", "--tab", "tab-1",
					"--allowed-origin", "https://example.test", "--run", "run-1",
					"--caller", "test", "--json", "--plain",
				],
				command: "runbook-run",
			},
			{
				argv: ["action", "schema", "--caller", "test", "--json", "--plain"],
				command: "action-schema",
			},
			{
				argv: [
					"action", "validate", "--file", "candidate.json",
					"--caller", "test", "--json", "--plain",
				],
				command: "action-validate",
			},
			{
				argv: [
					"action", "apply", "--file", "candidate.json",
					"--expected-record-digest", digest,
					"--caller", "test", "--json", "--plain",
				],
				command: "action-apply",
			},
			{
				argv: [
					"action", "status", "--id", "action-id",
					"--caller", "test", "--json", "--plain",
				],
				command: "action-status",
			},
			{
				argv: [
					"action", "promote", "--id", "action-id",
					"--approval-reference", "review-1",
					"--caller", "test", "--json", "--plain",
				],
				command: "action-promote",
			},
		];

		for (const { argv, command } of cases) {
			expect(parseBrowserUseArgv(argv)).toMatchObject({
				kind: "command",
				command,
			});
		}
	});

	test("runbook and action leaves reject every missing required input", () => {
		const digest = "a".repeat(64);
		const cases: Array<{ argv: string[]; message: string }> = [
			{
				argv: ["runbook", "validate", "--json"],
				message: "runbook validate requires --file",
			},
			{
				argv: ["runbook", "apply", "--json"],
				message: "runbook apply requires --file",
			},
			{
				argv: ["runbook", "delete", "--service", "service", "--json"],
				message: "runbook delete requires --flow",
			},
			{
				argv: ["runbook", "show", "--service", "service", "--json"],
				message: "runbook show requires --flow",
			},
			{
				argv: ["runbook", "activate", "--catalog-digest", digest, "--json"],
				message: "runbook activate requires --expected-epoch",
			},
			{
				argv: ["runbook", "run", "--service", "service", "--json"],
				message: "runbook run requires --flow",
			},
			{
				argv: ["action", "validate", "--json"],
				message: "action validate requires --file",
			},
			{
				argv: ["action", "apply", "--json"],
				message: "action apply requires --file",
			},
			{
				argv: ["action", "status", "--json"],
				message: "action status requires --id",
			},
			{
				argv: ["action", "promote", "--json"],
				message: "action promote requires --id",
			},
			{
				argv: ["action", "promote", "--id", "action-id", "--json"],
				message: "action promote requires --approval-reference",
			},
		];

		for (const { argv, message } of cases) {
			expect(() => parseBrowserUseArgv(argv)).toThrow(message);
		}
	});

	test("Reviewed Action promotion is parser-accessible only as its own leaf", () => {
		expect(
			parseBrowserUseArgv([
				"action", "promote", "--id", "action-id",
				"--approval-reference", "review-1", "--json",
			]),
		).toMatchObject({ kind: "command", command: "action-promote" });
		expect(() =>
			parseBrowserUseArgv([
				"action", "apply", "--file", "candidate.json", "--promote", "--json",
			]),
		).toThrow("unknown option: --promote");
	});

	test("action commands require their model-owned file and identity inputs", () => {
		expect(parseBrowserUseArgv(["action", "schema", "--json"])).toMatchObject({ kind: "command", command: "action-schema" });
		expect(parseBrowserUseArgv(["action", "apply", "--file", "candidate.json", "--expected-record-digest", "a".repeat(64), "--json"])).toMatchObject({ kind: "command", command: "action-apply" });
		expect(parseBrowserUseArgv(["action", "promote", "--id", "candidate", "--approval-reference", "review-1", "--json"])).toMatchObject({ kind: "command", command: "action-promote" });
		expect(() => parseBrowserUseArgv(["action", "validate", "--json"])).toThrow("action validate requires --file");
		expect(() => parseBrowserUseArgv(["action", "status", "--json"])).toThrow("action status requires --id");
		expect(() => parseBrowserUseArgv(["action", "promote", "--id", "candidate", "--json"])).toThrow("action promote requires --approval-reference");
		expect(() => parseBrowserUseArgv(["action", "apply", "--file", "candidate.json", "--expected-record-digest", "stale"])).toThrow("--expected-record-digest must be 64 lowercase hex");
	});

	test("runbook run accepts repeated private input files", () => {
		const parsed = parseBrowserUseArgv([
			"runbook",
			"run",
			"--service",
			"fasttrack",
			"--flow",
			"fill-week",
			"--input-file",
			"timesheet_run=/private/one.json",
			"--input-file",
			"other=/private/two.json",
			"--json",
		]);
		expect(parsed.kind).toBe("command");
		if (parsed.kind !== "command") return;
		expect(parsed.repeatedFlagValues["--input-file"]).toEqual([
			"timesheet_run=/private/one.json",
			"other=/private/two.json",
		]);
	});

	test("runbook activate requires reviewed digest and CAS epoch", () => {
		expect(
			parseBrowserUseArgv([
				"runbook",
				"activate",
				"--catalog-digest",
				"a".repeat(64),
				"--expected-epoch",
				"0",
				"--json",
			]),
		).toMatchObject({
			kind: "command",
			command: "runbook-activate",
		});
		expect(() =>
			parseBrowserUseArgv(["runbook", "activate", "--json"]),
		).toThrow("runbook activate requires --catalog-digest");
	});

	test("runbook authoring commands accept only their complete-document guards", () => {
		expect(parseBrowserUseArgv(["runbook", "schema", "--json"])).toMatchObject({
			kind: "command",
			command: "runbook-schema",
		});
		expect(
			parseBrowserUseArgv([
				"runbook",
				"apply",
				"--file",
				"draft.json",
				"--expected-record-digest",
				"a".repeat(64),
				"--json",
			]),
		).toMatchObject({ kind: "command", command: "runbook-apply" });
		expect(() => parseBrowserUseArgv(["runbook", "validate", "--json"])).toThrow(
			"runbook validate requires --file",
		);
		expect(() =>
			parseBrowserUseArgv([
				"runbook",
				"delete",
				"--service",
				"demo",
				"--json",
			]),
		).toThrow("runbook delete requires --flow");
		expect(() =>
			parseBrowserUseArgv([
				"runbook",
				"delete",
				"--service",
				"demo",
				"--flow",
				"read",
				"--expected-record-digest",
				"stale",
			]),
		).toThrow("runbook delete --expected-record-digest must be 64 lowercase hex");
	});

	// No-arg is the launcher (exit 0, design brief D1; asserted in the front-
	// door smoke tests). A PRESENT but unregistered family token stays a usage
	// error naming the invalid value (D6).
	test("unknown family is a usage error naming the token", async () => {
		const result = await runForTest(["not-a-family"], makeRuntime());
		expect(result.exitCode).toBe(2);
		expect(`${result.stdout}\n${result.stderr}`).toContain(
			"unknown command family: not-a-family",
		);
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
		const cases: string[][] = [
			["targets", "list", "--bogus", "--dry-run", "--json"],
			["targets", "select", "--bogus", "--dry-run", "--json"],
			["targets", "status", "--bogus", "--json"],
			["operate", "snapshot", "--bogus", "--dry-run", "--json"],
			["operate", "screenshot", "--out", "x.png", "--bogus", "--dry-run", "--json"],
			["operate", "emulate", "--bogus", "--dry-run", "--json"],
		];
		for (const argv of cases) {
			const result = await runForTest(argv, makeRuntime());
			expect(result.exitCode).toBe(2);
			expect(`${result.stdout}\n${result.stderr}`).toContain(
				"unknown option: --bogus",
			);
		}
	});

	// Ported from the deleted browser-adapter-router safety suite ("usage errors
	// redact filesystem-looking values"): the surviving front door sanitizes
	// usage-error prose (sanitizeUsageValue at the throw site, redactUnsafeText
	// in emitCliError), so a filesystem-looking value smuggled into an
	// undeclared flag token never appears in CLI output.
	test("usage errors never echo filesystem-looking flag values", async () => {
		const result = await runForTest(
			["targets", "list", "--state=/tmp/router-secret.json", "--json"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(2);
		expect(result.stdout).not.toContain("/tmp/router-secret.json");
		expect(result.stderr).not.toContain("/tmp/router-secret.json");
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "usage_error",
		});
	});

	test("declared flags are accepted without a usage error", async () => {
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--show-url", "--dry-run", "--json"],
			makeRuntime(),
		);
		expect(`${result.stdout}\n${result.stderr}`).not.toContain("unknown option");
		expect(result.exitCode).toBe(0);
	});

	// api-contract parity (finding #8): enum-typed flag VALUES are validated in
	// the parser against the contract's declared `values`, BEFORE the dry-run/
	// live split. An unregistered --intent/--lane/--mode/--adapter must fail
	// closed with a usage error in dry-run exactly as it does live — dry-run must
	// never accept an enum value the live routing path would refuse. The parser
	// rejects the bad enum before --handoff is read, so a placeholder path is
	// enough.
	test("dry-run rejects unregistered enum flag values at the parser", async () => {
		const cases: { argv: string[]; needle: string }[] = [
			{
				argv: [
					"task",
					"run",
					"--intent",
					"totally-fake",
					"--handoff",
					"/dev/null",
					"--dry-run",
					"--json",
				],
				needle: "--intent must be one of:",
			},
			{
				argv: [
					"task",
					"run",
					"--intent",
					"scrape",
					"--lane",
					"totally-fake-lane",
					"--handoff",
					"/dev/null",
					"--dry-run",
					"--json",
				],
				needle: "--lane must be one of:",
			},
			{
				argv: [
					"targets",
					"list",
					"--mode",
					"totally-fake-mode",
					"--dry-run",
					"--json",
				],
				needle: "--mode must be one of:",
			},
			{
				argv: [
					"targets",
					"list",
					"--adapter",
					"totally-fake-adapter",
					"--dry-run",
					"--json",
				],
				needle: "--adapter must be one of:",
			},
		];
		for (const { argv, needle } of cases) {
			const result = await runForTest(argv, makeRuntime());
			expect(result.exitCode).toBe(2);
			expect(parseJson(result.stdout).error).toMatchObject({
				code: "usage_error",
			});
			expect(`${result.stdout}\n${result.stderr}`).toContain(needle);
		}
	});

	// Regression: --help/--version detect from STANDALONE tokens only. A token
	// shaped like them consumed as a value-bearing flag's value must not
	// short-circuit the command into help/version output.
	test("a flag value shaped like --version does not short-circuit to version", async () => {
		const result = await runForTest(
			["targets", "select", "--title-contains", "--version", "--dry-run", "--json"],
			makeRuntime(),
		);
		const json = parseJson(result.stdout);
		expect(json.data).toMatchObject({ command: "targets-select" });
	});

	test("a flag value shaped like --help does not short-circuit to help", async () => {
		const result = await runForTest(
			["targets", "select", "--title-contains", "--help", "--dry-run", "--json"],
			makeRuntime(),
		);
		expect(result.stdout).not.toContain("Usage");
		expect(parseJson(result.stdout).data).toMatchObject({
			command: "targets-select",
		});
	});

	// Regression: mode flags derive from parsed flag values, never token scans.
	// A value-bearing flag that consumes a "--dry-run"/"--json"-shaped token must
	// not flip dry-run mode (a live command would silently return a mock envelope).
	test("a flag value shaped like --dry-run does not enable dry-run mode", async () => {
		const result = await runForTest(
			["targets", "select", "--title-contains", "--dry-run", "--json"],
			makeRuntime(),
		);
		// Not a dry-run: without live state/handoff evidence the real command
		// fails instead of emitting the dry-run mock success envelope.
		expect(result.exitCode).not.toBe(0);
		expect(`${result.stdout}\n${result.stderr}`).not.toContain('"mode": "dry_run"');
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

	test("without dry-run operate requires live handoff evidence", async () => {
		const result = await runForTest(
			["operate", "snapshot", "--json"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.status).toBe("error");
		expect(json.error).toMatchObject({ code: "browser_operation_handoff_invalid" });
	});
});
