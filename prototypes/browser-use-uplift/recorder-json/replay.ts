// PROTOTYPE — throwaway. Replay the captured Recorder JSON against the warm real
// Chrome via @puppeteer/replay, to prove capture → store → REPLAY closes.
//
// SAFETY: values are shape-only (redacted:*), so this types placeholders into the
// real fields — NOT real creds. We replay navigate + change steps (proves
// selectors resolve + flow executes) and STOP before the submit click. No login.
//
// Requires the warm Chrome up on PORT (use warm-connect-WORKING.sh or the smoke).
// Run: bun prototypes/browser-use-uplift/recorder-json/replay.ts

import puppeteer from "puppeteer-core";
import { createRunner, PuppeteerRunnerExtension, parse } from "@puppeteer/replay";

const PORT = Number(process.env.PORT ?? 9444);

// The captured flow as Recorder JSON — but WITHOUT the final submit click
// (safety: prove structure, never attempt login). navigate + 2 change steps.
const FLOW = {
  title: "oncore — login (structure replay, no submit)",
  steps: [
    { type: "setViewport", width: 1200, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: false },
    {
      type: "navigate",
      url: "https://iteraterecruitment.oncoreservices.com/Pages/Login.aspx",
      assertedEvents: [{ type: "navigation", url: "https://iteraterecruitment.oncoreservices.com/Pages/Login.aspx" }],
    },
    { type: "change", selectors: [["#MainContent_LoginControl_UserName"]], value: "redacted:username-field" },
    { type: "change", selectors: [["#MainContent_LoginControl_Password"]], value: "redacted:password-field" },
    // NO click step — we intentionally stop before submit.
  ],
};

// An extension that LOGS each step as it replays, so we can see it execute.
class LoggingExtension extends PuppeteerRunnerExtension {
  // @ts-expect-error — base signature varies across versions; prototype-loose
  async beforeEachStep(step: { type: string; selectors?: unknown; url?: string }) {
    const sel = step.selectors ? JSON.stringify(step.selectors) : step.url ?? "";
    console.log(`  ▶ ${step.type.padEnd(12)} ${sel}`);
  }
}

async function main() {
  console.log(`=== replay captured flow against warm Chrome on :${PORT} ===`);
  console.log("(structure-only: placeholders into real fields, NO submit)\n");

  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` });
  const pages = await browser.pages();
  const page = pages[0] ?? (await browser.newPage());

  const flow = parse(FLOW);
  const runner = await createRunner(flow, new LoggingExtension(browser, page));

  console.log("replaying steps:");
  const ok = await runner.run();

  // Prove the selectors actually resolved to the real fields on the live page.
  console.log("\n=== verify fields were found + filled on the REAL page ===");
  for (const id of ["MainContent_LoginControl_UserName", "MainContent_LoginControl_Password"]) {
    const val = await page.$eval(`#${id}`, (el) => (el as HTMLInputElement).value).catch(() => null);
    console.log(val !== null ? `  ✓ #${id} resolved, value="${val}"` : `  ✗ #${id} NOT found`);
  }

  console.log(`\n${ok ? "✓" : "✗"} replay ${ok ? "executed" : "failed"}. Stopped before submit (no login attempted).`);
  await browser.disconnect();
}

main().catch((e) => { console.error("replay error:", e.message); process.exit(1); });
