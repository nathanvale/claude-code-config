// PROTOTYPE — throwaway end-to-end spike for the confidential-delivery plan.
// Drives the REAL choreography contract shape (deliverConfidentialFields) with
// fakes standing in for the four unbuilt custody layers, and wires the delivery
// hook to a REAL second CDP client that performs the bounded insert into a live
// Agent Chrome scratch page. Secret-free: the only value written is the
// non-secret marker below. No production use; wipe with the scratchpad.
//
// Run: bun plan-e2e-spike.mjs <browser-ws-url> <fixture-url>
//
// What this proves end to end (plan U1-U6 control flow, not custody hardening):
//   binding -> reproveTarget(digest match) -> permit check -> handle mint
//     -> deliver hook (real CDP insert) -> outcome+shape -> resume directive
//   plus the fail-closed branches: challenge stop, digest drift, unpermitted
//   field, missing token, helper crash with honest external-effect flag.
//
// The choreography itself is PURE and already shipped; this spike reimplements
// its exact control flow inline (the repo module is TS; we run JS against live
// Chrome) so a mismatch would show up as a behavioral difference, and drives the
// same port shapes the plan's U2/U3/U1 must satisfy.

const BROWSER_WS = process.argv[2];
const FIXTURE_URL = process.argv[3];
const MARKER = "PLAN_E2E_PROBE_VALUE_67890"; // not a secret; a spike marker
if (!BROWSER_WS || !FIXTURE_URL) { console.error("usage: bun plan-e2e-spike.mjs <ws> <fixture>"); process.exit(2); }

// --------------------------------------------------------------------------
// Minimal flat-session CDP client (same shape proven in cdp-spike.mjs).
// --------------------------------------------------------------------------
class Cdp {
  constructor(ws){ this.ws=ws; this.id=0; this.pending=new Map();
    ws.addEventListener("message",(ev)=>{ const m=JSON.parse(ev.data);
      if(m.id!==undefined&&this.pending.has(m.id)){ const {resolve,reject}=this.pending.get(m.id); this.pending.delete(m.id);
        m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result); } }); }
  static connect(u){ return new Promise((res,rej)=>{ const ws=new WebSocket(u);
    ws.addEventListener("open",()=>res(new Cdp(ws))); ws.addEventListener("error",(e)=>rej(new Error("ws "+(e.message||e)))); }); }
  send(method,params={},sessionId){ const id=++this.id; const p={id,method,params}; if(sessionId)p.sessionId=sessionId;
    return new Promise((res,rej)=>{ this.pending.set(id,{resolve:res,reject:rej}); this.ws.send(JSON.stringify(p));
      setTimeout(()=>{ if(this.pending.has(id)){ this.pending.delete(id); rej(new Error("timeout "+method)); } },5000); }); }
  close(){ this.ws.close(); }
}

const norm=(u)=>{ try { return new URL(u).href; } catch { return u; } };

// --------------------------------------------------------------------------
// A single live CDP session, attached to the fixture page. Shared by the real
// reproof port and the real delivery hook — models the plan's "disposable
// helper attaches to the proven target over the handoff endpoint".
// --------------------------------------------------------------------------
async function attachSession(cdp, fixtureHref){
  const { targetInfos } = await cdp.send("Target.getTargets");
  const pages = targetInfos.filter(t=>t.type==="page");
  const matches = pages.filter(t=>norm(t.url)===norm(fixtureHref));
  if(matches.length!==1) throw new Error(`target single-match failed: ${matches.length} matches`);
  const target = matches[0];
  const { sessionId } = await cdp.send("Target.attachToTarget",{ targetId: target.targetId, flatten:true });
  await cdp.send("Runtime.enable",{},sessionId);
  await cdp.send("DOM.enable",{},sessionId);
  await cdp.send("Accessibility.enable",{},sessionId);
  return { sessionId, targetId: target.targetId };
}

