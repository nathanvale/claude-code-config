#!/usr/bin/env bun

/**
 * Workflow Learnings registry helper entrypoint (issue #90).
 *
 * Thin flag-dispatcher over `./lib/learnings.ts`, modeled on `decompose.ts`:
 * `args[0] === "--flag"` checks, a usage `fail()` for unknown/missing flags,
 * and `exit(0)` on success.
 *
 * Flags:
 *   learnings-registry.ts --validate <registry-path>
 *   learnings-registry.ts --upsert <registry-path> <candidate-path>
 *   learnings-registry.ts --upsert-batch <registry-path> <batch-path>
 *
 * `--upsert` enforces write-scope via `assertRegistryWriteTarget` before any
 * registry read/serialize/write, so it cannot write outside the canonical
 * registry path (with a narrow tmpdir-escape for tests).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { argv, exit, stderr, stdout } from "node:process";

import {
  type Registry,
  assertRegistryWriteTarget,
  loadCandidate,
  parseRegistry,
  parseRegistryFromString,
  serializeRegistry,
  type UpsertOutcome,
  upsertWithOutcome,
  validateCandidate,
  validateRegistry,
} from "./lib/learnings";

/** Usage-error sink: write to stderr and exit non-zero (mirrors decompose.ts `fail`). */
function fail(msg: string): never {
  stderr.write(`learnings-registry: ${msg}\n`);
  exit(1);
}

const args = argv.slice(2);

type UpsertBatchOutcome = {
  signature: string;
  outcome: UpsertOutcome;
  candidate: {
    summary: unknown;
    owner: unknown;
    disposition: unknown;
    status: unknown;
    confidence: unknown;
    follow_up: unknown;
    evidence: unknown;
  };
};

