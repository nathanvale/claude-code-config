// PROTOTYPE — throwaway. REAL measured cold-vs-warm on a live page.
// NOT a cost model — a real clock around real work against the warm Chrome:
//   COLD = live discovery (enumerate elements, probe each against a hint until
//          the field is found) — the honest "agent hunts for the field" cost.
//   WARM = puppeteer/replay plays the saved run-book (known selectors) — the
//          "read the notes, go straight there" cost.
// Same flow, same page, same browser. Locate/fill only — NO submit (safe).
//
// Run: bun prototypes/browser-use-uplift/metrics-real/real-cold-vs-warm.ts

import puppeteer, { type Page } from "puppeteer-core";

const PORT = Number(process.env.PORT ?? 9444);
const URL = "https://iteraterecruitment.oncoreservices.com/Pages/Login.aspx";

// The flow's targets. COLD finds each by hint (no foreknowledge of the id).
// WARM already knows the selector (it's in the saved run-book).
const TARGETS = [
  { field: "username", hint: /user.?name|email|login/i, selector: "#MainContent_LoginControl_UserName" },
  { field: "password", hint: /password/i, selector: "#MainContent_LoginControl_Password" },
  { field: "submit", hint: /log ?in|sign ?in|submit/i, selector: "#MainContent_LoginControl_LoginButton" },
];

const now = () => performance.now();

// ── COLD: live discovery — enumerate candidates, probe each against the hint ──
async function coldRun(page: Page): Promise<number> {
  const t0 = now();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  for (const target of TARGETS) {
    // enumerate ALL interactive candidates (the "snapshot" cost)
    const candidates = await page.$$eval("input, button, [type=submit], a", (els) =>
      els.map((el) => ({
        id: (el as HTMLElement).id,
        name: (el as HTMLInputElement).name || "",
        type: (el as HTMLInputElement).type || "",
        text: (el.textContent || "").trim().slice(0, 30),
        aria: el.getAttribute("aria-label") || "",
      })),
    );
    // probe each candidate against the hint until a match (the "where is it?" cost)
    let found = "";
    for (const c of candidates) {
      // a real per-candidate check against the live DOM (resolve + verify)
      const hay = `${c.id} ${c.name} ${c.type} ${c.text} ${c.aria}`;
      if (target.hint.test(hay) && c.id) {
        // verify it actually resolves on the page (real query, real cost)
        const ok = await page.$(`#${c.id}`);
        if (ok) { found = `#${c.id}`; break; }
      }
    }
    if (!found) console.log(`  cold: could not find ${target.field}`);
  }
  return now() - t0;
}

// ── WARM: replay the saved run-book — go straight to known selectors ──────────
async function warmRun(page: Page): Promise<number> {
  const t0 = now();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  for (const target of TARGETS) {
    // known selector from memory — single direct resolve, no enumeration/probing
    await page.$(target.selector);
  }
  return now() - t0;
}

async function main() {
  console.log(`=== REAL measured cold-vs-warm on ${URL} ===`);
  console.log("(locate-only, no submit; real clock, same warm Chrome)\n");
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` });
  const page = (await browser.pages())[0] ?? (await browser.newPage());

  // warm up the page load once so neither run pays first-navigation TLS/DNS cost
  await page.goto(URL, { waitUntil: "domcontentloaded" });

  // measure each a few times, take the median, to reduce noise
  const N = 3;
  const cold: number[] = [], warm: number[] = [];
  for (let i = 0; i < N; i++) { cold.push(await coldRun(page)); warm.push(await warmRun(page)); }
  const median = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const c = median(cold), w = median(warm);

  console.log(`cold runs (ms): ${cold.map((x) => x.toFixed(0)).join(", ")}  → median ${c.toFixed(0)}ms`);
  console.log(`warm runs (ms): ${warm.map((x) => x.toFixed(0)).join(", ")}  → median ${w.toFixed(0)}ms`);
  console.log("");
  const saved = c - w;
  const ratio = c / w;
  console.log(`HEADLINE: warm replay ${ratio.toFixed(1)}× faster — saves ${saved.toFixed(0)}ms per run (real measured).`);
  console.log(`note: both pay the same page-load; the delta is discovery (enumerate+probe) vs direct recall.`);
  await browser.disconnect();
}

main().catch((e) => { console.error("error:", e.message); process.exit(1); });
