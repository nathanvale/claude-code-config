# metrics-effort — per-run savings → yearly human-effort story

Throwaway prototype for **browser-domain-memory**.

## Question

Why bother building this? A sibling prototype proved warm replay is ~9× faster
**per run** (`metrics-wallclock/`). But a per-run delta in seconds doesn't answer
"is it worth it?" — a human feels **time over a year**. This prototype translates
per-run savings into human terms: *"you'd have clicked N fields by hand, every
week, = X hours/year saved."*

It's pure rate arithmetic over an in-memory flow-profile table — no browser, no
network, no clocks. Deterministic.

## How to run

```bash
bun prototypes/browser-use-uplift/metrics-effort/effort.ts
```

Zero deps, pure TS. Retune the flow profiles + cost model via `FLOWS` and
`WEEKS_PER_YEAR` at the top of `effort.ts`.

## Cost model

Per flow: `manualSec` (human clicks through by hand: login + form + submit),
`autoSec` (warm replay), `manualOps` (clicks + keystroke-fields by hand per run),
`runsPerWeek` (cadence). Then:

- `savedPerRun  = manualSec − autoSec`
- `savedPerYear = savedPerRun × runsPerWeek × 52`
- `opsPerYear   = manualOps × runsPerWeek × 52`

Flows modeled (Nathan's actual recurring chores): weekly timesheet
(Oncore/FastTrack360), Xero bank reconciliation (fortnightly), monthly
admin/invoice.

## Caveats (read before quoting the headline)

- Manual & auto times are **ESTIMATES**, not measured wall-clock. Retune the table.
- **NOT counted:** setup cost — capturing each flow the first time (one-off).
- **NOT counted:** maintenance — re-capture when a site changes / self-heal fires.
- Savings assume each flow keeps running at its stated cadence all year.
- This is the **GROSS** ceiling. Real net = gross saved − setup − maintenance.

## Verdict

**Across 3 recurring chores you'd otherwise hand-click ~2388 fields/year — memory
replay buys back ~6.1h/year.** (actual run below)

```
Timesheet (Oncore/FastTrack360)   manual 4.0m → auto 0.4m   saves 3.6m/run   52 runs/yr   3.1h/yr
Xero bank reconciliation          manual 5.0m → auto 0.5m   saves 4.5m/run   26 runs/yr   1.9h/yr
Monthly admin / invoice           manual 6.0m → auto 0.6m   saves 5.4m/run   12 runs/yr   1.1h/yr

PORTFOLIO TOTAL
  manual ops avoided/yr: ~2388 clicks + keystrokes
  time saved/year      : 6.1h
```

Worth building. ~6.1h/year of repetitive clicking eliminated across a handful of
weekly/monthly chores. The recurring nature compounds — you pay capture once, save
every run. Even after setup + maintenance the GROSS ceiling stays clearly positive.

## Findings for browser-domain-memory

- **The value story is yearly, not per-run.** A 3.6-min saving sounds trivial; ×52
  weeks it's 3.1h from one flow alone. Lead with the yearly hours + ops figure,
  not the per-run delta — that's the number that justifies the build.
- **Cadence dominates the portfolio, not per-run size.** The monthly invoice saves
  the MOST per run (5.4m) but the LEAST per year (1.1h), because it runs 12×. The
  weekly timesheet saves less per run but most per year. Prioritize capturing
  **high-cadence** flows first — they compound fastest.
- **Effort framing lands harder than time.** "~2388 fields by hand per year" is more
  visceral than "6.1 hours." Keep both; the ops count is the gut-punch.
- **Honest ceiling, not a promise.** This is GROSS savings. Setup (capture once) and
  maintenance (re-capture on site change / heal) are real costs not modeled here —
  flagged prominently so the headline survives scrutiny. The recurring structure is
  what makes net stay positive: one-time costs amortize across every future run.
- **Implication:** the system's ROI rises with (a) cadence and (b) number of flows
  captured. A single weekly flow already pays; the more recurring chores onboarded,
  the steeper the yearly curve. Build for breadth of captured flows.
```
