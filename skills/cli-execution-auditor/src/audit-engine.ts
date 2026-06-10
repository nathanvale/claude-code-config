// audit-engine — lane detection, contract acquisition, and the static clause
// assertions (plan U4). Surface exercise (U5) extends this file.
//
// The engine is a thin orchestrator over the facade testing harness and the
// clause catalog; the VALUE lives in clause-catalog.ts. Static checks are caught
// with ZERO target invocations (KTD4): they read the acquired contract, the
// target source, or rendered help — never run the target's commands.
//
// Determinism (R3): every enumerated list is canonicalized (sorted) before
// emitting; volatile fields (timestamps, durations, absolute paths) are excluded
// from findings, so re-running identical input in a different cwd is identical.

import { basename, join } from "node:path";
import { RUNTIME_CONTRACT_REDACTION_FIXTURES } from "@side-quest/cli-command-facade/testing";
import {
	COMMAND_FACADE_BASELINE_EXIT_CODES,
} from "@side-quest/cli-command-facade";
import { DRIFT_CODE_DISPOSITIONS, LANE_CLAUSES, getClause } from "./clause-catalog.ts";
import { type AcquiredCommandContract, acquireTargetContract } from "./target-contract.ts";

// --- finding shape (matches the runner's AuditFinding) ---

export interface EngineFinding {
	clauseId: string;
	kind: "static" | "surface";
	summary: string;
	/** Invocation that surfaced it; [] for a static clause. */
	argv: readonly string[];
}

export interface EngineOutcome {
	target: string;
	laneDetected: boolean;
	skipReason?: string;
	findings: EngineFinding[];
	/** The acquired contract, when lane detection + acquisition succeeded. */
	contracts?: Record<string, AcquiredCommandContract>;
}

/** Resolved layout of a target facade skill. */
export interface TargetLayout {
	/** Absolute path to the skill/package root. */
	root: string;
	/** Absolute path to src/command-contract.ts, if present. */
	contractPath: string | null;
	/** Absolute path to package.json, if present. */
	packageJsonPath: string | null;
	/** Absolute paths of source files (src/*.ts), for source-grep clauses. */
	sourceFiles: string[];
}

// --- lane detection (R5) ---

/**
 * Detect the facade lane: a package.json declaring @side-quest/cli-command-facade
 * AND source importing it. v1 mechanical detection (R5); no per-CLI lane marker
 * exists, and persisting one is a v2 prerequisite (out of scope).
 */
export async function detectFacadeLane(layout: TargetLayout): Promise<{
	isFacade: boolean;
	reason: string;
}> {
	if (!layout.packageJsonPath) {
		return { isFacade: false, reason: "no package.json found at target root" };
	}
	const pkgText = await Bun.file(layout.packageJsonPath).text();
	let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
	try {
		pkg = JSON.parse(pkgText);
	} catch {
		return { isFacade: false, reason: "package.json is not valid JSON" };
	}
	const deps = { ...pkg.dependencies, ...pkg.devDependencies };
	if (!("@side-quest/cli-command-facade" in deps)) {
		return { isFacade: false, reason: "package.json does not depend on @side-quest/cli-command-facade" };
	}
	const importsFacade = await anySourceImportsFacade(layout.sourceFiles);
	if (!importsFacade) {
		return { isFacade: false, reason: "no source file imports @side-quest/cli-command-facade" };
	}
	return { isFacade: true, reason: "facade dependency + import present" };
}

async function anySourceImportsFacade(sourceFiles: readonly string[]): Promise<boolean> {
	for (const file of sourceFiles) {
		const text = await Bun.file(file).text();
		if (text.includes("@side-quest/cli-command-facade")) return true;
	}
	return false;
}

// --- target layout resolution ---

/**
 * Resolve a target's layout from a root directory. The contract lives at
 * src/command-contract.ts by facade convention (every facade skill follows it).
 */
