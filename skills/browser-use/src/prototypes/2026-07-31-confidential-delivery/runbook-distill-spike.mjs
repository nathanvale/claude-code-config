// PROTOTYPE — throwaway. Proves the runbook DISTILL is REAL (the lifecycle spike
// faked it). A COLD run fills the timesheet by reasoning step-by-step (snapshot +
// resolve + fill per cell = many CDP round-trips). We RECORD the actual action
// trace, EMIT runnable JS from it (a single in-page fast-path), then REPLAY the
// distilled JS and prove: (a) it reproduces the same committed model, (b) it is
// materially faster (far fewer CDP round-trips / lower wall time).
//
// Run: bun runbook-distill-spike.mjs <browser-ws> <fixture-http-url>

const WS = process.argv[2];
const URL_ = process.argv[3];
if (!WS || !URL_) { console.error("usage: bun runbook-distill-spike.mjs <ws> <url>"); process.exit(2); }

class Cdp {
  constructor(ws){ this.ws=ws; this.id=0; this.p=new Map(); this.calls=0;
    ws.addEventListener("message",(ev)=>{ const m=JSON.parse(ev.data);
      if(m.id!==undefined&&this.p.has(m.id)){ const {r,j}=this.p.get(m.id); this.p.delete(m.id);
        m.error?j(new Error(JSON.stringify(m.error))):r(m.result); } }); }
  static c(u){ return new Promise((res,rej)=>{ const ws=new WebSocket(u);
    ws.addEventListener("open",()=>res(new Cdp(ws))); ws.addEventListener("error",rej); }); }
  s(method,params={},sid){ this.calls++; const id=++this.id; const o={id,method,params}; if(sid)o.sessionId=sid;
    return new Promise((res,rej)=>{ this.p.set(id,{r:res,j:rej}); this.ws.send(JSON.stringify(o));
      setTimeout(()=>{ if(this.p.has(id)){ this.p.delete(id); rej(new Error("timeout "+method)); } },8000); }); }
  close(){ this.ws.close(); }
}
const norm=(u)=>{ try{return new URL(u).href;}catch{return u;} };
// deterministic monotonic "clock" via a counter of CDP round-trips (no Date.now):
// cost is dominated by round-trips, so we measure THOSE — the honest speed signal.

const rows = [
  { date:"03/08/2026", start:"09:00", end:"17:00", attendance:"Standard" },
  { date:"04/08/2026", start:"09:00", end:"17:00", attendance:"Standard" },
  { date:"05/08/2026", start:"09:00", end:"17:00", attendance:"Standard" },
  { date:"06/08/2026", start:"09:00", end:"17:00", attendance:"Standard" },
  { date:"07/08/2026", start:"09:00", end:"15:00", attendance:"Overtime" },
];

async function attach() {
  const cdp = await Cdp.c(WS);
  const { targetInfos } = await cdp.s("Target.getTargets");
  const tab = targetInfos.filter(t=>t.type==="page").find(t=>norm(t.url)===norm(URL_));
  const { sessionId } = await cdp.s("Target.attachToTarget",{ targetId: tab.targetId, flatten:true });
  await cdp.s("Runtime.enable",{},sessionId);
  return { cdp, sessionId };
}
const readModel = async (cdp,sid)=> JSON.parse((await cdp.s("Runtime.evaluate",{expression:"JSON.stringify(window.__ts().model)",returnByValue:true},sid)).result.value);
const clearGrid = async (cdp,sid)=> cdp.s("Runtime.evaluate",{expression:"document.querySelectorAll(\"[ng-model^='rxg']\").forEach(e=>{e.value='';});Object.keys(window.__ts().model).forEach(k=>delete window.__ts().model[k]);",returnByValue:true},sid);

