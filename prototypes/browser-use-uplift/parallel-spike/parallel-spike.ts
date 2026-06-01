/**
 * QUESTION (EXPLORATORY SPIKE — NOT A SHIPPED CAPABILITY)
 * ------------------------------------------------------
 * browser-domain-memory runs saved flows against ONE shared warm Chrome (real
 * binary, dedicated profile, single CDP debug port — see docs/adr/0006). One
 * Chrome = one cookie jar; agent-browser sessions on the SAME domain share
 * cookies (no BrowserContext isolation); one CDP driver has one active page/focus.
 *
 * CAN two saved flows run CONCURRENTLY and safely? If not, WHAT collides?
 *
 * We do NOT know yet that parallel runs are safe. This spike PROVES OR DISPROVES
 * it in a model and surfaces the collision modes, so a real future spike knows
 * what to test. It is exploratory: the verdict may well be "no true parallelism
 * today; serialise for v1".
 *
 * No live browser, no real threads, no Date.now()/Math.random(). "Concurrency" is
 * modelled as async tasks whose actions interleave on a FIXED schedule (varied by
 * task index, deterministic). Shared resources (page.url, cookieJar, durableMemory)
 * are plain objects both runs mutate. We show each scenario WITHOUT a lock (the
 * collision) and WITH a lock/isolation (the fix). Pure TS, zero deps.
 * Run: bun parallel-spike.ts
 */

// ---- Shared "browser world" (one warm Chrome) ------------------------------

// ONE active page: a single CDP driver drives one focused tab at a time.
interface Page {
  url: string;
  formField: string; // what's currently typed into the active form
}

// Cookie jar keyed by domain. One Chrome = one jar; same-domain runs share an entry.
type CookieJar = Record<string, string>;

// Durable memory: the committed runbook per domain (the thing a future replay reads).
type DurableMemory = Record<string, { committedBy: string; steps: string[] }>;

interface World {
  page: Page;
  cookies: CookieJar;
  memory: DurableMemory;
  log: string[]; // interleaved event log — the evidence of who-did-what-when
}

function freshWorld(): World {
  return {
    page: { url: "about:blank", formField: "" },
    cookies: {},
    memory: {},
    log: [],
  };
}

// ---- Interleaving scheduler (deterministic, no randomness) -----------------

// A "run" is a list of steps. We interleave two runs by a fixed schedule that
// depends on task index: run 0 yields after each step, run 1 also yields, so the
// scheduler alternates them. This deterministically reproduces a real race where
// run B acts while run A is mid-flow.
async function yieldTurn(): Promise<void> {
  // microtask hop — lets the other pending task advance one step.
  await Promise.resolve();
}

interface RunSpec {
  runId: string;
  domain: string;
  fields: string[]; // values this run fills into the form, in order
}

// One run: navigate, fill each field, commit to durable memory. Yields between
// steps so a concurrently-scheduled run can interleave its own steps.
async function executeRun(world: World, spec: RunSpec): Promise<void> {
  const { runId, domain, fields } = spec;

  world.page.url = `https://${domain}/flow`;
  world.cookies[domain] = `session-${runId}`;
  world.log.push(`${runId}: navigate -> ${world.page.url} (cookie=${world.cookies[domain]})`);
  await yieldTurn();

  const captured: string[] = [];
  for (const value of fields) {
    // Read the SHARED page before writing — models a real driver reading the DOM.
    if (world.page.url !== `https://${domain}/flow`) {
      world.log.push(
        `${runId}: !! page is on ${world.page.url}, expected ${domain} — acting on WRONG PAGE`,
      );
    }
    world.page.formField = value;
    captured.push(world.page.formField);
    world.log.push(`${runId}: fill "${value}" (page.url=${world.page.url})`);
    await yieldTurn();
  }

  // Commit: read-modify-write durable memory for this domain (last-writer-wins).
  const existing = world.memory[domain];
  if (existing) {
    world.log.push(
      `${runId}: commit OVERWRITES existing runbook committed by ${existing.committedBy}`,
    );
  }
  world.memory[domain] = { committedBy: runId, steps: captured };
  world.log.push(`${runId}: commit durable memory for ${domain} -> [${captured.join(", ")}]`);
}

// ---- Mitigation 1: per-key mutex (a promise chain) -------------------------

class Mutex {
  private chains: Record<string, Promise<void>> = {};

  // Run `task` exclusively per key (e.g. per domain, or a single global key).
  async withLock(key: string, task: () => Promise<void>): Promise<void> {
    const prev = this.chains[key] ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    this.chains[key] = prev.then(() => next);
    await prev; // wait my turn
    try {
      await task();
    } finally {
      release();
    }
  }
}

// ---- Scenario drivers ------------------------------------------------------

