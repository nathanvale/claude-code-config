import { afterEach, describe, expect, test } from "bun:test";
import { getLogger } from "@logtape/logtape";

import {
	CliUsageError,
	configureCliDiagnostics,
	createCliDiagnosticContext,
	emitCliDiagnostic,
	getCurrentCliDiagnosticContext,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	recordCliDomainRunId,
	resetCliDiagnostics,
	withCliDiagnosticContext,
	writeJson,
} from "@side-quest/cli-command-facade";

describe("CLI command facade diagnostics", () => {
	afterEach(() => {
		resetCliDiagnostics();
	});

	test("parses universal diagnostic flags without changing command contracts", () => {
		const parsed = parseCliDiagnosticArgv([
			"--debug",
			"inspect",
			"--format",
			"json",
			"--quiet",
			"target",
			"--json",
		]);

		expect(parsed.argv).toEqual([
			"inspect",
			"--format",
			"json",
			"target",
			"--json",
		]);
		expect(parsed.options).toMatchObject({
			json: true,
			quiet: true,
			verbose: false,
			debug: true,
			mode: "quiet",
			lowestLevel: "error",
		});

		const sentinelParsed = parseCliDiagnosticArgv(["inspect", "--", "--json"]);
		expect(sentinelParsed.argv).toEqual(["inspect", "--json"]);
		expect(sentinelParsed.options.json).toBe(false);
	});

	test("parses and validates run-id diagnostic flags", () => {
		const parsed = parseCliDiagnosticArgv([
			"--run-id",
			"smoke-123",
			"inspect",
			"--json",
		]);

		expect(parsed.argv).toEqual(["inspect", "--json"]);
		expect(parsed.options.runId).toBe("smoke-123");

		const equalsParsed = parseCliDiagnosticArgv([
			"--run-id=a_b.1-2",
			"inspect",
		]);
		expect(equalsParsed.options.runId).toBe("a_b.1-2");

		const sentinelParsed = parseCliDiagnosticArgv([
			"inspect",
			"--",
			"--run-id",
			"domain-owned",
		]);
		expect(sentinelParsed.argv).toEqual([
			"inspect",
			"--run-id",
			"domain-owned",
		]);
	});

	test("generates a UUID run-id for direct diagnostic invocations", () => {
		const parsed = parseCliDiagnosticArgv(["inspect"]);

		expect(parsed.options.runId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});

	test("rejects missing duplicate or unsafe run-id values", () => {
		expect(() => parseCliDiagnosticArgv(["--run-id"])).toThrow(CliUsageError);
		expect(() =>
			parseCliDiagnosticArgv(["--run-id", "a", "--run-id=b"]),
		).toThrow(CliUsageError);
		expect(() => parseCliDiagnosticArgv(["--run-id", "../x"])).toThrow(
			CliUsageError,
		);
		expect(() => parseCliDiagnosticArgv(["--run-id=--x"])).toThrow(
			CliUsageError,
		);
		expect(() => parseCliDiagnosticArgv(["--run-id", "a\nb"])).toThrow(
			CliUsageError,
		);
		expect(() => parseCliDiagnosticArgv(["--run-id", "a".repeat(65)])).toThrow(
			CliUsageError,
		);
	});

	test("builds fallback diagnostics after run-id parse failures", () => {
		const parsed = parseCliDiagnosticFallbackArgv([
			"--json",
			"--run-id",
			"../unsafe",
			"inspect",
		]);

		expect(parsed.argv).toEqual(["--json", "inspect"]);
		expect(parsed.options.json).toBe(true);
		expect(parsed.options.runId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);

		const missingValueParsed = parseCliDiagnosticFallbackArgv([
			"--run-id",
			"--json",
			"inspect",
		]);
		expect(missingValueParsed.argv).toEqual(["--json", "inspect"]);
		expect(missingValueParsed.options.json).toBe(true);

		const duplicateParsed = parseCliDiagnosticFallbackArgv([
			"--run-id",
			"first-valid",
			"--run-id",
			"second-valid",
			"--json",
			"inspect",
		]);
		expect(duplicateParsed.options.runId).toBe("first-valid");
	});

	test("keeps non-diagnostic argv ordering stable", () => {
		const parsed = parseCliDiagnosticArgv([
			"inspect",
			"target",
			"--verbose",
			"--format",
			"human",
			"--debug",
		]);

		expect(parsed.argv).toEqual(["inspect", "target", "--format", "human"]);
		expect(parsed.options.mode).toBe("debug");
		expect(parsed.options.lowestLevel).toBe("debug");
	});

	test("writes program JSON separately from JSON Lines diagnostics", () => {
		let stdout = "";
		let stderr = "";
		const parsed = parseCliDiagnosticArgv(["inspect", "--json", "--debug"]);

		configureCliDiagnostics({
			categoryRoot: "example",
			options: parsed.options,
			diagnosticWriter: { write: (chunk) => (stderr += chunk) },
		});

		withCliDiagnosticContext(
			createCliDiagnosticContext(parsed.options, {
				command: "inspect",
				route: "example inspect",
			}),
			() => {
				emitCliDiagnostic(["example", "cli"], "info", "command-dispatched", {
					command: "inspect",
				});
				writeJson({ write: (chunk) => (stdout += chunk) }, { ok: true });
			},
		);

		expect(stdout).toBe('{\n  "ok": true\n}\n');
		const lines = stderr.trim().split("\n");
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
			level: "info",
			category: ["example", "cli"],
			event: "command-dispatched",
			command: "inspect",
			route: "example inspect",
			run_id: parsed.options.runId,
		});
	});

	test("domain run identity is late-bound on the live facade context", () => {
		let stderr = "";
		const parsed = parseCliDiagnosticArgv([
			"inspect",
			"--json",
			"--debug",
			"--run-id",
			"cli-run-1",
		]);

		configureCliDiagnostics({
			categoryRoot: "example",
			options: parsed.options,
			diagnosticWriter: { write: (chunk) => (stderr += chunk) },
		});

		withCliDiagnosticContext(
			createCliDiagnosticContext(parsed.options, { command: "inspect" }),
			() => {
				recordCliDomainRunId("domain-run-1");
				expect(getCurrentCliDiagnosticContext()).toMatchObject({
					domain_run_id: "domain-run-1",
					run_id_source: "legacy-domain",
				});
				getLogger(["example", "runtime-hygiene"]).debug("after-domain", {
					event: "after-domain",
				});
			},
		);

		const record = JSON.parse(stderr);
		expect(record).toMatchObject({
			event: "after-domain",
			command: "inspect",
			run_id: "cli-run-1",
		});
		expect(record.domain_run_id).toBeUndefined();
		expect(record.run_id_source).toBeUndefined();
	});

	test("formats non-JSON diagnostics for the diagnostic writer only", () => {
		let stderr = "";

		configureCliDiagnostics({
			categoryRoot: ["example"],
			options: parseCliDiagnosticArgv(["inspect", "--verbose"]).options,
			diagnosticWriter: { write: (chunk) => (stderr += chunk) },
		});
		emitCliDiagnostic(["example", "cli"], "info", "route-resolved", {
			route: "example inspect",
		});

		expect(stderr).toContain("INFO example.cli route-resolved");
		expect(stderr).toContain("route=example inspect");
	});

	test("quiet mode suppresses info diagnostics but still emits errors", () => {
		let stderr = "";

		configureCliDiagnostics({
			categoryRoot: "example",
			options: parseCliDiagnosticArgv(["inspect", "--quiet"]).options,
			diagnosticWriter: { write: (chunk) => (stderr += chunk) },
		});
		emitCliDiagnostic(["example", "cli"], "info", "route-resolved");
		emitCliDiagnostic(["example", "cli"], "error", "command-failed");

		const lines = stderr.trim().split("\n").filter(Boolean);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("ERROR example.cli command-failed");
	});

	test("default diagnostics buffer debug and info until an error flushes them", () => {
		let stderr = "";
		const parsed = parseCliDiagnosticArgv([
			"inspect",
			"--json",
			"--run-id",
			"buffer-run",
		]);

		configureCliDiagnostics({
			categoryRoot: "example",
			options: parsed.options,
			diagnosticWriter: { write: (chunk) => (stderr += chunk) },
		});

		withCliDiagnosticContext(createCliDiagnosticContext(parsed.options), () => {
			emitCliDiagnostic(["example", "cli"], "debug", "debug-context");
			emitCliDiagnostic(["example", "cli"], "info", "info-context");
			expect(stderr).toBe("");
			emitCliDiagnostic(["example", "cli"], "error", "command-failed");
		});

		const lines = stderr
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(lines.map((line) => line.event)).toEqual([
			"debug-context",
			"info-context",
			"command-failed",
		]);
		expect(lines.every((line) => line.run_id === "buffer-run")).toBe(true);
	});

	test("default diagnostic buffers are isolated by diagnostic context", () => {
		let stderr = "";
		const runA = parseCliDiagnosticArgv([
			"inspect",
			"--json",
			"--run-id",
			"same-run",
		]);
		const runB = parseCliDiagnosticArgv([
			"inspect",
			"--json",
			"--run-id",
			"same-run",
		]);

		configureCliDiagnostics({
			categoryRoot: "example",
			options: runA.options,
			diagnosticWriter: { write: (chunk) => (stderr += chunk) },
		});

		withCliDiagnosticContext(createCliDiagnosticContext(runA.options), () => {
			emitCliDiagnostic(["example", "cli"], "debug", "a-debug");
		});
		withCliDiagnosticContext(createCliDiagnosticContext(runB.options), () => {
			emitCliDiagnostic(["example", "cli"], "debug", "b-debug");
			emitCliDiagnostic(["example", "cli"], "error", "b-error");
		});

		const lines = stderr
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		expect(lines.map((line) => line.event)).toEqual(["b-debug", "b-error"]);
		expect(lines.every((line) => line.run_id === "same-run")).toBe(true);
		expect(JSON.stringify(lines)).not.toContain("__cli_diagnostic_context_id");
	});

	test("default diagnostics mark truncated post-mortem buffers", () => {
		let stderr = "";
		const parsed = parseCliDiagnosticArgv([
			"inspect",
			"--json",
			"--run-id",
			"truncated-buffer-run",
		]);

		configureCliDiagnostics({
			categoryRoot: "example",
			options: parsed.options,
			diagnosticWriter: { write: (chunk) => (stderr += chunk) },
		});

		withCliDiagnosticContext(createCliDiagnosticContext(parsed.options), () => {
			for (let index = 0; index < 252; index += 1) {
				emitCliDiagnostic(["example", "cli"], "debug", `debug-${index}`);
			}
			emitCliDiagnostic(["example", "cli"], "error", "command-failed");
		});

		const lines = stderr
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(lines[0]).toMatchObject({
			event: "diagnostic-buffer-truncated",
			buffer_truncated: true,
			buffer_truncation_policy: "oldest_dropped",
			dropped_record_count: 2,
			run_id: "truncated-buffer-run",
		});
		expect(lines[1]?.event).toBe("debug-2");
		expect(lines.at(-1)?.event).toBe("command-failed");
	});

	test("redacts generic secret-shaped diagnostic properties", () => {
		let stderr = "";

		configureCliDiagnostics({
			categoryRoot: "example",
			options: parseCliDiagnosticArgv(["inspect", "--json", "--debug"]).options,
			diagnosticWriter: { write: (chunk) => (stderr += chunk) },
		});
		emitCliDiagnostic(["example", "cli"], "debug", "token-loaded", {
			accessToken: "abc123",
			nested: { password: "secret", ok: true },
		});

		const record = JSON.parse(stderr);
		expect(record.accessToken).toBe("[REDACTED]");
		expect(record.nested.password).toBe("[REDACTED]");
		expect(record.nested.ok).toBe(true);
	});

	test("LogTape package loggers inherit facade CLI context", () => {
		let stderr = "";

		configureCliDiagnostics({
			categoryRoot: "example",
			options: parseCliDiagnosticArgv(["inspect", "--json", "--debug"]).options,
			diagnosticWriter: { write: (chunk) => (stderr += chunk) },
		});

		withCliDiagnosticContext(
			{ command: "inspect", diagnosticLevel: "debug" },
			() => {
				getLogger(["example", "runtime-hygiene"]).debug(
					"Runtime hygiene classified {reason}",
					{
						event: "doctor-finding-classified",
						reason: "stale_agent_browser_pid_file",
					},
				);
			},
		);

		expect(JSON.parse(stderr)).toMatchObject({
			category: ["example", "runtime-hygiene"],
			event: "doctor-finding-classified",
			command: "inspect",
			diagnosticLevel: "debug",
			reason: "stale_agent_browser_pid_file",
		});
	});

});
