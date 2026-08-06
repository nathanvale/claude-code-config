// PROTOTYPE — throwaway. RUNBOOK STALENESS DETECTION + INVALIDATION POLICY.
//
// Question: per-step self-healing recovers when ONE selector drifts mid-run. But
// WHEN should the WHOLE runbook be invalidated and force-recaptured? A site
// redesign, or selectors slowly rotting across many runs, means the stored
// runbook is no longer trustworthy even if healing limps it through.
//
// This models that decision from Run Outcome HISTORY alone (no live browser).
// The thresholds + scoreRunbook() ARE the prototype: feed histories that go
// healthy -> degrading -> stale and show the verdict flips at the right line.
//
// Run: bun prototypes/browser-use-uplift/staleness/staleness.ts  (zero deps)

// ---- TUNABLE STALENESS POLICY (the contract) -------------------------------
const CONSECUTIVE_FAILURES_STALE = 2; // N failed runs in a row -> stale
const REDESIGN_FAIL_FRACTION = 0.8; // >= this fraction of steps drift in one run -> redesign -> stale
const HEAL_RATE_DEGRADING = 0.4; // recent mean heal-rate >= this -> degrading
const HEAL_RATE_STALE = 0.65; // recent mean heal-rate >= this -> stale (rot)
const RECENT_WINDOW = 3; // how many trailing runs define "recent" heal-rate
const STALE_AFTER_DAYS_NO_CLEAN = 30; // days since last CLEAN (zero-heal) success -> degrading

type Result = "success" | "failure";

interface RunOutcome {
  date: string; // ISO date of the run
  result: Result;
  totalSteps: number;
  stepsHealed: number; // steps that needed fallback / re-find this run
  driftedSelectors: string[]; // which selectors drifted this run
}

interface Runbook {
  id: string;
  domain: string;
  history: RunOutcome[]; // oldest -> newest
}

type Verdict = "healthy" | "degrading" | "stale";

interface Score {
  verdict: Verdict;
  reasons: string[];
}

const healRate = (r: RunOutcome) => (r.totalSteps ? r.stepsHealed / r.totalSteps : 0);
const TODAY = new Date("2026-05-31");
const daysBetween = (a: string, b: Date) =>
  Math.round((b.getTime() - new Date(a).getTime()) / 86_400_000);

// ---- THE POLICY ------------------------------------------------------------
// Verdict precedence: stale signals win over degrading, degrading over healthy.
function scoreRunbook(rb: Runbook): Score {
  const h = rb.history;
  const reasons: string[] = [];
  let verdict: Verdict = "healthy";
  const bump = (v: Verdict) => {
    const rank = { healthy: 0, degrading: 1, stale: 2 } as const;
    if (rank[v] > rank[verdict]) verdict = v;
  };

  // 1. catastrophic single run = site redesign -> stale, recapture from scratch.
  const last = h[h.length - 1];
  const lastDrift = last.totalSteps ? last.driftedSelectors.length / last.totalSteps : 0;
  if (last.result === "failure" && lastDrift >= REDESIGN_FAIL_FRACTION) {
    bump("stale");
    reasons.push(
      `redesign: last run drifted ${Math.round(lastDrift * 100)}% of selectors (>= ${REDESIGN_FAIL_FRACTION * 100}%)`,
    );
  }

  // 2. consecutive failures from the newest end -> stale.
  let consec = 0;
  for (let i = h.length - 1; i >= 0 && h[i].result === "failure"; i--) consec++;
  if (consec >= CONSECUTIVE_FAILURES_STALE) {
    bump("stale");
    reasons.push(`${consec} consecutive failed runs (>= ${CONSECUTIVE_FAILURES_STALE})`);
  }

  // 3. rising heal-rate over the recent window -> rot. High = stale, mid = degrading.
  const recent = h.slice(-RECENT_WINDOW);
  const meanHeal = recent.reduce((s, r) => s + healRate(r), 0) / recent.length;
  if (meanHeal >= HEAL_RATE_STALE) {
    bump("stale");
    reasons.push(`recent heal-rate ${meanHeal.toFixed(2)} (>= ${HEAL_RATE_STALE}) — selectors rotting`);
  } else if (meanHeal >= HEAL_RATE_DEGRADING) {
    bump("degrading");
    reasons.push(`recent heal-rate ${meanHeal.toFixed(2)} (>= ${HEAL_RATE_DEGRADING}) — re-verify proactively`);
  }

  // 4. stale-by-age: no fully clean (zero-heal) success in a long time -> degrading.
  const lastClean = [...h].reverse().find((r) => r.result === "success" && r.stepsHealed === 0);
  const age = lastClean ? daysBetween(lastClean.date, TODAY) : daysBetween(h[0].date, TODAY);
  if (age >= STALE_AFTER_DAYS_NO_CLEAN) {
    bump("degrading");
    reasons.push(
      lastClean
        ? `${age}d since last clean run (>= ${STALE_AFTER_DAYS_NO_CLEAN}d)`
        : `never had a clean run; ${age}d of history`,
    );
  }

  if (!reasons.length) reasons.push("clean recent history, healthy heal-rate");
  return { verdict, reasons };
}

