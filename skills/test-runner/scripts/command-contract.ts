import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";

export const TEST_RUNNER_CONTRACT_ID = "test-runner.bun-test" as const;
export const TEST_RUNNER_SCHEMA_VERSION = "2" as const;

export type TestRunnerCommand = "run" | "status" | "detail";
export type TestRunnerRunMode = "compact" | "repair" | "triage";
export type TestRunnerOutputFormat = "plain" | "json" | "json-compact" | "toon";
type TestRunnerAudience = "agent" | "operator";
type TestRunnerMutation = "check";
type TestRunnerCommandContract = CommandFacadeContract<
	TestRunnerCommand,
	TestRunnerAudience,
	TestRunnerMutation
>;

export const TEST_RUNNER_DIAGNOSTIC_CODES = [
	"invalid_cwd",
	"missing_bun",
	"runner_timeout",
	"invocation_error",
	"usage_error",
	"detail_not_found",
	"detail_expired",
	"detail_wrong_run",
	"detail_malformed",
	"detail_unsafe",
	"detail_unavailable",
] as const;
export type TestRunnerDiagnosticCode =
	(typeof TEST_RUNNER_DIAGNOSTIC_CODES)[number];

export const TEST_RUNNER_RESULT_STATUSES = [
	"passed",
	"failed",
	"error",
] as const;
export type TestRunnerResultStatus =
	(typeof TEST_RUNNER_RESULT_STATUSES)[number];

export const TEST_RUNNER_FAILURE_ACTIONS = [
	{
		id: "fix_test_failure",
		summary: "Use the failure context to edit the failing code or test.",
		sideEffects: ["write"],
	},
	{
		id: "lookup_failure_detail",
		summary: "Use the failure handle to fetch source-run stored detail.",
		sideEffects: ["check"],
	},
	{
		id: "change_runner_input",
		summary: "Correct runner arguments, cwd, or pass-through arguments.",
		sideEffects: ["check"],
	},
	{
		id: "install_bun",
		summary: "Install the required test runtime, then rerun.",
		sideEffects: ["write"],
	},
	{
		id: "increase_timeout",
		summary: "Increase the runner timeout or pass a narrower test target.",
		sideEffects: ["check"],
	},
] as const;

export const TEST_RUNNER_SUCCESS_ACTIONS = [
	{
		id: "continue_implementation",
		summary: "Continue implementation with the current focused test passing.",
		sideEffects: ["check"],
	},
] as const;

const flags = {
	"--cwd": { type: "path", description: "Directory where tests run." },
	"--json": { type: "boolean", description: "Emit JSON envelope." },
	"--plain": { type: "boolean", description: "Emit compact text." },
	"--format": {
		type: "string",
		description: "Select plain, json, json-compact, or toon output.",
	},
	"--timeout-ms": {
		type: "string",
		description: "Kill the test process after this many milliseconds.",
	},
	"--debug-output": {
		type: "boolean",
		description: "Include bounded raw output samples in JSON.",
	},
	"--mode": {
		type: "string",
		description: "Select compact, repair, or triage projection.",
	},
	"--handle": {
		type: "string",
		description: "Lookup handle from a prior source-run failure packet.",
	},
} as const satisfies TestRunnerCommandContract["flags"];

const resultContract = {
	id: TEST_RUNNER_CONTRACT_ID,
	kind: "Agent runner test result.",
	schema_version: TEST_RUNNER_SCHEMA_VERSION,
} as const satisfies NonNullable<TestRunnerCommandContract["resultContract"]>;

const exitCodes = {
	"0": "Tests passed.",
	"1": "Tests failed or runner runtime failed.",
	"2": "Usage error.",
} as const satisfies TestRunnerCommandContract["exitCodes"];

export const testRunnerContracts = defineCommandFacadeContract(
	{
		run: {
			script: "test-runner",
			summary: "Execute tests with compact, repair, triage, or JSON output.",
			usage: [
				"run [--cwd <dir>] [--mode compact|repair|triage] [--format plain|json|json-compact|toon] [--json|--plain] [--timeout-ms <ms>] [--debug-output] -- <test args>",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: [
				{
					name: "TEST_RUNNER_RUN_ID",
					description: "Optional run correlation id.",
				},
			],
			resultContract,
			actionAffordances: {
				success: TEST_RUNNER_SUCCESS_ACTIONS,
				failure: TEST_RUNNER_FAILURE_ACTIONS,
			},
			flags: {
				"--cwd": flags["--cwd"],
				"--json": flags["--json"],
				"--plain": flags["--plain"],
				"--format": flags["--format"],
				"--timeout-ms": flags["--timeout-ms"],
				"--debug-output": flags["--debug-output"],
				"--mode": flags["--mode"],
			},
			exitCodes,
		},
		status: {
			script: "test-runner",
			summary: "Show compact runner readiness without executing tests.",
			usage: ["status [--cwd <dir>] [--format plain|json|json-compact|toon] [--json|--plain]"],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: [
				{
					name: "TEST_RUNNER_RUN_ID",
					description: "Optional run correlation id.",
				},
			],
			resultContract,
			actionAffordances: {
				success: TEST_RUNNER_SUCCESS_ACTIONS,
				failure: TEST_RUNNER_FAILURE_ACTIONS,
			},
			flags: {
				"--cwd": flags["--cwd"],
				"--json": flags["--json"],
				"--plain": flags["--plain"],
				"--format": flags["--format"],
			},
			exitCodes,
			alias: {
				command: "run",
				defaultArgs: ["--plain"],
			},
		},
		detail: {
			script: "test-runner",
			summary: "Return source-run stored detail for a failure lookup handle.",
			usage: ["detail --handle <handle> [--format plain|json|json-compact|toon] [--json|--plain]"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: [
				{
					name: "TEST_RUNNER_RUN_ID",
					description: "Optional run correlation id.",
				},
			],
			resultContract,
			actionAffordances: {
				success: TEST_RUNNER_SUCCESS_ACTIONS,
				failure: TEST_RUNNER_FAILURE_ACTIONS,
			},
			flags: {
				"--handle": flags["--handle"],
				"--json": flags["--json"],
				"--plain": flags["--plain"],
				"--format": flags["--format"],
			},
			exitCodes,
		},
	} as const satisfies Record<TestRunnerCommand, TestRunnerCommandContract>,
	{
		path: "skills/test-runner/scripts/command-contract.ts",
		writeImplyingMutations: new Set(["write", "destructive"]),
	},
);
