import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	detectFacadeLane,
	discoverCommandContractPaths,
	enumerateInvocations,
	resolveScriptEntryFile,
	resolveTargetLayout,
	runFullAudit,
	runStaticAudit,
	runSurfaceAudit,
	sortFindings,
} from "./audit-engine";
import { acquireTargetContract, findContractByShape } from "./target-contract";

const HEAL_SKILL_ROOT = join(import.meta.dir, "..", "..", "classic-cinema");
const FIXTURES = join(import.meta.dir, "fixtures");
const fixture = (name: string) => join(FIXTURES, name);

// --- lane detection (R5) ---

describe("lane detection", () => {
	test("a facade target (dep + import) detects as facade lane", async () => {
		const layout = await resolveTargetLayout(HEAL_SKILL_ROOT);
		const lane = await detectFacadeLane(layout);
		expect(lane.isFacade).toBe(true);
	});

	test("the good-baseline fixture detects as facade lane", async () => {
		const layout = await resolveTargetLayout(fixture("good-baseline"));
		const lane = await detectFacadeLane(layout);
		expect(lane.isFacade).toBe(true);
	});
});

describe("command contract locator", () => {
	test("discovers the package-level command contract", async () => {
		const contractPaths = await discoverCommandContractPaths(fixture("good-baseline"));
		expect(contractPaths.map((path) => path.replace(fixture("good-baseline"), ""))).toEqual([
			"/src/command-contract.ts",
		]);
	});

	test("discovers CLI Front Door command contracts in canonical order", async () => {
		const contractPaths = await discoverCommandContractPaths(fixture("good-front-door-local"));
		expect(
			contractPaths.map((path) => path.replace(fixture("good-front-door-local"), "")),
		).toEqual([
			"/src/front-doors/admin/command-contract.ts",
			"/src/front-doors/app/command-contract.ts",
		]);
		const layout = await resolveTargetLayout(fixture("good-front-door-local"));
		expect(layout.contractPath).toBe(contractPaths[0]);
		expect(layout.contractPaths).toEqual(contractPaths);
	});

	test("discovers grouped (depth-2) front-door contracts, not just depth-1", async () => {
		// A single-segment glob silently skips src/front-doors/admin/users/command-contract.ts
		// and reports that surface unaudited (adversarial finding C).
		const contractPaths = await discoverCommandContractPaths(fixture("good-front-door-nested"));
		expect(
			contractPaths.map((path) => path.replace(fixture("good-front-door-nested"), "")),
		).toEqual(["/src/front-doors/admin/users/command-contract.ts"]);
	});
});

// --- contract acquisition (KTD6) ---

