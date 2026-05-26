/**
 * Ledger parsing, validation, and integrity checks for the Issue-to-PR v2
 * helper.
 *
 * Owns the parser and validation bodies behind the compatibility helper.
 *
 * - Constants and types live in `./contract.ts` and are imported here.
 * - Digest primitives live in `./digest.ts` and are imported here.
 * - `parse`, `validateFindingsData`, `validateLedgerBatches`, `validateAcCoverage`,
 *   `emit`, `emitContractDigest`, `emitPlanDigest`, `emitAcDigest`,
 *   `emitConfirmationState`, `emitLedgerBatchContractDigest`,
 *   `readLedgerBatchContext`, and the global `fail` infrastructure are
 *   exported so the v2 entrypoint at `../decompose.ts` can dispatch CLI
 *   flags without reaching into module internals.
 * - All emit functions (those that call `stdout.write`) live in this module
 *   too, because they are entangled with the same `fail()` sink and parser
 *   helpers. The v2 entrypoint just dispatches to them by name. This trades
 *   a clean module boundary for behavior parity — see the U3 ledger note in
 *   `docs/runbooks/issue-to-pr-v2-refactor/u3-helper-internals-ledger.md`.
 *
 * Issue #51 AC4 lands here: "Ledger parsing and validation still cover
 * confirmation state, batch contracts, replacement batches, Builder
 * attempts, findings, and AC coverage."
 */

import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { posix as pathPosix } from "node:path";
import { exit, stderr, stdout } from "node:process";

import {
  ALWAYS_ON_VALIDATOR_PERSONAS,
  ATTEMPT_LANES,
  type AttemptLane,
  type Batch,
  BATCH_KEYS,
  BATCH_STATUSES,
  BUILDER_ATTEMPT_KEYS,
  BUILDER_ATTEMPT_STATUSES,
  BUILDER_ATTEMPT_TYPES,
  CHANGE_FIRST_EXCEPTION_PREFIX,
  CONFIRMATION_STATES,
  type ConfirmationState,
  EXECUTION_MODES,
  type ExecutionMode,
  EXTENSIONLESS_FILE_NAMES,
  FAIL_STOP_ATTEMPT_STATUSES,
  FINAL_VERDICTS,
  FINDING_KEYS,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  HIGH_RISK_CHANGE_FIRST_EXCEPTION_PREFIX,
  HIGH_RISK_NEW_FILE_PATCH_EXCEPTION_PREFIX,
  INVESTIGATION_RATIONALE,
  LEDGER_BATCH_KEYS,
  LEDGER_BATCH_LIFECYCLE_DEFAULTS,
  LEDGER_BATCH_LIFECYCLE_FIELDS,
  type LedgerBatchLifecycleField,
  LEGACY_EXECUTION_MODE_HINTS,
  MAX_BUILDER_ATTEMPTS,
  NEW_FILE_PATCH_EXCEPTION_PREFIX,
  NOTES_IMPLEMENTATION_ATTEMPT_CHECKPOINT_FIELDS,
  NOTES_IMPLEMENTATION_ATTEMPT_CHECKPOINT_MARKER,
  NOTES_IMPLEMENTATION_ATTEMPT_CHECKPOINT_ROOT_KEY,
  NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_FIELDS,
  NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_MARKER,
  NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_ROOT_KEY,
  NOTES_VALIDATOR_WAVE_COMPLETED_LIST_FIELDS,
  NOTES_VALIDATOR_WAVE_COMPLETED_MARKER,
  NOTES_VALIDATOR_WAVE_COMPLETED_ROOT_KEY,
  NOTES_VALIDATOR_WAVE_COMPLETED_SCALAR_FIELDS,
  NOTES_VALIDATOR_WAVE_DISPATCH_EVIDENCE_FIELDS,
  ORCHESTRATOR_INLINE_ATTEMPT_KEYS,
  RUNBOOK_VERSION,
  STAGE_3_BATCH_ID,
  TERMINAL_BATCH_STATUSES,
  VALIDATOR_WAVE_OUTCOMES,
} from "./contract";
import { contractDigest, sha256Digest } from "./digest";

export interface BuilderAttempt {
  attempt_type: string;
  status: string;
  commit_sha: string | null;
  files_touched: string[];
  route_hint: string | null;
  blockers: string[];
  probe_results: string[];
  notes: string;
}

export interface OrchestratorInlineAttempt {
  commit_sha: string;
  files_touched: string[];
  notes: string;
}

interface ImplementationAttemptCheckpointEvidence {
  batch_id: string;
  implementation_commit: string;
  attempt_lane: AttemptLane;
  timestamp: string;
}

interface ValidatorWaveCompletedEvidence {
  batch_id: string;
  implementation_commit: string;
  attempt_lane: AttemptLane;
  personas: string[];
  dispatch_evidence: {
    role: string;
    target_id: string;
    cli_route_id: string;
  };
  outcome: string;
  findings: string[];
}

export interface ParseOptions {
  patchProposalMode?: boolean;
  allowPatchBatches?: boolean;
  externalDependencyIds?: Set<string>;
  externalFilePaths?: Set<string>;
  existingBatchIds?: Set<string>;
}

interface ParsedBlock {
  values: Record<string, unknown>;
  errors: string[];
}

const PATCH_PROPOSAL_ROOT_FIELDS = new Set([
  "final_finding",
  "patch_batches",
]);
const PATCH_PROPOSAL_FINAL_FINDING_FIELDS = new Set([
  "id",
  "signature",
  "persona",
  "severity",
  "summary",
]);

export interface Finding {
  id: string;
  batch_id: string;
  signature: string;
  persona: string;
  severity: string;
  status: string;
  summary: string;
  resolution: string | null;
}

interface FindingTableRow {
  id: string;
  batch_id: string;
  signature: string;
  persona: string;
  severity: string;
  status: string;
  summary: string;
  resolution: string | null;
}

export interface LedgerBatchContext {
  allIds: Set<string>;
  terminalSuccessIds: Set<string>;
  files: Set<string>;
  terminalImplementationCommits: Set<string>;
  terminalImplementationCommitsById: Map<string, Set<string>>;
}

interface SupersedesGraphEntry {
  batch: Batch;
  index: number;
  label: string;
}

interface LedgerBatchEntry extends SupersedesGraphEntry {
  row: Record<string, unknown>;
}

interface ConfirmationStateReport {
  acceptanceCriteria: ConfirmationState;
  batchContract: ConfirmationState;
  digests: ConfirmationState;
}

/**
 * Error type thrown by the helper when an internal caller wraps a fallible
 * operation in `nonExiting()`. External CLI callers see a `decompose: <msg>`
 * stderr line and an `exit(1)` instead — never this class.
 */
export class DecomposeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecomposeError";
  }
}

export type FailMode = "exit" | "throw";

let failMode: FailMode = "exit";

/**
 * The helper's universal error sink.
 *
 * Defaults to `failMode: "exit"`, in which case `fail()` writes
 * `decompose: <msg>\n` to stderr and calls `process.exit(1)`. The
 * `withFailMode()` helper temporarily flips `failMode` to `"throw"` for
 * the duration of one wrapped call so a CLI consumer can convert
 * validator failures into a structured `CliErrorEnvelope` instead of
 * killing the process.
 *
 * **`decompose.ts` (the compatibility entrypoint) leaves the default
 * `"exit"` mode in place** so its CLI semantics remain stable. `cli.ts`
 * (U4 v2 CLI front door) wraps its validator
 * calls in `withFailMode("throw", () => …)` to catch the
 * `DecomposeError` and surface it as a `CliErrorEnvelope`.
 */
export function fail(msg: string): never {
  if (failMode === "throw") throw new DecomposeError(msg);
  stderr.write(`decompose: ${msg}\n`);
  exit(1);
}

/**
 * Run `fn` with `failMode` temporarily set to `mode`, restoring the
 * previous value (including via uncaught exceptions) on exit. Returns
 * whatever `fn` returns.
 *
 * Use this from `cli.ts` to convert exit-on-fail semantics into a
 * structured-error path. Example:
 *
 * ```ts
 * try {
 *   const data = withFailMode("throw", () => validateFindingsData(ledger));
 *   return createSuccessEnvelope({ ... });
 * } catch (e) {
 *   if (e instanceof DecomposeError) return createErrorEnvelope({ ... });
 *   throw e;
 * }
 * ```
 */
export function withFailMode<T>(mode: FailMode, fn: () => T): T {
  const previous = failMode;
  failMode = mode;
  try {
    return fn();
  } finally {
    failMode = previous;
  }
}

function nonExiting<T>(fn: () => T): T | null {
  const previousFailMode = failMode;
  failMode = "throw";
  try {
    return fn();
  } catch (error) {
    if (error instanceof DecomposeError) return null;
    throw error;
  } finally {
    failMode = previousFailMode;
  }
}

/**
 * Read a plan file and return the validated, topologically-sorted batch list.
 *
 * Scans for fenced ```yaml blocks, picks the ones that look like batch
 * candidates, parses each into a `Batch`, then runs the full set of
 * structural validators (required fields, unique ids, repo-relative paths,
 * acceptable execution modes, change_first guardrails, supersedes graph
 * acyclicity). Fails via `fail()` on any violation. The returned list is in
 * dependency order — every batch's `depends_on` resolves to a batch that
 * appears earlier in the array.
 *
 * @param planPath - Filesystem path to the `/ce-plan`-authored plan file.
 * @param options - `patchProposalMode` for the Stage 5 patch flow,
 *   `allowPatchBatches` for ledger-side validation that needs to accept the
 *   `patch-*` ids that are already in the ledger, and the three `external*`
 *   sets that the patch-proposal mode uses to validate against the
 *   confirmed ledger state.
 */
