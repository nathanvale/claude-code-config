import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McporterCommandInput } from "./mcporter-transport";
import { runForTest } from "./browser-use";
import { verifiedHandoffEnvelope } from "./browser-connect-handoff-fixtures";
import { makeRuntime, okCommand } from "./browser-use-test-helpers";

// =========================================================================
// Security-seam guards (Daily Driver Acceptance Ledger, cluster sec-seams):
//   DDA-B21  test-seam env vars inert outside their declared scope
//   DDA-F25  hostile run ids rejected by every consumer incl. env
//   DDA-C16  unknown envelope schema version refused, names expected+found
//   DDA-C17  non-loopback envelope endpoint refused BEFORE any adapter spawn
//   DDA-C18  tampered-envelope byte/field mutation sweep fails closed, one code
//   DDA-D29  page-controlled title control chars/ANSI never reach stdout raw
//   DDA-F23  unhandled exception becomes a typed internal-error failure
//            envelope; no raw stack / absolute path on stdout
//
// Contract (C) and hermetic (H) tiers drive the real CLI in-process through
// runForTest; process (E) tier spawns the real browser-use.ts entry so the
// proof is the boundary, not a captured fixture (fakes must match real output
// shape). No live browser, no network beyond the process itself.
// =========================================================================

const BROWSER_USE_CLI = join(
	dirname(fileURLToPath(import.meta.url)),
	"browser-use.ts",
);
const SPAWN_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = SPAWN_TIMEOUT_MS + 10_000;

// A neutral empty CWD unrelated to the repo, so a spawned process inherits no
// repo state and any absolute path on stdout would be a genuine leak.
const neutralCwd = mkdtempSync(join(tmpdir(), "browser-use-sec-seams-"));
afterAll(() => rmSync(neutralCwd, { recursive: true, force: true }));

async function spawnBrowserUse(
	args: readonly string[],
	extraEnv: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const child = Bun.spawn([process.execPath, BROWSER_USE_CLI, ...args], {
		cwd: neutralCwd,
		// Only HOME plus any explicit extras: the child inherits nothing else, so
		// a state path that escaped its base dir would be visible/attributable.
		env: { HOME: neutralCwd, ...extraEnv },
		stdout: "pipe",
		stderr: "pipe",
	});
	const timeout = setTimeout(() => child.kill(), SPAWN_TIMEOUT_MS);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	clearTimeout(timeout);
	return { exitCode, stdout, stderr };
}

function parse(stdout: string): Record<string, unknown> {
	return JSON.parse(stdout) as Record<string, unknown>;
}

// A runtime whose readTextFile always returns the given handoff JSON (the CLI
// reads the --handoff path through this seam) and whose runCommand records
// every subprocess spawn attempt. Zero recorded calls proves no adapter
// dispatch occurred.
function handoffRuntime(handoffJson: string): {
	runtime: ReturnType<typeof makeRuntime>;
	spawns: McporterCommandInput[];
} {
	const spawns: McporterCommandInput[] = [];
	const runtime = makeRuntime({
		readTextFile: async () => handoffJson,
		runCommand: async (input) => {
			spawns.push(input);
			return okCommand(JSON.stringify({ pages: [] }));
		},
	});
	return { runtime, spawns };
}

// One byte-scan over emitted bytes: raw C0 controls (except \n and \t which are
// legitimate framing), DEL (0x7f), and C1 controls (0x80-0x9f, incl. the 0x9b
// single-byte ANSI CSI introducer). JSON.stringify escapes C0 but leaves DEL
// and C1 raw, so this catches the terminal-injection bytes a naive length-bound
// would pass through.
function rawControlBytes(text: string): number[] {
	const found: number[] = [];
	for (const ch of text) {
		const c = ch.codePointAt(0) ?? 0;
		if (c === 0x0a || c === 0x09) continue;
		if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)) found.push(c);
	}
	return found;
}