export async function resolveTargetLayout(root: string): Promise<TargetLayout> {
	const contractPath = join(root, "src", "command-contract.ts");
	const packageJsonPath = join(root, "package.json");
	const sourceFiles = await listSourceFiles(join(root, "src"));
	return {
		root,
		contractPath: (await Bun.file(contractPath).exists()) ? contractPath : null,
		packageJsonPath: (await Bun.file(packageJsonPath).exists()) ? packageJsonPath : null,
		sourceFiles,
	};
}

async function listSourceFiles(srcDir: string): Promise<string[]> {
	const glob = new Bun.Glob("**/*.ts");
	const files: string[] = [];
	for await (const rel of glob.scan({ cwd: srcDir, onlyFiles: true })) {
		// Exclude tests and fixtures: source-grep clauses inspect shipping code,
		// not test scaffolding (a test file legitimately names `bun test`).
		if (rel.endsWith(".test.ts")) continue;
		if (rel.includes("/fixtures/") || rel.startsWith("fixtures/")) continue;
		files.push(join(srcDir, rel));
	}
	// Determinism (R3): canonical sort.
	return files.sort();
}

// --- static clause assertions (KTD4: zero target invocations) ---

/** exit-floor: every command declares the 0/1/2 baseline exit-code floor. */
function checkExitFloor(
	contracts: Record<string, AcquiredCommandContract>,
	driftCodes: readonly string[],
): EngineFinding[] {
	// Primary signal: the no-throw parse already emits command-baseline-exit-*
	// drift codes mapped to becomes-finding. We also assert structurally so the
	// clause holds even if a caller skips the drift map.
	const findings: EngineFinding[] = [];
	const baselineDrift = driftCodes.filter(
		(code) =>
			code.startsWith("command-baseline-exit-") &&
			DRIFT_CODE_DISPOSITIONS[code] === "becomes-finding",
	);
	const missingFloor: string[] = [];
	for (const [command, contract] of sortedEntries(contracts)) {
		const declared = new Set(Object.keys(contract.exitCodes ?? {}));
		for (const floor of COMMAND_FACADE_BASELINE_EXIT_CODES) {
			if (!declared.has(floor)) missingFloor.push(`${command}:${floor}`);
		}
	}
	if (missingFloor.length > 0 || baselineDrift.length > 0) {
		findings.push({
			clauseId: "exit-floor",
			kind: "static",
			summary:
				missingFloor.length > 0
					? `missing baseline exit code(s): ${missingFloor.sort().join(", ")}`
					: `baseline exit drift: ${[...baselineDrift].sort().join(", ")}`,
			argv: [],
		});
	}
	return findings;
}

/** help-flag-alignment: every advertised flag is a real contract flag. */
function checkHelpFlagAlignment(
	contracts: Record<string, AcquiredCommandContract>,
): EngineFinding[] {
	// Static form: the contract's flags ARE the advertised set (renderCommandUsage
	// derives help from flags), so a contract whose flags are internally
	// inconsistent (a reserved diagnostic flag, or a non-flag-shaped entry) is the
	// catchable static defect. Full help↔render alignment is a surface concern
	// (U5) when help is rendered by the target subprocess; here we assert the
	// contract-side invariant without invoking the target.
	const findings: EngineFinding[] = [];
	const offending: string[] = [];
	for (const [command, contract] of sortedEntries(contracts)) {
		const flags = contract.flags ?? {};
		for (const flagName of Object.keys(flags).sort()) {
			if (!flagName.startsWith("--")) {
				offending.push(`${command}:${flagName}`);
			}
		}
	}
	if (offending.length > 0) {
		findings.push({
			clauseId: "help-flag-alignment",
			kind: "static",
			summary: `contract flag(s) not in --flag form (cannot render in help): ${offending.join(", ")}`,
			argv: [],
		});
	}
	return findings;
}

