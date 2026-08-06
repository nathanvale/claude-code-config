// PROTOTYPE — throwaway. Real-portal happy-path harness. TWO phases the operator
// drives:
//   deliver <portal>  — custody child does op read -> fd3 -> the REAL login field
//                       (username, then password). Agent never holds bytes. YOU
//                       then click Sign In.
//   verify  <portal>  — read ONLY non-secret post-login state (url, title, whether
//                       a login form is still present). Never a field value/token.
//
// Never attaches to the real default Chrome — Agent Chrome via browser-connect only.
// Run:  bun portal-login-verify.mjs <phase> <portal> <browser-ws>
//   phase = deliver | verify ; portal = fasttrack | oncore

import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const [phase, portal, BROWSER_WS] = process.argv.slice(2);
const HERE = dirname(fileURLToPath(import.meta.url));
const VAULT = "Browser Automation";

const PORTALS = {
  fasttrack: { item:"6he7gmnrc54ssdm7fzzvk4rmne", login_url:"https://manpowergroup.fasttrack360.com.au/RecruitmentManager/CandidatePortal",
    origin:"https://manpowergroup.fasttrack360.com.au", user_name:"Username", pass_name:"Password",
    logged_in_hint:(u,t)=> !/login/i.test(u) || /timesheet|candidate portal/i.test(t) },
  oncore: { item:"br3dx7qe6loo264sonmtj2czny", login_url:"https://iteraterecruitment.oncoreservices.com/",
    origin:"https://iteraterecruitment.oncoreservices.com", user_name:"User Name:", pass_name:"Password:",
    logged_in_hint:(u,t)=> !/login\.aspx|sign in/i.test(u) && !/: Login$/i.test(t) },
};
const P = PORTALS[portal];
if (!P || !BROWSER_WS) { console.error("usage: bun portal-login-verify.mjs deliver|verify fasttrack|oncore <ws>"); process.exit(2); }

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
const norm=(u)=>{ try{return new URL(u).href;}catch{return u;} };

async function attachLoginTarget(cdp) {
  const { targetInfos } = await cdp.s("Target.getTargets");
  const pages = targetInfos.filter(t=>t.type==="page");
  // single-match by exact origin (the real login page must be open, one tab).
  const match = pages.filter(t=>{ try { return new URL(t.url).origin === P.origin; } catch { return false; } });
  if (match.length !== 1) return { error:`expected exactly 1 tab on ${P.origin}, found ${match.length}`, urls: pages.map(p=>p.url) };
  const targetId = match[0].targetId;
  const { sessionId } = await cdp.s("Target.attachToTarget",{ targetId, flatten:true });
  await cdp.s("Runtime.enable",{},sessionId); await cdp.s("DOM.enable",{},sessionId); await cdp.s("Accessibility.enable",{},sessionId);
  return { targetId, sessionId, url: match[0].url };
}
async function resolveField(cdp, sessionId, name) {
  const tree = await cdp.s("Accessibility.getFullAXTree",{},sessionId);
  const n = tree.nodes.find(x=>x.role?.value==="textbox" && x.name?.value===name);
  return n?.backendDOMNodeId;
}

if (phase === "deliver") {
  // Re-verify origin immediately before delivery (TOCTOU). Refuse if not on the
  // exact allowed origin — never deliver a secret into an unexpected page.
  const cdp = await Cdp.c(BROWSER_WS);
  const att = await attachLoginTarget(cdp);
  if (att.error) { console.log(JSON.stringify({ ok:false, reason:"origin-guard", detail:att })); cdp.close(); process.exit(1); }
  const userNode = await resolveField(cdp, att.sessionId, P.user_name);
  const passNode = await resolveField(cdp, att.sessionId, P.pass_name);
  cdp.close();
  if (!userNode || !passNode) { console.log(JSON.stringify({ ok:false, reason:"field-not-found", userNode, passNode })); process.exit(1); }

  // Deliver username then password via the custody child. Each is op read->fd3->field.
  // The agent (this process) never binds either value.
  const deliverOne = (opField, backendNodeId) => new Promise((resolve) => {
    const opRef = `op://${VAULT}/${P.item}/${opField}`;
    const child = spawn("bash", ["-c",
      `op read ${JSON.stringify(opRef)} --no-newline 3>/dev/null | ` +
      `bun ${JSON.stringify(join(HERE,"custody-child.mjs"))} ${JSON.stringify(BROWSER_WS)} ${JSON.stringify(att.targetId)} ${JSON.stringify(String(backendNodeId))} 3<&0`
    ], { stdio:["ignore","pipe","pipe"] });
    let out="",err=""; child.stdout.on("data",d=>out+=d); child.stderr.on("data",d=>err+=d);
    child.on("close",(code)=>{ let r; try{r=JSON.parse(out.trim());}catch{r={ok:false,raw:out.trim()};} resolve({ code, r, err:err.trim() }); });
  });

  const u = await deliverOne("username", userNode);
  const p = await deliverOne("password", passNode);
  console.log(JSON.stringify({
    ok: u.r.ok===true && p.r.ok===true,
    origin_reverified: att.url,
    username_shape: u.r.shape ?? null,   // { field_len } — no value
    password_shape: p.r.shape ?? null,
    next: "OPERATOR: click Sign In on the real portal, then run the verify phase",
    agent_saw_bytes: false,
  }, null, 2));
}

if (phase === "verify") {
  // Read ONLY non-secret post-login state.
  const cdp = await Cdp.c(BROWSER_WS);
  const { targetInfos } = await cdp.s("Target.getTargets");
  const pages = targetInfos.filter(t=>t.type==="page");
  // after login the URL may change; find any tab on the portal's registrable domain.
  const host = new URL(P.origin).host.split(".").slice(-3).join(".");
  const tab = pages.find(t=>{ try { return new URL(t.url).host.endsWith(host.split(".").slice(-2).join(".")); } catch { return false; } }) || pages[0];
  const { sessionId } = await cdp.s("Target.attachToTarget",{ targetId: tab.targetId, flatten:true });
  await cdp.s("Runtime.enable",{},sessionId);
  const title = (await cdp.s("Runtime.evaluate",{ expression:"document.title", returnByValue:true }, sessionId)).result.value;
  const url = (await cdp.s("Runtime.evaluate",{ expression:"location.href", returnByValue:true }, sessionId)).result.value;
  const hasPasswordField = (await cdp.s("Runtime.evaluate",{ expression:"!!document.querySelector('input[type=password]')", returnByValue:true }, sessionId)).result.value;
  cdp.close();
  const loggedIn = P.logged_in_hint(url, title) && !hasPasswordField;
  console.log(JSON.stringify({
    logged_in_guess: loggedIn,
    url_host: (()=>{try{return new URL(url).host;}catch{return url;}})(),  // host only, not full url with tokens
    title,
    login_form_still_present: hasPasswordField,
    note: "non-secret post-login state only; no field values or tokens read",
  }, null, 2));
}
