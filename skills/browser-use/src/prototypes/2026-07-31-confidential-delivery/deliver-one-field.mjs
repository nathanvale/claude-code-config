// PROTOTYPE — throwaway. Deliver ONE vault field into ONE resolved node on the
// current real portal tab, via the custody child (op read -> fd3 -> field).
// Handles unlabelled fields: resolve strategy is passed in.
//   argv: <portal-origin> <op-field> <resolve-strategy> <browser-ws>
//   resolve-strategy: "name:<accessible name>"  or  "only-textbox" (the single
//     login textbox on the page) or "password-type" (input[type=password]).
// Agent never binds the secret. Prints shape only.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const [ORIGIN, OP_FIELD, STRATEGY, BROWSER_WS] = process.argv.slice(2);
const HERE = dirname(fileURLToPath(import.meta.url));
const VAULT = "Browser Automation";
const ITEM = { "https://manpowergroup.fasttrack360.com.au": "6he7gmnrc54ssdm7fzzvk4rmne" }[ORIGIN];
if (!ITEM || !OP_FIELD || !STRATEGY || !BROWSER_WS) { console.error("bad args"); process.exit(2); }

class Cdp {
  constructor(ws){ this.ws=ws; this.id=0; this.p=new Map();
    ws.addEventListener("message",(ev)=>{ const m=JSON.parse(ev.data);
      if(m.id!==undefined&&this.p.has(m.id)){ const {r,j}=this.p.get(m.id); this.p.delete(m.id);
        m.error?j(new Error(JSON.stringify(m.error))):r(m.result); } }); }
  static c(u){ return new Promise((res,rej)=>{ const ws=new WebSocket(u);
    ws.addEventListener("open",()=>res(new Cdp(ws))); ws.addEventListener("error",rej); }); }
  s(method,params={},sid){ const id=++this.id; const o={id,method,params}; if(sid)o.sessionId=sid;
    return new Promise((res,rej)=>{ this.p.set(id,{r:res,j:rej}); this.ws.send(JSON.stringify(o));
      setTimeout(()=>{ if(this.p.has(id)){ this.p.delete(id); rej(new Error("timeout "+method)); } },10000); }); }
  close(){ this.ws.close(); }
}

const cdp = await Cdp.c(BROWSER_WS);
const { targetInfos } = await cdp.s("Target.getTargets");
const tab = targetInfos.filter(t=>t.type==="page").find(t=>{ try { return new URL(t.url).origin===ORIGIN; } catch { return false; } });
if (!tab) { console.log(JSON.stringify({ ok:false, reason:"origin-guard", detail:`no tab on ${ORIGIN}` })); process.exit(1); }
const { sessionId } = await cdp.s("Target.attachToTarget",{ targetId: tab.targetId, flatten:true });
await cdp.s("DOM.enable",{},sessionId); await cdp.s("Runtime.enable",{},sessionId); await cdp.s("Accessibility.enable",{},sessionId);

// Resolve the target backendNodeId per strategy.
let backendNodeId;
if (STRATEGY.startsWith("name:")) {
  const name = STRATEGY.slice(5);
  const tree = await cdp.s("Accessibility.getFullAXTree",{},sessionId);
  backendNodeId = tree.nodes.find(n=>n.role?.value==="textbox" && n.name?.value===name)?.backendDOMNodeId;
} else if (STRATEGY === "only-textbox") {
  // The single visible login textbox: use DOM query for a lone text/email input.
  const { root } = await cdp.s("DOM.getDocument",{ depth:-1 }, sessionId);
  const q = await cdp.s("DOM.querySelectorAll",{ nodeId: root.nodeId, selector: "input[type=text], input[type=email], input:not([type])" }, sessionId);
  // filter to visible; take the one nearest a Next/Continue button (heuristic: first).
  backendNodeId = q.nodeIds.length ? (await cdp.s("DOM.describeNode",{ nodeId:q.nodeIds[0] }, sessionId)).node.backendNodeId : undefined;
} else if (STRATEGY === "password-type") {
  const { root } = await cdp.s("DOM.getDocument",{ depth:-1 }, sessionId);
  const q = await cdp.s("DOM.querySelectorAll",{ nodeId: root.nodeId, selector: "input[type=password]" }, sessionId);
  backendNodeId = q.nodeIds.length ? (await cdp.s("DOM.describeNode",{ nodeId:q.nodeIds[0] }, sessionId)).node.backendNodeId : undefined;
}
cdp.close();
if (!backendNodeId) { console.log(JSON.stringify({ ok:false, reason:"field-not-found", strategy:STRATEGY })); process.exit(1); }

// Deliver via custody child.
const opRef = `op://${VAULT}/${ITEM}/${OP_FIELD}`;
const res = await new Promise((resolve)=>{
  const child = spawn("bash", ["-c",
    `op read ${JSON.stringify(opRef)} --no-newline 3>/dev/null | ` +
    `bun ${JSON.stringify(join(HERE,"custody-child.mjs"))} ${JSON.stringify(BROWSER_WS)} ${JSON.stringify(tab.targetId)} ${JSON.stringify(String(backendNodeId))} 3<&0`
  ], { stdio:["ignore","pipe","pipe"] });
  let out="",err=""; child.stdout.on("data",d=>out+=d); child.stderr.on("data",d=>err+=d);
  child.on("close",(code)=>{ let r; try{r=JSON.parse(out.trim());}catch{r={ok:false,raw:out.trim()};} resolve({ code, r, err:err.trim() }); });
});
console.log(JSON.stringify({ ok:res.r.ok===true, field:OP_FIELD, strategy:STRATEGY, shape:res.r.shape??null, agent_saw_bytes:false, next:`click the button, then deliver the next field` }, null, 2));
