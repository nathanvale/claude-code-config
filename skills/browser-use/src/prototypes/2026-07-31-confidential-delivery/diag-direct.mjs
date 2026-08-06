const WS=process.argv[2],FX=process.argv[3];
class Cdp{constructor(ws){this.ws=ws;this.id=0;this.pp=new Map();ws.addEventListener("message",e=>{const m=JSON.parse(e.data);if(m.id!==undefined&&this.pp.has(m.id)){const{r,j}=this.pp.get(m.id);this.pp.delete(m.id);m.error?j(new Error(JSON.stringify(m.error))):r(m.result);}});}
static c(u){return new Promise((r,j)=>{const ws=new WebSocket(u);ws.addEventListener("open",()=>r(new Cdp(ws)));ws.addEventListener("error",j);});}
s(m,p={},sid){const id=++this.id;const o={id,method:m,params:p};if(sid)o.sessionId=sid;return new Promise((r,j)=>{this.pp.set(id,{r,j});this.ws.send(JSON.stringify(o));setTimeout(()=>{if(this.pp.has(id)){this.pp.delete(id);j(new Error("timeout "+m));}},8000);});}
close(){this.ws.close();}}
const norm=u=>{try{return new URL(u).href;}catch{return u;}};
const cdp=await Cdp.c(WS);
const{targetInfos}=await cdp.s("Target.getTargets");
const t=targetInfos.filter(x=>x.type==="page").find(x=>norm(x.url)===norm(FX));
const{sessionId:sid}=await cdp.s("Target.attachToTarget",{targetId:t.targetId,flatten:true});
await cdp.s("Runtime.enable",{},sid);
const ev=async e=>{const r=await cdp.s("Runtime.evaluate",{expression:e,returnByValue:true},sid);if(r.exceptionDetails)return {EXC:r.exceptionDetails.exception?.description||JSON.stringify(r.exceptionDetails)};return r.result.value;};
// set model directly and call signIn() to isolate the function itself
await cdp.s("Runtime.evaluate",{expression:"window.__ft && (function(){const m=window.__ft().model; m.login.username='x'; m.login.password='y';})()",returnByValue:true},sid);
console.log("typeof signIn:", await ev("typeof signIn"));
console.log("typeof window.signIn:", await ev("typeof window.signIn"));
console.log("call signIn():", JSON.stringify(await ev("(function(){ try{ signIn(); return 'called'; }catch(e){ return 'ERR '+e.message; } })()")));
console.log("signedIn now:", await ev("window.__ft().signedIn"));
console.log("first state line:", (await ev("document.getElementById('stateDump').textContent")).split('\n')[0]);
cdp.close();
