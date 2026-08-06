// PROTOTYPE — throwaway FastTrack end-to-end spike. Drives the REAL delivery
// process (browser-connect endpoint -> second CDP client -> flat-session ->
// Accessibility field bridge -> Input.insertText) against the faithful FastTrack
// LOOK-ALIKE fixture. Login (username/password/otp) -> timesheet grid -> fill
// Mon-Fri rxg cells -> STOP before submit. Secret-free: DUMMY creds only; the
// real portal and real credentials are intentionally NOT used. Wipe with scratchpad.
//
// Run: bun fasttrack-e2e-spike.mjs <browser-ws-url> <fixture-url>

const BROWSER_WS = process.argv[2];
const FIXTURE_URL = process.argv[3];
if (!BROWSER_WS || !FIXTURE_URL) { console.error("usage: bun fasttrack-e2e-spike.mjs <ws> <fixture>"); process.exit(2); }

// Dummy, sentinel-free stand-in credentials. NOT real. The real system would
// have these bytes appear ONLY inside the disposable op+delivery children.
const CREDS = { username: "candidate.demo", password: "DUMMY-PW-do-not-use-000", otp: "654321" };
const WEEK = { rows: [
  { day:"Mon", date:"03/08/2026", start:"09:00", end:"17:00", attendance:"Standard" },
  { day:"Tue", date:"04/08/2026", start:"09:00", end:"17:00", attendance:"Standard" },
  { day:"Wed", date:"05/08/2026", start:"09:00", end:"17:00", attendance:"Standard" },
  { day:"Thu", date:"06/08/2026", start:"09:00", end:"17:00", attendance:"Standard" },
  { day:"Fri", date:"05/08/2026".replace("05","07"), start:"09:00", end:"15:00", attendance:"Overtime" },
] };

class Cdp {
  constructor(ws){ this.ws=ws; this.id=0; this.pending=new Map();
    ws.addEventListener("message",(ev)=>{ const m=JSON.parse(ev.data);
      if(m.id!==undefined&&this.pending.has(m.id)){ const {resolve,reject}=this.pending.get(m.id); this.pending.delete(m.id);
        m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result); } }); }
  static connect(u){ return new Promise((res,rej)=>{ const ws=new WebSocket(u);
    ws.addEventListener("open",()=>res(new Cdp(ws))); ws.addEventListener("error",(e)=>rej(new Error("ws "+(e.message||e)))); }); }
  send(method,params={},sessionId){ const id=++this.id; const p={id,method,params}; if(sessionId)p.sessionId=sessionId;
    return new Promise((res,rej)=>{ this.pending.set(id,{resolve:res,reject:rej}); this.ws.send(JSON.stringify(p));
      setTimeout(()=>{ if(this.pending.has(id)){ this.pending.delete(id); rej(new Error("timeout "+method)); } },8000); }); }
  close(){ this.ws.close(); }
}
const norm=(u)=>{ try{return new URL(u).href;}catch{return u;} };
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

const cdp = await Cdp.connect(BROWSER_WS);

// Attach flat-session to the fixture page (proven Q1/Q3 sequence).
const { targetInfos } = await cdp.send("Target.getTargets");
const pages = targetInfos.filter(t=>t.type==="page");
const matches = pages.filter(t=>norm(t.url)===norm(FIXTURE_URL));
if(matches.length!==1) throw new Error(`target single-match failed: ${matches.length}`);
const targetId = matches[0].targetId;
const { sessionId } = await cdp.send("Target.attachToTarget",{ targetId, flatten:true });
await cdp.send("Runtime.enable",{},sessionId);
await cdp.send("DOM.enable",{},sessionId);
await cdp.send("Accessibility.enable",{},sessionId);

const evalExpr = async (expr)=>{ const r=await cdp.send("Runtime.evaluate",{expression:expr,returnByValue:true},sessionId);
  if(r.exceptionDetails) throw new Error("eval exc: "+JSON.stringify(r.exceptionDetails)); return r.result.value; };
const ftState = async ()=> JSON.parse(await evalExpr("JSON.stringify(window.__ft())"));

// Field bridge: role+accessible name -> backendNodeId (proven Q4).
async function resolveByName(role, name){
  const tree = await cdp.send("Accessibility.getFullAXTree",{},sessionId);
  const n = tree.nodes.find(x=>x.role?.value===role && x.name?.value===name);
  if(!n) throw new Error(`no AX node role=${role} name=${JSON.stringify(name)}`);
  return n.backendDOMNodeId;
}
// The REAL bounded delivery action: focus proven node, CLEAR by selecting the
// full existing range on the exact node (reliable, unlike a keyboard select-all
// which the diagnostic proved is a no-op here), then Input.insertText replaces
// the selection. Clear-then-insert is the fix the earlier spike forced; the
// selection is set on the SAME proven backendNodeId, no separate DOM query.
async function deliverField(role, name, value){
  const backendNodeId = await resolveByName(role, name);
  const { object } = await cdp.send("DOM.resolveNode",{backendNodeId},sessionId);
  await cdp.send("DOM.focus",{backendNodeId},sessionId);
  // Select the whole current value on the proven node so insertText replaces it.
  await cdp.send("Runtime.callFunctionOn",{objectId:object.objectId,returnByValue:true,
    functionDeclaration:"function(){ try{ this.select(); }catch(_){ this.setSelectionRange&&this.setSelectionRange(0,this.value.length); } }"},sessionId);
  await cdp.send("Input.insertText",{text:value},sessionId); // replaces selection => no concatenation
  return { field:name, byte_length:Buffer.byteLength(value,"utf8") };
}
// select dropdowns aren't text inputs: set via a real change event on the node.
async function selectAttendance(name, value){
  const backendNodeId = await resolveByName("combobox", name).catch(()=>resolveByName("listbox",name));
  const { object } = await cdp.send("DOM.resolveNode",{backendNodeId},sessionId);
  await cdp.send("Runtime.callFunctionOn",{ objectId:object.objectId, returnByValue:true,
    functionDeclaration:`function(v){ const i=[...this.options].findIndex(o=>o.text===v); if(i<0) throw new Error('no option '+v); this.selectedIndex=i; this.dispatchEvent(new Event('change',{bubbles:true})); return this.value; }`,
    arguments:[{value}] }, sessionId);
  return { field:name, selected:value };
}

