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
await cdp.s("Runtime.enable",{},sid);await cdp.s("Accessibility.enable",{},sid);
const ev=async e=>{const r=await cdp.s("Runtime.evaluate",{expression:e,returnByValue:true},sid);if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const resolve=async(role,name)=>{const tr=await cdp.s("Accessibility.getFullAXTree",{},sid);const n=tr.nodes.find(x=>x.role?.value===role&&x.name?.value===name);return n?.backendDOMNodeId;};
const deliver=async(name,val)=>{const bn=await resolve("textbox",name);const{object}=await cdp.s("DOM.resolveNode",{backendNodeId:bn},sid);await cdp.s("DOM.focus",{backendNodeId:bn},sid);await cdp.s("Runtime.callFunctionOn",{objectId:object.objectId,returnByValue:true,functionDeclaration:"function(){try{this.select();}catch(_){}}"},sid);await cdp.s("Input.insertText",{text:val},sid);};
await deliver("Username","candidate.demo");
await deliver("Password","DUMMY-PW-000");
await deliver("One-time code","654321");
console.log("model before click:", await ev("JSON.stringify(window.__ft().model.login)"));
// Try calling signIn() directly to see its own verdict
console.log("signIn() guard eval:", await ev("(function(){ return { hasU: !!window.__ft().model.login.username, hasP: !!window.__ft().model.login.password }; })()") );
// click via button node
const btn=await resolve("button","Sign In");
console.log("button backendNodeId:", btn);
const{object:b}=await cdp.s("DOM.resolveNode",{backendNodeId:btn},sid);
const clickRes=await cdp.s("Runtime.callFunctionOn",{objectId:b.objectId,returnByValue:true,functionDeclaration:"function(){ this.click(); return {clicked:true, tag:this.tagName, id:this.id}; }"},sid);
console.log("click result:", JSON.stringify(clickRes.result.value));
await new Promise(r=>setTimeout(r,500));
console.log("signedIn after click:", await ev("window.__ft().signedIn"));
console.log("stateDump:", (await ev("document.getElementById('stateDump').textContent")).split('\n')[0]);
cdp.close();