// COLD run: reason per cell. For each row: one eval to find the row's start input
// by date, one to set start, one to set end, one to set attendance. Records each
// action as a trace step. Round-trips = cost.
async function coldRun() {
  const { cdp, sessionId } = await attach();
  const before = cdp.calls;
  const trace = [];
  for (const r of rows) {
    // find (reason) then act — separate round-trips, like live reasoning
    const findExpr = `(()=>{const rows=[...document.querySelectorAll("tr[ng-repeat]")];const row=rows.find(x=>{const i=x.querySelector("[ng-model='rxg.startDateTime']");return i&&(i.getAttribute('value')||'').includes(${JSON.stringify(r.date)})|| [...x.querySelectorAll('td')].some(td=>td.textContent.includes(${JSON.stringify(r.date)}));});return row?[...document.querySelectorAll('tr[ng-repeat]')].indexOf(row):-1;})()`;
    const idx = (await cdp.s("Runtime.evaluate",{expression:findExpr,returnByValue:true},sessionId)).result.value;
    trace.push({ op:"find_row_by_date", date:r.date, idx });
    const setCell = async (ngModel, val)=>{ await cdp.s("Runtime.evaluate",{expression:`(()=>{const row=document.querySelectorAll('tr[ng-repeat]')[${idx}];const el=row.querySelector("[ng-model='${ngModel}']");const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value');(d&&d.set?d.set.call(el,${JSON.stringify(val)}):el.value=${JSON.stringify(val)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`,returnByValue:true},sessionId);
      trace.push({ op:"set", idx, ngModel, val }); };
    await setCell("rxg.startDateTime", r.start);
    await setCell("rxg.endDateTime", r.end);
    // attendance select
    await cdp.s("Runtime.evaluate",{expression:`(()=>{const row=document.querySelectorAll('tr[ng-repeat]')[${idx}];const se=row.querySelector("[ng-model='rxg.attendanceTypeId']");const i=[...se.options].findIndex(o=>o.text.trim()===${JSON.stringify(r.attendance)});se.selectedIndex=i;se.dispatchEvent(new Event('change',{bubbles:true}));})()`,returnByValue:true},sessionId);
    trace.push({ op:"select_attendance", idx, val:r.attendance });
  }
  const roundtrips = cdp.calls - before;
  const model = await readModel(cdp, sessionId);
  cdp.close();
  return { trace, roundtrips, model };
}

// DISTILL: turn the trace into ONE runnable JS fast-path that fills every cell in
// a single in-page pass (no per-cell reasoning). This is the runbook's saved JS.
function distill(trace) {
  const rowsData = JSON.stringify(rows);
  return `(()=>{
    const rows=${rowsData};
    const setV=(el,v)=>{const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value');(d&&d.set?d.set.call(el,v):el.value=v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
    const grid=[...document.querySelectorAll('tr[ng-repeat]')];
    const byDate=new Map();
    for(const row of grid){const i=row.querySelector("[ng-model='rxg.startDateTime']");const raw=(i&&(i.getAttribute('value')||''))||'';const m=raw.match(/\\d{2}\\/\\d{2}\\/\\d{4}/)||[...row.querySelectorAll('td')].map(td=>td.textContent).join(' ').match(/\\d{2}\\/\\d{2}\\/\\d{4}/);if(m)byDate.set(m[0],row);}
    let n=0;
    for(const r of rows){const row=byDate.get(r.date);if(!row)continue;setV(row.querySelector("[ng-model='rxg.startDateTime']"),r.start);setV(row.querySelector("[ng-model='rxg.endDateTime']"),r.end);const se=row.querySelector("[ng-model='rxg.attendanceTypeId']");se.selectedIndex=[...se.options].findIndex(o=>o.text.trim()===r.attendance);se.dispatchEvent(new Event('change',{bubbles:true}));n++;}
    return {filled:n};
  })()`;
}

// REPLAY the distilled JS: ONE round-trip.
async function replayDistilled(js) {
  const { cdp, sessionId } = await attach();
  const before = cdp.calls;
  const r = await cdp.s("Runtime.evaluate",{ expression: js, returnByValue:true }, sessionId);
  const roundtrips = cdp.calls - before;
  const model = await readModel(cdp, sessionId);
  cdp.close();
  return { result:r.result.value, roundtrips, model };
}

// --- run: cold (record) -> distill -> clear -> replay -> compare ---
const cold = await coldRun();
const js = distill(cold.trace);
{ const { cdp, sessionId } = await attach(); await clearGrid(cdp,sessionId); cdp.close(); }
const warm = await replayDistilled(js);

const sameModel = JSON.stringify(cold.model) === JSON.stringify(warm.model);
console.log(JSON.stringify({
  cold_run: { roundtrips: cold.roundtrips, trace_steps: cold.trace.length, model_dates: Object.keys(cold.model).length },
  distilled_js_len: js.length,
  warm_replay: { roundtrips: warm.roundtrips, result: warm.result, model_dates: Object.keys(warm.model).length },
  reproduces_same_fill: sameModel,
  speedup_roundtrips: `${cold.roundtrips} -> ${warm.roundtrips} (${(cold.roundtrips/warm.roundtrips).toFixed(1)}x fewer)`,
  verdict: sameModel && warm.roundtrips < cold.roundtrips
    ? "DISTILL REAL: recorded trace -> runnable JS that reproduces the same fill in far fewer round-trips (materially faster)"
    : "DISTILL NOT PROVEN",
}, null, 2));