// ---- FIXTURES: four runbooks, four trajectories ----------------------------
const run = (
  date: string,
  result: Result,
  totalSteps: number,
  drifted: string[],
): RunOutcome => ({ date, result, totalSteps, stepsHealed: drifted.length, driftedSelectors: drifted });

const RUNBOOKS: Runbook[] = [
  {
    id: "furdo-booking",
    domain: "book.squareup.com",
    history: [
      run("2026-05-25", "success", 5, []),
      run("2026-05-28", "success", 5, []),
      run("2026-05-31", "success", 5, ["#service-id"]), // one heal, recovered fine
    ],
  },
  {
    id: "cinema-tickets",
    domain: "classiccinemas.com.au",
    // heal-rate creeping up run over run — classic slow rot, not dead yet.
    history: [
      run("2026-05-08", "success", 6, []),
      run("2026-05-18", "success", 6, ["#seat-map", ".date-pick"]),
      run("2026-05-25", "success", 6, ["#seat-map", ".date-pick", "button.next"]),
      run("2026-05-31", "success", 6, ["#seat-map", ".date-pick", "button.next"]), // recent mean 0.44
    ],
  },
  {
    id: "portal-invoices",
    domain: "billing.acme.com",
    // chugged along, then a redesign run torches most selectors in one go.
    history: [
      run("2026-05-12", "success", 5, []),
      run("2026-05-22", "success", 5, [".amount"]),
      run("2026-05-31", "failure", 5, [".amount", "#pay-btn", ".row", "#total", "nav a"]), // 5/5 drift
    ],
  },
  {
    id: "council-rates",
    domain: "rates.council.vic.gov.au",
    // limps through with heals, then just stops working — back-to-back failures.
    history: [
      run("2026-05-15", "success", 4, ["#login"]),
      run("2026-05-25", "success", 4, ["#login", ".acct"]),
      run("2026-05-29", "failure", 4, ["#login", ".acct", "#submit"]),
      run("2026-05-31", "failure", 4, ["#login", ".acct"]),
    ],
  },
];

// ---- REPORT ----------------------------------------------------------------
const ICON: Record<Verdict, string> = { healthy: "✓", degrading: "⚠", stale: "✗" };
const log = (m = "") => console.log(m);

log("=== RUNBOOK STALENESS POLICY ===");
log(
  `thresholds: consecFail>=${CONSECUTIVE_FAILURES_STALE} stale | healRate>=${HEAL_RATE_DEGRADING} degrading, >=${HEAL_RATE_STALE} stale | redesign>=${REDESIGN_FAIL_FRACTION * 100}% drift stale | age>=${STALE_AFTER_DAYS_NO_CLEAN}d degrading\n`,
);

const verdicts: { rb: Runbook; score: Score }[] = [];
for (const rb of RUNBOOKS) {
  const score = scoreRunbook(rb);
  verdicts.push({ rb, score });
  log(`${ICON[score.verdict]} ${rb.id}  (${rb.domain})  ->  ${score.verdict.toUpperCase()}`);
  for (const r of rb.history) {
    const hr = healRate(r);
    log(
      `    ${r.date}  ${r.result === "success" ? "ok  " : "FAIL"}  heal ${r.stepsHealed}/${r.totalSteps} (${hr.toFixed(2)})  drift: [${r.driftedSelectors.join(", ") || "—"}]`,
    );
  }
  for (const reason of score.reasons) log(`    -> ${reason}`);
  log();
}

// ---- FINAL TABLE -----------------------------------------------------------
log("=== VERDICT TABLE ===");
log("verdict     runbook              action");
const ACTION: Record<Verdict, string> = {
  healthy: "keep using",
  degrading: "re-verify proactively next run",
  stale: "invalidate + force full recapture",
};
for (const { rb, score } of verdicts) {
  log(
    `${ICON[score.verdict]} ${score.verdict.padEnd(9)} ${rb.id.padEnd(20)} ${ACTION[score.verdict]}`,
  );
}