if (args[0] === "--validate") {
  if (args.length !== 2) {
    fail("usage: learnings-registry.ts --validate <registry-path>");
  }
  const registryPath = args[1];
  let errors: string[];
  try {
    errors = validateRegistry(parseRegistry(registryPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message);
  }
  if (errors.length > 0) {
    // Surface every violation so a single run fixes them all; exit non-zero.
    for (const error of errors) stderr.write(`learnings-registry: ${error}\n`);
    exit(1);
  }
  stdout.write(`OK: ${registryPath} is a valid learnings registry\n`);
  exit(0);
}

if (args[0] === "--upsert") {
  if (args.length !== 3) {
    fail(
      "usage: learnings-registry.ts --upsert <registry-path> <candidate-path>",
    );
  }
  const registryPath = args[1];
  const candidatePath = args[2];

  // Load the candidate first so parse failures name the candidate file rather
  // than the registry. loadCandidate already throws actionable errors that
  // include the path.
  let candidate: unknown;
  try {
    candidate = loadCandidate(candidatePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message);
  }

  const candidateErrors = validateCandidate(candidate);
  if (candidateErrors.length > 0) {
    for (const error of candidateErrors) {
      stderr.write(`learnings-registry: ${candidatePath}: ${error}\n`);
    }
    exit(1);
  }

  // Write-scope guard (AC5): refuse any registry target outside the canonical
  // surface BEFORE we read the registry from disk or compute a write. Placed
  // after candidate validation so genuine candidate-shape errors still surface
  // first (more actionable for the operator); placed before parseRegistry so a
  // forbidden target never even reads the on-disk file.
  try {
    assertRegistryWriteTarget(registryPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message);
  }

  // Load + validate the existing registry before mutating, so an existing
  // schema violation surfaces with the registry path (not the candidate's).
  let registry: Registry;
  let beforeMarkdown: string;
  try {
    beforeMarkdown = readFileSync(registryPath, "utf8");
    registry = parseRegistry(registryPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message);
  }
  const registryErrors = validateRegistry(registry);
  if (registryErrors.length > 0) {
    for (const error of registryErrors) {
      stderr.write(`learnings-registry: ${registryPath}: ${error}\n`);
    }
    exit(1);
  }

  let updated: Registry;
  let signature: string;
  let outcome: UpsertOutcome;
  try {
    const result = upsertWithOutcome(registry, candidate);
    updated = result.registry;
    signature = result.signature;
    outcome = result.outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message);
  }

  let newMarkdown: string;
  try {
    newMarkdown = serializeRegistry(registryPath, updated);
    if (newMarkdown === beforeMarkdown) outcome = "unchanged";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message);
  }

  // Defense in depth: re-parse and re-validate the bytes we are about to
  // write BEFORE we touch disk. If the emitter ever produces yaml the parser
  // would reject (e.g. an un-escaped control byte, a corrupt mapping key,
  // an unknown shape), we abort with an actionable error and leave the
  // existing on-disk registry intact instead of silently overwriting it
  // with a corrupt file.
  try {
    const reparsed = parseRegistryFromString(
      newMarkdown,
      `<serialized-registry for ${registryPath}>`,
    );
    const reparsedErrors = validateRegistry(reparsed);
    if (reparsedErrors.length > 0) {
      stderr.write(
        `learnings-registry: refusing to write ${registryPath}: serialized output failed re-validate (registry left unchanged)\n`,
      );
      for (const error of reparsedErrors) {
        stderr.write(`learnings-registry: ${error}\n`);
      }
      exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(
      `refusing to write ${registryPath}: serialized output failed round-trip parse (registry left unchanged): ${message}`,
    );
  }

  // Persist validated, round-trip-safe bytes to the already write-scoped
  // target (refused upstream by assertRegistryWriteTarget when not canonical).
  try {
    writeFileSync(registryPath, newMarkdown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot write registry ${registryPath}: ${message}`);
  }

  stdout.write(
    `OK: upserted signature ${signature} into ${registryPath} (${outcome})\n`,
  );
  exit(0);
}

if (args[0] === "--upsert-batch") {
  if (args.length !== 3) {
    fail(
      "usage: learnings-registry.ts --upsert-batch <registry-path> <batch-path>",
    );
  }
  const registryPath = args[1];
  const batchPath = args[2];

  let batch: unknown;
  try {
    batch = loadCandidate(batchPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message);
  }

  if (
    typeof batch !== "object" ||
    batch === null ||
    Array.isArray(batch) ||
    !Array.isArray((batch as { candidates?: unknown }).candidates)
  ) {
    fail(`${batchPath}: batch must be a mapping with a "candidates" list`);
  }
  const candidates = (batch as { candidates: unknown[] }).candidates;

  const candidateErrors: string[] = [];
  candidates.forEach((candidate, index) => {
    for (const error of validateCandidate(candidate)) {
      candidateErrors.push(`candidate #${index + 1}: ${error}`);
    }
  });
  if (candidateErrors.length > 0) {
    for (const error of candidateErrors) {
      stderr.write(`learnings-registry: ${batchPath}: ${error}\n`);
    }
    exit(1);
  }

  try {
    assertRegistryWriteTarget(registryPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message);
  }

  let registry: Registry;
  let beforeMarkdown: string;
  try {
    beforeMarkdown = readFileSync(registryPath, "utf8");
    registry = parseRegistry(registryPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message);
  }
  const registryErrors = validateRegistry(registry);
  if (registryErrors.length > 0) {
    for (const error of registryErrors) {
      stderr.write(`learnings-registry: ${registryPath}: ${error}\n`);
    }
    exit(1);
  }

  const outcomes: UpsertBatchOutcome[] = [];
  let working = registry;
  let lastMarkdown = beforeMarkdown;
  try {
    for (const candidate of candidates) {
      const result = upsertWithOutcome(working, candidate);
      const candidateMarkdown = serializeRegistry(registryPath, result.registry);
      working = result.registry;
      outcomes.push({
        signature: result.signature,
        outcome:
          candidateMarkdown === lastMarkdown ? "unchanged" : result.outcome,
        candidate: candidateFacts(candidate),
      });
      lastMarkdown = candidateMarkdown;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message);
  }

  let newMarkdown: string;
  try {
    newMarkdown = lastMarkdown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message);
  }

  try {
    const reparsed = parseRegistryFromString(
      newMarkdown,
      `<serialized-registry for ${registryPath}>`,
    );
    const reparsedErrors = validateRegistry(reparsed);
    if (reparsedErrors.length > 0) {
      stderr.write(
        `learnings-registry: refusing to write ${registryPath}: serialized output failed re-validate (registry left unchanged)\n`,
      );
      for (const error of reparsedErrors) {
        stderr.write(`learnings-registry: ${error}\n`);
      }
      exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(
      `refusing to write ${registryPath}: serialized output failed round-trip parse (registry left unchanged): ${message}`,
    );
  }

  try {
    if (newMarkdown !== beforeMarkdown) writeFileSync(registryPath, newMarkdown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot write registry ${registryPath}: ${message}`);
  }

  const counts = {
    created: 0,
    updated: 0,
    unchanged: 0,
    total: outcomes.length,
  };
  for (const row of outcomes) counts[row.outcome] += 1;
  stdout.write(`${JSON.stringify({ outcomes, counts }, null, 2)}\n`);
  exit(0);
}

fail(
  "usage: learnings-registry.ts --validate <registry-path> | --upsert <registry-path> <candidate-path> | --upsert-batch <registry-path> <batch-path>",
);

function candidateFacts(candidate: unknown): UpsertBatchOutcome["candidate"] {
  const row = candidate as Record<string, unknown>;
  return {
    summary: row.summary,
    owner: row.owner,
    disposition: row.disposition,
    status: row.status,
    confidence: row.confidence,
    follow_up: row.follow_up,
    evidence: row.evidence,
  };
}
