// PROTOTYPE — throwaway TUI shell. Thin layer over the pure modules.
// Run: bun prototypes/build-scratch-handoff/tui.ts
//
// Drive by hand. Each frame shows: the redacted handoff that crossed the
// boundary (Gate 1 output), then what build-scratch does with it (Gate 2 +
// Recorder JSON, or whole-batch refusal naming the offending entry).

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { FIXTURES, type RedactedHandoff } from "./handoff.ts";
import { buildScratch, scratchPath, type BuildResult } from "./build-scratch.ts";

const B = "\x1b[1m";
const D = "\x1b[2m";
const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";

// memory-root is a brainstorm/plan decision; prototype punts to a temp dir.
const MEMORY_ROOT = mkdtempSync(join(tmpdir(), "scratch-proto-"));
// Fixed timestamp so frames are stable (Date.now() avoided per prototype rules).
const TIMESTAMP = "2026-05-30-153000";

const order = ["clean-login", "clean-checkout", "leaky-login"];
let cursor = 0;
let lastWrite: string | null = null;

function render() {
  process.stdout.write("\x1b[2J\x1b[H");
  const key = order[cursor];
  const handoff = FIXTURES[key];
  const result = buildScratch(handoff);

  console.log(`${B}build-scratch handoff prototype${R}  ${D}(throwaway — temp memory-root)${R}`);
  console.log(`${D}memory-root: ${MEMORY_ROOT}${R}`);
  console.log("");
  console.log(`${B}fixture:${R} ${key}   ${D}[${cursor + 1}/${order.length}]${R}`);
  console.log("");

  renderHandoff(handoff);
  console.log("");
  renderResult(handoff, result);
  console.log("");
  console.log(
    `${B}[n]${R} ${D}next fixture${R}  ${B}[p]${R} ${D}prev${R}  ${B}[w]${R} ${D}write to disk (clean only)${R}  ${B}[q]${R} ${D}quit${R}`,
  );
  if (lastWrite) console.log(`${D}last write: ${lastWrite}${R}`);
}

function renderHandoff(h: RedactedHandoff) {
  console.log(`${B}── redacted handoff (Gate 1 output — what crossed the boundary) ──${R}`);
  console.log(`  ${B}domain${R}    ${h.domain}`);
  console.log(`  ${B}flowSlug${R}  ${h.flowSlug}`);
  console.log(`  ${B}fields${R}    ${D}(name → observed shape)${R}`);
  for (const f of h.fields) {
    const leak = !f.observed.startsWith("redacted:") && looksRaw(f.observed);
    const tag = leak ? `  ${RED}← raw value leaked past Gate 1${R}` : "";
    console.log(`    ${f.name.padEnd(14)} ${f.observed}${tag}`);
  }
  console.log(`  ${B}forks${R}     ${h.forks.map((x) => `${x.label}=${x.taken}`).join(", ") || D + "none" + R}`);
  console.log(`  ${B}auth${R}      ${h.auth.reference} ${D}@ ${h.auth.locatedAt}${R}`);
  console.log(`  ${B}stuck${R}     ${h.stuckPoint ?? D + "none" + R}`);
}

function renderResult(h: RedactedHandoff, result: BuildResult) {
  if (!result.ok) {
    console.log(`${B}── Gate 2: ${RED}REFUSED — whole batch${R}${B} ──${R}`);
    console.log(`  ${RED}offending entry:${R} ${B}${result.hit.field}${R}`);
    console.log(`  ${RED}detector:${R} ${result.hit.detector}`);
    console.log(`  ${RED}reason:${R} ${result.hit.reason}`);
    console.log(`  ${D}nothing built, nothing written. fix Gate 1 and re-hand-off.${R}`);
    return;
  }
  console.log(`${B}── Gate 2: ${GRN}clean${R}${B} → Recorder-shaped JSON build-scratch emits ──${R}`);
  const flow = result.flow;
  console.log(`  ${B}title${R} ${flow.title}`);
  console.log(`  ${B}steps${R}`);
  for (const s of flow.steps) {
    const sel = s.selectors ? D + JSON.stringify(s.selectors[0]) + R : "";
    const val = s.value ? `  value=${GRN}${s.value}${R}` : s.url ? `  url=${s.url}` : "";
    console.log(`    ${s.type.padEnd(10)} ${sel}${val}`);
  }
  console.log(`  ${B}path${R} ${D}${scratchPath(MEMORY_ROOT, h, TIMESTAMP)}${R}`);
}

/** Heuristic for the TUI badge only — Gate 2 in redaction.ts is authoritative. */
function looksRaw(v: string): boolean {
  return /hunter2|^\d{6}$|sk-live|[0-9a-f]{32,}/.test(v);
}

function writeCurrent() {
  const h = FIXTURES[order[cursor]];
  const result = buildScratch(h);
  if (!result.ok) {
    lastWrite = `refused (${result.hit.field}) — not written`;
    return;
  }
  const path = scratchPath(MEMORY_ROOT, h, TIMESTAMP);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(result.flow, null, 2));
  lastWrite = `wrote ${path}`;
}

// --- raw keystroke loop ------------------------------------------------------
const stdin = process.stdin;
stdin.setRawMode?.(true);
stdin.resume();
stdin.setEncoding("utf8");
render();
stdin.on("data", (k: string) => {
  if (k === "q" || k === "") {
    process.stdout.write("\x1b[2J\x1b[H");
    process.exit(0);
  }
  if (k === "n") cursor = (cursor + 1) % order.length;
  if (k === "p") cursor = (cursor - 1 + order.length) % order.length;
  if (k === "w") writeCurrent();
  render();
});
