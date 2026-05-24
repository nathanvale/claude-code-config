#!/usr/bin/env bun

/**
 * Workflow Learnings registry helper entrypoint (issue #90).
 *
 * Thin flag-dispatcher over `./lib/learnings.ts`, modeled on `decompose.ts`:
 * `args[0] === "--flag"` checks, a usage `fail()` for unknown/missing flags,
 * and `exit(0)` on success.
 *
 * Flags in THIS batch:
 *   learnings-registry.ts --validate <registry-path>
 *
 * Later batches add the candidate-ingest and `--upsert` flows; only
 * `--validate` exists today.
 */

import { argv, exit, stderr, stdout } from "node:process";

import { parseRegistry, validateRegistry } from "./lib/learnings";

/** Usage-error sink: write to stderr and exit non-zero (mirrors decompose.ts `fail`). */
function fail(msg: string): never {
  stderr.write(`learnings-registry: ${msg}\n`);
  exit(1);
}

const args = argv.slice(2);

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

fail("usage: learnings-registry.ts --validate <registry-path>");
