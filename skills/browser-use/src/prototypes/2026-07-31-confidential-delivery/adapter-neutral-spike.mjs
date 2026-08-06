// PROTOTYPE — throwaway. Proves the custody delivery seam is LANE-NEUTRAL
// (plan R5/KTD3: one confidential-delivery seam, many lanes). For each adapter
// (agent-browser, playwright-cdp, chrome-devtools-mcp) it takes the endpoint that
// `browser-connect connect <adapter> --json` verified, runs the SAME custody child
// against a scratch Password field, and asserts identical secret-unseen delivery.
//
// The point: the delivery child attaches to the browser endpoint inside the
// verified handoff envelope; that endpoint is the same Warm Chrome regardless of
// which adapter the task lane uses. Delivery does not depend on the lane.
//
// A DUMMY sentinel is delivered (secret-free). Run: bun adapter-neutral-spike.mjs <fixture-url>

import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FIXTURE_URL = process.argv[2];
if (!FIXTURE_URL) { console.error("usage: bun adapter-neutral-spike.mjs <fixture-url>"); process.exit(2); }
const HERE = dirname(fileURLToPath(import.meta.url));
const SENTINEL = "ADAPTER-NEUTRAL-SENTINEL-7Q7Q7Q"; // dummy, not a secret
const ADAPTERS = ["agent-browser", "playwright-cdp", "chrome-devtools-mcp"];

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

// Get the verified endpoint the way the real product does: through browser-connect.
function verifyEndpoint(adapter) {
  const r = spawnSync("browser-connect", ["connect", adapter, "--json"], { encoding:"utf8" });
  try { const d = JSON.parse(r.stdout); return { ws: d.data?.endpoint?.ws, adapter: d.data?.attachment?.adapter_id, outcome: d.data?.outcome }; }
  catch { return { ws:null }; }
}

async function resolvePasswordNode(ws, fixtureHref) {
  const cdp = await Cdp.c(ws);
  const { targetInfos } = await cdp.s("Target.getTargets");
  const tab = targetInfos.filter(t=>t.type==="page").find(t=>norm(t.url)===norm(fixtureHref));
  if (!tab) { cdp.close(); return { error:"fixture not open" }; }
  const { sessionId } = await cdp.s("Target.attachToTarget",{ targetId: tab.targetId, flatten:true });
  await cdp.s("Accessibility.enable",{},sessionId);
  const tree = await cdp.s("Accessibility.getFullAXTree",{},sessionId);
  const node = tree.nodes.find(n=>n.role?.value==="textbox" && n.name?.value==="Password");
  cdp.close();
  return { targetId: tab.targetId, backendNodeId: node?.backendDOMNodeId };
}

async function deliverAndSweep(ws, targetId, backendNodeId) {
  const out = await new Promise((resolve)=>{
    const child = spawn("bash",["-c",
      `printf %s ${JSON.stringify(SENTINEL)} 3>/dev/null | ` +
      `bun ${JSON.stringify(join(HERE,"custody-child.mjs"))} ${JSON.stringify(ws)} ${JSON.stringify(targetId)} ${JSON.stringify(String(backendNodeId))} 3<&0`
    ], { stdio:["ignore","pipe","pipe"] });
    let o="",e=""; child.stdout.on("data",d=>o+=d); child.stderr.on("data",d=>e+=d);
    child.on("close",()=>{ let r; try{r=JSON.parse(o.trim());}catch{r={ok:false,raw:o.trim()};} resolve({ r, out:o.trim(), err:e.trim() }); });
  });
  // read back field length (not value), then clear it.
  const cdp = await Cdp.c(ws);
  const { sessionId } = await cdp.s("Target.attachToTarget",{ targetId, flatten:true });
  await cdp.s("Runtime.enable",{},sessionId);
  const len = (await cdp.s("Runtime.evaluate",{ expression:"(document.querySelector('#password')?.value||'').length", returnByValue:true }, sessionId)).result.value;
  await cdp.s("Runtime.evaluate",{ expression:"(()=>{const e=document.querySelector('#password'); if(e)e.value='';})()", returnByValue:true }, sessionId);
  cdp.close();
  const leaked = [out.out, out.err].some(s=>s.includes(SENTINEL));
  return { child_reported: out.r, landed_len: len, shape_matches: out.r?.shape?.field_len===len, sentinel_leaked_to_agent: leaked };
}

const results = {};
let firstWs = null;
for (const adapter of ADAPTERS) {
  const ep = verifyEndpoint(adapter);
  if (!ep.ws) { results[adapter] = { error:"no endpoint" }; continue; }
  if (firstWs === null) firstWs = ep.ws;
  const node = await resolvePasswordNode(ep.ws, FIXTURE_URL);
  if (node.error || !node.backendNodeId) { results[adapter] = { verified_ws: ep.ws, error: node.error||"no password field" }; continue; }
  const d = await deliverAndSweep(ep.ws, node.targetId, node.backendNodeId);
  results[adapter] = {
    verified_ws: ep.ws,
    same_endpoint_as_first: ep.ws === firstWs,
    delivered_ok: d.child_reported?.ok===true,
    field_len: d.child_reported?.shape?.field_len ?? null,
    landed_and_shape_matches: d.shape_matches && d.landed_len>0,
    sentinel_leaked_to_agent: d.sentinel_leaked_to_agent,
  };
}

const allSameEndpoint = Object.values(results).every(r=>r.same_endpoint_as_first !== false);
const allDelivered = Object.values(results).every(r=>r.delivered_ok && r.landed_and_shape_matches && r.sentinel_leaked_to_agent===false);
console.log(JSON.stringify({
  per_adapter: results,
  all_adapters_same_warm_chrome_endpoint: allSameEndpoint,
  all_adapters_delivered_secret_unseen: allDelivered,
  verdict: allSameEndpoint && allDelivered
    ? "LANE-NEUTRAL: every adapter verifies to the same Warm Chrome; the custody child delivers identically, secret unseen, regardless of lane"
    : "NOT LANE-NEUTRAL — see per_adapter",
}, null, 2));
