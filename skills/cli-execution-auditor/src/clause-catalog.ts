// clause-catalog — the load-bearing deliverable (plan U9).
//
// The audit engine is a thin wrapper around the facade testing harness; the
// VALUE lives here: the explicit set of lane clauses, each encoded as a typed
// record with the code-owned source it cites (KTD3), the exact assertion, its
// expected outcome, and a masking-resistance note (R7). "Encode lane clauses as
// assertions" (KTD1) is a real spec, not a phrase — this file is that spec.
//
// Every static assertion cites a code-owned constant/validator as its source of
// truth and never re-states a contract in prose (AGENTS.md "don't copy
// contracts"; KTD3). The facade lane = the full @side-quest/cli-command-facade
// contract (R4); its owner is runtime/cli-command-facade/AGENTS.md.

// --- clause taxonomy ---

/**
 * Behavioral classification (KTD4), falsifiable against observable behavior:
 * - "static"  : caught with ZERO target invocations (no runner/subprocess call).
 * - "surface" : caught ONLY by an invocation (removing the invocation makes the
 *               finding disappear, while contract-parse alone does not).
 * Policy when a bug is catchable both ways: prefer static.
 */
export type ClauseKind = "static" | "surface";

/**
 * Where the clause's truth lives. A clause never restates a contract; it points
 * at the code-owned symbol/constant/validator (KTD3) or a named source-grep
 * rule that is the actual authority.
 */
export type ClauseSource =
	| {
			/** A real exported symbol/constant/validator in the facade runtime. */
			kind: "symbol";
			/** Exported name, e.g. "findBaselineExitCodeDrift". */
			name: string;
			/** Repo-relative file that exports it. */
			module: string;
			/** One line on what authority this symbol carries. */
			note: string;
	  }
	| {
			/** A named source-grep rule (no single exported symbol owns it). */
			kind: "source-grep";
			/** Stable rule id, referenced by the engine. */
			rule: string;
			/** One line on what the grep proves. */
			note: string;
	  };

/**
 * Masking-resistance is a property of clause strength, not of re-check
 * provenance (R7). A clause resists masking only when its assertion has no
 * cheaper-to-satisfy form than the real fix. Each clause states whether it is
 * resistant (and why) or names the known cheaper-satisfying form (a v1 limit).
 */
export type MaskingNote =
	| { resistant: true; why: string }
	| { resistant: false; limit: string };

export interface LaneClause {
	/** Stable clause id (also the --only enum value and signature anchor). */
	id: string;
	kind: ClauseKind;
	/** The code-owned source of truth this clause cites (KTD3). */
	source: ClauseSource;
	/** What the clause checks, in one line. */
	assertion: string;
	/** The deterministic outcome derived from the contract (R3). */
	expectedOutcome: string;
	/** Masking-resistance note (R7) — never silently omitted. */
	maskingNote: MaskingNote;
}

// --- the v1 clause set (9), reconciled with the fixture map ---
//
// Clause ↔ fixture ↔ heal-bug map (authoritative source; the Output Structure
// table in the plan mirrors this):
//   exit-floor              static  bad-exit-floor          — (new lane clause, R4)
//   help-flag-alignment     static  bad-help-drift          — (new lane clause, R4)
//   redaction-discipline    static  bad-redaction-leak      — (new lane clause, R4)
//   no-raw-runner           static  bad-raw-runner          heal bug a
//   vacuous-match           static  bad-vacuous-match       heal bug b
//   json-valid-under-failure surface bad-envelope-on-failure — (new lane clause, R4)
//   exit-code-matches-declared surface bad-envelope-on-failure — (co-fires w/ envelope, R4)
//   declared-coverage-runs  surface  bad-partial-coverage   heal bug c
//   runnable-resolves       surface  bad-front-door-uncovered — (front-door coverage, R4)