export function parse(planPath: string, options: ParseOptions = {}): Batch[] {
  let src: string;
  try {
    src = readFileSync(planPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read plan ${planPath}: ${message}`);
  }
  const blocks = [...src.matchAll(/```yaml[^\n]*\n([\s\S]*?)```/gi)].map((m) => m[1]);
  if (blocks.length === 0) {
    fail(`no fenced yaml blocks found in ${planPath}`);
  }

  const batches: Batch[] = [];
  for (const [index, block] of blocks.entries()) {
    const blockLabel = `YAML block ${index + 1}`;
    const patchProposalBlocks = options.patchProposalMode
      ? parsePatchProposalBatchBlocks(block)
      : null;
    if (patchProposalBlocks !== null) {
      for (const [patchIndex, parsedBlock] of patchProposalBlocks.entries()) {
        const batch = batchFromParsedBlock(
          parsedBlock,
          `${blockLabel} patch_batches[${patchIndex + 1}]`,
        );
        if (batch !== null) batches.push(batch);
      }
      continue;
    }

    if (!looksLikeBatchCandidateBlock(block)) continue;
    const batch = batchFromParsedBlock(parseFlatBatchBlock(block), blockLabel);
    if (batch !== null) {
      batches.push(batch);
    }
  }

  if (batches.length === 0) {
    fail("no batches with id/name/goal found; ce-plan addendum may not have been honored");
  }

  validateBatchContracts(batches, options);
  return topoSortOrFail(batches);
}

function batchFromParsedBlock(parsedBlock: ParsedBlock, blockLabel: string): Batch | null {
  const parsed = parsedBlock.values;
  if (parsedBlock.errors.length > 0) {
    fail(`${blockLabel}: ${parsedBlock.errors.join("; ")}`);
  }
  if (!isBatchCandidate(parsed)) return null;
  const unknownKeys = Object.keys(parsed).filter((key) => !BATCH_KEYS.has(key));
  if (unknownKeys.length > 0) {
    fail(`${blockLabel} has unknown field "${unknownKeys[0]}"`);
  }
  const id = requiredString(parsed, "id", blockLabel);
  return {
    id,
    name: requiredString(parsed, "name", id),
    goal: requiredString(parsed, "goal", id),
    files: requiredArray(parsed, "files", id),
    depends_on: requiredArray(parsed, "depends_on", id),
    supersedes: optionalNullableScalar(parsed.supersedes, "supersedes"),
    execution_mode: asExecutionMode(requiredString(parsed, "execution_mode", id), id),
    acceptance_tests: requiredArray(parsed, "acceptance_tests", id),
    ac_mapping: requiredNumberArray(parsed, "ac_mapping", id),
    rationale: optionalRationale(parsed.rationale),
  };
}

function parsePatchProposalBatchBlocks(text: string): ParsedBlock[] | null {
  const lines = text.split("\n");
  const headerIndex = lines.findIndex((raw) =>
    /^patch_batches:\s*(?:#.*)?$/.test(raw),
  );
  if (headerIndex === -1) return null;

  const rootErrors = validatePatchProposalRoot(lines);
  if (rootErrors.length > 0) {
    return [{ values: {}, errors: rootErrors }];
  }

  const blocks: string[][] = [];
  let current: string[] | null = null;
  let itemIndent: number | null = null;

  for (const [offset, raw] of lines.slice(headerIndex + 1).entries()) {
    const lineNumber = headerIndex + offset + 2;
    const line = stripYamlComment(raw).replace(/\s+$/, "");
    if (!line.trim()) {
      if (current !== null) current.push("");
      continue;
    }

    const indent = line.match(/^ */)?.[0].length ?? 0;
    if (indent === 0) break;

    const item = line.match(/^(\s*)-\s+(.*)$/);
    if (item && (itemIndent === null || item[1].length === itemIndent)) {
      if (current !== null) blocks.push(current);
      itemIndent = item[1].length;
      current = [item[2]];
      continue;
    }

    if (current === null || itemIndent === null) {
      return [{
        values: {},
        errors: [`line ${lineNumber} is not a patch_batches list item`],
      }];
    }
    if (indent <= itemIndent) {
      return [{
        values: {},
        errors: [`line ${lineNumber} is not nested under patch_batches`],
      }];
    }

    const fieldIndent = itemIndent + 2;
    current.push(line.slice(Math.min(fieldIndent, indent)));
  }

  if (current !== null) blocks.push(current);
  if (blocks.length === 0) {
    return [{
      values: {},
      errors: ["patch_batches must contain at least one batch"],
    }];
  }
  return blocks.map((block) => parseFlatBatchBlock(block.join("\n")));
}

function validatePatchProposalRoot(lines: string[]): string[] {
  const errors: string[] = [];
  const rootFields: { key: string; line: number }[] = [];
  for (const [index, raw] of lines.entries()) {
    const line = stripYamlComment(raw).replace(/\s+$/, "");
    if (!line.trim()) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*):/);
    if (match) rootFields.push({ key: match[1], line: index });
  }

  const seenRoot = new Set<string>();
  for (const field of rootFields) {
    if (!PATCH_PROPOSAL_ROOT_FIELDS.has(field.key)) {
      errors.push(`unexpected root field "${field.key}"`);
      continue;
    }
    if (seenRoot.has(field.key)) {
      errors.push(`duplicate root field "${field.key}"`);
    }
    seenRoot.add(field.key);
  }
  if (!seenRoot.has("final_finding")) {
    errors.push('missing required root field "final_finding"');
  }
  if (!seenRoot.has("patch_batches")) {
    errors.push('missing required root field "patch_batches"');
  }

  const finalFinding = rootFields.find((field) => field.key === "final_finding");
  if (finalFinding) {
    errors.push(...validatePatchProposalFinalFinding(lines, finalFinding.line));
  }
  return errors;
}

function validatePatchProposalFinalFinding(lines: string[], startLine: number): string[] {
  const errors: string[] = [];
  const fields: string[] = [];

  for (const raw of lines.slice(startLine + 1)) {
    const line = stripYamlComment(raw).replace(/\s+$/, "");
    if (!line.trim()) continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    if (indent === 0) break;
    const match = line.match(/^ {2}([A-Za-z_][A-Za-z0-9_]*):/);
    if (!match) {
      errors.push("final_finding must contain only scalar fields");
      continue;
    }
    fields.push(match[1]);
  }

  const seen = new Set<string>();
  for (const field of fields) {
    if (!PATCH_PROPOSAL_FINAL_FINDING_FIELDS.has(field)) {
      errors.push(`final_finding has unexpected field "${field}"`);
      continue;
    }
    if (seen.has(field)) {
      errors.push(`final_finding has duplicate field "${field}"`);
    }
    seen.add(field);
  }
  for (const field of PATCH_PROPOSAL_FINAL_FINDING_FIELDS) {
    if (!seen.has(field)) {
      errors.push(`final_finding is missing required field "${field}"`);
    }
  }
  return errors;
}

function isBatchCandidate(parsed: Record<string, unknown>): boolean {
  return Object.keys(parsed).some((key) => BATCH_KEYS.has(key));
}

function looksLikeBatchCandidateBlock(block: string): boolean {
  const keys = new Set<string>();
  for (const raw of block.split("\n")) {
    const line = stripYamlComment(raw).trimEnd();
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*):/);
    if (match && BATCH_KEYS.has(match[1])) keys.add(match[1]);
  }
  return (
    keys.has("execution_mode") ||
    keys.has("ac_mapping") ||
    (keys.has("id") && (keys.has("name") || keys.has("goal") || keys.has("files")))
  );
}

function hasKey(parsed: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(parsed, key);
}

function requiredString(parsed: Record<string, unknown>, key: string, context: string): string {
  if (!hasKey(parsed, key)) fail(`${context} is missing required field "${key}"`);
  const value = parsed[key];
  if (Array.isArray(value) || value === null || value === undefined) {
    fail(`${context} field "${key}" must be a non-empty scalar`);
  }
  const text = String(value).trim();
  if (text.length === 0) fail(`${context} field "${key}" must be non-empty`);
  return text;
}

function requiredArray(parsed: Record<string, unknown>, key: string, context: string): string[] {
  if (!hasKey(parsed, key)) fail(`${context} is missing required field "${key}"`);
  const value = parsed[key];
  if (!Array.isArray(value)) fail(`${context} field "${key}" must be a list`);
  const items = value.map((item) => String(item).trim());
  if (items.some((item) => item.length === 0)) fail(`${context} field "${key}" must contain non-empty items`);
  return items;
}

function requiredNumberArray(parsed: Record<string, unknown>, key: string, context: string): number[] {
  if (!hasKey(parsed, key)) fail(`${context} is missing required field "${key}"`);
  const value = parsed[key];
  if (!Array.isArray(value)) fail(`${context} field "${key}" must be a list of integer AC indices`);
  const rawItems = value.map((item) => String(item).trim());
  if (rawItems.length === 0) return [];
  if (rawItems.some((item) => item.length === 0)) {
    fail(`${context} field "${key}" must contain integer AC indices`);
  }
  return rawItems.map((item) => {
    if (!/^\d+$/.test(item)) fail(`${context} field "${key}" contains invalid AC index "${item}"`);
    const n = Number(item);
    if (!Number.isSafeInteger(n) || n < 1) fail(`${context} field "${key}" contains invalid AC index "${item}"`);
    return n;
  });
}

function optionalNullableScalar(value: unknown, key: string): string | null {
  if (value === undefined || value === null || value === "null") return null;
  if (Array.isArray(value)) fail(`${key} must be a scalar or null`);
  const text = String(value).trim();
  return text.length === 0 ? null : text;
}

function optionalRationale(value: unknown): string | null {
  return optionalNullableScalar(value, "rationale");
}

function validateBatchContracts(batches: Batch[], options: ParseOptions): void {
  if (options.patchProposalMode && batches.length !== 1) {
    fail(`patch proposal mode expects exactly one patch batch, got ${batches.length}`);
  }

  const ids = new Set<string>();
  for (const b of batches) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(b.id)) {
      fail(`batch id "${b.id}" must be a lowercase slug using letters, numbers, and hyphens`);
    }
    if (b.id === STAGE_3_BATCH_ID) {
      fail(`batch id "${b.id}" is reserved for Stage 3 Contract Review findings`);
    }
    if (ids.has(b.id)) fail(`duplicate batch id "${b.id}"`);
    ids.add(b.id);
  }

  for (const b of batches) {
    const isPatch = b.id.startsWith("patch-");
    if (b.files.length === 0) fail(`batch ${b.id} has no files`);
    if (b.acceptance_tests.length === 0) fail(`batch ${b.id} has no acceptance_tests`);
    if (isPatch && !options.patchProposalMode && !options.allowPatchBatches) {
      fail(`batch ${b.id} uses reserved patch-* id outside patch proposal mode`);
    }
    if (options.patchProposalMode && !isPatch) {
      fail(`batch ${b.id} is not a patch batch; patch proposal mode only accepts patch-* ids`);
    }
    if (options.patchProposalMode && !/^patch-\d{3}$/.test(b.id)) {
      fail(`batch ${b.id} is not a valid patch id; expected patch-NNN`);
    }
    if (options.patchProposalMode && options.existingBatchIds?.has(b.id)) {
      fail(`batch ${b.id} already exists in the ledger`);
    }
    if (options.patchProposalMode && b.files.length > 2) {
      fail(`batch ${b.id} touches ${b.files.length} files; patch proposals are limited to 2 files`);
    }
    if (options.patchProposalMode && b.depends_on.length === 0) {
      fail(`batch ${b.id} is a patch batch and must depend on an existing ledger batch`);
    }
    if (isPatch && b.supersedes !== null) {
      fail(`batch ${b.id} is a patch batch and must not use supersedes`);
    }
    if (b.supersedes !== null) {
      if (b.supersedes === b.id) fail(`batch ${b.id} cannot supersede itself`);
      if (!ids.has(b.supersedes)) fail(`batch ${b.id} supersedes unknown id "${b.supersedes}"`);
      if (b.depends_on.includes(b.supersedes)) {
        fail(`batch ${b.id} supersedes "${b.supersedes}"; supersedes is audit metadata, not a depends_on edge`);
      }
    }
    if (isPatch && b.ac_mapping.length !== 0) {
      fail(`batch ${b.id} is a patch batch and must use ac_mapping: []`);
    }
    if (!isPatch && b.ac_mapping.length === 0) {
      fail(`batch ${b.id} has no ac_mapping; normal batches must map to at least one AC`);
    }
    rejectDuplicates(b.depends_on, `batch ${b.id} depends_on`);
    const canonicalFiles = b.files.map((file) => validateRepoRelativePath(file, b.id));
    rejectDuplicates(canonicalFiles, `batch ${b.id} files`);
    rejectDuplicates(b.acceptance_tests, `batch ${b.id} acceptance_tests`);
    rejectDuplicates(b.ac_mapping.map((i) => String(i)), `batch ${b.id} ac_mapping`);
    if (options.patchProposalMode) {
      const newFiles = canonicalFiles.filter((file) => !options.externalFilePaths?.has(file));
      const highRiskNewFiles = newFiles.filter(isHighRiskPath);
      if (
        highRiskNewFiles.length > 0 &&
        !hasNonEmptyPrefixedRationale(b.rationale, HIGH_RISK_NEW_FILE_PATCH_EXCEPTION_PREFIX)
      ) {
        fail(
          `batch ${b.id} touches high-risk files outside confirmed ledger scope (${highRiskNewFiles.join(
            ", ",
          )}); add a non-empty rationale starting with "${HIGH_RISK_NEW_FILE_PATCH_EXCEPTION_PREFIX}" for the user gate`,
        );
      }
      if (
        newFiles.length > 0 &&
        highRiskNewFiles.length === 0 &&
        !hasNonEmptyPrefixedRationale(b.rationale, NEW_FILE_PATCH_EXCEPTION_PREFIX)
      ) {
        fail(
          `batch ${b.id} touches files outside confirmed ledger scope (${newFiles.join(
            ", ",
          )}); add a non-empty rationale starting with "${NEW_FILE_PATCH_EXCEPTION_PREFIX}" for the user gate`,
        );
      }
    }
    for (const dep of b.depends_on) {
      if (options.patchProposalMode) {
        if (options.externalDependencyIds?.has(dep)) continue;
        fail(`batch ${b.id} depends_on "${dep}" which is not a terminal ledger batch`);
      }
      if (ids.has(dep)) continue;
      fail(`batch ${b.id} depends_on unknown id "${dep}"`);
    }
    validateChangeFirstGuardrails(b);
  }
  validateUniqueSupersedesTargets(batchSupersedesEntries(batches));
  validateAcyclicSupersedesGraph(batchSupersedesEntries(batches));
}

function rejectDuplicates(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(`${label} contains duplicate "${value}"`);
    seen.add(value);
  }
}

function normalizeRepoPath(file: string): string {
  return pathPosix.normalize(file.replace(/\\/g, "/").replace(/^\.\//, ""));
}

function validateRepoRelativePath(file: string, batchId: string): string {
  const slashed = file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (slashed.length === 0) fail(`batch ${batchId} has an empty file path`);
  if (/[\r\n]/.test(slashed)) fail(`batch ${batchId} file "${file}" must stay on one line`);
  if (slashed === "." || slashed.endsWith("/")) {
    fail(`batch ${batchId} file "${file}" must name a file, not a directory`);
  }
  if (slashed.startsWith("/") || slashed.startsWith("~") || /^[A-Za-z]:\//.test(slashed)) {
    fail(`batch ${batchId} file "${file}" must be repo-relative`);
  }
  const segments = slashed.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === ".")) {
    fail(`batch ${batchId} file "${file}" must use canonical path segments`);
  }
  if (segments.includes("..")) {
    fail(`batch ${batchId} file "${file}" must not escape the repo`);
  }
  const normalized = normalizeRepoPath(slashed);
  if (["app", "docs", "lib", "packages", "src", "test", "tests"].includes(normalized)) {
    fail(`batch ${batchId} file "${file}" looks like a directory; list concrete files instead`);
  }
  const basename = normalized.split("/").at(-1) ?? normalized;
  if (!basename.includes(".") && !EXTENSIONLESS_FILE_NAMES.has(basename.toLowerCase())) {
    fail(`batch ${batchId} file "${file}" must name a concrete file`);
  }
  let existingIsDirectory = false;
  try {
    existingIsDirectory = statSync(normalized).isDirectory();
  } catch {
    // Non-existent future files are allowed when their basename is concrete.
  }
  if (existingIsDirectory) fail(`batch ${batchId} file "${file}" must name a file, not a directory`);
  return normalized;
}

function validateChangeFirstGuardrails(batch: Batch): void {
  if (batch.execution_mode !== "change_first") return;

  const riskyFiles = batch.files.filter(isHighRiskPath);
  if (riskyFiles.length > 0) {
    if (hasNonEmptyPrefixedRationale(batch.rationale, HIGH_RISK_CHANGE_FIRST_EXCEPTION_PREFIX)) return;
    fail(
      `batch ${batch.id} uses change_first on risky files (${riskyFiles.join(
        ", ",
      )}); use tdd/proof_first or a non-empty rationale starting with "${HIGH_RISK_CHANGE_FIRST_EXCEPTION_PREFIX}" for the stage 3 gate`,
    );
  }

  if (batch.files.every(isDocsPath)) return;

  if (
    batch.rationale === INVESTIGATION_RATIONALE ||
    hasNonEmptyPrefixedRationale(batch.rationale, CHANGE_FIRST_EXCEPTION_PREFIX)
  ) {
    return;
  }

  fail(
    `batch ${batch.id} uses change_first outside docs-only paths; add rationale "${INVESTIGATION_RATIONALE}" or a non-empty rationale starting with "${CHANGE_FIRST_EXCEPTION_PREFIX}" for the stage 3 gate`,
  );
}

function hasNonEmptyPrefixedRationale(rationale: string | null, prefix: string): boolean {
  return typeof rationale === "string" && rationale.startsWith(prefix) && rationale.slice(prefix.length).trim().length > 0;
}

function isHighRiskPath(file: string): boolean {
  const normalized = normalizeRepoPath(file).toLowerCase();
  const highRiskTokens = [
    "auth",
    "session",
    "token",
    "password",
    "crypto",
    "oauth",
    "sso",
    "permission",
    "acl",
    "rbac",
    "csrf",
    "payment",
    "billing",
    "checkout",
    "invoice",
    "subscription",
    "webhook",
    "pii",
    "privacy",
    "admin",
    "secret",
    "credential",
    "stripe",
    "paypal",
  ];
  return (
    highRiskTokens.some((token) => normalized.includes(token)) ||
    normalized.startsWith("migrations/") ||
    normalized.includes("/migrations/") ||
    normalized === "schema.rb" ||
    normalized.endsWith("/schema.rb") ||
    normalized.endsWith("prisma/schema.prisma") ||
    /\.sql$/.test(normalized) ||
    /(^|\/)index\.[jt]sx?$/.test(normalized) ||
    normalized.includes("openapi") ||
    normalized.includes("swagger") ||
    normalized.includes("graphql") ||
    normalized.endsWith(".graphql") ||
    normalized.endsWith(".gql")
  );
}

function isDocsPath(file: string): boolean {
  const normalized = normalizeRepoPath(file).toLowerCase();
  const basename = normalized.split("/").at(-1) ?? normalized;
  return (
    normalized.startsWith("docs/") ||
    normalized.endsWith(".md") ||
    normalized.endsWith(".mdx") ||
    normalized.endsWith(".qmd") ||
    normalized.endsWith(".rst") ||
    normalized.endsWith(".adoc") ||
    ["changelog", "code_of_conduct", "contributing", "license", "readme"].includes(basename)
  );
}

function parseFlatBatchBlock(text: string): ParsedBlock {
  const out: Record<string, unknown> = {};
  const errors: string[] = [];
  const seenKeys = new Set<string>();
  const lines = text.split("\n");
  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (const [index, raw] of lines.entries()) {
    const line = stripYamlComment(raw).replace(/\s+$/, "");
    if (!line.trim()) continue;
    const scalar = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (scalar) {
      if (currentKey && currentList) out[currentKey] = currentList;
      currentKey = scalar[1];
      if (seenKeys.has(currentKey)) errors.push(`duplicate field "${currentKey}"`);
      seenKeys.add(currentKey);
      const rest = scalar[2];
      if (rest === "" || rest === undefined) {
        currentList = [];
      } else if (rest === "[]") {
        out[currentKey] = [];
        currentKey = null;
        currentList = null;
      } else if (rest.trim().startsWith("[") && rest.trim().endsWith("]")) {
        out[currentKey] = parseInlineArray(rest);
        currentKey = null;
        currentList = null;
      } else {
        out[currentKey] = parseScalarValue(rest);
        currentKey = null;
        currentList = null;
      }
      continue;
    }
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && currentList) {
      currentList.push(parseListItemValue(item[1], index + 1));
      continue;
    }
    if (/^\s*-\s*$/.test(line)) {
      errors.push(`line ${index + 1} has an empty list item`);
      continue;
    }
    errors.push(`line ${index + 1} is not valid flat batch YAML`);
    currentKey = null;
    currentList = null;
  }
  if (currentKey && currentList) out[currentKey] = currentList;
  return { errors, values: out };
}

function parseInlineArray(s: string): string[] {
  const inner = s.trim().slice(1, -1).trim();
  if (!inner) return [];
  const items = splitOutsideQuotes(inner, ",").map((item) => parseInlineArrayItemValue(item, s));
  if (items.some((item) => item.length === 0)) fail(`inline arrays must not contain empty items: ${s}`);
  return items;
}

function stripYamlComment(s: string): string {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote === "'" && ch === "'" && s[i + 1] === "'") {
      i++;
      continue;
    }
    if (shouldToggleQuote(s, i, quote)) {
      const nextQuote = ch === "'" || ch === '"' ? ch : null;
      if (nextQuote === null) continue;
      quote = quote === nextQuote ? null : quote ?? nextQuote;
      continue;
    }
    const prev = i > 0 ? s[i - 1] : "";
    if (ch === "#" && quote === null && (i === 0 || /\s/.test(prev))) {
      return s.slice(0, i);
    }
  }
  if (quote !== null) fail("unterminated quoted scalar in YAML block");
  return s;
}

function splitOutsideQuotes(s: string, delimiter: string): string[] {
  const parts: string[] = [];
  let quote: "'" | '"' | null = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote === "'" && ch === "'" && s[i + 1] === "'") {
      i++;
      continue;
    }
    if (shouldToggleQuote(s, i, quote)) {
      const nextQuote = ch === "'" || ch === '"' ? ch : null;
      if (nextQuote === null) continue;
      quote = quote === nextQuote ? null : quote ?? nextQuote;
      continue;
    }
    if (ch === delimiter && quote === null) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  if (quote !== null) fail(`unterminated quoted scalar in inline array: [${s}]`);
  return parts;
}

function shouldToggleQuote(s: string, index: number, quote: "'" | '"' | null): boolean {
  const ch = s[index];
  if (ch !== '"' && ch !== "'") return false;
  if (ch === '"' && isEscapedDoubleQuote(s, index)) return false;
  if (quote !== null) return quote === ch;
  const prev = index > 0 ? s[index - 1] : "";
  return index === 0 || /[\s:,\[]/.test(prev);
}

function isEscapedDoubleQuote(s: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && s[i] === "\\"; i--) backslashes++;
  return backslashes % 2 === 1;
}

function parseInlineArrayItemValue(s: string, source: string): string {
  const trimmed = s.trim();
  if (isMappingOrNestedCollection(trimmed)) {
    fail(`inline array item must be a scalar string, not a mapping or nested collection: ${source}`);
  }
  return parseScalarValue(s);
}

function parseListItemValue(s: string, lineNumber: number): string {
  const trimmed = s.trim();
  if (isMappingOrNestedCollection(trimmed)) {
    fail(`line ${lineNumber} list item must be a scalar string, not a mapping or nested collection`);
  }
  return parseScalarValue(s);
}

function isMappingOrNestedCollection(trimmed: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*:\s*/.test(trimmed) || trimmed.startsWith("{") || trimmed.startsWith("[");
}

function parseScalarValue(s: string): string {
  const trimmed = s.trim();
  if (trimmed.startsWith('"')) return parseDoubleQuotedScalar(trimmed);
  if (trimmed.startsWith("'")) return parseSingleQuotedScalar(trimmed);
  if (trimmed.endsWith('"') || trimmed.endsWith("'")) {
    fail(`unsupported or unterminated quoted scalar: ${trimmed}`);
  }
  return trimmed;
}

function parseDoubleQuotedScalar(s: string): string {
  if (!s.endsWith('"') || s.length === 1) fail(`unterminated double-quoted scalar: ${s}`);
  let out = "";
  for (let i = 1; i < s.length - 1; i++) {
    const ch = s[i];
    if (ch !== "\\") {
      if (ch === '"') fail(`unescaped double quote in scalar: ${s}`);
      out += ch;
      continue;
    }
    const next = s[++i];
    if (next === undefined) fail(`unterminated escape in scalar: ${s}`);
    if (next === '"' || next === "\\" || next === "/") out += next;
    else if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else fail(`unsupported escape "\\${next}" in scalar: ${s}`);
  }
  return out;
}

function parseSingleQuotedScalar(s: string): string {
  if (!s.endsWith("'") || s.length === 1) fail(`unterminated single-quoted scalar: ${s}`);
  let out = "";
  for (let i = 1; i < s.length - 1; i++) {
    const ch = s[i];
    if (ch !== "'") {
      out += ch;
      continue;
    }
    if (s[i + 1] === "'") {
      out += "'";
      i++;
      continue;
    }
    fail(`single quotes inside single-quoted scalars must be doubled: ${s}`);
  }
  return out;
}

function asExecutionMode(v: unknown, batchId: string): ExecutionMode {
  if (v === undefined || v === null || v === "") {
    fail(`batch ${batchId} has no execution_mode`);
  }
  const raw = String(v);
  const replacement = LEGACY_EXECUTION_MODE_HINTS.get(raw);
  if (replacement) {
    fail(`batch ${batchId} uses legacy execution_mode "${raw}"; use "${replacement}"`);
  }
  const mode = raw as ExecutionMode;
  if (!EXECUTION_MODES.has(mode)) {
    fail(`batch ${batchId} has invalid execution_mode "${mode}"`);
  }
  return mode;
}

function topoSortOrFail(batches: Batch[]): Batch[] {
  const ids = new Set(batches.map((b) => b.id));
  const indeg = new Map(batches.map((b) => [b.id, 0]));
  for (const b of batches) {
    for (const dep of b.depends_on) {
      if (!ids.has(dep)) continue;
      indeg.set(b.id, (indeg.get(b.id) ?? 0) + 1);
    }
  }
  const queue = batches.filter((b) => (indeg.get(b.id) ?? 0) === 0).map((b) => b.id);
  const visited = new Set<string>();
  const sorted: Batch[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    visited.add(id);
    const current = batches.find((b) => b.id === id);
    if (current) sorted.push(current);
    for (const b of batches) {
      if (b.depends_on.includes(id)) {
        indeg.set(b.id, (indeg.get(b.id) ?? 0) - 1);
        if (indeg.get(b.id) === 0) queue.push(b.id);
      }
    }
  }
  if (visited.size !== batches.length) {
    const unresolved = batches.filter((b) => !visited.has(b.id)).map((b) => b.id);
    fail(`cyclic dependency detected; unresolved: ${unresolved.join(", ")}`);
  }
  return sorted;
}

/**
 * Print the validated batch list as YAML to stdout (the default `decompose.ts`
 * dispatch). Used by Stage 3 to render the candidate DAG into the ledger
 * `## Batches` section. Each batch includes the runtime lifecycle
 * defaults (`status: pending`, `iterations: 0`, etc.) so the output can be
 * pasted directly into the ledger.
 */
export function emit(batches: Batch[]): void {
  const lines = ["batches:"];
  for (const b of batches) {
    lines.push(`  - id: ${quoteYamlScalar(b.id)}`);
    lines.push(`    name: ${quoteYamlScalar(b.name)}`);
    lines.push(`    goal: ${quoteYamlScalar(b.goal)}`);
    lines.push(`    files:`);
    for (const f of b.files) lines.push(`      - ${quoteYamlScalar(f)}`);
    if (b.depends_on.length === 0) {
      lines.push(`    depends_on: []`);
    } else {
      lines.push(`    depends_on:`);
      for (const d of b.depends_on) lines.push(`      - ${quoteYamlScalar(d)}`);
    }
    if (b.supersedes !== null) lines.push(`    supersedes: ${quoteYamlScalar(b.supersedes)}`);
    lines.push(`    execution_mode: ${b.execution_mode}`);
    lines.push(`    acceptance_tests:`);
    for (const a of b.acceptance_tests) lines.push(`      - ${quoteYamlScalar(a)}`);
    if (b.ac_mapping.length === 0) {
      lines.push(`    ac_mapping: []`);
    } else {
      lines.push(`    ac_mapping:`);
      for (const i of b.ac_mapping) lines.push(`      - ${i}`);
    }
    lines.push(`    rationale: ${b.rationale === null ? "null" : quoteYamlScalar(b.rationale)}`);
    for (const field of LEDGER_BATCH_LIFECYCLE_FIELDS) {
      lines.push(`    ${field}: ${ledgerBatchLifecycleDefaultYaml(field)}`);
    }
  }
  stdout.write(lines.join("\n") + "\n");
}

function ledgerBatchLifecycleDefaultYaml(field: LedgerBatchLifecycleField): string {
  const value = LEDGER_BATCH_LIFECYCLE_DEFAULTS[field];
  if (Array.isArray(value)) return "[]";
  if (value === null) return "null";
  return String(value);
}

/**
 * Write `Batch contract digest: sha256:<hex>` to stdout for the given
 * batches. Backs the `--candidate-contract-digest` CLI flag.
 */
export function emitContractDigest(batches: Batch[]): void {
  stdout.write(`Batch contract digest: ${contractDigest(batches)}\n`);
}

/**
 * Write `Plan digest: sha256:<hex>` to stdout for the plan file at
 * `planPath`. Backs the `--plan-digest` CLI flag. Fails the helper if the
 * file is unreadable.
 */
export function emitPlanDigest(planPath: string): void {
  let src: string;
  try {
    src = readFileSync(planPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read plan ${planPath}: ${message}`);
  }
  stdout.write(`Plan digest: ${sha256Digest(src)}\n`);
}

/**
 * Write `AC digest: sha256:<hex>` to stdout for the ledger's `## Acceptance
 * criteria` section. Backs the `--ac-digest` CLI flag.
 */
export function emitAcDigest(ledgerPath: string): void {
  stdout.write(`AC digest: ${sha256Digest(readAcceptanceCriteriaDigestPayload(ledgerPath))}\n`);
}

/**
 * Write the three-line confirmation-state report (`acceptance_criteria`,
 * `batch_contract`, `digests`) for the given ledger. Each line is one of
 * the four states `pending | confirmed | stale | blocked`. Backs the
 * `--confirmation-state` CLI flag, which Stage 4+ resumed runs read on
 * every turn to route from durable state.
 */
export function emitConfirmationState(ledgerPath: string): void {
  const report = readConfirmationState(ledgerPath);
  stdout.write(`confirmation_state:\n`);
  stdout.write(`  acceptance_criteria: ${report.acceptanceCriteria}\n`);
  stdout.write(`  batch_contract: ${report.batchContract}\n`);
  stdout.write(`  digests: ${report.digests}\n`);
}

/**
 * Structured snapshot of the ledger's durable state, suitable for direct
 * consumption by the v2 CLI front door (U4) without going through any
 * stdout-writing emitter.
 *
 * The shape is the minimal superset that `cli.ts`'s `state`, `next`, and
 * `diagnose` commands need to build their JSON responses.
 *
 * Run inside `withFailMode("throw", () => readLedgerSnapshot(...))` so a
 * malformed ledger surfaces as a recoverable `DecomposeError` instead of
 * killing the CLI process.
 */
export type LedgerSnapshot = {
  ledger_path: string;
  ledger_exists: boolean;
  /** Confirmation state report (same triple `emitConfirmationState` emits). */
  confirmation_state: {
    acceptance_criteria: ConfirmationState;
    batch_contract: ConfirmationState;
    digests: ConfirmationState;
  };
  /**
   * Pointer to the plan file recorded in frontmatter, or null when Stage 2
   * has not yet committed a plan path.
   */
  plan_path: string | null;
  /**
   * True when the ledger has at least one row in the `## Batches` fenced
   * YAML block. Stage 4 requires this.
   */
  has_batches: boolean;
  /**
   * True when every batch in `## Batches` has a terminal status
   * (`converged` or `accepted-risk`). Stage 5 entry condition.
   */
  all_batches_terminal: boolean;
  /**
   * ISO 8601 frontmatter timestamp set by Stage 5 when final review
   * completes, or null.
   */
  final_reviewed_at: string | null;
  /**
   * PR URL set by Stage 6 ship, or null.
   */
  pr_url: string | null;
  /**
   * Frontmatter `status` field. `in-progress` by default; transitions to
   * `blocked` or `shipped` per the workflow stage rules.
   */
  frontmatter_status: "in-progress" | "blocked" | "shipped" | null;
  /**
   * U6 R11: verbatim string value from the ledger frontmatter
   * `runbook_version` field. `null` when the frontmatter field is missing
   * or empty. No coercion — strings only. Compared against
   * `RUNBOOK_VERSION` from `lib/contract.ts` to derive
   * `runbook_version_skew`. Always `null` for the no-ledger case.
   */
  runbook_version: string | null;
  /**
   * U6 runbook-version skew classification. Always `null` for the
   * no-ledger case. Otherwise exactly one of:
   *
   * - `"matched"` — frontmatter value equals `RUNBOOK_VERSION`.
   * - `"missing"` — frontmatter has no `runbook_version` field.
   * - `"mismatched"` — frontmatter has a value but it does NOT equal
   *   `RUNBOOK_VERSION`.
   * - `"continuation-evidence-present"` — skew detected (missing or
   *   mismatched) BUT a complete continuation evidence row exists in
   *   `## Notes` for the current runtime version.
   */
  runbook_version_skew:
    | "matched"
    | "missing"
    | "mismatched"
    | "continuation-evidence-present"
    | null;
};

/**
 * Read the ledger and build a `LedgerSnapshot`. Returns
 * `{ ledger_exists: false, ... }` when the file does not exist; otherwise
 * may call `fail()` on a malformed ledger (which `withFailMode("throw")`
 * converts to a `DecomposeError`).
 */
export function readLedgerSnapshot(ledgerPath: string): LedgerSnapshot {
  let ledgerExists = false;
  try {
    statSync(ledgerPath);
    ledgerExists = true;
  } catch {
    // Fall through to the no-ledger snapshot below.
  }
  if (!ledgerExists) {
    return {
      ledger_path: ledgerPath,
      ledger_exists: false,
      confirmation_state: {
        acceptance_criteria: "pending",
        batch_contract: "pending",
        digests: "pending",
      },
      plan_path: null,
      has_batches: false,
      all_batches_terminal: false,
      final_reviewed_at: null,
      pr_url: null,
      frontmatter_status: null,
      runbook_version: null,
      runbook_version_skew: null,
    };
  }

  const frontmatter = readFrontmatter(ledgerPath);
  const report = readConfirmationState(ledgerPath);
  const planPath = readFrontmatterPath(frontmatter, "plan_path");
  const finalReviewedAt = readFrontmatterPath(frontmatter, "final_reviewed_at");
  const prUrl = readFrontmatterPath(frontmatter, "pr_url");

  // Frontmatter status: validate against the known set and pass through
  // any unrecognised value as null (legacy ledgers only allow the
  // three documented values, but parsing must not invent new ones).
  const rawStatus = frontmatter.status;
  let frontmatterStatus:
    | "in-progress"
    | "blocked"
    | "shipped"
    | null = null;
  if (
    rawStatus === "in-progress" ||
    rawStatus === "blocked" ||
    rawStatus === "shipped"
  ) {
    frontmatterStatus = rawStatus;
  }

  const batchesBlock = readOptionalFencedSectionBlock(ledgerPath, "Batches");
  let hasBatches = false;
  let allBatchesTerminal = false;
  if (batchesBlock !== null) {
    const rows = parseLedgerBatchRows(batchesBlock);
    hasBatches = rows.length > 0;
    if (hasBatches) {
      allBatchesTerminal = rows.every((row) => {
        const status = String(row.status ?? "").trim();
        return TERMINAL_BATCH_STATUSES.has(status);
      });
    }
  }

  const runbookVersion = readFrontmatterRunbookVersion(frontmatter);
  const runbookVersionSkew = classifyRunbookVersionSkew(
    runbookVersion,
    ledgerPath,
  );

  return {
    ledger_path: ledgerPath,
    ledger_exists: true,
    confirmation_state: {
      acceptance_criteria: report.acceptanceCriteria,
      batch_contract: report.batchContract,
      digests: report.digests,
    },
    plan_path: planPath,
    has_batches: hasBatches,
    all_batches_terminal: allBatchesTerminal,
    final_reviewed_at: finalReviewedAt,
    pr_url: prUrl,
    frontmatter_status: frontmatterStatus,
    runbook_version: runbookVersion,
    runbook_version_skew: runbookVersionSkew,
  };
}

/**
 * Verbatim string value from the ledger frontmatter `runbook_version`
 * field. Returns `null` when the field is missing, empty, or any
 * non-string value (per U6 R11: no coercion, strings only).
 *
 * Security hardening (F-U6-SEC-013, F-U6-SEC-005): the trim strips
 * ASCII whitespace AND the most common Unicode whitespace characters
 * (NBSP, ZWSP, BOM) so an attacker cannot construct a runbook_version
 * that prints identically to `RUNBOOK_VERSION` but compares unequal.
 * Values that contain a C0/C1 control byte after trimming are
 * rejected (returns null) so terminal-escape banners cannot ride a
 * field into a CLI envelope.
 */
function readFrontmatterRunbookVersion(
  frontmatter: Record<string, string | null>,
): string | null {
  if (!hasKey(frontmatter, "runbook_version")) return null;
  const value = frontmatter.runbook_version;
  if (value === null || value === undefined) return null;
  const text = stripBoundaryWhitespace(String(value));
  if (text.length === 0) return null;
  if (containsControlByte(text)) return null;
  return text;
}

/**
 * Trim ASCII whitespace plus the three Unicode whitespace characters
 * most commonly used to construct visually-identical-but-not-equal
 * strings: NBSP (U+00A0), ZWSP (U+200B), BOM / ZWNBSP (U+FEFF).
 *
 * Intentionally narrow — we are NOT normalising the entire Unicode
 * whitespace class (would risk silently collapsing operator-intent
 * differences in non-ASCII fields like `operator_decision`). Only
 * `runbook_version` and similar machine-compared identifiers route
 * through here.
 */
function stripBoundaryWhitespace(value: string): string {
  return value.replace(/^[\s ​﻿]+|[\s ​﻿]+$/g, "");
}

/**
 * Return true if `value` contains any C0 (0x00-0x1F except tab) or C1
 * (0x7F-0x9F) control byte. Tab is allowed because legitimate YAML
 * values may include it; everything else is a smell that points at
 * either a corrupted ledger or an injection attempt.
 *
 * Implemented with a code-point scan rather than a regex so the source
 * does not embed literal control bytes (which would otherwise trip
 * biome's `noControlCharactersInRegex` lint).
 */
function containsControlByte(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x09) continue; // tab is allowed
    if (code <= 0x1f) return true;
    if (code >= 0x7f && code <= 0x9f) return true;
  }
  return false;
}

/**
 * Four-state skew classifier per U6 contract:
 *
 * - `matched` — frontmatter value equals `RUNBOOK_VERSION`.
 * - `missing` — frontmatter has no `runbook_version` field.
 * - `mismatched` — frontmatter has a value but it does NOT equal
 *   `RUNBOOK_VERSION`.
 * - `continuation-evidence-present` — skew detected (missing or
 *   mismatched) BUT a complete continuation evidence row exists in
 *   `## Notes` for the current runtime version.
 *
 * Comparison is string-equality only; no semver, no integer coercion
 * (U6 R11). Continuation evidence must use the runtime version
 * `RUNBOOK_VERSION` — evidence for any other runtime version is ignored
 * (otherwise an operator could carry forward a v0→v2 escape through a
 * later v2→v3 cutover).
 */
function classifyRunbookVersionSkew(
  ledgerVersion: string | null,
  ledgerPath: string,
):
  | "matched"
  | "missing"
  | "mismatched"
  | "continuation-evidence-present" {
  if (ledgerVersion === RUNBOOK_VERSION) return "matched";

  const evidence = parseRunbookVersionContinuationEvidence(ledgerPath);
  if (
    evidence !== null &&
    evidence.ledger_version === ledgerVersion &&
    evidence.runtime_version === RUNBOOK_VERSION
  ) {
    return "continuation-evidence-present";
  }

  if (ledgerVersion === null) return "missing";
  return "mismatched";
}

/**
 * The seven required fields of a continuation evidence row per U6 R13.
 * Every field MUST be present; a missing field disqualifies the evidence
 * and the snapshot falls back to the underlying `missing` or
 * `mismatched` skew classification.
 *
 * `ledger_version` carries the verbatim frontmatter string or `null` when
 * the row documents a missing-version ledger; every other field is a
 * non-empty string.
 */
export interface RunbookVersionContinuationEvidence {
  ledger_version: string | null;
  runtime_version: string;
  operator_decision: string;
  timestamp: string;
  route_context: string;
  reference_context: string;
  accepted_risk: string;
}

/**
 * Parse the `## Notes` section for a single continuation-evidence row.
 *
 * Looks for an HTML-comment-prefixed fenced YAML block of the form:
 *
 * ```yaml
 * runbook_version_skew_continuation:
 *   ledger_version: "<value | null>"
 *   runtime_version: "<value>"
 *   operator_decision: "<actor>"
 *   timestamp: "<ISO 8601>"
 *   route_context: "<route id at the time of decision>"
 *   reference_context: "<reference file the operator consulted>"
 *   accepted_risk: "<one-line reason>"
 * ```
 *
 * Returns `null` when:
 *
 * - the ledger has no `## Notes` section, or
 * - no `<!-- runbook-version-skew-continuation -->` marker precedes any
 *   fenced YAML block in `## Notes`, or
 * - the YAML block is malformed (not a single
 *   `runbook_version_skew_continuation:` mapping), or
 * - any required field is missing or empty (partial evidence is
 *   rejected per U6 R13).
 *
 * The first complete evidence row wins; later rows are ignored so an
 * append-only Notes log cannot accumulate stale evidence that silently
 * overrides a current row.
 */
export function parseRunbookVersionContinuationEvidence(
  ledgerPath: string,
): RunbookVersionContinuationEvidence | null {
  const notesBody = readNotesBodyOrNull(ledgerPath);
  if (notesBody === null) return null;

  for (const body of markedYamlBlocksFromNotes(
    notesBody,
    NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_MARKER,
  )) {
    const evidence = parseContinuationEvidenceBlock(body);
    if (evidence !== null) return evidence;
  }
  return null;
}

function readNotesBodyOrNull(ledgerPath: string): string | null {
  let src: string;
  try {
    src = readFileSync(ledgerPath, "utf8");
  } catch {
    return null;
  }

  // U6 security hardening: the section heading must be column-zero
  // anchored so a blockquoted or fenced "## Notes" line cannot fabricate
  // a Notes scope (F-U6-SEC-001).
  const notesSection = src.match(
    /(?:^|\n)##\s+Notes\s*\n([\s\S]*?)(?=\n##\s|$)/,
  );
  if (!notesSection) return null;
  return notesSection[1];
}

function markedYamlBlocksFromNotes(
  notesBody: string,
  markerName: string,
): string[] {
  // Walk the Notes body line by line. The marker line and the opening
  // ```yaml fence must both live OUTSIDE any other column-zero fenced
  // region (F-U6-SEC-002): an attacker who wraps the marker + yaml
  // body inside a 4-backtick text-fenced display block must not get
  // their evidence honored as if it were operator-authored. The marker
  // and fence must both be column-zero.
  const lines = notesBody.split("\n");
  const bodies: string[] = [];
  let openFence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      if (openFence === null) {
        // Look backward past blank lines for the legitimate marker →
        // yaml pair. Ledger Notes evidence permits blank lines between
        // the marker comment and the opening yaml fence; require
        // column-zero marker and column-zero fence but otherwise
        // tolerate the blank-line gap. If the previous non-blank line
        // is the marker (and we are not currently inside another
        // fenced region), treat this fence as the evidence opener.
        const previousMarkerFound = findPrecedingMarker(lines, i, markerName);
        if (fence === "```" && /^```yaml/.test(line) && previousMarkerFound) {
          const body = consumeMarkedYamlFence(lines, i);
          if (body !== null) bodies.push(body);
          // Parser rejected this row — keep scanning subsequent lines
          // for the next candidate.
          // Skip past the closing fence we already located, if any.
          const closeIndex = findClosingFenceIndex(lines, i + 1, fence);
          i = closeIndex === -1 ? lines.length : closeIndex;
          continue;
        }
        openFence = fence;
        continue;
      }
      if (fence[0] === openFence[0] && fence.length >= openFence.length) {
        openFence = null;
      }
    }
  }
  return bodies;
}

/**
 * Walk backward from `index - 1`, skipping blank lines (including
 * lines that contain only ASCII whitespace), and return true iff the
 * first non-blank predecessor is the marker comment. Returns false
 * when no predecessor exists or when the predecessor is anything other
 * than the literal `<!-- runbook-version-skew-continuation -->`
 * marker. The marker must live at column zero.
 */
function findPrecedingMarker(
  lines: readonly string[],
  index: number,
  markerName: string,
): boolean {
  const escapedMarker = markerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const markerPattern = new RegExp(`^<!--\\s*${escapedMarker}\\s*-->\\s*$`);
  for (let j = index - 1; j >= 0; j--) {
    const candidate = lines[j];
    if (candidate.trim().length === 0) continue;
    return markerPattern.test(candidate);
  }
  return false;
}

function findClosingFenceIndex(
  lines: readonly string[],
  startIndex: number,
  openFence: string,
): number {
  for (let i = startIndex; i < lines.length; i++) {
    const m = lines[i].match(/^(`{3,}|~{3,})/);
    if (
      m !== null &&
      m[1][0] === openFence[0] &&
      m[1].length >= openFence.length
    ) {
      return i;
    }
  }
  return -1;
}

function consumeMarkedYamlFence(
  lines: readonly string[],
  openIndex: number,
): string | null {
  const closeIndex = findClosingFenceIndex(lines, openIndex + 1, "```");
  if (closeIndex === -1) return null;
  return lines.slice(openIndex + 1, closeIndex).join("\n");
}

function parseContinuationEvidenceBlock(
  block: string,
): RunbookVersionContinuationEvidence | null {
  const lines = block.split("\n");
  let sawHeader = false;
  const fields = new Map<string, string | null>();
  for (const raw of lines) {
    const line = stripYamlComment(raw).replace(/\s+$/, "");
    if (line.trim().length === 0) continue;
    if (!sawHeader) {
      if (
        line.trim() !==
        `${NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_ROOT_KEY}:`
      ) {
        return null;
      }
      sawHeader = true;
      continue;
    }
    const scalar = line.match(/^\s{2}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!scalar) return null;
    const key = scalar[1];
    if (fields.has(key)) return null;
    const rawValue = scalar[2].trim();
    if (rawValue.length === 0) return null;
    if (rawValue === "null" || rawValue === "~") {
      fields.set(key, null);
      continue;
    }
    let parsed: string | null;
    try {
      parsed = withFailMode("throw", () => parseScalarValue(rawValue));
    } catch {
      return null;
    }
    if (parsed === null || parsed.length === 0) return null;
    // Security hardening (F-U6-SEC-005): reject any evidence field
    // value that contains a control byte. Operator-authored values are
    // expected to be plain text; control bytes are either corruption
    // or terminal-escape injection.
    if (containsControlByte(parsed)) return null;
    fields.set(key, parsed);
  }
  if (!sawHeader) return null;

  for (const key of NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_FIELDS) {
    if (!fields.has(key)) return null;
  }
  for (const key of fields.keys()) {
    if (
      !NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_FIELDS.includes(
        key as (typeof NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_FIELDS)[number],
      )
    ) {
      return null;
    }
  }

  // Both `ledger_version` and `runtime_version` are compared
  // verbatim against frontmatter / `RUNBOOK_VERSION`. The frontmatter
  // values flow through `stripBoundaryWhitespace`, so for symmetry we
  // strip the same boundary characters on the evidence side. Without
  // this, a Unicode-whitespace-padded evidence value would fail to
  // match a legitimately-padded ledger version (F-U6-SEC-013).
  const ledgerVersionRaw = fields.get("ledger_version") ?? null;
  const ledgerVersionField =
    ledgerVersionRaw === null ? null : stripBoundaryWhitespace(ledgerVersionRaw);
  const runtimeVersionRaw = fields.get("runtime_version");
  if (typeof runtimeVersionRaw !== "string") return null;
  const runtimeVersionField = stripBoundaryWhitespace(runtimeVersionRaw);
  if (runtimeVersionField.length === 0) return null;
  const operatorDecision = fields.get("operator_decision");
  const timestamp = fields.get("timestamp");
  const routeContext = fields.get("route_context");
  const referenceContext = fields.get("reference_context");
  const acceptedRisk = fields.get("accepted_risk");
  if (
    typeof operatorDecision !== "string" ||
    typeof timestamp !== "string" ||
    typeof routeContext !== "string" ||
    typeof referenceContext !== "string" ||
    typeof acceptedRisk !== "string"
  ) {
    return null;
  }

  return {
    ledger_version: ledgerVersionField,
    runtime_version: runtimeVersionField,
    operator_decision: operatorDecision,
    timestamp,
    route_context: routeContext,
    reference_context: referenceContext,
    accepted_risk: acceptedRisk,
  };
}

function parseImplementationAttemptCheckpointEvidence(
  ledgerPath: string,
): ImplementationAttemptCheckpointEvidence[] {
  const notesBody = readNotesBodyOrNull(ledgerPath);
  if (notesBody === null) return [];
  return markedYamlBlocksFromNotes(
    notesBody,
    NOTES_IMPLEMENTATION_ATTEMPT_CHECKPOINT_MARKER,
  ).map(parseImplementationAttemptCheckpointBlock);
}

function parseImplementationAttemptCheckpointBlock(
  block: string,
): ImplementationAttemptCheckpointEvidence {
  const fields = parseTwoSpaceScalarBlock(
    block,
    NOTES_IMPLEMENTATION_ATTEMPT_CHECKPOINT_ROOT_KEY,
    "implementation attempt checkpoint evidence",
    NOTES_IMPLEMENTATION_ATTEMPT_CHECKPOINT_FIELDS,
  );
  const batchId = evidenceRequiredString(fields, "batch_id", "implementation attempt checkpoint evidence");
  const implementationCommit = evidenceRequiredString(
    fields,
    "implementation_commit",
    "implementation attempt checkpoint evidence",
  );
  const attemptLane = evidenceRequiredAttemptLane(
    fields,
    "implementation attempt checkpoint evidence",
  );
  const timestamp = evidenceRequiredString(fields, "timestamp", "implementation attempt checkpoint evidence");
  return {
    batch_id: batchId,
    implementation_commit: implementationCommit,
    attempt_lane: attemptLane,
    timestamp,
  };
}

function parseValidatorWaveCompletedEvidence(
  ledgerPath: string,
): ValidatorWaveCompletedEvidence[] {
  const notesBody = readNotesBodyOrNull(ledgerPath);
  if (notesBody === null) return [];
  return markedYamlBlocksFromNotes(
    notesBody,
    NOTES_VALIDATOR_WAVE_COMPLETED_MARKER,
  ).map(parseValidatorWaveCompletedBlock);
}

function parseValidatorWaveCompletedBlock(
  block: string,
): ValidatorWaveCompletedEvidence {
  const context = "validator wave completed evidence";
  const lines = block.split("\n");
  let sawHeader = false;
  const scalars = new Map<string, string>();
  const dispatchEvidence = new Map<string, string>();
  const lists = new Map<string, string[]>();
  let currentList:
    | (typeof NOTES_VALIDATOR_WAVE_COMPLETED_LIST_FIELDS)[number]
    | null = null;
  let inDispatchEvidence = false;

  for (const [index, raw] of lines.entries()) {
    const line = stripYamlComment(raw).replace(/\s+$/, "");
    if (line.trim().length === 0) continue;
    if (!sawHeader) {
      if (line.trim() !== `${NOTES_VALIDATOR_WAVE_COMPLETED_ROOT_KEY}:`) {
        fail(`${context} must start with ${NOTES_VALIDATOR_WAVE_COMPLETED_ROOT_KEY}:`);
      }
      sawHeader = true;
      continue;
    }

    const topScalar = line.match(/^\s{2}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (topScalar) {
      const key = topScalar[1];
      const rest = topScalar[2];
      currentList = null;
      inDispatchEvidence = false;
      if (
        NOTES_VALIDATOR_WAVE_COMPLETED_LIST_FIELDS.includes(
          key as (typeof NOTES_VALIDATOR_WAVE_COMPLETED_LIST_FIELDS)[number],
        )
      ) {
        const listKey =
          key as (typeof NOTES_VALIDATOR_WAVE_COMPLETED_LIST_FIELDS)[number];
        if (lists.has(listKey)) fail(`${context} has duplicate field "${key}"`);
        lists.set(listKey, parseEvidenceListHeader(rest, `${context} ${key}`));
        currentList = listKey;
        continue;
      }
      if (key === "dispatch_evidence") {
        if (dispatchEvidence.size > 0) {
          fail(`${context} has duplicate field "dispatch_evidence"`);
        }
        if (rest.trim().length > 0) {
          fail(`${context} dispatch_evidence must be a mapping`);
        }
        inDispatchEvidence = true;
        continue;
      }
      if (scalars.has(key)) fail(`${context} has duplicate field "${key}"`);
      scalars.set(key, parseEvidenceScalar(rest, `${context} ${key}`));
      continue;
    }

    const listItem = line.match(/^\s{4}-\s+(.*)$/);
    if (listItem && currentList !== null) {
      lists.get(currentList)?.push(parseListItemValue(listItem[1], index + 1));
      continue;
    }

    const dispatchScalar = line.match(/^\s{4}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (dispatchScalar && inDispatchEvidence) {
      const key = dispatchScalar[1];
      if (dispatchEvidence.has(key)) {
        fail(`${context} dispatch_evidence has duplicate field "${key}"`);
      }
      dispatchEvidence.set(
        key,
        parseEvidenceScalar(
          dispatchScalar[2],
          `${context} dispatch_evidence.${key}`,
        ),
      );
      continue;
    }

    fail(`${context} line ${index + 1} is not valid evidence YAML`);
  }
  if (!sawHeader) {
    fail(`${context} is missing ${NOTES_VALIDATOR_WAVE_COMPLETED_ROOT_KEY}:`);
  }

  const result = {
    batch_id: evidenceRequiredString(scalars, "batch_id", context),
    implementation_commit: evidenceRequiredString(
      scalars,
      "implementation_commit",
      context,
    ),
    attempt_lane: evidenceRequiredAttemptLane(scalars, context),
    personas: evidenceRequiredList(lists, "personas", context),
    dispatch_evidence: {
      role: evidenceRequiredString(dispatchEvidence, "role", `${context} dispatch_evidence`),
      target_id: evidenceRequiredString(
        dispatchEvidence,
        "target_id",
        `${context} dispatch_evidence`,
      ),
      cli_route_id: evidenceRequiredString(
        dispatchEvidence,
        "cli_route_id",
        `${context} dispatch_evidence`,
      ),
    },
    outcome: evidenceRequiredString(scalars, "outcome", context),
    findings: evidenceRequiredList(lists, "findings", context),
  };

  for (const key of scalars.keys()) {
    if (
      !NOTES_VALIDATOR_WAVE_COMPLETED_SCALAR_FIELDS.includes(
        key as (typeof NOTES_VALIDATOR_WAVE_COMPLETED_SCALAR_FIELDS)[number],
      )
    ) {
      fail(`${context} has unknown field "${key}"`);
    }
  }
  for (const key of lists.keys()) {
    if (
      !NOTES_VALIDATOR_WAVE_COMPLETED_LIST_FIELDS.includes(
        key as (typeof NOTES_VALIDATOR_WAVE_COMPLETED_LIST_FIELDS)[number],
      )
    ) {
      fail(`${context} has unknown list field "${key}"`);
    }
  }
  for (const key of dispatchEvidence.keys()) {
    if (
      !NOTES_VALIDATOR_WAVE_DISPATCH_EVIDENCE_FIELDS.includes(
        key as (typeof NOTES_VALIDATOR_WAVE_DISPATCH_EVIDENCE_FIELDS)[number],
      )
    ) {
      fail(`${context} dispatch_evidence has unknown field "${key}"`);
    }
  }
  validateValidatorWaveEvidenceShape(result);
  return result;
}

function parseTwoSpaceScalarBlock(
  block: string,
  header: string,
  context: string,
  allowedFields: readonly string[],
): Map<string, string> {
  const fields = new Map<string, string>();
  let sawHeader = false;
  for (const [index, raw] of block.split("\n").entries()) {
    const line = stripYamlComment(raw).replace(/\s+$/, "");
    if (line.trim().length === 0) continue;
    if (!sawHeader) {
      if (line.trim() !== `${header}:`) fail(`${context} must start with ${header}:`);
      sawHeader = true;
      continue;
    }
    const scalar = line.match(/^\s{2}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!scalar) fail(`${context} line ${index + 1} is not valid evidence YAML`);
    const key = scalar[1];
    if (fields.has(key)) fail(`${context} has duplicate field "${key}"`);
    fields.set(key, parseEvidenceScalar(scalar[2], `${context} ${key}`));
  }
  if (!sawHeader) fail(`${context} is missing ${header}:`);
  for (const key of fields.keys()) {
    if (!allowedFields.includes(key)) {
      fail(`${context} has unknown field "${key}"`);
    }
  }
  return fields;
}

function parseEvidenceScalar(rawValue: string, context: string): string {
  const raw = rawValue.trim();
  if (raw.length === 0) fail(`${context} must be a non-empty scalar`);
  const parsed = parseScalarValue(raw);
  if (parsed === null) fail(`${context} must be a non-empty scalar`);
  const text = stripBoundaryWhitespace(parsed);
  if (text.length === 0) fail(`${context} must be a non-empty scalar`);
  if (containsControlByte(text)) fail(`${context} contains a control byte`);
  return text;
}

function parseEvidenceListHeader(rawValue: string, context: string): string[] {
  const raw = rawValue.trim();
  if (raw.length === 0) return [];
  if (raw === "[]") return [];
  if (raw.startsWith("[") && raw.endsWith("]")) return parseInlineArray(raw);
  fail(`${context} must be a list`);
}

function evidenceRequiredString(
  fields: Map<string, string>,
  key: string,
  context: string,
): string {
  const value = fields.get(key);
  if (value === undefined) fail(`${context} is missing required field "${key}"`);
  return value;
}

function evidenceRequiredList(
  lists: Map<string, string[]>,
  key: string,
  context: string,
): string[] {
  const value = lists.get(key);
  if (value === undefined) fail(`${context} is missing required field "${key}"`);
  if (value.some((item) => item.trim().length === 0)) {
    fail(`${context} field "${key}" must contain non-empty strings`);
  }
  return value;
}

function evidenceRequiredAttemptLane(
  fields: Map<string, string>,
  context: string,
): AttemptLane {
  const lane = evidenceRequiredString(fields, "attempt_lane", context);
  if (!ATTEMPT_LANES.has(lane)) {
    fail(`${context} has invalid attempt_lane "${lane}"`);
  }
  return lane as AttemptLane;
}

function validateValidatorWaveEvidenceShape(
  evidence: ValidatorWaveCompletedEvidence,
): void {
  const context = `validator wave completed evidence for batch ${evidence.batch_id}`;
  if (evidence.dispatch_evidence.role !== "validator") {
    fail(`${context} dispatch_evidence.role must be validator`);
  }
  if (evidence.dispatch_evidence.cli_route_id !== "packet.validator") {
    fail(`${context} dispatch_evidence.cli_route_id must be packet.validator`);
  }
  const target = evidence.dispatch_evidence.target_id.match(/^([^@]+)@(.+)$/);
  if (!target) fail(`${context} dispatch_evidence.target_id must be <batch>@<commit>`);
  if (target[1] !== evidence.batch_id) {
    fail(`${context} dispatch_evidence.target_id batch does not match batch_id`);
  }
  const targetCommit = validateReachableCommit(
    target[2],
    `${context} dispatch_evidence.target_id commit`,
  );
  const implementationCommit = validateReachableCommit(
    evidence.implementation_commit,
    `${context} implementation commit`,
  );
  if (targetCommit !== implementationCommit) {
    fail(`${context} dispatch_evidence.target_id commit does not match implementation_commit`);
  }
  if (!VALIDATOR_WAVE_OUTCOMES.includes(evidence.outcome as (typeof VALIDATOR_WAVE_OUTCOMES)[number])) {
    fail(`${context} has invalid outcome "${evidence.outcome}"`);
  }
  if (evidence.outcome === "clean" && evidence.findings.length > 0) {
    fail(`${context} with outcome clean must use findings: []`);
  }
  const personas = new Set(evidence.personas);
  for (const persona of ALWAYS_ON_VALIDATOR_PERSONAS) {
    if (!personas.has(persona)) {
      fail(`${context} is missing always-on persona "${persona}"`);
    }
  }
}

function readConfirmationState(ledgerPath: string): ConfirmationStateReport {
  const frontmatter = readFrontmatter(ledgerPath);
  const acceptanceCriteria = readAcceptanceCriteriaState(ledgerPath, frontmatter);
  const batchContract = readBatchContractState(ledgerPath, frontmatter);
  return {
    acceptanceCriteria,
    batchContract,
    digests: readDigestState(ledgerPath, frontmatter, acceptanceCriteria, batchContract),
  };
}

function readAcceptanceCriteriaState(ledgerPath: string, frontmatter: Record<string, string | null>): ConfirmationState {
  const storedState = readFrontmatterConfirmationState(frontmatter, "ac_confirmation_status");
  if (storedState === "blocked") return "blocked";
  if (storedState === "stale") return "stale";
  if (storedState === "pending") return "pending";

  const storedDigest = readFrontmatterDigest(frontmatter, "ac_digest");
  if (storedDigest === null) return "pending";

  const currentDigest = readAcceptanceCriteriaDigestOrNull(ledgerPath);
  if (currentDigest === null) return "stale";
  return currentDigest === storedDigest ? "confirmed" : "stale";
}

function readBatchContractState(ledgerPath: string, frontmatter: Record<string, string | null>): ConfirmationState {
  const storedState = readFrontmatterConfirmationState(frontmatter, "batch_contract_confirmation_status");
  if (storedState === "blocked") return "blocked";
  if (storedState === "stale") return "stale";
  if (hasOpenStage3Blocker(ledgerPath)) return "blocked";
  if (storedState === "pending") return "pending";

  const storedDigest = readFrontmatterDigest(frontmatter, "batch_contract_digest");
  if (storedDigest === null) return "pending";

  const ledgerDigest = readLedgerBatchContractDigestOrNull(ledgerPath);
  if (ledgerDigest !== null) return ledgerDigest === storedDigest ? "confirmed" : "stale";

  if (storedState === "confirmed") {
    const candidateDigest = readCandidateBatchContractDigestOrNull(frontmatter);
    if (candidateDigest === null) return "stale";
    return candidateDigest === storedDigest ? "confirmed" : "stale";
  }

  return "pending";
}

function readDigestState(
  ledgerPath: string,
  frontmatter: Record<string, string | null>,
  acceptanceCriteria: ConfirmationState,
  batchContract: ConfirmationState,
): ConfirmationState {
  if (acceptanceCriteria === "blocked" || batchContract === "blocked") return "blocked";
  if (acceptanceCriteria === "stale" || batchContract === "stale") return "stale";

  const storedPlanDigest = readFrontmatterDigest(frontmatter, "plan_digest");
  const storedAcDigest = readFrontmatterDigest(frontmatter, "ac_digest");
  const storedBatchContractDigest = readFrontmatterDigest(frontmatter, "batch_contract_digest");
  if (storedPlanDigest === null || storedAcDigest === null || storedBatchContractDigest === null) return "pending";

  const currentPlanDigest = readPlanDigestOrNull(frontmatter);
  const currentAcDigest = readAcceptanceCriteriaDigestOrNull(ledgerPath);
  const currentBatchContractDigest =
    readLedgerBatchContractDigestOrNull(ledgerPath) ?? readCandidateBatchContractDigestOrNull(frontmatter);

  if (currentPlanDigest === null || currentAcDigest === null || currentBatchContractDigest === null) return "stale";
  if (
    currentPlanDigest !== storedPlanDigest ||
    currentAcDigest !== storedAcDigest ||
    currentBatchContractDigest !== storedBatchContractDigest
  ) {
    return "stale";
  }
  return "confirmed";
}

function readFrontmatter(ledgerPath: string): Record<string, string | null> {
  const src = readFileText(ledgerPath, "ledger");
  const match = src.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) fail(`ledger ${ledgerPath} has no frontmatter block`);

  const frontmatter: Record<string, string | null> = {};
  for (const [index, raw] of match[1].split("\n").entries()) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const field = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!field) fail(`ledger ${ledgerPath} frontmatter line ${index + 1} is not a key/value pair`);
    if (hasKey(frontmatter, field[1])) {
      fail(`ledger ${ledgerPath} frontmatter has duplicate field "${field[1]}"`);
    }
    frontmatter[field[1]] = parseFrontmatterScalar(field[2]);
  }
  return frontmatter;
}

function parseFrontmatterScalar(raw: string): string | null {
  const text = raw.trim();
  if (text === "" || text === "null" || text === "~") return null;
  return parseScalarValue(text);
}

function readFrontmatterConfirmationState(
  frontmatter: Record<string, string | null>,
  key: string,
): ConfirmationState | null {
  const value = frontmatter[key];
  if (value === undefined || value === null) return null;
  if (!CONFIRMATION_STATES.has(value as ConfirmationState)) {
    fail(`frontmatter field "${key}" has invalid confirmation state "${value}"`);
  }
  return value as ConfirmationState;
}

function readFrontmatterDigest(frontmatter: Record<string, string | null>, key: string): string | null {
  const value = frontmatter[key];
  if (value === undefined || value === null) return null;
  if (!/^sha256:[0-9a-f]{64}$/i.test(value)) fail(`frontmatter field "${key}" has invalid digest "${value}"`);
  return value;
}

function readFrontmatterPath(frontmatter: Record<string, string | null>, key: string): string | null {
  const value = frontmatter[key];
  if (value === undefined || value === null) return null;
  if (value.trim().length === 0) return null;
  return value;
}

function readPlanDigestOrNull(frontmatter: Record<string, string | null>): string | null {
  const planPath = readFrontmatterPath(frontmatter, "plan_path");
  if (planPath === null) return null;
  let src: string;
  try {
    src = readFileSync(planPath, "utf8");
  } catch {
    return null;
  }
  return sha256Digest(src);
}

function readCandidateBatchContractDigestOrNull(frontmatter: Record<string, string | null>): string | null {
  const planPath = readFrontmatterPath(frontmatter, "plan_path");
  if (planPath === null) return null;
  try {
    readFileSync(planPath, "utf8");
  } catch {
    return null;
  }
  return nonExiting(() => contractDigest(parse(planPath)));
}

function readAcceptanceCriteriaDigestOrNull(ledgerPath: string): string | null {
  const payload = readAcceptanceCriteriaDigestPayloadOrNull(ledgerPath);
  return payload === null ? null : sha256Digest(payload);
}

function readAcceptanceCriteriaDigestPayloadOrNull(ledgerPath: string): string | null {
  const src = readFileText(ledgerPath, "ledger");
  const acSection = src.match(/##\s+Acceptance criteria\s*\n([\s\S]*?)(?=\n##\s|$)/);
  if (!acSection) return null;
  const payload = acSection[1].replace(/\r\n/g, "\n").trim();
  if (!/^\s*-\s*\[[ x]\]\s+/m.test(payload)) return null;
  return payload;
}

function readLedgerBatchContractDigestOrNull(ledgerPath: string): string | null {
  const block = readOptionalFencedSectionBlock(ledgerPath, "Batches");
  if (block === null) return null;
  const rows = parseLedgerBatchRows(block);
  if (rows.length === 0) return null;
  for (const [index, row] of rows.entries()) validateLedgerBatchMetadata(row, index + 1);
  const batches = ledgerRowsToBatches(rows);
  validateLedgerBatchContracts(rows, batches);
  for (const [index, row] of rows.entries()) validateLedgerBatchAttemptInvariants(row, batches[index], index + 1);
  return contractDigest(batches);
}

function hasOpenStage3Blocker(ledgerPath: string): boolean {
  const block = readOptionalFencedSectionBlock(ledgerPath, "Findings data");
  if (block === null) return false;
  const rows = parseSimpleFindingsRows(block);
  return rows.some(
    (row) =>
      row.batch_id === STAGE_3_BATCH_ID &&
      row.status === "open" &&
      (row.severity === "P0" || row.severity === "P1"),
  );
}

function parseSimpleFindingsRows(block: string): Record<string, string | null>[] {
  const meaningfulLines = block
    .split("\n")
    .map((line) => stripYamlComment(line).trim())
    .filter((line) => line.length > 0);
  if (meaningfulLines.length === 1 && meaningfulLines[0] === "findings: []") return [];

  const rows: Record<string, string | null>[] = [];
  let current: Record<string, string | null> | null = null;
  function flushRow(): void {
    if (current) rows.push(current);
    current = null;
  }

  for (const [index, raw] of block.split("\n").entries()) {
    const line = stripYamlComment(raw).replace(/\s+$/, "");
    if (!line.trim() || /^\s*findings:\s*$/.test(line)) continue;
    const firstField = line.match(/^\s*-\s+id:\s*(.+)$/);
    if (firstField) {
      flushRow();
      current = { id: parseFrontmatterScalar(firstField[1]) };
      continue;
    }
    if (!current) fail(`findings data line ${index + 1} appears before the first finding id`);
    const scalar = line.match(/^\s{4}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!scalar) fail(`findings data line ${index + 1} is not valid findings YAML`);
    current[scalar[1]] = parseFrontmatterScalar(scalar[2]);
  }
  flushRow();
  return rows;
}

function readFileText(filePath: string, label: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read ${label} ${filePath}: ${message}`);
  }
}

function readAcceptanceCriteriaDigestPayload(ledgerPath: string): string {
  let src: string;
  try {
    src = readFileSync(ledgerPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read ledger ${ledgerPath}: ${message}`);
  }
  const acSection = src.match(/##\s+Acceptance criteria\s*\n([\s\S]*?)(?=\n##\s|$)/);
  if (!acSection) fail(`ledger ${ledgerPath} has no '## Acceptance criteria' section`);
  const payload = acSection[1].replace(/\r\n/g, "\n").trim();
  if (!/^\s*-\s*\[[ x]\]\s+/m.test(payload)) {
    fail(`ledger ${ledgerPath} '## Acceptance criteria' section has no checkbox items`);
  }
  return payload;
}

function quoteYamlScalar(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"')}"`;
}

function countAcsInLedger(ledgerPath: string): number {
  let src: string;
  try {
    src = readFileSync(ledgerPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read ledger ${ledgerPath}: ${message}`);
  }
  const acSection = src.match(/##\s+Acceptance criteria\s*\n([\s\S]*?)(?=\n##\s|$)/);
  if (!acSection) fail(`ledger ${ledgerPath} has no '## Acceptance criteria' section`);
  const checkboxes = [...acSection[1].matchAll(/^\s*-\s*\[[ x]\]\s+/gm)];
  if (checkboxes.length === 0) fail(`ledger ${ledgerPath} '## Acceptance criteria' section has no checkbox items`);
  return checkboxes.length;
}