// Observe the proven-target digest: normalized origin+href+targetId. The plan's
// U3 reproveTarget computes this canonical digest read-only; drift changes it.
async function observeDigest(cdp, sessionId, targetId){
  const r = await cdp.send("Runtime.evaluate",{ expression:"JSON.stringify({o:location.origin,h:location.href})", returnByValue:true }, sessionId);
  const { o, h } = JSON.parse(r.result.value);
  // canonical: stable key order, volatile fields (title/timing) excluded.
  return `${targetId}|${o}|${h}`;
}

// Resolve the exact field node from role+name, return backendNodeId (U3/U4 bridge).
async function resolveField(cdp, sessionId, role, name){
  const tree = await cdp.send("Accessibility.getFullAXTree",{},sessionId);
  const node = tree.nodes.find(n=>n.role?.value===role && n.name?.value===name);
  if(!node) throw new Error(`no AX node role=${role} name=${name}`);
  return node.backendDOMNodeId;
}

// Read the ngModel-equivalent + counters (asserts the write really committed).
async function readModel(cdp, sessionId){
  const r = await cdp.send("Runtime.evaluate",{ expression:"JSON.stringify(window.__spike())", returnByValue:true }, sessionId);
  return JSON.parse(r.result.value);
}

// --------------------------------------------------------------------------
// FAKES for the four unbuilt custody layers, matching the plan's port shapes.
// --------------------------------------------------------------------------

// Fake handle registry (plan U2 / KTD6): single-use reservation, no bytes.
function makeHandleRegistry({ nowMs }){
  const live = new Map();
  return {
    mint(binding, field, targetDigest){
      const handle_id = `h_${field}_${binding.binding_slug}`;
      live.set(handle_id, { binding_slug: binding.binding_slug, field, targetDigest, redeemed:false, expires_at: nowMs+60000 });
      return { handle_id, field, expires_at_epoch_ms: nowMs+60000 };
    },
    // The deliver hook redeems exactly once; rejects replay/expiry/digest drift.
    redeem(handle, currentDigest){
      const rec = live.get(handle.handle_id);
      if(!rec) return { ok:false, reason:"unknown-handle" };
      if(rec.redeemed) return { ok:false, reason:"replay" };
      if(nowMs > rec.expires_at) return { ok:false, reason:"expired" };
      if(rec.targetDigest !== currentDigest) return { ok:false, reason:"target-digest-drift" };
      rec.redeemed = true;
      return { ok:true };
    },
  };
}

// Fake token-retrieval port (plan U2). Never returns bytes — mints a handle.
// `mode` injects the fail-closed cases.
function makeTokenPort(registry, target, { mode }){
  return {
    async fetchCredentialField({ binding, field }){
      if(mode==="missing-token") return { ok:false, rejection:{ code:"token-invalid", message:"withheld" } };
      const handle = registry.mint(binding, field, target.target_proof_digest);
      return { ok:true, handle };
    },
  };
}

// --------------------------------------------------------------------------
// The choreography control flow (mirrors deliverConfidentialFields verbatim).
// --------------------------------------------------------------------------
const OP_METHOD_BY_FIELD = { username:"password", password:"password", "otp-current":"otp" };
const BLOCKED_BY_CHALLENGE = { passkey:"user-presence-required", captcha:"user-presence-required",
  consent:"user-presence-required", "recovery-code":"user-presence-required",
  "ambiguous-identity":"human-identity-attestation-required" };

