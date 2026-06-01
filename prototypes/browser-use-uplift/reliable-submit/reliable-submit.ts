/**
 * QUESTION: When an agent re-drives a saved browser flow unattended (e.g. submit
 * a weekly timesheet every Friday), how do we make a click ACTUALLY TAKE — and,
 * critically, detect when it didn't?
 *
 * A prior prototype exposed a real hole: synthetic clicks on some web components
 * (Square's <market-row>, custom buttons) don't reliably fire the element's real
 * handler. The click "succeeds" at the API level but the page never reacts — no
 * state change, no navigation. A human notices. An unattended Friday auto-run does
 * not, and a silently-failed submit is dangerous.
 *
 * This prototype proves a reliableClick(element, expectedEffect) routine that
 * escalates click fidelity across tiers and VERIFIES an expectedEffect predicate
 * after each attempt. A strategy that "ran" but produced no effect is still a miss
 * → escalate. If every tier fails, we return an HONEST failure (never a false
 * success). That honest-failure path is the core safety property.
 *
 * Run: bun reliable-submit.ts
 * Pure TS, zero deps, no network. The DOM is modelled in-memory so each escalation
 * tier is exercised deterministically.
 */

// --- In-memory DOM fixture --------------------------------------------------
// Each element "activates" (fires its real handler → produces a page effect) only
// under one specific click strategy. This simulates the real-world reality that
// different components react to different input fidelities.

type Strategy = "native-click" | "dispatched-pointer" | "inner-target" | "keyboard";

interface FakeElement {
  id: string;
  label: string;
  /** The one strategy this element actually responds to. null = dead (responds to nothing). */
  respondsTo: Strategy | null;
  /** Side-effect state: flips true when the real handler fires. */
  activated: boolean;
  /** Inner target id, for the web-component-wrapper case. */
  innerTarget?: string;
}

function makeEl(
  id: string,
  label: string,
  respondsTo: Strategy | null,
  innerTarget?: string,
): FakeElement {
  return { id, label, respondsTo, activated: false, innerTarget };
}

/** Apply a strategy to an element; the element activates only if it matches. */
function applyStrategy(el: FakeElement, strategy: Strategy, target: string): void {
  // inner-target strategy must hit the element's declared inner target to count.
  if (strategy === "inner-target" && el.innerTarget !== target) return;
  if (el.respondsTo === strategy) el.activated = true;
}

// --- Click strategies (escalating fidelity) ---------------------------------

interface Attempt {
  tier: number;
  name: string;
  run: (el: FakeElement) => void;
}

const STRATEGIES: Attempt[] = [
  {
    tier: 1,
    name: "element.click()",
    run: (el) => applyStrategy(el, "native-click", el.id),
  },
  {
    tier: 2,
    name: "dispatched pointer/mouse sequence (pointerdown→mousedown→mouseup→click, bubbles)",
    run: (el) => {
      // Simulates dispatching a full real event sequence — the fix for
      // web-components like <market-row> that ignore a bare .click().
      for (const _evt of ["pointerdown", "mousedown", "mouseup", "click"]) {
        applyStrategy(el, "dispatched-pointer", el.id);
      }
    },
  },
  {
    tier: 3,
    name: "inner-target click (drill into web-component wrapper)",
    run: (el) => {
      const target = el.innerTarget ?? el.id;
      applyStrategy(el, "inner-target", target);
    },
  },
  {
    tier: 4,
    name: "keyboard activation (focus + Enter/Space)",
    run: (el) => applyStrategy(el, "keyboard", el.id),
  },
];

// --- The core routine -------------------------------------------------------

interface ClickResult {
  ok: boolean;
  tier: number | null;
  strategy: string | null;
  attempts: number;
}

/**
 * Try clicks in escalating fidelity. After EACH attempt, check expectedEffect.
 * The effect predicate — not the click "running" — is the source of truth.
 * Returns an honest failure if no tier produces the effect.
 */
function reliableClick(el: FakeElement, expectedEffect: () => boolean): ClickResult {
  let attempts = 0;
  for (const attempt of STRATEGIES) {
    attempts++;
    attempt.run(el);
    if (expectedEffect()) {
      return { ok: true, tier: attempt.tier, strategy: attempt.name, attempts };
    }
    // ran but no effect → still a miss → escalate
  }
  return { ok: false, tier: null, strategy: null, attempts };
}

// --- Fixture: one element per tier + one dead element -----------------------

const fixtures: { el: FakeElement; expectTier: number | "fail" }[] = [
  { el: makeEl("plain-btn", "Plain <button>", "native-click"), expectTier: 1 },
  {
    el: makeEl("market-row", "Square <market-row> web-component", "dispatched-pointer"),
    expectTier: 2,
  },
  {
    el: makeEl("wrapper", "Custom wrapper (inner radio)", "inner-target", "wrapper-inner-radio"),
    expectTier: 3,
  },
  { el: makeEl("a11y-btn", "Keyboard-only widget", "keyboard"), expectTier: 4 },
  { el: makeEl("dead-submit", "Dead submit (responds to nothing)", null), expectTier: "fail" },
];

// --- Run --------------------------------------------------------------------

console.log("=== reliableClick: escalation + expectedEffect verification ===\n");

let allHonest = true;

for (const { el, expectTier } of fixtures) {
  // expectedEffect: did the page actually react? Here, did the handler fire?
  const expectedEffect = () => el.activated;

  const result = reliableClick(el, expectedEffect);

  if (result.ok) {
    const mark = result.tier === expectTier ? "✓" : "✗";
    console.log(
      `${mark} ${el.label.padEnd(42)} → took at tier ${result.tier} ` +
        `(${result.strategy}) after ${result.attempts} attempt(s)`,
    );
    if (result.tier !== expectTier) {
      allHonest = false;
      console.log(`    UNEXPECTED: wanted tier ${expectTier}, got ${result.tier}`);
    }
  } else {
    // The safety property: NO false success. A dead element must report failure.
    const honest = expectTier === "fail";
    const mark = honest ? "✓" : "✗";
    console.log(
      `${mark} ${el.label.padEnd(42)} → CLICK DID NOT TAKE ` +
        `(all ${result.attempts} tiers exhausted, honest failure)`,
    );
    if (!honest) allHonest = false;
  }
}

// --- Verdict ----------------------------------------------------------------

const tiersFired = fixtures
  .filter((f) => f.expectTier !== "fail")
  .every((f) => f.el.activated);
const deadFailedHonestly = fixtures.find((f) => f.expectTier === "fail")!.el.activated === false;

console.log("");
if (allHonest && tiersFired && deadFailedHonestly) {
  console.log(
    "VERDICT: PASS — every escalation tier fired for its element, and the dead " +
      "element returned an honest 'click did not take' (no false success). " +
      "expectedEffect verification is the safety mechanism that makes unattended " +
      "re-drive safe.",
  );
} else {
  console.log(
    "VERDICT: FAIL — escalation or honest-failure property violated. " +
      "Do NOT trust this for unattended runs.",
  );
}
