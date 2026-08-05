// PROTOTYPE — throwaway CDP spike. Answers 5 design questions for the
// confidential-delivery plan. Secret-free: writes only the sentinel-free
// dummy "DELIVERY_PROBE_VALUE_12345". Run: bun cdp-spike.mjs <browser-ws-url> <fixture-file-url>
// No production use.

const BROWSER_WS = process.argv[2];
const FIXTURE_URL = process.argv[3];
const DUMMY = "DELIVERY_PROBE_VALUE_12345"; // not a secret; a spike marker

if (!BROWSER_WS || !FIXTURE_URL) {
  console.error("usage: bun cdp-spike.mjs <browser-ws-url> <fixture-url>");
  process.exit(2);
}

// Minimal CDP-over-WebSocket client with flat-session support.
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new Cdp(ws)));
      ws.addEventListener("error", (e) => reject(new Error("ws error: " + (e.message || e))));
    });
  }
  // sessionId present => flat-session routing to an attached target.
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 5000);
    });
  }
  close() { this.ws.close(); }
}

const results = {};
const pass = (q, ok, detail) => { results[q] = { ok, detail }; console.log(`\n[${q}] ${ok ? "PASS" : "FAIL"} — ${detail}`); };

// ---------------------------------------------------------------------------
// Q1: second browser-level CDP client attaches while agent-browser holds its own.
// ---------------------------------------------------------------------------
console.log("Connecting second browser-level CDP client to:", BROWSER_WS);
const cdp = await Cdp.connect(BROWSER_WS);
const { targetInfos } = await cdp.send("Target.getTargets");
const pages = targetInfos.filter((t) => t.type === "page");
console.log(`Target.getTargets => ${targetInfos.length} targets, ${pages.length} page targets`);

// find our fixture page by exact URL
const norm = (u) => { try { return new URL(u).href; } catch { return u; } };
const wantHref = norm(FIXTURE_URL);
const matches = pages.filter((t) => norm(t.url) === wantHref);
console.log(`Exact-URL matches for fixture: ${matches.length}`);
if (matches.length !== 1) {
  pass("Q3", false, `expected exactly 1 exact-URL match, got ${matches.length}: ${JSON.stringify(pages.map(p=>p.url))}`);
} else {
  pass("Q3", true, `single-match target id=${matches[0].targetId} for url=${matches[0].url}`);
}
const target = matches[0] || pages[0];

// attach flat-session
let sessionId;
try {
  const r = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  sessionId = r.sessionId;
  pass("Q1", true, `second client attached flat-session sessionId=${sessionId} to target=${target.targetId} (agent-browser still connected)`);
} catch (e) {
  pass("Q1", false, `attachToTarget failed: ${e.message}`);
  console.log(JSON.stringify(results, null, 2));
  cdp.close();
  process.exit(1);
}

// enable domains on the session
await cdp.send("Runtime.enable", {}, sessionId);
await cdp.send("DOM.enable", {}, sessionId);
await cdp.send("Page.enable", {}, sessionId);

// baseline model state
const evalOn = async (expr) => {
  const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error("eval exception: " + JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const stateBefore = await evalOn("JSON.stringify(window.__spike())");
console.log("state before any write:", stateBefore);

// ---------------------------------------------------------------------------
// Q5 (stretch): cheap top-frame origin re-read right before insert.
// ---------------------------------------------------------------------------
const originReRead = await evalOn("({origin: location.origin, href: location.href})");
pass("Q5", typeof originReRead.origin === "string",
  `re-read top-frame origin=${JSON.stringify(originReRead.origin)} href=${JSON.stringify(originReRead.href)} via one Runtime.evaluate on the attached session`);

// ---------------------------------------------------------------------------
// Q4: field identity bridge — from role+accessible name, re-locate exact node
// via the separate CDP session (Accessibility + DOM.describeNode => backendNodeId).
// ---------------------------------------------------------------------------
let backendNodeId, objectId;
try {
  await cdp.send("Accessibility.enable", {}, sessionId);
  const full = await cdp.send("Accessibility.getFullAXTree", {}, sessionId);
  // find node by role=textbox + name="Confidential value"
  const axNode = full.nodes.find((n) =>
    n.role?.value === "textbox" &&
    n.name?.value === "Confidential value");
  if (!axNode) throw new Error("no AX node matched role=textbox name='Confidential value'");
  backendNodeId = axNode.backendDOMNodeId;
  // resolve to a Runtime object for the exact node
  const resolved = await cdp.send("DOM.resolveNode", { backendNodeId }, sessionId);
  objectId = resolved.object.objectId;
  // prove it's the same element as document.getElementById('secret')
  const sameEl = await cdp.send("Runtime.callFunctionOn", {
    functionDeclaration: "function(){ return this === document.getElementById('secret'); }",
    objectId, returnByValue: true,
  }, sessionId);
  pass("Q4", sameEl.result.value === true,
    `role=textbox name='Confidential value' => backendNodeId=${backendNodeId}, resolveNode=>objectId; identity check this===#secret is ${sameEl.result.value}`);
} catch (e) {
  pass("Q4", false, `field identity bridge failed: ${e.message}`);
}

// ---------------------------------------------------------------------------
// Q2: Input.insertText semantics against the Angular-style binding.
// Two experiments:
//   (a) DOM.setAttributeValue / raw .value with NO events (control) — expect model NOT updated.
//   (b) Input.insertText after focusing the field — does it fire input + update model?
// ---------------------------------------------------------------------------

// Experiment (a): raw value set, no events.
await cdp.send("Runtime.callFunctionOn", {
  functionDeclaration: `function(){ this.value = ${JSON.stringify(DUMMY + "_RAW")}; }`,
  objectId, returnByValue: true,
}, sessionId);
const afterRaw = JSON.parse(await evalOn("JSON.stringify(window.__spike())"));
console.log("after raw .value set (no events):", JSON.stringify(afterRaw));

// reset field
await cdp.send("Runtime.callFunctionOn", {
  functionDeclaration: `function(){ this.value=''; }`, objectId, returnByValue: true,
}, sessionId);

// Experiment (b): focus the exact node, then Input.insertText.
await cdp.send("DOM.focus", { backendNodeId }, sessionId);
await cdp.send("Input.insertText", { text: DUMMY }, sessionId);
const afterInsert = JSON.parse(await evalOn("JSON.stringify(window.__spike())"));
console.log("after Input.insertText:", JSON.stringify(afterInsert));

const rawUpdatedModel = afterRaw.model === (DUMMY + "_RAW");
const insertUpdatedModel = afterInsert.model === DUMMY;
const insertFiredInput = afterInsert.inputCount >= 1;
const insertFiredKeydown = afterInsert.keyCount >= 1;

pass("Q2", true,
  `raw .value set updated model? ${rawUpdatedModel} (expected false) | ` +
  `Input.insertText updated model? ${insertUpdatedModel} | fired input event? ${insertFiredInput} | fired keydown? ${insertFiredKeydown} | ` +
  `=> ${insertUpdatedModel ? "insertText ALONE commits to Angular binding" : "insertText INSUFFICIENT — must also dispatch input/change"}`);

// Does 'change' fire? insertText does not blur; check change count.
const changeFired = afterInsert.changeCount >= 1;
console.log(`change event fired by insertText (without blur)? ${changeFired}`);

// ---------------------------------------------------------------------------
// Q1 corollary: prove agent-browser's own connection is still live after our
// second client did all this (agent-browser holds a SEPARATE ws to the browser).
// (verified out-of-band by the runner re-running agent-browser get value.)
// ---------------------------------------------------------------------------

console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(results, null, 2));
cdp.close();
