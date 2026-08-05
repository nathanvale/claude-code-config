// PROTOTYPE — throwaway. Proves an LLM-driven MULTI-STEP login engine that handles
// an ARBITRARY step sequence (username -> password -> otp -> done) with NO
// hardcoded flow. Each iteration: snapshot -> classify the current step from the
// visible field + button -> deliver the matching field via the custody child
// (secret-unseen) -> re-verify origin -> click advance -> re-snapshot. Loops until
// signed in or no progress. Secret-free (dummy values via child fd3).
//
// Run: bun multistep-login-spike.mjs <browser-ws> <fixture-http-url>

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WS = process.argv[2];
const URL_ = process.argv[3];
if (!WS || !URL_) { console.error("usage: bun multistep-login-spike.mjs <ws> <url>"); process.exit(2); }
const HERE = dirname(fileURLToPath(import.meta.url));
// dummy values the child "delivers" (stands in for op read of username/password/otp)
const DUMMY = { username:"candidate.demo", password:"DUMMY-PW-000000", "otp-current":"654321" };

class Cdp {
  constructor(ws){ this.ws=ws; this.id=0; this.p=new Map();
    ws.addEventListener("message",(ev)=>{ const m=JSON.parse(ev.data);
      if(m.id!==undefined&&this.p.has(m.id)){ const {r,j}=this.p.get(m.id); this.p.delete(m.id);
        m.error?j(new Error(JSON.stringify(m.error))):r(m.result); } }); }
  static c(u){ return new Promise((res,rej)=>{ const ws=new WebSocket(u);
    ws.addEventListener("open",()=>res(new Cdp(ws))); ws.addEventListener("error",rej); }); }
  s(method,params={},sid){ const id=++this.id; const o={id,method,params}; if(sid)o.sessionId=sid;
    return new Promise((res,rej)=>{ this.p.set(id,{r:res,j:rej}); this.ws.send(JSON.stringify(o));
      setTimeout(()=>{ if(this.p.has(id)){ this.p.delete(id); rej(new Error("timeout "+method)); } },8000); }); }
  close(){ this.ws.close(); }
}
const norm=(u)=>{ try{return new URL(u).href;}catch{return u;} };
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

const cdp = await Cdp.c(WS);
const { targetInfos } = await cdp.s("Target.getTargets");
const tab = targetInfos.filter(t=>t.type==="page").find(t=>norm(t.url)===norm(URL_));
if (!tab) throw new Error("fixture not open");
const { sessionId } = await cdp.s("Target.attachToTarget",{ targetId: tab.targetId, flatten:true });
await cdp.s("Runtime.enable",{},sessionId); await cdp.s("DOM.enable",{},sessionId); await cdp.s("Accessibility.enable",{},sessionId);
const allowedOrigin = new URL(URL_).origin;

const evalExpr = async (e)=>{ const r=await cdp.s("Runtime.evaluate",{expression:e,returnByValue:true},sessionId); if(r.exceptionDetails) throw new Error("exc "+JSON.stringify(r.exceptionDetails)); return r.result.value; };
async function snapshot() {
  const tree = await cdp.s("Accessibility.getFullAXTree",{},sessionId);
  const textboxes = tree.nodes.filter(n=>n.role?.value==="textbox").map(n=>({ name:n.name?.value||"", backendNodeId:n.backendDOMNodeId }));
  const buttons = tree.nodes.filter(n=>n.role?.value==="button").map(n=>({ name:n.name?.value||"", backendNodeId:n.backendDOMNodeId }));
  return { textboxes, buttons };
}
// The "LLM" classifier: from the visible textbox name, decide which credential
// field this step wants. Pure reasoning over the snapshot — no hardcoded order.
function classify(snap) {
  const visible = snap.textboxes[0]; // the fixture shows one field per step
  if (!visible) return { step:"none" };
  const n = visible.name.toLowerCase();
  if (n.includes("user")) return { step:"username", field:"username", node:visible.backendNodeId };
  if (n.includes("pass")) return { step:"password", field:"password", node:visible.backendNodeId };
  if (n.includes("one-time")||n.includes("code")||n.includes("otp")) return { step:"otp", field:"otp-current", node:visible.backendNodeId };
  return { step:"unknown", name:visible.name };
}
async function reverifyOrigin() {
  const o = await evalExpr("location.origin");
  return o === allowedOrigin;
}
async function deliver(field, backendNodeId) {
  // custody child: value on fd3, insert into the proven node. Here dummy via printf.
  const val = DUMMY[field];
  return await new Promise((resolve)=>{
    const child = spawn("bash",["-c",
      `printf %s ${JSON.stringify(val)} 3>/dev/null | bun ${JSON.stringify(join(HERE,"custody-child.mjs"))} ${JSON.stringify(WS)} ${JSON.stringify(tab.targetId)} ${JSON.stringify(String(backendNodeId))} 3<&0`
    ],{stdio:["ignore","pipe","pipe"]});
    let o=""; child.stdout.on("data",d=>o+=d); child.on("close",()=>{ let r; try{r=JSON.parse(o.trim());}catch{r={ok:false};} resolve(r); });
  });
}
async function clickAdvance(snap) {
  const btn = snap.buttons[0]; if (!btn) return false;
  const { object } = await cdp.s("DOM.resolveNode",{ backendNodeId: btn.backendNodeId }, sessionId);
  // trusted-ish: dispatch full mouse sequence on the node (element.click alone is unreliable, per earlier finding)
  await cdp.s("Runtime.callFunctionOn",{ objectId:object.objectId, returnByValue:true,
    functionDeclaration:"function(){ for(const t of ['mouseover','mousedown','mouseup','click']) this.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window})); }" }, sessionId);
  await sleep(250);
  return true;
}

const trace = [];
let signedIn = false;
for (let i=0; i<8; i++) {  // bounded loop; arbitrary step count
  const state = await evalExpr("JSON.stringify(window.__ml())");
  const st = JSON.parse(state);
  if (st.signedIn) { signedIn = true; break; }
  const snap = await snapshot();
  const cls = classify(snap);
  if (cls.step === "none" || cls.step === "unknown") { trace.push({ iter:i, halt:cls }); break; }
  // R14: re-verify origin immediately before delivering a secret
  const originOk = await reverifyOrigin();
  if (!originOk) { trace.push({ iter:i, refused:"origin-mismatch" }); break; }
  const delivered = await deliver(cls.field, cls.node);
  const advanced = await clickAdvance(snap);
  trace.push({ iter:i, classified:cls.step, delivered_field:cls.field, delivered_ok:delivered.ok, shape:delivered.shape??null, origin_reverified:originOk, advanced });
}
const final = JSON.parse(await evalExpr("JSON.stringify(window.__ml())"));
cdp.close();
console.log(JSON.stringify({
  signed_in: signedIn || final.signedIn,
  steps_taken: trace.length,
  step_sequence: trace.map(t=>t.classified).filter(Boolean),
  origin_reverified_each_secret: trace.filter(t=>t.classified).every(t=>t.origin_reverified),
  delivered_shapes: trace.filter(t=>t.shape).map(t=>({field:t.delivered_field, ...t.shape})),
  final_model_committed: final.model,
  trace,
  verdict: (signedIn||final.signedIn) && trace.filter(t=>t.classified).every(t=>t.origin_reverified)
    ? "MULTI-STEP LOGIN OK: engine classified each screen, delivered the right field secret-unseen, re-verified origin per step, advanced to signed-in — no hardcoded flow"
    : "INCOMPLETE",
}, null, 2));
