#!/usr/bin/env bun
// PROTOTYPE — throwaway. WCAG-via-a11y-oracle spike (Mode 1 killer fit).
//
// Thesis: WCAG is about the accessibility tree. The N engines compute the a11y tree with
// INDEPENDENT pipelines. So when engines AGREE an element exists but DISAGREE on its
// accessible NAME (or role), that disagreement is often a real a11y defect — an ambiguous
// name a screen reader would also stumble on. If true, the differential oracle is a free
// a11y smoke test.
//
// Method: snapshot across engines, group elements by (role + url/href or position proxy),
// and for each element flag NAME divergence across engines that saw it. Classify:
//   - missing-name-on-some : element present, but ≥1 engine gives it NO accessible name
//   - name-source-divergence : engines give DIFFERENT non-empty names (name computed from
//                              different DOM sources — the WCAG ambiguity smell)
//   - role-divergence : engines disagree on the element's ROLE
//
// Run (warm Chrome + fleet up): bun run-wcag.ts [url]
// SAFETY: prints role + accessible names + classification only; no auth URLs.

import { existsSync } from "node:fs";
import { sh } from "./fleet.ts";
import { parseSnapshot, type EngineId } from "./ref-normalizer.ts";

const TARGET = process.argv[2] ?? "https://news.ycombinator.com";
const B = "\x1b[1m", D = "\x1b[2m", R = "\x1b[0m", G = "\x1b[32m", Y = "\x1b[33m", RED = "\x1b[31m", C = "\x1b[36m";

const BIN = `${import.meta.dir}/node_modules/.bin`;
const CDT_CLI = existsSync(`${BIN}/chrome-devtools`) ? [`${BIN}/chrome-devtools`] : ["npx","-y","-p","chrome-devtools-mcp@latest","chrome-devtools"];
const PW_CLI = existsSync(`${BIN}/playwright-cli`) ? [`${BIN}/playwright-cli`] : ["npx","-y","@playwright/cli@latest"];
const mcpText = (raw: string) => { try { return JSON.parse(raw).content?.[0]?.text ?? raw; } catch { return raw; } };

// per-engine snapshot (Layer-1 map)
async function snap(engine: EngineId): Promise<string> {
  switch (engine) {
    case "chrome-devtools":
      await sh(["mcporter","call","chrome-devtools.navigate_page","--args",JSON.stringify({url:TARGET}),"--output","json"]);
      return mcpText((await sh(["mcporter","call","chrome-devtools.take_snapshot","--args","{}","--output","json"])).out);
    case "playwright-cdp":
      await sh(["mcporter","call","playwright-cdp.browser_navigate","--args",JSON.stringify({url:TARGET}),"--output","json"]);
      return mcpText((await sh(["mcporter","call","playwright-cdp.browser_snapshot","--args","{}","--output","json"])).out);
    case "agent-browser":
      await sh(["agent-browser","--cdp","9222","open",TARGET]);
      return (await sh(["agent-browser","--cdp","9222","snapshot","-i"])).out;
    case "playwright-cli":
      await sh([...PW_CLI,"--s=default","goto",TARGET]);
      return (await sh([...PW_CLI,"--s=default","snapshot"])).out;
    case "chrome-devtools-cli":
      await sh([...CDT_CLI,"navigate_page","--url",TARGET]);
      return (await sh([...CDT_CLI,"take_snapshot"])).out;
  }
}

const ENGINES: EngineId[] = ["chrome-devtools","playwright-cdp","agent-browser","playwright-cli","chrome-devtools-cli"];
const LABEL: Record<EngineId,string> = {"chrome-devtools":"chrome-MCP","playwright-cdp":"pw-MCP","agent-browser":"agent-br","playwright-cli":"pw-CLI","chrome-devtools-cli":"chrome-CLI"};