async function deliverConfidentialFields(input){
  if(input.detected_challenge!=null)
    return { ok:false, blocked:{ blocked_cause: BLOCKED_BY_CHALLENGE[input.detected_challenge], external_effect_possible:false, fields_cleared:false } };
  if(input.fields.length===0)
    return { ok:false, blocked:{ blocked_cause:"target-proof-invalid", external_effect_possible:false, fields_cleared:false } };
  const delivered_shapes=[];
  for(const field of input.fields){
    const reproof = await input.reproveTarget({ target: input.target });
    if(!reproof.proven) return { ok:false, blocked:{ blocked_cause:reproof.cause, external_effect_possible:false, fields_cleared:false } };
    if(reproof.observed_digest !== input.target.target_proof_digest)
      return { ok:false, blocked:{ blocked_cause:"target-proof-invalid", external_effect_possible:false, fields_cleared:false } };
    const required = OP_METHOD_BY_FIELD[field];
    if(!input.binding.allowed_auth_methods.includes(required))
      return { ok:false, blocked:{ blocked_cause:"unsupported-method", external_effect_possible:false, fields_cleared:false } };
    const fetched = await input.tokenRetrieval.fetchCredentialField({ binding: input.binding, field });
    if(!fetched.ok) return { ok:false, blocked:{ blocked_cause:"missing-token", external_effect_possible:false, fields_cleared:false } };
    const action = await input.deliver({ handle: fetched.handle, field, target: input.target });
    if(!action.ok){
      const possible = action.reason!=="helper-unavailable";
      const cause = action.reason==="target-drift" ? "target-proof-invalid" : "capability-loss";
      return { ok:false, blocked:{ blocked_cause:cause, external_effect_possible:possible, fields_cleared:action.field_cleared } };
    }
    delivered_shapes.push(action.shape);
  }
  return { ok:true, resume:{ lane_id:input.target.lane_id, run_id:input.target.run_id, target_id:input.target.target_id,
    discard_stale_refs:true, require_fresh_identity_basis:true, delivered_shapes } };
}

// --------------------------------------------------------------------------
// Wire it up against live Chrome and run scenarios.
// --------------------------------------------------------------------------
const cdp = await Cdp.connect(BROWSER_WS);
const { sessionId, targetId } = await attachSession(cdp, FIXTURE_URL);
const backendNodeId = await resolveField(cdp, sessionId, "textbox", "Confidential value");
const digest = await observeDigest(cdp, sessionId, targetId);

const binding = { binding_slug:"fasttrack-login", allowed_auth_methods:["password","otp"] };
const target = { lane_id:"agent-browser", run_id:"spike-run", top_level_origin:"file://",
  frame_origin:"file://", target_id: targetId, page_id:"t1", frame_id:"main",
  account_ref:"redacted:expected-principal", target_proof_digest: digest };

const nowMs = 1785452846000; // fixed clock (prototype rule 3): no Date.now
const results = {};

function makeReproof({ drift=false }={}){
  return async () => {
    // re-observe read-only immediately before the field (R14 / plan U3).
    const observed = drift ? digest+"|DRIFTED" : await observeDigest(cdp, sessionId, targetId);
    return { proven:true, observed_digest: observed };
  };
}

// The REAL delivery hook: redeem handle, re-check digest, do ONE bounded insert
// via the live CDP session, report outcome + non-secret shape. `crash` injects
// a mid-action helper crash after a possible write (honest external-effect).
function makeDeliverHook(registry, { crash=false }={}){
  return async ({ handle, field, target }) => {
    const currentDigest = await observeDigest(cdp, sessionId, targetId);
    const redeem = registry.redeem(handle, currentDigest);
    if(!redeem.ok) return { ok:false, reason:"target-drift", field_cleared:true };
    // one bounded insert into the proven field
    await cdp.send("DOM.focus",{ backendNodeId }, sessionId);
    await cdp.send("Input.insertText",{ text: MARKER }, sessionId);
    if(crash) return { ok:false, reason:"helper-crash", field_cleared:false }; // write landed, then crash
    const model = await readModel(cdp, sessionId);
    return { ok:true, shape:{ field, byte_length: Buffer.byteLength(MARKER,"utf8"), _committed_model: model.model, _input_events: model.inputCount } };
  };
}

async function resetField(){ await cdp.send("Runtime.evaluate",{ expression:"(()=>{const e=document.getElementById('secret');e.value='';})()", returnByValue:true }, sessionId); }

// Scenario A: happy path end to end (password + otp-current).
{
  await resetField();
  const registry = makeHandleRegistry({ nowMs });
  const res = await deliverConfidentialFields({ binding, target, fields:["password","otp-current"],
    tokenRetrieval: makeTokenPort(registry, target, {}), deliver: makeDeliverHook(registry, {}),
    reproveTarget: makeReproof(), detected_challenge:null });
  const model = await readModel(cdp, sessionId);
  results.A_happy_path = { ok: res.ok, resume: res.ok?{ discard:res.resume.discard_stale_refs, fresh:res.resume.require_fresh_identity_basis,
    shapes:res.resume.delivered_shapes.map(s=>({field:s.field,byte_length:s.byte_length,committed_model:s._committed_model,input_events:s._input_events})) }:null,
    committed_model_after: model.model, input_event_count: model.inputCount };
}

