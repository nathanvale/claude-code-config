// PROTOTYPE — throwaway. RUN-OUTCOME TELEMETRY + PER-FLOW DASHBOARD.
//
// Question: each time a saved flow runs, what should we record so the history
// is BOTH (a) a value dashboard — "look how much time warm replay saves vs the
// cold first run" — AND (b) the input the staleness/quality gates consume —
// health from result + heal/drift trend? One record shape, two uses.
//
// This proves the RunOutcome SHAPE + a dashboard() readout that turns an ordered
// history into: success rate, cold-vs-warm avg duration (speedup made visible),
// heal-rate trend (creeping up = rot), a current health signal, and the last
// verified outcome.
//
// Timestamps are passed in as fixed fixture strings — NO Date.now()/new Date().
// Trends come from the ORDER of the data, not the wall clock.
//
// Run: bun prototypes/browser-use-uplift/metrics-telemetry/telemetry.ts  (zero deps)

// ---- THE RECORD SHAPE (kept compatible with the staleness prototype) -------
// staleness consumes: result-as-pass/fail + stepsHealed + driftedSelectors per
// run. We carry the richer three-way `result` (matching success-verify) plus the
// duration/mode/confidence fields the dashboard needs. A `failed` or `ambiguous`
// run is "not a clean pass" for the gate; "confirmed" is the pass.
type RunResult = "confirmed" | "failed" | "ambiguous"; // == success-verify outcome
type RunMode = "cold-discovery" | "warm-replay";

interface RunOutcome {
  ts: string; // ISO date — PASSED IN, never computed from the clock
  flowId: string;
  mode: RunMode;
  result: RunResult;
  durationMs: number;
  stepsTotal: number;
  stepsHealed: number; // selectors that drifted this run and were recovered
  minSelectorConfidence: number; // 0..1, lowest-confidence selector hit this run
  note: string;
}

