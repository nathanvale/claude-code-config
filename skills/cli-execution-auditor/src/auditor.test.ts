import { describe, expect, test } from "bun:test";
import {
	CLI_DIAGNOSTIC_FLAGS,
	parseCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";
import {
	AUDITOR_CONTRACT_ID,
	AUDITOR_SCHEMA_VERSION,
	auditorContracts,
} from "./command-contract";
import { type AuditorRuntime, createDefaultAuditorRuntime, runForTest } from "./auditor";

// biome-ignore lint/suspicious/noExplicitAny: JSON envelope tests assert package-owned fields.
function parseEnvelope(result: { stdout: string }): any {
	return JSON.parse(result.stdout);
}

function stubRuntime(overrides: Partial<AuditorRuntime>): AuditorRuntime {
	return createDefaultAuditorRuntime(overrides);
}

// --- drift surface 1: contract parse (no drift) ---

describe("auditor command contract", () => {
	test("declares a valid facade contract for the audit command", () => {
		const parsed = parseCommandFacadeContract(auditorContracts, {
			path: "skills/cli-execution-auditor/src/command-contract.ts",
			writeImplyingMutations: new Set(["write", "destructive"]),
		});

		expect(parsed.ok).toBe(true);
		expect(auditorContracts.audit.resultContract?.id).toBe(AUDITOR_CONTRACT_ID);
		expect(auditorContracts.audit.resultContract?.schema_version).toBe(AUDITOR_SCHEMA_VERSION);
		expect(auditorContracts.audit.flags).toHaveProperty("--only");
		expect(auditorContracts.audit.flags).toHaveProperty("--ledger");
		for (const flag of CLI_DIAGNOSTIC_FLAGS) {
			expect(auditorContracts.audit.flags).not.toHaveProperty(flag);
		}
	});

	// --- drift surface 2: help renders the contract's advertised flags ---

	test("help renders advertised flags from the contract", async () => {
		const help = await runForTest(["help"]);
		expect(help.exitCode).toBe(0);
		assertCommandHelpFlagSurface({
			command: "audit",
			contract: auditorContracts.audit,
			help: help.stdout,
		});
	});
});

// --- drift surface 3: argv accept/reject ---

describe("auditor argv surface", () => {
	test("rejects a missing target with a usage exit code", async () => {
		const result = await runForTest(["--json"], stubRuntime({}));
		expect(result.exitCode).toBe(2);
		const envelope = parseEnvelope(result);
		expect(envelope.error.code).toBe("usage_error");
		expect(envelope.error.message).toContain("requires a target");
	});

	test("rejects an unknown option with a usage exit code", async () => {
		const result = await runForTest(["some-target", "--bogus"], stubRuntime({}));
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("unknown option");
	});

	test("rejects an invalid --only clause id", async () => {
		const result = await runForTest(["some-target", "--only", "nonsense"], stubRuntime({}));
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("--only must be one of");
	});

	test("accepts a bare target (audit is the default command)", async () => {
		const result = await runForTest(["some-target"], stubRuntime({}));
		expect(result.exitCode).toBe(0);
	});

	test("accepts the explicit audit command form", async () => {
		const result = await runForTest(["audit", "some-target"], stubRuntime({}));
		expect(result.exitCode).toBe(0);
	});
});

// --- drift surface 4: envelope shape + stub behavior ---

describe("auditor runtime (U3 stub)", () => {
	test("a clean target exits 0 with a success envelope", async () => {
		const result = await runForTest(
			["some-target", "--json", "--run-id", "audit-clean"],
			stubRuntime({
				audit: async ({ target }) => ({ target, laneDetected: true, findings: [] }),
			}),
		);
		expect(result.exitCode).toBe(0);
		const envelope = parseEnvelope(result);
		expect(envelope.status).toBe("ok");
		expect(envelope.run_id).toBe("audit-clean");
		expect(envelope.data.action).toBe("target_clean");
	});

	test("findings exit 1 with an error envelope", async () => {
		const result = await runForTest(
			["some-target", "--json"],
			stubRuntime({
				audit: async ({ target }) => ({
					target,
					laneDetected: true,
					findings: [
						{
							clauseId: "exit-floor",
							kind: "static",
							summary: "contract omits exit code 2",
							argv: [],
						},
					],
				}),
			}),
		);
		expect(result.exitCode).toBe(1);
		const envelope = parseEnvelope(result);
		expect(envelope.status).toBe("error");
		expect(envelope.error.code).toBe("findings_present");
		expect(envelope.data.findings).toHaveLength(1);
	});

	test("the default stub reports no checks yet (skip), exit 0", async () => {
		const result = await runForTest(["some-target"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("no checks yet");
	});

	test("plain clean output prints the clean banner", async () => {
		const result = await runForTest(
			["some-target"],
			stubRuntime({
				audit: async ({ target }) => ({ target, laneDetected: true, findings: [] }),
			}),
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("lane contract clean");
	});
});
