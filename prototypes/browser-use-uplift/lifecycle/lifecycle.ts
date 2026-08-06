// PROTOTYPE — throwaway. END-TO-END RUNBOOK LIFECYCLE: heal + provenance +
// staleness + capture-verify, chained into ONE story over time.
//
// Question: the sibling prototypes each proved a PIECE (self-heal a drifted
// selector; score whole-runbook staleness from history; decay confidence on
// heal; verify-on-capture). What does the FULL arc look like when you run a
// single runbook week after week and the page underneath MUTATES?
//
// We simulate one runbook (a 5-step weekly timesheet) across 23 runs. The page
// is an in-memory selector-resolution map we MUTATE between runs — the mutation
// IS the narrative engine, no live browser/network:
//   runs 1-20  page stable        -> HEALTHY      (clean replays, 0 heals)
//   run 21     1 selector drifts   -> heals, survives, flips to DEGRADING
//   run 22     site redesign       -> ladder can't recover, FAILS, STALE,
//                                     invalidate + cold RECAPTURE
//   run 23     replay rebuilt book  -> HEALTHY again. arc closed.
//
// No Date.now() (clock may be frozen) — runs are indexed, dates are fixtures.
//
// Run: bun prototypes/browser-use-uplift/lifecycle/lifecycle.ts  (zero deps)

// ---- staleness policy (from staleness/) ------------------------------------
const REDESIGN_FAIL_FRACTION = 0.8; // >= this fraction drift in a failed run -> redesign -> stale
const CONSECUTIVE_FAILURES_STALE = 2; // N failed runs in a row -> stale
const HEAL_RATE_DEGRADING = 0.15; // recent mean heal-rate >= this -> degrading
const HEAL_RATE_STALE = 0.65; // recent mean heal-rate >= this -> rot/stale
const RECENT_WINDOW = 3; // trailing runs that define "recent"

// ---- provenance -> confidence (from provenance/) ---------------------------
type Provenance = "by-id" | "by-testid" | "by-aria" | "by-css-class" | "by-heal";
const CONFIDENCE: Record<Provenance, number> = {
  "by-id": 0.95,
  "by-testid": 0.9,
  "by-aria": 0.8,
  "by-css-class": 0.5,
  "by-heal": 0.3,
};

// ---- the runbook: ordered steps, each with primary + fallback + label/role -
interface Step {
  label: string;
  primary: string; // captured CSS selector tried first
  fallbacks: string[]; // ordered fallback chain
  role: string; // semantic re-find hint (label/role) — last-resort recovery
  provenance: Provenance; // how `primary` was resolved
  confidence: number; // derived from provenance, decays on heal
}

// ---- in-memory page: selector -> resolution state. MUTATED between runs. ----
// "ok"      primary resolves cleanly
// "drifted" primary dead, but the element is still re-findable by role
// "dead"    element gone entirely (redesign) — only a fresh recapture recovers
type Resolution = "ok" | "drifted" | "dead";

interface RunOutcome {
  run: number;
  date: string;
  result: "confirmed" | "failed";
  totalSteps: number;
  stepsHealed: number;
  minConfidence: number;
  driftedSelectors: string[];
}

const fresh = (label: string, primary: string, role: string, prov: Provenance): Step => ({
  label,
  primary,
  fallbacks: [`${primary}-alt`, `[data-step="${role}"]`],
  role,
  provenance: prov,
  confidence: CONFIDENCE[prov],
});

// cold capture / recapture: discover the runbook fresh with high provenance.
function recapture(version: number): Step[] {
  return [
    fresh("open timesheet", `#timesheet-v${version}`, "timesheet-link", "by-id"),
    fresh("select week", `#week-picker-v${version}`, "week-picker", "by-id"),
    fresh("enter hours", `[data-testid="hours-v${version}"]`, "hours-input", "by-testid"),
    fresh("add note", `.note-field-v${version}`, "note-field", "by-css-class"),
    fresh("submit", `#submit-v${version}`, "submit-btn", "by-id"),
  ];
}

// the page resolver: maps every live selector to "ok". recapture rewrites it.
function buildPage(book: Step[]): Map<string, Resolution> {
  const page = new Map<string, Resolution>();
  for (const s of book) page.set(s.primary, "ok");
  return page;
}

