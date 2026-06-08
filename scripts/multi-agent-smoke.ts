#!/usr/bin/env bun

import {
	buildSmokeCommand,
	getDefaultTimeoutMs,
	getDefaultWarnAfterMs,
	type HarnessName,
	type RunResult,
	runSmokeTest,
	SMOKE_TESTS,
	type SmokeTestId,
} from "./multi-agent-smoke-lib.ts";

type CliOptions = {
	harnesses: HarnessName[];
	tests: SmokeTestId[];
	cwd: string;
	dryRun: boolean;
	json: boolean;
	list: boolean;
	warnAfterMs?: number;
	timeoutMs?: number;
};

const DEFAULT_HARNESSES: HarnessName[] = ["claude", "codex"];
const DEFAULT_TESTS = SMOKE_TESTS.map((test) => test.id);

function parseList<T extends string>(
	value: string,
	allowed: readonly T[],
	flag: string,
): T[] {
	const requested = value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);

	const invalid = requested.filter((item) => !allowed.includes(item as T));
	if (invalid.length > 0) {
		throw new Error(`Invalid value for ${flag}: ${invalid.join(", ")}`);
	}

	return requested as T[];
}

function parseArgs(argv: string[]): CliOptions {
	const options: CliOptions = {
		harnesses: DEFAULT_HARNESSES,
		tests: DEFAULT_TESTS,
		cwd: process.cwd(),
		dryRun: false,
		json: false,
		list: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--dry-run") {
			options.dryRun = true;
			continue;
		}
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--list") {
			options.list = true;
			continue;
		}
		if (arg === "--cwd") {
			const value = argv[index + 1];
			if (!value) throw new Error("--cwd requires a value");
			options.cwd = value;
			index += 1;
			continue;
		}
		if (arg === "--timeout-ms") {
			const value = argv[index + 1];
			if (!value) throw new Error("--timeout-ms requires a value");
			const parsed = Number.parseInt(value, 10);
			if (!Number.isFinite(parsed) || parsed <= 0) {
				throw new Error("--timeout-ms must be a positive integer");
			}
			options.timeoutMs = parsed;
			index += 1;
			continue;
		}
		if (arg === "--warn-after-ms") {
			const value = argv[index + 1];
			if (!value) throw new Error("--warn-after-ms requires a value");
			const parsed = Number.parseInt(value, 10);
			if (!Number.isFinite(parsed) || parsed <= 0) {
				throw new Error("--warn-after-ms must be a positive integer");
			}
			options.warnAfterMs = parsed;
			index += 1;
			continue;
		}
		if (arg === "--harnesses") {
			const value = argv[index + 1];
			if (!value) throw new Error("--harnesses requires a value");
			options.harnesses = parseList(value, DEFAULT_HARNESSES, "--harnesses");
			index += 1;
			continue;
		}
		if (arg === "--tests") {
			const value = argv[index + 1];
			if (!value) throw new Error("--tests requires a value");
			options.tests = parseList(value, DEFAULT_TESTS, "--tests");
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	return options;
}

function printList(): void {
	console.log("Available smoke tests:");
	for (const test of SMOKE_TESTS) {
		console.log(`- ${test.id}: ${test.title}`);
	}
}

function printHumanReport(results: RunResult[]): void {
	const grouped = new Map<SmokeTestId, RunResult[]>();
	for (const result of results) {
		const bucket = grouped.get(result.test) ?? [];
		bucket.push(result);
		grouped.set(result.test, bucket);
	}

	for (const [testId, testResults] of grouped) {
		const title =
			SMOKE_TESTS.find((test) => test.id === testId)?.title ?? testId;
		console.log(`\n${testId} - ${title}`);
		for (const result of testResults) {
			const status =
				result.status === "timeout"
					? "TIMEOUT"
					: result.latencyStatus === "slow" && result.ok
						? "WARN"
						: result.ok
							? "PASS"
							: "FAIL";
			const limitNote =
				result.status === "timeout"
					? `, warn ${result.warnAfterMs}ms, limit ${result.timeoutMs}ms`
					: result.latencyStatus === "slow"
						? `, warn ${result.warnAfterMs}ms`
						: "";
			console.log(
				`  ${status} ${result.harness} (${result.durationMs}ms${limitNote})`,
			);
			if (result.error) {
				console.log(`    error: ${result.error}`);
				if (result.warning) {
					console.log(`    warning: ${result.warning}`);
				}
				if (result.stderr.trim()) {
					console.log(`    stderr: ${JSON.stringify(result.stderr.trim())}`);
				}
				if (result.stdout.trim()) {
					console.log(`    stdout: ${JSON.stringify(result.stdout.trim())}`);
				}
				continue;
			}
			for (const assertion of result.assertions) {
				if (!assertion.ok) {
					console.log(
						`    mismatch ${assertion.key}: expected ${JSON.stringify(assertion.expected)}, got ${JSON.stringify(assertion.actual)}`,
					);
				}
			}
			if (result.warning) {
				console.log(`    warning: ${result.warning}`);
			}
			if (result.assertions.length === 0 && result.command.length > 0) {
				console.log(`    command: ${result.command.join(" ")}`);
			}
		}
	}

	const failures = results.filter((result) => !result.ok).length;
	const warnings = results.filter(
		(result) => result.ok && result.latencyStatus === "slow",
	).length;
	console.log(
		`\nSummary: ${results.length - failures}/${results.length} runs passed, ${warnings} warnings`,
	);
}

async function main(): Promise<void> {
	const options = parseArgs(Bun.argv.slice(2));

	if (options.list) {
		printList();
		return;
	}

	if (options.dryRun && !options.json) {
		for (const testId of options.tests) {
			for (const harness of options.harnesses) {
				const { command, cleanup } = buildSmokeCommand({
					testId,
					harness,
					cwd: options.cwd,
				});
				try {
					console.log(`${harness}:${testId} -> ${command.join(" ")}`);
				} finally {
					cleanup();
				}
			}
		}
		return;
	}

	const results: RunResult[] = [];
	for (const testId of options.tests) {
		for (const harness of options.harnesses) {
			results.push(
				await runSmokeTest({
					testId,
					harness,
					cwd: options.cwd,
					dryRun: options.dryRun,
					warnAfterMs: options.warnAfterMs ?? getDefaultWarnAfterMs(harness),
					timeoutMs: options.timeoutMs ?? getDefaultTimeoutMs(harness),
				}),
			);
		}
	}

	if (options.json) {
		console.log(JSON.stringify(results, null, 2));
	} else {
		printHumanReport(results);
	}

	if (results.some((result) => !result.ok)) {
		process.exitCode = 1;
	}
}

await main();
