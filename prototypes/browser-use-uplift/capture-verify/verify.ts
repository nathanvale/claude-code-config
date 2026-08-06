// PROTOTYPE — throwaway. CAPTURE VERIFICATION: store the RIGHT selector, and
// self-detect/heal when it's wrong. Prior prototypes proved recall SPEEDUP but
// exposed a silent-failure bug: a naive text-hint regex captured the USERNAME
// selector for the "submit" field, and the next run confidently reused garbage.
// Confident-wrong memory is worse than no memory.
//
// Two gates fix it:
//   GATE 1 (capture-time assert): after resolving a selector, VERIFY the element
//     matches the target's expected shape BEFORE storing. Reject + rediscover on fail.
//   GATE 2 (recall-time re-verify): before TRUSTING a recalled selector, cheaply
//     confirm it still resolves to a matching element. On drift → rediscover + RE-CAPTURE.
//
// No live browser (shared Chrome :9444 is single-driver). The page is an in-memory
// DOM fixture so the run is deterministic + zero-dep.
//
// Run: bun prototypes/browser-use-uplift/capture-verify/verify.ts

// ---- in-memory DOM fixture (stands in for a live page) ----
interface El {
  id: string;
  name?: string;
  type?: string; // input type, or "submit"/"button" for buttons
  tag?: "input" | "button"; // default input
  text?: string; // visible/button text
}

// A realistic ASP.NET WebForms login page.
const PAGE_V1: El[] = [
  { id: "MainContent_LoginControl_UserName", name: "ctl00$UserName", type: "text", text: "Username" },
  { id: "MainContent_LoginControl_Password", name: "ctl00$Password", type: "password", text: "Password" },
  { id: "MainContent_LoginControl_LoginButton", name: "ctl00$Login", tag: "button", type: "submit", text: "Log In" },
];

type Target = "username" | "password" | "submit";

// ---- the CORE of the prototype: per-target assert predicates (expected shape) ----
const ASSERTS: Record<Target, { describe: string; ok: (el: El | undefined) => boolean }> = {
  username: {
    describe: "input with type text|email",
    ok: (el) => !!el && (el.tag ?? "input") === "input" && ["text", "email"].includes(el.type ?? ""),
  },
  password: {
    describe: "input with type password",
    ok: (el) => !!el && (el.tag ?? "input") === "input" && el.type === "password",
  },
  submit: {
    describe: "button/type=submit with submit-like text",
    ok: (el) =>
      !!el &&
      (el.type === "submit" || el.tag === "button") &&
      /\b(log ?in|sign ?in|submit|continue|next)\b/i.test(el.text ?? ""),
  },
};

const q = (page: El[], sel: string): El | undefined => page.find((e) => `#${e.id}` === sel);
const log = (m: string) => console.log(m);

// ---- discovery strategies ----
// NAIVE: match any element whose id/text contains the target word. This is the
// BUGGY strategy from the prior prototype. For "submit" the hint is "login", and
// on ASP.NET the USERNAME field's id is `...LoginControl_UserName` — it contains
// "login", appears first in DOM order, so the loose contains-match grabs the
// USERNAME field for "submit". Classic confident-wrong capture, unguarded by shape.
function discoverNaive(page: El[], target: Target): string | undefined {
  const hint = target === "submit" ? "login" : target;
  // BUG: first element whose id OR text mentions the hint wins — no shape check.
  const hit = page.find(
    (e) => e.id.toLowerCase().includes(hint) || (e.text ?? "").toLowerCase().includes(hint),
  );
  return hit ? `#${hit.id}` : undefined;
}

// ROBUST: discover by shape, then disambiguate by text. This is what we fall back to.
function discoverRobust(page: El[], target: Target): string | undefined {
  const candidates = page.filter((e) => ASSERTS[target].ok(e));
  return candidates[0] ? `#${candidates[0].id}` : undefined;
}

