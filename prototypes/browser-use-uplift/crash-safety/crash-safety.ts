/**
 * QUESTION
 * --------
 * When an agent re-drives or captures a browser flow (e.g. "submit timesheet"),
 * the run can DIE mid-flow: a crash, the browser closes, the network drops, or a
 * flaky widget never fires. The danger: a half-finished capture gets persisted as
 * a runbook, so a FUTURE run replays a CORRUPTED/partial runbook — clicking some
 * buttons but not others, or doing the wrong thing entirely.
 *
 * Can a COMMIT BOUNDARY guarantee that durable memory is written ONLY when a run
 * COMPLETES and its success-verification passes (confirmed) — so a crashed/partial
 * run leaves NO poisoned partial behind, and a crash mid-OVERWRITE never clobbers
 * a known-good runbook? Like a DB transaction that rolls back on failure.
 *
 * Models durable memory + scratch journal as in-memory objects; a "crash" is a
 * thrown error partway through a run (caught — we then prove scratch is abandoned).
 * No browser, network, files, or Date.now(). Deterministic. Pure TS, zero deps.
 * Run: bun crash-safety.ts
 */

// ---- Domain model ----------------------------------------------------------

interface Step {
  index: number;
  action: string;
}

interface Runbook {
  domain: string;
  steps: Step[];
  complete: boolean; // only ever true once fully captured + verified
  verifiedBy: string; // success-signal reason it was committed under
}

// Reused from the success-verify sibling: a terminal run is one of three.
type Outcome = "confirmed" | "failed" | "ambiguous";

// ---- Durable memory + scratch journal (in-memory) --------------------------

// DURABLE: the only thing a future replay reads. Must never hold a partial.
const durable = new Map<string, Runbook>();

// A run captures steps into its OWN scratch journal. Crashing throws away the
// journal; durable is never touched until the atomic swap.
interface ScratchJournal {
  domain: string;
  captured: Step[];
}

// ---- The commit boundary ---------------------------------------------------

interface RunSpec {
  domain: string;
  plannedSteps: string[]; // full intended flow
  crashAtStep?: number; // throw when this 1-based step is reached
  finalOutcome: Outcome; // success-verification result at the end
}

class RunCrashed extends Error {}

/**
 * Stage every step into a fresh scratch journal. If we reach `crashAtStep` we
 * throw — the journal is a local, so it's garbage-collected, never persisted.
 */
function captureIntoScratch(spec: RunSpec): ScratchJournal {
  const journal: ScratchJournal = { domain: spec.domain, captured: [] };
  for (let i = 0; i < spec.plannedSteps.length; i++) {
    const stepNo = i + 1;
    if (spec.crashAtStep === stepNo) {
      throw new RunCrashed(
        `run died at step ${stepNo}/${spec.plannedSteps.length} (${spec.plannedSteps[i]})`,
      );
    }
    journal.captured.push({ index: stepNo, action: spec.plannedSteps[i] });
  }
  return journal;
}

interface CommitResult {
  committed: boolean;
  reason: string;
  outcome: Outcome | "crashed";
}

/**
 * COMMIT BOUNDARY. Stage to scratch → verify completion → atomically swap into
 * durable ONLY on `confirmed`. Anything else (crash / failed / ambiguous) leaves
 * durable byte-for-byte UNCHANGED. The new runbook is built FULLY in scratch and
 * the durable reference is swapped in one assignment — durable is never mutated
 * in place, so a crash can't leave it half-written.
 */
function runWithCommitBoundary(spec: RunSpec): CommitResult {
  let journal: ScratchJournal;
  try {
    journal = captureIntoScratch(spec);
  } catch (err) {
    // Crash mid-flow: scratch journal is abandoned, durable untouched.
    const msg = err instanceof RunCrashed ? err.message : String(err);
    return { committed: false, reason: `discarded scratch — ${msg}`, outcome: "crashed" };
  }

  // Run reached the end. Now the success-verification gate (confirmed/failed/ambiguous).
  if (spec.finalOutcome !== "confirmed") {
    return {
      committed: false,
      reason: `verification=${spec.finalOutcome} — scratch discarded, durable unchanged`,
      outcome: spec.finalOutcome,
    };
  }

  // Build the complete runbook in scratch, then swap the reference atomically.
  const verifiedReason = `confirmed after ${journal.captured.length} steps`;
  const staged: Runbook = {
    domain: journal.domain,
    steps: journal.captured,
    complete: true,
    verifiedBy: verifiedReason,
  };
  durable.set(staged.domain, staged); // single atomic swap of the reference
  return { committed: true, reason: verifiedReason, outcome: "confirmed" };
}

// ---- The invariant ---------------------------------------------------------

/**
 * After ANY scenario, durable holds EITHER the previous good runbook OR a fully
 * complete, verified one — NEVER a partial. Throws if a partial ever leaks in.
 */
