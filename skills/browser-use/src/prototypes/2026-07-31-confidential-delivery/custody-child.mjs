// PROTOTYPE — throwaway. The DISPOSABLE DELIVERY CHILD. This is the ONLY process
// that ever touches the secret bytes. It reads exactly one value from a private
// pipe (fd 3), performs one bounded field write via the CDP session, reports back
// only an OUTCOME + non-secret SHAPE (kind + byte length), and exits. It NEVER
// writes the value to stdout/stderr/argv/anywhere the parent can read.
//
// Invoked by custody-seam-spike.mjs with:
//   argv: <browser-ws> <target-id> <backend-node-id>   (all NON-secret)
//   fd 3: the private pipe carrying the single secret value (bytes)
//   env:  nothing secret
//
// Output contract (stdout, one JSON line): { ok, shape:{ field_len } } or
// { ok:false, reason }. Bytes never appear here.

import { readFileSync } from "node:fs";

const [wsUrl, targetId, backendNodeId] = process.argv.slice(2);

// Read the single secret value from the private pipe (fd 3). In the real system
// this is the op child's output over a private pipe; here the parent writes a
// DUMMY sentinel value so we can later prove it never leaked back.
let secret;
try {
  secret = readFileSync(3, "utf8"); // fd 3 = the private pipe read end
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, reason: "pipe-read-failed" }) + "\n");
  process.exit(1);
}

// Minimal CDP client (child owns its own attach — it does NOT share the agent's).
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

try {
  const cdp = await Cdp.c(wsUrl);
  const { sessionId } = await cdp.s("Target.attachToTarget",{ targetId, flatten:true });
  await cdp.s("DOM.enable",{},sessionId);
  await cdp.s("Runtime.enable",{},sessionId);
  // focus the PROVEN node the agent picked, clear, insert the secret.
  const bn = Number(backendNodeId);
  const { object } = await cdp.s("DOM.resolveNode",{ backendNodeId: bn }, sessionId);
  await cdp.s("DOM.focus",{ backendNodeId: bn }, sessionId);
  await cdp.s("Runtime.callFunctionOn",{ objectId:object.objectId, returnByValue:true,
    functionDeclaration:"function(){ try{this.select();}catch(_){} }" }, sessionId);
  await cdp.s("Input.insertText",{ text: secret }, sessionId); // the ONE place bytes touch the page
  cdp.close();
  // Report SHAPE ONLY — never the value. field_len is a bounded non-secret number.
  process.stdout.write(JSON.stringify({ ok:true, shape:{ field_len: Buffer.byteLength(secret,"utf8") } }) + "\n");
  process.exit(0);
} catch (e) {
  // Even the error must not echo the secret. Report a generic reason.
  process.stdout.write(JSON.stringify({ ok:false, reason:"write-failed" }) + "\n");
  process.exit(1);
}
