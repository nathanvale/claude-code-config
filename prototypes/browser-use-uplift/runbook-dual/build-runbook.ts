// PROTOTYPE — throwaway. DUAL OUTPUT from one capture:
//   (1) strict Chrome Recorder JSON  → deterministic Puppeteer replay
//   (2) agent run-book               → an agent re-drives with judgment when a
//                                       selector drifts (fallbacks + waits + asserts)
//
// Grounded in the real lesson: the naive E2E capture BROKE on replay because it
// (a) missed the staff-select step, (b) used fragile selectors with no fallback,
// (c) had no waits. This prototype bakes those fixes in: the captured flow is the
// CORRECT complete one, and each step carries hardening metadata.
//
// Run: bun prototypes/browser-use-uplift/runbook-dual/build-runbook.ts

import { parse } from "@puppeteer/replay";

// ── The CAPTURED FLOW — what browser-use hands back (real, complete, correct) ──
// Each step: the action + a PRIMARY selector + FALLBACKS + a wait-for + an assert.
// This is the rich internal shape; the two outputs are projected from it.
interface RichStep {
  action: "navigate" | "click";
  url?: string;
  /** Human label for the run-book. */
  label: string;
  /** Ordered selector candidates: most-specific → most-robust. */
  selectors?: string[]; // e.g. ["#id", ".css", "aria/Name", "text/Label"]
  /** What must be true BEFORE acting (agent waits for this; replay uses timeout). */
  waitFor?: string;
  /** What the page should show AFTER (agent verifies; catches drift). */
  assert?: string;
}

// Captured live on the Urban Furdo / Square booking flow — the CORRECT sequence,
// including the staff-select step the naive capture missed.
const CAPTURED: { title: string; domain: string; steps: RichStep[] } = {
  title: "Urban Furdo — book grooming (to checkout, never books)",
  domain: "book.squareup.com",
  steps: [
    { action: "navigate", url: "https://book.squareup.com/appointments/4homoxayt60xtz/location/LVD8TBPTXNCK8/services",
      label: "open the booking services page", assert: "Services list visible" },
    { action: "click", label: "choose a grooming service",
      selectors: [".service-row", "text/Full Basic Groom"], waitFor: "service rows rendered",
      assert: "URL contains /services/<id> (staff step)" },
    { action: "click", label: "select staff (REQUIRED before Add appears)",
      selectors: ["[role=option][aria-label*='Any staff']", "text/Any staff"], waitFor: "staff options rendered",
      assert: "an 'Add' button appears" },
    { action: "click", label: "add the service to the appointment",
      selectors: ["button:has-text('Add')", "text/Add"], waitFor: "Add button visible (only after staff selected)",
      assert: "service shows 'Added' AND a 'Next' button appears" },
    { action: "click", label: "proceed to availability",
      selectors: ["button:has-text('Next')", "text/Next"], waitFor: "Next button visible (only after Added)",
      assert: "URL contains /availability (calendar visible)" },
    { action: "click", label: "jump to the next available day",
      selectors: ["button:has-text('Go to next available')", "text/Go to next available"], waitFor: "calendar rendered",
      assert: "time-slot buttons (e.g. 11:00) visible" },
    { action: "click", label: "pick the first available time slot",
      selectors: ["li button:has-text(/\\d{1,2}:\\d{2}/)", "[role=listitem] button"], waitFor: "time slots rendered",
      assert: "URL contains /checkout (Book appointment button present) — STOP HERE, never click it" },
  ],
};

// ── OUTPUT 1: strict Chrome Recorder JSON (deterministic replay) ──────────────
function toRecorderJSON(flow: typeof CAPTURED): object {
  const steps: object[] = [
    { type: "setViewport", width: 1200, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: false },
  ];
  for (const s of flow.steps) {
    if (s.action === "navigate") {
      steps.push({ type: "navigate", url: s.url, assertedEvents: [{ type: "navigation" }] });
    } else {
      // Recorder selectors: Selector[] = a fallback CHAIN. Use the CSS/text/aria
      // candidates the capture resolved. Recorder supports css/text/aria/xpath.
      const recorderSelectors = (s.selectors ?? [])
        .filter((sel) => /^[.#\[]|^text\/|^aria\//.test(sel)) // drop puppeteer-only :has-text
        .map((sel) => [sel]);
      steps.push({ type: "click", selectors: recorderSelectors.length ? recorderSelectors : [[".service-row"]], offsetX: 10, offsetY: 10 });
    }
  }
  return { title: flow.title, steps };
}

// ── OUTPUT 2: agent run-book (interpretable, self-healing) ────────────────────
function toAgentRunbook(flow: typeof CAPTURED): string {
  const lines: string[] = [
    `# Run-book: ${flow.title}`,
    `# domain: ${flow.domain}`,
    `# An agent drives these steps live. Try selectors in order; if all miss,`,
    `# use the label + assert to re-find the element by judgment. Honour waitFor.`,
    `# SAFETY: stop at the final step — never click "Book appointment".`,
    ``,
  ];
  flow.steps.forEach((s, i) => {
    lines.push(`## Step ${i + 1}: ${s.label}`);
    if (s.url) lines.push(`- action: navigate → ${s.url}`);
    else lines.push(`- action: click`);
    if (s.waitFor) lines.push(`- wait-for: ${s.waitFor}`);
    if (s.selectors) lines.push(`- selectors (try in order): ${s.selectors.join("  |  ")}`);
    if (s.assert) lines.push(`- assert-after: ${s.assert}`);
    lines.push(``);
  });
  return lines.join("\n");
}

// ── Emit + validate ──────────────────────────────────────────────────────────
const recorder = toRecorderJSON(CAPTURED);
console.log("══════════ OUTPUT 1: strict Chrome Recorder JSON ══════════");
console.log(JSON.stringify(recorder, null, 2));

console.log("\n=== validate Recorder JSON against @puppeteer/replay parse() ===");
try {
  const p = parse(recorder);
  console.log(`✓ VALID — ${p.steps.length} steps, replayable by Puppeteer`);
} catch (e) {
  console.log(`✗ INVALID: ${(e as Error).message}`);
}

console.log("\n══════════ OUTPUT 2: agent run-book ══════════");
console.log(toAgentRunbook(CAPTURED));
