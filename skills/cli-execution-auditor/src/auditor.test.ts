import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CLI_DIAGNOSTIC_FLAGS,
	parseCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";
import {
	AUDITOR_CONTRACT_ID,
	AUDITOR_SCHEMA_VERSION,
	AUDITOR_STATION_MAP_CONTRACT_ID,
	auditorContracts,
} from "./command-contract";
import { type AuditorRuntime, createDefaultAuditorRuntime, runForTest } from "./auditor";

// biome-ignore lint/suspicious/noExplicitAny: JSON envelope tests assert package-owned fields.
function parseEnvelope(result: { stdout: string }): any {
	return JSON.parse(result.stdout);
}

// A no-op runtime for argv-surface tests: the default runtime now runs the real
// engine on disk, so tests that only exercise argv parsing inject a stub `audit`
// to avoid touching the filesystem. Engine-behavior tests pass their own `audit`.
function stubRuntime(overrides: Partial<AuditorRuntime>): AuditorRuntime {
	return createDefaultAuditorRuntime({
		audit: async ({ target }) => ({ target, laneDetected: true, findings: [] }),
		stationMap: async ({ target }) => ({
			target,
			laneDetected: true,
			catalogDetected: true,
			findings: [],
		}),
		...overrides,
	});
}

// --- drift surface 1: contract parse (no drift) ---