function assertNoPartial(domain: string, label: string): void {
  const rb = durable.get(domain);
  if (rb === undefined) {
    console.log(`   INVARIANT ✓ durable[${domain}] empty (no partial persisted)`);
    return;
  }
  const fullLength = rb.steps.length;
  const contiguous = rb.steps.every((s, i) => s.index === i + 1);
  if (!rb.complete || !contiguous || fullLength === 0) {
    throw new Error(
      `INVARIANT VIOLATED in ${label}: durable[${domain}] is a PARTIAL ` +
        `(complete=${rb.complete}, steps=${fullLength}, contiguous=${contiguous})`,
    );
  }
  console.log(
    `   INVARIANT ✓ durable[${domain}] = complete runbook (${fullLength} steps, ${rb.verifiedBy})`,
  );
}

function snapshot(domain: string): string {
  const rb = durable.get(domain);
  if (!rb) return "<empty>";
  return `${rb.steps.length} steps, complete=${rb.complete}`;
}

// ---- Scenarios -------------------------------------------------------------

const DOMAIN = "hr.example.com/timesheet";
const FULL_FLOW = [
  "open timesheet",
  "fill Monday hours",
  "fill Tuesday hours",
  "fill rest of week",
  "click Submit",
  "read confirmation",
];

console.log("=== Crash-safe commit boundary for runbook capture ===\n");

// Scenario 1: clean complete + confirmed -> promoted.
console.log("[1] Clean complete + confirmed");
let r = runWithCommitBoundary({ domain: DOMAIN, plannedSteps: FULL_FLOW, finalOutcome: "confirmed" });
console.log(`   committed=${r.committed} (${r.reason})`);
console.log(`   durable after: ${snapshot(DOMAIN)}`);
assertNoPartial(DOMAIN, "scenario 1");
console.log();

// Capture the known-good runbook for the overwrite test later.
const goodRunbook = durable.get(DOMAIN)!;

// Scenario 2: crash mid-flow (dies at step 3 of 6) -> nothing new persisted.
// Use a fresh domain so we can see "durable stays empty".
const FRESH = "payroll.example.com/leave";
console.log("[2] Crash mid-flow (dies at step 3 of 6) on a NEW domain");
r = runWithCommitBoundary({
  domain: FRESH,
  plannedSteps: FULL_FLOW,
  crashAtStep: 3,
  finalOutcome: "confirmed", // never reached — crash precedes verification
});
console.log(`   committed=${r.committed} (${r.reason})`);
console.log(`   durable[${FRESH}] after: ${snapshot(FRESH)}`);
assertNoPartial(FRESH, "scenario 2");
console.log();

// Scenario 3: completed but verification failed/ambiguous -> NOT promoted.
console.log("[3] Completed run, verification = ambiguous (spinner stuck)");
r = runWithCommitBoundary({ domain: FRESH, plannedSteps: FULL_FLOW, finalOutcome: "ambiguous" });
console.log(`   committed=${r.committed} (${r.reason})`);
console.log(`   durable[${FRESH}] after: ${snapshot(FRESH)}`);
assertNoPartial(FRESH, "scenario 3");
console.log();

// Scenario 4: crash DURING an overwrite of an existing good runbook.
// The known-good runbook on DOMAIN must SURVIVE intact.
console.log("[4] Crash mid-OVERWRITE of an existing good runbook (dies at step 4 of 6)");
const beforeSteps = durable.get(DOMAIN)!.steps.length;
r = runWithCommitBoundary({
  domain: DOMAIN, // same domain as the good runbook
  plannedSteps: [...FULL_FLOW, "extra step"], // a "new, longer" capture
  crashAtStep: 4,
  finalOutcome: "confirmed",
});
const survived = durable.get(DOMAIN);
console.log(`   committed=${r.committed} (${r.reason})`);
console.log(`   durable[${DOMAIN}] after: ${snapshot(DOMAIN)}`);
const intact = survived === goodRunbook && survived.steps.length === beforeSteps;
console.log(`   known-good runbook survived intact (same reference, ${beforeSteps} steps): ${intact}`);
assertNoPartial(DOMAIN, "scenario 4");
if (!intact) throw new Error("INVARIANT VIOLATED: overwrite crash clobbered the known-good runbook");
console.log();

// Scenario 5: clean overwrite + confirmed -> good runbook is replaced atomically.
console.log("[5] Clean overwrite + confirmed (new longer flow replaces the old one)");
r = runWithCommitBoundary({
  domain: DOMAIN,
  plannedSteps: [...FULL_FLOW, "download receipt"],
  finalOutcome: "confirmed",
});
const replaced = durable.get(DOMAIN)!;
console.log(`   committed=${r.committed} (${r.reason})`);
console.log(`   durable[${DOMAIN}] after: ${snapshot(DOMAIN)}`);
console.log(`   reference swapped (no in-place mutation): ${replaced !== goodRunbook}`);
assertNoPartial(DOMAIN, "scenario 5");
console.log();

// ---- Verdict ---------------------------------------------------------------

console.log("=== VERDICT ===");
console.log(
  "Commit boundary holds: durable memory only ever contained a fully-complete, " +
    "verified runbook or the previous good one — never a partial. Crash mid-flow and " +
    "crash mid-overwrite both left the live runbook intact; failed/ambiguous never promoted. " +
    "Atomicity comes from staging in scratch and swapping the reference only on confirmed.",
);