describe("contract acquisition (KTD6)", () => {
	test("acquires a clean contract from a target without importing its module here", async () => {
		const layout = await resolveTargetLayout(HEAL_SKILL_ROOT);
		const acquisition = await acquireTargetContract(layout.contractPath as string);
		expect(acquisition.ok).toBe(true);
		if (acquisition.ok) {
			expect(Object.keys(acquisition.contracts).sort()).toEqual(["check", "explain", "repair"]);
			expect(acquisition.driftCodes).toEqual([]);
		}
	});

	test("a drifting target's drift surfaces as parse data, not an import crash", async () => {
		// bad-exit-floor exports the raw contract object (no throwing builder), so
		// its missing-baseline defect surfaces as no-throw parse drift (KTD6).
		const layout = await resolveTargetLayout(fixture("bad-exit-floor"));
		const acquisition = await acquireTargetContract(layout.contractPath as string);
		expect(acquisition.ok).toBe(true);
		if (acquisition.ok) {
			expect(acquisition.driftCodes).toContain("command-baseline-exit-usage-missing");
		}
	});

	test("front-door-local contracts keep per-front-door command surfaces", async () => {
		const outcome = await runStaticAudit({
			targetRoot: fixture("good-front-door-local"),
			only: null,
		});
		expect(outcome.findings).toEqual([]);
		expect(Object.keys(outcome.contracts ?? {}).sort()).toEqual(["admin", "app"]);
		expect(
			outcome.contractSurfaces?.map((surface) => ({
				frontDoor: surface.frontDoor,
				commands: Object.keys(surface.contracts).sort(),
			})),
		).toEqual([
			{ frontDoor: "admin", commands: ["admin"] },
			{ frontDoor: "app", commands: ["app"] },
		]);
	});

	test("same command name is allowed across separate front doors", async () => {
		const outcome = await runStaticAudit({
			targetRoot: fixture("bad-front-door-duplicate-command"),
			only: null,
		});
		expect(outcome.findings).toEqual([]);
		expect(
			outcome.contractSurfaces?.map((surface) => ({
				frontDoor: surface.frontDoor,
				commands: Object.keys(surface.contracts).sort(),
			})),
		).toEqual([
			{ frontDoor: "admin", commands: ["check"] },
			{ frontDoor: "app", commands: ["check"] },
		]);
	});

	test("findContractByShape finds the contract export by shape, not by name", () => {
		const result = findContractByShape({
			somethingElse: { foo: 1 },
			weirdlyNamedExport: {
				check: { script: "x", summary: "y", flags: {}, exitCodes: { "0": "a" } },
			},
		});
		expect(result.kind).toBe("found");
		if (result.kind !== "found") throw new Error("expected a single shape match");
		expect(Object.keys(result.contracts)).toEqual(["check"]);
	});

	test("findContractByShape reports ambiguity when a decoy shadows the real contract", () => {
		// A decoy export declared before the real contract must NOT silently win:
		// returning the first match would exercise the wrong object (adversarial E).
		const result = findContractByShape({
			decoyFirst: {
				demo: { script: "d", summary: "s", flags: {}, exitCodes: { "0": "a" } },
			},
			realContracts: {
				run: { script: "r", summary: "s", flags: {}, exitCodes: { "0": "a" } },
			},
		});
		expect(result.kind).toBe("ambiguous");
		if (result.kind === "ambiguous") expect(result.count).toBe(2);
	});

	test("findContractByShape reports none when no export is contract-shaped", () => {
		const result = findContractByShape({ notAContract: { foo: 1 }, alsoNot: 42 });
		expect(result.kind).toBe("none");
	});
});

// --- static audit: clean target ---

describe("static audit — clean target", () => {
	test("live heal-skill is clean (zero findings) — the spine works end to end", async () => {
		const outcome = await runStaticAudit({ targetRoot: HEAL_SKILL_ROOT, only: null });
		expect(outcome.laneDetected).toBe(true);
		expect(outcome.findings).toEqual([]);
	});

	test("good-baseline produces zero findings", async () => {
		const outcome = await runStaticAudit({ targetRoot: fixture("good-baseline"), only: null });
		expect(outcome.laneDetected).toBe(true);
		expect(outcome.findings).toEqual([]);
	});

	test("front-door-local contracts produce zero static findings", async () => {
		const outcome = await runStaticAudit({
			targetRoot: fixture("good-front-door-local"),
			only: null,
		});
		expect(outcome.laneDetected).toBe(true);
		expect(outcome.findings).toEqual([]);
	});
});

// --- static audit: each check fires on its defect (KTD4: zero invocations) ---

describe("static audit — each clause fires", () => {
	test("exit-floor flags a contract missing exit code 2", async () => {
		const outcome = await runStaticAudit({ targetRoot: fixture("bad-exit-floor"), only: "exit-floor" });
		expect(outcome.findings.map((f) => f.clauseId)).toContain("exit-floor");
	});

	test("redaction-discipline flags a planted secret in a flag description", async () => {
		const outcome = await runStaticAudit({
			targetRoot: fixture("bad-redaction-leak"),
			only: "redaction-discipline",
		});
		expect(outcome.findings.map((f) => f.clauseId)).toContain("redaction-discipline");
	});

	test("no-raw-runner flags a source spawning raw `bun test`", async () => {
		const outcome = await runStaticAudit({ targetRoot: fixture("bad-raw-runner"), only: "no-raw-runner" });
		const finding = outcome.findings.find((f) => f.clauseId === "no-raw-runner");
		expect(finding).toBeDefined();
		expect(finding?.summary).toContain("checks.ts");
	});

	test("vacuous-match flags a referenced-set check with no empty-set guard", async () => {
		const outcome = await runStaticAudit({
			targetRoot: fixture("bad-vacuous-match"),
			only: "vacuous-match",
		});
		expect(outcome.findings.map((f) => f.clauseId)).toContain("vacuous-match");
	});

	test("--only restricts the audit to a single clause", async () => {
		// bad-exit-floor only trips exit-floor; restricting to a different clause
		// yields nothing, proving --only is honored.
		const outcome = await runStaticAudit({ targetRoot: fixture("bad-exit-floor"), only: "no-raw-runner" });
		expect(outcome.findings).toEqual([]);
	});
});