// ---- the self-healing ladder (from self-healing/) --------------------------
// primary -> fallback chain -> re-find by role. returns how it resolved, or null.
interface HealResult {
  ok: boolean;
  healed: boolean;
  via: string;
}
function resolveStep(step: Step, page: Map<string, Resolution>): HealResult {
  if (page.get(step.primary) === "ok") return { ok: true, healed: false, via: "primary" };
  // primary missed — walk fallback chain (none registered as ok in this model)
  for (const fb of step.fallbacks) {
    if (page.get(fb) === "ok") return { ok: true, healed: true, via: `fallback ${fb}` };
  }
  // last resort: re-find by role. works only if the element merely DRIFTED.
  if (page.get(step.primary) === "drifted") {
    return { ok: true, healed: true, via: `re-find by role "${step.role}"` };
  }
  return { ok: false, healed: false, via: "exhausted ladder" }; // dead -> unrecoverable
}

// replay the runbook against the current page, healing where possible.
function replay(book: Step[], page: Map<string, Resolution>, run: number, date: string): RunOutcome {
  let healed = 0;
  const drifted: string[] = [];
  let allOk = true;
  for (const step of book) {
    const r = resolveStep(step, page);
    if (!r.ok) {
      allOk = false;
      drifted.push(step.primary);
      continue;
    }
    if (r.healed) {
      healed++;
      drifted.push(step.primary);
      // provenance decays: a healed selector is now only as good as a heal.
      step.provenance = "by-heal";
      step.confidence = CONFIDENCE["by-heal"];
    }
  }
  const minConfidence = Math.min(...book.map((s) => s.confidence));
  return {
    run,
    date,
    result: allOk ? "confirmed" : "failed",
    totalSteps: book.length,
    stepsHealed: healed,
    minConfidence,
    driftedSelectors: drifted,
  };
}

// ---- staleness scorer over Run Outcome history (from staleness/) -----------
type Verdict = "healthy" | "degrading" | "stale";
const healRate = (r: RunOutcome) => (r.totalSteps ? r.stepsHealed / r.totalSteps : 0);

function scoreRunbook(history: RunOutcome[]): { verdict: Verdict; reason: string } {
  let verdict: Verdict = "healthy";
  let reason = "clean recent history, healthy heal-rate";
  const rank = { healthy: 0, degrading: 1, stale: 2 } as const;
  const bump = (v: Verdict, why: string) => {
    if (rank[v] > rank[verdict]) {
      verdict = v;
      reason = why;
    }
  };

  const last = history[history.length - 1];
  const lastDrift = last.totalSteps ? last.driftedSelectors.length / last.totalSteps : 0;
  if (last.result === "failed" && lastDrift >= REDESIGN_FAIL_FRACTION) {
    bump("stale", `redesign: last run drifted ${Math.round(lastDrift * 100)}% of selectors in a FAILED run`);
  }

  let consec = 0;
  for (let i = history.length - 1; i >= 0 && history[i].result === "failed"; i--) consec++;
  if (consec >= CONSECUTIVE_FAILURES_STALE) bump("stale", `${consec} consecutive failed runs`);

  const recent = history.slice(-RECENT_WINDOW);
  const meanHeal = recent.reduce((s, r) => s + healRate(r), 0) / recent.length;
  // heal-rate ticked up from a clean baseline: even one heal after a stretch of
  // clean runs is an early-warning signal — re-verify proactively before it rots.
  const latestHeal = healRate(last);
  if (meanHeal >= HEAL_RATE_STALE) bump("stale", `recent heal-rate ${meanHeal.toFixed(2)} — selectors rotting`);
  else if (latestHeal >= HEAL_RATE_DEGRADING)
    bump("degrading", `heal-rate ticked up to ${latestHeal.toFixed(2)} this run (was 0) — re-verify proactively next run`);

  return { verdict, reason };
}

// ---- the lifecycle simulation ----------------------------------------------
const ICON: Record<Verdict, string> = { healthy: "✓", degrading: "⚠", stale: "✗" };
const log = (m = "") => console.log(m);
const date = (run: number) => `2026-${String(1 + Math.floor((run - 1) / 4)).padStart(2, "0")}-${String(1 + ((run - 1) % 4) * 7).padStart(2, "0")}`;

