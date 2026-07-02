import { describe, expect, test } from "bun:test";
import {
	type FindingInput,
	createLedger,
	historyFindings,
	openFindings,
	parseLedger,
	renderLedger,
	transitionFinding,
	upsertFinding,
} from "./index";
import { signature } from "./signature";

const staticInput: FindingInput = {
	clauseId: "no-raw-runner",
	kind: "static",
	summary: "src/foo.ts calls raw `bun test`",
	argv: [],
};

const surfaceInput: FindingInput = {
	clauseId: "json-valid-under-failure",
	kind: "surface",
	summary: "audit check --json emits a broken envelope on failure",
	argv: ["check", "--json"],
};

const stationInput: FindingInput = {
	clauseId: "station-map",
	kind: "station",
	summary: "check.success is missing for declared_branch_coverage.",
	station: {
		stationId: "check.success",
		command: "check",
		findingKind: "missing",
	},
};

describe("ledger — upsert + dedupe", () => {
	test("a new finding upsert assigns status open", () => {
		const ledger = createLedger("classic-cinema");
		const finding = upsertFinding(ledger, staticInput);
		expect(finding.status).toBe("open");
		expect(openFindings(ledger)).toHaveLength(1);
	});

	test("a second upsert with the same signature dedupes (no duplicate row)", () => {
		const ledger = createLedger("classic-cinema");
		upsertFinding(ledger, staticInput);
		upsertFinding(ledger, { ...staticInput, summary: "refreshed summary" });
		const open = openFindings(ledger);
		expect(open).toHaveLength(1);
		// The human summary refreshes; identity (signature) and state are stable.
		expect(open[0].summary).toBe("refreshed summary");
	});

	test("different clause on the same invocation is a distinct finding", () => {
		const ledger = createLedger("classic-cinema");
		upsertFinding(ledger, surfaceInput);
		upsertFinding(ledger, { ...surfaceInput, clauseId: "declared-coverage-runs" });
		expect(openFindings(ledger)).toHaveLength(2);
	});

	test("front-door ownership partitions clause finding signatures", () => {
		const ledger = createLedger("front-door-shared");
		upsertFinding(ledger, { ...surfaceInput, frontDoor: "admin" });
		upsertFinding(ledger, { ...surfaceInput, frontDoor: "app" });
		const open = openFindings(ledger);
		expect(open).toHaveLength(2);
		expect(
			open.map((finding) => {
				if ("station" in finding.recheck) throw new Error("expected clause recheck");
				return finding.recheck.frontDoor;
			}).sort(),
		).toEqual(["admin", "app"]);
	});

	test("station findings dedupe by station anchor, not argv", () => {
		const ledger = createLedger("classic-cinema");
		upsertFinding(ledger, stationInput);
		upsertFinding(ledger, {
			...stationInput,
			summary: "refreshed station summary",
		});
		const open = openFindings(ledger);
		expect(open).toHaveLength(1);
		expect(open[0].summary).toBe("refreshed station summary");
		if (!("station" in open[0].recheck)) throw new Error("expected station recheck");
		expect(open[0].recheck.station).toEqual(stationInput.station);
	});

	test("rejects invalid kind and recheck anchor combinations at runtime", () => {
		const ledger = createLedger("classic-cinema");
		expect(() =>
			upsertFinding(ledger, {
				...stationInput,
				argv: ["local", "noise"],
			} as unknown as FindingInput),
		).toThrow("station finding cannot include argv");
		expect(() =>
			upsertFinding(ledger, {
				...surfaceInput,
				station: stationInput.station,
			} as unknown as FindingInput),
		).toThrow("clause finding cannot include a station anchor");
		expect(() =>
			upsertFinding(ledger, {
				...surfaceInput,
				kind: "unknown",
			} as unknown as FindingInput),
		).toThrow("finding kind must be static, surface, or station");
	});
});

describe("ledger — never-delete history", () => {
	test("open → resolved moves the row to Finding History, preserving it", () => {
		const ledger = createLedger("classic-cinema");
		const finding = upsertFinding(ledger, staticInput);
		transitionFinding(ledger, finding.signature, "resolved", {
			resolution: "routed through test-runner.sh (commit abc123)",
		});
		expect(openFindings(ledger)).toHaveLength(0);
		const history = historyFindings(ledger);
		expect(history).toHaveLength(1);
		expect(history[0].status).toBe("resolved");
		expect(history[0].resolution).toContain("test-runner.sh");
	});

	test("a resolved finding is not silently reopened by a later upsert", () => {
		const ledger = createLedger("classic-cinema");
		const finding = upsertFinding(ledger, staticInput);
		transitionFinding(ledger, finding.signature, "resolved", { resolution: "fixed" });
		// Re-observing the same signature must NOT flip it back to open — only a
		// clause re-check reopens. Upsert just refreshes the summary.
		upsertFinding(ledger, staticInput);
		expect(openFindings(ledger)).toHaveLength(0);
		expect(historyFindings(ledger)).toHaveLength(1);
	});
});

