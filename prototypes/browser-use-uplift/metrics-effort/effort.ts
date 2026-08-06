/**
 * QUESTION: Why bother building browser-domain-memory? A sibling prototype proved
 * warm replay is ~9× faster PER RUN (metrics-wallclock). But a per-run delta in
 * seconds doesn't answer "is this worth it?" — a human feels TIME OVER A YEAR.
 *
 * This proves the VALUE STORY: translate per-run savings into human terms —
 * "you'd have clicked N fields by hand, every week, = X hours/year saved."
 *
 * MODEL (pure rate arithmetic, no clocks):
 *   per run:   savedPerRun  = manualSec - autoSec
 *   per week:  savedPerWeek = savedPerRun × runsPerWeek
 *   per year:  savedPerYear = savedPerWeek × WEEKS_PER_YEAR
 *   effort:    clicks/keystrokes a human performs by hand each run, × runs/year
 *
 * Times are ESTIMATES of human effort (login + form + submit by hand) vs warm
 * replay (automated). They are NOT measured — see CAVEATS. The flow table and
 * the cost model are the core: named, retunable, deterministic.
 */

const WEEKS_PER_YEAR = 52;

// ---- Flow profile table (ESTIMATES — retune here) ----
// manualSec  : how long a human takes clicking through it by hand (login+form+submit)
// autoSec    : warm replay time (from metrics-wallclock: discovery skipped)
// manualOps  : clicks + keystroke-fields a human performs by hand per run
// runsPerWeek: cadence (weekly=1, fortnightly=0.5, monthly≈0.23)
type Flow = {
  name: string;
  manualSec: number;
  autoSec: number;
  manualOps: number;
  runsPerWeek: number;
};

const FLOWS: Flow[] = [
  {
    name: "Timesheet (Oncore/FastTrack360)",
    manualSec: 240, // ~4 min: login + navigate + fill week + submit
    autoSec: 25, // warm replay
    manualOps: 28, // login fields + 5 days hours + nav clicks + submit
    runsPerWeek: 1, // weekly
  },
  {
    name: "Xero bank reconciliation",
    manualSec: 300, // ~5 min: login + open recon + match/confirm lines
    autoSec: 30,
    manualOps: 22, // login + per-line match/OK clicks
    runsPerWeek: 0.5, // fortnightly
  },
  {
    name: "Monthly admin / invoice",
    manualSec: 360, // ~6 min: login + build invoice + send
    autoSec: 35,
    manualOps: 30, // login + line items + amounts + send
    runsPerWeek: 12 / WEEKS_PER_YEAR, // monthly ≈ 0.23/wk
  },
];

type Row = {
  flow: Flow;
  savedPerRunSec: number;
  runsPerYear: number;
  opsPerYear: number;
  savedPerWeekSec: number;
  savedPerYearSec: number;
};

function compute(flow: Flow): Row {
  const savedPerRunSec = flow.manualSec - flow.autoSec;
  const runsPerYear = flow.runsPerWeek * WEEKS_PER_YEAR;
  return {
    flow,
    savedPerRunSec,
    runsPerYear,
    opsPerYear: flow.manualOps * runsPerYear,
    savedPerWeekSec: savedPerRunSec * flow.runsPerWeek,
    savedPerYearSec: savedPerRunSec * runsPerYear,
  };
}

function mins(sec: number): string {
  return `${(sec / 60).toFixed(1)}m`;
}
function hours(sec: number): string {
  return `${(sec / 3600).toFixed(1)}h`;
}

function printFlow(r: Row): void {
  const f = r.flow;
  console.log(`\n  ${f.name}`);
  console.log(
    `    manual ${mins(f.manualSec).padStart(6)}/run  vs  auto ${mins(f.autoSec).padStart(5)}/run  →  saves ${mins(r.savedPerRunSec).padStart(6)}/run`,
  );
  console.log(
    `    cadence ${r.runsPerYear.toFixed(0).padStart(3)} runs/yr  ·  by hand ${f.manualOps} ops/run = ~${r.opsPerYear.toFixed(0)} clicks+keystrokes/yr avoided`,
  );
  console.log(
    `    saved/week ${mins(r.savedPerWeekSec).padStart(6)}  ·  saved/year ${hours(r.savedPerYearSec).padStart(6)}`,
  );
  console.log(
    `    → you'd fill ~${f.manualOps} fields by hand ${r.runsPerYear.toFixed(0)}×/year = ~${hours(r.savedPerYearSec)} of clicking saved`,
  );
}

function main(): void {
  console.log("=".repeat(70));
  console.log("BROWSER-DOMAIN-MEMORY — effort saved: per-run delta → yearly human story");
  console.log("=".repeat(70));
  console.log(`weeks/year: ${WEEKS_PER_YEAR}  ·  times are ESTIMATES of human effort, not measurements (see CAVEATS)`);

  const rows = FLOWS.map(compute);
  for (const r of rows) printFlow(r);

  // ---- Portfolio total: the "why bother" headline ----
  let totalSavedYearSec = 0;
  let totalOpsYear = 0;
  for (const r of rows) {
    totalSavedYearSec += r.savedPerYearSec;
    totalOpsYear += r.opsPerYear;
  }

  console.log("\n" + "=".repeat(70));
  console.log("PORTFOLIO TOTAL (all recurring flows)");
  console.log("=".repeat(70));
  console.log(`  flows                : ${rows.length}`);
  console.log(`  manual ops avoided/yr: ~${totalOpsYear.toFixed(0)} clicks + keystrokes`);
  console.log(`  time saved/year      : ${hours(totalSavedYearSec)}  (${mins(totalSavedYearSec)})`);
  console.log(
    `\n  HEADLINE: across ${rows.length} recurring chores you'd otherwise hand-click ~${totalOpsYear.toFixed(0)} fields/year — ` +
      `memory replay buys back ~${hours(totalSavedYearSec)}/year.`,
  );

  console.log("\nCAVEATS (so this doesn't oversell)");
  console.log("  · Manual & auto times are ESTIMATES, not measured wall-clock. Retune the table.");
  console.log("  · NOT counted: setup cost — capturing each flow the first time (one-off, ~minutes).");
  console.log("  · NOT counted: maintenance — re-capture when a site changes / self-heal fires.");
  console.log("  · Savings assume the flow keeps running at the stated cadence all year.");
  console.log("  · Real net = gross saved − setup − maintenance. This is the GROSS, optimistic ceiling.");

  console.log("\nVERDICT");
  const verdict =
    totalSavedYearSec / 3600 >= 2
      ? `Worth building. ~${hours(totalSavedYearSec)}/year of repetitive clicking eliminated across a handful of ` +
        `weekly/monthly chores. Even after setup + maintenance, the recurring nature compounds — you pay capture once, save every run.`
      : `Marginal at this portfolio. The yearly saving is small; add more recurring flows or higher-cadence chores before building.`;
  console.log(`  ${verdict}`);
}

main();
