# parallel-spike — concurrent flow runs on one shared warm Chrome

> **Exploratory FUTURE spike, not a v1 capability.** We do NOT yet know that
> parallel/concurrent runs are safe. This models concurrency to PROVE OR DISPROVE
> it and surface the collision modes. The verdict below is "no true parallelism
> today; serialise for v1".

## Question

browser-domain-memory runs saved flows against ONE shared warm Chrome (real binary,
dedicated profile, single CDP debug port — see `docs/adr/0006`). One Chrome = one
cookie jar; agent-browser sessions on the SAME domain share cookies (no BrowserContext
isolation, `vercel-labs/agent-browser#1068`); one CDP driver has one active page/focus.

**Can two saved flows run concurrently and safely? If not, what collides?**

## How to run

```bash
bun prototypes/browser-use-uplift/parallel-spike/parallel-spike.ts
```

No browser, no real threads, no `Date.now()`/`Math.random()`. "Concurrency" is async
tasks interleaved on a fixed, index-varied schedule (deterministic). Shared resources
(`page.url`, `cookieJar`, `durableMemory`) are plain objects both runs mutate. Each
scenario runs WITHOUT a lock (collision) and WITH a lock/isolation (fix). Zero deps.

## Verdict

**Safe TODAY**

- **Serialise per domain** (per-domain mutex/queue): YES. Removes the same-domain
  interleave and the commit lost-update. Recommended v1 stance.
- **Different-domain concurrency** keeps cookie jars isolated, BUT one warm Chrome has
  one active page/focus and one CDP driver, so page actions still contend. For v1, treat
  "different domain" as "still serialise the driver" unless runs are isolated.

**NOT safe today**

- **Same-domain TRUE parallel on one shared Chrome: NO.** Shared page focus corrupts
  mid-flow; shared cookie jar (ADR-0006: no BrowserContext isolation) means two
  same-domain runs see each other's auth; commits race (last-writer-wins).

**What a real future spike must prove before claiming parallelism**

- Per-run BrowserContext isolation actually isolates page focus AND cookies (today it
  does not — `vercel-labs/agent-browser#1068`), OR
- N dedicated Chrome instances (separate `--user-data-dir` + debug ports), measuring cost
  (RAM, duplicated warm logins) vs the serialise baseline.
- Commit-lock: durable write per domain stays atomic + serialised regardless of the above.

**Recommended v1:** serialise per domain (one-at-a-time), single warm Chrome. Defer true
parallelism until an isolation spike proves per-run context isolation or N-Chrome cost.

## Findings for browser-domain-memory

From the actual run:

- **Scenario A, same domain, NO lock** — the manual run and the Friday auto-run interleave
  their fills on the one shared page (`Mon, Thu, Tue, Fri, Wed, SUBMIT` in commit order),
  then both commit: `friday` overwrites `manual` (`lost-update=true`). Final runbook =
  whoever committed last; the other run's capture is LOST. Same-domain concurrency on one
  shared Chrome is UNSAFE without isolation.
- **Scenario A, same domain, WITH per-domain lock** — runs go one-at-a-time: `manual`
  navigates → fills → commits, THEN `friday` starts. No interleaved fills; each commit is
  atomic (`clean=true`). The lock removes the collision.
- **Scenario B, different domains, NO lock** — cookie jars stay isolated (`acme` and `globex`
  sessions untouched by each other, `cookiesIsolated=true`). BUT the single active page/focus
  collides: `acmeRun` found itself acting on `globex.example/flow` mid-flow
  (`WRONG PAGE`, `wrongPage=true`). One CDP driver / one focused tab means actions still
  corrupt each other even across domains.
- **Scenario B, different domains, WITH per-run isolation** — each run owns its own page/focus
  (modelling separate BrowserContext / Chrome): no wrong-page corruption (`noWrongPage=true`),
  true parallel. Cost: a separate context/Chrome per run. Note the cookie-isolation gap that
  exists today — this only buys safety ACROSS domains, not same-domain.
- **Commit-lock mitigation** — even when runs race the durable write, a per-domain commit lock
  keeps each `BEGIN..END` uninterrupted (`no tear=true`). Last-writer-wins still applies, but
  the runbook is never half-one-run / half-other. Ties to the crash-safety commit boundary.
