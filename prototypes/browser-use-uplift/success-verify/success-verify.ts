/**
 * QUESTION
 * --------
 * An agent re-drives a saved browser flow (e.g. "submit weekly timesheet"),
 * possibly UNATTENDED every Friday. Clicking "Submit" is NOT proof the
 * submission worked. If the click silently fails, the user believes their
 * timesheet was filed when it wasn't.
 *
 * Can a success-verification layer turn the terminal action into a THREE-WAY
 * outcome — confirmed / failed / ambiguous — so that an unattended run only
 * records success when it actually SAW a real confirmation signal, and never
 * treats "ambiguous" as success?
 *
 * Modelled with in-memory post-submit page fixtures. Pure TS, zero deps.
 * Run: bun success-verify.ts
 */

// ---- Page model (what a post-submit page looks like) -----------------------

interface PageState {
  url: string;
  visibleText: string;
  elements: string[]; // selectors/ids of elements present in the DOM
  formInteractive: boolean; // is the original form still editable/enabled?
}

// ---- Success-signal spec (carried by each terminal step) -------------------

type SuccessSignal =
  | { kind: "url"; pattern: RegExp }
  | { kind: "text"; pattern: RegExp }
  | { kind: "element"; selector: string }
  | { kind: "form-cleared" }; // success = form went non-interactive

interface OutcomeSpec {
  success: SuccessSignal[]; // ANY match => confirmed
  failure: SuccessSignal[]; // ANY match => failed (known error)
}

type Outcome = "confirmed" | "failed" | "ambiguous";

interface VerifyResult {
  outcome: Outcome;
  reason: string;
}

// ---- The verifier ----------------------------------------------------------

function matches(page: PageState, sig: SuccessSignal): string | null {
  switch (sig.kind) {
    case "url":
      return sig.pattern.test(page.url) ? `url matches ${sig.pattern}` : null;
    case "text": {
      const m = page.visibleText.match(sig.pattern);
      return m ? `text matched "${m[0]}"` : null;
    }
    case "element":
      return page.elements.includes(sig.selector)
        ? `element "${sig.selector}" present`
        : null;
    case "form-cleared": {
      // A non-interactive form only counts as "cleared" if nothing signals the
      // page is mid-flight. A disabled-while-spinning form is NOT cleared.
      const spinning = page.elements.some((el) => /spinner|loading/i.test(el));
      if (page.formInteractive || spinning) return null;
      return "form cleared/disabled";
    }
  }
}

function firstMatch(page: PageState, sigs: SuccessSignal[]): string | null {
  for (const sig of sigs) {
    const hit = matches(page, sig);
    if (hit) return hit;
  }
  return null;
}

/**
 * Three-way verification. Failure is checked first: an explicit error signal
 * outranks any incidental success-looking text. Neither => ambiguous, which is
 * deliberately NOT success.
 */
function verifyOutcome(page: PageState, spec: OutcomeSpec): VerifyResult {
  const fail = firstMatch(page, spec.failure);
  if (fail) return { outcome: "failed", reason: fail };

  const ok = firstMatch(page, spec.success);
  if (ok) return { outcome: "confirmed", reason: ok };

  return {
    outcome: "ambiguous",
    reason: "no success or failure signal observed (page may be mid-flight)",
  };
}

// ---- Run recording (what an unattended run would persist) ------------------

interface RunRecord {
  scenario: string;
  recorded: "success" | "failure" | "needs-human";
  detail: string;
}

function recordRun(scenario: string, v: VerifyResult): RunRecord {
  switch (v.outcome) {
    case "confirmed":
      return { scenario, recorded: "success", detail: v.reason };
    case "failed":
      return {
        scenario,
        recorded: "failure",
        detail: `submission rejected: ${v.reason}`,
      };
    case "ambiguous":
      return {
        scenario,
        recorded: "needs-human",
        detail: `cannot confirm — ${v.reason}. ALERT before next unattended run.`,
      };
  }
}

// ---- Fixtures: realistic timesheet post-submit page states -----------------

const spec: OutcomeSpec = {
  success: [
    { kind: "url", pattern: /\/timesheet\/confirmation\b/ },
    { kind: "text", pattern: /Timesheet submitted|Reference #?\s*[A-Z]{2}-\d{4,}/i },
    { kind: "element", selector: "#submission-success-banner" },
    { kind: "form-cleared" },
  ],
  failure: [
    {
      kind: "text",
      pattern: /could not submit|validation error|missing hours|please correct/i,
    },
    { kind: "element", selector: "#form-error-summary" },
  ],
};

const confirmedPage: PageState = {
  url: "https://hr.example.com/timesheet/confirmation?id=TS-20517",
  visibleText:
    "Timesheet submitted. Reference # TS-20517. Approver: M. Cohen. You may close this window.",
  elements: ["#submission-success-banner", "#download-receipt"],
  formInteractive: false,
};

const failedPage: PageState = {
  url: "https://hr.example.com/timesheet/week/2026-W22",
  visibleText:
    "Could not submit. Validation error: Thursday is missing hours. Please correct the highlighted rows.",
  elements: ["#form-error-summary", "#hours-grid"],
  formInteractive: true,
};

const ambiguousPage: PageState = {
  // Click registered, button spun, page never transitioned. No signal either way.
  url: "https://hr.example.com/timesheet/week/2026-W22",
  visibleText: "Submitting… please wait.",
  elements: ["#hours-grid", "#submit-spinner"],
  formInteractive: false, // disabled while spinning — looks like success to a naive check!
};

// ---- Naive baseline: "we clicked submit, so it worked" ---------------------

function clickOnlyOutcome(): "success" {
  // The button click resolved without throwing in all three cases.
  return "success";
}

// ---- Run all three scenarios -----------------------------------------------

const glyph: Record<Outcome, string> = {
  confirmed: "✓",
  failed: "✗",
  ambiguous: "⚠",
};

const scenarios: Array<{ name: string; page: PageState }> = [
  { name: "Clean confirmation", page: confirmedPage },
  { name: "Validation error", page: failedPage },
  { name: "Spinner stuck", page: ambiguousPage },
];

console.log("=== Post-action success verification (timesheet submit) ===\n");

const records: RunRecord[] = [];
for (const { name, page } of scenarios) {
  const v = verifyOutcome(page, spec);
  const rec = recordRun(name, v);
  records.push(rec);
  console.log(
    `${glyph[v.outcome]} ${name.padEnd(20)} verified=${v.outcome.padEnd(10)} recorded=${rec.recorded}`,
  );
  console.log(`   ${rec.detail}\n`);
}

console.log("--- Verifier vs naive click-only baseline ---");
for (const { name, page } of scenarios) {
  const verified = verifyOutcome(page, spec).outcome;
  const naive = clickOnlyOutcome();
  const naiveWrong = verified !== "confirmed";
  console.log(
    `${name.padEnd(20)} click-only=${naive.padEnd(8)} verified=${verified.padEnd(10)} ${
      naiveWrong ? "<-- click-only FALSE POSITIVE" : "(both agree)"
    }`,
  );
}

const confirmedCount = records.filter((r) => r.recorded === "success").length;
const falsePositivesAvoided = scenarios.length - confirmedCount;

console.log("\n=== VERDICT ===");
console.log(
  `Three-way verification works: ${confirmedCount}/${scenarios.length} recorded success; ` +
    `${falsePositivesAvoided} would-be false positives caught by the verifier.`,
);
console.log(
  "Ambiguous is NOT success — it routes to needs-human, so an unattended run alerts " +
    "instead of silently claiming the timesheet was filed.",
);
