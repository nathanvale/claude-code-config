/**
 * QUESTION
 * --------
 * WHEN are a flow's steps + selectors captured for durable browser memory —
 * as the agent acts (INCREMENTAL), or reconstructed at END-OF-RUN?
 *
 * Each pure approach has a fatal flaw:
 *   - incremental-only persists the NOISE (fumbles, retries, dead scrolls);
 *   - end-of-run-only loses ORDER + WAIT-FOR fidelity (the bug that broke an
 *     earlier replay) and captures NOTHING if no journal was kept.
 *
 * This prototype proves the answer is HYBRID, in three moves:
 *   1. JOURNAL DURING the run — append a raw, ordered entry per action (the real
 *      resolved selector, any wait-for, and whether it was a fumble/retry/no-op).
 *      Order + waits are only knowable LIVE.
 *   2. TIDY at end — tidy(journal) drops noise, keeps the winning path, and
 *      PRESERVES the live order + wait metadata. Cleanliness needs hindsight you
 *      don't have mid-run (you don't yet know which clicks were fumbles).
 *   3. COMMIT on verified — promote the tidied runbook to durable memory only if
 *      the run's end verification is `confirmed`. Else discard (reuse the commit
 *      boundary idea from the crash-safety sibling, independently).
 *
 * No browser, network, files, or Date.now(). Ordering is sequence indices.
 * Deterministic. Pure TS, zero deps. Run: bun journal-tidy.ts
 */

// ---- Domain model ----------------------------------------------------------

/** A raw journal entry, appended live as the agent acts. */
interface JournalEntry {
  seq: number; // live ordering — the load-bearing fact end-of-run can't recover
  action: string; // e.g. "click", "fill", "scroll", "snapshot"
  target: string; // human label of what it acted on
  selector: string; // the REAL selector resolved at action time ("" for no-op)
  waitFor?: string; // a wait condition that applied before this action succeeded
  // Why this entry is noise, if it is. undefined => signal (winning path).
  noise?: "fumble" | "retry-superseded" | "no-effect";
}

/** A clean, ordered runbook step — what we'd actually replay. */
interface RunbookStep {
  order: number;
  action: string;
  target: string;
  selector: string;
  waitFor?: string;
}

interface Runbook {
  domain: string;
  steps: RunbookStep[];
  verifiedBy: string;
}

type Outcome = "confirmed" | "failed" | "ambiguous";

// ---- Durable memory (in-memory) --------------------------------------------

const durable = new Map<string, Runbook>();

// ---- The tidy pass (the core) ----------------------------------------------

/**
 * tidy(journal) -> clean steps.
 *
 * Explicit noise rules (drop):
 *   - fumble:            flagged at capture (clicked the wrong thing, element
 *                        not found). Never on the winning path.
 *   - retry-superseded:  an attempt on a target that a LATER entry hit cleanly.
 *                        The successful entry is the signal; earlier tries are noise.
 *   - no-effect:         a scroll/snapshot that produced no lasting state change.
 *
 * Signal (keep): an action with no noise flag AND, if it shares a target with
 * later entries, the LAST clean attempt on that target wins.
 *
 * Order + wait-for are copied straight from the journal — they are NOT
 * reconstructed, because they are only knowable from the live sequence.
 */
function tidy(journal: JournalEntry[]): RunbookStep[] {
  // A "clean" entry is one with no noise flag.
  const clean = journal.filter((e) => e.noise === undefined);

  // Collapse duplicate clean attempts on the same (action,target): keep the
  // last one (the winning resolve), so an early flaky-but-unflagged attempt
  // doesn't double up. Keyed by action+target.
  const lastBySignature = new Map<string, JournalEntry>();
  for (const e of clean) {
    lastBySignature.set(`${e.action}::${e.target}`, e);
  }

  // Re-sort the survivors back into live order and renumber.
  const winners = [...lastBySignature.values()].sort((a, b) => a.seq - b.seq);
  return winners.map((e, i) => ({
    order: i + 1,
    action: e.action,
    target: e.target,
    selector: e.selector,
    ...(e.waitFor ? { waitFor: e.waitFor } : {}),
  }));
}

// ---- The commit boundary (reused idea, not imported) -----------------------