function printLog(world: World): void {
  for (const line of world.log) console.log(`    ${line}`);
}

function describeMemory(world: World): void {
  for (const [domain, rb] of Object.entries(world.memory)) {
    console.log(`    durable[${domain}] committedBy=${rb.committedBy} steps=[${rb.steps.join(", ")}]`);
  }
}

// Scenario A — SAME domain, concurrent, NO lock. The Friday auto-run fires while
// a manual run is mid-fill. Both target acme.example.
async function scenarioA_noLock(): Promise<void> {
  console.log("\n=== Scenario A — SAME domain, concurrent, NO LOCK ===");
  console.log("    manual timesheet run + scheduled Friday auto-run, both on acme.example");
  const world = freshWorld();
  await Promise.all([
    executeRun(world, { runId: "manual", domain: "acme.example", fields: ["Mon=8h", "Tue=8h", "Wed=8h"] }),
    executeRun(world, { runId: "friday", domain: "acme.example", fields: ["Thu=8h", "Fri=8h", "SUBMIT"] }),
  ]);
  printLog(world);
  describeMemory(world);
  const rb = world.memory["acme.example"];
  const interleaved = world.log.some((l) => l.includes("WRONG PAGE")) === false; // same domain, same url
  const lostUpdate = world.log.some((l) => l.includes("OVERWRITES"));
  console.log(
    `    COLLISION: form fields from both runs interleaved on one page; commit lost-update=${lostUpdate}. ` +
      `Final runbook = whoever committed last (${rb.committedBy}) — the other run's capture is LOST.`,
  );
  void interleaved;
}

// Scenario A — SAME domain, WITH per-domain lock. Concurrent requests serialise.
async function scenarioA_withLock(): Promise<void> {
  console.log("\n=== Scenario A — SAME domain, WITH per-domain LOCK (serialise) ===");
  const world = freshWorld();
  const mutex = new Mutex();
  await Promise.all([
    mutex.withLock("acme.example", () =>
      executeRun(world, { runId: "manual", domain: "acme.example", fields: ["Mon=8h", "Tue=8h", "Wed=8h"] }),
    ),
    mutex.withLock("acme.example", () =>
      executeRun(world, { runId: "friday", domain: "acme.example", fields: ["Thu=8h", "Fri=8h", "SUBMIT"] }),
    ),
  ]);
  printLog(world);
  describeMemory(world);
  // With the lock, run 1 fully finishes before run 2 starts — no interleaving.
  const firstCommitIdx = world.log.findIndex((l) => l.includes("commit durable"));
  const secondNavIdx = world.log.findIndex((l, i) => i > firstCommitIdx && l.includes("navigate"));
  const clean = secondNavIdx > firstCommitIdx;
  console.log(
    `    FIXED: runs ran one-at-a-time (no interleaved fills). Each commit is atomic; ` +
      `second run starts only after first commits. clean=${clean}`,
  );
}

// Scenario B — DIFFERENT domains, concurrent, NO lock. Different cookie jars, but
// still ONE Chrome with one active page/focus.
async function scenarioB_noLock(): Promise<void> {
  console.log("\n=== Scenario B — DIFFERENT domains, concurrent, NO LOCK ===");
  console.log("    acme.example timesheet + globex.example expense report, one shared Chrome");
  const world = freshWorld();
  await Promise.all([
    executeRun(world, { runId: "acmeRun", domain: "acme.example", fields: ["Mon=8h", "Tue=8h"] }),
    executeRun(world, { runId: "globexRun", domain: "globex.example", fields: ["Lunch=$20", "Cab=$35"] }),
  ]);
  printLog(world);
  describeMemory(world);
  const cookiesIsolated =
    world.cookies["acme.example"] === "session-acmeRun" &&
    world.cookies["globex.example"] === "session-globexRun";
  const wrongPage = world.log.some((l) => l.includes("WRONG PAGE"));
  console.log(
    `    SAFE: cookie jars per domain stay isolated (acme & globex untouched by each other) = ${cookiesIsolated}.`,
  );
  console.log(
    `    STILL CONTENDS: single active page/focus — a run found itself on the wrong URL mid-flow = ${wrongPage}. ` +
      `One CDP driver / one focused tab means actions still corrupt each other even across domains.`,
  );
}

