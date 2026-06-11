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
import { existsSync } from "node:fs";
import {
	COMMAND_FACADE_BASELINE_EXIT_CODES,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";
import { RUNTIME_CONTRACT_REDACTION_FIXTURES } from "@side-quest/cli-command-facade/testing";
import { DRIFT_CODE_DISPOSITIONS } from "./clause-catalog.ts";
import {
	type AcquiredCommandContract,
	acquireTargetContract,
	type ContractAcquisition,
} from "./target-contract.ts";

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
	/** Absolute path to the first discovered command-contract.ts, if present. */
	contractPath: string | null;
	/** Absolute paths to package-level and CLI Front Door command contracts. */
	contractPaths: string[];
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

async function acquireTargetContracts(
	contractPaths: readonly string[],
	root: string,
): Promise<ContractAcquisition> {
	const contracts: Record<string, AcquiredCommandContract> = {};
	const driftCodes: string[] = [];
	// Track which contract file declared each command so a collision can name BOTH
	// files, not just the command — the repair hint needs to point at the two files.
	const commandSource: Record<string, string> = {};
	const rel = (path: string) => (path.startsWith(root) ? path.slice(root.length + 1) : path);
	for (const contractPath of contractPaths) {
		const acquisition = await acquireTargetContract(contractPath);
		if (!acquisition.ok) {
			// Name the offending file: a hard load-throw otherwise loses which of N
			// discovered contracts drifted, leaving no repair target.
			return { ...acquisition, reason: `${rel(contractPath)}: ${acquisition.reason}` };
		}
		for (const [command, contract] of Object.entries(acquisition.contracts)) {
			if (contracts[command]) {
				return {
					ok: false,
					reason: `duplicate command contract for ${command}: declared in both ${commandSource[command]} and ${rel(contractPath)}`,
				};
			}
			contracts[command] = contract;
			commandSource[command] = rel(contractPath);
		}
		driftCodes.push(...acquisition.driftCodes);
	}
	return { ok: true, contracts, driftCodes };
}

// --- target layout resolution ---

/** Discover package-level and CLI Front Door command contract modules. */
export async function discoverCommandContractPaths(root: string): Promise<string[]> {
	const srcDir = join(root, "src");
	const contractPaths: string[] = [];
	const packageContractPath = join(srcDir, "command-contract.ts");
	if (await Bun.file(packageContractPath).exists()) {
		contractPaths.push(packageContractPath);
	}
	const frontDoorContractPaths: string[] = [];
	const frontDoorsDir = join(srcDir, "front-doors");
	if (existsSync(frontDoorsDir)) {
		// Depth-N: grouped front doors (front-doors/admin/users/command-contract.ts)
		// must be discovered, not just depth-1 dirs. A single-segment glob silently
		// skips nested contracts and reports their surface unaudited (R4 coverage).
		const glob = new Bun.Glob("**/command-contract.ts");
		for await (const rel of glob.scan({ cwd: frontDoorsDir, onlyFiles: true })) {
			frontDoorContractPaths.push(join(frontDoorsDir, rel));
		}
	}
	return [...contractPaths, ...frontDoorContractPaths.sort()];
}

/** Resolve a target's layout from a root directory. */
export async function resolveTargetLayout(root: string): Promise<TargetLayout> {
	const contractPaths = await discoverCommandContractPaths(root);
	const packageJsonPath = join(root, "package.json");
	const sourceFiles = await listSourceFiles(join(root, "src"));
	return {
		root,
		contractPath: contractPaths[0] ?? null,
		contractPaths,
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
		// Strip comments first: a guard or anti-pattern mentioned in prose must not
		// satisfy or trip the heuristic (a comment saying "size > 0" is not a real
		// guard). This inspects real code only.
		const text = stripComments(await Bun.file(file).text());
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

	if (layout.contractPaths.length === 0) {
		// A facade skill should expose a command-contract; its absence is a finding
		// (the discovery surface KTD6 needs is missing), not a crash.
		return {
			target,
			laneDetected: true,
			findings: [
				{
					clauseId: "exit-floor",
					kind: "static",
					summary:
						"facade lane detected but no command contract found at src/command-contract.ts or src/front-doors/*/command-contract.ts",
					argv: [],
				},
			],
		};
	}

	const acquisition = await acquireTargetContracts(layout.contractPaths, layout.root);
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

// --- surface exercise (plan U5: enumerate invocations, exercise each) ---

/** One enumerated invocation: a (command, advertised flag) pair. */
export interface EnumeratedInvocation {
	command: string;
	/** The advertised flag this case exercises (or null for the bare command). */
	flag: string | null;
	/** The argv passed to the target (canonical). */
	argv: readonly string[];
}

/**
 * Enumerate invocations from the parsed contract via the discovery projection
 * (R2: the enumeration source is the contract, not a hand-authored list). One
 * case per (command × advertised flag), PER-COMMAND — not a global cross-product
 * (OQ4): the contract already scopes flags per command. Boolean flags are passed
 * bare; value flags get a synthetic probe value. Output is canonically sorted
 * (R3).
 */
export function enumerateInvocations(
	contracts: Record<string, AcquiredCommandContract>,
): EnumeratedInvocation[] {
	const tree = projectCommandDiscoveryTree(
		// biome-ignore lint/suspicious/noExplicitAny: acquired contract is foreign data, validated upstream.
		Object.entries(contracts) as any,
	) as unknown as {
		commands: Record<string, { flags?: Record<string, { type?: string }> }>;
	};

	const invocations: EnumeratedInvocation[] = [];
	for (const command of Object.keys(tree.commands).sort()) {
		// The bare command (no flag) is always one case.
		invocations.push({ command, flag: null, argv: [command] });
		const flags = tree.commands[command].flags ?? {};
		for (const flag of Object.keys(flags).sort()) {
			const type = flags[flag].type;
			const argv =
				type === "boolean"
					? [command, flag]
					: // A synthetic probe value for value-flags; the auditor never needs a
						// real value, only to exercise the flag's accept/reject path.
						[command, flag, "__audit_probe__"];
			invocations.push({ command, flag, argv });
		}
	}
	return invocations;
}

/** The observed result of running one invocation against the target. */
export interface InvocationRun {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/** A resolved runnable: the file plus how to invoke it. */
export interface ResolvedRunnable {
	/** Absolute path to the entrypoint. */
	file: string;
	/** The spawn prefix: ["bun", "run", file] for .ts, [file] for an executable. */
	command: string[];
}

/** Why a script did not resolve to a runnable — each maps to a distinct repair. */
export type RunnableResolution =
	| { ok: true; runnable: ResolvedRunnable }
	| { ok: false; reason: "no-package-json" | "script-undeclared" | "unsupported-shape" | "file-missing" };

/**
 * Resolve the target's runnable entrypoint from the contract `script` field via
 * package.json scripts. Handles both `bun run <file>.ts` entries and direct
 * executable entries (e.g. `./src/test-runner.sh`) — a facade CLI may ship a
 * shell front door. On failure returns a DISTINCT reason per cause so the finding
 * names the real repair (declare the script vs fix the entry file) instead of one
 * conflated "maps to no runnable" message.
 */
async function resolveRunnableScript(
	layout: TargetLayout,
	scriptName: string,
): Promise<RunnableResolution> {
	if (!layout.packageJsonPath) return { ok: false, reason: "no-package-json" };
	const pkg = JSON.parse(await Bun.file(layout.packageJsonPath).text()) as {
		scripts?: Record<string, string>;
	};
	const command = pkg.scripts?.[scriptName];
	if (!command) return { ok: false, reason: "script-undeclared" };
	const file = resolveScriptEntryFile(layout.root, command);
	if (!file) return { ok: false, reason: "unsupported-shape" };
	if (!(await Bun.file(file).exists())) return { ok: false, reason: "file-missing" };
	// .ts/.js run under bun; an executable script (.sh) runs directly.
	const spawnCommand = file.endsWith(".sh") ? [file] : ["bun", "run", file];
	return { ok: true, runnable: { file, command: spawnCommand } };
}

/** Human repair hint for each non-resolution cause. */
function describeUnresolvedScript(scriptName: string, reason: string): string {
	switch (reason) {
		case "no-package-json":
			return `script ${scriptName} cannot resolve: target has no package.json`;
		case "script-undeclared":
			return `script ${scriptName} is not declared in package.json scripts`;
		case "unsupported-shape":
			return `script ${scriptName} has an unsupported shape (compound/piped/prefixed) — declare a simple "bun run <file>" or "./<file>.sh"`;
		default:
			return `script ${scriptName} maps to no runnable entrypoint`;
	}
}

/**
 * Resolve a package.json script VALUE to its single entrypoint file, or null when
 * the shape is unsupported. Only a simple shape is accepted:
 *   - `bun run <file>` (optionally with trailing args/flags), or
 *   - a direct executable `./path/file.sh` (optionally with trailing args).
 *
 * Compound or indirected scripts (`a && b`, `a; b`, `a | b`, `cd x && …`,
 * `ENV=1 bun …`) are REJECTED rather than guessed: grabbing the first file-shaped
 * token from such a value can resolve the WRONG binary (e.g. a decoy `build.sh`
 * before the real `bun run app.ts`), making the auditor exercise a file the
 * contract never named. Returning null yields an honest runnable-resolves finding;
 * the workspace-facade invariant gate constrains script values to this shape.
 */
export function resolveScriptEntryFile(root: string, scriptValue: string): string | null {
	const value = scriptValue.trim();
	// Reject compound / chained / piped / subshell scripts outright.
	if (/[;|]|&&|\|\||\$\(|`/.test(value)) return null;
	// `bun run <file> [args…]` — the entry is the token immediately after `run`.
	const bunRun = value.match(/^bun\s+(?:run\s+)?([\w./-]+\.(?:ts|js|mjs))\b/);
	if (bunRun) return join(root, bunRun[1]);
	// Direct executable: `./path/file.sh [args…]` or `path/file.sh`.
	const direct = value.match(/^\.?\/?([\w./-]+\.sh)\b/);
	if (direct) return join(root, direct[1]);
	return null;
}

/**
 * Front-door coverage reconciliation (runnable-resolves): the audit universe is
 * contract-derived (enumerateInvocations iterates only acquired contracts), so a
 * front-door directory that ships a real CLI but has NO discoverable
 * command-contract.ts is silently excluded — the auditor would report clean while
 * a surface goes unaudited. Reconcile each src/front-doors/<dir> against the
 * discovered contracts: a dir backed by a package.json script (a shippable CLI)
 * but with no contract under it is an uncovered surface.
 */
async function checkFrontDoorCoverage(
	layout: TargetLayout,
	_contracts: Record<string, AcquiredCommandContract>,
): Promise<EngineFinding[]> {
	const frontDoorsDir = join(layout.root, "src", "front-doors");
	if (!existsSync(frontDoorsDir)) return [];

	// Map each front-door dir to whether a discovered contract lives under it.
	const coveredDirs = new Set<string>();
	for (const contractPath of layout.contractPaths) {
		const rel = contractPath.startsWith(frontDoorsDir)
			? contractPath.slice(frontDoorsDir.length + 1)
			: null;
		if (rel) coveredDirs.add(rel.split("/")[0]);
	}

	// A front-door dir is a "shippable surface" when a package.json script resolves
	// into it. Only those are reconciled — a dir without a script is not yet wired
	// as a CLI and is out of scope (the maskingNote records this limit).
	const scripts = layout.packageJsonPath
		? ((
				JSON.parse(await Bun.file(layout.packageJsonPath).text()) as {
					scripts?: Record<string, string>;
				}
			).scripts ?? {})
		: {};
	const scriptedDirs = new Set<string>();
	for (const value of Object.values(scripts)) {
		const file = resolveScriptEntryFile(layout.root, value);
		if (!file) continue;
		const frontDoorPrefix = `${frontDoorsDir}/`;
		if (file.startsWith(frontDoorPrefix)) {
			scriptedDirs.add(file.slice(frontDoorPrefix.length).split("/")[0]);
		}
	}

	const findings: EngineFinding[] = [];
	for (const dir of [...scriptedDirs].sort()) {
		if (!coveredDirs.has(dir)) {
			findings.push({
				clauseId: "runnable-resolves",
				kind: "surface",
				summary: `front-door directory src/front-doors/${dir} ships a package.json script but has no discoverable command-contract.ts — its CLI surface goes unaudited`,
				argv: [],
			});
		}
	}
	return findings;
}

/**
 * Build a subprocess runner for a target. Each invocation is run with pinned
 * cwd/env and captured streams (R3 determinism). The same subprocess discipline
 * as KTD6 acquisition: the universal default.
 */
function createSubprocessRunner(input: {
	runnable: ResolvedRunnable;
	cwd: string;
}): (argv: readonly string[]) => Promise<InvocationRun> {
	return async (argv) => {
		const proc = Bun.spawn([...input.runnable.command, ...argv], {
			cwd: input.cwd,
			stdout: "pipe",
			stderr: "pipe",
			// Pin env to a minimal, stable set so runs are reproducible across cwds.
			env: { ...process.env, NO_COLOR: "1" },
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { exitCode, stdout, stderr };
	};
}

/** json-valid-under-failure: --json on a failure path emits a valid envelope. */
function assertJsonValidUnderFailure(
	invocation: EnumeratedInvocation,
	run: InvocationRun,
): EngineFinding | null {
	// Only meaningful when the run failed (non-zero) and --json was requested.
	const jsonRequested = invocation.argv.includes("--json");
	if (!jsonRequested || run.exitCode === 0) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(run.stdout);
	} catch {
		return {
			clauseId: "json-valid-under-failure",
			kind: "surface",
			summary: `--json failure output is not valid JSON for \`${invocation.argv.join(" ")}\``,
			argv: invocation.argv,
		};
	}
	const env = parsed as { status?: string; run_id?: string; error?: { code?: string } };
	const valid =
		env.status === "error" && typeof env.run_id === "string" && typeof env.error?.code === "string";
	if (!valid) {
		return {
			clauseId: "json-valid-under-failure",
			kind: "surface",
			summary: `--json failure output is not a structured error envelope for \`${invocation.argv.join(" ")}\``,
			argv: invocation.argv,
		};
	}
	return null;
}

/** exit-code-matches-declared: the observed exit code is one the contract declares. */
function assertExitCodeDeclared(
	invocation: EnumeratedInvocation,
	run: InvocationRun,
	declaredExitCodes: ReadonlySet<string>,
): EngineFinding | null {
	if (declaredExitCodes.has(String(run.exitCode))) return null;
	return {
		clauseId: "json-valid-under-failure",
		kind: "surface",
		summary: `exit code ${run.exitCode} is not declared in the contract for \`${invocation.argv.join(" ")}\``,
		argv: invocation.argv,
	};
}

/**
 * declared-coverage-runs (heal bug c): a coverage-style check that declares N
 * targets must exercise all N. The behaviorally-observable surface form: run the
 * check command and inspect its output for a coverage signal (e.g. "ran 1 of N
 * suites"). v1 detects the explicit under-coverage signal a check emits; the
 * limit (a check that narrows its declared list) is recorded in the clause
 * maskingNote (R7). Surface by construction: with no invocation there is no
 * output to inspect, so the finding disappears (KTD4).
 */
function assertDeclaredCoverageRuns(
	invocation: EnumeratedInvocation,
	run: InvocationRun,
): EngineFinding | null {
	// Signal: structured output reporting it ran a strict subset of declared
	// targets. Fixtures emit `coverage: ran X of Y`; a real target would surface
	// the same via its result payload.
	const match = `${run.stdout}\n${run.stderr}`.match(/ran (\d+) of (\d+)/i);
	if (!match) return null;
	const ran = Number(match[1]);
	const declared = Number(match[2]);
	if (ran < declared) {
		return {
			clauseId: "declared-coverage-runs",
			kind: "surface",
			summary: `coverage check ran ${ran} of ${declared} declared targets for \`${invocation.argv.join(" ")}\``,
			argv: invocation.argv,
		};
	}
	return null;
}

/**
 * Run the surface half: enumerate invocations, exercise each against the target,
 * and assert the surface clauses. `only` restricts to a single clause id.
 */
export async function runSurfaceAudit(input: {
	layout: TargetLayout;
	contracts: Record<string, AcquiredCommandContract>;
	only: string | null;
}): Promise<EngineFinding[]> {
	const invocations = enumerateInvocations(input.contracts);
	if (invocations.length === 0) {
		// Mirror runCommandSurfaceCases throw-on-empty: an empty enumeration is a
		// defect, never a silent pass.
		throw new Error("surface audit: zero enumerable invocations (no commands in contract)");
	}

	const wanted = (clauseId: string) => input.only === null || input.only === clauseId;

	const findings: EngineFinding[] = [];
	const runners = new Map<string, (argv: readonly string[]) => Promise<InvocationRun>>();

	// Front-door coverage reconciliation (runnable-resolves): a front-door dir with
	// a package.json script but no discovered contract is an unaudited surface. Run
	// once, not per-invocation, and gate on the owning clause.
	if (wanted("runnable-resolves")) {
		findings.push(...(await checkFrontDoorCoverage(input.layout, input.contracts)));
	}

	for (const invocation of invocations) {
		const contract = input.contracts[invocation.command] as {
			exitCodes?: Record<string, string>;
			script?: string;
		};
		if (!contract?.script) {
			// Script-resolution failures are their own clause (runnable-resolves), not
			// json-valid-under-failure (which is about the --json envelope). Respect --only.
			if (wanted("runnable-resolves")) {
				findings.push({
					clauseId: "runnable-resolves",
					kind: "surface",
					summary: `contract command ${invocation.command} has no script field — cannot resolve a runnable to exercise`,
					argv: invocation.argv,
				});
			}
			continue;
		}
		let runner = runners.get(contract.script);
		if (!runner) {
			const resolution = await resolveRunnableScript(input.layout, contract.script);
			if (!resolution.ok) {
				if (wanted("runnable-resolves")) {
					findings.push({
						clauseId: "runnable-resolves",
						kind: "surface",
						summary: `contract command ${invocation.command} ${describeUnresolvedScript(contract.script, resolution.reason)}`,
						argv: invocation.argv,
					});
				}
				continue;
			}
			runner = createSubprocessRunner({ runnable: resolution.runnable, cwd: input.layout.root });
			runners.set(contract.script, runner);
		}
		const declaredExitCodes = new Set(Object.keys(contract?.exitCodes ?? {}));
		const run = await runner(invocation.argv);

		if (wanted("json-valid-under-failure")) {
			const jsonFinding = assertJsonValidUnderFailure(invocation, run);
			if (jsonFinding) findings.push(jsonFinding);
			const exitFinding = assertExitCodeDeclared(invocation, run, declaredExitCodes);
			if (exitFinding) findings.push(exitFinding);
		}
		if (wanted("declared-coverage-runs")) {
			const coverageFinding = assertDeclaredCoverageRuns(invocation, run);
			if (coverageFinding) findings.push(coverageFinding);
		}
	}
	return findings;
}

/**
 * Run the full audit: static checks (zero invocations) + surface exercise. This
 * is the entry the runner (U8) calls. `only` restricts to a single clause id
 * across both halves.
 */
export async function runFullAudit(input: {
	targetRoot: string;
	only: string | null;
}): Promise<EngineOutcome> {
	const staticOutcome = await runStaticAudit(input);
	// If lane detection failed, acquisition failed, or no contract — the static
	// half already carries the explanatory finding/skip; do not also run surface.
	if (!staticOutcome.laneDetected || !staticOutcome.contracts) {
		return staticOutcome;
	}
	const layout = await resolveTargetLayout(input.targetRoot);
	const surfaceFindings = await runSurfaceAudit({
		layout,
		contracts: staticOutcome.contracts,
		only: input.only,
	});
	return {
		...staticOutcome,
		findings: sortFindings([...staticOutcome.findings, ...surfaceFindings]),
	};
}

// --- helpers ---

function sortedEntries(
	contracts: Record<string, AcquiredCommandContract>,
): Array<[string, AcquiredCommandContract]> {
	return Object.entries(contracts).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Strip line and block comments from TS source so source-grep clauses inspect
 * real code, not prose. A guard or anti-pattern named only in a comment must not
 * satisfy or trip a heuristic. Not a full parser — string literals containing
 * `//` are rare in the patterns these clauses match and tolerated as a v1 limit.
 */
function stripComments(text: string): string {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "") // block comments
		.replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments (avoid :// in urls)
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