/**
 * Parse and fully validate the ledger's `## Batches` section, returning the
 * confirmed-state context the patch-proposal flow needs:
 * - `allIds`: every confirmed batch id (rejects collisions with patch ids)
 * - `terminalSuccessIds`: ids of batches in `converged` or `accepted-risk`
 * - `files`: every file the confirmed batches own (for new-file detection)
 * - `terminalImplementationCommits` / `terminalImplementationCommitsById`:
 *   reachable Builder or inline commits anchored to terminal batches, for
 *   finding-resolution checks.
 *
 * Fails if `## Batches` is missing, empty, or violates any of the ledger
 * batch invariants (metadata shape, supersedes acyclicity, builder-attempts
 * integrity, etc.).
 */
export function readLedgerBatchContext(ledgerPath: string): LedgerBatchContext {
  const allIds = new Set<string>();
  const terminalSuccessIds = new Set<string>();
  const files = new Set<string>();
  const terminalImplementationCommits = new Set<string>();
  const terminalImplementationCommitsById = new Map<string, Set<string>>();
  const rows = parseLedgerBatchRows(readFencedSectionBlock(ledgerPath, "Batches"));
  if (rows.length === 0) fail(`ledger ${ledgerPath} has no confirmed batch ids`);
  for (const [index, row] of rows.entries()) {
    validateLedgerBatchMetadata(row, index + 1);
  }
  const batches = ledgerRowsToBatches(rows);
  validateLedgerBatchContracts(rows, batches);
  for (const [index, row] of rows.entries()) {
    validateLedgerBatchAttemptInvariants(row, batches[index], index + 1);
  }
  for (const [index, row] of rows.entries()) {
    const status = requiredString(row, "status", `ledger batch ${index + 1}`);
    const id = batches[index]?.id ?? requiredString(row, "id", `ledger batch ${index + 1}`);
    allIds.add(id);
    for (const file of batches[index]?.files ?? []) files.add(validateRepoRelativePath(file, id));
    if (status === "converged" || status === "accepted-risk") {
      terminalSuccessIds.add(id);
      addTerminalImplementationCommits(row, id, terminalImplementationCommits, terminalImplementationCommitsById);
    }
  }
  return { allIds, files, terminalImplementationCommits, terminalImplementationCommitsById, terminalSuccessIds };
}