// Scenario B — DIFFERENT domains, WITH isolation (separate page per run). Models
// per-run BrowserContext / separate Chrome — true parallelism, higher cost.
async function scenarioB_isolated(): Promise<void> {
  console.log("\n=== Scenario B — DIFFERENT domains, WITH per-run ISOLATION (separate context) ===");
  // Each run gets its OWN world (own page/focus). Shared cookie/memory only where
  // domains differ, so no cross-domain corruption. Models N contexts/Chromes.
  const acme = freshWorld();
  const globex = freshWorld();
  await Promise.all([
    executeRun(acme, { runId: "acmeRun", domain: "acme.example", fields: ["Mon=8h", "Tue=8h"] }),
    executeRun(globex, { runId: "globexRun", domain: "globex.example", fields: ["Lunch=$20", "Cab=$35"] }),
  ]);
  const noWrongPage =
    !acme.log.some((l) => l.includes("WRONG PAGE")) && !globex.log.some((l) => l.includes("WRONG PAGE"));
  console.log("    acme context:");
  describeMemory(acme);
  console.log("    globex context:");
  describeMemory(globex);
  console.log(
    `    TRUE PARALLEL (modelled): each run owns its page/focus, no wrong-page corruption = ${noWrongPage}. ` +
      `COST: a separate BrowserContext / Chrome per run — and ADR-0006 notes same-domain cookie isolation ` +
      `does NOT exist today (sessions share cookies), so this only buys safety ACROSS domains.`,
  );
}

// Mitigation 3 — Commit-lock: even if page actions interleave, the durable write
// per domain must be atomic + serialised. Show a racing read-modify-write WITH a
// dedicated commit lock so no lost update / torn write occurs.
async function commitLockDemo(): Promise<void> {
  console.log("\n=== Mitigation — COMMIT-LOCK (atomic durable write per domain) ===");
  const world = freshWorld();
  const commitMutex = new Mutex();

  async function racingCommit(runId: string, steps: string[]): Promise<void> {
    await commitMutex.withLock("acme.example", async () => {
      const existing = world.memory["acme.example"];
      world.log.push(
        `${runId}: BEGIN commit (existing=${existing ? existing.committedBy : "none"})`,
      );
      await yieldTurn(); // window where a torn write could occur without the lock
      world.memory["acme.example"] = { committedBy: runId, steps };
      world.log.push(`${runId}: END commit -> [${steps.join(", ")}]`);
    });
  }

  await Promise.all([
    racingCommit("manual", ["Mon=8h", "Tue=8h"]),
    racingCommit("friday", ["Thu=8h", "Fri=8h"]),
  ]);
  printLog(world);
  describeMemory(world);
  // Under the lock, each BEGIN..END pair is uninterrupted — no interleaved tear.
  let torn = false;
  let inCommit: string | null = null;
  for (const line of world.log) {
    if (line.includes("BEGIN")) {
      const who = line.split(":")[0];
      if (inCommit && inCommit !== who) torn = true;
      inCommit = who;
    }
    if (line.includes("END")) inCommit = null;
  }
  console.log(
    `    Commits are serialised + atomic (no interleaved BEGIN/END tear = ${!torn}). ` +
      `Last writer still wins, but the runbook is never half-one-run / half-other.`,
  );
}

// ---- Verdict ---------------------------------------------------------------

function verdict(): void {
  console.log("\n================ HONEST VERDICT (exploratory) ================");
  console.log(
    [
      "Safe TODAY:",
      "  - SERIALISE per domain (a per-domain mutex/queue): YES. Removes the same-domain",
      "    interleave + commit lost-update. This is the recommended v1 stance.",
      "  - DIFFERENT-domain concurrency keeps cookie jars isolated, BUT one warm Chrome has",
      "    one active page/focus + one CDP driver, so page actions still contend. Treat",
      "    'different domain' as 'still serialise the driver' for v1 unless isolated.",
      "",
      "NOT safe today:",
      "  - SAME-domain TRUE parallel on one shared Chrome: NO. Shared page focus corrupts",
      "    mid-flow; shared cookie jar (ADR-0006: no BrowserContext isolation) means two",
      "    same-domain runs see each other's auth; commits race (last-writer-wins).",
      "",
      "What a real future spike must PROVE before claiming parallelism:",
      "  - Per-run BrowserContext isolation actually isolates page focus AND cookies",
      "    (today it does not — vercel-labs/agent-browser#1068), OR",
      "  - N dedicated Chrome instances (separate --user-data-dir + debug ports), measuring",
      "    cost (RAM, warm-login duplication) vs the serialise baseline.",
      "  - Commit-lock: durable write per domain stays atomic + serialised regardless.",
      "",
      "RECOMMENDED v1: serialise per domain (one-at-a-time), single warm Chrome. Defer true",
      "parallelism until an isolation spike proves per-run context isolation or N-Chrome cost.",
    ].join("\n"),
  );
}

// ---- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("browser-domain-memory — PARALLEL/CONCURRENCY SPIKE (exploratory, not v1)");
  await scenarioA_noLock();
  await scenarioA_withLock();
  await scenarioB_noLock();
  await scenarioB_isolated();
  await commitLockDemo();
  verdict();
}

await main();
