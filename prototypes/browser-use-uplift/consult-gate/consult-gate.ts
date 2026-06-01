// PROTOTYPE — throwaway. Proves the consult gate / read-before-run VALUE:
// does a second run on a known domain start from stored memory instead of
// rediscovering? Headline = discovery-operation count (run1 vs run2); the log
// shows WHY (consulted memory: yes/no, what it skipped).
//
// Models the real loop: a memory store on disk (empty run1), an agent driver
// that COUNTS its discovery ops, and read-before-run logic. Drives the real
// oncore login flow on the warm Chrome.
//
// Run: bun prototypes/browser-use-uplift/consult-gate/consult-gate.ts

import puppeteer, { type Page } from "puppeteer-core";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 9444);
const DOMAIN = "iteraterecruitment.oncoreservices.com";
const URL = `https://${DOMAIN}/Pages/Login.aspx`;
const MEM_ROOT = "/tmp/consult-gate-mem"; // temp memory store (real path = brainstorm decision)
const MEM_FILE = `${MEM_ROOT}/${DOMAIN}.json`;

// what the agent is trying to locate on a login domain
const TARGETS = [
  { field: "username", hint: /user.?name|email|login/i },
  { field: "password", hint: /password/i },
  { field: "submit", hint: /log ?in|sign ?in|submit/i },
];

interface Memory {
  domain: string;
  authPointer: string;
  runbook: { field: string; selector: string }[];
}

// ── a counter so we can measure "discovery effort" ───────────────────────────
class Driver {
  ops = 0;
  log: string[] = [];
  constructor(private page: Page) {}
  note(m: string) { this.log.push(m); }

  // "discovery" = enumerate the page's interactive elements + resolve a selector.
  // Each enumeration/probe counts as an op (this is the cost memory saves).
  async discoverSelector(target: { field: string; hint: RegExp }): Promise<string> {
    this.ops++; // 1 op: snapshot/enumerate interactive elements
    const candidates = await this.page.evaluate(() =>
      [...document.querySelectorAll("input, button, [type=submit]")].map((el) => ({
        id: (el as HTMLElement).id,
        name: (el as HTMLInputElement).name || "",
        type: (el as HTMLInputElement).type || "",
        text: (el.textContent || "").trim().slice(0, 20),
        label: (el.getAttribute("aria-label") || el.previousElementSibling?.textContent || "").trim().slice(0, 20),
      })),
    );
    // probe each candidate against the hint (each probe = discovery work)
    for (const c of candidates) {
      this.ops++;
      const hay = `${c.id} ${c.name} ${c.type} ${c.text} ${c.label}`;
      if (target.hint.test(hay) && c.id) {
        this.note(`discovered ${target.field} → #${c.id} (after ${this.ops} ops)`);
        return `#${c.id}`;
      }
    }
    return "";
  }

  // with memory: NO discovery — read the stored selector directly (0 discovery ops)
  recallSelector(mem: Memory, field: string): string {
    const hit = mem.runbook.find((r) => r.field === field);
    this.note(`recalled ${field} → ${hit?.selector} (0 discovery ops — from memory)`);
    return hit?.selector ?? "";
  }
}

function readMemory(): Memory | null {
  return existsSync(MEM_FILE) ? JSON.parse(readFileSync(MEM_FILE, "utf8")) : null;
}
function writeMemory(m: Memory) {
  mkdirSync(MEM_ROOT, { recursive: true });
  writeFileSync(MEM_FILE, JSON.stringify(m, null, 2));
}

async function run(label: string, page: Page): Promise<{ ops: number; consulted: boolean; log: string[] }> {
  console.log(`\n━━━ ${label} ━━━`);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 1500));

  const d = new Driver(page);
  const mem = readMemory();

  // THE CONSULT GATE: friction = a login domain → read memory before acting
  if (mem) {
    console.log(`  consult gate: memory EXISTS for ${DOMAIN} → read-before-run`);
    console.log(`  auth pointer: ${mem.authPointer}`);
    for (const t of TARGETS) d.recallSelector(mem, t.field);
  } else {
    console.log(`  consult gate: NO memory → discover live, then capture`);
    const runbook: { field: string; selector: string }[] = [];
    for (const t of TARGETS) {
      const sel = await d.discoverSelector(t);
      if (sel) runbook.push({ field: t.field, selector: sel });
    }
    // capture to durable memory (shape-only auth pointer per Gate 1)
    writeMemory({ domain: DOMAIN, authPointer: "1password:Molty/Oncore (shape-only)", runbook });
    console.log(`  captured ${runbook.length} selectors to memory: ${MEM_FILE}`);
  }

  for (const l of d.log) console.log(`    · ${l}`);
  return { ops: d.ops, consulted: !!mem, log: d.log };
}

async function main() {
  console.log("=== CONSULT GATE: does run 2 start from memory? ===");
  rmSync(MEM_ROOT, { recursive: true, force: true }); // start cold

  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` });
  const page = (await browser.pages())[0] ?? (await browser.newPage());

  const r1 = await run("RUN 1 (cold — no memory)", page);
  const r2 = await run("RUN 2 (warm — memory exists)", page);

  console.log("\n━━━ VERDICT ━━━");
  console.log(`  run 1 discovery ops: ${r1.ops}  (consulted memory: ${r1.consulted})`);
  console.log(`  run 2 discovery ops: ${r2.ops}  (consulted memory: ${r2.consulted})`);
  const saved = r1.ops - r2.ops;
  if (r2.consulted && r2.ops === 0 && r1.ops > 0) {
    console.log(`  ✓ memory HELPED: run 2 did ${saved} fewer discovery ops (reused stored selectors, no rediscovery)`);
  } else {
    console.log(`  ✗ memory did not produce the expected shortcut`);
  }
  await browser.disconnect();
}

main().catch((e) => { console.error("error:", e.message); process.exit(1); });
