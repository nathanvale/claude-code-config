import { describe, expect, test } from "bun:test";
import {
	CliWriterContractError,
	writeJson,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";

describe("CLI command facade JSON writer", () => {
	test("writes newline-terminated JSON values", () => {
		let output = "";

		writeJson({ write: (chunk) => (output += chunk) }, { ok: true });

		expect(output).toBe('{\n  "ok": true\n}\n');
	});

	test("writes facade JSON envelopes with correlation and duration", () => {
		let output = "";

		writeJsonEnvelope(
			{ write: (chunk) => (output += chunk) },
			{ ok: true, duration_ms: undefined },
			{ runId: "run-test-1", durationMs: 42 },
		);

		expect(JSON.parse(output)).toEqual({
			run_id: "run-test-1",
			duration_ms: 42,
			ok: true,
		});
	});

	test("preserves arrays and primitive JSON values outside facade envelopes", () => {
		let arrayOutput = "";
		let primitiveOutput = "";

		writeJsonEnvelope({ write: (chunk) => (arrayOutput += chunk) }, ["ok"], {
			runId: "run-test-1",
			durationMs: 42,
		});
		writeJsonEnvelope({ write: (chunk) => (primitiveOutput += chunk) }, true, {
			runId: "run-test-1",
			durationMs: 42,
		});

		expect(JSON.parse(arrayOutput)).toEqual(["ok"]);
		expect(JSON.parse(primitiveOutput)).toBe(true);
	});

	test("rejects facade envelope run-id and duration conflicts", () => {
		expect(() =>
			writeJsonEnvelope(
				{ write: () => undefined },
				{ run_id: "domain-run" },
				{ runId: "cli-run", durationMs: 1 },
			),
		).toThrow(CliWriterContractError);
		expect(() =>
			writeJsonEnvelope(
				{ write: () => undefined },
				{ duration_ms: 12 },
				{ runId: "cli-run", durationMs: 1 },
			),
		).toThrow(CliWriterContractError);
		expect(() =>
			writeJsonEnvelope(
				{ write: () => undefined },
				{ duration_ms: null },
				{ runId: "cli-run", durationMs: 1 },
			),
		).toThrow(CliWriterContractError);
	});
});
