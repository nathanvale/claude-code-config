#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { posix as pathPosix } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";

interface Batch {
  id: string;
  name: string;
  goal: string;
  files: string[];
  depends_on: string[];
  supersedes: string | null;
  execution_mode: ExecutionMode;
  acceptance_tests: string[];
  ac_mapping: number[];
  rationale: string | null;
}

interface BuilderAttempt {
  attempt_type: string;
  status: string;
  commit_sha: string | null;
  files_touched: string[];
  route_hint: string | null;
  blockers: string[];
  probe_results: string[];
  notes: string;
}

interface OrchestratorInlineAttempt {
  commit_sha: string;
  files_touched: string[];
  notes: string;
}

interface ParseOptions {
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

interface Finding {
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

interface LedgerBatchContext {
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

class DecomposeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecomposeError";
  }
}

type ConfirmationState = "pending" | "confirmed" | "stale" | "blocked";
type ExecutionMode = "tdd" | "proof_first" | "change_first";

const EXECUTION_MODES = new Set<ExecutionMode>(["tdd", "proof_first", "change_first"]);
const CONFIRMATION_STATES = new Set<ConfirmationState>(["pending", "confirmed", "stale", "blocked"]);
const LEGACY_EXECUTION_MODE_HINTS = new Map([
  ["verification_first", "proof_first"],
  ["direct", "change_first"],
]);
const BATCH_KEYS = new Set([
  "id",
  "name",
  "goal",
  "files",
  "depends_on",
  "supersedes",
  "execution_mode",
  "acceptance_tests",
  "ac_mapping",
  "rationale",
]);
const LEDGER_BATCH_KEYS = new Set([
  ...BATCH_KEYS,
  "status",
  "builder_commits",
  "builder_attempts",
  "orchestrator_inline_attempts",
  "iterations",
  "final_verdict",
]);
const BUILDER_ATTEMPT_KEYS = new Set([
  "attempt_type",
  "status",
  "commit_sha",
  "files_touched",
  "route_hint",
  "blockers",
  "probe_results",
  "notes",
]);
const ORCHESTRATOR_INLINE_ATTEMPT_KEYS = new Set(["commit_sha", "files_touched", "notes"]);
const BUILDER_ATTEMPT_TYPES = new Set(["implementation", "repair"]);
const BUILDER_ATTEMPT_STATUSES = new Set([
  "committed",
  "fail-stop-preflight",
  "fail-stop-out-of-scope",
  "fail-stop-execution-mode-mismatch",
  "fail-stop-read-failed",
  "fail-stop-other",
]);
const FAIL_STOP_ATTEMPT_STATUSES = new Set([...BUILDER_ATTEMPT_STATUSES].filter((status) => status !== "committed"));
const MAX_BUILDER_ATTEMPTS = 5;
const STAGE_3_BATCH_ID = "stage-3";
const FINDING_KEYS = new Set(["id", "batch_id", "signature", "persona", "severity", "status", "summary", "resolution"]);
const FINDING_SEVERITIES = new Set(["P0", "P1", "P2", "P3"]);
const FINDING_STATUSES = new Set([
  "open",
  "fixed",
  "accepted-risk",
  "deferred-P2",
  "deferred-P3",
  "out-of-scope-for-this-issue",
  "superseded",
]);
const BATCH_STATUSES = new Set(["pending", "in-progress", "converged", "accepted-risk", "blocked"]);
const FINAL_VERDICTS = new Set(["converged", "accepted-risk", "blocked-for-user"]);
const TERMINAL_BATCH_STATUSES = new Set(["converged", "accepted-risk"]);
const CHANGE_FIRST_EXCEPTION_PREFIX = "change_first-exception:";
const HIGH_RISK_CHANGE_FIRST_EXCEPTION_PREFIX = "high-risk-change_first-exception:";
const NEW_FILE_PATCH_EXCEPTION_PREFIX = "new-file-patch-exception:";
const HIGH_RISK_NEW_FILE_PATCH_EXCEPTION_PREFIX = "high-risk-new-file-patch-exception:";
const INVESTIGATION_RATIONALE = "out-of-scope: investigation-required";
const EXTENSIONLESS_FILE_NAMES = new Set([
  "changelog",
  "code_of_conduct",
  "contributing",
  "dockerfile",
  "gemfile",
  "justfile",
  "license",
  "makefile",
  "procfile",
  "rakefile",
  "readme",
]);
let failMode: "exit" | "throw" = "exit";

function fail(msg: string): never {
  if (failMode === "throw") throw new DecomposeError(msg);
  stderr.write(`decompose: ${msg}\n`);
  exit(1);
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

function parse(planPath: string, options: ParseOptions = {}): Batch[] {
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
    if (!looksLikeBatchCandidateBlock(block)) continue;
    const parsedBlock = parseFlatBatchBlock(block);
    const parsed = parsedBlock.values;
    if (!isBatchCandidate(parsed)) continue;
    const blockLabel = `YAML block ${index + 1}`;
    if (parsedBlock.errors.length > 0) {
      fail(`${blockLabel}: ${parsedBlock.errors.join("; ")}`);
    }
    const unknownKeys = Object.keys(parsed).filter((key) => !BATCH_KEYS.has(key));
    if (unknownKeys.length > 0) {
      fail(`${blockLabel} has unknown field "${unknownKeys[0]}"`);
    }
    const id = requiredString(parsed, "id", blockLabel);
    batches.push({
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
    });
  }

  if (batches.length === 0) {
    fail("no batches with id/name/goal found; ce-plan addendum may not have been honored");
  }

  validateBatchContracts(batches, options);
  return topoSortOrFail(batches);
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

function emit(batches: Batch[]): void {
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
    lines.push(`    status: pending`);
    lines.push(`    builder_commits: []`);
    lines.push(`    builder_attempts: []`);
    lines.push(`    orchestrator_inline_attempts: []`);
    lines.push(`    iterations: 0`);
    lines.push(`    final_verdict: null`);
  }
  stdout.write(lines.join("\n") + "\n");
}

function contractDigest(batches: Batch[]): string {
  const contract = batches.map((b) => ({
    id: b.id,
    name: b.name,
    goal: b.goal,
    files: b.files,
    depends_on: b.depends_on,
    // Omit null supersedes so legacy ledgers keep their stored digest.
    ...(b.supersedes === null ? {} : { supersedes: b.supersedes }),
    execution_mode: b.execution_mode,
    acceptance_tests: b.acceptance_tests,
    ac_mapping: b.ac_mapping,
    rationale: b.rationale,
  }));
  const payload = JSON.stringify(contract);
  return sha256Digest(payload);
}

function emitContractDigest(batches: Batch[]): void {
  stdout.write(`Batch contract digest: ${contractDigest(batches)}\n`);
}

function sha256Digest(payload: string): string {
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function emitPlanDigest(planPath: string): void {
  let src: string;
  try {
    src = readFileSync(planPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read plan ${planPath}: ${message}`);
  }
  stdout.write(`Plan digest: ${sha256Digest(src)}\n`);
}

function emitAcDigest(ledgerPath: string): void {
  stdout.write(`AC digest: ${sha256Digest(readAcceptanceCriteriaDigestPayload(ledgerPath))}\n`);
}

function emitConfirmationState(ledgerPath: string): void {
  const report = readConfirmationState(ledgerPath);
  stdout.write(`confirmation_state:\n`);
  stdout.write(`  acceptance_criteria: ${report.acceptanceCriteria}\n`);
  stdout.write(`  batch_contract: ${report.batchContract}\n`);
  stdout.write(`  digests: ${report.digests}\n`);
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

function readLedgerBatchContext(ledgerPath: string): LedgerBatchContext {
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

function validateLedgerBatches(ledgerPath: string): void {
  const block = readFencedSectionBlock(ledgerPath, "Batches");
  const parsedRows = parseLedgerBatchRows(block);
  if (parsedRows.length === 0) fail(`ledger ${ledgerPath} has no confirmed batches`);
  for (const [index, row] of parsedRows.entries()) validateLedgerBatchMetadata(row, index + 1);
  const batches = ledgerRowsToBatches(parsedRows);
  validateLedgerBatchContracts(parsedRows, batches);
  for (const [index, row] of parsedRows.entries()) {
    validateLedgerBatchAttemptInvariants(row, batches[index], index + 1);
  }
  validateAcCoverage(batches, ledgerPath);
  stdout.write(`Ledger batches OK: ${batches.length} batches\n`);
}

function emitLedgerBatchContractDigest(ledgerPath: string): void {
  const block = readFencedSectionBlock(ledgerPath, "Batches");
  const parsedRows = parseLedgerBatchRows(block);
  if (parsedRows.length === 0) fail(`ledger ${ledgerPath} has no confirmed batches`);
  for (const [index, row] of parsedRows.entries()) validateLedgerBatchMetadata(row, index + 1);
  const batches = ledgerRowsToBatches(parsedRows);
  validateLedgerBatchContracts(parsedRows, batches);
  for (const [index, row] of parsedRows.entries()) {
    validateLedgerBatchAttemptInvariants(row, batches[index], index + 1);
  }
  emitContractDigest(batches);
}

function parseLedgerBatches(ledgerPath: string): Batch[] {
  const block = readFencedSectionBlock(ledgerPath, "Batches");
  const parsedRows = parseLedgerBatchRows(block);
  if (parsedRows.length === 0) fail(`ledger ${ledgerPath} has no confirmed batches`);
  return ledgerRowsToBatches(parsedRows);
}

function ledgerRowsToBatches(parsedRows: Record<string, unknown>[]): Batch[] {
  return parsedRows.map((parsed, index) => {
    const context = `ledger batch ${index + 1}`;
    const unknownKeys = Object.keys(parsed).filter((key) => !LEDGER_BATCH_KEYS.has(key));
    if (unknownKeys.length > 0) fail(`${context} has unknown field "${unknownKeys[0]}"`);
    for (const key of [
      "status",
      "builder_commits",
      "builder_attempts",
      "orchestrator_inline_attempts",
      "iterations",
      "final_verdict",
    ]) {
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

function parentCountForCommit(ref: string, context: string): number {
  const parents = spawnSync("git", ["rev-list", "--parents", "-n", "1", ref], { encoding: "utf8" });
  if (parents.status !== 0) fail(`${context} "${ref}" parents could not be read from git`);
  const parts = parents.stdout.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) fail(`${context} "${ref}" parents could not be read from git`);
  return parts.length - 1;
}

function rawDiffForCommit(ref: string, context: string): string {
  const diff = spawnSync("git", ["diff-tree", "--no-commit-id", "--raw", "-r", "--root", "-M", ref], {
    encoding: "utf8",
  });
  if (diff.status !== 0) fail(`${context} "${ref}" raw diff could not be read from git`);
  return diff.stdout;
}

function rawDiffHasContentBearingChange(rawDiffOutput: string): boolean {
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
    // Only a pure mode-only modification (status M with unchanged blob SHA) is
    // non-content-bearing; A/D/R/C/T or M with a changed SHA is a real change.
    const modeOnly = status.startsWith("M") && oldSha === newSha;
    if (!modeOnly) return true;
  }
  return false;
}

/**
 * Vacuous-proof guard for a committed implementation attempt (Builder or
 * Orchestrator-inline): the cited commit must carry a real tree change. A merge
 * commit (>1 parent) or a content-empty commit (`--allow-empty` or mode-only)
 * proves no implementation and is rejected, so a terminal batch cannot satisfy
 * "at least one committed implementation attempt" with no real work. Mirrors the
 * v2 helper of the same name.
 */
function assertContentBearingAttemptCommit(ref: string, resolvedRef: string, context: string): void {
  if (parentCountForCommit(resolvedRef, context) > 1) {
    fail(`${context} "${ref}" is a merge commit; a committed implementation attempt must cite a single-parent commit`);
  }
  if (!rawDiffHasContentBearingChange(rawDiffForCommit(resolvedRef, context))) {
    fail(`${context} "${ref}" carries no content change (empty / mode-only); a committed implementation attempt must change content`);
  }
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

function validateFindingsData(ledgerPath: string, options: { assertNoOpenP0P1?: boolean } = {}): void {
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
    if (commitMatch) {
      const ref = resolution.slice("commit ".length);
      const resolved = validateReachableCommit(ref, `${context} fixed commit`);
      validateLedgerOwnedFixedCommit(finding, ref, resolved, context, batchContext);
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

function validateAcCoverage(batches: Batch[], ledgerPath: string): void {
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

const args = argv.slice(2);
if (args[0] === "--plan-digest") {
  if (args.length !== 2) fail("usage: decompose.ts --plan-digest <plan-path>");
  emitPlanDigest(args[1]);
  exit(0);
}
if (args[0] === "--ac-digest") {
  if (args.length !== 2) fail("usage: decompose.ts --ac-digest <ledger-path>");
  emitAcDigest(args[1]);
  exit(0);
}
if (args[0] === "--confirmation-state") {
  if (args.length !== 2) fail("usage: decompose.ts --confirmation-state <ledger-path>");
  emitConfirmationState(args[1]);
  exit(0);
}
if (args[0] === "--validate-ledger-batches") {
  if (args.length !== 2) fail("usage: decompose.ts --validate-ledger-batches <ledger-path>");
  validateLedgerBatches(args[1]);
  exit(0);
}
if (args[0] === "--batch-contract-digest") {
  if (args.length !== 2) fail("usage: decompose.ts --batch-contract-digest <ledger-path>");
  emitLedgerBatchContractDigest(args[1]);
  exit(0);
}
if (args[0] === "--validate-findings") {
  if (args.length !== 2) fail("usage: decompose.ts --validate-findings <ledger-path>");
  validateFindingsData(args[1]);
  exit(0);
}
if (args[0] === "--assert-no-open-p0p1") {
  if (args.length !== 2) fail("usage: decompose.ts --assert-no-open-p0p1 <ledger-path>");
  validateFindingsData(args[1], { assertNoOpenP0P1: true });
  exit(0);
}
const patchProposalMode = args.length === 3 && args[1] === "--patch-proposal";
const validateCoverage = args.length === 3 && args[1] === "--validate-ac-coverage";
const candidateContractDigest = args.length === 2 && args[1] === "--candidate-contract-digest";
if (
  !args[0] ||
  args[0].startsWith("-") ||
  (args.length !== 1 && !patchProposalMode && !validateCoverage && !candidateContractDigest)
) {
  fail(
    "usage: decompose.ts <plan-path> [--candidate-contract-digest | --validate-ac-coverage <ledger-path> | --patch-proposal <ledger-path>] | --plan-digest <plan-path> | --ac-digest <ledger-path> | --confirmation-state <ledger-path> | --validate-ledger-batches <ledger-path> | --batch-contract-digest <ledger-path> | --validate-findings <ledger-path> | --assert-no-open-p0p1 <ledger-path>",
  );
}

const planPath = args[0];
const validateFlag = args[1];
const ledgerPath = args[2];

const ledgerBatchContext = patchProposalMode
  ? readLedgerBatchContext(ledgerPath ?? fail("--patch-proposal requires a ledger path"))
  : undefined;
const batches = parse(planPath, {
  existingBatchIds: ledgerBatchContext?.allIds,
  externalDependencyIds: ledgerBatchContext?.terminalSuccessIds,
  externalFilePaths: ledgerBatchContext?.files,
  patchProposalMode,
});

if (candidateContractDigest) {
  emitContractDigest(batches);
} else if (validateFlag === "--validate-ac-coverage") {
  validateAcCoverage(batches, ledgerPath ?? fail("--validate-ac-coverage requires a ledger path"));
} else {
  emit(batches);
}