log("=== RUNBOOK LIFECYCLE: weekly-timesheet (timesheet.acme.com) ===");
log(
  `policy: redesign>=${REDESIGN_FAIL_FRACTION * 100}% drift in a fail -> stale | ${CONSECUTIVE_FAILURES_STALE} consec fails -> stale | heal-rate>=${HEAL_RATE_DEGRADING} -> degrading\n`,
);

let book = recapture(1);
let page = buildPage(book);
const history: RunOutcome[] = [];

// PHASE 1 — runs 1-20: HEALTHY. clean replays, summarized not spammed.
for (let run = 1; run <= 20; run++) history.push(replay(book, page, run, date(run)));
let v = scoreRunbook(history);
log(`runs 1-20  all clean replays, 0 heals, result=confirmed`);
log(`  ${ICON[v.verdict]} verdict: ${v.verdict.toUpperCase()} — ${v.reason}\n`);

// PHASE 2 — run 21: PARTIAL DRIFT. drift 1 selector to "drifted" (re-findable).
page.set(book[1].primary, "drifted"); // "select week" selector drifted
const r21 = replay(book, page, 21, date(21));
history.push(r21);
v = scoreRunbook(history);
log(`run 21     1 selector drifted; healing ladder re-found it by role`);
log(`  result=${r21.result}, healed ${r21.stepsHealed}/${r21.totalSteps}, minConfidence ${r21.minConfidence.toFixed(2)} (healed selector decayed to by-heal)`);
log(`  ${ICON[v.verdict]} verdict: ${v.verdict.toUpperCase()} — ${v.reason}\n`);

// PHASE 3 — run 22: MASS DRIFT (redesign). kill most selectors -> dead.
for (const s of book) page.set(s.primary, "dead");
page.set(book[1].primary, "dead"); // already drifted, now fully gone
const r22 = replay(book, page, 22, date(22));
history.push(r22);
v = scoreRunbook(history);
log(`run 22     site redesign: ${r22.driftedSelectors.length}/${r22.totalSteps} selectors dead; ladder exhausted, no recovery`);
log(`  result=${r22.result} (could not complete the flow)`);
log(`  ${ICON[v.verdict]} verdict: ${v.verdict.toUpperCase()} — ${v.reason}`);

if (v.verdict === "stale") {
  log(`  -> INVALIDATE stored runbook; trigger cold RECAPTURE (fresh discovery)`);
  book = recapture(2); // rebuild against the redesigned page: new selectors, fresh provenance
  page = buildPage(book);
  log(`  -> ↻ recaptured ${book.length} steps with fresh provenance (minConfidence ${Math.min(...book.map((s) => s.confidence)).toFixed(2)})\n`);
}

// PHASE 4 — run 23: REBUILT. replay the fresh runbook -> clean again.
// staleness reads a FRESH history (old failures belong to the invalidated book).
const freshHistory: RunOutcome[] = [];
const r23 = replay(book, page, 23, date(23));
freshHistory.push(r23);
v = scoreRunbook(freshHistory);
log(`run 23     replay freshly-recaptured runbook`);
log(`  result=${r23.result}, healed ${r23.stepsHealed}/${r23.totalSteps}, minConfidence ${r23.minConfidence.toFixed(2)}`);
log(`  ${ICON[v.verdict]} verdict: ${v.verdict.toUpperCase()} — ${v.reason}\n`);

// ---- TIMELINE --------------------------------------------------------------
log("=== LIFECYCLE ARC ===");
log("  runs 1-20  ✓ HEALTHY     clean replays, 0 heals");
log("  run 21     ⚠ DEGRADING   1 drift healed in-run; heal-rate ticked up -> re-verify proactively");
log("  run 22     ✗ STALE       mass drift in a failed run -> invalidate + ↻ recapture");
log("  run 23     ✓ HEALTHY     rebuilt runbook replays clean; arc closed");
log(`\nFINAL: one runbook, full arc — healthy -> degrading -> stale/recapture -> healthy. Heal kept run 21 alive; staleness caught the rot; recapture rebuilt trust.`);