function readOptionalLedgerBatchContext(ledgerPath: string): LedgerBatchContext {
  const block = readOptionalFencedSectionBlock(ledgerPath, "Batches");
  if (block === null) return emptyLedgerBatchContext();
  const rows = parseLedgerBatchRows(block);
  if (rows.length === 0) return emptyLedgerBatchContext();
  for (const [index, row] of rows.entries()) validateLedgerBatchMetadata(row, index + 1);
  const batches = ledgerRowsToBatches(rows);
  validateLedgerBatchContracts(rows, batches);
  for (const [index, row] of rows.entries()) {
    validateLedgerBatchAttemptInvariants(row, batches[index], index + 1);
  }
  const allIds = new Set<string>();
  const terminalSuccessIds = new Set<string>();
  const files = new Set<string>();
  const terminalImplementationCommits = new Set<string>();
  const terminalImplementationCommitsById = new Map<string, Set<string>>();
  for (const [index, batch] of batches.entries()) {
    allIds.add(batch.id);
    for (const file of batch.files) files.add(validateRepoRelativePath(file, batch.id));
    const status = requiredString(rows[index], "status", `ledger batch ${index + 1}`);
    if (status === "converged" || status === "accepted-risk") {
      terminalSuccessIds.add(batch.id);
      addTerminalImplementationCommits(rows[index], batch.id, terminalImplementationCommits, terminalImplementationCommitsById);
    }
  }
  return { allIds, files, terminalImplementationCommits, terminalImplementationCommitsById, terminalSuccessIds };
}

