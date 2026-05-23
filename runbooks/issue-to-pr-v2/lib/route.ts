/**
 * Route id catalog and classification for the Issue-to-PR v2 CLI (U4).
 *
 * ADR 0002 (CLI emits facts, not orchestration): route ids are **facts**
 * about where the workflow currently sits, not imperative instructions.
 * The hot router (U7) consumes a route id and decides what to do next;
 * the CLI never says "run X" or "execute Y".
 *
 * This module is the **executable source of truth** for the catalog. The
 * documentation in `references/ledger-and-helper.md` (added by U4) mirrors
 * this catalog — drift between the two is a P1 finding per the U4 audit
 * prompt.
 *
 * Route ids form a flat enum: every route id is one of the constants in
 * `ROUTE_IDS`. There are no nested or composite ids. This keeps the
 * `next --json` command output trivial to consume.
 */

import type { Dirent } from "node:fs";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ConfirmationState } from "./contract";

/**
 * Happy-path stage routes. These map 1:1 to the six v1 stages plus a
 * terminal `shipped` state.
 */
export const STAGE_ROUTE_IDS = [
  "pick-issue",
  "plan",
  "decompose",
  "batch-loop",
  "final-review",
  "ship",
  "shipped",
] as const;
export type StageRouteId = (typeof STAGE_ROUTE_IDS)[number];

/**
 * Blocked-state routes. The CLI emits one of these when durable ledger
 * state requires user action before the workflow can advance. The hot
 * router maps each to a stop-and-ask prompt.
 */
/**
 * Blocked route ids declared in **precedence order** — highest-priority
 * gate first. The prose table in
 * `references/ledger-and-helper.md` and the `classifyRoute` precedence
 * walk both mirror this order. Drift between any of the three is a P3
 * finding (F008/F021 from sweep 1).
 */
export const BLOCKED_ROUTE_IDS = [
  "blocked-frontmatter-blocked-reason",
  "blocked-runbook-version-skew",
  "blocked-acceptance-criteria-stale",
  "blocked-stage-3",
  "blocked-batch-contract-stale",
  "blocked-digests-stale",
] as const;
export type BlockedRouteId = (typeof BLOCKED_ROUTE_IDS)[number];

/**
 * Special routes for states outside the normal six-stage flow.
 */
export const SPECIAL_ROUTE_IDS = ["no-ledger"] as const;
export type SpecialRouteId = (typeof SPECIAL_ROUTE_IDS)[number];

/**
 * The complete route id catalog: stage routes ∪ blocked routes ∪ special
 * routes. Every `state --json` and `next --json` response carries one id
 * from this set.
 */
export const ROUTE_IDS = [
  ...STAGE_ROUTE_IDS,
  ...BLOCKED_ROUTE_IDS,
  ...SPECIAL_ROUTE_IDS,
] as const;
export type RouteId = (typeof ROUTE_IDS)[number];

/**
 * Inputs the classifier needs. Names match the
 * `ConfirmationStateReport` shape from `lib/ledger.ts` plus the small
 * extras the route classifier reads from the ledger frontmatter.
 *
 * `ledger_exists: false` is the no-ledger case. When false, every other
 * field is ignored and `classifyRoute` returns `"no-ledger"`.
 *
 * `runbook_version_skew` is U6 work but U4 reads the field if it's
 * present so the classifier can report `"blocked-runbook-version-skew"`.
 * Until U6 lands the field, callers pass `null` and skew is never
 * surfaced.
 */
export type RouteInputs = {
  ledger_exists: boolean;
  acceptance_criteria: ConfirmationState;
  batch_contract: ConfirmationState;
  digests: ConfirmationState;
  plan_path: string | null;
  has_batches: boolean;
  all_batches_terminal: boolean;
  final_reviewed_at: string | null;
  pr_url: string | null;
  frontmatter_status: "in-progress" | "blocked" | "shipped" | null;
  runbook_version_skew:
    | "matched"
    | "missing"
    | "mismatched"
    | "continuation-evidence-present"
    | null;
};