// Scenario B: human challenge before any secret access — no field touched.
{
  await resetField();
  const registry = makeHandleRegistry({ nowMs });
  const before = await readModel(cdp, sessionId);
  const res = await deliverConfidentialFields({ binding, target, fields:["password"],
    tokenRetrieval: makeTokenPort(registry, target, {}), deliver: makeDeliverHook(registry, {}),
    reproveTarget: makeReproof(), detected_challenge:"passkey" });
  const after = await readModel(cdp, sessionId);
  results.B_human_challenge = { ok:res.ok, blocked_cause:res.blocked?.blocked_cause, external_effect: res.blocked?.external_effect_possible,
    field_untouched: before.inputCount===after.inputCount };
}

// Scenario C: target digest drift at reproof — blocks before handle mint.
{
  await resetField();
  const registry = makeHandleRegistry({ nowMs });
  const before = await readModel(cdp, sessionId);
  const res = await deliverConfidentialFields({ binding, target, fields:["password"],
    tokenRetrieval: makeTokenPort(registry, target, {}), deliver: makeDeliverHook(registry, {}),
    reproveTarget: makeReproof({ drift:true }), detected_challenge:null });
  const after = await readModel(cdp, sessionId);
  results.C_digest_drift = { ok:res.ok, blocked_cause:res.blocked?.blocked_cause, field_untouched: before.inputCount===after.inputCount };
}

// Scenario D: unpermitted field (binding lacks otp) — unsupported-method.
{
  await resetField();
  const registry = makeHandleRegistry({ nowMs });
  const pwOnly = { binding_slug:"pw-only", allowed_auth_methods:["password"] };
  const res = await deliverConfidentialFields({ binding: pwOnly, target, fields:["otp-current"],
    tokenRetrieval: makeTokenPort(registry, target, {}), deliver: makeDeliverHook(registry, {}),
    reproveTarget: makeReproof(), detected_challenge:null });
  results.D_unpermitted_field = { ok:res.ok, blocked_cause:res.blocked?.blocked_cause };
}

// Scenario E: missing token — blocks, no write.
{
  await resetField();
  const registry = makeHandleRegistry({ nowMs });
  const before = await readModel(cdp, sessionId);
  const res = await deliverConfidentialFields({ binding, target, fields:["password"],
    tokenRetrieval: makeTokenPort(registry, target, { mode:"missing-token" }), deliver: makeDeliverHook(registry, {}),
    reproveTarget: makeReproof(), detected_challenge:null });
  const after = await readModel(cdp, sessionId);
  results.E_missing_token = { ok:res.ok, blocked_cause:res.blocked?.blocked_cause, field_untouched: before.inputCount===after.inputCount };
}

// Scenario F: helper crash mid-action — honest external-effect-possible flag.
{
  await resetField();
  const registry = makeHandleRegistry({ nowMs });
  const res = await deliverConfidentialFields({ binding, target, fields:["password"],
    tokenRetrieval: makeTokenPort(registry, target, {}), deliver: makeDeliverHook(registry, { crash:true }),
    reproveTarget: makeReproof(), detected_challenge:null });
  results.F_helper_crash = { ok:res.ok, blocked_cause:res.blocked?.blocked_cause, external_effect_possible:res.blocked?.external_effect_possible };
}

// Scenario G: handle single-use — a second redeem of the same handle rejects.
{
  await resetField();
  const registry = makeHandleRegistry({ nowMs });
  const h = registry.mint(binding, "password", digest);
  const first = registry.redeem(h, digest);
  const second = registry.redeem(h, digest);
  results.G_handle_single_use = { first_ok:first.ok, second_ok:second.ok, second_reason:second.reason };
}

await resetField();
console.log(JSON.stringify(results, null, 2));
cdp.close();