function emptyLedgerBatchContext(): LedgerBatchContext {
  return {
    allIds: new Set(),
    files: new Set(),
    terminalImplementationCommits: new Set(),
    terminalImplementationCommitsById: new Map(),
    terminalSuccessIds: new Set(),
  };
}

function addTerminalImplementationCommits(
  row: Record<string, unknown>,
  batchId: string,
  allCommits: Set<string>,
  commitsById: Map<string, Set<string>>,
): void {
  const commitSet = new Set<string>();
  for (const commit of row.builder_commits as unknown[]) {
    const text = String(commit).trim();
    const resolved = validateReachableCommit(text, `ledger batch ${batchId} builder commit`);
    allCommits.add(resolved);
    commitSet.add(resolved);
  }
  for (const attempt of requiredOrchestratorInlineAttempts(row, `ledger batch ${batchId}`)) {
    const resolved = validateReachableCommit(attempt.commit_sha, `ledger batch ${batchId} orchestrator_inline_attempts commit`);
    allCommits.add(resolved);
    commitSet.add(resolved);
  }
  commitsById.set(batchId, commitSet);
}

function batchSupersedesEntries(batches: Batch[]): SupersedesGraphEntry[] {
  return batches.map((batch, index) => ({ batch, index: index + 1, label: `batch ${batch.id}` }));
}

function validateLedgerBatchContracts(rows: Record<string, unknown>[], batches: Batch[]): void {
  validateBatchContracts(batches, { allowPatchBatches: true });
  topoSortOrFail(batches);
  validateLedgerReplacementBatchInvariants(ledgerBatchEntries(rows, batches));
}

function ledgerBatchEntries(rows: Record<string, unknown>[], batches: Batch[]): LedgerBatchEntry[] {
  if (rows.length !== batches.length) {
    fail(`ledger batch rows and parsed batches are misaligned (${rows.length} rows, ${batches.length} batches)`);
  }
  return batches.map((batch, index) => ({
    batch,
    index: index + 1,
    label: `ledger batch ${index + 1}`,
    row: rows[index] ?? fail(`ledger batch ${index + 1} has no row`),
  }));
}

function validateLedgerReplacementBatchInvariants(entries: LedgerBatchEntry[]): void {
  const entriesById = new Map(entries.map((entry) => [entry.batch.id, entry]));

  for (const { batch, index } of entries) {
    if (batch.supersedes === null) continue;
    const context = `ledger batch ${index}`;
    const superseded = entriesById.get(batch.supersedes);
    if (!superseded) fail(`${context} supersedes unknown id "${batch.supersedes}"`);
    if (superseded.batch.id.startsWith("patch-")) {
      fail(`${context} supersedes "${batch.supersedes}", but replacement batches must supersede a normal batch, not a patch batch`);
    }

    const supersededStatus = requiredString(superseded.row, "status", `ledger batch ${superseded.index}`);
    if (supersededStatus !== "blocked") {
      fail(`${context} supersedes "${batch.supersedes}", but that batch is ${supersededStatus}; replacement batches may only supersede blocked batches`);
    }

    const missingAcIndices = superseded.batch.ac_mapping.filter((acIndex) => !batch.ac_mapping.includes(acIndex));
    if (missingAcIndices.length > 0) {
      fail(`${context} must preserve superseded batch "${batch.supersedes}" AC mapping; missing AC indices: ${missingAcIndices.join(", ")}`);
    }

    const changedFields = changedReplacementFields(batch, superseded.batch);
    if (changedFields.length > 0 && batch.rationale === null) {
      fail(`${context} changes ${humanList(changedFields)} from superseded batch "${batch.supersedes}" and must include rationale prose`);
    }

    for (const dependent of entriesById.values()) {
      if (dependent.batch.id === batch.id || dependent.batch.id === batch.supersedes) continue;
      const dependsOnSuperseded = dependent.batch.depends_on.includes(batch.supersedes);
      const dependsOnReplacement = dependent.batch.depends_on.includes(batch.id);
      if (dependsOnSuperseded && dependsOnReplacement) {
        fail(
          `ledger batch ${dependent.index} depends_on both superseded batch "${batch.supersedes}" and replacement "${batch.id}"; remove the superseded dependency before confirmation`,
        );
      }
      if (!dependsOnSuperseded) continue;

      const dependentStatus = requiredString(dependent.row, "status", `ledger batch ${dependent.index}`);
      if (dependentStatus === "pending") {
        fail(
          `ledger batch ${dependent.index} is pending and still depends_on superseded batch "${batch.supersedes}"; rewrite depends_on to "${batch.id}"`,
        );
      }
      fail(
        `ledger batch ${dependent.index} is ${dependentStatus} and depends_on superseded batch "${batch.supersedes}"; stop for user action before replacing dependencies`,
      );
    }
  }
}

function validateUniqueSupersedesTargets(entries: SupersedesGraphEntry[]): void {
  const targets = new Map<string, SupersedesGraphEntry>();
  for (const entry of entries) {
    const target = entry.batch.supersedes;
    if (target === null) continue;
    const previous = targets.get(target);
    if (previous) {
      fail(`${entry.label} and ${previous.label} both supersede "${target}"; only one replacement batch may supersede a blocked batch`);
    }
    targets.set(target, entry);
  }
}

function validateAcyclicSupersedesGraph(entries: SupersedesGraphEntry[]): void {
  const supersedesById = new Map<string, string>();
  for (const entry of entries) {
    if (entry.batch.supersedes !== null) supersedesById.set(entry.batch.id, entry.batch.supersedes);
  }

  for (const entry of entries) {
    const seen = new Set<string>();
    let current: string | undefined = entry.batch.id;
    while (current !== undefined) {
      if (seen.has(current)) {
        fail(`${entry.label} participates in a supersedes cycle involving "${current}"`);
      }
      seen.add(current);
      current = supersedesById.get(current);
    }
  }
}

function changedReplacementFields(replacement: Batch, superseded: Batch): string[] {
  const changed: string[] = [];
  const replacementFiles = replacement.files.map(normalizeRepoPath);
  const supersededFiles = superseded.files.map(normalizeRepoPath);
  if (!sameStringSet(replacementFiles, supersededFiles)) changed.push("files");
  if (!sameStringSet(replacement.acceptance_tests, superseded.acceptance_tests)) changed.push("acceptance_tests");
  if (replacement.execution_mode !== superseded.execution_mode) changed.push("execution_mode");
  return changed;
}

function humanList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1] ?? ""}`;
}

/**
 * Validate the ledger's `## Batches` section end-to-end: metadata, contract
 * shape, supersedes graph, builder-attempts invariants, AC coverage. Writes
 * `Ledger batches OK: N batches` to stdout on success; fails on first
 * violation. Backs the `--validate-ledger-batches` CLI flag.
 */
