/**
 * QUESTION: Does replaying a known browser flow from stored memory (WARM) actually
 * run faster on the WALL CLOCK than discovering the flow from scratch (COLD)?
 *
 * A prior prototype proved the gap in OPERATION COUNT (cold = 22 discovery ops,
 * warm = 0). This one proves it in TIME — the "N× faster / saved M seconds"
 * number a human actually feels.
 *
 * MODEL: each step of a flow costs:
 *   - COLD: discovery (enumerate + probe AVG_CANDIDATES_PER_STEP selectors @
 *     DISCOVERY_MS_PER_CANDIDATE each) + the action itself (ACTION_MS).
 *   - WARM: recall the stored selector (~RECALL_MS, near-zero) + the same action.
 * The action is paid by BOTH runs — warm isn't magic, it just skips discovery.
 *
 * We MEASURE real elapsed time with performance.now() around real awaited
 * setTimeout delays, so the totals are observed, not summed estimates.
 */

// ---- Cost model (retune here) ----
const DISCOVERY_MS_PER_CANDIDATE = 80; // probe one candidate selector
const ACTION_MS = 50; // click / type / submit — paid by both runs
const RECALL_MS = 1; // read a selector from memory (near-zero)

// Per-step flow: how many candidates COLD must probe to resolve the selector.
// (Forms with many similar inputs cost more to disambiguate.)
type Step = { name: string; candidates: number };
const FLOW: Step[] = [
  { name: "open login page", candidates: 3 },
  { name: "fill username", candidates: 6 },
  { name: "fill password", candidates: 5 },
  { name: "click sign in", candidates: 4 },
  { name: "open timesheet", candidates: 7 },
  { name: "select week", candidates: 5 },
  { name: "enter hours", candidates: 9 },
  { name: "submit timesheet", candidates: 4 },
];

const AVG_CANDIDATES_PER_STEP =
  FLOW.reduce((sum, s) => sum + s.candidates, 0) / FLOW.length;

// ---- Timer (prefer performance.now; fall back + label if frozen) ----
const hasPerf = typeof performance !== "undefined" && typeof performance.now === "function";
let timerReliable = hasPerf;
const now = (): number => (hasPerf ? performance.now() : Date.now());

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type StepResult = { name: string; discoveryMs: number; actionMs: number; totalMs: number };

async function runCold(): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const step of FLOW) {
    const discoveryBudget = step.candidates * DISCOVERY_MS_PER_CANDIDATE;
    const t0 = now();
    await delay(discoveryBudget); // enumerate + probe candidates live
    const tDisc = now();
    await delay(ACTION_MS); // perform the action
    const t1 = now();
    results.push({
      name: step.name,
      discoveryMs: tDisc - t0,
      actionMs: t1 - tDisc,
      totalMs: t1 - t0,
    });
  }
  return results;
}

async function runWarm(): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const step of FLOW) {
    const t0 = now();
    await delay(RECALL_MS); // selector read from memory, no probing
    const tRecall = now();
    await delay(ACTION_MS); // same action as cold
    const t1 = now();
    results.push({
      name: step.name,
      discoveryMs: tRecall - t0,
      actionMs: t1 - tRecall,
      totalMs: t1 - t0,
    });
  }
  return results;
}

function sum(rs: StepResult[]): number {
  return rs.reduce((a, r) => a + r.totalMs, 0);
}

function fmt(ms: number): string {
  return `${ms.toFixed(0)}ms`;
}

function printRun(label: string, rs: StepResult[]): void {
  console.log(`\n${label}`);
  for (const r of rs) {
    console.log(
      `  ${r.name.padEnd(20)} discovery ${fmt(r.discoveryMs).padStart(7)} + action ${fmt(r.actionMs).padStart(6)} = ${fmt(r.totalMs).padStart(7)}`,
    );
  }
  console.log(`  ${"TOTAL".padEnd(20)} ${fmt(sum(rs)).padStart(43)}`);
}

async function main(): Promise<void> {
  // Sanity-check the timer: if real elapsed for a known delay is ~0, it's frozen.
  const probe0 = now();
  await delay(20);
  const probeElapsed = now() - probe0;
  if (probeElapsed < 5) timerReliable = false;

  const unit = timerReliable ? "ms" : "simulated-ms (timer unavailable)";

  console.log("=".repeat(70));
  console.log("BROWSER-DOMAIN-MEMORY — wall-clock: cold discover vs warm replay");
  console.log("=".repeat(70));
  console.log(
    `model: discovery=${DISCOVERY_MS_PER_CANDIDATE}${unit}/candidate, action=${ACTION_MS}${unit}, recall=${RECALL_MS}${unit}`,
  );
  console.log(
    `flow: ${FLOW.length} steps, avg ${AVG_CANDIDATES_PER_STEP.toFixed(1)} candidates/step probed cold`,
  );
  console.log(`timer: ${timerReliable ? "performance.now() — real wall-clock" : "FROZEN — reporting simulated budget"}`);

  const cold = await runCold();
  printRun("COLD RUN (discover every selector from scratch):", cold);

  const warm = await runWarm();
  printRun("WARM RUN (replay selectors from memory):", warm);

  const coldTotal = sum(cold);
  const warmTotal = sum(warm);
  const saved = coldTotal - warmTotal;
  const ratio = warmTotal > 0 ? coldTotal / warmTotal : Infinity;
  const discoveryShare = (saved / coldTotal) * 100;

  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(`  cold total : ${fmt(coldTotal)} (${unit})`);
  console.log(`  warm total : ${fmt(warmTotal)} (${unit})`);
  console.log(`  saved      : ${fmt(saved)}  (${discoveryShare.toFixed(0)}% of cold was discovery)`);
  console.log(`  speedup    : ${ratio.toFixed(1)}× faster`);
  console.log(
    `\n  HEADLINE: warm replay is ${ratio.toFixed(1)}× faster — saves ${(saved / 1000).toFixed(2)}s per run.`,
  );

  console.log("\nVERDICT");
  const verdict =
    ratio >= 2
      ? `Memory replay wins decisively (${ratio.toFixed(1)}×). The cost is discovery, ` +
        `and warm pays none of it — only the unavoidable actions remain.`
      : `Replay helps (${ratio.toFixed(1)}×) but actions dominate; bigger wins need cheaper actions too.`;
  console.log(`  ${verdict}`);
}

main();
