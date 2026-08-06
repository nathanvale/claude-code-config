// PROTOTYPE — throwaway CLI surface sketch for `build-scratch`.
// Run examples:
//   bun prototypes/build-scratch-handoff/cli.ts --help
//   bun prototypes/build-scratch-handoff/cli.ts clean-login --dry-run
//   bun prototypes/build-scratch-handoff/cli.ts leaky-login    # exits 2, names entry
//
// This sketches the arg/flag/help/output/error/dry-run surface (cli-author
// conventions). In real life the positional is a path to a handoff JSON file;
// here it's a fixture key so the prototype is self-contained.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { FIXTURES } from "./handoff.ts";
import { buildScratch, scratchPath } from "./build-scratch.ts";

const HELP = `build-scratch — construct redacted Recorder-shaped Scratch Evidence from a
browser-use handoff.

USAGE
  build-scratch <handoff> [options]

ARGUMENTS
  <handoff>            Path to the redacted handoff JSON browser-use produced.
                      (prototype: a fixture key — clean-login | clean-checkout | leaky-login)

OPTIONS
  --memory-root <dir> Where scratch evidence is written.
                      [default: \$MEMORY_ROOT or repo/plan decision — UNPINNED]
  --timestamp <ts>    Override the YYYY-MM-DD-HHMMSS dir segment (default: now).
  --dry-run           Build + run Gate 2, print the path, but write nothing.
  -h, --help          Show this help.

OUTPUT
  Writes <memory-root>/<domain>/scratch/<ts>-<flow-slug>/flow.json
  Prints the written path on success.

EXIT CODES
  0  built (and written, unless --dry-run)
  2  Gate 2 refused the whole batch — names the offending field. Nothing written.
  1  usage error (missing handoff, unreadable file)
`;

function main(argv: string[]) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    process.stdout.write(HELP);
    process.exit(args.length === 0 ? 1 : 0);
  }

  const dryRun = args.includes("--dry-run");
  const memoryRoot = flagValue(args, "--memory-root") ?? "/tmp/scratch-proto-UNPINNED";
  const timestamp = flagValue(args, "--timestamp") ?? "2026-05-30-153000";
  const handoffKey = args.find((a) => !a.startsWith("-") && !isFlagValue(args, a));

  if (!handoffKey || !(handoffKey in FIXTURES)) {
    process.stderr.write(`error: unknown handoff '${handoffKey ?? ""}'. (prototype keys: ${Object.keys(FIXTURES).join(", ")})\n`);
    process.exit(1);
  }

  const handoff = FIXTURES[handoffKey];
  const result = buildScratch(handoff);

  if (!result.ok) {
    process.stderr.write(`REFUSED: Gate 2 deny-list hit on field '${result.hit.field}' (${result.hit.detector}: ${result.hit.reason}).\n`);
    process.stderr.write(`Whole batch refused. Nothing written. Fix Gate 1 redaction in browser-use and re-hand-off.\n`);
    process.exit(2);
  }

  const path = scratchPath(memoryRoot, handoff, timestamp);
  if (dryRun) {
    process.stdout.write(`[dry-run] would write ${path}\n`);
    process.stdout.write(JSON.stringify(result.flow, null, 2) + "\n");
    process.exit(0);
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(result.flow, null, 2));
  process.stdout.write(`wrote ${path}\n`);
  process.exit(0);
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
function isFlagValue(args: string[], val: string): boolean {
  const i = args.indexOf(val);
  return i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--dry-run";
}

main(process.argv);
