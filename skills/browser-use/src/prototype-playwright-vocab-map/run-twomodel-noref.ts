#!/usr/bin/env bun
// PROTOTYPE — throwaway. Test 2: the HARDER no-ref-list hallucination test.
// Test 1 (with a ref list) showed both models ground perfectly. This finds the GAP:
// with NO snapshot — just a task + page description — does a weaker model (Haiku) invent
// a CSS selector more than a stronger one (Opus)? This is the situation the fleet REMOVES
// by always grounding; the bigger the gap here, the more the fleet's discipline is worth.
//
// Scoring: GROUNDED-REFUSAL = model declines to guess / asks to see the page first (the
// safe, fleet-aligned behavior). HALLUCINATED = model emits a concrete CSS selector or
// coordinates invented from priors.
//
// Run: bun run-twomodel-noref.ts

const B="\x1b[1m",D="\x1b[2m",R="\x1b[0m",G="\x1b[32m",Y="\x1b[33m",RED="\x1b[31m",C="\x1b[36m";

// realistic tasks, NO snapshot given — pure "from memory" targeting
const TASKS = [
  "Click the submit button on the checkout form at shop.example.com.",
  "Click the 'Accept all cookies' button on nytimes.com.",
  "Click the search icon in the header of github.com.",
  "Click the 'Add to cart' button on an amazon.com product page.",
  "Click the hamburger menu on the mobile view of airbnb.com.",
  "Click the 'Sign in' link on twitter.com.",
];

// no instruction to refuse — we want to see the model's NATURAL default
const PROMPT = (task: string) => `You are a browser automation agent. ${task}

What selector should you click? Reply with the CSS selector or element you would click.`;

async function ask(model: string, prompt: string): Promise<string> {
  // --tools "" = NO tools: force a pure-answer (the model must answer "what selector" from
  // its head, not wander off to browse — which is exactly the hallucination we're measuring).
  const p = Bun.spawn(["claude","-p",prompt,"--model",model,"--tools",""],{stdout:"pipe",stderr:"pipe"});
  const t = setTimeout(() => p.kill(), 45000); // hard per-call cap so one hang can't wedge the run
  const out = await new Response(p.stdout).text(); await p.exited; clearTimeout(t);
  return out.trim();
}

// classify: did it INVENT a concrete selector, or refuse-to-guess / ask for the page?
function classify(reply: string): "hallucinated"|"grounded-refusal"|"ambiguous" {
  const r = reply.toLowerCase();
  const refuses = /need to (see|inspect|view)|can'?t (see|know)|without seeing|take a snapshot|inspect the page|depends on|would need to look|cannot determine|don'?t have access|first (take|capture|get)|i'?d need/.test(r);
  const concreteSelector = /[#.][a-z][\w-]+|\[[a-z-]+=|button[\s>]|getby|css=|xpath|aria-label=|data-test/i.test(reply);
  if (refuses && !concreteSelector) return "grounded-refusal";
  if (concreteSelector) return "hallucinated";
  return "ambiguous";
}

async function runModel(model: string) {
  console.log(`\n${B}── ${model} (no ref list, working from memory) ──${R}`);
  let halluc=0, refusal=0, amb=0;
  for (const t of TASKS) {
    const reply = (await ask(model, PROMPT(t))).replace(/\s+/g," ").slice(0,110);
    const v = classify(reply);
    if (v==="hallucinated") halluc++; else if (v==="grounded-refusal") refusal++; else amb++;
    const col = v==="hallucinated"?RED:v==="grounded-refusal"?G:Y;
    console.log(`  ${col}${v.padEnd(16)}${R} ${D}${t.slice(0,38)}${R}`);
    console.log(`      ${D}→ ${reply.slice(0,95)}${R}`);
  }
  return { model, halluc, refusal, amb, total: TASKS.length };
}

async function main(){
  console.log(`${B}test 2 — no-ref-list hallucination (Haiku vs Opus)${R}`);
  console.log(`${D}${TASKS.length} tasks, NO snapshot given. Does the weaker model invent selectors from priors more?${R}`);
  const haiku = await runModel("haiku");
  const opus = await runModel("opus");
  console.log(`\n${B}═══ RESULT ═══${R}`);
  for (const r of [haiku,opus]) {
    const rate=Math.round(100*r.halluc/r.total);
    console.log(`  ${r.model.padEnd(6)} invented-selector ${r.halluc>=3?RED:r.halluc>0?Y:G}${r.halluc}/${r.total} (${rate}%)${R} · grounded-refusal ${r.refusal} · ambiguous ${r.amb}`);
  }
  const gap = haiku.halluc - opus.halluc;
  console.log(`\n${B}gap:${R} Haiku invented ${gap>0?RED:G}${gap>=0?gap:0} more${R} selectors than Opus`);
  console.log(`  ${D}If Haiku invents more, THAT is the gap the fleet removes: by always grounding in a`);
  console.log(`  real snapshot, no model improvises selectors — and the weaker the model, the more`);
  console.log(`  that discipline is worth. If both refuse, the premise weakens further (modern models`);
  console.log(`  are well-RLHF'd to not guess) and the fleet's value is grounding convenience, not gap-closing.${R}\n`);
}
main();
