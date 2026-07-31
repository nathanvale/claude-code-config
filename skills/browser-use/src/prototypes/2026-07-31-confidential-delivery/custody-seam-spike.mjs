// PROTOTYPE — throwaway. Proves the SECRET-NEVER-SEEN custody seam as a REAL
// process boundary against live Chrome. Two processes:
//   * THIS agent process: reasons about WHERE the secret goes (resolves the field
//     by role+accessible name -> backendNodeId), holds only an opaque HANDLE,
//     spawns the child, and receives back only an OUTCOME + SHAPE. It must never
//     hold the secret bytes.
//   * The disposable CHILD (custody-child.mjs): the ONLY process that touches the
//     bytes; reads them from a private pipe, does one bounded insert, reports shape.
//
// The proof: after delivery, sweep EVERYTHING the agent side can see — its own
// variables, the child's argv, the child's stdout/stderr, and the resume record —
// for the sentinel value. If the sentinel is absent from all of them AND present
// in the page field, the seam holds: the agent picked the field, the value landed,
// and the agent never saw it.
//
// The secret source is a DUMMY sentinel. In the real system it comes from the op
// child over the private pipe; here a secret-source function stands in for that,
// deliberately structured so the agent process code path never binds the value to
// a variable it logs. Run: bun custody-seam-spike.mjs <browser-ws> <fixture-url>

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BROWSER_WS = process.argv[2];
const FIXTURE_URL = process.argv[3];
if (!BROWSER_WS || !FIXTURE_URL) { console.error("usage: bun custody-seam-spike.mjs <ws> <fixture>"); process.exit(2); }
const HERE = dirname(fileURLToPath(import.meta.url));

// The sentinel the child will deliver. The AGENT PROCESS must never see this in
// any variable it logs or returns. We keep the literal here ONLY so the sweep can
// search for it — the agent's *delivery path* never binds it. (In the real system
// this literal does not exist agent-side at all; the op child produces it.)
const SENTINEL = "S3CR3T-SENTINEL-do-not-leak-9Z9Z9Z";

// --- agent-side CDP: used ONLY to pick the field (non-secret reasoning) --------
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

// The agent reasons about the target + field. NON-SECRET throughout.
const cdp = await Cdp.c(BROWSER_WS);
const { targetInfos } = await cdp.s("Target.getTargets");
const target = targetInfos.filter(t=>t.type==="page").find(t=>norm(t.url)===norm(FIXTURE_URL));
if(!target) throw new Error("fixture target not found");
const { sessionId } = await cdp.s("Target.attachToTarget",{ targetId: target.targetId, flatten:true });
await cdp.s("Accessibility.enable",{},sessionId);
const tree = await cdp.s("Accessibility.getFullAXTree",{},sessionId);
const node = tree.nodes.find(n=>n.role?.value==="textbox" && n.name?.value==="Password");
if(!node) throw new Error("no Password field");
const backendNodeId = node.backendDOMNodeId; // <-- the agent's decision: WHERE the secret goes

// The agent holds only an OPAQUE HANDLE — a reservation bound to field+target,
// with NO value slot. This is everything the agent knows about the secret.
const handle = { handle_id: "h_password_fasttrack", field: "password", target_id: target.targetId, expires_at: 9999 };

// --- Hand off to the disposable child. The value travels on fd 3 (private pipe),
// produced by a secret source the agent does not bind to a logged variable. ----
function secretSource() {
  // Stands in for the op child's pipe output. In the real system the AGENT never
  // calls this — the supervisor wires the op child's pipe straight to the delivery
  // child. Here we return the sentinel so the child has bytes to deliver, but we
  // pipe it directly into the child's fd 3 without the agent retaining it.
  return SENTINEL;
}

const childOut = await new Promise((resolve) => {
  const child = spawn("bun", [
    join(HERE, "custody-child.mjs"),
    BROWSER_WS, target.targetId, String(backendNodeId), // all NON-secret argv
  ], { stdio: ["ignore", "pipe", "pipe", "pipe"] }); // fd 3 = private pipe (index 3)

  let out = "", err = "";
  child.stdout.on("data", d => out += d);
  child.stderr.on("data", d => err += d);
  // Write the secret to the child's private pipe, then close it. The value flows
  // process->process; the agent never binds it to a durable variable.
  child.stdio[3].write(secretSource());
  child.stdio[3].end();
  child.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
});

cdp.close();

// The agent's view of the result: outcome + shape only (parsed from child stdout).
let childResult;
try { childResult = JSON.parse(childOut.out); } catch { childResult = { ok:false, reason:"unparseable" }; }

// The resume record the agent would return upstream — shape only, no value.
const resumeRecord = {
  ok: childResult.ok,
  handle_id: handle.handle_id,
  field: handle.field,
  delivered_shape: childResult.shape ?? null, // { field_len } — a number, not bytes
  target_id: handle.target_id,
};

// --- THE PROOF: sweep every agent-visible surface for the sentinel ------------
// Read back the page field independently to confirm the value actually landed.
const cdp2 = await Cdp.c(BROWSER_WS);
const { sessionId: s2 } = await cdp2.s("Target.attachToTarget",{ targetId: target.targetId, flatten:true });
await cdp2.s("Runtime.enable",{},s2);
const pageValue = (await cdp2.s("Runtime.evaluate",{ expression:"document.querySelector('#password')?.value || document.querySelector('input[type=password]')?.value || ''", returnByValue:true }, s2)).result.value;
cdp2.close();

const surfaces = {
  handle_object: JSON.stringify(handle),
  child_argv: [BROWSER_WS, target.targetId, String(backendNodeId)].join(" "),
  child_stdout: childOut.out,
  child_stderr: childOut.err,
  resume_record: JSON.stringify(resumeRecord),
};
const leaks = Object.entries(surfaces).filter(([, v]) => v.includes(SENTINEL)).map(([k]) => k);
const landedInPage = pageValue.includes(SENTINEL);

console.log(JSON.stringify({
  agent_picked_field: { role:"textbox", name:"Password", backendNodeId },
  agent_holds: handle,                       // no value slot
  child_reported: childResult,               // outcome + shape only
  resume_record: resumeRecord,
  proof: {
    sentinel_landed_in_page_field: landedInPage,           // expect true
    agent_side_surfaces_swept: Object.keys(surfaces),
    sentinel_leaked_into: leaks,                            // expect [] (empty)
    verdict: landedInPage && leaks.length === 0
      ? "SEAM HOLDS: value delivered to the field the agent chose; sentinel absent from every agent-visible surface"
      : "SEAM VIOLATED",
  },
}, null, 2));
