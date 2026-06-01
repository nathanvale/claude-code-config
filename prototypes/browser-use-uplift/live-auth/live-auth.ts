/**
 * QUESTION
 * --------
 * Can a saved browser flow log in on every run WITHOUT ever persisting the real
 * password? The stored memory must hold only an "Auth Pointer" (a shape-only
 * reference like `1password:Molty/Oncore Login/password`). At run time the flow
 * resolves the pointer -> fetches the secret -> fills it into the live field ->
 * and the secret must NEVER hit disk, logs, the run-book, or the Recorder JSON.
 *
 * This prototype proves the Auth-Pointer -> resolve -> fill -> no-leak boundary
 * is safe: the secret exists only in memory during the fill; everything
 * persisted is shape-only.
 *
 * SECURITY NOTE: This MOCKS 1Password entirely. No `op`, no real credential file,
 * no env var, no network, no shell. `resolveSecret` returns an obviously-fake
 * constant. Real `op` access is a plan concern owned by the `one-password` skill.
 *
 * Run: bun live-auth.ts
 */

// Obviously-fake secret. The real resolver (one-password skill) would return
// the actual vault value; here we keep it fake and constant on purpose.
const FAKE_SECRET = "hunter2-FAKE-SECRET";

// ---- Types ------------------------------------------------------------------

/** Shape-only reference stored in the run-book. NEVER holds a secret value. */
type AuthPointer = {
  field: string;
  secretRef: string; // e.g. "1password:Molty/Oncore Login/password"
  valueShape: string; // e.g. "redacted:password-field"
};

type RunBookStep =
  | { kind: "type"; field: string; value: string }
  | { kind: "auth"; field: string; auth: AuthPointer };

type RunBook = { name: string; steps: RunBookStep[] };

/** What the Recorder would persist for a step (mirrors the live DOM action). */
type RecorderEvent = { action: string; field: string; value: string };

// ---- Console capture --------------------------------------------------------
// Wrap console.log so the leak-check can also scan everything that was logged.

const consoleBuffer: string[] = [];
const realLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  consoleBuffer.push(args.map((a) => String(a)).join(" "));
  realLog(...args);
};

// ---- Mock secret resolver ---------------------------------------------------

/** MOCK. Real impl would shell to `op` via the one-password skill. */
function resolveSecret(secretRef: string): string {
  if (!secretRef.startsWith("1password:")) {
    throw new Error(`unsupported secretRef: ${secretRef}`);
  }
  return FAKE_SECRET;
}

// ---- Live field-fill (in-memory, no browser) --------------------------------

/** Models filling a DOM input. Secret lives only in `live` and is dropped after. */
function liveLoginField(pointer: AuthPointer): RecorderEvent {
  // Secret enters scope ONLY here.
  const secret = resolveSecret(pointer.secretRef);
  const live = { field: pointer.field, value: secret }; // would be page.fill(...)
  void live; // (fill happens; we don't keep it)

  // What the Recorder persists for this step: the SHAPE, never the value.
  const event: RecorderEvent = {
    action: "fill",
    field: pointer.field,
    value: pointer.valueShape, // "redacted:password-field" — NOT the secret
  };
  // secret + live go out of scope when this function returns.
  return event;
}

// ---- Leak check (the centerpiece) -------------------------------------------

/**
 * Scan every persisted artifact + the console buffer for the real secret.
 * Returns { leaked, hits }. `leaked === false` is the safety guarantee.
 */
function leakCheck(artifacts: Record<string, unknown>, logs: string[]) {
  const hits: string[] = [];
  for (const [name, obj] of Object.entries(artifacts)) {
    if (JSON.stringify(obj).includes(FAKE_SECRET)) hits.push(`artifact:${name}`);
  }
  for (const line of logs) {
    if (line.includes(FAKE_SECRET)) hits.push("console.log");
  }
  return { leaked: hits.length > 0, hits };
}

// ---- Scenario ---------------------------------------------------------------

// The stored run-book: the password step holds ONLY an Auth Pointer.
const runBook: RunBook = {
  name: "submit-weekly-timesheet",
  steps: [
    { kind: "type", field: "username", value: "molty@oncore.example" },
    {
      kind: "auth",
      field: "password",
      auth: {
        field: "password",
        secretRef: "1password:Molty/Oncore Login/password",
        valueShape: "redacted:password-field",
      },
    },
  ],
};

/** Run the flow the SAFE way: resolve pointer at fill-time, persist shapes only. */
function runSafe() {
  const recorderJson: RecorderEvent[] = [];
  for (const step of runBook.steps) {
    if (step.kind === "type") {
      recorderJson.push({ action: "type", field: step.field, value: step.value });
    } else {
      // Secret is resolved + filled inside liveLoginField, then dropped.
      recorderJson.push(liveLoginField(step.auth));
    }
  }
  const runOutcome = { flow: runBook.name, status: "ok", steps: recorderJson.length };
  return { runBook, recorderJson, runOutcome };
}

/** The FAILURE this gate prevents: a naive recorder captures the typed secret. */
function runNaive() {
  const secret = resolveSecret("1password:Molty/Oncore Login/password");
  // Naive capture: stores the literal keystrokes, secret inline. THIS is the bug.
  const recorderJson: RecorderEvent[] = [
    { action: "type", field: "username", value: "molty@oncore.example" },
    { action: "type", field: "password", value: secret },
  ];
  const naiveRunBook = {
    name: "submit-weekly-timesheet",
    steps: [{ kind: "type", field: "password", value: secret }],
  };
  return { runBook: naiveRunBook, recorderJson };
}

// ---- Execute + report -------------------------------------------------------

console.log("=== live-auth boundary prototype ===\n");

// SAFE PATH
const safe = runSafe();
console.log("Stored run-book password step (shape-only):");
console.log("  " + JSON.stringify(runBook.steps[1]));
console.log("Recorder JSON persisted:");
console.log("  " + JSON.stringify(safe.recorderJson));
console.log("Run outcome log:");
console.log("  " + JSON.stringify(safe.runOutcome));

const safeResult = leakCheck(
  { runBook: safe.runBook, recorderJson: safe.recorderJson, runOutcome: safe.runOutcome },
  consoleBuffer,
);
console.log(
  safeResult.leaked
    ? `\n  ✗ LEAK in safe path: ${safeResult.hits.join(", ")}`
    : "\n  ✓ no leak — persisted artifacts + console contain only redacted:* / 1password:* shapes",
);

// NAIVE PATH (must be caught). Build artifacts WITHOUT logging the secret to
// console, so the only leak source is the persisted artifacts themselves.
console.log("\n--- naive recorder (the bug this gate blocks) ---");
const naive = runNaive();
const preNaiveLogLen = consoleBuffer.length;
const naiveResult = leakCheck(
  { runBook: naive.runBook, recorderJson: naive.recorderJson },
  consoleBuffer.slice(0, preNaiveLogLen),
);
console.log("Naive recorder would persist (secret inline):");
console.log("  password step value === FAKE_SECRET? " + (naive.recorderJson[1].value === FAKE_SECRET));
console.log(
  naiveResult.leaked
    ? `  ✓ leak-check CAUGHT the naive capture: ${naiveResult.hits.join(", ")}`
    : "  ✗ leak-check MISSED the naive capture",
);

// VERDICT
const pass = !safeResult.leaked && naiveResult.leaked;
console.log("\n=== VERDICT ===");
console.log(
  pass
    ? "PASS — Auth-Pointer boundary holds: safe path leaks nothing, naive path is caught."
    : "FAIL — boundary broken (see above).",
);

console.log = realLog;
process.exit(pass ? 0 : 1);
