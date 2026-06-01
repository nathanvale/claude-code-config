// throwaway probe — the REAL cold cost is the agent explore-loop (snapshot the
// whole page + enumerate before each step + re-snapshot after each action),
// NOT the cheap querySelector. Measure browser-work only (excludes LLM think time,
// which is the dominant real cold cost on top of this).
import puppeteer from "puppeteer-core";
const URL = "https://iteraterecruitment.oncoreservices.com/Pages/Login.aspx";
const now = () => performance.now();
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9444" });
const p = (await b.pages())[0];
await p.goto(URL, { waitUntil: "domcontentloaded" });

// COLD-like: full-tree read + interactive enumeration before each of 3 steps
let t = now();
for (let step = 0; step < 3; step++) {
  await p.evaluate(() => document.querySelectorAll("*").length);
  await p.$$eval("input,button,a,[role]", (els) => els.map((e) => ({ i: (e as HTMLElement).id, t: e.textContent?.slice(0, 40) })));
}
const coldMs = now() - t;

// WARM: 3 direct selector resolves, no snapshot/enumeration
t = now();
for (const s of ["#MainContent_LoginControl_UserName", "#MainContent_LoginControl_Password", "#MainContent_LoginControl_LoginButton"]) await p.$(s);
const warmMs = now() - t;

console.log(`cold explore-loop (3× full snapshot+enumerate): ${coldMs.toFixed(1)}ms`);
console.log(`warm direct recall (3 selectors):              ${warmMs.toFixed(1)}ms`);
console.log(`browser-work ratio (excludes LLM think time):  ${(coldMs / warmMs).toFixed(1)}×`);
await b.disconnect();