describe("ledger — signature stability (R7)", () => {
	test("signature is stable across calls for identical (clause, invocation)", () => {
		const a = signature({ clauseId: "exit-floor", argv: ["check", "--json"] });
		const b = signature({ clauseId: "exit-floor", argv: ["check", "--json"] });
		expect(a).toBe(b);
	});

	test("signature differs when the clause differs", () => {
		const a = signature({ clauseId: "exit-floor", argv: [] });
		const b = signature({ clauseId: "vacuous-match", argv: [] });
		expect(a).not.toBe(b);
	});

	test("signature differs when the invocation differs", () => {
		const a = signature({ clauseId: "json-valid-under-failure", argv: ["check"] });
		const b = signature({ clauseId: "json-valid-under-failure", argv: ["repair"] });
		expect(a).not.toBe(b);
	});

	test("signature differs when the front door differs", () => {
		const a = signature({
			clauseId: "json-valid-under-failure",
			argv: ["check"],
			frontDoor: "admin",
		});
		const b = signature({
			clauseId: "json-valid-under-failure",
			argv: ["check"],
			frontDoor: "app",
		});
		expect(a).not.toBe(b);
	});

	test("signature marks clause fields so scoped and unscoped tokens cannot collide", () => {
		const scoped = signature({
			clauseId: "json-valid-under-failure",
			argv: ["check"],
			frontDoor: "admin",
		});
		const unscopedWithMatchingTokens = signature({
			clauseId: "frontDoor",
			argv: ["admin", "json-valid-under-failure", "check"],
		});
		expect(scoped).not.toBe(unscopedWithMatchingTokens);
	});

	test("station signature ignores invocation and keys by station identity", () => {
		const station = {
			stationId: "check.success",
			command: "check",
			findingKind: "missing",
		};
		const a = signature({ clauseId: "station-map", argv: ["noise"], station });
		const b = signature({ clauseId: "different-display-id", argv: [], station });
		const c = signature({
			clauseId: "station-map",
			station: { ...station, findingKind: "drifted" },
		});
		expect(a).toBe(b);
		expect(a).not.toBe(c);
	});
});

describe("ledger — Markdown round-trip + format compatibility (R6)", () => {
	test("recheck serializes as a structured clause+invocation reference, not free text", () => {
		const ledger = createLedger("classic-cinema");
		upsertFinding(ledger, surfaceInput);
		const md = renderLedger(ledger);
		expect(md).toContain("recheck: clause=json-valid-under-failure");
		expect(md).toContain("invocation=`check --json`");
	});

	test("front-door clause rechecks serialize and parse", () => {
		const ledger = createLedger("front-door-shared");
		upsertFinding(ledger, { ...surfaceInput, frontDoor: "admin/users" });
		const md = renderLedger(ledger);
		expect(md).toContain("recheck: frontDoor=admin%2Fusers clause=json-valid-under-failure");

		const reparsed = parseLedger("front-door-shared", md);
		const [finding] = openFindings(reparsed);
		if ("station" in finding.recheck) throw new Error("expected clause recheck");
		expect(finding.recheck.frontDoor).toBe("admin/users");
		expect(finding.recheck.argv).toEqual(["check", "--json"]);
	});

	test("a static finding renders its recheck with the no-invocation marker", () => {
		const ledger = createLedger("classic-cinema");
		upsertFinding(ledger, staticInput);
		const md = renderLedger(ledger);
		expect(md).toContain("invocation=`(static — no invocation)`");
	});

	test("a produced ledger parses cleanly back into equivalent findings", () => {
		const ledger = createLedger("classic-cinema");
		upsertFinding(ledger, staticInput);
		const surface = upsertFinding(ledger, surfaceInput);
		transitionFinding(ledger, surface.signature, "resolved", {
			resolution: "envelope fixed",
		});

		const reparsed = parseLedger("classic-cinema", renderLedger(ledger));
		expect(openFindings(reparsed)).toHaveLength(1);
		expect(historyFindings(reparsed)).toHaveLength(1);

		const reOpen = openFindings(reparsed)[0];
		expect(reOpen.clauseId).toBe("no-raw-runner");
		expect(reOpen.kind).toBe("static");
		expect(reOpen.recheck.argv).toEqual([]);

		const reHistory = historyFindings(reparsed)[0];
		expect(reHistory.status).toBe("resolved");
		expect(reHistory.resolution).toBe("envelope fixed");
		expect(reHistory.recheck.argv).toEqual(["check", "--json"]);
	});

	test("station findings render and parse their station recheck anchor", () => {
		const ledger = createLedger("classic-cinema");
		upsertFinding(ledger, stationInput);
		const md = renderLedger(ledger);
		expect(md).toContain("recheck: station=check.success command=check finding=missing");

		const reparsed = parseLedger("classic-cinema", md);
		const open = openFindings(reparsed);
		expect(open).toHaveLength(1);
		expect(open[0].kind).toBe("station");
		if (!("station" in open[0].recheck)) throw new Error("expected station recheck");
		expect(open[0].recheck.station).toEqual(stationInput.station);
	});

	test("station recheck anchors with spaces round-trip through markdown", () => {
		const input: FindingInput = {
			clauseId: "station-map",
			kind: "station",
			summary: "interactive review success is missing.",
			station: {
				stationId: "review success",
				command: "review command",
				findingKind: "declared unreachable",
			},
		};
		const ledger = createLedger("classic-cinema");
		upsertFinding(ledger, input);

		const md = renderLedger(ledger);
		expect(md).toContain(
			"recheck: station=review%20success command=review%20command finding=declared%20unreachable",
		);

		const reparsed = parseLedger("classic-cinema", md);
		const [finding] = openFindings(reparsed);
		if (!("station" in finding.recheck)) throw new Error("expected station recheck");
		expect(finding.recheck.station).toEqual(input.station);
	});

	test("renders the findings-table sections the audit-loop template documents", () => {
		const ledger = createLedger("classic-cinema");
		const md = renderLedger(ledger);
		expect(md).toContain("## Open Findings");
		expect(md).toContain("## Finding History");
		// Empty sections use the same "- None yet." placeholder as the template.
		expect(md).toContain("- None yet.");
	});
});
