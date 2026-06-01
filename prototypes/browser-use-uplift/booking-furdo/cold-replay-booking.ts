// PROTOTYPE — throwaway. COLD replay of a captured Urban Furdo grooming booking
// flow: navigate the real booking path → click into a service → reach the
// staff/date step, then STOP. Never clicks "Book Now" — no real appointment.
//
// Proves: a captured Recorder JSON of a real booking flow plays back from a
// cold-started browser and works up to the booking step.
//
// Run: bun prototypes/browser-use-uplift/booking-furdo/cold-replay-booking.ts

import puppeteer from "puppeteer-core";
import { createRunner, PuppeteerRunnerExtension, parse } from "@puppeteer/replay";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 9444);
const FLOW = JSON.parse(
  readFileSync(new URL("./flow.json", import.meta.url), "utf8"),
);

class LoggingExtension extends PuppeteerRunnerExtension {
  // @ts-expect-error — base signature varies; prototype-loose
  async beforeEachStep(step: { type: string; url?: string; selectors?: unknown }) {
    const what = step.url ?? (step.selectors ? JSON.stringify(step.selectors) : "");
    console.log(`  ▶ ${step.type.padEnd(11)} ${what}`);
  }
}

async function main() {
  console.log(`=== COLD replay: Urban Furdo booking flow on :${PORT} ===`);
  console.log("(replays the real booking PATH; STOPS before Book Now)\n");

  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` });
  const page = (await browser.pages())[0] ?? (await browser.newPage());

  // strip the _note field before parse (not a schema member)
  const { _note, ...clean } = FLOW;
  const flow = parse(clean);
  const runner = await createRunner(flow, new LoggingExtension(browser, page));

  console.log("replaying steps:");
  const ok = await runner.run();

  console.log("\n=== verify we reached the booking step (NOT booked) ===");
  const url = page.url();
  console.log(`  landed: ${url}`);
  const onBooking = /squareup\.com\/appointments|book\.squareup/.test(url);
  console.log(onBooking ? "  ✓ on the Square booking flow" : "  ✗ not on booking flow");

  // confirm a booking-step element is present (staff/date/service), but DON'T act
  const hasStep = await page
    .$eval("body", (b) => /staff|select a time|choose a date|services|book/i.test(b.innerText))
    .catch(() => false);
  console.log(hasStep ? "  ✓ booking step content present" : "  ✗ booking content not found");

  console.log(`\n${ok ? "✓" : "✗"} replay ${ok ? "executed" : "failed"} — reached booking step, Book Now NOT clicked.`);
  await browser.disconnect();
}

main().catch((e) => { console.error("replay error:", e.message); process.exit(1); });