export function validateLedgerBatches(ledgerPath: string): void {
  const block = readFencedSectionBlock(ledgerPath, "Batches");
  const parsedRows = parseLedgerBatchRows(block);
  if (parsedRows.length === 0) fail(`ledger ${ledgerPath} has no confirmed batches`);
  for (const [index, row] of parsedRows.entries()) validateLedgerBatchMetadata(row, index + 1);
  const batches = ledgerRowsToBatches(parsedRows);
  validateLedgerBatchContracts(parsedRows, batches);
  for (const [index, row] of parsedRows.entries()) {
    validateLedgerBatchAttemptInvariants(row, batches[index], index + 1);
  }
  validateTerminalValidatorWaveEvidence(ledgerPath, parsedRows, batches);
  validateAcCoverage(batches, ledgerPath);
  stdout.write(`Ledger batches OK: ${batches.length} batches\n`);
}

/**
 * Validate the ledger and emit the `Batch contract digest:` line for the
 * confirmed batches. Backs the `--batch-contract-digest` CLI flag and is the
 * digest source that resumed Stage 4+ runs compare against the
 * frontmatter-stored value.
 */
export function emitLedgerBatchContractDigest(ledgerPath: string): void {
  const block = readFencedSectionBlock(ledgerPath, "Batches");
  const parsedRows = parseLedgerBatchRows(block);
  if (parsedRows.length === 0) fail(`ledger ${ledgerPath} has no confirmed batches`);
  for (const [index, row] of parsedRows.entries()) validateLedgerBatchMetadata(row, index + 1);
  const batches = ledgerRowsToBatches(parsedRows);
  validateLedgerBatchContracts(parsedRows, batches);
  for (const [index, row] of parsedRows.entries()) {
    validateLedgerBatchAttemptInvariants(row, batches[index], index + 1);
  }
  validateTerminalValidatorWaveEvidence(ledgerPath, parsedRows, batches);
  emitContractDigest(batches);
}

function ledgerRowsToBatches(parsedRows: Record<string, unknown>[]): Batch[] {
  return parsedRows.map((parsed, index) => {
    const context = `ledger batch ${index + 1}`;
    const unknownKeys = Object.keys(parsed).filter((key) => !LEDGER_BATCH_KEYS.has(key));
    if (unknownKeys.length > 0) fail(`${context} has unknown field "${unknownKeys[0]}"`);
    for (const key of LEDGER_BATCH_LIFECYCLE_FIELDS) {
      if (!hasKey(parsed, key)) fail(`${context} is missing required ledger field "${key}"`);
    }
    const id = requiredString(parsed, "id", context);
    return {
      id,
      name: requiredString(parsed, "name", id),
      goal: requiredString(parsed, "goal", id),
      files: requiredArray(parsed, "files", id),
      depends_on: requiredArray(parsed, "depends_on", id),
      supersedes: optionalNullableScalar(parsed.supersedes, "supersedes"),
      execution_mode: asExecutionMode(requiredString(parsed, "execution_mode", id), id),
      acceptance_tests: requiredArray(parsed, "acceptance_tests", id),
      ac_mapping: requiredNumberArray(parsed, "ac_mapping", id),
      rationale: optionalRationale(parsed.rationale),
    };
  });
}

function validateLedgerBatchMetadata(row: Record<string, unknown>, index: number): void {
  const context = `ledger batch ${index}`;
  const status = requiredString(row, "status", context);
  if (!BATCH_STATUSES.has(status)) fail(`${context} has invalid status "${status}"`);
  if (!Array.isArray(row.builder_commits)) fail(`${context} field "builder_commits" must be a list`);
  for (const commit of row.builder_commits) {
    const text = String(commit).trim();
    if (text.length === 0) fail(`${context} field "builder_commits" must contain non-empty commit refs`);
    validateReachableCommit(text, `${context} builder commit`);
  }
  requiredBuilderAttempts(row, context);
  requiredOrchestratorInlineAttempts(row, context);
  const iterations = requiredString(row, "iterations", context);
  if (!/^\d+$/.test(iterations) || !Number.isSafeInteger(Number(iterations))) {
    fail(`${context} field "iterations" must be a non-negative integer`);
  }
  const finalVerdict = optionalRationale(row.final_verdict);
  if (finalVerdict !== null && !FINAL_VERDICTS.has(finalVerdict)) {
    fail(`${context} has invalid final_verdict "${finalVerdict}"`);
  }
  if (status === "converged" && finalVerdict !== "converged") {
    fail(`${context} with status converged must use final_verdict: converged`);
  }
  if (status === "accepted-risk" && finalVerdict !== "accepted-risk") {
    fail(`${context} with status accepted-risk must use final_verdict: accepted-risk`);
  }
  if (status === "blocked" && finalVerdict !== "blocked-for-user") {
    fail(`${context} with status blocked must use final_verdict: blocked-for-user`);
  }
  if ((status === "pending" || status === "in-progress") && finalVerdict !== null) {
    fail(`${context} with status ${status} must use final_verdict: null`);
  }
  if (TERMINAL_BATCH_STATUSES.has(status) && Number(iterations) < 1) {
    fail(`${context} with status ${status} must have iterations greater than zero`);
  }
}

function requiredBuilderAttempts(row: Record<string, unknown>, context: string): BuilderAttempt[] {
  const value = row.builder_attempts;
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${context} field "builder_attempts" must be a list`);
  return value.map((attempt, index) => {
    if (attempt === null || typeof attempt !== "object" || Array.isArray(attempt)) {
      fail(`${context} builder_attempts item ${index + 1} must be a mapping`);
    }
    const parsed = attempt as Record<string, unknown>;
    const attemptContext = `${context} builder_attempts item ${index + 1}`;
    const unknownKeys = Object.keys(parsed).filter((key) => !BUILDER_ATTEMPT_KEYS.has(key));
    if (unknownKeys.length > 0) fail(`${attemptContext} has unknown builder_attempts field "${unknownKeys[0]}"`);
    for (const key of BUILDER_ATTEMPT_KEYS) {
      if (!hasKey(parsed, key)) fail(`${attemptContext} is missing required field "${key}"`);
    }
    return {
      attempt_type: requiredString(parsed, "attempt_type", attemptContext),
      status: requiredString(parsed, "status", attemptContext),
      commit_sha: requiredNullableString(parsed, "commit_sha", attemptContext),
      files_touched: requiredArray(parsed, "files_touched", attemptContext),
      route_hint: requiredNullableString(parsed, "route_hint", attemptContext),
      blockers: requiredArray(parsed, "blockers", attemptContext),
      probe_results: requiredArray(parsed, "probe_results", attemptContext),
      notes: requiredString(parsed, "notes", attemptContext),
    };
  });
}

function requiredOrchestratorInlineAttempts(row: Record<string, unknown>, context: string): OrchestratorInlineAttempt[] {
  const value = row.orchestrator_inline_attempts;
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${context} field "orchestrator_inline_attempts" must be a list`);
  return value.map((attempt, index) => {
    if (attempt === null || typeof attempt !== "object" || Array.isArray(attempt)) {
      fail(`${context} orchestrator_inline_attempts item ${index + 1} must be a mapping`);
    }
    const parsed = attempt as Record<string, unknown>;
    const attemptContext = `${context} orchestrator_inline_attempts item ${index + 1}`;
    const unknownKeys = Object.keys(parsed).filter((key) => !ORCHESTRATOR_INLINE_ATTEMPT_KEYS.has(key));
    if (unknownKeys.length > 0) {
      fail(`${attemptContext} has unknown orchestrator_inline_attempts field "${unknownKeys[0]}"`);
    }
    for (const key of ORCHESTRATOR_INLINE_ATTEMPT_KEYS) {
      if (!hasKey(parsed, key)) fail(`${attemptContext} is missing required field "${key}"`);
    }
    return {
      commit_sha: requiredString(parsed, "commit_sha", attemptContext),
      files_touched: requiredArray(parsed, "files_touched", attemptContext),
      notes: requiredString(parsed, "notes", attemptContext),
    };
  });
}

function requiredNullableString(parsed: Record<string, unknown>, key: string, context: string): string | null {
  if (!hasKey(parsed, key)) fail(`${context} is missing required field "${key}"`);
  const value = parsed[key];
  if (value === null || value === undefined || value === "null") return null;
  if (Array.isArray(value)) fail(`${context} field "${key}" must be a scalar or null`);
  const text = String(value).trim();
  if (text.length === 0) fail(`${context} field "${key}" must be non-empty when not null`);
  return text;
}

function validateLedgerBatchAttemptInvariants(row: Record<string, unknown>, batch: Batch, index: number): void {
  const context = `ledger batch ${index}`;
  const status = requiredString(row, "status", context);
  const iterationsText = requiredString(row, "iterations", context);
  const iterations = Number(iterationsText);
  const attempts = requiredBuilderAttempts(row, context);
  const inlineAttempts = requiredOrchestratorInlineAttempts(row, context);
  const builderCommitRefs = requiredArrayLike(row.builder_commits, "builder_commits", context);
  const resolvedBuilderCommits = builderCommitRefs.map((commit) => validateReachableCommit(commit, `${context} builder commit`));
  rejectDuplicates(resolvedBuilderCommits, `${context} builder_commits`);
  const totalImplementationAttempts = attempts.length + inlineAttempts.length;

  if (totalImplementationAttempts > MAX_BUILDER_ATTEMPTS) {
    fail(`${context} must not have more than ${MAX_BUILDER_ATTEMPTS} total implementation attempts`);
  }
  if (iterations !== totalImplementationAttempts) {
    fail(`${context} iterations must equal total implementation attempts count (${totalImplementationAttempts})`);
  }

  for (const attempt of attempts) {
    if (!BUILDER_ATTEMPT_TYPES.has(attempt.attempt_type)) {
      fail(`${context} has invalid builder_attempts attempt_type "${attempt.attempt_type}"`);
    }
    if (!BUILDER_ATTEMPT_STATUSES.has(attempt.status)) {
      fail(`${context} has invalid builder_attempts status "${attempt.status}"`);
    }
    rejectDuplicates(attempt.files_touched.map((file) => validateRepoRelativePath(file, batch.id)), `${context} files_touched`);
    if (attempt.status === "committed" && attempt.commit_sha === null) {
      fail(`${context} committed attempts must include commit_sha`);
    }
    if (FAIL_STOP_ATTEMPT_STATUSES.has(attempt.status) && attempt.commit_sha !== null) {
      fail(`${context} fail-stop attempts must use commit_sha: null`);
    }
  }

  const batchFiles = new Set(batch.files.map((file) => validateRepoRelativePath(file, batch.id)));
  const committedAttemptCommits = new Map<string, BuilderAttempt>();
  for (const attempt of attempts.filter((item) => item.status === "committed")) {
    if (attempt.commit_sha === null) continue;
    const resolved = validateReachableCommit(attempt.commit_sha, `${context} builder_attempts commit`);
    if (committedAttemptCommits.has(resolved)) {
      fail(`${context} has duplicate committed builder_attempts for commit "${attempt.commit_sha}"`);
    }
    assertContentBearingAttemptCommit(attempt.commit_sha, resolved, `${context} builder_attempts commit`);
    committedAttemptCommits.set(resolved, attempt);

    const persistedFiles = attempt.files_touched.map((file) => validateRepoRelativePath(file, batch.id));
    const derivedFiles = touchedFilesForCommit(attempt.commit_sha, `${context} builder_attempts commit`);
    const unauthorized = [...new Set([...persistedFiles, ...derivedFiles])].filter((file) => !batchFiles.has(file));
    if (unauthorized.length > 0) {
      fail(`${context} builder_attempts commit "${attempt.commit_sha}" touches files outside confirmed batch files: ${unauthorized.join(", ")}`);
    }
    if (!sameStringSet(persistedFiles, derivedFiles)) {
      fail(`${context} builder_attempts commit "${attempt.commit_sha}" files_touched does not match git diff`);
    }
  }

  const builderCommitSet = new Set(resolvedBuilderCommits);
  const inlineAttemptCommits = new Map<string, OrchestratorInlineAttempt>();
  for (const attempt of inlineAttempts) {
    rejectDuplicates(attempt.files_touched.map((file) => validateRepoRelativePath(file, batch.id)), `${context} orchestrator_inline_attempts files_touched`);
    const resolved = validateReachableCommit(attempt.commit_sha, `${context} orchestrator_inline_attempts commit`);
    if (inlineAttemptCommits.has(resolved)) {
      fail(`${context} has duplicate orchestrator_inline_attempts for commit "${attempt.commit_sha}"`);
    }
    if (builderCommitSet.has(resolved)) {
      fail(`${context} orchestrator_inline_attempts commit "${attempt.commit_sha}" is recorded in builder_commits`);
    }
    assertContentBearingAttemptCommit(attempt.commit_sha, resolved, `${context} orchestrator_inline_attempts commit`);
    inlineAttemptCommits.set(resolved, attempt);

    const persistedFiles = attempt.files_touched.map((file) => validateRepoRelativePath(file, batch.id));
    const derivedFiles = touchedFilesForCommit(attempt.commit_sha, `${context} orchestrator_inline_attempts commit`);
    const unauthorized = [...new Set([...persistedFiles, ...derivedFiles])].filter((file) => !batchFiles.has(file));
    if (unauthorized.length > 0) {
      fail(
        `${context} orchestrator_inline_attempts commit "${attempt.commit_sha}" touches files outside confirmed batch files: ${unauthorized.join(", ")}`,
      );
    }
    if (!sameStringSet(persistedFiles, derivedFiles)) {
      fail(`${context} orchestrator_inline_attempts commit "${attempt.commit_sha}" files_touched does not match git diff`);
    }
  }
  for (const [resolved, attempt] of committedAttemptCommits.entries()) {
    if (!builderCommitSet.has(resolved)) {
      fail(`${context} builder_attempts commit "${attempt.commit_sha}" is missing from builder_commits`);
    }
  }
  for (const [index, resolved] of resolvedBuilderCommits.entries()) {
    if (!committedAttemptCommits.has(resolved)) {
      fail(`${context} builder_commits entry "${builderCommitRefs[index]}" has no committed builder_attempts item`);
    }
  }
  if (TERMINAL_BATCH_STATUSES.has(status) && committedAttemptCommits.size + inlineAttemptCommits.size === 0) {
    fail(`${context} with status ${status} must include at least one committed implementation attempt`);
  }
}

function validateTerminalValidatorWaveEvidence(
  ledgerPath: string,
  rows: Record<string, unknown>[],
  batches: Batch[],
): void {
  if (!ledgerUsesCurrentRunbookVersion(ledgerPath)) return;

  const checkpoints = indexImplementationAttemptCheckpoints(
    parseImplementationAttemptCheckpointEvidence(ledgerPath),
  );
  const completedWaves = indexValidatorWaveCompletedEvidence(
    parseValidatorWaveCompletedEvidence(ledgerPath),
  );

  for (const [index, row] of rows.entries()) {
    const batch = batches[index];
    const status = requiredString(row, "status", `ledger batch ${index + 1}`);
    if (!TERMINAL_BATCH_STATUSES.has(status)) continue;

    for (const attempt of requiredBuilderAttempts(row, `ledger batch ${index + 1}`)) {
      if (attempt.status !== "committed" || attempt.commit_sha === null) continue;
      validateCommittedAttemptValidatorEvidence({
        batchId: batch.id,
        commitRef: attempt.commit_sha,
        lane: "builder_attempts",
        checkpoints,
        completedWaves,
        context: `ledger batch ${index + 1} builder_attempts commit "${attempt.commit_sha}"`,
      });
    }

    for (const attempt of requiredOrchestratorInlineAttempts(row, `ledger batch ${index + 1}`)) {
      validateCommittedAttemptValidatorEvidence({
        batchId: batch.id,
        commitRef: attempt.commit_sha,
        lane: "orchestrator_inline_attempts",
        checkpoints,
        completedWaves,
        context: `ledger batch ${index + 1} orchestrator_inline_attempts commit "${attempt.commit_sha}"`,
      });
    }
  }
}

/**
 * True when the run is proceeding under the CURRENT runtime contract, so the
 * Validator-wave evidence floor (R5/R6, ADR 0003) applies. This gates
 * `validateTerminalValidatorWaveEvidence`: skip enforcement only for genuinely
 * legacy ledgers the router blocks anyway.
 *
 * Keyed on the skew CLASSIFICATION, not raw frontmatter equality. A
 * `continuation-evidence-present` ledger carries an old frontmatter
 * `runbook_version` string but an operator-authored continuation row that
 * authorizes the current runtime — `classifyRoute` lets it proceed, so the
 * always-on wave floor must apply to it too. Comparing the raw frontmatter
 * string to `RUNBOOK_VERSION` would silently disarm the floor for exactly the
 * ledgers an operator deliberately re-opened (the skew-gate-widens-evidence-bypass
 * seam): the signal that authorizes continuing was invisible to the floor.
 *
 * `missing` / `mismatched` return false: the router returns
 * `blocked-runbook-version-skew` for those, so they never reach a terminal
 * converged batch through the happy path, and a pre-evidence-machinery legacy
 * ledger should not be retroactively failed for fields that did not exist when
 * it was authored.
 */
function ledgerUsesCurrentRunbookVersion(ledgerPath: string): boolean {
  const frontmatter = nonExiting(() => readFrontmatter(ledgerPath));
  if (frontmatter === null) return false;
  const ledgerVersion = readFrontmatterRunbookVersion(frontmatter);
  const skew = nonExiting(() =>
    classifyRunbookVersionSkew(ledgerVersion, ledgerPath),
  );
  return skew === "matched" || skew === "continuation-evidence-present";
}

function indexImplementationAttemptCheckpoints(
  evidenceRows: ImplementationAttemptCheckpointEvidence[],
): Set<string> {
  const keys = new Set<string>();
  for (const evidence of evidenceRows) {
    const key = implementationEvidenceKey(
      evidence.batch_id,
      evidence.implementation_commit,
      evidence.attempt_lane,
      "implementation attempt checkpoint evidence",
    );
    if (keys.has(key)) {
      fail(`duplicate implementation attempt checkpoint evidence for ${humanEvidenceKey(key)}`);
    }
    keys.add(key);
  }
  return keys;
}

function indexValidatorWaveCompletedEvidence(
  evidenceRows: ValidatorWaveCompletedEvidence[],
): Set<string> {
  const keys = new Set<string>();
  for (const evidence of evidenceRows) {
    const key = implementationEvidenceKey(
      evidence.batch_id,
      evidence.implementation_commit,
      evidence.attempt_lane,
      "validator wave completed evidence",
    );
    if (keys.has(key)) {
      fail(`duplicate completed Validator-wave evidence for ${humanEvidenceKey(key)}`);
    }
    keys.add(key);
  }
  return keys;
}

