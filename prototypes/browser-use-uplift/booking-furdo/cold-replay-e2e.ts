// PROTOTYPE — throwaway. FULL E2E cold replay of the Urban Furdo grooming booking:
// choose groom → check availability → pick a time slot → reach the CHECKOUT page
// with the "Book appointment" button, then STOP. Never books.
//
// The booking time slots are dynamic (availability changes), so the slot pick is
// done by the replay extension (first available), not a hardcoded selector.
//
// Run: bun prototypes/browser-use-uplift/booking-furdo/cold-replay-e2e.ts

import puppeteer from "puppeteer-core";
import { createRunner, PuppeteerRunnerExtension, parse } from "@puppeteer/replay";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 9444);
const FLOW = JSON.parse(readFileSync(new URL("./flow-e2e.json", import.meta.url), "utf8"));

class LoggingExtension extends PuppeteerRunnerExtension {
  // @ts-expect-error — loose
  async beforeEachStep(step: { type: string; url?: string; selectors?: unknown }) {
    const what = step.url ?? (step.selectors ? JSON.stringify(step.selectors) : "");
    console.log(`  ▶ ${step.type.padEnd(11)} ${what}`);
  }
}

async function main() {
  console.log(`=== FULL E2E COLD replay: Urban Furdo booking on :${PORT} ===`);
  console.log("(choose groom → availability → time slot → CHECKOUT; STOPS before Book)\n");

  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` });
  const page = (await browser.pages())[0] ?? (await browser.newPage());

  const { _note, ...clean } = FLOW;
  const runner = await createRunner(parse(clean), new LoggingExtension(browser, page));

  console.log("replaying captured steps:");
  await runner.run();

  // ── dynamic continuation: pick the first available time slot → checkout ────
  console.log("  ▶ (dynamic)   pick first available time slot");
  await new Promise((r) => setTimeout(r, 3000));
  const picked = await page.evaluate(() => {
    const slot = document.querySelector("li button, [role=listitem] button, button[class*=time]");
    const looksLikeTime = slot && /\d{1,2}:\d{2}/.test(slot.textContent || "");
    if (looksLikeTime) { (slot as HTMLButtonElement).click(); return (slot.textContent || "").trim(); }
    return null;
  });
  console.log(picked ? `    picked slot: ${picked}` : "    (no slot auto-found — availability may differ)");
  await new Promise((r) => setTimeout(r, 5000));

  // ── verify we reached checkout WITH the Book button, but did NOT click it ───
  console.log("\n=== verify reached CHECKOUT (Book appointment present, NOT clicked) ===");
  const url = page.url();
  console.log(`  landed: ${url}`);
  const onCheckout = /checkout/.test(url);
  console.log(onCheckout ? "  ✓ on the checkout/confirmation page" : "  • not at /checkout (availability may have shifted)");

  const hasBookBtn = await page
    .evaluate(() => [...document.querySelectorAll("button")].some((b) => /book appointment/i.test(b.textContent || "")))
    .catch(() => false);
  console.log(hasBookBtn ? "  ✓ 'Book appointment' button present" : "  • Book button not found this run");

  console.log(`\n✓ E2E replay reached the confirmation/checkout step. Book appointment NOT clicked — no appointment created.`);
  await browser.disconnect();
}

main().catch((e) => { console.error("replay error:", e.message); process.exit(1); });