// --- KTD4: static findings caught with zero target invocations ---

describe("static checks are zero-invocation (KTD4)", () => {
	test("each static finding carries an empty argv (no invocation)", async () => {
		const outcome = await runStaticAudit({ targetRoot: fixture("bad-exit-floor"), only: null });
		expect(outcome.findings.length).toBeGreaterThan(0);
		for (const finding of outcome.findings) {
			expect(finding.kind).toBe("static");
			expect(finding.argv).toEqual([]);
		}
	});

	test("a finding fires even with no runnable command entrypoint (inspection, not run)", async () => {
		// bad-exit-floor has only a contract module — no auditor.ts / runnable
		// command. A finding here can only come from zero-invocation inspection.
		const outcome = await runStaticAudit({ targetRoot: fixture("bad-exit-floor"), only: "exit-floor" });
		expect(outcome.findings.map((f) => f.clauseId)).toContain("exit-floor");
	});
});

// --- determinism (R3) ---

describe("determinism (R3)", () => {
	test("Covers R3. Re-running identical input in a different cwd produces identical findings", async () => {
		const target = fixture("bad-exit-floor");
		const originalCwd = process.cwd();
		const first = await runStaticAudit({ targetRoot: target, only: null });
		process.chdir(tmpdir());
		try {
			const second = await runStaticAudit({ targetRoot: target, only: null });
			expect(second.findings).toEqual(first.findings);
		} finally {
			process.chdir(originalCwd);
		}
	});

	test("sortFindings is a stable canonical order", () => {
		const sorted = sortFindings([
			{ clauseId: "vacuous-match", kind: "static", summary: "z", argv: [] },
			{ clauseId: "exit-floor", kind: "static", summary: "b", argv: [] },
			{ clauseId: "exit-floor", kind: "static", summary: "a", argv: [] },
		]);
		expect(sorted.map((f) => `${f.clauseId}:${f.summary}`)).toEqual([
			"exit-floor:a",
			"exit-floor:b",
			"vacuous-match:z",
		]);
	});
});

// --- surface exercise: enumeration (U5, R2) ---

describe("surface enumeration", () => {
	test("Covers R2. enumeration source is the contract, in canonical sort order", async () => {
		const acquisition = await acquireTargetContract(
			join(HEAL_SKILL_ROOT, "src", "command-contract.ts"),
		);
		expect(acquisition.ok).toBe(true);
		if (!acquisition.ok) return;
		const invocations = enumerateInvocations(acquisition.contracts);
		// One bare-command case per command + one per advertised flag, per-command.
		const labels = invocations.map((i) => i.argv.join(" "));
		// Canonical: commands sorted, flags sorted within command.
		expect(labels).toEqual([...labels].sort());
		// Bare commands present.
		expect(labels).toContain("check");
		expect(labels).toContain("repair");
		expect(labels).toContain("explain");
		// A boolean flag is passed bare; a value flag gets a probe value.
		expect(labels).toContain("check --json");
		expect(labels).toContain("check --only __audit_probe__");
	});

	test("enumeration is per-command, not a global cross-product (OQ4)", async () => {
		const acquisition = await acquireTargetContract(
			join(HEAL_SKILL_ROOT, "src", "command-contract.ts"),
		);
		if (!acquisition.ok) return;
		const invocations = enumerateInvocations(acquisition.contracts);
		// explain has no --execute flag, so no `explain --execute` case exists.
		const labels = invocations.map((i) => i.argv.join(" "));
		expect(labels).not.toContain("explain --execute");
	});

	test("empty enumeration throws, never a silent pass (mirrors runCommandSurfaceCases)", async () => {
		await expect(
			runSurfaceAudit({
				layout: await resolveTargetLayout(HEAL_SKILL_ROOT),
				contracts: {},
				only: null,
			}),
		).rejects.toThrow("zero enumerable invocations");
	});
});

