// PROTOTYPE — throwaway. Answers: does the SPEED-oriented runbook lifecycle feel
// right, with optimization fully OFF the critical path and a runbook waiting for
// the user's NEXT visit?
//
// Three distinct moments (the correction that matters):
//   1. CRITICAL PATH: run the task as fast as possible. Return the user outcome
//      AND the measured duration immediately ("done, took Xs"). Recording the
//      duration is cheap and happens here. The user walks away.
//   2. BACKGROUND (user gone): a DETACHED worker distills/optimizes the runbook
//      from what actually worked. The user waited for NONE of this.
//   3. NEXT VISIT: the run finds the optimized runbook already waiting -> fast on
//      its FIRST warm invocation (not after another slow run).
//
// Fake browser work + fake distill; this proves the CONTROL FLOW, ORDERING, and
// the "waiting for them" property. In-memory only. A virtual clock stands in for
// wall time (Date.now is unavailable and would break determinism anyway).
//
// Run:  bun runbook-lifecycle-spike.mjs

// ---- Virtual clock (deterministic; no Date.now) ---------------------------
let CLOCK = 0;
const now = () => CLOCK;
const advance = (ms) => { CLOCK += ms; };

// ---- Runbook store keyed by portal::task::framework -----------------------
const store = new Map();
const keyOf = (t) => `${t.portal}::${t.task}::${t.framework}`;

// ---- A detached background queue: work enqueued here runs ONLY when we
// explicitly drain it — modeling "later, while the user is away". Nothing on
// the critical path ever awaits this.
const background = [];
function enqueueBackground(label, fn) { background.push({ label, fn }); }
function drainBackground(reason) {
  if (background.length === 0) { console.log(`  [background] nothing queued`); return; }
  console.log(`  [background] draining ${background.length} job(s) — ${reason} (user is away)`);
  while (background.length) {
    const job = background.shift();
    const msg = job.fn();
    console.log(`    * ${job.label}: ${msg}`);
  }
}

// ---- Fake execution: cost in ms + steps. Cold is slow; warm-clean replays the
// runbook's baseline; warm-with-drift still succeeds but costs more.
function execute(task, runbook, { drift = false } = {}) {
  let steps, ms, mode;
  if (!runbook) { steps = 14; ms = 7200; mode = "cold-live-reasoning"; }
  else if (drift) { steps = 11; ms = 6100; mode = "warm-replay-with-live-patch"; }
  else { steps = runbook.baseline.steps; ms = runbook.baseline.ms; mode = "warm-replay-clean"; }
  advance(ms); // the user actually waits this long
  return { ok: true, steps, ms, mode };
}

// A distilled runbook is a DIRECT JS fast-path that skips live reasoning, so its
// replay cost is materially lower than the run it was distilled from. Model the
// speedup explicitly: distilled replay drops the reasoning overhead. (Real system:
// the LLM emits code that fills fields directly instead of snapshot->reason->act.)
const REASONING_OVERHEAD_MS = 4600; // portion of a cold/patched run spent reasoning
const REASONING_OVERHEAD_STEPS = 8;
function distill(task, achieved, prevVersion) {
  const fastMs = Math.max(600, achieved.ms - REASONING_OVERHEAD_MS);
  const fastSteps = Math.max(3, achieved.steps - REASONING_OVERHEAD_STEPS);
  return {
    key: keyOf(task), version: prevVersion + 1, framework: task.framework,
    fast_path_js: `/* v${prevVersion + 1} for ${task.framework} ${task.task} */ fillTimesheet(${JSON.stringify(task.week)});`,
    baseline: { steps: fastSteps, ms: fastMs }, distilled_from_mode: achieved.mode,
  };
}
const shouldOptimize = (run, baseline) =>
  !baseline || run.ms > baseline.ms || run.steps > baseline.steps || run.mode !== "warm-replay-clean";

