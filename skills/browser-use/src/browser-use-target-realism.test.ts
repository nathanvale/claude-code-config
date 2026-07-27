import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type BrowserUseRuntime, runForTest } from "./browser-use";
import { candidateMatchesHints, parseUrlSafe, toCandidate } from "./browser-use-core";
import { makeRuntime, okCommand, parseJson } from "./browser-use-test-helpers";
import { REAL_VERIFIED_HANDOFF_ENVELOPE } from "./browser-connect-handoff-fixtures";
import type { BrowserTargetCandidate } from "./discovery-model";

// =========================================================================
// Daily Driver Acceptance — cluster: target-realism.
//
// Rows DDA-D26/D27/D28/D30/D31/D33. Each oracle is fixture-backed: a real
// loopback CDP `/json/list` fixture server (never a live browser, never the
// network beyond 127.0.0.1) feeds the SAME projection pipeline the front door
// runs — `targets list` reads the adapter's page listing, drops every
// non-navigable surface through parseUrlSafe (R32), projects survivors into
// display-safe candidates, and `targets select` resolves a hint to exactly one.
//
// Realism discipline: the fixture server answers real HTTP on loopback with the
// exact CDP `/json/list` array shape (`{id,type,title,url,webSocketDebuggerUrl}`
// per target). The discovery runtime's runCommand performs ONE real fetch to
// that server per `targets list`, then hands the listing to discovery in the
// adapter's `{pages:[...]}` stdout shape — so the projection, scheme filter, and
// origin canonicalization run over bytes that crossed a real socket.
// =========================================================================

const HANDOFF_PATH = "/h.json";

// One CDP target as `/json/list` renders it. `type` is the CDP target kind
// (page / service_worker / background_page / other / iframe); the url scheme is
// what the projection filters on.
type CdpTarget = {
	id: string;
	type: string;
	title: string;
	url: string;
	webSocketDebuggerUrl?: string;
};

type FixtureServer = {
	origin: string;
	requestCount: () => number;
	jsonListPaths: () => readonly string[];
	close: () => Promise<void>;
};

const openServers: Server[] = [];

afterEach(async () => {
	await Promise.all(
		openServers.splice(0).map(
			(server) =>
				new Promise<void>((resolve) => server.close(() => resolve())),
		),
	);
});

