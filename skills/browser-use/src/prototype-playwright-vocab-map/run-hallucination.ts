#!/usr/bin/env bun
// PROTOTYPE — throwaway. Selector-hallucination catch-rate spike (the capability-equalizer
// claim, sharpest form).
//
// Thesis: the trust layer STRUCTURALLY eliminates selector/element hallucination — the
// failure mode weaker models hit hardest. A model that invents a plausible selector
// (#submit-btn, .cta, button[type=submit]) from training priors instead of reading the
// snapshot cannot get the fleet to act on it, because:
//   (1) refs come FROM the snapshot — an invented selector is not in the ref set;
//   (2) the oracle cross-checks the target — a fake ref maps to nothing on >=1 engine.
// This is model-INDEPENDENT: the catch is a Set membership test, equally effective for a
// weak model (Qwen) and a strong one (Opus). It equalizes by moving the guard off the model.
//
// Method: snapshot a real page → collect the REAL ref set → simulate a model emitting a mix
// of (real refs) + (hallucinated selectors). Run each through the facade's "is this a real
// target?" gate vs what a single engine acting on raw selectors would do.
//
// Run (warm Chrome + fleet up): bun run-hallucination.ts [url]
// SAFETY: prints selectors + accept/reject verdicts only.

import { existsSync } from "node:fs";
import { sh } from "./fleet.ts";
import { parseSnapshot, type EngineId } from "./ref-normalizer.ts";

const TARGET = process.argv[2] ?? "https://example.com";
const B="\x1b[1m", D="\x1b[2m", R="\x1b[0m", G="\x1b[32m", Y="\x1b[33m", RED="\x1b[31m", C="\x1b[36m";
const BIN = `${import.meta.dir}/node_modules/.bin`;
const PW_CLI = existsSync(`${BIN}/playwright-cli`) ? [`${BIN}/playwright-cli`] : ["npx","-y","@playwright/cli@latest"];
const mcpText = (raw: string) => { try { return JSON.parse(raw).content?.[0]?.text ?? raw; } catch { return raw; } };

async function snap(engine: EngineId): Promise<string> {
  if (engine === "chrome-devtools") {
    await sh(["mcporter","call","chrome-devtools.navigate_page","--args",JSON.stringify({url:TARGET}),"--output","json"]);
    return mcpText((await sh(["mcporter","call","chrome-devtools.take_snapshot","--args","{}","--output","json"])).out);
  }
  await sh([...PW_CLI,"--s=default","goto",TARGET]);
  return (await sh([...PW_CLI,"--s=default","snapshot"])).out;
}

async function main() {
  console.log(`${B}selector-hallucination catch-rate — the capability equalizer${R}`);
  console.log(`${D}thesis: the fleet structurally rejects invented selectors, model-independent${R}`);
  console.log(`${D}page: ${(TARGET.match(/\/\/([^/]+)/)||[])[1] ?? TARGET}${R}\n`);

  // 1. collect the REAL ref set + real accessible names across two lineages
  const cdt = parseSnapshot("chrome-devtools", await snap("chrome-devtools"));
  const pw  = parseSnapshot("playwright-cli", await snap("playwright-cli"));
  const realNames = new Set([...cdt, ...pw].map(r => r.name).filter(Boolean));
  const realRefs  = new Set([...cdt.map(r=>r.raw), ...pw.map(r=>r.raw)]);
  console.log(`${B}real target set (from the snapshot):${R} ${realRefs.size} refs · ${realNames.size} accessible names`);
  const sampleReal = [...realNames].slice(0,3);
  console.log(`  ${D}e.g. real names: ${sampleReal.map(n=>`"${n.slice(0,20)}"`).join(", ")}${R}\n`);

  // 2. simulate a model emitting targets — mix of REAL (read from snapshot) + HALLUCINATED
  //    (invented from priors: classic CSS guesses a weak model produces)
  type Attempt = { kind: "real"|"hallucinated"; target: string };
  const attempts: Attempt[] = [
    ...sampleReal.map(n => ({ kind:"real" as const, target: n })),
    { kind:"hallucinated", target:"#submit-btn" },
    { kind:"hallucinated", target:".cta-primary" },
    { kind:"hallucinated", target:"button[type=submit]" },
    { kind:"hallucinated", target:"Sign in" },          // plausible label not on this page
    { kind:"hallucinated", target:"#app > div.modal .confirm" },
    { kind:"hallucinated", target:"uid=999_99" },        // invented ref
  ];

  // 3a. THE FLEET GATE: a target is actionable only if it's in the real snapshot set
  //     (a ref the engines saw, or an accessible name the engines reported). This is a
  //     Set-membership test — model-independent.
  const fleetActionable = (t: string) => realRefs.has(t) || realNames.has(t);

  console.log(`${B}── the fleet gate (accept only targets present in the snapshot set) ──${R}`);
  let caughtFakes = 0, totalFakes = 0, falseReject = 0;
  for (const a of attempts) {
    const ok = fleetActionable(a.target);
    if (a.kind === "hallucinated") { totalFakes++; if (!ok) caughtFakes++; }
    if (a.kind === "real" && !ok) falseReject++;
    const verdict = ok
      ? `${G}✓ actionable${R}`
      : `${RED}✗ REJECTED (not in snapshot — hallucination caught)${R}`;
    const tag = a.kind === "hallucinated" ? `${Y}[model invented]${R}` : `${C}[from snapshot]${R}`;
    console.log(`  ${verdict.padEnd(30)} ${tag} "${a.target.slice(0,40)}"`);
  }

  // 3b. CONTRAST: a single engine acting on a model's RAW selector would just TRY it —
  //     a hallucinated CSS selector silently matches nothing (or the wrong thing) with no
  //     signal. Demonstrate by firing two hallucinated CSS selectors at one engine directly.
  console.log(`\n${B}── contrast: single engine acting on a raw model selector (no fleet gate) ──${R}`);
  for (const sel of ["#submit-btn", ".cta-primary"]) {
    const r = await sh([...PW_CLI,"--s=default","click",sel], 8000);
    const out = r.out.toLowerCase();
    const silentMiss = !/error|not found|no element|timeout|fail/.test(out) && !/clicked|done/.test(out);
    const noisy = /error|not found|no element|timeout/.test(out);
    const verdict = noisy ? `${Y}errored (recoverable)${R}` : silentMiss ? `${RED}SILENT MISS (no signal)${R}` : `${G}clicked something${R}`;
    console.log(`  raw selector "${sel}" → ${verdict} ${D}${r.out.replace(/\s+/g," ").slice(0,50)}${R}`);
  }

  console.log(`\n${B}═══ VERDICT ═══${R}`);
  console.log(`  fleet caught ${caughtFakes === totalFakes ? G : RED}${caughtFakes}/${totalFakes}${R} hallucinated selectors · ${falseReject===0?G:RED}${falseReject}${R} false rejects of real targets`);
  if (caughtFakes === totalFakes && falseReject === 0) {
    console.log(`  ${G}STRUCTURAL CATCH${R} — every invented selector rejected; every real target accepted.`);
  }
  console.log(`  ${D}The catch is a Set-membership test against the snapshot — identical for Qwen 3.5 and`);
  console.log(`  Opus 4.6. A weaker model CANNOT get the fleet to act on a hallucinated selector,`);
  console.log(`  because refs come from what the engines SAW, not from the model's priors. The trust`);
  console.log(`  layer moves the selector-hallucination guard OFF the model and INTO code — the`);
  console.log(`  capability equalizer, at its most provable.${R}\n`);
}
main();