export const LANE_CLAUSES: readonly LaneClause[] = [
	{
		id: "exit-floor",
		kind: "static",
		source: {
			kind: "symbol",
			name: "COMMAND_FACADE_BASELINE_EXIT_CODES",
			module: "runtime/cli-command-facade/src/command-contract.ts",
			note: "The public 0/1/2 baseline floor constant; parseCommandFacadeContract emits command-baseline-exit-*-missing when a contract omits one. Supersedes older cli-author prose.",
		},
		assertion:
			"Every command's exitCodes declares the baseline floor (0 success, 1 failure, 2 usage).",
		expectedOutcome:
			"A contract missing any baseline exit code yields a finding (one per missing baseline-exit drift code).",
		maskingNote: {
			resistant: true,
			why: "The floor is a structural property of the declared exitCodes map; the only way to satisfy it is to declare 0/1/2, which is the real fix. There is no cheaper non-fix.",
		},
	},
	{
		id: "help-flag-alignment",
		kind: "static",
		source: {
			kind: "symbol",
			name: "assertCommandHelpFlagSurface",
			module: "runtime/cli-command-facade/src/testing.ts",
			note: "Asserts rendered help advertises exactly the contract's declared flags (no drift).",
		},
		assertion:
			"Each command's rendered help advertises every contract flag and no flag the contract omits.",
		expectedOutcome:
			"Help missing an advertised flag (or advertising an absent one) yields a finding for that command.",
		maskingNote: {
			resistant: true,
			why: "Alignment is bidirectional (help⊇flags and help⊆flags via absentFlags); padding help with the missing flag IS documenting it, and removing a flag from the contract is a real contract change — neither is a cheaper non-fix.",
		},
	},
	{
		id: "redaction-discipline",
		kind: "static",
		source: {
			kind: "symbol",
			name: "assertNoRuntimeContractFixtureLeaks",
			module: "runtime/cli-command-facade/src/testing.ts",
			note: "Throws when a value leaks any RUNTIME_CONTRACT_REDACTION_FIXTURES secret marker.",
		},
		assertion:
			"No projected contract text (summaries, flag descriptions, usage) leaks a known redaction fixture.",
		expectedOutcome:
			"A planted secret marker anywhere in the projected contract surface yields a finding.",
		maskingNote: {
			resistant: true,
			why: "The fixture set is the oracle: a leak is present or absent. Removing the secret is the only satisfying change; there is no way to 'pass' while keeping the leak.",
		},
	},
	{
		id: "no-raw-runner",
		kind: "static",
		source: {
			kind: "source-grep",
			rule: "no-raw-test-runner",
			note: "Source must route runners via test-runner.sh / MCP runners, never raw `bun test`, `biome`, or `tsc` (code-quality rule). heal bug a was a raw `bun test` call.",
		},
		assertion:
			"No source file invokes a raw runner (`bun test`, `biome`, `tsc`) directly instead of the sanctioned runner.",
		expectedOutcome:
			"A source spawn/exec of a raw runner yields a finding citing the offending file + line.",
		maskingNote: {
			resistant: false,
			limit: "A grep over spawn/exec call sites can be evaded by indirection (a variable holding the command string, or a shell wrapper that re-expands `bun test`). v1 catches the direct-literal form heal bug a took; obfuscated invocations are a known limit.",
		},
	},
	{
		id: "vacuous-match",
		kind: "static",
		source: {
			kind: "source-grep",
			rule: "no-vacuous-pass-on-empty-set",
			note: "A path-resolving check must not declare ok on an empty referenced set (vacuous pass). heal bug b: owner-paths matched zero paths and reported healthy.",
		},
		assertion:
			"A check that resolves a referenced set (e.g. owner paths) must fail or warn when that set is empty, never report ok on zero matches.",
		expectedOutcome:
			"A check whose ok branch is reachable with an empty resolved set yields a finding.",
		maskingNote: {
			resistant: false,
			limit: "Partially resistant (R11). v1's assertion targets the ANTI-PATTERN — an ok return with no empty-set guard — not merely 'set is non-empty'. So the obvious masking fix (inject one dummy member) does NOT close the finding: U7 proves the clause still fires because the unguarded-ok pattern survives. The residual limit: a fix that adds a MEANINGLESS guard (e.g. `if (set.size > 0) return ok` where the guard does not reflect real resolution) literally satisfies the heuristic without restoring intent. The heuristic is text-pattern, not semantic, so this cheaper-satisfying form remains. U7 records the resistant case and this residual limit rather than claiming a guarantee.",
		},
	},
	{
		id: "json-valid-under-failure",
		kind: "surface",
		source: {
			kind: "symbol",
			name: "createCliRuntimeErrorEnvelope",
			module: "runtime/cli-command-facade/src/runtime-envelope.ts",
			note: "Validates the structured error envelope; --json on a failure path must emit a valid envelope, not a broken/partial object.",
		},
		assertion:
			"Running each invocation with --json on a failure path emits a structurally valid runtime error envelope (status:error, run_id, structured error).",
		expectedOutcome:
			"An invocation whose --json failure output is not a valid envelope yields a surface finding.",
		maskingNote: {
			resistant: true,
			why: "Validity is checked against the envelope schema, not a substring. The only way to pass is to emit a conforming envelope, which is the real fix.",
		},
	},
	{
		id: "exit-code-matches-declared",
		kind: "surface",
		source: {
			kind: "symbol",
			name: "COMMAND_FACADE_BASELINE_EXIT_CODES",
			module: "runtime/cli-command-facade/src/command-contract.ts",
			note: "An invocation's observed exit code must be one the contract's exitCodes map declares; an undeclared code means the runtime contract and behavior have drifted.",
		},
		assertion:
			"Running each invocation produces an exit code the contract's exitCodes map declares.",
		expectedOutcome:
			"An invocation whose observed exit code is not declared in the contract yields a surface finding.",
		maskingNote: {
			resistant: true,
			why: "The declared exitCodes map is the oracle; the only way to pass is for behavior to emit a declared code (fix behavior) or for the contract to declare the code (a real contract change). Neither is a cheaper non-fix.",
		},
	},
	{
		id: "declared-coverage-runs",
		kind: "surface",
		source: {
			kind: "source-grep",
			rule: "coverage-exercises-all-declared",
			note: "A check that declares N targets (suites/commands) must exercise all N, not one. heal bug c: coverage ran a single suite while declaring several.",
		},
		assertion:
			"Running a coverage-style check exercises every target it declares, not a subset.",
		expectedOutcome:
			"A check that declares N targets but invokes fewer yields a surface finding naming the unexercised targets.",
		maskingNote: {
			resistant: false,
			limit: "v1 compares the declared target list against observed invocations; a check that narrows its DECLARED list to match what it actually runs would pass while still under-covering. The assertion binds declaration↔execution, not execution↔intent. Recorded as a limit; tightening requires an intent oracle (deferred branch-coverage instrumentation).",
		},
	},
	{
		id: "runnable-resolves",
		kind: "surface",
		source: {
			kind: "source-grep",
			rule: "front-door-contract-has-runnable",
			note: "Every discovered command resolves a runnable entrypoint, and every front-door directory with a package.json script is covered by a discoverable command-contract.ts. An uncovered front door (missing/nested contract, or a script mapping to no file) means a real CLI surface goes unaudited while the auditor reports clean.",
		},
		assertion:
			"Every command's script resolves to a runnable entrypoint, and no front-door directory ships a package.json script without a discoverable command-contract.ts.",
		expectedOutcome:
			"A command whose script maps to no file, or a front-door directory with a script but no discovered contract, yields a surface finding naming the gap.",
		maskingNote: {
			resistant: false,
			limit: "v1 reconciles front-door directories under src/front-doors against discovered contracts and resolves each command's script via package.json. A front door that ships a CLI WITHOUT a package.json script (invoked some other way) is not reconciled, and resolveRunnableScript only parses simple script values; compound/indirected scripts are a known limit (the workspace-facade invariant gate constrains script shape separately).",
		},
	},
] as const;

