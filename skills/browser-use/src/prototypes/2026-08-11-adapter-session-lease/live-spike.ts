// PROTOTYPE — THROWAWAY SPIKE. Not production. Delete freely.
//
// Question set (pre-build falsify, ICA candidates 1+2 — Adapter Session Lease):
//   Q1  continuity: a daemon session created by one CLI invocation still holds the
//       same live page instance in a SEPARATE invocation (per-run lease premise).
//   Q2  resume-after-hold: after an idle gap (simulated blocked→resume), a third
//       invocation still sees the same page instance.
//   Q3  scoped release: `close` with --session <owned> and NO --cdp removes exactly
//       the owned session — inventory back to baseline, foreign sessions untouched,
//       Warm Chrome listener PID stable, parseable {success:true} envelope.
//   Q4  planted regression (--planted): skipping the release must flip the absence
//       assertion to FAIL, proving Q3's pass can fire.
//
// Run:  bun skills/browser-use/src/prototypes/2026-08-11-adapter-session-lease/live-spike.ts
//       add --planted for the Q4 leak-visible variant (cleans up after itself).
//
// Safety: one unique owned session only; release is session-scoped named close;
// never `close --all`; the fixture opens in its own new tab and that tab is closed
// before release; existing sessions and tabs are never touched.

import { resolve } from "node:path";

const PLANTED = process.argv.includes("--planted");
const repoRoot = resolve(import.meta.dir, "../../../../..");
const OWNED = `lease-spike-${Date.now()}`;

type Cmd = { exitCode: number; stdout: string; stderr: string };

async function run(command: string[], cwd?: string): Promise<Cmd> {
	const p = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr] = await Promise.all([
		new Response(p.stdout).text(),
		new Response(p.stderr).text(),
	]);
	const exitCode = await p.exited;
	return { exitCode, stdout, stderr };
}

function say(label: string, detail: string) {
	console.log(`\n== ${label}\n   ${detail}`);
}

const results: { q: string; name: string; pass: boolean; detail: string }[] = [];
function verdict(q: string, name: string, pass: boolean, detail: string) {
	results.push({ q, name, pass, detail });
	console.log(`   ${pass ? "PASS" : "FAIL"}  [${q}] ${name} — ${detail}`);
}

// ---- 1. Attach through browser-connect (verified endpoint, never a guessed port)
say("attach", "browser-connect connect agent-browser --json");
const attach = await run(["bun", "run", "src/cli.ts", "connect", "agent-browser", "--json"], resolve(repoRoot, "runtime/browser-connect"));
if (attach.exitCode !== 0) {
	console.error("attach failed:", attach.stdout, attach.stderr);
	process.exit(2);
}
const envelope = JSON.parse(attach.stdout);
const ws: string = envelope.data.endpoint.ws;
const http: string = envelope.data.endpoint.http;
const ab: string = envelope.data.attachment.probe_executable;
const port = new URL(http).port;
say("envelope", `ws=${ws.slice(0, 40)}… executable=${ab.split("/").pop()} port=${port}`);

const abIn = (args: string[]) => run([ab, "--cdp", ws, "--session", OWNED, ...args, "--json"]);
const abOut = (args: string[]) => run([ab, ...args, "--json"]); // no --cdp — release side

