#!/usr/bin/env bun
// good-baseline runnable: a minimal CORRECT facade CLI. Handles the `check`
// command, emits a valid success envelope under --json, and rejects unknown
// options with the declared usage exit code (2) and a valid error envelope under
// --json. The auditor MUST pass this with zero findings across every enumerated
// invocation (R9 known-good oracle).

import {
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";

function emitUsageError(json: boolean, runId: string, message: string): number {
	if (json) {
		writeJsonEnvelope(
			process.stdout,
			createCliRuntimeErrorEnvelope({
				run_id: runId,
				process_exit_code: 2,
				error: {
					run_id: runId,
					code: "usage_error",
					message,
					exit_code: 2,
					severity: "error",
					recoverability: "change_input",
					retryable: false,
				},
			}),
			{ runId, durationMs: 0 },
		);
	} else {
		process.stderr.write(`${message}\n`);
	}
	return 2;
}

function main(): number {
	const raw = Bun.argv.slice(2);
	let parsed: ReturnType<typeof parseCliDiagnosticArgv>;
	try {
		parsed = parseCliDiagnosticArgv(raw);
	} catch (error) {
		const fallback = parseCliDiagnosticFallbackArgv(raw);
		return emitUsageError(
			raw.includes("--json"),
			fallback.options.runId,
			error instanceof Error ? error.message : String(error),
		);
	}

	const runId = parsed.options.runId;
	const args = [...parsed.argv];
	if (args[0] === "check") args.shift();
	const json = args.includes("--json");
	const rest = args.filter((a) => a !== "--json");
	if (rest.length > 0) {
		return emitUsageError(json, runId, `unknown option: ${rest[0]}`);
	}

	if (json) {
		writeJsonEnvelope(
			process.stdout,
			createCliRuntimeSuccessEnvelope({ run_id: runId, data: { action: "clean" } }),
			{ runId, durationMs: 0 },
		);
	} else {
		process.stdout.write("clean\n");
	}
	return 0;
}

process.exit(main());
