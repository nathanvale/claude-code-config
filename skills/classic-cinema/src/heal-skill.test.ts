import { describe, expect, test } from "bun:test";
import {
	CLI_DIAGNOSTIC_FLAGS,
	parseCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";
import {
	HEAL_SKILL_CONTRACT_ID,
	HEAL_SKILL_SCHEMA_VERSION,
	healSkillContracts,
} from "./command-contract";
import type { Finding, RepairResult } from "./heal-engine";
import {
	createDefaultHealSkillRuntime,
	type HealSkillRuntime,
	runForTest,
} from "./heal-skill";

// biome-ignore lint/suspicious/noExplicitAny: JSON envelope tests assert package-owned fields.
function parseEnvelope(result: { stdout: string }): any {
	return JSON.parse(result.stdout);
}

function healthyFinding(checkId: string): Finding {
	return {
		checkId,
		status: "ok",
		summary: `${checkId} ok`,
		autoRepairable: false,
		nextAction: "none",
	};
}

const ALL_OK: Finding[] = [
	"scripts-help",
	"tests",
	"template-frozen",
	"booking-log-valid",
	"productivity-yml",
	"owner-paths",
].map(healthyFinding);

function stubRuntime(overrides: Partial<HealSkillRuntime>): HealSkillRuntime {
	return createDefaultHealSkillRuntime({
		runChecks: async () => ALL_OK,
		repairBookingLog: async (): Promise<RepairResult> => ({
			checkId: "booking-log-valid",
			applied: false,
			summary: "already clean",
		}),
		...overrides,
	});
}

// --- drift surface 1: contract parse (no drift) ---

describe("heal-skill command contract", () => {
	test("declares facade contract for check, repair, and explain", () => {
		const parsed = parseCommandFacadeContract(healSkillContracts, {
			path: "skills/classic-cinema/src/command-contract.ts",
			writeImplyingMutations: new Set(["write", "destructive"]),
		});

		expect(parsed.ok).toBe(true);
		expect(healSkillContracts.check.resultContract?.id).toBe(HEAL_SKILL_CONTRACT_ID);
		expect(healSkillContracts.check.resultContract?.schema_version).toBe(
			HEAL_SKILL_SCHEMA_VERSION,
		);
		expect(healSkillContracts.check.flags).toHaveProperty("--only");
		expect(healSkillContracts.check.flags).not.toHaveProperty("--execute");
		expect(healSkillContracts.repair.flags).toHaveProperty("--execute");
		expect(healSkillContracts.explain.flags).not.toHaveProperty("--only");
		for (const contract of Object.values(healSkillContracts)) {
			for (const flag of CLI_DIAGNOSTIC_FLAGS) {
				expect(contract.flags).not.toHaveProperty(flag);
			}
		}
	});

	// --- drift surface 2: help renders the contract's advertised flags ---

	test("help renders advertised flags from the contract", async () => {
		const checkHelp = await runForTest(["help", "check"]);
		const repairHelp = await runForTest(["help", "repair"]);
		const explainHelp = await runForTest(["help", "explain"]);

		expect(checkHelp.exitCode).toBe(0);
		assertCommandHelpFlagSurface({
			command: "check",
			contract: healSkillContracts.check,
			help: checkHelp.stdout,
			absentFlags: ["--execute", "--no-input"],
		});
		assertCommandHelpFlagSurface({
			command: "repair",
			contract: healSkillContracts.repair,
			help: repairHelp.stdout,
		});
		assertCommandHelpFlagSurface({
			command: "explain",
			contract: healSkillContracts.explain,
			help: explainHelp.stdout,
			absentFlags: ["--only", "--execute", "--no-input"],
		});
	});
});

// --- drift surface 3: argv accept/reject ---

describe("heal-skill argv surface", () => {
	test("rejects unknown command with usage exit code", async () => {
		const result = await runForTest(["frobnicate"], stubRuntime({}));
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("unknown command");
	});

	test("rejects an invalid --only check id", async () => {
		const result = await runForTest(["check", "--only", "nonsense"], stubRuntime({}));
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("--only must be one of");
	});

	test("rejects --execute on the read-only check command", async () => {
		const result = await runForTest(["check", "--execute"], stubRuntime({}));
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("check does not accept --execute");
	});

	test("rejects --only on explain", async () => {
		const result = await runForTest(
			["explain", "tests", "--only", "tests"],
			stubRuntime({}),
		);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("explain does not accept --only");
	});

	test("explain without a check id is a usage error", async () => {
		const result = await runForTest(["explain"], stubRuntime({}));
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("explain requires a check id");
	});

	test("JSON usage error emits a structured envelope", async () => {
		const result = await runForTest(["check", "--bogus", "--json"], stubRuntime({}));
		expect(result.exitCode).toBe(2);
		const envelope = parseEnvelope(result);
		expect(envelope.status).toBe("error");
		expect(envelope.error.code).toBe("usage_error");
	});
});

// --- drift surface 4: envelope shape + behavior ---

describe("heal-skill runtime", () => {
	test("healthy check exits 0 with a success envelope", async () => {
		const result = await runForTest(
			["check", "--json", "--run-id", "heal-healthy"],
			stubRuntime({}),
		);
		expect(result.exitCode).toBe(0);
		const envelope = parseEnvelope(result);
		expect(envelope.status).toBe("ok");
		expect(envelope.run_id).toBe("heal-healthy");
		expect(envelope.data.action).toBe("skill_healthy");
		expect(envelope.data.findings).toHaveLength(ALL_OK.length);
	});

	test("plain healthy check prints the healthy banner", async () => {
		const result = await runForTest(["check"], stubRuntime({}));
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("classic-cinema healthy");
	});

	test("findings exit 1 with an error envelope", async () => {
		const findings: Finding[] = [
			...ALL_OK.filter((f) => f.checkId !== "scripts-help"),
			{
				checkId: "scripts-help",
				status: "handoff",
				summary: "1 command failed --help",
				autoRepairable: false,
				nextAction: "human: fix the failing command source",
			},
		];
		const result = await runForTest(
			["check", "--json"],
			stubRuntime({ runChecks: async () => findings }),
		);
		expect(result.exitCode).toBe(1);
		const envelope = parseEnvelope(result);
		expect(envelope.status).toBe("error");
		expect(envelope.error.code).toBe("findings_present");
		expect(envelope.data.findings).toHaveLength(findings.length);
	});

	test("repair previews by default and reports applied work under --execute", async () => {
		const brokenLog: Finding = {
			checkId: "booking-log-valid",
			status: "finding",
			summary: "1 malformed line",
			autoRepairable: true,
			nextAction: "heal-skill repair --only booking-log-valid --execute",
		};
		const findings: Finding[] = [
			...ALL_OK.filter((f) => f.checkId !== "booking-log-valid"),
			brokenLog,
		];
		const calls: boolean[] = [];
		const runtime = stubRuntime({
			runChecks: async () => findings,
			repairBookingLog: async (execute): Promise<RepairResult> => {
				calls.push(execute);
				return {
					checkId: "booking-log-valid",
					applied: execute,
					summary: execute ? "repaired: kept 2, dropped 1" : "preview: would drop 1",
				};
			},
		});

		const preview = await runForTest(["repair", "--json"], runtime);
		expect(calls.at(-1)).toBe(false);
		const previewEnvelope = parseEnvelope(preview);
		expect(previewEnvelope.data.mode).toBe("preview");

		const applied = await runForTest(["repair", "--execute", "--json"], runtime);
		expect(calls.at(-1)).toBe(true);
		expect(applied.exitCode).toBe(0);
		const appliedEnvelope = parseEnvelope(applied);
		expect(appliedEnvelope.status).toBe("ok");
		expect(appliedEnvelope.data.action).toBe("repaired");
	});

	test("explain returns the stored explanation", async () => {
		const result = await runForTest(["explain", "booking-log-valid", "--json"], stubRuntime({}));
		expect(result.exitCode).toBe(0);
		const envelope = parseEnvelope(result);
		expect(envelope.data.explanation.checkId).toBe("booking-log-valid");
		expect(envelope.data.explanation.explanation).toContain("auto-repair");
	});
});