/**
 * Classify the current ledger state into exactly one `RouteId`.
 *
 * Order of precedence (highest wins):
 * 1. `no-ledger` — no ledger file on disk.
 * 2. `blocked-*` — durable state names a blocker.
 * 3. Happy-path stage ids — advance from pick-issue through ship/shipped.
 *
 * The function is pure: same inputs always produce the same id.
 */
export function classifyRoute(inputs: RouteInputs): RouteId {
  if (!inputs.ledger_exists) return "no-ledger";

  // Highest-priority blocked states. Order matters: frontmatter blocked
  // wins over derived-from-state blocked, because it represents an
  // explicit user decision.
  if (inputs.frontmatter_status === "blocked") {
    return "blocked-frontmatter-blocked-reason";
  }

  if (
    inputs.runbook_version_skew === "mismatched" ||
    inputs.runbook_version_skew === "missing"
  ) {
    return "blocked-runbook-version-skew";
  }

  if (inputs.acceptance_criteria === "blocked") {
    return "blocked-acceptance-criteria-stale";
  }
  if (inputs.batch_contract === "blocked") return "blocked-stage-3";

  if (inputs.acceptance_criteria === "stale") {
    return "blocked-acceptance-criteria-stale";
  }
  if (inputs.batch_contract === "stale") return "blocked-batch-contract-stale";
  if (inputs.digests === "stale") return "blocked-digests-stale";

  // Terminal success state.
  if (inputs.pr_url !== null && inputs.frontmatter_status === "shipped") {
    return "shipped";
  }

  // Happy-path stage progression.
  if (inputs.acceptance_criteria !== "confirmed") return "pick-issue";
  if (inputs.plan_path === null) return "plan";
  if (inputs.batch_contract !== "confirmed" || !inputs.has_batches) {
    return "decompose";
  }
  if (!inputs.all_batches_terminal) return "batch-loop";
  if (inputs.final_reviewed_at === null) return "final-review";
  // Stay in `ship` until BOTH the PR exists AND the operator has flipped
  // `frontmatter.status` to `shipped`. Without the second clause, a
  // forgotten status flip would route to the terminal `shipped` state
  // even though the workflow's frontmatter still says `in-progress`,
  // masking the incomplete transition. The same terminal-success
  // condition is checked above at the early-return on the pr_url +
  // frontmatter_status pair.
  if (inputs.pr_url === null || inputs.frontmatter_status !== "shipped") {
    return "ship";
  }
  return "shipped";
}

/**
 * Membership predicate for narrowing arbitrary strings to `RouteId`.
 */
export function isRouteId(value: string): value is RouteId {
  return (ROUTE_IDS as readonly string[]).includes(value);
}

/**
 * Per-axis digest drift facts (F002 fix): the three axes mirror the
 * `confirmation_state` triple verbatim plus a convenience `any` boolean.
 */
export type DigestDrift = {
  acceptance_criteria: boolean;
  batch_contract: boolean;
  digests: boolean;
  any: boolean;
};

/**
 * Compute per-axis digest drift facts from a confirmation state report.
 * "Drift" here means the stored frontmatter digest no longer matches
 * what `--*-digest` would emit today.
 *
 * Symmetric with the `confirmation_state` triple — every axis appears as
 * its own boolean plus the `any` aggregate.
 */
export function computeDigestDrift(state: {
  acceptance_criteria: ConfirmationState;
  batch_contract: ConfirmationState;
  digests: ConfirmationState;
}): DigestDrift {
  const acceptanceCriteria = state.acceptance_criteria === "stale";
  const batchContract = state.batch_contract === "stale";
  const digests = state.digests === "stale";
  return {
    acceptance_criteria: acceptanceCriteria,
    batch_contract: batchContract,
    digests,
    any: acceptanceCriteria || batchContract || digests,
  };
}

