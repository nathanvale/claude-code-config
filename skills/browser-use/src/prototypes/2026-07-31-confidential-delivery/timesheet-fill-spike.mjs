// PROTOTYPE — throwaway. Proves the TIMESHEET FILL half is correct + fail-closed,
// mirroring the real fill-week.js guards, against the served Angular grid fixture.
// Drives fill by DATE (never blind weekday index) via CDP into rxg.* inputs and
// asserts: clean week fills; wrong-week (fortnight superset) refuses; duplicate
// row date refuses; unreadable dates refuse. STOP before submit throughout.
//
// Run: bun timesheet-fill-spike.mjs <browser-ws> <base-http-url>
//   e.g. ... "ws://..." "http://localhost:8787"

const WS = process.argv[2];
const BASE = process.argv[3];
if (!WS || !BASE) { console.error("usage: bun timesheet-fill-spike.mjs <ws> <base-http-url>"); process.exit(2); }

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

// The fill logic under test — a faithful reduction of fill-week.js's core:
// anchor each edit row to its OWN date, refuse superset/duplicate/unreadable,
// fill by expected date. Runs IN-PAGE via Runtime.evaluate so it reads the real
// DOM the same way the shipped action does.
const FILL_FN = `
(function(request){
  const fail=(reason,extra={})=>({ok:false,reason,...extra});
  const norm=v=>String(v||'').replace(/\\s+/g,' ').trim();
  const parseDMY=s=>{const m=String(s).match(/(\\d{2})\\/(\\d{2})\\/(\\d{4})/);return m?new Date(+m[3],+m[2]-1,+m[1]):null;};
  const dmy=d=>String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
  const addDays=(d,n)=>{const c=new Date(d.getTime());c.setDate(c.getDate()+n);return c;};
  const weekStart=parseDMY(request.week_start); if(!weekStart) return fail('invalid_week_start');
  const editRows=()=>Array.from(document.querySelectorAll("tr[ng-repeat]")).filter(r=>
    r.querySelector("[ng-model='rxg.startDateTime']"));
  const rowDate=(row)=>{
    const si=row.querySelector("[ng-model='rxg.startDateTime']");
    const raw=si&&String(si.value||si.getAttribute('value')||'');
    let m=raw&&raw.match(/\\d{2}\\/\\d{2}\\/\\d{4}/); let p=m&&parseDMY(m[0]); if(p) return dmy(p);
    const cell=Array.from(row.querySelectorAll('td')).map(td=>norm(td.innerText||td.textContent)).find(t=>/\\d{2}\\/\\d{2}\\/\\d{4}/.test(t));
    m=cell&&cell.match(/\\d{2}\\/\\d{2}\\/\\d{4}/); p=m&&parseDMY(m[0]); return p?dmy(p):'';
  };
  // target-week set
  const targetDates=new Set(); for(let i=0;i<7;i++) targetDates.add(dmy(addDays(weekStart,i)));
  const rows=editRows(); if(rows.length<5) return fail('grid_not_open',{rows:rows.length});
  // fail-closed: every row date readable, unique, inside target week
  const dates=rows.map(rowDate).filter(Boolean);
  if(dates.length<rows.length) return fail('row_dates_unreadable',{readable:dates.length,rows:rows.length});
  if(new Set(dates).size!==dates.length) return fail('duplicate_row_date',{dates});
  if(!dates.every(d=>targetDates.has(d))) return fail('wrong_week_open',{foreign:dates.filter(d=>!targetDates.has(d))});
  // map date->row, fill requested days BY DATE
  const byDate=new Map(); rows.forEach(r=>byDate.set(rowDate(r),r));
  const dayIdx={mon:0,tue:1,wed:2,thu:3,fri:4,sat:5,sun:6};
  const setValue=(input,val)=>{const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value');(d&&d.set?d.set.call(input,val):input.value=val);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
  const filled=[];
  for(const req of request.rows){
    const di=dayIdx[String(req.day).toLowerCase()]; if(di==null) return fail('invalid_day',{day:req.day});
    const expected=dmy(addDays(weekStart,di));
    const row=byDate.get(expected); if(!row) return fail('row_date_mismatch',{day:req.day,expected,available:[...byDate.keys()]});
    const si=row.querySelector("[ng-model='rxg.startDateTime']"), ei=row.querySelector("[ng-model='rxg.endDateTime']"), se=row.querySelector("[ng-model='rxg.attendanceTypeId']");
    if(!si||!ei||!se) return fail('field_not_found',{expected});
    setValue(si,req.start); setValue(ei,req.end);
    const oi=Array.from(se.options).findIndex(o=>o.text.trim()===req.attendance); if(oi<0) return fail('attendance_option_not_found',{attendance:req.attendance});
    se.selectedIndex=oi; se.dispatchEvent(new Event('change',{bubbles:true}));
    filled.push({date:expected,start:req.start,end:req.end,attendance:req.attendance});
  }
  return {ok:true,filled,submitted:false};
})
`;

