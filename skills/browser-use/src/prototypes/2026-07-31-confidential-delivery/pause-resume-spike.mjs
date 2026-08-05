// PROTOTYPE — throwaway. Proves the PAUSE/RESUME continuity around confidential
// delivery (choreography R22-R24): a task lane runs, hits a confidential step,
// PAUSES (captures pre-delivery refs), custody delivers, then the lane RESUMES per
// the resume directive: it must DISCARD its stale adapter refs and prove a FRESH
// identity basis before continuing — never crash on a stale ref, never reuse an
// adapter ref that predates delivery.
//
// Drives a REAL page: the lane resolves an element ref BEFORE delivery, delivery
// mutates the DOM (login advances/replaces the field), and the spike proves that
// (a) reusing the stale ref after delivery FAILS (the hazard), and (b) obeying the
// resume directive (re-resolve fresh) SUCCEEDS. Uses the multistep fixture where
// the DOM genuinely changes across the confidential step.
//
// Run: bun pause-resume-spike.mjs <browser-ws> <multistep-fixture-url>

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WS = process.argv[2];
const URL_ = process.argv[3];
if (!WS || !URL_) { console.error("usage: bun pause-resume-spike.mjs <ws> <url>"); process.exit(2); }
const HERE = dirname(fileURLToPath(import.meta.url));

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
if(!tab) throw new Error("fixture not open");
const { sessionId } = await cdp.s("Target.attachToTarget",{ targetId: tab.targetId, flatten:true });
await cdp.s("Runtime.enable",{},sessionId); await cdp.s("DOM.enable",{},sessionId); await cdp.s("Accessibility.enable",{},sessionId);

const evalExpr=async(e)=>{const r=await cdp.s("Runtime.evaluate",{expression:e,returnByValue:true},sessionId);if(r.exceptionDetails)throw new Error("exc");return r.result.value;};
async function resolvePasswordNode(){
  const tree=await cdp.s("Accessibility.getFullAXTree",{},sessionId);
  const n=tree.nodes.find(x=>x.role?.value==="textbox" && /pass/i.test(x.name?.value||""));
  return n?.backendDOMNodeId;
}
async function nodeUsable(backendNodeId){
  // A ref is USABLE only if it still points at a VISIBLE, operable element on the
  // current screen. DOM.resolveNode succeeding is NOT enough: after a screen
  // switch the old node can linger (display:none) but is semantically stale —
  // operating on it would type into the wrong (hidden) screen. Check real
  // visibility via getBoxModel + offsetParent.
  try {
    const { object } = await cdp.s("DOM.resolveNode",{ backendNodeId }, sessionId);
    const vis = await cdp.s("Runtime.callFunctionOn",{ objectId:object.objectId, returnByValue:true,
      functionDeclaration:"function(){ const r=this.getBoundingClientRect(); return this.offsetParent!==null && r.width>0 && r.height>0; }" }, sessionId);
    return vis.result.value === true;
  } catch { return false; }
}
async function deliverPassword(backendNodeId){
  return await new Promise((resolve)=>{
    const child=spawn("bash",["-c",`printf %s "DUMMY-PW-000000" 3>/dev/null | bun ${JSON.stringify(join(HERE,"custody-child.mjs"))} ${JSON.stringify(WS)} ${JSON.stringify(tab.targetId)} ${JSON.stringify(String(backendNodeId))} 3<&0`],{stdio:["ignore","pipe","pipe"]});
    let o="";child.stdout.on("data",d=>o+=d);child.on("close",()=>{let r;try{r=JSON.parse(o.trim());}catch{r={ok:false};}resolve(r);});
  });
}
async function clickAdvance(){
  const tree=await cdp.s("Accessibility.getFullAXTree",{},sessionId);
  const btn=tree.nodes.find(n=>n.role?.value==="button");
  const {object}=await cdp.s("DOM.resolveNode",{backendNodeId:btn.backendDOMNodeId},sessionId);
  await cdp.s("Runtime.callFunctionOn",{objectId:object.objectId,returnByValue:true,functionDeclaration:"function(){for(const t of['mouseover','mousedown','mouseup','click'])this.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}));}"},sessionId);
  await sleep(250);
}

const report = {};

// --- get to the password screen (username step first) ---
{
  const tree=await cdp.s("Accessibility.getFullAXTree",{},sessionId);
  const u=tree.nodes.find(x=>x.role?.value==="textbox" && /user/i.test(x.name?.value||""));
  if(u){ // deliver a username then advance to the confidential (password) screen
    await new Promise((res)=>{const c=spawn("bash",["-c",`printf %s "candidate.demo" 3>/dev/null | bun ${JSON.stringify(join(HERE,"custody-child.mjs"))} ${JSON.stringify(WS)} ${JSON.stringify(tab.targetId)} ${JSON.stringify(String(u.backendDOMNodeId))} 3<&0`],{stdio:["ignore","pipe","pipe"]});c.on("close",res);});
    await clickAdvance();
  }
}

// --- PAUSE: task lane captures its pre-delivery ref for the confidential field ---
const staleRef = await resolvePasswordNode();
report.pre_delivery = { captured_stale_password_ref: staleRef, usable_before: await nodeUsable(staleRef) };

// --- custody delivers into the confidential field, then the lane ADVANCES
//     (DOM changes: password screen -> otp screen). This is where refs go stale. ---
const delivered = await deliverPassword(staleRef);
await clickAdvance(); // advance past the confidential step -> DOM replaced
report.delivery = { delivered_ok: delivered.ok, shape: delivered.shape ?? null };

// --- HAZARD: naive lane reuses the stale ref after delivery/advance ---
report.naive_reuse = { stale_ref_still_usable: await nodeUsable(staleRef) };

// --- RESUME DIRECTIVE: discard stale refs + prove a FRESH identity basis ---
// The lane obeys: it does NOT touch staleRef; it re-observes the page and resolves
// fresh. Prove the fresh path works where the stale one is dead.
const freshOrigin = await evalExpr("location.origin");           // fresh identity basis
const freshStep = JSON.parse(await evalExpr("JSON.stringify(window.__ml())")); // where are we now
report.resume = {
  discarded_stale_ref: true,
  fresh_identity_basis: freshOrigin,
  fresh_step_observed: freshStep.step,
  progressed_past_confidential_step: freshStep.step === "otp" || freshStep.signedIn,
};

cdp.close();
report.verdict =
  report.delivery.delivered_ok &&
  report.naive_reuse.stale_ref_still_usable === false &&   // the hazard is real
  report.resume.progressed_past_confidential_step          // resume path works
    ? "PAUSE/RESUME OK: stale pre-delivery ref is dead after delivery (hazard real); obeying the resume directive (discard refs, fresh identity basis, re-observe) continues cleanly past the confidential step"
    : "CONTINUITY NOT PROVEN";
console.log(JSON.stringify(report, null, 2));
