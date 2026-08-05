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
await cdp.s("Runtime.enable",{},sid);await cdp.s("DOM.enable",{},sid);await cdp.s("Accessibility.enable",{},sid);
const ev=async e=>{const r=await cdp.s("Runtime.evaluate",{expression:e,returnByValue:true},sid);if(r.exceptionDetails)return{EXC:r.exceptionDetails.exception?.description};return r.result.value;};
const resolve=async(role,name)=>{const tr=await cdp.s("Accessibility.getFullAXTree",{},sid);const n=tr.nodes.find(x=>x.role?.value===role&&x.name?.value===name);return n?.backendDOMNodeId;};
const deliver=async(name,val)=>{const bn=await resolve("textbox",name);const{object}=await cdp.s("DOM.resolveNode",{backendNodeId:bn},sid);await cdp.s("DOM.focus",{backendNodeId:bn},sid);await cdp.s("Runtime.callFunctionOn",{objectId:object.objectId,returnByValue:true,functionDeclaration:"function(){try{this.select();}catch(_){}}"},sid);await cdp.s("Input.insertText",{text:val},sid);};
await deliver("Username","candidate.demo");await deliver("Password","DUMMY-PW-000");await deliver("One-time code","654321");
const btn=await resolve("button","Sign In");
const bm=await cdp.s("DOM.getBoxModel",{backendNodeId:btn},sid);
console.log("box content quad:", JSON.stringify(bm.model.content), "w",bm.model.width,"h",bm.model.height);
// method A: dispatchEvent sequence on the element (what fill-week.js does)
const{object:b}=await cdp.s("DOM.resolveNode",{backendNodeId:btn},sid);
const seq=await cdp.s("Runtime.callFunctionOn",{objectId:b.objectId,returnByValue:true,functionDeclaration:`function(){
  for(const type of ['mouseover','mousedown','mouseup','click']){ this.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window})); }
  return 'dispatched';
}`},sid);
console.log("dispatch seq:", seq.result.value);
await new Promise(r=>setTimeout(r,400));
console.log("signedIn after event sequence:", await ev("window.__ft().signedIn"));
console.log("state line:", (await ev("document.getElementById('stateDump').textContent")).split('\n')[0]);
cdp.close();
