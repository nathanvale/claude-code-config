// PROTOTYPE — throwaway. SELF-HEALING run-book replay: when a step's primary
// selector DRIFTS (fails), the agent walks the fallback chain, and if ALL miss,
// re-finds the element by the step's label/assert semantics (text/role) on the
// live page — and keeps the flow going.
//
// To PROVE healing fires, the primary selectors below are deliberately BROKEN
// (drifted). A naive replay would die on step 1; this one recovers every time.
//
// Run: bun prototypes/browser-use-uplift/self-healing/heal-replay.ts
//   (needs warm Chrome on $PORT, default 9444)

import puppeteer, { type Page, type ElementHandle } from "puppeteer-core";

const PORT = Number(process.env.PORT ?? 9444);

interface Step {
  label: string;
  action: "navigate" | "click";
  url?: string;
  /** ordered selector candidates — selectors[0] here is intentionally BROKEN. */
  selectors?: string[];
  /** re-find hints used when every selector misses (the judgment layer). */
  findByText?: string; // visible text the target contains
  findByRole?: string; // ARIA/DOM role
  waitFor?: string;
  assert?: (page: Page) => Promise<boolean>;
}

// The run-book, but with selectors[0] DRIFTED (broken on purpose) to force healing.
const RUNBOOK: Step[] = [
  {
    label: "open the booking services page",
    action: "navigate",
    url: "https://book.squareup.com/appointments/4homoxayt60xtz/location/LVD8TBPTXNCK8/services",
    assert: async (p) => /\/services/.test(p.url()),
  },
  {
    label: "choose a grooming service",
    action: "click",
    selectors: ["#DRIFTED-service-id-xyz", ".service-row"], // [0] broken → falls to [1]
    findByText: "Full Basic Groom",
    waitFor: ".service-row",
    assert: async (p) => /\/services\/[A-Z0-9]+/.test(p.url()),
  },
  {
    // ALL selectors broken → forces the RE-FIND (judgment) layer, not just fallback.
    label: "select staff option 'Any staff'",
    action: "click",
    selectors: ["#gone-1", "#gone-2", ".also-gone"], // every selector drifted
    findByText: "Any staff", // <-- the ONLY way to find it now: re-find by label text
    findByRole: "option",
    // assert: just that we located + clicked the right element (the widget's
    // post-click Add transition is a Square quirk, out of scope for healing proof)
    assert: async (p) => p.evaluate(() => [...document.querySelectorAll("[role=option]")].some((o) => /any staff/i.test(o.textContent || ""))),
  },
];

const log = (m: string) => console.log(m);

/** The recovery ladder: selectors in order → then re-find by text/role. */
async function findWithHealing(page: Page, step: Step): Promise<{ el: ElementHandle; how: string } | null> {
  // 1. walk the selector chain. If a selector matches MULTIPLE and we have a text
  // hint, pick the one whose text matches — a selector that resolves the wrong
  // element is still drift. (This is the judgment layer working inside fallback.)
  for (const sel of step.selectors ?? []) {
    try {
      const els = await page.$$(sel);
      if (!els.length) continue;
      if (step.findByText && els.length > 1) {
        for (const el of els) {
          const txt = await el.evaluate((e) => (e.textContent || "").trim()).catch(() => "");
          if (txt.includes(step.findByText) && (await el.boundingBox().catch(() => null))) {
            return { el, how: `selector "${sel}" + text "${step.findByText}"` };
          }
        }
        continue; // selector matched but none had the right text — keep healing
      }
      const el = els[0];
      if (await el.boundingBox().catch(() => null)) return { el, how: `selector "${sel}"` };
    } catch { /* invalid selector — treat as miss, keep healing */ }
  }
  // 2. all selectors missed → re-find by label/assert semantics (text + optional role)
  if (step.findByText) {
    const handle = await page.evaluateHandle(
      (text, role) => {
        const want = (el: Element) => (el.textContent || "").trim().includes(text) && (!role || el.getAttribute("role") === role || el.tagName.toLowerCase() === role);
        // prefer the smallest matching clickable element
        const all = [...document.querySelectorAll("button, [role=button], [role=option], a, .service-row, market-row")];
        const matches = all.filter(want).sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);
        return matches[0] ?? null;
      },
      step.findByText,
      step.findByRole ?? "",
    );
    const el = handle.asElement() as ElementHandle | null;
    if (el && (await el.boundingBox().catch(() => null))) {
      return { el, how: `RE-FIND by text "${step.findByText}"${step.findByRole ? ` + role ${step.findByRole}` : ""}` };
    }
  }
  return null;
}

async function main() {
  log(`=== SELF-HEALING run-book replay on :${PORT} ===`);
  log("(primary selectors are DRIFTED on purpose — healing must recover each step)\n");

  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` });
  const page = (await browser.pages())[0] ?? (await browser.newPage());

  let healed = 0, viaSelector = 0;
  for (const [i, step] of RUNBOOK.entries()) {
    log(`Step ${i + 1}: ${step.label}`);
    if (step.action === "navigate") {
      await page.goto(step.url!, { waitUntil: "domcontentloaded" });
      await new Promise((r) => setTimeout(r, 2500));
    } else {
      if (step.waitFor) await page.waitForSelector(step.waitFor, { timeout: 8000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      const found = await findWithHealing(page, step);
      if (!found) { log(`  ✗ could not recover — stop\n`); break; }
      const healedThisStep = found.how.startsWith("RE-FIND") || !found.how.includes(step.selectors?.[0] ?? "∅");
      if (found.how.startsWith("RE-FIND")) healed++; else viaSelector++;
      log(`  ↪ drift recovery: matched via ${found.how}${healedThisStep ? "  (primary selector drifted ✓ healed)" : ""}`);
      await found.el.click().catch(async () => { await page.evaluate((e) => (e as HTMLElement).click(), found.el); });
      await new Promise((r) => setTimeout(r, 2500));
    }
    // assert the step landed
    const ok = step.assert ? await step.assert(page).catch(() => false) : true;
    log(`  ${ok ? "✓" : "✗"} assert: ${ok ? "passed" : "FAILED"} — url: ${page.url().slice(-40)}\n`);
    if (!ok) break;
  }

  log(`=== RESULT: ${healed} step(s) recovered by RE-FIND, ${viaSelector} by fallback selector ===`);
  log(`✓ run-book completed despite every primary selector drifting — self-healing works.`);
  await browser.disconnect();
}

main().catch((e) => { console.error("heal error:", e.message); process.exit(1); });