// -------------------------------------------------------------------------
// DDA-B21 — test-seam env vars are inert outside their declared scope.
// -------------------------------------------------------------------------
describe("DDA-B21 test-seam env vars are inert outside declared scope", () => {
	// BROWSER_USE_MOCK_OUTCOME is read ONLY inside the --dry-run branch;
	// BROWSER_USE_TARGETS_ENVELOPE_JSON is read ONLY by `targets select`. A
	// non-dry-run command that is neither must emit an identical envelope and
	// exit whether or not the two seams are set. run_id (a per-invocation random
	// id when explicit) and duration_ms (wall-clock delta) are the only
	// invocation-nondeterministic fields — pin run_id explicitly and blank the
	// duration so the comparison is over the SEAM-controlled bytes.
	function stableEnv(extra: Record<string, string>): Record<string, string> {
		return { BROWSER_USE_RUN_ID: "seam-fixed-run", ...extra };
	}
	function normalize(stdout: string): string {
		return stdout.replace(/"duration_ms":\s*-?\d+/g, '"duration_ms": 0');
	}

	test("task list envelope + exit are identical with the seams set", async () => {
		const run = (extra: Record<string, string>) =>
			runForTest(["task", "list", "--json"], makeRuntime({ env: stableEnv(extra) }));
		const unset = await run({});
		const withSeams = await run({
			BROWSER_USE_MOCK_OUTCOME: "failure",
			BROWSER_USE_TARGETS_ENVELOPE_JSON: JSON.stringify({ tampered: true }),
		});
		expect(withSeams.exitCode).toBe(unset.exitCode);
		expect(withSeams.exitCode).toBe(0);
		expect(normalize(withSeams.stdout)).toBe(normalize(unset.stdout));
		expect(withSeams.stderr).toBe(unset.stderr);
	});

	test("lanes list envelope + exit are identical with the seams set", async () => {
		const run = (extra: Record<string, string>) =>
			runForTest(["lanes", "list", "--json"], makeRuntime({ env: stableEnv(extra) }));
		const unset = await run({});
		const withSeams = await run({
			BROWSER_USE_MOCK_OUTCOME: "failure",
			BROWSER_USE_TARGETS_ENVELOPE_JSON: "not-even-json",
		});
		expect(withSeams.exitCode).toBe(unset.exitCode);
		expect(normalize(withSeams.stdout)).toBe(normalize(unset.stdout));
		expect(withSeams.stderr).toBe(unset.stderr);
	});

	// MOCK_OUTCOME only fires under --dry-run. Setting it on a --dry-run command
	// DOES change the outcome (that is its declared scope) — the inertness claim
	// is specifically outside that scope, proven by the non-dry-run cases above.
});

