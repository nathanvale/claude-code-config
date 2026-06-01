// PROTOTYPE — throwaway. PROVENANCE + CONFIDENCE drives RE-VERIFY aggressiveness.
//
// Question: when an agent recalls captured selectors from browser-domain-memory,
// not all are equally trustworthy. A selector found via a stable #id is gold; one
// found by a generic CSS class, fuzzy text match, or that was already HEALED after
// drift is shaky. Can we (1) record HOW each selector was resolved (provenance),
// (2) derive a CONFIDENCE score from that, and (3) use the score to decide how
// hard to RE-VERIFY each selector before trusting it on the next run?
//
// No live browser. Selectors + provenance are modelled as in-memory data. Pure,
// deterministic, zero deps.
//
// Run: bun prototypes/browser-use-uplift/provenance/provenance.ts

// --- CORE 1: provenance → confidence map (named, explicit, tunable) ----------
// How the selector was originally resolved, ranked by structural stability.
type Provenance =
  | "by-id" // #stable-id — survives restyle/reflow
  | "by-testid" // [data-testid=…] — intent-stable contract
  | "by-name" // [name=…] — form-field stable
  | "by-aria" // [role]/[aria-label] — semantic, fairly stable
  | "by-css-class" // .some-class — cosmetic, churns on redesign
  | "by-text-fuzzy" // matched visible text — copy changes, i18n breaks it
  | "by-heal"; // re-found after drift — provenance unknown, treat as weakest

const CONFIDENCE: Record<Provenance, number> = {
  "by-id": 0.95,
  "by-testid": 0.9,
  "by-name": 0.85,
  "by-aria": 0.8,
  "by-css-class": 0.5,
  "by-text-fuzzy": 0.4,
  "by-heal": 0.3,
};

// --- CORE 2: re-verify threshold ---------------------------------------------
// >= TRUST → trust the cached selector with a cheap/no check.
// <  TRUST → must re-verify (or re-discover) BEFORE use this run.
const TRUST_THRESHOLD = 0.7;

// A prior-run heal DECAYS confidence: provenance is downgraded to by-heal and an
// extra penalty stacks per consecutive heal, so a flaky selector keeps sinking.
const HEAL_DECAY_PER_PRIOR = 0.1;

interface CapturedSelector {
  step: string; // human label for the flow step
  selector: string; // the actual CSS/text query stored in memory
  provenance: Provenance; // how it was resolved at capture (or last heal)
  priorHeals?: number; // times this needed healing on previous runs
}

// --- The runbook: mixed-provenance selectors from a grooming-booking + login flow.
const RUNBOOK: CapturedSelector[] = [
  { step: "login: username field", selector: "#MainContent_LoginControl_UserName", provenance: "by-id" },
  { step: "login: submit button", selector: "[data-testid='login-submit']", provenance: "by-testid" },
  { step: "login: password field", selector: "input[name='password']", provenance: "by-name" },
  { step: "booking: services region", selector: "[role='region'][aria-label='Services']", provenance: "by-aria" },
  { step: "booking: a grooming service row", selector: ".service-row", provenance: "by-css-class" },
  { step: "booking: Add button", selector: "text/Add", provenance: "by-text-fuzzy" },
  { step: "booking: staff option 'Any staff'", selector: "[role=option]:nth-child(2)", provenance: "by-heal", priorHeals: 1 },
  { step: "booking: 10:30 time slot", selector: ".time-slot", provenance: "by-css-class", priorHeals: 2 },
];

// --- confidence derivation (provenance + heal decay) -------------------------
function confidenceFor(s: CapturedSelector): number {
  const base = CONFIDENCE[s.provenance];
  const decay = (s.priorHeals ?? 0) * HEAL_DECAY_PER_PRIOR;
  return Math.max(0, Math.round((base - decay) * 100) / 100);
}

type Decision = "TRUST" | "RE-VERIFY";

function decisionFor(confidence: number): Decision {
  return confidence >= TRUST_THRESHOLD ? "TRUST" : "RE-VERIFY";
}

// --- output ------------------------------------------------------------------
const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
const log = (m: string) => console.log(m);

function main() {
  log("=== PROVENANCE → CONFIDENCE → RE-VERIFY decision ===");
  log(`(trust threshold: confidence >= ${TRUST_THRESHOLD} → trust; below → re-verify before use)\n`);

  log(`${pad("selector", 42)} ${pad("provenance", 13)} ${pad("conf", 6)} decision`);
  log("-".repeat(42 + 13 + 6 + 12));

  let trusted = 0;
  let reverify = 0;
  const reverifySteps: string[] = [];

  for (const s of RUNBOOK) {
    const conf = confidenceFor(s);
    const decision = decisionFor(conf);
    const healNote = (s.priorHeals ?? 0) > 0 ? `  ← decayed: ${s.priorHeals} prior heal(s)` : "";
    log(`${pad(s.selector, 42)} ${pad(s.provenance, 13)} ${pad(conf.toFixed(2), 6)} ${decision}${healNote}`);
    if (decision === "TRUST") {
      trusted++;
    } else {
      reverify++;
      reverifySteps.push(`${s.step} (${s.provenance}, ${conf.toFixed(2)})`);
    }
  }

  log("");
  log(`=== RESULT: ${trusted} trusted (cheap/no check), ${reverify} flagged for RE-VERIFY before use ===`);
  log("Re-verify queue (low-confidence — re-discover or re-check first):");
  for (const r of reverifySteps) log(`  • ${r}`);

  // --- decay demonstration: same css-class selector, before vs after a heal ---
  log("\n--- decay demo: confidence drops as a selector keeps needing healing ---");
  const sel: CapturedSelector = { step: "demo", selector: ".time-slot", provenance: "by-css-class" };
  for (const heals of [0, 1, 2]) {
    const c = confidenceFor({ ...sel, priorHeals: heals });
    log(`  ${heals} prior heal(s): conf ${c.toFixed(2)} → ${decisionFor(c)}`);
  }
  const downgraded = confidenceFor({ ...sel, provenance: "by-heal", priorHeals: 1 });
  log(`  re-found via heal (provenance now by-heal, 1 heal): conf ${downgraded.toFixed(2)} → ${decisionFor(downgraded)}`);

  // --- verdict / invariant check ----------------------------------------------
  const highConfAllTrusted = RUNBOOK.filter((s) => confidenceFor(s) >= TRUST_THRESHOLD).every((s) => decisionFor(confidenceFor(s)) === "TRUST");
  const lowConfAllReverify = RUNBOOK.filter((s) => confidenceFor(s) < TRUST_THRESHOLD).every((s) => decisionFor(confidenceFor(s)) === "RE-VERIFY");
  log("");
  if (highConfAllTrusted && lowConfAllReverify) {
    log("✓ VERDICT: provenance-derived confidence cleanly gates re-verification.");
    log("  High-confidence (id/testid/name/aria) selectors are trusted; weak ones");
    log("  (css-class/text-fuzzy/healed) are flagged to re-verify — and heals decay");
    log("  confidence so a flaky selector keeps re-verifying until it stabilises.");
  } else {
    log("✗ VERDICT: gating inconsistent — threshold or map needs tuning.");
    process.exit(1);
  }
}

main();