// ---- GATE 1: capture-time assert ----
// Resolve a selector, VERIFY shape, only then return it for storage.
function captureSelector(page: El[], target: Target, store: Record<string, string>) {
  let sel = discoverNaive(page, target);
  let how = "naive text-hint";
  const resolved = q(page, sel ?? "");
  if (ASSERTS[target].ok(resolved)) {
    log(`  ✓ GATE 1 capture-assert PASSED for "${target}": ${sel} is ${ASSERTS[target].describe}`);
  } else {
    log(
      `  ✗ GATE 1 capture-assert FAILED for "${target}": ${sel} resolves to ` +
        `${resolved ? `${resolved.tag ?? "input"} type=${resolved.type} text="${resolved.text}"` : "nothing"} ` +
        `— expected ${ASSERTS[target].describe}. REJECTING (would be confident-wrong memory).`,
    );
    sel = discoverRobust(page, target);
    how = "robust shape-match (rediscovered)";
    const fixed = q(page, sel ?? "");
    if (ASSERTS[target].ok(fixed)) {
      log(`    ↪ rediscovered via shape: ${sel} ✓ now passes the assert — storing CORRECTED selector`);
    } else {
      log(`    ✗ rediscovery also failed — refusing to store anything for "${target}"`);
      return;
    }
  }
  store[target] = sel!;
  log(`    → stored ${target} = ${sel}  (${how})`);
}

// ---- GATE 2: recall-time re-verify ----
// Before trusting a stored selector, confirm it still matches. On fail → re-capture.
function recallSelector(page: El[], target: Target, store: Record<string, string>): string | undefined {
  const sel = store[target];
  const resolved = q(page, sel ?? "");
  if (ASSERTS[target].ok(resolved)) {
    log(`  ✓ GATE 2 recall re-verify PASSED for "${target}": stored ${sel} still ${ASSERTS[target].describe}`);
    return sel;
  }
  log(
    `  ✗ GATE 2 recall re-verify FAILED for "${target}": stored ${sel} now resolves to ` +
      `${resolved ? `${resolved.tag ?? "input"} type=${resolved.type}` : "nothing"} (drift!). Rediscovering + re-capturing...`,
  );
  const fresh = discoverRobust(page, target);
  if (fresh && ASSERTS[target].ok(q(page, fresh))) {
    store[target] = fresh;
    log(`    ↪ self-healed: re-captured ${target} = ${fresh} ✓ (memory corrected for next run)`);
    return fresh;
  }
  log(`    ✗ could not rediscover "${target}" on this page`);
  return undefined;
}

function main() {
  const targets: Target[] = ["username", "password", "submit"];
  const store: Record<string, string> = {};

  log("=== CAPTURE VERIFICATION prototype (in-memory DOM fixture) ===\n");

  log("--- CAPTURE RUN (GATE 1) — naive discovery is buggy on 'submit' ---");
  for (const t of targets) captureSelector(PAGE_V1, t, store);
  const submitOk = ASSERTS.submit.ok(q(PAGE_V1, store.submit));
  log(`\nStored memory after capture: ${JSON.stringify(store)}`);
  log(`Gate-1 result: submit selector is ${submitOk ? "CORRECT ✓" : "WRONG ✗"} (bug caught + corrected at capture time)\n`);

  log("--- RECALL RUN A (GATE 2) — same page, stored selectors should re-verify clean ---");
  for (const t of targets) recallSelector(PAGE_V1, t, store);

  log("\n--- SIMULATE DRIFT — the submit button's id changes on the live page ---");
  const PAGE_V2: El[] = PAGE_V1.map((e) =>
    e.id === "MainContent_LoginControl_LoginButton" ? { ...e, id: "MainContent_LoginControl_SubmitBtn" } : e,
  );
  log(`  (LoginButton id → MainContent_LoginControl_SubmitBtn; stored selector now stale)\n`);

  log("--- RECALL RUN B (GATE 2) — drift must be detected + re-captured ---");
  const healedBefore = store.submit;
  for (const t of targets) recallSelector(PAGE_V2, t, store);
  const healed = store.submit !== healedBefore && ASSERTS.submit.ok(q(PAGE_V2, store.submit));
  log(`\nStored memory after drift heal: ${JSON.stringify(store)}`);

  log("\n=== VERDICT ===");
  const verdict = submitOk && healed;
  log(`Gate 1 (capture-assert) caught the wrong-selector bug + stored the corrected one: ${submitOk ? "✓" : "✗"}`);
  log(`Gate 2 (recall re-verify) detected simulated drift + self-healed the memory: ${healed ? "✓" : "✗"}`);
  log(
    verdict
      ? "✓ PROVEN: verification gates make captured memory self-correcting — no confident-wrong selectors survive."
      : "✗ FAILED: a gate did not fire as intended.",
  );
  process.exit(verdict ? 0 : 1);
}

main();