async function runOn(pageUrl, request) {
  const cdp = await Cdp.c(WS);
  const { targetInfos } = await cdp.s("Target.getTargets");
  const tab = targetInfos.filter(t=>t.type==="page").find(t=>norm(t.url)===norm(pageUrl));
  if (!tab) { cdp.close(); return { error:"tab not open: "+pageUrl }; }
  const { sessionId } = await cdp.s("Target.attachToTarget",{ targetId: tab.targetId, flatten:true });
  await cdp.s("Runtime.enable",{},sessionId);
  const expr = `JSON.stringify(( ${FILL_FN} )(${JSON.stringify(request)}))`;
  const r = await cdp.s("Runtime.evaluate",{ expression: expr, returnByValue:true }, sessionId);
  cdp.close();
  if (r.exceptionDetails) return { error: "exception: "+JSON.stringify(r.exceptionDetails).slice(0,200) };
  return JSON.parse(r.result.value);
}

const week = "03/08/2026";
const workDays = [
  { day:"Mon", start:"09:00", end:"17:00", attendance:"Standard" },
  { day:"Tue", start:"09:00", end:"17:00", attendance:"Standard" },
  { day:"Wed", start:"09:00", end:"17:00", attendance:"Standard" },
  { day:"Thu", start:"09:00", end:"17:00", attendance:"Standard" },
  { day:"Fri", start:"09:00", end:"15:00", attendance:"Overtime" },
];
const req = { week_start: week, rows: workDays };

const scenarios = [
  { name:"clean_week",   url:`${BASE}/timesheet-fixture.html?week=03/08/2026`,               expect:"ok" },
  { name:"wrong_week",   url:`${BASE}/timesheet-fixture.html?week=03/08/2026&bad=fortnight`,  expect:"wrong_week_open" },
  { name:"duplicate",    url:`${BASE}/timesheet-fixture.html?week=03/08/2026&bad=dupe`,        expect:"duplicate_row_date" },
  { name:"unreadable",   url:`${BASE}/timesheet-fixture.html?week=03/08/2026&bad=nodates`,     expect:"row_dates_unreadable" },
];

// Single-scenario mode (driven by the shell wrapper: opens the URL, runs --one).
const oneIdx = process.argv.indexOf("--one");
if (oneIdx > -1) {
  const name = process.argv[oneIdx+1];
  const sc = scenarios.find(s=>s.name===name);
  const out = await runOn(sc.url, req);
  const got = out.ok ? "ok" : out.reason || out.error;
  const pass = out.ok ? sc.expect==="ok" : got===sc.expect;
  console.log(JSON.stringify({ scenario:name, expected:sc.expect, got, pass, detail: out }, null, 2));
  process.exit(pass?0:1);
}
// list mode
console.log(JSON.stringify(Object.fromEntries(scenarios.map(s=>[s.name,{url:s.url,expected:s.expect}])),null,2));