// ---- One user request. Returns the user outcome on the CRITICAL PATH ONLY.
// Anything that could make next time faster is ENQUEUED, never awaited.
function userRequest(task, { drift = false } = {}) {
  const key = keyOf(task);
  const existing = store.get(key);
  const tStart = now();
  const run = execute(task, existing, { drift });
  const tEnd = now();
  const duration = tEnd - tStart;

  // Record "how long it took" NOW (cheap: a number on the runbook or a pending
  // record). This is on the critical path but costs nothing.
  const lastRun = { ms: duration, steps: run.steps, mode: run.mode, at: tEnd };
  if (existing) existing.last_run = lastRun;

  // Decide if a background optimization is worth queuing — but DO NOT run it.
  if (shouldOptimize(run, existing?.baseline)) {
    enqueueBackground(
      existing ? `re-optimize ${key}` : `create runbook ${key}`,
      () => {
        const v = distill(task, run, existing ? existing.version : 0);
        v.last_run = lastRun;
        store.set(key, v);
        return `distilled v${v.version} (baseline ${v.baseline.steps}/${v.baseline.ms}ms) — waiting for next visit`;
      }
    );
  }

  return {
    warm: !!existing,
    user_outcome: { ok: run.ok, filled: task.task },
    duration_ms: duration,       // reported back to the user: "done, took Xs"
    mode: run.mode,
    optimization_queued: shouldOptimize(run, existing?.baseline),
  };
}

// ---- Surfacing -------------------------------------------------------------
function dumpStore(label) {
  console.log(`  --- runbook store ${label ? "(" + label + ")" : ""} ---`);
  if (store.size === 0) { console.log("    (empty — nothing waiting yet)"); return; }
  for (const [k, rb] of store)
    console.log(`    ${k}  v${rb.version} | baseline ${rb.baseline.steps}/${rb.baseline.ms}ms | last_run ${rb.last_run?.ms ?? "-"}ms`);
}
function visit(name, task, opts, { thenLeave = true } = {}) {
  console.log(`\n===== USER VISIT: ${name}  (clock ${now()}ms) =====`);
  const r = userRequest(task, opts);
  console.log(`  ${r.warm ? "WARM" : "COLD"} run -> mode=${r.mode}`);
  console.log(`  >> USER: "done, filled your ${r.user_outcome.filled}, took ${r.duration_ms}ms" (critical path ENDS here)`);
  console.log(`  optimization queued for background? ${r.optimization_queued}`);
  dumpStore("immediately after user served");
  if (thenLeave) {
    advance(300000); // user goes off and does other things for 5 min
    drainBackground("time passed since user left");
    dumpStore("after background finished — READY for next visit");
  }
  return r;
}

// ---- The story you described ----------------------------------------------
console.log("SCENARIO: first-ever timesheet (Angular/FastTrack), user leaves, comes back.");

// Visit 1: cold. "I'll try my best." Slow. User told how long. User leaves.
const v1 = visit("Angular #1 — first ever (cold)", { portal:"fasttrack", task:"timesheet", framework:"angular", week:"2026-08-03" });

// Visit 2: user returns. Runbook is ALREADY waiting. First warm invocation is fast.
const v2 = visit("Angular #2 — user returns (runbook waiting)", { portal:"fasttrack", task:"timesheet", framework:"angular", week:"2026-08-10" });

// Visit 3: clean warm again — nothing to optimize, no background work queued.
const v3 = visit("Angular #3 — steady state", { portal:"fasttrack", task:"timesheet", framework:"angular", week:"2026-08-17" });

// Visit 4: DOM drift — still succeeds, but slower; background re-optimizes for NEXT time.
const v4 = visit("Angular #4 — portal changed (drift)", { portal:"fasttrack", task:"timesheet", framework:"angular", week:"2026-08-24" }, { drift:true });

// Visit 5: user returns after drift — improved runbook already waiting, fast again.
const v5 = visit("Angular #5 — returns after re-optimize", { portal:"fasttrack", task:"timesheet", framework:"angular", week:"2026-08-31" });

console.log("\n=== SPEED SUMMARY (what the user actually waited) ===");
for (const [n, r] of [["#1 cold", v1],["#2 warm (was waiting)", v2],["#3 steady", v3],["#4 drift", v4],["#5 after re-opt", v5]])
  console.log(`  ${n.padEnd(24)} ${r.duration_ms}ms  ${r.optimization_queued ? "(bg optimize queued)" : ""}`);

console.log("\n=== VERDICT ===");
console.log("Run 1 cold+slow; user served + told duration; optimize happens AFTER they leave.");
console.log("Run 2 is fast on its FIRST warm call because the runbook was waiting — never");
console.log("earned by a second slow run. Drift re-optimizes in background for the next visit.");