// --- surface exercise: each clause fires (U5, KTD4) ---

describe("surface audit — each clause fires", () => {
	test("live heal-skill is clean across every enumerated invocation", async () => {
		const outcome = await runFullAudit({ targetRoot: HEAL_SKILL_ROOT, only: null });
		expect(outcome.findings).toEqual([]);
	});

	test("good-baseline is clean under the full audit", async () => {
		const outcome = await runFullAudit({ targetRoot: fixture("good-baseline"), only: null });
		expect(outcome.findings).toEqual([]);
	});

	test("front-door-local contracts are clean under the full audit", async () => {
		const outcome = await runFullAudit({
			targetRoot: fixture("good-front-door-local"),
			only: null,
		});
		expect(outcome.laneDetected).toBe(true);
		expect(outcome.findings).toEqual([]);
	});

	test("shared command names across front doors are clean under the full audit", async () => {
		const outcome = await runFullAudit({
			targetRoot: fixture("good-front-door-shared-command"),
			only: null,
		});
		expect(outcome.laneDetected).toBe(true);
		expect(outcome.findings).toEqual([]);
	});

	test("a facade CLI with a .sh entrypoint is exercised, not false-flagged", async () => {
		// good-sh-entrypoint fronts its facade CLI with a shell script (like the real
		// test-runner: "test-runner": "./src/test-runner.sh"). A .ts-only resolver
		// would report a spurious json-valid finding; the runnable resolver must run
		// the .sh directly and find nothing (R-risk2: no false positives on real CLIs).
		const outcome = await runFullAudit({ targetRoot: fixture("good-sh-entrypoint"), only: null });
		expect(outcome.laneDetected).toBe(true);
		expect(outcome.findings).toEqual([]);
	});

	test("an unresolved per-command script produces a finding", async () => {
		// Acquire a real, fully-projected contract so enumeration runs; override only
		// the script so it resolves to no runnable entrypoint. A synthetic contract
		// would be missing projection fields (usage, audience, ...) and throw on spread.
		const root = fixture("good-front-door-local");
		const acquisition = await acquireTargetContract(
			join(root, "src", "front-doors", "app", "command-contract.ts"),
		);
		if (!acquisition.ok) throw new Error("fixture app contract should acquire");
		const contracts = {
			app: { ...acquisition.contracts.app, script: "missing" },
		} as typeof acquisition.contracts;
		const findings = await runSurfaceAudit({
			layout: await resolveTargetLayout(root),
			contracts,
			only: null,
		});
		// The unresolved script fires once per enumerated invocation (bare + each flag),
		// under runnable-resolves — NOT json-valid-under-failure (that clause is about
		// the --json envelope; mis-attributing here corrupts per-clause reporting).
		// The message names the precise cause: "missing" is undeclared in package.json.
		expect(findings.length).toBeGreaterThan(0);
		expect(
			findings.every(
				(f) =>
					f.clauseId === "runnable-resolves" &&
					f.summary.includes("script missing is not declared in package.json scripts"),
			),
		).toBe(true);
	});

	test("a declared script with a missing entrypoint names the missing file", async () => {
		const root = await mkdtemp(join(tmpdir(), "cli-audit-missing-entrypoint-"));
		await mkdir(join(root, "src"));
		await Bun.write(
			join(root, "package.json"),
			JSON.stringify({ scripts: { app: "bun run src/missing.ts" } }),
		);
		const acquisition = await acquireTargetContract(
			join(fixture("good-front-door-local"), "src", "front-doors", "app", "command-contract.ts"),
		);
		if (!acquisition.ok) throw new Error("fixture app contract should acquire");
		const contracts = {
			app: { ...acquisition.contracts.app, script: "app" },
		} as typeof acquisition.contracts;
		const findings = await runSurfaceAudit({
			layout: await resolveTargetLayout(root),
			contracts,
			only: null,
		});

		expect(findings.length).toBeGreaterThan(0);
		expect(
			findings.every(
				(f) =>
					f.clauseId === "runnable-resolves" &&
					f.summary.includes("script app points to a missing entrypoint file"),
			),
		).toBe(true);
	});

	test("script-resolution findings respect --only (no clause leak)", async () => {
		// With only:"declared-coverage-runs", an unresolved script must NOT leak a
		// runnable-resolves finding — the gate sits before the push (finding B).
		const root = fixture("good-front-door-local");
		const acquisition = await acquireTargetContract(
			join(root, "src", "front-doors", "app", "command-contract.ts"),
		);
		if (!acquisition.ok) throw new Error("fixture app contract should acquire");
		const contracts = {
			app: { ...acquisition.contracts.app, script: "missing" },
		} as typeof acquisition.contracts;
		const findings = await runSurfaceAudit({
			layout: await resolveTargetLayout(root),
			contracts,
			only: "declared-coverage-runs",
		});
		expect(findings.map((f) => f.clauseId)).not.toContain("runnable-resolves");
	});

	test("an uncovered front door (script but no contract) fires runnable-resolves", async () => {
		// bad-front-door-uncovered ships src/front-doors/legacy/legacy.ts via a
		// package.json script with NO command-contract.ts beside it. Without
		// reconciliation the auditor reports clean while legacy goes unaudited
		// (adversarial finding A: silent coverage drop).
		const outcome = await runFullAudit({
			targetRoot: fixture("bad-front-door-uncovered"),
			only: null,
		});
		expect(outcome.laneDetected).toBe(true);
		const finding = outcome.findings.find(
			(f) => f.clauseId === "runnable-resolves" && f.summary.includes("legacy"),
		);
		expect(finding).toBeDefined();
		expect(finding?.summary).toContain("goes unaudited");
		expect(finding?.frontDoor).toBe("legacy");
	});

	test("a broken --json failure envelope fires json-valid-under-failure", async () => {
		const outcome = await runFullAudit({
			targetRoot: fixture("bad-envelope-on-failure"),
			only: "json-valid-under-failure",
		});
		const finding = outcome.findings.find((f) => f.clauseId === "json-valid-under-failure");
		expect(finding).toBeDefined();
		expect(finding?.kind).toBe("surface");
		expect(finding?.argv.length).toBeGreaterThan(0);
	});

	test("a partial-coverage check fires declared-coverage-runs (heal bug c shape)", async () => {
		const outcome = await runFullAudit({
			targetRoot: fixture("bad-partial-coverage"),
			only: "declared-coverage-runs",
		});
		const finding = outcome.findings.find((f) => f.clauseId === "declared-coverage-runs");
		expect(finding).toBeDefined();
		expect(finding?.kind).toBe("surface");
		expect(finding?.summary).toContain("ran 1 of 4");
	});

	// Exit-code findings are owned by exit-code-matches-declared, NOT
	// json-valid-under-failure: the two clauses read the same failing invocation
	// but are gated independently, so `--only` on one never suppresses the other.
	test("exit-code findings carry the exit-code-matches-declared clauseId, not json-valid-under-failure", async () => {
		const outcome = await runFullAudit({
			targetRoot: fixture("bad-envelope-on-failure"),
			only: "json-valid-under-failure",
		});
		// The envelope is broken (json-valid fires); the exit code 1 IS declared, so
		// no exit-code finding is expected. Crucially, no exit-code drift is ever
		// misattributed to the json-valid clause.
		expect(outcome.findings.map((f) => f.clauseId)).toContain("json-valid-under-failure");
		const exitMisattributed = outcome.findings.find(
			(f) =>
				f.clauseId === "json-valid-under-failure" &&
				f.summary.includes("is not declared in the contract"),
		);
		expect(exitMisattributed).toBeUndefined();
	});

	test("--only on exit-code-matches-declared does not surface json-valid-under-failure findings", async () => {
		const outcome = await runFullAudit({
			targetRoot: fixture("bad-envelope-on-failure"),
			only: "exit-code-matches-declared",
		});
		expect(outcome.findings.map((f) => f.clauseId)).not.toContain("json-valid-under-failure");
	});
});