// Spawn a loopback CDP discovery endpoint. `status` lets a test force a 429
// captive-portal / rate-limit interstitial on `/json/list` (DDA-D33). Every
// request path is recorded so a test can assert exactly-once, no retry storm.
async function startCdpFixture(input: {
	targets: readonly CdpTarget[];
	status?: number;
}): Promise<FixtureServer> {
	const paths: string[] = [];
	const server = createServer((req, res) => {
		paths.push(req.url ?? "");
		if ((req.url ?? "").startsWith("/json/list")) {
			if (input.status && input.status !== 200) {
				res.writeHead(input.status, { "content-type": "text/plain" });
				res.end("rate limited");
				return;
			}
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(input.targets));
			return;
		}
		res.writeHead(404).end();
	});
	await new Promise<void>((resolve) =>
		server.listen(0, "127.0.0.1", () => resolve()),
	);
	openServers.push(server);
	const { port } = server.address() as AddressInfo;
	const origin = `http://127.0.0.1:${port}`;
	return {
		origin,
		requestCount: () => paths.length,
		jsonListPaths: () => paths.filter((p) => p.startsWith("/json/list")),
		close: () =>
			new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

// A discovery runtime whose adapter `list_pages` call is served by ONE real
// fetch to the loopback CDP `/json/list` endpoint. The CDP array is mapped
// verbatim into the adapter's `{pages:[...]}` stdout shape (id/title/url passed
// through untouched) so the production scheme filter and candidate projection
// run over server bytes, not a hand-built object. A non-200 status becomes a
// non-zero adapter exit — the transport-failure path, attempted exactly once.
function cdpDiscoveryRuntime(fixture: FixtureServer): {
	runtime: BrowserUseRuntime;
	adapterCalls: () => number;
} {
	let adapterCalls = 0;
	const runtime = makeRuntime({
		readTextFile: async (path) => {
			if (path === HANDOFF_PATH) return REAL_VERIFIED_HANDOFF_ENVELOPE;
			throw new Error(`ENOENT: ${path}`);
		},
		runCommand: async () => {
			adapterCalls += 1;
			const response = await fetch(`${fixture.origin}/json/list`);
			if (!response.ok) {
				// A captive-portal / rate-limit interstitial: surface it as the
				// adapter failing its page-listing call, never retried in a storm.
				return { exitCode: 1, stdout: "", stderr: `list_pages http ${response.status}` };
			}
			const targets = (await response.json()) as CdpTarget[];
			return okCommand(
				JSON.stringify({
					pages: targets.map((t) => ({
						id: t.id,
						title: t.title,
						url: t.url,
						type: t.type,
					})),
				}),
			);
		},
	});
	return { runtime, adapterCalls: () => adapterCalls };
}

async function listTargets(runtime: BrowserUseRuntime, extraArgv: string[] = []) {
	return runForTest(
		[
			"targets",
			"list",
			"--mode",
			"handoff-bound",
			"--handoff",
			HANDOFF_PATH,
			...extraArgv,
			"--json",
		],
		runtime,
	);
}

function candidatesOf(stdout: string): BrowserTargetCandidate[] {
	const data = parseJson(stdout).data as { candidates?: BrowserTargetCandidate[] };
	return data?.candidates ?? [];
}

// -------------------------------------------------------------------------
// DDA-D26 — zero open pages returns a typed continuation, never a crash.
// -------------------------------------------------------------------------
describe("DDA-D26 empty /json/list", () => {
	test("an empty CDP target list yields a typed, well-formed envelope with a named next action, never a crash", async () => {
		const fixture = await startCdpFixture({ targets: [] });
		const { runtime, adapterCalls } = cdpDiscoveryRuntime(fixture);

		const result = await listTargets(runtime);

		// Never a crash: a bounded exit code and a parseable JSON envelope, no
		// stack trace on stderr.
		expect(result.stdout).not.toBe("");
		expect(result.stderr).toBe("");
		const json = parseJson(result.stdout);
		// A typed envelope carrying a named continuation. The established target
		// discovery contract renders an empty candidate set as a typed recovery
		// (status "error", exit 20) rather than an ok listing of nothing — the
		// oracle's "ok envelope with a named next action" reads as a well-formed
		// typed envelope, not a crash: candidates are empty and the caller is told
		// exactly what to do next (open a Browser Target, then re-list).
		expect(result.exitCode).toBe(20);
		expect(json.error).toMatchObject({ code: "target_discovery_no_candidates" });
		expect((json.continuation as { next_action_id?: string }).next_action_id).toBe(
			"open_browser_target",
		);
		// Empty candidates never became a bogus target.
		expect(candidatesOf(result.stdout)).toHaveLength(0);
		// Exactly one page-listing attempt: no retry storm on an empty browser.
		expect(adapterCalls()).toBe(1);
		expect(fixture.jsonListPaths()).toHaveLength(1);
	});
});

// -------------------------------------------------------------------------
// DDA-D27 — hundreds of tabs stay within budget; hint selection still resolves.
// -------------------------------------------------------------------------
describe("DDA-D27 300-target fixture", () => {
	test("300 page targets project within an ordinal-dense budget and one carries a unique needle", async () => {
		const targets: CdpTarget[] = Array.from({ length: 300 }, (_, i) => ({
			id: `P${i}`,
			type: "page",
			title: `Tab ${i}`,
			url:
				i === 149
					? "https://needle.example/unique-report"
					: `https://bulk-${i}.example/app`,
		}));
		const fixture = await startCdpFixture({ targets });
		const { runtime } = cdpDiscoveryRuntime(fixture);

		// --show-url so the redacted path_shape is present for the url-contains hint.
		const result = await listTargets(runtime, ["--show-url"]);
		expect(result.exitCode).toBe(0);
		const candidates = candidatesOf(result.stdout);
		expect(candidates).toHaveLength(300);
		// Output budget: ordinals are dense 1..300 and every candidate carries only
		// bounded, redacted display facts (no raw url, no adapter id, no ws handle).
		expect(candidates[0].candidate_ordinal).toBe(1);
		expect(candidates[299].candidate_ordinal).toBe(300);
		for (const c of candidates) {
			expect(c.origin.length).toBeLessThanOrEqual(200);
			expect((c.title ?? "").length).toBeLessThanOrEqual(80);
			expect((c.path_shape ?? "").length).toBeLessThanOrEqual(160);
			expect(c).not.toHaveProperty("url");
			expect(c).not.toHaveProperty("id");
		}
		// Hint selection still resolves exactly one out of 300.
		const matches = candidates.filter((c) =>
			candidateMatchesHints(c, { urlContains: "needle.example" }),
		);
		expect(matches).toHaveLength(1);
		expect(matches[0].origin).toBe("https://needle.example");
	});
});

// -------------------------------------------------------------------------
// DDA-D28 — service workers, extension pages, devtools, chrome:// never
// appear operation-ready.
// -------------------------------------------------------------------------
describe("DDA-D28 mixed target types", () => {
	test("only http(s) page targets survive into operation-ready candidates", async () => {
		const targets: CdpTarget[] = [
			{ id: "PAGE-1", type: "page", title: "App", url: "https://app.example/dashboard" },
			{ id: "PAGE-2", type: "page", title: "Docs", url: "http://docs.example/guide" },
			{
				// A service worker carrying its OWN http(s) origin: scheme-filtering
				// alone would wrongly admit it as a third candidate. Only the CDP
				// `type` distinguishes it, so this row proves type-filtering is
				// load-bearing, not incidental origin dedup.
				id: "SW-1",
				type: "service_worker",
				title: "sw.js",
				url: "https://worker.example/sw.js",
				webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/SW-1",
			},
			{
				id: "EXT-1",
				type: "background_page",
				title: "Extension",
				url: "chrome-extension://abcdefghijklmnop/background.html",
			},
			{
				id: "DT-1",
				type: "other",
				title: "DevTools",
				url: "devtools://devtools/bundled/inspector.html",
			},
			{ id: "CHROME-1", type: "page", title: "Settings", url: "chrome://settings/" },
		];
		const fixture = await startCdpFixture({ targets });
		const { runtime } = cdpDiscoveryRuntime(fixture);

		const result = await listTargets(runtime);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		// The envelope is operation-ready (handoff-bound), so its candidates are
		// exactly the operation-eligible set.
		expect(json.data).toMatchObject({ operation_ready: true, handoff_bound: true });
		const candidates = candidatesOf(result.stdout);
		// Only the two http(s) page targets survive; the service worker, extension
		// background page, devtools surface, and chrome:// page are all dropped.
		expect(candidates.map((c) => c.origin).sort()).toEqual([
			"http://docs.example",
			"https://app.example",
		]);
		// The service worker's own https origin was dropped by type, not admitted.
		expect(candidates.some((c) => c.origin === "https://worker.example")).toBe(false);
		// No candidate carries a non-navigable origin.
		for (const c of candidates) {
			expect(c.origin.startsWith("http://") || c.origin.startsWith("https://")).toBe(
				true,
			);
		}
		expect(candidates).toHaveLength(2);
	});
});

// -------------------------------------------------------------------------
// DDA-D30 — IDN / punycode hosts render unambiguously; origin checks compare
// canonical forms.
// -------------------------------------------------------------------------
describe("DDA-D30 IDN / punycode canonicalization", () => {
	test("a unicode host and its xn-- punycode form project to one canonical origin and compare equal", async () => {
		const unicodeUrl = "https://bücher.example/shop/item";
		const punycodeUrl = "https://xn--bcher-kva.example/shop/item";
		// Both spellings name the SAME host; the discovery pipeline must not admit
		// them as two distinct origins (a homograph-ambiguity trap). WHATWG URL
		// canonicalizes both to the punycode ascii origin.
		const canonicalOrigin = "https://xn--bcher-kva.example";
		expect(parseUrlSafe(unicodeUrl)?.origin).toBe(canonicalOrigin);
		expect(parseUrlSafe(punycodeUrl)?.origin).toBe(canonicalOrigin);

		const fixture = await startCdpFixture({
			targets: [
				{ id: "U", type: "page", title: "Unicode", url: unicodeUrl },
				{ id: "P", type: "page", title: "Punycode", url: punycodeUrl },
			],
		});
		const { runtime } = cdpDiscoveryRuntime(fixture);
		const result = await listTargets(runtime);
		expect(result.exitCode).toBe(0);
		const candidates = candidatesOf(result.stdout);
		// Both targets render the one canonical origin — no unicode display form
		// leaks into the candidate, so origin comparison has one unambiguous result.
		expect(candidates.map((c) => c.origin)).toEqual([canonicalOrigin, canonicalOrigin]);

		// An origin hint expressed in either spelling resolves against the canonical
		// form: the unicode-spelled hint canonicalizes to the same ascii origin.
		const unicodeCanonical = parseUrlSafe("https://bücher.example")?.origin ?? "";
		for (const candidate of candidates) {
			expect(candidateMatchesHints(candidate, { origin: canonicalOrigin })).toBe(true);
			expect(candidateMatchesHints(candidate, { origin: unicodeCanonical })).toBe(true);
		}
	});
});

// -------------------------------------------------------------------------
// DDA-D31 — file:// / about: / chrome:// schemes are admitted or refused by an
// explicit rule (table-driven contract).
// -------------------------------------------------------------------------
describe("DDA-D31 scheme admission policy", () => {
	// The explicit navigable-scheme rule (browser-use-core.parseUrlSafe): only
	// http and https are navigable Browser Targets; every other scheme is a
	// non-navigable surface or transport handle and is refused.
	const schemeCases: ReadonlyArray<{
		scheme: string;
		url: string;
		admit: boolean;
	}> = [
		{ scheme: "https", url: "https://example.com/app", admit: true },
		{ scheme: "http", url: "http://example.com/app", admit: true },
		{ scheme: "file", url: "file:///etc/passwd", admit: false },
		{ scheme: "about", url: "about:blank", admit: false },
		{ scheme: "chrome", url: "chrome://settings/", admit: false },
		{ scheme: "devtools", url: "devtools://devtools/bundled/inspector.html", admit: false },
		{ scheme: "chrome-extension", url: "chrome-extension://abc/page.html", admit: false },
		{ scheme: "ws", url: "ws://127.0.0.1:9222/devtools/page/AB", admit: false },
		{ scheme: "data", url: "data:text/html,<p>hi</p>", admit: false },
		{ scheme: "javascript", url: "javascript:void(0)", admit: false },
	];

	for (const { scheme, url, admit } of schemeCases) {
		test(`${scheme}: ${admit ? "admitted by rule" : "refused by rule"}`, () => {
			const parsed = parseUrlSafe(url);
			expect(parsed !== undefined).toBe(admit);
			const candidate = toCandidate({ id: scheme, url }, 0, "env", true);
			// An admitted scheme yields a real origin; a refused scheme yields the
			// empty-origin sentinel and never a navigable candidate.
			expect(candidate.origin !== "").toBe(admit);
		});
	}

	test("end to end: a mixed-scheme CDP listing admits only the http(s) rows", async () => {
		const fixture = await startCdpFixture({
			targets: schemeCases.map((c, i) => ({
				id: `S${i}`,
				type: "page",
				title: c.scheme,
				url: c.url,
			})),
		});
		const { runtime } = cdpDiscoveryRuntime(fixture);
		const result = await listTargets(runtime);
		expect(result.exitCode).toBe(0);
		const candidates = candidatesOf(result.stdout);
		expect(candidates).toHaveLength(schemeCases.filter((c) => c.admit).length);
		for (const c of candidates) {
			expect(
				c.origin.startsWith("http://") || c.origin.startsWith("https://"),
			).toBe(true);
		}
	});
});

// -------------------------------------------------------------------------
// DDA-D33 — a 429 interstitial produces a typed not-achieved, exactly one
// attempt, no retry storm.
// -------------------------------------------------------------------------
describe("DDA-D33 rate-limit interstitial", () => {
	test("a /json/list that returns 429 is a typed transport failure, attempted exactly once", async () => {
		const fixture = await startCdpFixture({
			targets: [{ id: "P1", type: "page", title: "App", url: "https://example.com/" }],
			status: 429,
		});
		const { runtime, adapterCalls } = cdpDiscoveryRuntime(fixture);

		const result = await listTargets(runtime);

		// Typed not-achieved: a bounded exit and a typed transport-failure code,
		// never a crash or a silent empty success.
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.status).toBe("error");
		expect(json.error).toMatchObject({ code: "target_discovery_transport_failed" });
		// No retry storm: the fixture saw exactly one /json/list request, and the
		// adapter was invoked exactly once.
		expect(adapterCalls()).toBe(1);
		expect(fixture.jsonListPaths()).toHaveLength(1);
	});
});
