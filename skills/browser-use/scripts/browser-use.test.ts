import { describe, expect, test } from "bun:test";
import {
	CLI_DIAGNOSTIC_FLAGS,
	parseCommandFacadeContract,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";
import {
	BROWSER_USE_OPERATION_CONTRACT_ID,
	BROWSER_USE_OPERATION_SCHEMA_VERSION,
	BROWSER_USE_TARGETS_CONTRACT_ID,
	BROWSER_USE_TARGETS_SCHEMA_VERSION,
	type BrowserUseCommand,
	browserUseContracts,
} from "./command-contract";
import {
	type BrowserUseRuntime,
	createDefaultBrowserUseRuntime,
	runForTest,
} from "./browser-use";

function makeRuntime(overrides: Partial<BrowserUseRuntime> = {}): BrowserUseRuntime {
	return createDefaultBrowserUseRuntime({
		env: {},
		now: () => 1_000,
		...overrides,
	});
}

function parseJson(stdout: string): Record<string, unknown> {
	return JSON.parse(stdout) as Record<string, unknown>;
}

const ALL_COMMANDS: BrowserUseCommand[] = [
	"targets-list",
	"targets-select",
	"targets-status",
	"operate-snapshot",
	"operate-screenshot",
	"operate-emulate",
];

function contractFlags(command: BrowserUseCommand): string[] {
	return Object.keys(browserUseContracts[command].flags ?? {}).sort();
}

function discoveryTree() {
	return projectCommandDiscoveryTree(
		Object.entries(browserUseContracts) as Array<
			[BrowserUseCommand, (typeof browserUseContracts)[BrowserUseCommand]]
		>,
	);
}

// =========================================================================
// Command contract / discovery
// =========================================================================

describe("U3 command contract", () => {
	test("contract parses and exposes the targets and operate families", () => {
		const result = parseCommandFacadeContract(browserUseContracts, {
			path: "skills/browser-use/scripts/command-contract.ts",
		});
		expect(result.ok).toBe(true);
		expect(Object.keys(browserUseContracts).sort()).toEqual([...ALL_COMMANDS].sort());
	});

	test("no command declares a facade-reserved diagnostic flag", () => {
		for (const command of ALL_COMMANDS) {
			const flags = Object.keys(browserUseContracts[command].flags ?? {});
			for (const reserved of CLI_DIAGNOSTIC_FLAGS) {
				expect(flags).not.toContain(reserved);
			}
		}
	});

	test("subcommands expose only their declared flags", () => {
		expect(contractFlags("targets-status")).toEqual([
			"--json",
			"--plain",
			"--state",
		]);
		expect(contractFlags("operate-screenshot")).toContain("--out");
		expect(contractFlags("operate-emulate")).toContain("--width");
	});

	// Scenario 5: command discovery exposes both result contracts with versions.
	test("command discovery exposes browser-targets and browser-operation result contracts with versions", () => {
		const tree = discoveryTree();
		for (const command of ["targets-list", "targets-select", "targets-status"] as const) {
			expect(tree.commands[command]?.result_contract).toMatchObject({
				id: BROWSER_USE_TARGETS_CONTRACT_ID,
				schema_version: BROWSER_USE_TARGETS_SCHEMA_VERSION,
			});
		}
		for (const command of ["operate-snapshot", "operate-screenshot", "operate-emulate"] as const) {
			expect(tree.commands[command]?.result_contract).toMatchObject({
				id: BROWSER_USE_OPERATION_CONTRACT_ID,
				schema_version: BROWSER_USE_OPERATION_SCHEMA_VERSION,
			});
		}
		expect(BROWSER_USE_TARGETS_CONTRACT_ID).toBe("browser-use.browser-targets");
		expect(BROWSER_USE_OPERATION_CONTRACT_ID).toBe("browser-use.browser-operation");
	});
});

// =========================================================================
// Help + version
// =========================================================================

describe("U3 help and version", () => {
	// Scenario 1: root help renders both families.
	test("--help renders targets and operate families", async () => {
		const result = await runForTest(["--help"], makeRuntime());
		expect(result.exitCode).toBe(0);
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
			expect(result.stdout).toContain("browser-adapter-router");
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

	test("declared flags are accepted without a usage error", async () => {
		const result = await runForTest(
			["targets", "list", "--mode", "auto", "--show-url", "--dry-run", "--json"],
			makeRuntime(),
		);
		expect(`${result.stdout}\n${result.stderr}`).not.toContain("unknown option");
		expect(result.exitCode).toBe(0);
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

	// targets status still defaults to a plain human projection (no --dry-run
	// flag on status; the not-implemented path is emitted in plain text).
	test("targets status defaults to plain output", async () => {
		const result = await runForTest(["targets", "status"], makeRuntime());
		expect(result.stderr).toContain("browser_use_not_implemented");
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

	test("without dry-run the shell emits a structured not-implemented error", async () => {
		const result = await runForTest(
			["operate", "snapshot", "--json"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(1);
		const json = parseJson(result.stdout);
		expect(json.status).toBe("error");
		expect(json.error).toMatchObject({ code: "browser_use_not_implemented" });
	});
});