const receipt = { phases:{} };

// ---------------- PHASE 1: LOGIN (real delivery choreography) ----------------
{
  const before = await ftState();
  // control experiment: prove raw .value write does NOT commit the model.
  const un = await resolveByName("textbox","Username");
  const { object } = await cdp.send("DOM.resolveNode",{backendNodeId:un},sessionId);
  await cdp.send("Runtime.callFunctionOn",{objectId:object.objectId,returnByValue:true,
    functionDeclaration:"function(){ this.value='RAW-NO-EVENTS'; }"},sessionId);
  const afterRaw = await ftState();
  const rawLeaked = afterRaw.model.login.username === "RAW-NO-EVENTS";
  // reset then deliver properly via insertText
  await cdp.send("Runtime.callFunctionOn",{objectId:object.objectId,returnByValue:true,functionDeclaration:"function(){this.value='';}"},sessionId);

  const shapes = [];
  shapes.push(await deliverField("textbox","Username", CREDS.username));
  shapes.push(await deliverField("textbox","Password", CREDS.password));
  shapes.push(await deliverField("textbox","One-time code", CREDS.otp));
  const afterDeliver = await ftState();

  // click Sign In with a REAL trusted mouse click via Input.dispatchMouseEvent on
  // the node's box center. Finding: bare element.click() through callFunctionOn
  // did NOT fire the inline onclick here; the real fill-week.js dispatches a full
  // mouse sequence for the same reason. A trusted CDP mouse press is the fix.
  const signInNode = await resolveByName("button","Sign In");
  const { model: box } = await cdp.send("DOM.getBoxModel",{ backendNodeId: signInNode }, sessionId);
  const [x1,y1,,,x3,y3] = box.content; // quad: top-left .. bottom-right
  const cx = (x1 + x3)/2, cy = (y1 + y3)/2;
  await cdp.send("Input.dispatchMouseEvent",{ type:"mousePressed", x:cx, y:cy, button:"left", buttons:1, clickCount:1 }, sessionId);
  await cdp.send("Input.dispatchMouseEvent",{ type:"mouseReleased", x:cx, y:cy, button:"left", buttons:0, clickCount:1 }, sessionId);
  await sleep(400);
  const afterSignIn = await ftState();

  receipt.phases.login = {
    raw_value_write_committed_model: rawLeaked, // expect false — proves events required
    delivered_field_shapes: shapes,             // non-secret: name + byte length only
    model_after_delivery: afterDeliver.model.login,
    signed_in: afterSignIn.signedIn,
    landed_href: afterSignIn.href,
    on_timesheet_hash: afterSignIn.href.includes("VGltZUFuZEF0dGVuZGFuY2U00"),
  };
}

// ---------------- PHASE 2: TIMESHEET FILL (real grid, real ng-model) --------
{
  // reprove we're on the timesheet before touching any cell (R14).
  const st = await ftState();
  if(!st.signedIn){ console.log(JSON.stringify(receipt,null,2)); console.log("DIAG login model:", JSON.stringify(st.model.login)); throw new Error("not signed in; cannot fill"); }
  const filled = [];
  for(const row of WEEK.rows){
    filled.push(await deliverField("textbox", `Start ${row.date}`, row.start));
    filled.push(await deliverField("textbox", `End ${row.date}`, row.end));
    filled.push(await selectAttendance(`Attendance ${row.date}`, row.attendance));
  }
  const after = await ftState();
  receipt.phases.timesheet_fill = {
    rows_requested: WEEK.rows.length,
    fields_delivered: filled.length,
    committed_cells: after.model.cells,          // the ng-model registry — proves commit
    all_cells_present: WEEK.rows.every(r => after.model.cells[r.date]?.start===r.start && after.model.cells[r.date]?.end===r.end),
  };
}

// ---------------- PHASE 3: STOP BEFORE SUBMIT (hard boundary) ----------------
{
  const before = await ftState();
  // We deliberately do NOT click submit. Prove the boundary: submitAttempts stays 0.
  receipt.phases.pre_submit_boundary = {
    submit_attempts: before.submitAttempts, // expect 0 — agent never clicked submit
    stopped_before_submit: before.submitAttempts === 0,
    final_state: { signed_in: before.signedIn, cells_filled: Object.keys(before.model.cells).length },
  };
}

console.log(JSON.stringify(receipt, null, 2));
cdp.close();