/** Clause ids, in catalog order — the --only enum domain and signature anchor. */
export const AUDIT_CLAUSE_IDS: readonly string[] = LANE_CLAUSES.map((c) => c.id);

export type AuditClauseId = (typeof LANE_CLAUSES)[number]["id"];

/** Lookup a clause by id (engine resolves recheck/source from here). */
export function getClause(id: string): LaneClause | undefined {
	return LANE_CLAUSES.find((c) => c.id === id);
}

// --- drift-code handling map (U9: explicit, not ad hoc) ---
//
// parseCommandFacadeContract (via findCommandFacadeMetadataDrift, which folds in
// findBaselineExitCodeDrift) can emit exactly these 32 category codes. Each is
// mapped to one disposition so static drift handling is explicit:
//   - "becomes-finding" : a real contract defect the auditor surfaces.
//   - "advisory"        : reported as a note, not a hard finding (style/text).
//   - "ignored"         : not the auditor's concern in v1 (out of lane scope).
// The clause-catalog.test guards that this map covers every parse-emittable code.

export type DriftDisposition = "becomes-finding" | "advisory" | "ignored";

export const DRIFT_CODE_DISPOSITIONS: Readonly<Record<string, DriftDisposition>> = {
	// Baseline exit floor — owned by the exit-floor clause.
	"command-baseline-exit-success-missing": "becomes-finding",
	"command-baseline-exit-failure-missing": "becomes-finding",
	"command-baseline-exit-usage-missing": "becomes-finding",
	// Structural contract defects — agent cannot use the surface correctly.
	"command-flags-missing": "becomes-finding",
	"command-exit-codes-missing": "becomes-finding",
	"command-exit-code-invalid": "becomes-finding",
	"command-audience-missing": "becomes-finding",
	"command-audience-invalid": "becomes-finding",
	"command-side-effect-invalid": "becomes-finding",
	"command-execution-mode-invalid": "becomes-finding",
	"command-output-mode-invalid": "becomes-finding",
	"command-interactivity-invalid": "becomes-finding",
	"command-capability-role-invalid": "becomes-finding",
	"command-enum-flag-values-missing": "becomes-finding",
	"command-flag-name-invalid": "becomes-finding",
	"command-reserved-diagnostic-flag": "becomes-finding",
	"command-mutation-sideeffect-mismatch": "becomes-finding",
	"command-write-preview-missing": "becomes-finding",
	"command-alias-target-missing": "becomes-finding",
	"command-alias-default-args-missing": "becomes-finding",
	"command-alias-default-arg-unknown": "becomes-finding",
	// Redaction / unsafe-text — owned by the redaction-discipline clause; the
	// facade already scans projected text for leaks, so these are real defects.
	"command-summary-unsafe-text": "becomes-finding",
	"command-usage-unsafe-text": "becomes-finding",
	"command-action-summary-unsafe-text": "becomes-finding",
	"command-flag-description-unsafe-text": "becomes-finding",
	"command-exit-code-unsafe-text": "becomes-finding",
	"command-result-contract-kind-unsafe-text": "becomes-finding",
	"command-result-contract-schema-version-unsafe-text": "becomes-finding",
	"command-write-preview-exemption-unsafe-text": "becomes-finding",
	"command-env-var-description-unsafe-text": "becomes-finding",
	"command-env-var-name-sensitive": "becomes-finding",
	"command-env-var-name-invalid": "becomes-finding",
} as const;