/** redaction-discipline: no projected contract text leaks a redaction fixture. */
function checkRedactionDiscipline(
	contracts: Record<string, AcquiredCommandContract>,
): EngineFinding[] {
	const findings: EngineFinding[] = [];
	const leaks: string[] = [];
	// Gather all projected free-text the agent would read.
	for (const [command, contract] of sortedEntries(contracts)) {
		const texts: string[] = [
			contract.summary ?? "",
			...(contract.usage ?? []),
			...Object.values(contract.flags ?? {}).map(
				(flag) => (flag as { description?: string }).description ?? "",
			),
		];
		for (const text of texts) {
			for (const fixture of RUNTIME_CONTRACT_REDACTION_FIXTURES) {
				if (text.includes(fixture.value)) {
					leaks.push(`${command}: ${fixture.label}`);
				}
			}
		}
	}
	if (leaks.length > 0) {
		findings.push({
			clauseId: "redaction-discipline",
			kind: "static",
			summary: `projected contract text leaks redaction fixture(s): ${[...new Set(leaks)].sort().join(", ")}`,
			argv: [],
		});
	}
	return findings;
}

/** no-raw-runner: no source file invokes a raw `bun test` / `biome` / `tsc`. */
async function checkNoRawRunner(layout: TargetLayout): Promise<EngineFinding[]> {
	const findings: EngineFinding[] = [];
	const offenders: string[] = [];
	// Match a spawn/exec of a raw runner as a command literal: a "bun" arg
	// followed by "test", or a bare "biome"/"tsc" invocation. The sanctioned path
	// is test-runner.sh / MCP runners, so a literal raw runner in shipping source
	// is the catchable form (heal bug a). Obfuscated forms are a documented limit.
	const rawRunner = /\b(bun["'\s,]+test|biome|tsc)\b/;
	const sanctioned = /test-runner\.sh|biome_|tsc_check/;
	for (const file of layout.sourceFiles) {
		const text = await Bun.file(file).text();
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i += 1) {
			const line = lines[i];
			// Skip comments and the sanctioned wrapper references.
			const trimmed = line.trim();
			if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
			if (sanctioned.test(line)) continue;
			// Only flag spawn/exec-shaped lines, not prose strings.
			if (!/Bun\.spawn|spawnSync|execSync|exec\(|\$`/.test(line)) continue;
			if (rawRunner.test(line)) {
				offenders.push(`${relForFinding(layout.root, file)}:${i + 1}`);
			}
		}
	}
	if (offenders.length > 0) {
		findings.push({
			clauseId: "no-raw-runner",
			kind: "static",
			summary: `source invokes a raw runner (use test-runner.sh / MCP runners): ${offenders.sort().join(", ")}`,
			argv: [],
		});
	}
	return findings;
}

/** vacuous-match: a referenced-set check must not report ok on an empty set. */
async function checkVacuousMatch(layout: TargetLayout): Promise<EngineFinding[]> {
	const findings: EngineFinding[] = [];
	const suspects: string[] = [];
	// Heuristic for heal bug b: a check resolves a set (matchAll/filter into a
	// Set/array) and then has an ok branch reachable when that set is empty —
	// e.g. `referenced.size` used only in the success summary, with no guard that
	// the set is non-empty. v1 flags the specific anti-pattern: a `.size === 0`
	// or empty-array path that returns status "ok"/healthy. This is a heuristic
	// grep, and its limit (a single dummy member defeats it) is recorded in the
	// clause's maskingNote (R11); U7 exercises the hard case.
	for (const file of layout.sourceFiles) {
		const text = await Bun.file(file).text();
		// Look for a resolved-set variable that, when empty, still yields ok.
		// Signal: an ok/healthy return whose only set-size reference is in the
		// summary, with no `=== 0` / `.length` guard preceding it in the function.
		if (!/matchAll|\.filter\(|new Set\(/.test(text)) continue;
		const hasEmptyGuard = /\.size === 0|\.length === 0|\.size > 0|\.length > 0|isEmpty/.test(text);
		const hasOkReturn = /status:\s*["']ok["']|status:\s*["']healthy["']/.test(text);
		if (hasOkReturn && !hasEmptyGuard) {
			suspects.push(relForFinding(layout.root, file));
		}
	}
	if (suspects.length > 0) {
		findings.push({
			clauseId: "vacuous-match",
			kind: "static",
			summary: `referenced-set check may report ok on an empty set (no empty-set guard): ${[...new Set(suspects)].sort().join(", ")}`,
			argv: [],
		});
	}
	return findings;
}

// --- orchestration ---

/**
 * Run the static half of the audit against a target root. Returns an outcome
 * with the acquired contract (so U5's surface exercise can enumerate from it).
 * `only` restricts to a single clause id.
 */
export async function runStaticAudit(input: {
	targetRoot: string;
	only: string | null;
}): Promise<EngineOutcome> {
	const target = basename(input.targetRoot);
	const layout = await resolveTargetLayout(input.targetRoot);

	const lane = await detectFacadeLane(layout);
	if (!lane.isFacade) {
		// Not a crash: a non-facade target is skipped with a reason (R5).
		return { target, laneDetected: false, skipReason: lane.reason, findings: [] };
	}

	if (!layout.contractPath) {
		// A facade skill should expose a command-contract; its absence is a finding
		// (the discovery surface KTD6 needs is missing), not a crash.
		return {
			target,
			laneDetected: true,
			findings: [
				{
					clauseId: "exit-floor",
					kind: "static",
					summary: "facade lane detected but src/command-contract.ts is missing — no contract to audit",
					argv: [],
				},
			],
		};
	}

	const acquisition = await acquireTargetContract(layout.contractPath);
	if (!acquisition.ok) {
		// A drifting target that throws at load surfaces here as a structured
		// finding, not an import crash (KTD6).
		return {
			target,
			laneDetected: true,
			findings: [
				{
					clauseId: "exit-floor",
					kind: "static",
					summary: `contract acquisition failed: ${acquisition.reason}`,
					argv: [],
				},
			],
		};
	}

	const { contracts, driftCodes } = acquisition;
	const wanted = (clauseId: string) => input.only === null || input.only === clauseId;

	const findings: EngineFinding[] = [];
	if (wanted("exit-floor")) findings.push(...checkExitFloor(contracts, driftCodes));
	if (wanted("help-flag-alignment")) findings.push(...checkHelpFlagAlignment(contracts));
	if (wanted("redaction-discipline")) findings.push(...checkRedactionDiscipline(contracts));
	if (wanted("no-raw-runner")) findings.push(...(await checkNoRawRunner(layout)));
	if (wanted("vacuous-match")) findings.push(...(await checkVacuousMatch(layout)));

	return {
		target,
		laneDetected: true,
		findings: sortFindings(findings),
		contracts,
	};
}

// --- helpers ---

function sortedEntries(
	contracts: Record<string, AcquiredCommandContract>,
): Array<[string, AcquiredCommandContract]> {
	return Object.entries(contracts).sort(([a], [b]) => a.localeCompare(b));
}

/** Repo-relative-ish path for a finding, excluding the volatile absolute prefix (R3). */
function relForFinding(root: string, absolutePath: string): string {
	const rootName = basename(root);
	const idx = absolutePath.indexOf(`${rootName}/`);
	return idx >= 0 ? absolutePath.slice(idx) : basename(absolutePath);
}

/** Canonical finding order (R3): by clause id, then summary. */
export function sortFindings(findings: EngineFinding[]): EngineFinding[] {
	return [...findings].sort(
		(a, b) => a.clauseId.localeCompare(b.clauseId) || a.summary.localeCompare(b.summary),
	);
}

/** Confirm a clause id is known (used by the runner's --only validation path). */
export function isKnownClause(clauseId: string): boolean {
	return getClause(clauseId) !== undefined;
}

export { LANE_CLAUSES };