function validateCommittedAttemptValidatorEvidence(input: {
  batchId: string;
  commitRef: string;
  lane: AttemptLane;
  checkpoints: Set<string>;
  completedWaves: Set<string>;
  context: string;
}): void {
  const key = implementationEvidenceKey(
    input.batchId,
    input.commitRef,
    input.lane,
    input.context,
  );
  if (!input.checkpoints.has(key)) {
    fail(`${input.context} is missing implementation attempt checkpoint evidence`);
  }
  if (!input.completedWaves.has(key)) {
    fail(`${input.context} is missing completed Validator-wave evidence`);
  }
}

function implementationEvidenceKey(
  batchId: string,
  commitRef: string,
  lane: AttemptLane,
  context: string,
): string {
  const resolved = validateReachableCommit(commitRef, context);
  return `${batchId}\0${resolved}\0${lane}`;
}

function humanEvidenceKey(key: string): string {
  const [batchId, commitRef, lane] = key.split("\0");
  return `batch ${batchId} ${lane} commit ${commitRef}`;
}

function requiredArrayLike(value: unknown, key: string, context: string): string[] {
  if (!Array.isArray(value)) fail(`${context} field "${key}" must be a list`);
  const items = value.map((item) => String(item).trim());
  if (items.some((item) => item.length === 0)) fail(`${context} field "${key}" must contain non-empty items`);
  return items;
}

function sameStringSet(left: string[], right: string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== rightSet.size) return false;
  return [...leftSet].every((item) => rightSet.has(item));
}

function touchedFilesForCommit(ref: string, context: string): string[] {
  const diff = spawnSync("git", ["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", "-M", ref], {
    encoding: "utf8",
  });
  if (diff.status !== 0) fail(`${context} "${ref}" touched files could not be read from git`);
  const files = new Set<string>();
  for (const raw of diff.stdout.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const parts = line.split("\t").filter((part) => part.length > 0);
    if (parts.length < 2) continue;
    const status = parts[0];
    const touched = status.startsWith("R") || status.startsWith("C") ? parts.slice(1) : [parts[1]];
    for (const file of touched) files.add(validateRepoRelativePath(file, context));
  }
  return [...files];
}

function validateReachableCommit(ref: string, context: string): string {
  if (!/^[0-9a-f]{7,40}$/i.test(ref)) fail(`${context} "${ref}" must be a 7-40 character hex commit ref`);
  const exists = spawnSync("git", ["cat-file", "-e", `${ref}^{commit}`], { stdio: "ignore" });
  if (exists.status !== 0) fail(`${context} "${ref}" must exist in the current git repo`);
  const reachable = spawnSync("git", ["merge-base", "--is-ancestor", ref, "HEAD"], { stdio: "ignore" });
  if (reachable.status !== 0) fail(`${context} "${ref}" must be reachable from HEAD`);
  const resolved = spawnSync("git", ["rev-parse", `${ref}^{commit}`], { encoding: "utf8" });
  if (resolved.status !== 0) fail(`${context} "${ref}" could not be resolved in the current git repo`);
  return resolved.stdout.trim();
}

function parentCountForCommit(ref: string, context: string): number {
  const parents = spawnSync("git", ["rev-list", "--parents", "-n", "1", ref], {
    encoding: "utf8",
  });
  if (parents.status !== 0) fail(`${context} "${ref}" parents could not be read from git`);
  const parts = parents.stdout.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) fail(`${context} "${ref}" parents could not be read from git`);
  return parts.length - 1;
}