// --- script entry resolution (adversarial finding D) ---

describe("resolveScriptEntryFile — only resolves a simple, single entrypoint", () => {
	const root = "/repo";

	test("resolves a plain `bun run <file>`", () => {
		expect(resolveScriptEntryFile(root, "bun run src/app.ts")).toBe("/repo/src/app.ts");
	});

	test("resolves a direct `./path/file.sh`", () => {
		expect(resolveScriptEntryFile(root, "./src/test-runner.sh")).toBe("/repo/src/test-runner.sh");
	});

	test("keeps the entrypoint when trailing args/flags follow", () => {
		expect(resolveScriptEntryFile(root, "bun run src/app.ts --json")).toBe("/repo/src/app.ts");
	});

	test("rejects a chained `a.ts && b.ts` (would half-audit the wrong binary)", () => {
		expect(resolveScriptEntryFile(root, "bun run a.ts && bun run b.ts")).toBeNull();
	});

	test("rejects a `cd foo && …` prefix (resolves against the wrong root)", () => {
		expect(resolveScriptEntryFile(root, "cd foo && bun run x.ts")).toBeNull();
	});

	test("rejects a decoy `echo build.sh && …` (would exec the decoy, not the real CLI)", () => {
		expect(resolveScriptEntryFile(root, "echo build.sh && bun run real.ts")).toBeNull();
	});

	test("rejects a piped or subshell script", () => {
		expect(resolveScriptEntryFile(root, "bun run a.ts | tee log")).toBeNull();
		expect(resolveScriptEntryFile(root, "bun run $(which x).ts")).toBeNull();
	});

	test("rejects entrypoint paths that escape the audited root", () => {
		expect(resolveScriptEntryFile(root, "bun run ../outside.ts")).toBeNull();
		expect(resolveScriptEntryFile(root, "./../outside.sh")).toBeNull();
	});
});

