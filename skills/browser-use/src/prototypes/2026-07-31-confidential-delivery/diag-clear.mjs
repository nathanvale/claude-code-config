const WS=process.argv[2], FX=process.argv[3];
class Cdp{constructor(ws){this.ws=ws;this.id=0;this.p=new Map();ws.addEventListener("message",e=>{const m=JSON.parse(e.data);if(m.id!==undefined&&this.p.has(m.id)){const{r,j}=this.p.get(m.id);this.p.delete(m.id);m.error?j(new Error(JSON.stringify(m.error))):r(m.result);}});}
static c(u){return new Promise((r,j)=>{const ws=new WebSocket(u);ws.addEventListener("open",()=>r(new Cdp(ws)));ws.addEventListener("error",e=>j(e));});}
s(m,p={},sid){const id=++this.id;const o={id,method:m,params:p};if(sid)o.sessionId=sid;return new Promise((r,j)=>{this.p.set(id,{r,j});this.ws.send(JSON.stringify(o));setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);j(new Error("timeout "+m));}},8000);});}}
const norm=u=>{try{return new URL(u).href;}catch{return u;}};
const cdp=await Cdp.c(WS);
const{targetInfos}=await cdp.s("Target.getTargets");
const t=targetInfos.filter(x=>x.type==="page").find(x=>norm(x.url)===norm(FX));
const{sessionId:sid}=await cdp.s("Target.attachToTarget",{targetId:t.targetId,flatten:true});
await cdp.s("Runtime.enable",{},sid);await cdp.s("Accessibility.enable",{},sid);
const ev=async e=>{const r=await cdp.s("Runtime.evaluate",{expression:e,returnByValue:true},sid);if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const resolve=async(role,name)=>{const tr=await cdp.s("Accessibility.getFullAXTree",{},sid);const n=tr.nodes.find(x=>x.role?.value===role&&x.name?.value===name);return n.backendDOMNodeId;};
// Experiment 1: plain insertText, no clear
const un=await resolve("textbox","Username");
await cdp.s("DOM.focus",{backendNodeId:un},sid);
await cdp.s("Input.insertText",{text:"candidate.demo"},sid);
console.log("after plain insertText username:", await ev("JSON.stringify(window.__ft().model.login)"));
// Experiment 2: now try the Ctrl+A clear + insertText and see if it wipes
await cdp.s("Input.dispatchKeyEvent",{type:"keyDown",modifiers:4,key:"a",code:"KeyA",windowsVirtualKeyCode:65},sid);
await cdp.s("Input.dispatchKeyEvent",{type:"keyUp",modifiers:4,key:"a",code:"KeyA",windowsVirtualKeyCode:65},sid);
await cdp.s("Input.insertText",{text:""},sid);
console.log("after ctrl+A + insertText(''):", await ev("JSON.stringify(window.__ft().model.login)"));
await cdp.s("Input.insertText",{text:"candidate.demo"},sid);
console.log("after re-insert:", await ev("JSON.stringify(window.__ft().model.login)"));
cdp.close();