interface CommitResult {
  committed: boolean;
  reason: string;
}

/** Promote the tidied runbook to durable memory ONLY on a confirmed run. */
function commitOnVerified(
  domain: string,
  steps: RunbookStep[],
  outcome: Outcome,
): CommitResult {
  if (outcome !== "confirmed") {
    return { committed: false, reason: `verification=${outcome} — runbook discarded` };
  }
  durable.set(domain, { domain, steps, verifiedBy: `confirmed, ${steps.length} steps` });
  return { committed: true, reason: `confirmed — promoted ${steps.length}-step runbook` };
}

// ---- Pretty-printers -------------------------------------------------------

function printJournal(journal: JournalEntry[]): void {
  for (const e of journal) {
    const mark = e.noise ? `  <-- NOISE: ${e.noise}` : "";
    const wait = e.waitFor ? `  [waitFor: ${e.waitFor}]` : "";
    const sel = e.selector ? ` ${e.selector}` : " (no selector)";
    console.log(`   #${e.seq} ${e.action} ${e.target} ->${sel}${wait}${mark}`);
  }
}

function printRunbook(steps: RunbookStep[]): void {
  for (const s of steps) {
    const wait = s.waitFor ? `  [waitFor: ${s.waitFor}]` : "";
    console.log(`   ${s.order}. ${s.action} ${s.target} -> ${s.selector}${wait}`);
  }
}

// ============================================================================
// SCENARIO 1 — noisy run with fumbles, a superseded retry, and a dead scroll.
// ============================================================================

const DOMAIN_1 = "hr.example.com/timesheet";

// The live journal, exactly as the agent would have appended it mid-run.
const journal1: JournalEntry[] = [
  { seq: 1, action: "click", target: "Timesheets nav", selector: "a[href='/sheets']", waitFor: "nav visible" },
  { seq: 2, action: "click", target: "New Entry (wrong)", selector: "button.add-photo", noise: "fumble" },
  { seq: 3, action: "click", target: "New Entry", selector: "button[data-test='new-entry']", waitFor: "modal open" },
  { seq: 4, action: "scroll", target: "modal body", selector: "", noise: "no-effect" },
  { seq: 5, action: "fill", target: "Hours field (timeout)", selector: "#hrs", noise: "retry-superseded" },
  { seq: 6, action: "fill", target: "Hours field (timeout)", selector: "#hrs", waitFor: "field enabled", noise: "retry-superseded" },
  { seq: 7, action: "fill", target: "Hours field (timeout)", selector: "input[name='hours']", waitFor: "field enabled" },
  { seq: 8, action: "snapshot", target: "page", selector: "", noise: "no-effect" },
  { seq: 9, action: "click", target: "Save", selector: "button[type='submit']", waitFor: "toast 'Saved'" },
];

console.log("=== Hybrid capture: journal-during -> tidy-at-end -> commit-on-verified ===\n");

console.log(`[1] Noisy run on ${DOMAIN_1}`);
console.log(`\n   RAW JOURNAL (captured LIVE, ${journal1.length} entries — noise marked):`);
printJournal(journal1);

const runbook1 = tidy(journal1);
console.log(`\n   TIDIED RUNBOOK (${runbook1.length} steps — noise removed, order + waits kept):`);
printRunbook(runbook1);

const removed1 = journal1.length - runbook1.length;
console.log(`\n   tidy() dropped ${removed1} of ${journal1.length} entries (fumbles, superseded retries, no-ops).`);

const commit1 = commitOnVerified(DOMAIN_1, runbook1, "confirmed");
console.log(`   COMMIT: committed=${commit1.committed} (${commit1.reason})`);
console.log(`   durable[${DOMAIN_1}] = ${durable.has(DOMAIN_1) ? "present" : "<empty>"}`);

// Prove the surviving selector is the CORRECTED one, not the fumble/early retry.
const hoursStep = runbook1.find((s) => s.action === "fill");
const keptCorrected = hoursStep?.selector === "input[name='hours']";
console.log(`   kept the CORRECTED selector for Hours (not the fumble/early try): ${keptCorrected}`);
if (!keptCorrected) throw new Error("tidy kept a stale selector for the winning path");
console.log();