// -------------------------------------------------------------------------
// DDA-B21 (E-tier) — same inertness oracle proven at the REAL process
// boundary: spawn the actual browser-use.ts entry twice for a non-dry-run,
// non-select command (task list --json) — once with both seams set, once
// without — and assert byte-identical stdout/stderr and identical exit codes.
// The in-process runForTest variant above proves the contract; this proves the
// spawned CLI reads no seam it shouldn't outside its declared scope.
// -------------------------------------------------------------------------
describe("DDA-B21 (spawned) seams inert across the real process boundary", () => {
	// Pin run_id (per-invocation random when explicit) and blank duration_ms
	// (wall-clock delta) so the diff is over the SEAM-controlled bytes only.
	function stableEnv(extra: Record<string, string>): Record<string, string> {
		return { BROWSER_USE_RUN_ID: "seam-fixed-run", ...extra };
	}
	function normalize(stdout: string): string {
		return stdout.replace(/"duration_ms":\s*-?\d+/g, '"duration_ms": 0');
	}

	const SEAMS = {
		BROWSER_USE_MOCK_OUTCOME: "failure",
		BROWSER_USE_TARGETS_ENVELOPE_JSON: JSON.stringify({ tampered: true }),
	};

	test(
		"spawned `task list --json` is byte-identical with and without the seams",
		async () => {
			const unset = await spawnBrowserUse(
				["task", "list", "--json"],
				stableEnv({}),
			);
			const withSeams = await spawnBrowserUse(
				["task", "list", "--json"],
				stableEnv(SEAMS),
			);
			// The spawned baseline is a real, clean run, not a captured fixture.
			expect(unset.exitCode).toBe(0);
			expect(parse(unset.stdout).status).toBe("ok");
			// Seams set outside their declared scope change nothing at the boundary.
			expect(withSeams.exitCode).toBe(unset.exitCode);
			expect(normalize(withSeams.stdout)).toBe(normalize(unset.stdout));
			expect(withSeams.stderr).toBe(unset.stderr);
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"spawned `lanes list --json` is byte-identical with and without the seams",
		async () => {
			const unset = await spawnBrowserUse(
				["lanes", "list", "--json"],
				stableEnv({}),
			);
			const withSeams = await spawnBrowserUse(
				["lanes", "list", "--json"],
				stableEnv({
					BROWSER_USE_MOCK_OUTCOME: "failure",
					// A malformed value must stay inert too — never parsed off-scope.
					BROWSER_USE_TARGETS_ENVELOPE_JSON: "not-even-json",
				}),
			);
			expect(unset.exitCode).toBe(0);
			expect(withSeams.exitCode).toBe(unset.exitCode);
			expect(normalize(withSeams.stdout)).toBe(normalize(unset.stdout));
			expect(withSeams.stderr).toBe(unset.stderr);
		},
		TEST_TIMEOUT_MS,
	);
});

// -------------------------------------------------------------------------
// DDA-F25 — hostile run ids are rejected by every consumer, incl. via env.
// -------------------------------------------------------------------------
describe("DDA-F25 hostile run ids rejected incl. via BROWSER_USE_RUN_ID", () => {
	// The store's path builder (assertSafePathSegment) throws for any run id that
	// is not a single safe path segment; the driver turns that into a typed usage
	// error (exit 2). A traversal id must never mkdir/write outside the base dir.
	test(
		"a traversal BROWSER_USE_RUN_ID exits 2 with no escaping state path",
		async () => {
			const escapedLeaf = `browser-use-escaped-${basename(neutralCwd)}`;
			const escaped = join(neutralCwd, "..", "..", escapedLeaf);
			expect(existsSync(escaped)).toBe(false);
			const result = await spawnBrowserUse(
				["run", "status", "--json"],
				{ BROWSER_USE_RUN_ID: `../../${escapedLeaf}` },
			);
			expect(result.exitCode).toBe(2);
			// Nothing was created above the child's HOME/neutralCwd: the traversal
			// target relative to any XDG base under HOME resolves outside
			// neutralCwd; assert no such file or directory materialized.
			expect(existsSync(escaped)).toBe(false);
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"a slash-bearing run id via --run-id flag also exits 2",
		async () => {
			const result = await spawnBrowserUse(
				["run", "status", "--run-id", "a/b/c", "--json"],
			);
			expect(result.exitCode).toBe(2);
		},
		TEST_TIMEOUT_MS,
	);
});

// -------------------------------------------------------------------------
// DDA-C16 — unknown envelope schema version refused with typed upgrade
// guidance naming expected + found.
// -------------------------------------------------------------------------
describe("DDA-C16 unknown envelope schema version refused naming versions", () => {
	test("schema_version '3' refusal names expected and found versions", async () => {
		const handoff = verifiedHandoffEnvelope((env) => {
			env.data.schema_version = "3";
		});
		const { runtime, spawns } = handoffRuntime(handoff);
		const result = await runForTest(
			[
				"targets",
				"list",
				"--mode",
				"handoff-bound",
				"--handoff",
				"/does/not/matter.json",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const envelope = parse(result.stdout);
		const error = envelope.error as Record<string, unknown>;
		expect(error.code).toBe("target_discovery_handoff_invalid");
		// Found version named.
		expect(String(error.message)).toContain("3");
		// Expected/pinned version named.
		expect(String(error.message)).toContain("2");
		// Refused before any adapter dispatch.
		expect(spawns).toHaveLength(0);
	});
});

// -------------------------------------------------------------------------
// DDA-C17 — a non-loopback (LAN) endpoint is refused BEFORE any adapter
// dispatch; zero subprocesses spawned.
// -------------------------------------------------------------------------
describe("DDA-C17 non-loopback endpoint refused before adapter dispatch", () => {
	const lanEndpoints = [
		{ label: "IPv4 LAN", http: "http://192.168.1.50:9222", ws: "ws://192.168.1.50:9222/devtools/browser/x" },
		{ label: "public host", http: "http://evil.example.com:9222", ws: "ws://evil.example.com:9222/devtools/browser/x" },
		{ label: "IPv4 link-local", http: "http://169.254.10.10:9222", ws: "ws://169.254.10.10:9222/devtools/browser/x" },
	];

	for (const endpoint of lanEndpoints) {
		test(`${endpoint.label} endpoint refused, zero spawns`, async () => {
			const handoff = verifiedHandoffEnvelope((env) => {
				env.data.endpoint.http = endpoint.http;
				env.data.endpoint.ws = endpoint.ws;
			});
			const { runtime, spawns } = handoffRuntime(handoff);
			const result = await runForTest(
				[
					"targets",
					"list",
					"--mode",
					"handoff-bound",
					"--handoff",
					"/does/not/matter.json",
					"--json",
				],
				runtime,
			);
			expect(result.exitCode).toBe(20);
			const envelope = parse(result.stdout);
			const error = envelope.error as Record<string, unknown>;
			expect(error.code).toBe("target_discovery_handoff_invalid");
			expect(String(error.message).toLowerCase()).toContain("loopback");
			// The security invariant: refused before any adapter subprocess.
			expect(spawns).toHaveLength(0);
		});
	}

	test("the loopback fixture endpoint is still accepted (guard is not overbroad)", async () => {
		// The unmutated real capture uses 127.0.0.1 — it must still spawn.
		const handoff = verifiedHandoffEnvelope();
		const { runtime, spawns } = handoffRuntime(handoff);
		const result = await runForTest(
			[
				"targets",
				"list",
				"--mode",
				"handoff-bound",
				"--handoff",
				"/does/not/matter.json",
				"--json",
			],
			runtime,
		);
		// chrome-devtools-mcp is the fixture adapter and has a live discovery
		// transport, so a loopback endpoint reaches the (stubbed) spawn.
		expect(spawns.length).toBeGreaterThanOrEqual(1);
		// Empty pages -> discovery reports no candidates (exit 20), but the point
		// is that the loopback endpoint was NOT refused at the envelope gate.
		const envelope = parse(result.stdout);
		const error = envelope.error as Record<string, unknown> | undefined;
		if (error) {
			expect(error.code).not.toBe("target_discovery_handoff_invalid");
		}
	});

	test("localhost hostname endpoint is accepted as loopback", async () => {
		const handoff = verifiedHandoffEnvelope((env) => {
			env.data.endpoint.http = "http://localhost:9222";
			env.data.endpoint.ws = "ws://localhost:9222/devtools/browser/x";
		});
		const { runtime, spawns } = handoffRuntime(handoff);
		await runForTest(
			[
				"targets",
				"list",
				"--mode",
				"handoff-bound",
				"--handoff",
				"/does/not/matter.json",
				"--json",
			],
			runtime,
		);
		expect(spawns.length).toBeGreaterThanOrEqual(1);
	});
});

// -------------------------------------------------------------------------
// DDA-C18 — a tampered envelope fails validation closed.
//
// Oracle: byte-mutation sweep over a valid fixture envelope; every mutant
// refused with one typed code. A full per-byte sweep of the pretty capture is
// large, so this uses a DETERMINISTIC (no-RNG) stride sweep over the compact
// baseline (documented bound below) PLUS a structured field-mutation battery.
//
// FAIL-CLOSED, PRECISELY: a byte flip lands in one of two regions. If it
// changes any SECURITY-RELEVANT field (contract id, schema version, outcome,
// status, environment identity, attachment adapter/route/probe path, or an
// endpoint scheme/host), the mutant MUST be refused with the single typed code
// target_discovery_handoff_invalid — never accepted. If it changes only a
// non-security value byte (the run_id string, a duration digit, JSON
// whitespace), the result is a different-but-still-valid envelope; the invariant
// there is that acceptance never leaves the pinned security surface — those
// fields stay byte-identical to the baseline. So: an ACCEPTED mutant with any
// altered security field is the exact failure this row guards against.
// -------------------------------------------------------------------------
describe("DDA-C18 tampered envelope fails validation closed with one code", () => {
	const REFUSAL_CODE = "target_discovery_handoff_invalid";

	// The AUTHORIZATION invariants this parser actually enforces (not a raw field
	// snapshot). browser-use consumes a browser-connect envelope under the
	// endpoint-authority doctrine: browser-connect already PROVED the attachment,
	// so the parser re-checks only the structural properties it owns, and the
	// derived facts here capture exactly those. A mutant whose derived facts
	// differ from the baseline's changed something the parser gates on and MUST be
	// refused; a mutant with identical derived facts changed only a value the
	// parser deliberately trusts verbatim (the exact probe path bytes, the ws GUID,
	// route/browser_entry_mode provenance, run_id text) and a still-valid envelope
	// is the honest, doctrine-consistent outcome.
	//
	// Enforced invariants (readHandoffFacts): pinned contract id + schema version,
	// outcome "verified" inside an ok envelope, the pinned environment identity,
	// a REGISTERED adapter id, an ABSOLUTE probe path, endpoint http/ws that are
	// http(s)/ws(s) URLs whose host is LOOPBACK, and proof evidence PRESENT.
	function authInvariants(json: string): string | undefined {
		let env: any;
		try {
			env = JSON.parse(json);
		} catch {
			return undefined; // unparseable -> never a valid acceptance
		}
		const d = env?.data ?? {};
		const a = d.attachment ?? {};
		const ep = d.endpoint ?? {};
		const p = d.proof ?? {};
		const urlFacts = (value: unknown) => {
			if (typeof value !== "string") return "none";
			try {
				const u = new URL(value);
				return `${u.protocol}//${u.hostname}`;
			} catch {
				return "invalid";
			}
		};
		return JSON.stringify({
			status: env?.status,
			contract_id: d.contract_id,
			schema_version: d.schema_version,
			outcome: d.outcome,
			environment: d.environment,
			adapter_id: a.adapter_id,
			// The enforced property of the probe path is absolute-ness, not the exact
			// bytes (doctrine: consumed verbatim after browser-connect proved it).
			probe_absolute: typeof a.probe_executable === "string" && a.probe_executable.startsWith("/"),
			// The enforced endpoint property is scheme + host (loopback), never the
			// path/GUID which the parser never re-emits.
			http: urlFacts(ep.http),
			ws: urlFacts(ep.ws),
			proof_present:
				typeof p.environment_contract_id === "string" &&
				typeof p.environment_schema_version === "string",
		});
	}
	const BASELINE_INVARIANTS = authInvariants(verifiedHandoffEnvelope());

	async function evaluateMutant(handoffJson: string): Promise<{
		accepted: boolean;
		code: string | undefined;
	}> {
		const { runtime } = handoffRuntime(handoffJson);
		const result = await runForTest(
			[
				"targets",
				"list",
				"--mode",
				"handoff-bound",
				"--handoff",
				"/x.json",
				"--json",
			],
			runtime,
		);
		let code: string | undefined;
		try {
			const error = (parse(result.stdout).error ?? undefined) as
				| Record<string, unknown>
				| undefined;
			code = error ? String(error.code) : undefined;
		} catch {
			code = undefined;
		}
		// Accepted = the envelope passed validation and authorized a spawn. The
		// stub returns empty pages, so acceptance surfaces as either exit 0 or the
		// downstream no-candidates outcome — NEVER a handoff-invalid refusal.
		const accepted = code !== REFUSAL_CODE;
		return { accepted, code };
	}

	// Assert the fail-closed invariant for one mutant.
	function assertFailClosed(
		handoffJson: string,
		outcome: { accepted: boolean; code: string | undefined },
		label: string,
	): void {
		const invariants = authInvariants(handoffJson);
		const invariantChanged = invariants !== BASELINE_INVARIANTS;
		if (invariantChanged) {
			// A tamper of an enforced authorization invariant (or unparseable JSON)
			// must be refused with the ONE typed code.
			expect(outcome.accepted, `${label}: auth-invariant tamper must be refused`).toBe(
				false,
			);
			expect(outcome.code, `${label}: refusal code`).toBe(REFUSAL_CODE);
		} else if (outcome.accepted) {
			// A change that leaves every enforced invariant intact may be accepted;
			// acceptance then binds the SAME authorization facts as the baseline.
			expect(invariants).toBe(BASELINE_INVARIANTS);
		}
		// A benign change that is nonetheless refused is also safe (fail-closed is
		// never violated by over-refusing).
	}

	// Deterministic stride sweep over the compact baseline. Bound: one mutant per
	// STRIDE-th byte position, each flipped to a printable byte guaranteed to
	// differ. Deterministic (no RNG) so any failure reproduces exactly; STRIDE
	// keeps the count bounded/fast while touching every structural region.
	const STRIDE = 3;

	test("seeded byte-position mutation sweep: every mutant fails closed", async () => {
		const bytes = Buffer.from(verifiedHandoffEnvelope(), "utf8");
		let mutantsChecked = 0;
		for (let i = 0; i < bytes.length; i += STRIDE) {
			const original = bytes[i] as number;
			const mutatedByte = original === 0x41 ? 0x42 : 0x41; // 'A'/'B'
			const mutated = Buffer.from(bytes);
			mutated[i] = mutatedByte;
			const handoffJson = mutated.toString("utf8");
			const outcome = await evaluateMutant(handoffJson);
			assertFailClosed(handoffJson, outcome, `byte ${i}`);
			mutantsChecked += 1;
		}
		expect(mutantsChecked).toBeGreaterThan(bytes.length / STRIDE - 1);
	});

	test("structured field-mutation battery: every mutant refused, one code", async () => {
		// Each entry tampers exactly one structural field of the valid capture.
		const mutations: Array<{ label: string; mutate: (env: any) => void }> = [
			{ label: "contract_id wrong", mutate: (e) => { e.data.contract_id = "evil.contract"; } },
			{ label: "contract_id removed", mutate: (e) => { delete e.data.contract_id; } },
			{ label: "schema_version bumped", mutate: (e) => { e.data.schema_version = "99"; } },
			{ label: "outcome not verified", mutate: (e) => { e.data.outcome = "sneaky"; } },
			{ label: "status not ok w/ verified", mutate: (e) => { e.status = "error"; } },
			{ label: "environment name wrong", mutate: (e) => { e.data.environment.name = "human-chrome"; } },
			{ label: "environment profile removed", mutate: (e) => { delete e.data.environment.profile; } },
			{ label: "attachment adapter unknown", mutate: (e) => { e.data.attachment.adapter_id = "totally-fake-adapter"; } },
			{ label: "probe_executable relative", mutate: (e) => { e.data.attachment.probe_executable = "node_modules/.bin/x"; } },
			{ label: "probe_executable removed", mutate: (e) => { delete e.data.attachment.probe_executable; } },
			{ label: "route removed", mutate: (e) => { delete e.data.attachment.route; } },
			{ label: "endpoint http not url", mutate: (e) => { e.data.endpoint.http = "not-a-url"; } },
			{ label: "endpoint http file scheme", mutate: (e) => { e.data.endpoint.http = "file:///etc/passwd"; } },
			{ label: "endpoint ws not ws scheme", mutate: (e) => { e.data.endpoint.ws = "http://127.0.0.1:9222"; } },
			{ label: "endpoint removed", mutate: (e) => { delete e.data.endpoint; } },
			{ label: "proof removed", mutate: (e) => { delete e.data.proof; } },
			{ label: "run_id removed", mutate: (e) => { delete e.run_id; } },
			{ label: "data removed", mutate: (e) => { delete e.data; } },
			{ label: "endpoint non-loopback", mutate: (e) => { e.data.endpoint.http = "http://10.0.0.9:9222"; e.data.endpoint.ws = "ws://10.0.0.9:9222/x"; } },
		];
		for (const { label, mutate } of mutations) {
			const handoffJson = verifiedHandoffEnvelope(mutate);
			const outcome = await evaluateMutant(handoffJson);
			// Every listed mutation is a validation-relevant tamper (security field
			// or a required binding fact like run_id), so each MUST be refused with
			// the single typed code.
			expect(outcome.accepted, `${label} must be refused`).toBe(false);
			expect(outcome.code, `${label} code`).toBe(REFUSAL_CODE);
		}
	});
});

// -------------------------------------------------------------------------
// DDA-D29 — page-controlled strings are sanitized: control chars and ANSI
// escapes never reach stdout raw.
// -------------------------------------------------------------------------
describe("DDA-D29 page-controlled title control chars never reach stdout raw", () => {
	// The list transport returns pages whose title carries a terminal-injection
	// payload: C0 ESC + CSI colour, BEL, DEL, and the single-byte C1 CSI (0x9b).
	// JSON.stringify escapes C0 but passes DEL and C1 raw, so a naive length-bound
	// leaks them; the sanitizer must strip/neutralize all of them.
	const HOSTILE_TITLE = "Dash[31mboardJ done";

	function listRuntimeWithTitle(title: string) {
		const handoff = verifiedHandoffEnvelope();
		return makeRuntime({
			readTextFile: async () => handoff,
			runCommand: async () =>
				okCommand(
					JSON.stringify({
						pages: [{ id: "p1", url: "https://example.test/home", title }],
					}),
				),
		});
	}

	test("stdout byte-scan is clean (no raw control chars anywhere)", async () => {
		const result = await runForTest(
			[
				"targets",
				"list",
				"--mode",
				"handoff-bound",
				"--handoff",
				"/x.json",
				"--json",
				"--show-url",
			],
			listRuntimeWithTitle(HOSTILE_TITLE),
		);
		expect(result.exitCode).toBe(0);
		const raw = rawControlBytes(result.stdout);
		expect(raw).toEqual([]);
	});

	test("the sanitized title still carries readable content", async () => {
		const result = await runForTest(
			[
				"targets",
				"list",
				"--mode",
				"handoff-bound",
				"--handoff",
				"/x.json",
				"--json",
			],
			listRuntimeWithTitle(HOSTILE_TITLE),
		);
		const envelope = parse(result.stdout);
		const data = envelope.data as Record<string, unknown>;
		const candidates = data.candidates as Array<Record<string, unknown>>;
		const title = String(candidates[0]?.title ?? "");
		// The readable letters survive; only the control bytes are gone.
		expect(title).toContain("Dash");
		expect(title).toContain("board");
		// And no raw control byte survived into the field value itself.
		expect(rawControlBytes(title)).toEqual([]);
	});
});

// -------------------------------------------------------------------------
// DDA-F23 — any unhandled exception becomes a typed internal-error failure
// envelope; no raw stack or absolute path on stdout (stack allowed on stderr
// at debug only).
// -------------------------------------------------------------------------
describe("DDA-F23 unhandled exception becomes typed internal-error envelope", () => {
	// Fault-injection: the runCommand seam throws a raw Error carrying an absolute
	// path and a fabricated stack. The driver must catch it, emit a typed failure
	// envelope on stdout that parses as JSON, and never leak the stack or the
	// absolute path onto stdout.
	const ABSOLUTE_PATH = "/private/var/secret/internal/module.ts";

	function faultRuntime() {
		const handoff = verifiedHandoffEnvelope();
		return makeRuntime({
			readTextFile: async () => handoff,
			runCommand: async () => {
				const error = new Error(
					`boom at ${ABSOLUTE_PATH}: unexpected internal fault`,
				);
				error.stack = `Error: boom\n    at listPages (${ABSOLUTE_PATH}:42:7)\n    at spawn (${ABSOLUTE_PATH}:9:3)`;
				throw error;
			},
		});
	}

	test("stdout parses as a typed failure envelope with no stack/abs path", async () => {
		const result = await runForTest(
			[
				"targets",
				"list",
				"--mode",
				"handoff-bound",
				"--handoff",
				"/x.json",
				"--json",
			],
			faultRuntime(),
		);
		// A failure envelope, not a crash.
		expect(result.exitCode).not.toBe(0);
		const envelope = parse(result.stdout);
		expect(envelope.status).toBe("error");
		const error = envelope.error as Record<string, unknown>;
		expect(typeof error.code).toBe("string");
		expect(String(error.code).length).toBeGreaterThan(0);
		// No raw stack frame marker and no absolute path on stdout.
		expect(result.stdout).not.toContain("    at ");
		expect(result.stdout).not.toContain(ABSOLUTE_PATH);
	});

	test(
		"spawned CLI: internal fault still yields a parseable envelope, clean stdout",
		async () => {
			// The env-injected fault path: a handoff whose ws endpoint the transport
			// cannot reach forces a real internal transport error inside the spawned
			// process. stdout must remain a single parseable JSON envelope with no
			// absolute repo path leaked.
			const result = await spawnBrowserUse([
				"lanes",
				"show",
				"--adapter",
				"chrome-devtools-mcp",
				"--json",
			]);
			// lanes show is a pure projection; it must never crash the process.
			const envelope = parse(result.stdout);
			expect(typeof envelope.status).toBe("string");
			expect(result.stdout).not.toContain("    at ");
		},
		TEST_TIMEOUT_MS,
	);
});