/**
 * Return the v2 reference filenames that are load-bearing for a given
 * route id. The hot router (U7) uses this list to materialise the right
 * references before walking into a turn. Names come from the U2 shadow
 * tree at `runbooks/issue-to-pr-v2/references/`.
 *
 * Uses an exhaustiveness guard so any future RouteId added to the
 * catalog forces this switch to be updated at compile time.
 */
export function requiredReferenceIdsFor(route: RouteId): readonly string[] {
  switch (route) {
    case "pick-issue":
      return ["stage-1-pick-issue.md", "ledger-and-helper.md"];
    case "plan":
      return ["stage-2-plan.md", "ledger-and-helper.md"];
    case "decompose":
      return ["stage-3-decompose.md", "ledger-and-helper.md"];
    case "batch-loop":
      return [
        "stage-4-batch-loop.md",
        "builder-dispatch.md",
        "host-adapters.md",
        "findings-and-validators.md",
        "ledger-and-helper.md",
      ];
    case "final-review":
      return [
        "stage-5-final-review.md",
        "findings-and-validators.md",
        "stage-4-batch-loop.md",
      ];
    case "ship":
      return ["stage-6-ship.md", "findings-and-validators.md"];
    case "shipped":
      return [];
    case "no-ledger":
      return ["stage-1-pick-issue.md"];
    case "blocked-acceptance-criteria-stale":
    case "blocked-batch-contract-stale":
    case "blocked-digests-stale":
    case "blocked-stage-3":
      return ["ledger-and-helper.md", "stage-3-decompose.md"];
    case "blocked-runbook-version-skew":
      return ["ledger-and-helper.md"];
    case "blocked-frontmatter-blocked-reason":
      return ["ledger-and-helper.md", "findings-and-validators.md"];
    default: {
      // Exhaustiveness guard: every RouteId branch above is covered. If a
      // future enum member is added to ROUTE_IDS, TypeScript flags this
      // line until the switch is updated.
      const exhaustive: never = route;
      throw new Error(`unhandled route id: ${exhaustive as string}`);
    }
  }
}

/**
 * Structured blocking-gate fact (F006 fix). The CLI emits gates as a
 * typed discriminated union so consumers do not have to parse mixed
 * string formats.
 *
 * - `kind: "route_id"` carries one of the `blocked-*` route ids.
 * - `kind: "field"` carries a `field` path and the offending `value`.
 */
export type BlockingGate =
  | { kind: "route_id"; value: BlockedRouteId }
  | { kind: "field"; field: BlockingGateFieldName; value: string };

/**
 * The fixed set of `field` identifiers a `kind: "field"` blocking gate
 * may carry. Declared as a tuple so the order is contractually
 * significant — it mirrors the precedence walk inside `blockingGatesFor`
 * (frontmatter.status first, then ac/batch contract statuses, then the
 * U6 runbook_version gate last). Adding a new field gate requires
 * extending this tuple AND the dispatch logic; the contract slice in
 * `cli.ts` then surfaces the addition automatically.
 */
export const BLOCKING_GATE_FIELD_NAMES = [
  "frontmatter.status",
  "ac_confirmation_status",
  "batch_contract_confirmation_status",
  "frontmatter.runbook_version",
] as const;
export type BlockingGateFieldName = (typeof BLOCKING_GATE_FIELD_NAMES)[number];

/**
 * Compute blocking gates for the current route + snapshot. Returns zero
 * or more gates that prevent the workflow from advancing.
 *
 * U6 adds the optional `runbook_version_skew` input. When skew is
 * `missing` or `mismatched` (and no continuation evidence has promoted
 * it to `continuation-evidence-present`), the function emits an
 * additional `{ kind: "field", field: "frontmatter.runbook_version",
 * value: "missing" | "mismatched" }` field gate so the hot router (U7)
 * can fail closed before dispatching any packet rendered against a
 * contract the runbook no longer honors. (U7 prose calls this the
 * "version-skew-stop-required" event.)
 */
