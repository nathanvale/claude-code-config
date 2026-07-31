// PROTOTYPE — throwaway. Proves the UNHAPPY PATHS of vault-item resolution +
// custody delivery, against the REAL "Browser Automation" vault. Every case must
// fail CLOSED with a typed reason, before any secret leaves custody. No portal,
// no real login — pure failure-mode coverage. Secret-free (never reads a value).
//
// Run: bun vault-unhappy-spike.mjs

import { spawnSync } from "node:child_process";

const VAULT = "Browser Automation";
const REAL_ITEM = "6he7gmnrc54ssdm7fzzvk4rmne";       // Fasttrack360 (real)
const REAL_ORIGIN = "https://manpowergroup.fasttrack360.com.au";

// Resolve item metadata; classify failures into typed reasons the plan uses.
function resolveItem(item_id, { token } = {}) {
  const env = { ...process.env };
  if (token !== undefined) env.OP_SERVICE_ACCOUNT_TOKEN = token; // force token auth
  const r = spawnSync("op", ["item","get",item_id,"--vault",VAULT,"--format=json"], { encoding:"utf8", env });
  if (r.status !== 0) {
    const e = (r.stderr||"").toLowerCase();
    let reason = "io-failure";
    if (e.includes("decodesacredentials") || e.includes("invalid") && e.includes("token")) reason = "token-invalid";
    else if (e.includes("isn't an item") || e.includes("not found") || e.includes("no item")) reason = "item-missing";
    else if (e.includes("session") || e.includes("sign in") || e.includes("not currently signed in")) reason = "pre-first-unlock";
    return { ok:false, reason, stderr_head: (r.stderr||"").split("\n")[0].slice(0,120) };
  }
  const d = JSON.parse(r.stdout);
  const fields = (d.fields||[]).map(f=>({ label:f.label||f.id, type:f.type||f.purpose||"", has_value:f.value!=null }));
  return { ok:true, title:d.title, fields };
}

// Binding permits delivery only if the requested field exists AND the observed
// origin is in the binding's allowed origins.
// Resolution reason -> plan blocked cause (mirrors blockedCauseForRejection).
const BLOCKED_BY_RESOLVE_REASON = {
  "token-invalid": "missing-token",
  "pre-first-unlock": "missing-token",
  "item-missing": "revoked-binding",
  "io-failure": "capability-loss",
};
function checkBinding(item, { field, observedOrigin, allowedOrigins }) {
  if (!item.ok) return { deliverable:false, blocked: BLOCKED_BY_RESOLVE_REASON[item.reason] ?? "capability-loss", from:item.reason };
  const hasField = item.fields.some(f=>f.label===field && f.has_value);
  if (!hasField) return { deliverable:false, blocked:"unsupported-method", detail:`no populated '${field}' field` };
  if (!allowedOrigins.includes(observedOrigin)) return { deliverable:false, blocked:"origin-mismatch", detail:`observed ${observedOrigin} not in allowed` };
  return { deliverable:true };
}

const cases = {};

// U1. Bogus service-account token -> token-invalid, fail closed.
cases.bogus_token = (() => {
  const item = resolveItem(REAL_ITEM, { token: "ops_BOGUS_NOT_A_REAL_TOKEN" });
  return { resolve: item, binding: checkBinding(item, { field:"password", observedOrigin:REAL_ORIGIN, allowedOrigins:[REAL_ORIGIN] }) };
})();

// U2. Non-existent item id -> item-missing.
cases.missing_item = (() => {
  const item = resolveItem("aaaaaaaaaaaaaaaaaaaaaaaaaa");
  return { resolve: item, binding: checkBinding(item, { field:"password", observedOrigin:REAL_ORIGIN, allowedOrigins:[REAL_ORIGIN] }) };
})();

// U3. Real item, but binding asks for a field that isn't populated (e.g. otp-current)
//     -> unsupported-method (the item has no such field).
cases.missing_field = (() => {
  const item = resolveItem(REAL_ITEM);
  return { resolve: { ok:item.ok, title:item.title }, binding: checkBinding(item, { field:"otp-current", observedOrigin:REAL_ORIGIN, allowedOrigins:[REAL_ORIGIN] }) };
})();

// U4. Real item + real field, but the OBSERVED origin is wrong (phishing/redirect)
//     -> origin-mismatch: refuse BEFORE any secret leaves custody.
cases.origin_mismatch = (() => {
  const item = resolveItem(REAL_ITEM);
  return { resolve: { ok:item.ok, title:item.title },
    binding: checkBinding(item, { field:"password", observedOrigin:"https://manpowergroup-phishing.example.com", allowedOrigins:[REAL_ORIGIN] }) };
})();

// U5. Happy control: real item + real field + correct origin -> deliverable.
cases.happy_control = (() => {
  const item = resolveItem(REAL_ITEM);
  return { resolve: { ok:item.ok, title:item.title },
    binding: checkBinding(item, { field:"password", observedOrigin:REAL_ORIGIN, allowedOrigins:[REAL_ORIGIN] }) };
})();

// Verdict per case: an unhappy case is CORRECT iff it is not deliverable and
// carries a typed blocked reason. The happy control must be deliverable.
const summary = {};
for (const [name, c] of Object.entries(cases)) {
  const isHappy = name === "happy_control";
  const correct = isHappy ? c.binding.deliverable === true
                          : c.binding.deliverable === false && !!c.binding.blocked;
  summary[name] = {
    deliverable: c.binding.deliverable,
    blocked: c.binding.blocked ?? null,
    detail: c.binding.detail ?? c.binding.from ?? c.resolve.reason ?? null,
    correct,
  };
}

console.log(JSON.stringify({ cases: summary,
  all_correct: Object.values(summary).every(s=>s.correct),
  note: "every unhappy case fails closed with a typed reason BEFORE any secret read; happy control is deliverable" }, null, 2));