describe("auditor command contract", () => {
	test("declares valid facade contracts for audit and station-map", () => {
		const parsed = parseCommandFacadeContract(auditorContracts, {
			path: "skills/cli-execution-auditor/src/command-contract.ts",
			writeImplyingMutations: new Set(["write", "destructive"]),
		});

		expect(parsed.ok).toBe(true);
		expect(auditorContracts.audit.resultContract?.id).toBe(AUDITOR_CONTRACT_ID);
		expect(auditorContracts["station-map"].resultContract?.id).toBe(
			AUDITOR_STATION_MAP_CONTRACT_ID,
		);
		expect(AUDITOR_SCHEMA_VERSION).toBe("2");
		expect(auditorContracts.audit.resultContract?.schema_version).toBe(AUDITOR_SCHEMA_VERSION);
		expect(auditorContracts["station-map"].resultContract?.schema_version).toBe(
			AUDITOR_SCHEMA_VERSION,
		);
		expect(auditorContracts.audit.flags).toHaveProperty("--only");
		expect(auditorContracts.audit.flags).toHaveProperty("--ledger");
		expect(auditorContracts["station-map"].flags).toHaveProperty("--ledger");
		expect(auditorContracts["station-map"].flags).not.toHaveProperty("--only");
		for (const flag of CLI_DIAGNOSTIC_FLAGS) {
			expect(auditorContracts.audit.flags).not.toHaveProperty(flag);
			expect(auditorContracts["station-map"].flags).not.toHaveProperty(flag);
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
		assertCommandHelpFlagSurface({
			command: "station-map",
			contract: auditorContracts["station-map"],
			help: help.stdout,
		});
	});

	test("version names the source API break release", async () => {
		const version = await runForTest(["--version"]);
		expect(version.exitCode).toBe(0);
		expect(version.stdout).toBe("auditor 0.2.0\n");
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

	test("rejects empty inline flag values", async () => {
		const only = await runForTest(["some-target", "--only="], stubRuntime({}));
		expect(only.exitCode).toBe(2);
		expect(only.stderr).toContain("--only requires a value");

		const ledger = await runForTest(["some-target", "--ledger="], stubRuntime({}));
		expect(ledger.exitCode).toBe(2);
		expect(ledger.stderr).toContain("--ledger requires a value");
	});

	test("accepts a bare target (audit is the default command)", async () => {
		const result = await runForTest(["some-target"], stubRuntime({}));
		expect(result.exitCode).toBe(0);
	});

	test("accepts the explicit audit command form", async () => {
		const result = await runForTest(["audit", "some-target"], stubRuntime({}));
		expect(result.exitCode).toBe(0);
	});

	test("rejects invalid station-map flags with a structured usage error", async () => {
		const result = await runForTest(
			["station-map", "some-target", "--only", "exit-floor", "--json"],
			stubRuntime({}),
		);
		expect(result.exitCode).toBe(2);
		const envelope = parseEnvelope(result);
		expect(envelope.error.code).toBe("usage_error");
		expect(envelope.error.message).toContain("unknown option: --only");
	});

	test("accepts the explicit station-map command form", async () => {
		const result = await runForTest(["station-map", "some-target"], stubRuntime({}));
		expect(result.exitCode).toBe(0);
	});
});

// --- drift surface 4: envelope shape + injected-runtime behavior ---

describe("auditor runtime (injected)", () => {
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

	test("a non-facade target is skipped (plain), exit 0", async () => {
		const result = await runForTest(
			["some-target"],
			stubRuntime({
				audit: async ({ target }) => ({
					target,
					laneDetected: false,
					skipReason: "package.json does not depend on @side-quest/cli-command-facade",
					findings: [],
				}),
			}),
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("does not depend on");
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

	test("station-map clean target exits 0 with Declared Branch Coverage envelope", async () => {
		const result = await runForTest(
			["station-map", "some-target", "--json"],
			stubRuntime({
				stationMap: async ({ target }) => ({
					target,
					laneDetected: true,
					catalogDetected: true,
					stationMap: {
						completeness_claim: "declared_branch_coverage",
						commands: {},
						stations: [],
						drift: [],
						findings: [],
					},
					findings: [],
				}),
			}),
		);
		expect(result.exitCode).toBe(0);
		const envelope = parseEnvelope(result);
		expect(envelope.status).toBe("ok");
		expect(envelope.data.report_kind).toBe("station-map");
		expect(envelope.data.completeness_claim).toBe("declared_branch_coverage");
	});

	test("station-map findings exit 1 with station finding data", async () => {
		const result = await runForTest(
			["station-map", "some-target", "--json"],
			stubRuntime({
				stationMap: async ({ target }) => ({
					target,
					laneDetected: true,
					catalogDetected: true,
					findings: [
						{
							kind: "station",
							frontDoor: "root",
							stationId: "check.success",
							command: "check",
							findingKind: "missing",
							summary: "check.success is missing for declared_branch_coverage.",
						},
					],
				}),
			}),
		);
		expect(result.exitCode).toBe(1);
		const envelope = parseEnvelope(result);
		expect(envelope.status).toBe("error");
		expect(envelope.error.code).toBe("findings_present");
		expect(envelope.data.action).toBe("station_findings_present");
		expect(envelope.data.findings[0].stationId).toBe("check.success");
	});

	test("station-map no-catalog target is informational, exit 0", async () => {
		const result = await runForTest(
			["station-map", "some-target"],
			stubRuntime({
				stationMap: async ({ target }) => ({
					target,
					laneDetected: true,
					catalogDetected: false,
					skipReason: "no Branch Station Catalog found at src/branch-station-catalog.ts",
					findings: [],
				}),
			}),
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("no Branch Station Catalog");
	});
});

// --- U8: end-to-end with the real engine + ledger ---

describe("auditor end-to-end (real engine + ledger)", () => {
	const FIXTURES = join(import.meta.dir, "fixtures");
	const tempLedgers: string[] = [];
	const generatedFixtureDocs: string[] = [];
	function tempLedger(): string {
		const path = join(mkdtempSync(join(tmpdir(), "auditor-ledger-")), "audit.md");
		tempLedgers.push(path);
		return path;
	}
	function fixtureTargetForDefaultLedger(fixtureName: string): string {
		const target = join(FIXTURES, fixtureName);
		const docsPath = join(target, "docs");
		rmSync(docsPath, { recursive: true, force: true });
		generatedFixtureDocs.push(docsPath);
		return target;
	}
	afterAll(() => {
		for (const path of tempLedgers) rmSync(join(path, ".."), { recursive: true, force: true });
		for (const path of generatedFixtureDocs) rmSync(path, { recursive: true, force: true });
	});

	test("audit good-baseline → exit 0, quiet success, no findings", async () => {
		const ledger = tempLedger();
		const result = await runForTest([join(FIXTURES, "good-baseline"), "--ledger", ledger]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("lane contract clean");
	});

	test("audit a bad fixture → exit 1, findings in --json, ledger written with an open finding", async () => {
		const ledger = tempLedger();
		const result = await runForTest([
			join(FIXTURES, "bad-exit-floor"),
			"--ledger",
			ledger,
			"--json",
		]);
		expect(result.exitCode).toBe(1);
		const envelope = parseEnvelope(result);
		expect(envelope.status).toBe("error");
		expect(envelope.error.code).toBe("findings_present");
		expect(envelope.data.findings.length).toBeGreaterThan(0);
		// The ledger artifact exists and records the open finding.
		const ledgerText = await Bun.file(ledger).text();
		expect(ledgerText).toContain("## Open Findings");
		expect(ledgerText).toContain("exit-floor");
		expect(ledgerText).toContain("status: open");
	});

	test("re-running audit on the same target dedupes (no duplicate ledger rows)", async () => {
		const ledger = tempLedger();
		await runForTest([join(FIXTURES, "bad-exit-floor"), "--ledger", ledger, "--json"]);
		await runForTest([join(FIXTURES, "bad-exit-floor"), "--ledger", ledger, "--json"]);
		const ledgerText = await Bun.file(ledger).text();
		// The exit-floor finding header appears exactly once (deduped by signature).
		const matches = ledgerText.match(/\*\*exit-floor\*\*/g) ?? [];
		expect(matches).toHaveLength(1);
	});

	test("the engine resolves the target path the same whether bare or via audit", async () => {
		const ledger = tempLedger();
		const bare = await runForTest([join(FIXTURES, "good-baseline"), "--ledger", ledger]);
		const explicit = await runForTest(["audit", join(FIXTURES, "good-baseline"), "--ledger", ledger]);
		expect(bare.exitCode).toBe(explicit.exitCode);
	});

	test("audit default ledgers are partitioned per front door", async () => {
		const target = fixtureTargetForDefaultLedger("good-front-door-local");
		const result = await runForTest([target, "--json"]);

		expect(result.exitCode).toBe(0);
		const envelope = parseEnvelope(result);
		expect(envelope.data.ledger_path).toBeUndefined();
		expect(envelope.data.ledger_paths.map((path: string) => path.replace(`${target}/`, ""))).toEqual([
			"docs/cli-audits/good-front-door-local/admin/audit.md",
			"docs/cli-audits/good-front-door-local/app/audit.md",
		]);
		const adminLedger = await Bun.file(join(target, "docs/cli-audits/good-front-door-local/admin/audit.md")).text();
		const appLedger = await Bun.file(join(target, "docs/cli-audits/good-front-door-local/app/audit.md")).text();
		expect(adminLedger).toContain("target_cli: good-front-door-local/admin");
		expect(appLedger).toContain("target_cli: good-front-door-local/app");
	});

	test("station-map covered fixture exits 0 and writes a clean ledger", async () => {
		const ledger = tempLedger();
		const result = await runForTest([
			"station-map",
			join(FIXTURES, "good-station-map-covered"),
			"--ledger",
			ledger,
			"--json",
		]);
		expect(result.exitCode).toBe(0);
		const envelope = parseEnvelope(result);
		expect(envelope.data.completeness_claim).toBe("declared_branch_coverage");
		expect(envelope.data.station_map.stations.map((station: { station_id: string }) => station.station_id)).toEqual([
			"check.alpha",
			"check.zeta",
		]);
		const ledgerText = await Bun.file(ledger).text();
		expect(ledgerText).toContain("## Open Findings");
		expect(ledgerText).toContain("- None yet.");
	});

	test("station-map missing fixture exits 1 and stores station findings in the ledger", async () => {
		const ledger = tempLedger();
		const result = await runForTest([
			"station-map",
			join(FIXTURES, "bad-station-map-missing"),
			"--ledger",
			ledger,
			"--json",
		]);
		expect(result.exitCode).toBe(1);
		const envelope = parseEnvelope(result);
		expect(envelope.data.findings[0].stationId).toBe("check.success");
		const ledgerText = await Bun.file(ledger).text();
		expect(ledgerText).toContain("**station-map** (station)");
		expect(ledgerText).toContain("recheck: station=check.success command=check finding=missing");
	});

	test("station-map default ledgers are partitioned per front door", async () => {
		const target = fixtureTargetForDefaultLedger("good-front-door-local");
		const result = await runForTest(["station-map", target, "--json"]);

		expect(result.exitCode).toBe(0);
		const envelope = parseEnvelope(result);
		expect(envelope.data.ledger_path).toBeUndefined();
		expect(envelope.data.ledger_paths.map((path: string) => path.replace(`${target}/`, ""))).toEqual([
			"docs/cli-audits/good-front-door-local/admin/audit.md",
			"docs/cli-audits/good-front-door-local/app/audit.md",
		]);
		const adminLedger = await Bun.file(join(target, "docs/cli-audits/good-front-door-local/admin/audit.md")).text();
		const appLedger = await Bun.file(join(target, "docs/cli-audits/good-front-door-local/app/audit.md")).text();
		expect(adminLedger).toContain("target_cli: good-front-door-local/admin");
		expect(appLedger).toContain("target_cli: good-front-door-local/app");
	});
});

// --- U8: SKILL.md frontmatter contract ---

describe("SKILL.md", () => {
	test("frontmatter YAML-parses and description is quoted", async () => {
		const skillMd = await Bun.file(join(import.meta.dir, "..", "SKILL.md")).text();
		const frontmatter = skillMd.match(/^---\n([\s\S]*?)\n---/);
		expect(frontmatter).not.toBeNull();
		const body = frontmatter?.[1] ?? "";
		expect(body).toContain("name: cli-execution-auditor");
		// description value is double-quoted (AGENTS.md skill-authoring rule).
		expect(body).toMatch(/description:\s*"/);
	});
});