function parseLedgerBatchRows(block: string): Record<string, unknown>[] {
  const meaningfulLines = block
    .split("\n")
    .map((line) => stripYamlComment(line).trim())
    .filter((line) => line.length > 0);
  if (meaningfulLines.length === 1 && meaningfulLines[0] === "batches: []") return [];

  const rows: Record<string, unknown>[] = [];
  let current: Record<string, unknown> | null = null;
  let currentKey: string | null = null;
  let currentList: string[] | null = null;
  let currentAttempts: Record<string, unknown>[] | null = null;
  let currentAttemptsKey: string | null = null;
  let currentAttempt: Record<string, unknown> | null = null;
  let currentAttemptKey: string | null = null;
  let currentAttemptList: string[] | null = null;

  function currentAttemptLane(): string {
    return currentAttemptsKey ?? "attempts";
  }

  function flushAttemptList(): void {
    if (currentAttempt && currentAttemptKey && currentAttemptList) {
      currentAttempt[currentAttemptKey] = currentAttemptList;
    }
    currentAttemptKey = null;
    currentAttemptList = null;
  }

  function flushAttempt(): void {
    flushAttemptList();
    if (currentAttempt) {
      if (!currentAttempts) fail(`ledger ${currentAttemptLane()} entry appears outside ${currentAttemptLane()}`);
      currentAttempts.push(currentAttempt);
    }
    currentAttempt = null;
  }

  function flushList(): void {
    if (current && currentKey && currentList) current[currentKey] = currentList;
    currentKey = null;
    currentList = null;
  }

  function flushRow(): void {
    flushAttempt();
    flushList();
    if (current) rows.push(current);
    current = null;
    currentAttempts = null;
    currentAttemptsKey = null;
  }

  for (const [index, raw] of block.split("\n").entries()) {
    const line = stripYamlComment(raw).replace(/\s+$/, "");
    if (!line.trim() || /^\s*batches:\s*$/.test(line)) continue;
    const firstField = line.match(/^\s*-\s+id:\s*(.+)$/);
    if (firstField) {
      flushRow();
      current = { id: parseScalarValue(firstField[1]) };
      continue;
    }
    if (!current) fail(`ledger batches line ${index + 1} appears before the first batch id`);
    const scalar = line.match(/^\s{4}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (scalar) {
      flushAttempt();
      flushList();
      const key = scalar[1];
      if (hasKey(current, key)) fail(`ledger batch ${current.id ?? "unknown"} has duplicate field "${key}"`);
      const rest = scalar[2];
      if ((key === "builder_attempts" || key === "orchestrator_inline_attempts") && (rest === "" || rest === undefined)) {
        currentAttempts = [];
        currentAttemptsKey = key;
        current[key] = currentAttempts;
      } else {
        currentAttempts = null;
        currentAttemptsKey = null;
        if (rest === "" || rest === undefined) {
          currentKey = key;
          currentList = [];
        } else if (rest === "[]") {
          current[key] = [];
        } else if (rest.trim().startsWith("[") && rest.trim().endsWith("]")) {
          current[key] = parseInlineArray(rest);
        } else {
          current[key] = parseScalarValue(rest);
        }
      }
      continue;
    }
    const attemptFirstField = line.match(/^\s{6}-\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (attemptFirstField && currentAttempts) {
      flushAttempt();
      const key = attemptFirstField[1];
      const rest = attemptFirstField[2];
      currentAttempt = {};
      if (hasKey(currentAttempt, key)) fail(`ledger ${currentAttemptLane()} entry has duplicate field "${key}"`);
      if (rest === "" || rest === undefined) {
        currentAttemptKey = key;
        currentAttemptList = [];
      } else if (rest === "[]") {
        currentAttempt[key] = [];
      } else if (rest.trim().startsWith("[") && rest.trim().endsWith("]")) {
        currentAttempt[key] = parseInlineArray(rest);
      } else {
        currentAttempt[key] = parseScalarValue(rest);
      }
      continue;
    }
    const attemptScalar = line.match(/^\s{8}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (attemptScalar && currentAttempt) {
      flushAttemptList();
      const key = attemptScalar[1];
      if (hasKey(currentAttempt, key)) fail(`ledger ${currentAttemptLane()} entry has duplicate field "${key}"`);
      const rest = attemptScalar[2];
      if (rest === "" || rest === undefined) {
        currentAttemptKey = key;
        currentAttemptList = [];
      } else if (rest === "[]") {
        currentAttempt[key] = [];
      } else if (rest.trim().startsWith("[") && rest.trim().endsWith("]")) {
        currentAttempt[key] = parseInlineArray(rest);
      } else {
        currentAttempt[key] = parseScalarValue(rest);
      }
      continue;
    }
    const attemptItem = line.match(/^\s{10}-\s+(.*)$/);
    if (attemptItem && currentAttemptList) {
      currentAttemptList.push(parseListItemValue(attemptItem[1], index + 1));
      continue;
    }
    const item = line.match(/^\s{6}-\s+(.*)$/);
    if (item && currentList) {
      currentList.push(parseListItemValue(item[1], index + 1));
      continue;
    }
    fail(`ledger batches line ${index + 1} is not valid ledger batch YAML`);
  }
  flushRow();
  return rows;
}

/**
 * Validate the ledger's `## Findings data` and `## Findings` table together,
 * including superseded/canonical-finding selection, severity/status pairing,
 * and resolution-format rules per status. Writes
 * `Findings data OK: N findings, M open P0/P1` to stdout on success.
 *
 * When `options.assertNoOpenP0P1` is true, additionally fails if any open
 * P0/P1 finding remains — backs the `--assert-no-open-p0p1` CLI flag used
 * before convergence and ship transitions.
 */
export function validateFindingsData(ledgerPath: string, options: { assertNoOpenP0P1?: boolean } = {}): void {
  const batchContext = readOptionalLedgerBatchContext(ledgerPath);
  const findings = parseFindingsData(ledgerPath, batchContext);
  validateFindingsTable(ledgerPath, findings);
  const openP0P1 = findings.filter((finding) => isOpenP0P1(finding)).length;
  if (options.assertNoOpenP0P1 && openP0P1 > 0) {
    fail(`findings data has ${openP0P1} open P0/P1 blocker${openP0P1 === 1 ? "" : "s"}`);
  }
  stdout.write(`Findings data OK: ${findings.length} findings, ${openP0P1} open P0/P1\n`);
}

function parseFindingsData(ledgerPath: string, batchContext: LedgerBatchContext): Finding[] {
  const block = readFencedSectionBlock(ledgerPath, "Findings data");
  const meaningfulLines = block
    .split("\n")
    .map((line) => stripYamlComment(line).trim())
    .filter((line) => line.length > 0);
  if (meaningfulLines.length === 1 && meaningfulLines[0] === "findings: []") return [];
  if (meaningfulLines.includes("findings: []")) fail("findings data cannot mix findings: [] with finding rows");
  const rows: Record<string, unknown>[] = [];
  let current: Record<string, unknown> | null = null;

  function flushRow(): void {
    if (current) rows.push(current);
    current = null;
  }

  for (const [index, raw] of block.split("\n").entries()) {
    const line = stripYamlComment(raw).replace(/\s+$/, "");
    if (!line.trim() || /^\s*findings:\s*$/.test(line)) continue;
    const firstField = line.match(/^\s*-\s+id:\s*(.+)$/);
    if (firstField) {
      flushRow();
      current = { id: parseScalarValue(firstField[1]) };
      continue;
    }
    if (!current) fail(`findings data line ${index + 1} appears before the first finding id`);
    const scalar = line.match(/^\s{4}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!scalar) fail(`findings data line ${index + 1} is not valid findings YAML`);
    const key = scalar[1];
    if (hasKey(current, key)) fail(`finding ${current.id ?? "unknown"} has duplicate field "${key}"`);
    current[key] = parseScalarValue(scalar[2]);
  }
  flushRow();

  const findings = rows.map((row, index) => validateFindingRow(row, index + 1, batchContext));
  rejectDuplicates(
    findings.map((finding) => finding.id),
    "findings data ids",
  );
  validateSupersededTargets(findings);
  validateUniqueNonSupersededFindings(findings);
  validateCanonicalFindingSelection(findings);
  return findings;
}

function validateSupersededTargets(findings: Finding[]): void {
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  for (const finding of findings) {
    if (finding.status !== "superseded" || finding.resolution === null) continue;
    const target = finding.resolution.replace(/^superseded-by-/, "");
    if (target === finding.id) fail(`finding "${finding.id}" cannot supersede itself`);
    const targetFinding = byId.get(target);
    if (!targetFinding) fail(`finding "${finding.id}" supersedes unknown finding "${target}"`);
    if (targetFinding.status === "superseded") {
      fail(`finding "${finding.id}" must supersede a canonical finding`);
    }
    if (targetFinding.signature !== finding.signature) {
      fail(`finding "${finding.id}" must supersede a finding with the same signature`);
    }
    if (targetFinding.batch_id !== finding.batch_id) {
      fail(`finding "${finding.id}" must supersede a finding with the same batch_id`);
    }
    if (severityRank(targetFinding.severity) > severityRank(finding.severity)) {
      fail(`finding "${finding.id}" must not supersede a lower-severity finding`);
    }
  }
}

function severityRank(severity: string): number {
  return ["P0", "P1", "P2", "P3"].indexOf(severity);
}

function validateUniqueNonSupersededFindings(findings: Finding[]): void {
  const seen = new Map<string, Finding>();
  for (const finding of findings) {
    if (finding.status === "superseded") continue;
    const key = `${finding.batch_id}\0${finding.signature}`;
    const existing = seen.get(key);
    if (existing) {
      fail(
        `findings "${existing.id}" and "${finding.id}" share batch_id "${finding.batch_id}" and signature "${finding.signature}"; mark one superseded`,
      );
    }
    seen.set(key, finding);
  }
}

function validateCanonicalFindingSelection(findings: Finding[]): void {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = `${finding.batch_id}\0${finding.signature}`;
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const expectedCanonical = group.reduce((best, finding) =>
      severityRank(finding.severity) < severityRank(best.severity) ? finding : best,
    );
    const canonical = group.find((finding) => finding.status !== "superseded");
    if (canonical && canonical.id !== expectedCanonical.id) {
      fail(
        `finding "${expectedCanonical.id}" must be canonical for batch_id "${expectedCanonical.batch_id}" and signature "${expectedCanonical.signature}"`,
      );
    }
  }
}

function validateFindingRow(row: Record<string, unknown>, index: number, batchContext: LedgerBatchContext): Finding {
  const context = `finding ${index}`;
  const unknownKeys = Object.keys(row).filter((key) => !FINDING_KEYS.has(key));
  if (unknownKeys.length > 0) fail(`${context} has unknown field "${unknownKeys[0]}"`);
  for (const key of FINDING_KEYS) {
    if (!hasKey(row, key)) fail(`${context} is missing required field "${key}"`);
  }
  const finding: Finding = {
    id: requiredString(row, "id", context),
    batch_id: requiredString(row, "batch_id", context),
    signature: requiredString(row, "signature", context),
    persona: requiredString(row, "persona", context),
    severity: requiredString(row, "severity", context),
    status: requiredString(row, "status", context),
    summary: requiredString(row, "summary", context),
    resolution: optionalRationale(row.resolution),
  };
  if (!FINDING_SEVERITIES.has(finding.severity)) fail(`${context} has invalid severity "${finding.severity}"`);
  if (!isValidFindingStatus(finding.status)) fail(`${context} has invalid status "${finding.status}"`);
  if (finding.batch_id !== "final" && finding.batch_id !== STAGE_3_BATCH_ID && !batchContext.allIds.has(finding.batch_id)) {
    fail(`${context} has unknown batch_id "${finding.batch_id}"`);
  }
  if (finding.status === "open" && finding.resolution !== null) {
    fail(`${context} with status open must use resolution: null`);
  }
  if (finding.status !== "open" && finding.resolution === null) {
    fail(`${context} with status ${finding.status} must include a resolution`);
  }
  if ((finding.severity === "P0" || finding.severity === "P1") && finding.status.startsWith("deferred-")) {
    fail(`${context} with severity ${finding.severity} cannot use status ${finding.status}`);
  }
  if (finding.status === "deferred-P2" && finding.severity !== "P2") {
    fail(`${context} uses deferred-P2 with severity ${finding.severity}; deferred-P2 requires severity P2`);
  }
  if (finding.status === "deferred-P3" && finding.severity !== "P3") {
    fail(`${context} uses deferred-P3 with severity ${finding.severity}; deferred-P3 requires severity P3`);
  }
  validateFindingResolution(finding, context, batchContext);
  return finding;
}

function validateFindingResolution(finding: Finding, context: string, batchContext: LedgerBatchContext): void {
  const resolution = finding.resolution;
  if (finding.status === "open") return;
  if (resolution === null) fail(`${context} with status ${finding.status} must include a resolution`);
  if (finding.status === "fixed") {
    const planRevisionMatch = resolution.match(/^plan-revision ([0-9a-f]{7,40})$/i);
    if (finding.batch_id === STAGE_3_BATCH_ID) {
      if (!planRevisionMatch) {
        fail(`${context} Stage 3 fixed resolution must be "plan-revision <sha>"`);
      }
      validateReachableCommit(planRevisionMatch[1], `${context} plan revision`);
      return;
    }
    if (planRevisionMatch) {
      fail(`${context} plan-revision resolution is only valid for batch_id "${STAGE_3_BATCH_ID}"`);
    }
    const commitMatch = resolution.match(/^commit [0-9a-f]{7,40}$/i);
    const patchMatch = resolution.match(/^patch-batch (patch-\d{3})$/);
    const runbookHealMatch = resolution.match(/^runbook-heal [0-9a-f]{7,40}$/i);
    if (commitMatch) {
      const ref = resolution.slice("commit ".length);
      const resolved = validateReachableCommit(ref, `${context} fixed commit`);
      validateLedgerOwnedFixedCommit(finding, ref, resolved, context, batchContext);
      return;
    }
    if (runbookHealMatch && finding.batch_id === "final") {
      const ref = resolution.slice("runbook-heal ".length);
      const resolved = validateReachableCommit(ref, `${context} runbook-heal commit`);
      validateControlPlaneOnlyCommit(ref, resolved, context);
      return;
    }
    if (patchMatch) {
      const patchId = patchMatch[1];
      if (!batchContext.terminalSuccessIds.has(patchId)) {
        fail(`${context} fixed by ${patchId} must reference a terminal patch batch`);
      }
      return;
    }
    fail(`${context} fixed resolution must be "commit <sha>" or "patch-batch patch-NNN"`);
  }
  if (finding.status === "accepted-risk") {
    if (!resolution.startsWith("accepted-risk:") || resolution.slice("accepted-risk:".length).trim().length === 0) {
      fail(`${context} accepted-risk resolution must start with "accepted-risk:" and include a reason`);
    }
    return;
  }
  if (finding.status === "deferred-P2" && resolution !== "deferred-P2") {
    fail(`${context} deferred-P2 resolution must be "deferred-P2"`);
  }
  if (finding.status === "deferred-P3" && resolution !== "deferred-P3") {
    fail(`${context} deferred-P3 resolution must be "deferred-P3"`);
  }
  if (finding.status === "out-of-scope-for-this-issue") {
    const prefix = "out-of-scope-for-this-issue:";
    if (!resolution.startsWith(prefix) || resolution.slice(prefix.length).trim().length === 0) {
      fail(`${context} out-of-scope resolution must start with "out-of-scope-for-this-issue:" and include a reason`);
    }
  }
  if (finding.status.startsWith("ADR-contradicts-") && resolution !== finding.status) {
    fail(`${context} ADR contradiction resolution must match status "${finding.status}"`);
  }
  if (finding.status === "superseded" && !/^superseded-by-[A-Za-z0-9-]+$/.test(resolution)) {
    fail(`${context} superseded resolution must be "superseded-by-<finding-id>"`);
  }
}

function validateLedgerOwnedFixedCommit(
  finding: Finding,
  ref: string,
  resolvedRef: string,
  context: string,
  batchContext: LedgerBatchContext,
): void {
  if (finding.batch_id === "final") {
    if (!batchContext.terminalImplementationCommits.has(resolvedRef)) {
      fail(`${context} fixed commit "${ref}" must be recorded in a terminal ledger batch`);
    }
    return;
  }
  if (!batchContext.terminalImplementationCommitsById.get(finding.batch_id)?.has(resolvedRef)) {
    fail(`${context} fixed commit "${ref}" must be recorded in terminal batch "${finding.batch_id}"`);
  }
}

/**
 * Decide whether a `git diff-tree --raw` block carries at least one
 * content-bearing change, as opposed to ONLY mode-only (no-op) modifications.
 *
 * Each `--raw` line is `:<oldmode> <newmode> <oldsha> <newsha> <STATUS>\t<path...>`.
 * A pure `chmod` reports status `M` with IDENTICAL old/new blob SHAs (only the
 * mode bits differ): it proves no content delta and is the vacuous-pass class
 * this guard targets. Every other change kind is content-bearing and accepted:
 *
 *   - `A` add / `D` delete                 — structural tree change
 *   - `R` rename / `C` copy                — structural change (even a pure
 *                                            rename keeps an identical blob SHA,
 *                                            so the STATUS letter, not the SHA,
 *                                            is what distinguishes it from chmod)
 *   - `T` type-change (e.g. file→symlink)  — real change
 *   - `M` modify with DIFFERING SHAs       — real content change (covers binary
 *                                            files, which `--numstat` reports as
 *                                            `-` and cannot be summed to detect)
 *
 * Returns true if any entry is content-bearing; false if every entry is a pure
 * mode-only `M` (identical blob SHAs) or the block is empty.
 */
export function rawDiffHasContentBearingChange(rawDiffOutput: string): boolean {
  for (const raw of rawDiffOutput.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const tabIndex = line.indexOf("\t");
    if (tabIndex < 0) continue;
    const meta = line.slice(0, tabIndex).replace(/^:/, "").trim().split(/\s+/);
    if (meta.length < 5) continue;
    const oldSha = meta[2];
    const newSha = meta[3];
    const status = meta[4];
    // A pure mode-only modification is the only non-content-bearing case: the
    // STATUS is `M` and the blob SHA is unchanged. Anything else (A/D/R/C/T, or
    // `M` with a changed SHA) is a real change.
    const modeOnly = status.startsWith("M") && oldSha === newSha;
    if (!modeOnly) return true;
  }
  return false;
}

function rawDiffForCommit(ref: string, context: string): string {
  const diff = spawnSync("git", ["diff-tree", "--no-commit-id", "--raw", "-r", "--root", "-M", ref], {
    encoding: "utf8",
  });
  if (diff.status !== 0) fail(`${context} "${ref}" raw diff could not be read from git`);
  return diff.stdout;
}

/**
 * Vacuous-proof guard for a committed implementation attempt (Builder or
 * Orchestrator-inline). A committed attempt's commit is the durable evidence
 * that real implementation happened, so it must carry a real tree change.
 *
 * Two commits prove nothing and are rejected:
 * - a MERGE commit (>1 parent): `diff-tree` condenses merges by default, so a
 *   merge can emit an empty diff against its first parent — touched-file parity
 *   would then pass vacuously against `files_touched: []`.
 * - a content-empty commit (an `--allow-empty` commit, or one whose only change
 *   is a mode-bit flip): `rawDiffHasContentBearingChange` returns false.
 *
 * Without this guard a terminal batch could converge citing an empty or merge
 * commit as its sole "implementation attempt" and satisfy the
 * "at least one committed implementation attempt" terminal requirement with no
 * real work (the vacuous-proof seam). Mirrors the same guards
 * `validateControlPlaneOnlyCommit` applies on the runbook-heal resolution path.
 *
 * `resolvedRef` is the git-resolved SHA from `validateReachableCommit`; `ref` is
 * the operator-facing commit string used in diagnostics.
 */
function assertContentBearingAttemptCommit(ref: string, resolvedRef: string, context: string): void {
  if (parentCountForCommit(resolvedRef, context) > 1) {
    fail(`${context} "${ref}" is a merge commit; a committed implementation attempt must cite a single-parent commit`);
  }
  if (!rawDiffHasContentBearingChange(rawDiffForCommit(resolvedRef, context))) {
    fail(`${context} "${ref}" carries no content change (empty / mode-only); a committed implementation attempt must change content`);
  }
}

/**
 * Abuse guard for the `runbook-heal <sha>` fixed resolution: assert the cited
 * commit's diff touches ONLY control-plane paths AND carries at least one
 * content-bearing change. The allowlist is the Issue-to-PR control plane
 * (`runbooks/issue-to-pr-v2/` or `skills/issue-to-pr/`). Any touched path
 * outside the allowlist — a pure-deliverable commit, a mixed
 * control-plane+deliverable commit, or a commit touching the per-issue ledger
 * path `docs/runbooks/issue-to-pr/` (which is NOT control plane) — fails,
 * naming the first offending path.
 *
 * Merge commits are rejected before diff inspection. A merge commit can emit an
 * empty default diff against its first parent, so accepting or rejecting it via
 * touched-file side effects would make the proof ambiguous.
 *
 * A commit whose ONLY change is a mode-bit flip (chmod) proves no content
 * change and is rejected as the same vacuous-proof class the empty-commit guard
 * targets, narrowed to the per-file level. Renames, deletes, adds, copies, and
 * type-changes carry real tree changes and remain accepted.
 */
function validateControlPlaneOnlyCommit(ref: string, resolvedRef: string, context: string): void {
  const allowedPrefixes = ["runbooks/issue-to-pr-v2/", "skills/issue-to-pr/"];
  if (parentCountForCommit(resolvedRef, `${context} runbook-heal commit`) > 1) {
    fail(`${context} runbook-heal commit "${ref}" is a merge commit; a runbook-heal must cite a single-parent control-plane commit`);
  }
  const touched = touchedFilesForCommit(resolvedRef, `${context} runbook-heal commit`);
  if (touched.length === 0) {
    fail(`${context} runbook-heal commit "${ref}" changed no files; a runbook-heal must touch a control-plane path`);
  }
  for (const file of touched) {
    if (!allowedPrefixes.some((prefix) => file.startsWith(prefix))) {
      fail(`${context} runbook-heal commit "${ref}" touches non-control-plane path: ${file}`);
    }
  }
  const rawDiff = rawDiffForCommit(resolvedRef, `${context} runbook-heal commit`);
  if (!rawDiffHasContentBearingChange(rawDiff)) {
    fail(
      `${context} runbook-heal commit "${ref}" carries no content change (mode-only / no-op); a runbook-heal must change control-plane content`,
    );
  }
}

function isValidFindingStatus(status: string): boolean {
  return FINDING_STATUSES.has(status) || /^ADR-contradicts-[A-Za-z0-9-]+$/.test(status);
}

function isOpenP0P1(finding: Finding): boolean {
  return (finding.severity === "P0" || finding.severity === "P1") && finding.status === "open";
}

function validateFindingsTable(ledgerPath: string, findings: Finding[]): void {
  const tableRows = parseFindingsTableRows(ledgerPath);
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  const tableIds = new Set(tableRows.map((row) => row.id));
  rejectDuplicates(
    tableRows.map((row) => row.id),
    "findings table ids",
  );
  for (const finding of findings) {
    if (!tableIds.has(finding.id)) fail(`## Findings data row "${finding.id}" is missing from the rendered findings table`);
  }
  for (const row of tableRows) {
    const finding = byId.get(row.id);
    if (!finding) fail(`findings table row "${row.id}" is missing from ## Findings data`);
    if (finding.batch_id !== row.batch_id) {
      fail(`findings table row "${row.id}" batch_id does not match ## Findings data`);
    }
    if (finding.signature !== row.signature) {
      fail(`findings table row "${row.id}" signature does not match ## Findings data`);
    }
    if (finding.persona !== row.persona) {
      fail(`findings table row "${row.id}" persona does not match ## Findings data`);
    }
    if (finding.severity !== row.severity) {
      fail(`findings table row "${row.id}" severity does not match ## Findings data`);
    }
    if (finding.status !== row.status) {
      fail(`findings table row "${row.id}" status does not match ## Findings data`);
    }
    if (finding.summary !== row.summary) {
      fail(`findings table row "${row.id}" summary does not match ## Findings data`);
    }
    if (finding.resolution !== row.resolution) {
      fail(`findings table row "${row.id}" resolution does not match ## Findings data`);
    }
  }
}

function parseFindingsTableRows(ledgerPath: string): FindingTableRow[] {
  let src: string;
  try {
    src = readFileSync(ledgerPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read ledger ${ledgerPath}: ${message}`);
  }
  const sectionPattern = /##\s+Findings\s*\n/g;
  const sectionMatches = [...src.matchAll(sectionPattern)];
  if (sectionMatches.length > 1) fail(`ledger ${ledgerPath} has duplicate '## Findings' sections`);
  const section = src.match(/##\s+Findings\s*\n([\s\S]*?)(?=\n##\s|$)/);
  if (!section) return [];
  const rows: FindingTableRow[] = [];
  for (const raw of section[1].split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed
      .slice(1, trimmed.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length !== 8) fail(`findings table row "${cells[0] || trimmed}" must have exactly 8 columns`);
    if (cells[0] === "id" || /^-+$/.test(cells[0])) continue;
    rows.push({
      id: cells[0],
      batch_id: cells[1],
      signature: cells[2],
      persona: cells[3],
      severity: cells[4],
      status: cells[5],
      summary: cells[6],
      resolution: cells[7] === "" ? null : cells[7],
    });
  }
  return rows;
}

function readFencedSectionBlock(ledgerPath: string, sectionName: string): string {
  const block = readOptionalFencedSectionBlock(ledgerPath, sectionName);
  if (block === null) fail(`ledger ${ledgerPath} '## ${sectionName}' section has no fenced yaml block`);
  return block;
}

function readOptionalFencedSectionBlock(ledgerPath: string, sectionName: string): string | null {
  let src: string;
  try {
    src = readFileSync(ledgerPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read ledger ${ledgerPath}: ${message}`);
  }
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionPattern = new RegExp(`##\\s+${escaped}\\s*\\n`, "g");
  const sectionMatches = [...src.matchAll(sectionPattern)];
  if (sectionMatches.length > 1) fail(`ledger ${ledgerPath} has duplicate '## ${sectionName}' sections`);
  const section = src.match(new RegExp(`##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`));
  if (!section) return null;
  const blocks = [...section[1].matchAll(/```yaml[^\n]*\n([\s\S]*?)```/gi)];
  if (blocks.length > 1) fail(`ledger ${ledgerPath} '## ${sectionName}' section has multiple fenced yaml blocks`);
  const block = blocks[0];
  if (!block) return null;
  return block[1];
}

/**
 * Verify every AC index in the ledger's `## Acceptance criteria` section
 * appears in at least one batch's `ac_mapping`, and that no batch references
 * an out-of-range AC index. Writes
 * `AC coverage OK: N/N covered across K batches` on success. Backs the
 * `--validate-ac-coverage` CLI flag invoked by Stage 3.
 */
export function validateAcCoverage(batches: Batch[], ledgerPath: string): void {
  const acCount = countAcsInLedger(ledgerPath);
  const covered = new Set<number>();
  for (const b of batches) {
    for (const i of b.ac_mapping) {
      if (i < 1 || i > acCount) {
        fail(`batch ${b.id} maps to AC ${i}, but ledger has AC indices 1..${acCount}`);
      }
      covered.add(i);
    }
  }
  const missing: number[] = [];
  for (let i = 1; i <= acCount; i++) if (!covered.has(i)) missing.push(i);
  if (missing.length > 0) {
    fail(`AC coverage incomplete; missing AC indices: ${missing.join(", ")} (of ${acCount} total)`);
  }
  stdout.write(`AC coverage OK: ${acCount}/${acCount} covered across ${batches.length} batches\n`);
}

/**
 * Closed whitelist of allowed entry keys in a ledger `## Workflow Learnings`
 * fenced yaml block. This set is intentionally symmetric with the registry
 * helper's `ALLOWED_EVIDENCE_KEYS` in `lib/learnings.ts`, MINUS the `run` key
 * (the ledger IS the run, so it carries no `run` field) PLUS `signature`
 * (the cross-reference into the canonical registry entry).
 *
 * Canonical fields (`summary`, `owner`, `retirement_condition`) and lifecycle
 * fields (`disposition`, `status`, `confidence`, `follow_up`) are
 * intentionally absent: those live exclusively in the registry per PRD #88
 * and `references/workflow-learnings-registry.md`. Any of them appearing on
 * a ledger entry is a validator error.
 */
const WORKFLOW_LEARNINGS_ALLOWED_KEYS = [
  "signature",
  "affected_surface",
  "what_was_wrong",
  "discovery_method",
  "root_cause",
  "scope",
  "proposed_fix",
  "verification_idea",
] as const;

/**
 * Pick the human-readable label for a workflow_learnings entry in an error
 * message: when `signature` is a non-empty string we identify by it (operators
 * recognize a sha256 prefix or stable slug faster than an index); otherwise
 * we fall back to the 1-based position so the message still points at a row.
 */
function workflowLearningEntryLabel(entry: Record<string, unknown>, index: number): string {
  const signature = entry.signature;
  if (typeof signature === "string" && signature.length > 0) {
    return `entry "${signature}"`;
  }
  return `entry #${index + 1}`;
}

/**
 * Validate the ledger's `## Workflow Learnings` section: the section must
 * exist, contain exactly one fenced ```yaml``` block, parse to a mapping
 * with a `workflow_learnings` array at the top level, and each entry must
 * be a mapping carrying non-empty string `signature`, `affected_surface`,
 * and `what_was_wrong` plus only keys in `WORKFLOW_LEARNINGS_ALLOWED_KEYS`.
 *
 * Writes `Workflow Learnings OK: N entries\n` to stdout on success. Backs
 * the `--validate-workflow-learnings <ledger-path>` CLI flag on
 * `decompose.ts`. `workflow_learnings: []` is the valid empty case: a run
 * with no observed workflow learnings is the common path and must not throw.
 */
export function validateWorkflowLearnings(ledgerPath: string): void {
  // Existence + readability are gated up front so a missing/unreadable file
  // is the first failure surface; mirrors the readOptionalFencedSectionBlock
  // pattern used by validateFindingsData.
  let src: string;
  try {
    src = readFileSync(ledgerPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read ledger ${ledgerPath}: ${message}`);
  }
  const sectionName = "Workflow Learnings";
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionPattern = new RegExp(`##\\s+${escaped}\\s*\\n`, "g");
  const sectionMatches = [...src.matchAll(sectionPattern)];
  if (sectionMatches.length > 1) {
    fail(`ledger ${ledgerPath} has duplicate '## ${sectionName}' sections`);
  }
  const section = src.match(new RegExp(`##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`));
  if (!section) {
    fail(`ledger ${ledgerPath} has no '## ${sectionName}' section`);
  }
  const blocks = [...section[1].matchAll(/```yaml[^\n]*\n([\s\S]*?)```/gi)];
  if (blocks.length === 0) {
    fail(`ledger ${ledgerPath} '## ${sectionName}' section has no fenced yaml block`);
  }
  if (blocks.length > 1) {
    fail(`ledger ${ledgerPath} '## ${sectionName}' section has multiple fenced yaml blocks`);
  }
  const blockBody = blocks[0][1];

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(blockBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`ledger ${ledgerPath} '## ${sectionName}' yaml block did not parse: ${message}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail(`ledger ${ledgerPath} '## ${sectionName}' yaml block has no "workflow_learnings" array at the top level`);
  }
  const root = parsed as Record<string, unknown>;
  if (!hasKey(root, "workflow_learnings")) {
    fail(`ledger ${ledgerPath} '## ${sectionName}' yaml block has no "workflow_learnings" array at the top level`);
  }
  const entries = root.workflow_learnings;
  if (!Array.isArray(entries)) {
    fail(`ledger ${ledgerPath} '## ${sectionName}' field "workflow_learnings" must be an array`);
  }

  const allowedFieldList = WORKFLOW_LEARNINGS_ALLOWED_KEYS.join(", ");
  for (const [index, rawEntry] of entries.entries()) {
    if (typeof rawEntry !== "object" || rawEntry === null || Array.isArray(rawEntry)) {
      // Fallback label uses the 1-based index because no mapping means no signature.
      fail(`ledger ${ledgerPath} '## ${sectionName}' entry #${index + 1} must be a mapping of fields`);
    }
    const entry = rawEntry as Record<string, unknown>;
    const label = workflowLearningEntryLabel(entry, index);

    for (const key of Object.keys(entry)) {
      if (!(WORKFLOW_LEARNINGS_ALLOWED_KEYS as readonly string[]).includes(key)) {
        fail(
          `ledger ${ledgerPath} '## ${sectionName}' ${label} has unknown field "${key}" (allowed: ${allowedFieldList})`,
        );
      }
    }

    for (const required of ["signature", "affected_surface", "what_was_wrong"] as const) {
      const value = entry[required];
      if (typeof value !== "string" || value.trim().length === 0) {
        fail(
          `ledger ${ledgerPath} '## ${sectionName}' ${label} is missing required string field "${required}"`,
        );
      }
    }
  }

  stdout.write(`Workflow Learnings OK: ${entries.length} entries\n`);
}