const isPass = (r: RunOutcome) => r.result === "confirmed";
const healRate = (r: RunOutcome) => (r.stepsTotal ? r.stepsHealed / r.stepsTotal : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

// ---- THE DASHBOARD (the readout — value + gate input from one history) -----
type Health = "healthy" | "degrading" | "at-risk";

function dashboard(flowId: string, all: RunOutcome[]): string {
  const h = all.filter((r) => r.flowId === flowId); // oldest -> newest, assumed ordered
  const total = h.length;
  const passes = h.filter(isPass).length;
  const successRate = passes / total;

  const cold = h.filter((r) => r.mode === "cold-discovery");
  const warm = h.filter((r) => r.mode === "warm-replay");
  const coldAvg = mean(cold.map((r) => r.durationMs));
  const warmAvg = mean(warm.map((r) => r.durationMs));
  const speedup = warmAvg ? coldAvg / warmAvg : 0;

  // heal-rate trend: compare older half vs recent half of the history.
  const half = Math.max(1, Math.floor(total / 2));
  const earlyHeal = mean(h.slice(0, half).map(healRate));
  const recentHeal = mean(h.slice(-half).map(healRate));
  const trendUp = recentHeal > earlyHeal + 0.05;
  const lastVerified = [...h].reverse().find(isPass);

  // health signal (a light echo of the staleness gate — the SAME inputs):
  // recent rot OR a recent non-pass downgrades health.
  const lastResult = h[h.length - 1].result;
  let health: Health = "healthy";
  if (recentHeal >= 0.5 || lastResult === "failed") health = "at-risk";
  else if (trendUp || lastResult === "ambiguous") health = "degrading";

  const HICON: Record<Health, string> = { healthy: "✓", degrading: "⚠", "at-risk": "✗" };
  const RICON: Record<RunResult, string> = { confirmed: "✓", failed: "✗", ambiguous: "⚠" };

  // sparkline of per-run heal-rate (▁..█), shows rot visually over time.
  const bars = "▁▂▃▄▅▆▇█";
  const spark = h
    .map((r) => bars[Math.min(bars.length - 1, Math.round(healRate(r) * (bars.length - 1)))])
    .join("");

  const lines: string[] = [];
  lines.push(`=== DASHBOARD: ${flowId} ===`);
  lines.push(
    `runs: ${total}   success: ${passes}/${total} (${Math.round(successRate * 100)}%)   health: ${HICON[health]} ${health.toUpperCase()}`,
  );
  lines.push(
    `speed: cold ${secs(coldAvg)} avg  ->  warm ${secs(warmAvg)} avg   = ${speedup.toFixed(1)}x faster once learned`,
  );
  lines.push(
    `heal-rate: early ${earlyHeal.toFixed(2)}  ->  recent ${recentHeal.toFixed(2)}   ${trendUp ? "⚠ creeping up (rot)" : "stable"}   trend ${spark}`,
  );
  lines.push(
    lastVerified
      ? `last verified: ${lastVerified.ts} (${lastVerified.mode}) — "${lastVerified.note}"`
      : `last verified: never (no confirmed run)`,
  );
  lines.push("");
  lines.push("  date        mode            result      dur     heal   minConf  note");
  for (const r of h) {
    lines.push(
      `  ${r.ts}  ${r.mode.padEnd(15)} ${RICON[r.result]} ${r.result.padEnd(9)} ${secs(r.durationMs).padStart(6)}  ${r.stepsHealed}/${r.stepsTotal}    ${r.minSelectorConfidence.toFixed(2)}    ${r.note}`,
    );
  }
  return lines.join("\n");
}

// ---- FIXTURES: two flows, realistic accumulated histories ------------------
const run = (
  ts: string,
  flowId: string,
  mode: RunMode,
  result: RunResult,
  durationMs: number,
  stepsTotal: number,
  stepsHealed: number,
  minSelectorConfidence: number,
  note: string,
): RunOutcome => ({ ts, flowId, mode, result, durationMs, stepsTotal, stepsHealed, minSelectorConfidence, note });

// Flow A: weekly timesheet. First run cold + slow; warm replays fast. A couple
// of heals, one failure (portal outage), one ambiguous (spinner stuck). Healthy
// overall — the value story.
const HISTORY: RunOutcome[] = [
  run("2026-04-11", "weekly-timesheet", "cold-discovery", "confirmed", 41200, 7, 0, 0.95, "first run, mapped the flow"),
  run("2026-04-18", "weekly-timesheet", "warm-replay", "confirmed", 6100, 7, 0, 0.95, "clean replay"),
  run("2026-04-25", "weekly-timesheet", "warm-replay", "confirmed", 5800, 7, 1, 0.88, "submit btn moved, healed"),
  run("2026-05-02", "weekly-timesheet", "warm-replay", "failed", 9300, 7, 0, 0.40, "portal 503, never reached submit"),
  run("2026-05-09", "weekly-timesheet", "warm-replay", "confirmed", 6400, 7, 0, 0.93, "back to normal"),
  run("2026-05-16", "weekly-timesheet", "warm-replay", "ambiguous", 12800, 7, 1, 0.71, "spinner stuck, no confirm text"),
  run("2026-05-23", "weekly-timesheet", "warm-replay", "confirmed", 6000, 7, 0, 0.94, "clean replay"),
  run("2026-05-30", "weekly-timesheet", "warm-replay", "confirmed", 5900, 7, 0, 0.95, "clean replay"),

  // Flow B: payroll export. Cold once, then warm — but selectors are quietly
  // rotting run over run (heal-rate creeps up). Still passing => degrading, the
  // early-warning case the gate cares about.
  run("2026-04-12", "payroll-export", "cold-discovery", "confirmed", 38500, 6, 0, 0.96, "first run, mapped the flow"),
  run("2026-04-19", "payroll-export", "warm-replay", "confirmed", 7200, 6, 0, 0.94, "clean replay"),
  run("2026-04-26", "payroll-export", "warm-replay", "confirmed", 7400, 6, 1, 0.82, "date picker drifted, healed"),
  run("2026-05-03", "payroll-export", "warm-replay", "confirmed", 7600, 6, 2, 0.69, "two selectors drifted, healed"),
  run("2026-05-10", "payroll-export", "warm-replay", "confirmed", 8100, 6, 3, 0.55, "three drifted, limping but passed"),
];

// ---- REPORT ----------------------------------------------------------------
const log = (m = "") => console.log(m);

log(dashboard("weekly-timesheet", HISTORY));
log();
log(dashboard("payroll-export", HISTORY));
log();

// ---- VERDICT ---------------------------------------------------------------
const a = HISTORY.filter((r) => r.flowId === "weekly-timesheet");
const aCold = mean(a.filter((r) => r.mode === "cold-discovery").map((r) => r.durationMs));
const aWarm = mean(a.filter((r) => r.mode === "warm-replay").map((r) => r.durationMs));
const aRate = a.filter(isPass).length / a.length;
log(
  `VERDICT: one RunOutcome record drives both uses — value (${(aCold / aWarm).toFixed(1)}x speedup, ` +
    `${Math.round(aRate * 100)}% success on weekly-timesheet) AND the gate (heal-rate trend flags ` +
    `payroll-export as degrading before it ever fails). Same fields the staleness prototype scores.`,
);