async function sessions(): Promise<string[]> {
	const r = await abOut(["session", "list"]);
	return JSON.parse(r.stdout).data.sessions;
}
async function chromePid(): Promise<string> {
	const r = await run(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"]);
	return (r.stdout.match(/^p(\d+)/m) ?? [])[1] ?? "none";
}
async function pageCount(): Promise<number> {
	const list = (await (await fetch(`${http}/json/list`)).json()) as { type: string }[];
	return list.filter((t) => t.type === "page").length;
}

// ---- 2. Baseline
const baseSessions = await sessions();
const basePid = await chromePid();
const basePages = await pageCount();
say("baseline", `${baseSessions.length} sessions · chrome pid ${basePid} · ${basePages} page targets · owned name absent=${!baseSessions.includes(OWNED)}`);

// ---- 3. Serve the fixture over http (file:// is invisible to discovery filters)
const fixtureHtml = await Bun.file(resolve(import.meta.dir, "fixture.html")).text();
const server = Bun.serve({ port: 0, fetch: () => new Response(fixtureHtml, { headers: { "content-type": "text/html" } }) });
const fixtureUrl = `http://localhost:${server.port}/fixture.html`;
say("fixture", `served at ${fixtureUrl}`);

// ---- 4. Invocation A: create the session in ITS OWN new tab, load fixture, read probe
say("invocation A", `tab new + open (owned session ${OWNED})`);
await abIn(["tab", "new"]);
await abIn(["open", fixtureUrl]);
const evalProbe = async () => {
	const r = await abIn(["eval", "window.__leaseProbe"]);
	return (JSON.parse(r.stdout).data?.result ?? "").toString();
};
const probeA = await evalProbe();
const midSessions = await sessions();
say("state after A", `probe=${probeA} · sessions=${midSessions.length} · owned present=${midSessions.includes(OWNED)} · pages=${await pageCount()}`);

if (!PLANTED) {
	// ---- 5. Q1: separate invocation sees the same live page instance
	say("invocation B", "get url + eval probe (separate process, same session name)");
	const urlRaw = (await abIn(["get", "url"])).stdout;
	const urlJson = JSON.parse(urlRaw);
	const urlB = urlJson.data?.result ?? urlJson.data?.url ?? (typeof urlJson.data === "string" ? urlJson.data : "");
	const probeB = await evalProbe();
	say("state after B", `url=${urlB} · probe=${probeB} · raw=${urlRaw.slice(0, 120).trim()}`);
	verdict("Q1", "cross-invocation continuity", urlB === fixtureUrl && probeB === probeA && probeA.startsWith("alive-"), `probe A=${probeA} B=${probeB}, url match=${urlB === fixtureUrl}`);

	// ---- 6. Q2: hold (simulated blocked run), then resume in a third invocation
	say("hold", "5s idle — simulating a blocked run waiting on resume");
	await Bun.sleep(5000);
	const probeC = await evalProbe();
	say("state after C", `probe=${probeC}`);
	verdict("Q2", "resume-after-hold continuity", probeC === probeA, `probe A=${probeA} C=${probeC}`);

	// ---- 7. Q3: tidy own tab, then session-scoped named close WITHOUT --cdp
	say("release", "tab close (own tab only), then close --session <owned> --json — no --cdp");
	await abIn(["tab", "close"]);
	const close = await abOut(["--session", OWNED, "close"]);
	let closeOk = false;
	try { closeOk = JSON.parse(close.stdout).success === true && close.exitCode === 0; } catch {}
	// bounded re-read: inventory settles asynchronously
	let after: string[] = [];
	for (let i = 0; i < 6; i++) {
		after = await sessions();
		if (!after.includes(OWNED) && after.length === baseSessions.length) break;
		await Bun.sleep(1000);
	}
	const pidAfter = await chromePid();
	const pagesAfter = await pageCount();
	const foreignIntact = baseSessions.every((s) => after.includes(s));
	say("state after release", `sessions=${after.length} (baseline ${baseSessions.length}) · owned present=${after.includes(OWNED)} · chrome pid ${pidAfter} (baseline ${basePid}) · pages=${pagesAfter} (baseline ${basePages})`);
	verdict("Q3", "scoped release, no --cdp", closeOk && !after.includes(OWNED) && after.length === baseSessions.length && foreignIntact && pidAfter === basePid && pagesAfter === basePages, `close success=${closeOk}, owned absent=${!after.includes(OWNED)}, count ${after.length}/${baseSessions.length}, foreign intact=${foreignIntact}, pid stable=${pidAfter === basePid}, pages ${pagesAfter}/${basePages}`);
} else {
	// ---- Q4: planted regression — skip the release, absence assertion MUST fail
	say("planted", "release deliberately skipped — running the Q3 absence assertion anyway");
	const after = await sessions();
	const absent = !after.includes(OWNED) && after.length === baseSessions.length;
	say("state (leak visible)", `sessions=${after.length} (baseline ${baseSessions.length}) · owned present=${after.includes(OWNED)}`);
	verdict("Q4", "planted regression fires", !absent, `absence assertion evaluated ${absent ? "PASS (BAD — regression invisible)" : "FAIL as required (leak visible)"}`);
	// repair: clean up our own planted session by exact name, never anything else
	say("repair", "named close of the planted session only");
	await abIn(["tab", "close"]);
	await abOut(["--session", OWNED, "close"]);
	const repaired = await sessions();
	say("state after repair", `sessions=${repaired.length} (baseline ${baseSessions.length}) · owned present=${repaired.includes(OWNED)}`);
}

server.stop();

// ---- Verdict table
console.log("\n==== VERDICTS ====");
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.q}  ${r.name}\n      ${r.detail}`);
const allPass = results.every((r) => r.pass);
console.log(allPass ? "\nAll questions answered as expected." : "\nAt least one question failed — that failure IS the finding.");
process.exit(allPass ? 0 : 1);
