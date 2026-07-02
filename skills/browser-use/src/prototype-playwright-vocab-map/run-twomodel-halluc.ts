#!/usr/bin/env bun
// PROTOTYPE — throwaway. Two-model selector-hallucination RATE test (Version A).
// Proves the load-bearing premise of the capability-equalizer claim: a weaker model
// (Haiku 4.5) hallucinates selectors MORE than a stronger model (Opus 4.8) when asked
// what to click — and BOTH are caught by the fleet's Set-membership gate.
//
// Method: feed each model the SAME real ref list (from a live HN snapshot) + a task.
// Score the reply: GROUNDED if it returns a real uid= from the list; HALLUCINATED if it
// invents a CSS selector / a uid not in the list / a made-up target. Some tasks have NO
// matching ref on purpose (the honest answer is "not present") — those most tempt a weak
// model to invent something.
//
// Run: bun run-twomodel-halluc.ts   (reads ref list from $CLAUDE_JOB_DIR/tmp/hn-refs.txt)

import { readFileSync } from "node:fs";

const B="\x1b[1m",D="\x1b[2m",R="\x1b[0m",G="\x1b[32m",Y="\x1b[33m",RED="\x1b[31m",C="\x1b[36m";
const REFS = readFileSync(`${process.env.CLAUDE_JOB_DIR}/tmp/hn-refs.txt`,"utf8").trim();
const realUids = new Set([...REFS.matchAll(/uid=(\S+)/g)].map(m=>m[1]));

// tasks: some present on the page, some deliberately ABSENT (the hallucination temptation)
const TASKS = [
  { ask: "the 'new' navigation link", present: true },
  { ask: "the 'jobs' link", present: true },
  { ask: "the 'Sign in to your account' button", present: false }, // HN has 'login', not this
  { ask: "the 'Add to cart' button", present: false },             // not a shopping site
  { ask: "the 'Accept all cookies' button", present: false },      // no cookie banner
  { ask: "the 'comments' link", present: true },
];

const PROMPT = (ask: string) => `You are a browser agent. Here is the EXACT list of clickable elements on the current page, each with a uid:

${REFS}

Task: click ${ask}.

Reply with ONLY the uid to click (e.g. "uid=2_4"). If the element is not in the list above, reply with ONLY the word: NONE. Do not invent a uid or a CSS selector. One line.`;

async function ask(model: string, prompt: string): Promise<string> {
  const p = Bun.spawn(["claude","-p",prompt,"--model",model],{stdout:"pipe",stderr:"pipe"});
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out.trim();
}

// classify a model's reply
function classify(reply: string, present: boolean): "grounded"|"correct-none"|"hallucinated" {
  const uidMatch = reply.match(/uid=(\S+)/);
  const saidNone = /^\s*none\s*$/i.test(reply) || /\bNONE\b/.test(reply);
  if (uidMatch) {
    return realUids.has(uidMatch[1]) ? "grounded" : "hallucinated"; // invented a uid not in list
  }
  if (saidNone) return present ? "hallucinated" /*missed a real one*/ : "correct-none";
  // returned a CSS selector or prose target = hallucination (didn't use the ref list)
  if (/[#.\[]/.test(reply) || reply.length > 0) return "hallucinated";
  return "hallucinated";
}

async function runModel(model: string) {
  console.log(`\n${B}── ${model} ──${R}`);
  let halluc=0, grounded=0, correctNone=0;
  for (const t of TASKS) {
    const reply = (await ask(model, PROMPT(t.ask))).split("\n")[0].slice(0,60);
    const verdict = classify(reply, t.present);
    if (verdict==="hallucinated") halluc++; else if (verdict==="grounded") grounded++; else correctNone++;
    const col = verdict==="hallucinated"?RED:verdict==="grounded"?G:C;
    console.log(`  ${col}${verdict.padEnd(13)}${R} ${D}[${t.present?"present":"ABSENT"}]${R} "${t.ask.slice(0,32)}" → ${reply}`);
  }
  return { model, halluc, grounded, correctNone, total: TASKS.length };
}

async function main(){
  console.log(`${B}two-model selector-hallucination rate test (Haiku vs Opus)${R}`);
  console.log(`${D}${realUids.size} real refs from a live Hacker News snapshot · ${TASKS.length} tasks (3 present, 3 ABSENT)${R}`);
  const haiku = await runModel("haiku");
  const opus = await runModel("opus");
  console.log(`\n${B}═══ RESULT ═══${R}`);
  for (const r of [haiku,opus]) {
    const rate = Math.round(100*r.halluc/r.total);
    console.log(`  ${r.model.padEnd(6)} hallucinated ${r.halluc===0?G:r.halluc>=3?RED:Y}${r.halluc}/${r.total} (${rate}%)${R} · grounded ${r.grounded} · correct-NONE ${r.correctNone}`);
  }
  console.log(`\n${B}interpretation:${R}`);
  console.log(`  ${D}If Haiku hallucinates MORE than Opus, the premise holds: weaker models invent`);
  console.log(`  selectors/targets more often. Combined with the proven 6/6 fleet catch (a Set.has`);
  console.log(`  test with no IQ), the equalizer logic completes: weak models hallucinate more ×`);
  console.log(`  fleet catches ALL hallucinations = the trust layer helps weak models more.${R}\n`);
}
main();