// ============================================================================
// SCENARIO 2 — ORDER matters: "Add" only appears AFTER "select staff".
// Proves end-of-run reconstruction-from-a-SET would lose the dependency.
// ============================================================================

const DOMAIN_2 = "clinic.example.com/booking";

const journal2: JournalEntry[] = [
  { seq: 1, action: "click", target: "Book Appointment", selector: "button.book", waitFor: "form visible" },
  { seq: 2, action: "select", target: "staff member", selector: "#staff", waitFor: "options loaded" },
  // The "Add" control is rendered ONLY after a staff member is selected — so
  // wait-for here is causally downstream of step 2. Order is the whole point.
  { seq: 3, action: "click", target: "Add", selector: "button[data-test='add-service']", waitFor: "Add btn appears after staff" },
  { seq: 4, action: "click", target: "Confirm", selector: "button.confirm", waitFor: "toast 'Booked'" },
];

console.log(`[2] Order-dependent run on ${DOMAIN_2} ("Add" only exists after "select staff")`);
console.log(`\n   RAW JOURNAL (live order preserved):`);
printJournal(journal2);

const runbook2 = tidy(journal2);
console.log(`\n   TIDIED RUNBOOK:`);
printRunbook(runbook2);

// The load-bearing assertion: select-staff comes BEFORE Add in the runbook.
const selectIdx = runbook2.findIndex((s) => s.target === "staff member");
const addIdx = runbook2.findIndex((s) => s.target === "Add");
const orderKept = selectIdx >= 0 && addIdx >= 0 && selectIdx < addIdx;
console.log(`\n   live order preserved: "select staff" (#${selectIdx + 1}) before "Add" (#${addIdx + 1}): ${orderKept}`);
if (!orderKept) throw new Error("tidy lost the select-before-Add ordering");

// Contrast: an end-of-run reconstruction from an unordered SET of touched
// selectors has no seq, so it can't know Add depends on select-staff.
const reconstructedSet = new Set(journal2.map((e) => e.target)); // a "set", order lost
console.log(
  `   END-OF-RUN-FROM-SET would yield {${[...reconstructedSet].join(", ")}} — ` +
    `no ordering, so "Add" could be emitted first and BREAK replay.`,
);

const commit2 = commitOnVerified(DOMAIN_2, runbook2, "confirmed");
console.log(`   COMMIT: committed=${commit2.committed} (${commit2.reason})`);
console.log();

// ============================================================================
// SCENARIO 3 — same tidy, but the run did NOT verify -> discard, no commit.
// ============================================================================

const DOMAIN_3 = "shop.example.com/checkout";

const journal3: JournalEntry[] = [
  { seq: 1, action: "click", target: "Cart", selector: "a.cart", waitFor: "cart open" },
  { seq: 2, action: "click", target: "Checkout", selector: "button.checkout", waitFor: "spinner..." },
];

console.log(`[3] Run on ${DOMAIN_3} but end-verification = ambiguous (spinner stuck)`);
const runbook3 = tidy(journal3);
console.log(`   tidy produced a ${runbook3.length}-step runbook, but:`);
const commit3 = commitOnVerified(DOMAIN_3, runbook3, "ambiguous");
console.log(`   COMMIT: committed=${commit3.committed} (${commit3.reason})`);
console.log(`   durable[${DOMAIN_3}] = ${durable.has(DOMAIN_3) ? "present" : "<empty>"}`);
if (durable.has(DOMAIN_3)) throw new Error("unverified run leaked into durable memory");
console.log();

// ---- Verdict ---------------------------------------------------------------

console.log("=== VERDICT ===");
console.log(
  'WHEN are selectors created? Not either/or — HYBRID: capture LIVE, clean at END, save only if it WORKED.\n' +
    "  - ORDER + WAIT-FOR come from the live journal (scenario 2: 'Add' only exists after 'select staff' —\n" +
    "    an end-of-run set lost that and would break replay).\n" +
    "  - CLEANLINESS comes from the tidy pass (scenario 1: dropped fumbles + superseded retries + dead scrolls,\n" +
    "    kept the CORRECTED selector — impossible live, you don't yet know which clicks were fumbles).\n" +
    "  - SAFETY comes from commit-on-verified (scenario 3: ambiguous run discarded, durable untouched).",
);