export function blockingGatesFor(input: {
  route: RouteId;
  confirmation_state: {
    acceptance_criteria: ConfirmationState;
    batch_contract: ConfirmationState;
    digests: ConfirmationState;
  };
  frontmatter_status: "in-progress" | "blocked" | "shipped" | null;
  runbook_version_skew?:
    | "matched"
    | "missing"
    | "mismatched"
    | "continuation-evidence-present"
    | null;
}): readonly BlockingGate[] {
  const gates: BlockingGate[] = [];
  if (isBlockedRouteId(input.route)) {
    gates.push({ kind: "route_id", value: input.route });
  }
  if (input.frontmatter_status === "blocked") {
    gates.push({ kind: "field", field: "frontmatter.status", value: "blocked" });
  }
  if (input.confirmation_state.acceptance_criteria === "blocked") {
    gates.push({
      kind: "field",
      field: "ac_confirmation_status",
      value: "blocked",
    });
  }
  if (input.confirmation_state.batch_contract === "blocked") {
    gates.push({
      kind: "field",
      field: "batch_contract_confirmation_status",
      value: "blocked",
    });
  }
  if (
    input.runbook_version_skew === "missing" ||
    input.runbook_version_skew === "mismatched"
  ) {
    // U6 field-gate names follow the same shape as the existing
    // gates (named ledger field with the offending value); the wire
    // identifier `frontmatter.runbook_version` mirrors
    // `frontmatter.status` so a router can route off field name
    // without a casing-convention special case. The U7 prose calls
    // this the "version-skew-stop-required" event.
    gates.push({
      kind: "field",
      field: "frontmatter.runbook_version",
      value: input.runbook_version_skew,
    });
  }
  return gates;
}

function isBlockedRouteId(value: RouteId): value is BlockedRouteId {
  return (BLOCKED_ROUTE_IDS as readonly string[]).includes(value);
}

/**
 * Structured install-artifact presence report. Each root is a boolean
 * presence flag plus an aggregate `all_present` and a list of the
 * `missing` roots for diagnostic output. The shape is the U6 contract:
 *
 * - `references` — the `references/` directory contains at least one
 *   readable file.
 * - `templates` — the `templates/` directory contains at least one
 *   readable file.
 * - `cli_ts` — `cli.ts` exists at the v2 install root.
 * - `lib_dir` — the `lib/` directory contains at least one readable
 *   file.
 *
 * No per-file enumeration: U6 R "MUST NOT leak" forbids exposing a
 * file list (avoids unrelated-repo content disclosure and keeps the
 * diagnostic surface bounded).
 */
export type InstalledArtifactPresence = {
  references: boolean;
  templates: boolean;
  cli_ts: boolean;
  lib_dir: boolean;
  all_present: boolean;
  missing: ("references" | "templates" | "cli_ts" | "lib_dir")[];
};

/**
 * Resolve the v2 install root from this module's own location. Walking
 * up from `lib/route.ts` lands at the v2 directory regardless of
 * whether the consumer invoked the CLI through the in-repo path
 * (`${REPO}/runbooks/issue-to-pr-v2/`) or the installed symlink path
 * (`~/.claude/runbooks/issue-to-pr-v2/`, which itself dereferences
 * through `~/.claude/runbooks → ${REPO}/runbooks`).
 *
 * Symlinks are NOT eagerly resolved — preserving the symlink topology
 * is part of the U6 install contract. The recursive walk uses
 * `realpathSync` only when checking for loops.
 */
function v2InstallRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * Real recursive install-artifact presence walk (U6). Replaces the U4
 * static stub. Defensive against:
 *
 * - non-existent install paths (returns every root false),
 * - empty directories (treated as missing — a present-but-empty
 *   `references/` is a broken install, not a present one),
 * - symlink loops (visited-realpath set bounds recursion to each
 *   physical path once).
 *
 * Does NOT throw on any filesystem error — every failure mode collapses
 * to "this root is missing" so the CLI can keep emitting a structured
 * envelope.
 */