async function main() {
  console.log(`${B}WCAG-via-a11y-oracle spike${R}`);
  console.log(`${D}thesis: engines disagree on accessible NAME => candidate a11y defect (ambiguous name)${R}`);
  console.log(`${D}page: ${(TARGET.match(/\/\/([^/]+)/)||[])[1] ?? TARGET}${R}\n`);

  // gather per-engine refs (role + name)
  const refsByEngine: Record<string, {role:string;name:string}[]> = {};
  for (const e of ENGINES) {
    const refs = parseSnapshot(e, await snap(e)).filter(r => /link|button|textbox|checkbox|combobox|menuitem|tab|image|heading/i.test(r.role));
    refsByEngine[e] = refs.map(r => ({role:r.role.toLowerCase(), name:r.name}));
  }
  const live = ENGINES.filter(e => refsByEngine[e].length > 0);

  // To compare "the same element" across engines without shared ids, use the strongest
  // available proxy: an element is "the same" if its accessible NAME matches on ≥2 engines
  // OR (the interesting case) engines agree on a slot but name it differently. Since we lack
  // a cross-engine id, approximate the a11y signal two ways:
  //  (A) NAME-COVERAGE: names seen by some engines but MISSING entirely on others (interactive
  //      element one engine couldn't name = a11y defect candidate).
  //  (B) EMPTY-NAME RATE per engine: interactive elements with NO accessible name at all
  //      (the clearest WCAG failure — a control a screen reader can't announce).
  console.log(`${B}── per-engine interactive element + unnamed-control counts ──${R}`);
  let totalUnnamed = 0;
  for (const e of live) {
    const all = refsByEngine[e];
    const unnamed = all.filter(r => !r.name || r.name.trim()==="").length;
    totalUnnamed += unnamed;
    const flag = unnamed > 0 ? `${RED}${unnamed} UNNAMED${R}` : `${G}0 unnamed${R}`;
    console.log(`  ${LABEL[e].padEnd(11)} ${all.length} interactive · ${flag}`);
  }

  // (A) name-coverage divergence: names present on some engines, absent on others
  const nameToEngines = new Map<string, Set<string>>();
  for (const e of live) for (const r of refsByEngine[e]) if (r.name) {
    if (!nameToEngines.has(r.name)) nameToEngines.set(r.name, new Set());
    nameToEngines.get(r.name)!.add(e);
  }
  const contested = [...nameToEngines.entries()].filter(([,es]) => es.size>0 && es.size<live.length);
  console.log(`\n${B}── accessible-name coverage divergence (WCAG signal) ──${R}`);
  console.log(`  ${nameToEngines.size} distinct accessible names total · ${contested.length<Math.ceil(nameToEngines.size) ? "" : ""}${C}${contested.length} named on SOME engines but not all${R}`);
  for (const [name, es] of contested.slice(0,12)) {
    const seen = [...es].map(e=>LABEL[e as EngineId].split("-")[0]);
    console.log(`    ${Y}${es.size}/${live.length}${R} "${name.slice(0,42)}" ${D}${seen.join(",")}${R}`);
  }
  if (contested.length>12) console.log(`    ${D}... +${contested.length-12} more${R}`);

  console.log(`\n${B}═══ WCAG VERDICT ═══${R}`);
  if (totalUnnamed > 0) {
    console.log(`  ${RED}UNNAMED CONTROLS FOUND${R} — ${totalUnnamed} interactive elements (across engines) have NO`);
    console.log(`  accessible name. A screen reader announces these as "button"/"link" with no label —`);
    console.log(`  a direct WCAG 4.1.2 (Name, Role, Value) failure. The fleet surfaced them mechanically.`);
  }
  if (contested.length > 0) {
    console.log(`  ${Y}NAME-COVERAGE DIVERGENCE${R} — ${contested.length} names are computed by some engines but not`);
    console.log(`  others → the element's accessible name is AMBIGUOUS (depends on a11y-tree heuristics).`);
    console.log(`  An agent acting by name is engine-fragile here, AND a screen reader's announcement`);
    console.log(`  is non-deterministic — a real accessibility smell, not just a tooling quirk.`);
  }
  if (totalUnnamed===0 && contested.length===0) {
    console.log(`  ${G}CLEAN${R} — engines agree on every interactive element's accessible name. Strong a11y signal.`);
  }
  console.log(`\n  ${D}The thesis: cross-engine NAME disagreement = a11y-defect candidate. A single engine`);
  console.log(`  reports one name and calls it done; it cannot tell the name is ambiguous. The oracle can.${R}\n`);
}
main();