// --- surface exercise: KTD4 behavioral invariant ---

describe("surface findings are invocation-required (KTD4)", () => {
	test("a surface finding carries the invocation argv that surfaced it", async () => {
		const outcome = await runFullAudit({
			targetRoot: fixture("bad-envelope-on-failure"),
			only: "json-valid-under-failure",
		});
		const finding = outcome.findings.find((f) => f.clauseId === "json-valid-under-failure");
		// Behavioral: the finding names a concrete invocation (e.g. `check --json`),
		// which is what distinguishes surface from static (static argv is []).
		expect(finding?.argv).toContain("--json");
	});

	test("the surface finding disappears when surface checks are not run (static-only)", async () => {
		// runStaticAudit never exercises invocations; the bad-envelope defect is
		// behavioral, so the static half alone produces no json-valid finding.
		const staticOnly = await runStaticAudit({
			targetRoot: fixture("bad-envelope-on-failure"),
			only: null,
		});
		expect(staticOnly.findings.map((f) => f.clauseId)).not.toContain("json-valid-under-failure");
	});
});

// --- surface determinism (R3) ---

describe("surface determinism (R3)", () => {
	test("Covers R3. Surface path run twice in different cwds produces identical findings", async () => {
		const target = fixture("bad-partial-coverage");
		const originalCwd = process.cwd();
		const first = await runFullAudit({ targetRoot: target, only: null });
		process.chdir(tmpdir());
		try {
			const second = await runFullAudit({ targetRoot: target, only: null });
			expect(second.findings).toEqual(first.findings);
		} finally {
			process.chdir(originalCwd);
		}
	});
});