export function installedArtifactPresence(
  rootPath: string = v2InstallRoot(),
): InstalledArtifactPresence {
  const references = directoryHasAnyFile(resolve(rootPath, "references"));
  const templates = directoryHasAnyFile(resolve(rootPath, "templates"));
  const cliTs = fileExists(resolve(rootPath, "cli.ts"));
  const libDir = directoryHasAnyFile(resolve(rootPath, "lib"));

  const missing: InstalledArtifactPresence["missing"] = [];
  if (!references) missing.push("references");
  if (!templates) missing.push("templates");
  if (!cliTs) missing.push("cli_ts");
  if (!libDir) missing.push("lib_dir");

  return {
    references,
    templates,
    cli_ts: cliTs,
    lib_dir: libDir,
    all_present: missing.length === 0,
    missing,
  };
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Returns true iff `dirPath` exists, is a directory, and the subtree
 * rooted at it contains at least one regular file. Recursive so an
 * `install.sh` regression that ships `references/` as an empty folder
 * surfaces as a missing root, not a present one.
 *
 * Bounded by a visited-realpath set so symlink loops are detected and
 * pruned. Bounded again by a depth cap (32) as a belt-and-braces guard
 * against any realpath drift.
 */
function directoryHasAnyFile(dirPath: string): boolean {
  const visited = new Set<string>();
  return walkHasFile(dirPath, visited, 0);
}

function walkHasFile(
  dirPath: string,
  visited: Set<string>,
  depth: number,
): boolean {
  if (depth > 32) return false;

  let canonical: string;
  try {
    canonical = realpathSync(dirPath);
  } catch {
    return false;
  }
  if (visited.has(canonical)) return false;
  visited.add(canonical);

  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(canonical);
  } catch {
    return false;
  }
  if (!stat.isDirectory()) return false;

  let entries: Dirent[];
  try {
    entries = readdirSync(canonical, { withFileTypes: true }) as Dirent[];
  } catch {
    return false;
  }
  for (const entry of entries) {
    const entryPath = resolve(canonical, String(entry.name));
    if (entry.isFile()) return true;
    if (entry.isSymbolicLink()) {
      // A symlink may point at either a regular file or a directory.
      // statSync follows the link; if the target is a file, this root
      // counts as present without recursing (which would otherwise
      // short-circuit to false because walkHasFile expects a
      // directory). The visited set still catches loops; the depth cap
      // is the belt-and-braces guard.
      try {
        if (statSync(entryPath).isFile()) return true;
      } catch {
        // Broken symlink — skip this entry but keep scanning siblings.
        continue;
      }
      if (walkHasFile(entryPath, visited, depth + 1)) return true;
      continue;
    }
    if (entry.isDirectory()) {
      if (walkHasFile(entryPath, visited, depth + 1)) return true;
    }
  }
  return false;
}

/**
 * Diagnose-command drift report shape (F-SW2-001 hoist). Currently
 * `findings_table_drift` is always null; a future seam will widen it.
 */
export type FindingsTableDrift = null;

export type DiagnoseDrift = {
  digest_drift: DigestDrift;
  findings_table_drift: FindingsTableDrift;
};

/**
 * Build the `drift` field for the `diagnose --json` envelope from a
 * ledger snapshot. The findings-table-drift slot is null today; a
 * future seam owns the widening.
 */
export function buildDiagnoseDrift(snapshot: {
  confirmation_state: {
    acceptance_criteria: ConfirmationState;
    batch_contract: ConfirmationState;
    digests: ConfirmationState;
  };
}): DiagnoseDrift {
  return {
    digest_drift: computeDigestDrift(snapshot.confirmation_state),
    findings_table_drift: null,
  };
}
