import { describe, expect, test } from "bun:test";
import {
	BROWSER_USE_GOVERNED_SURFACE_KINDS,
	type BrowserUseGovernedSurface,
	assertContainmentBeforeRelease,
	beginSensitiveRunGuard,
	markRunSensitive,
	sweepGovernedSurfaces,
} from "./browser-use-sensitive-run";

// =========================================================================
// Sensitive Run Guard unit suite (auth plan U4, R17-R18; AE5; release
// R14-R16). Pure state-machine + sentinel-scanner proofs. The value-aware
// end-to-end leak proof over REAL store bytes lives in
// browser-use-leak-harness.test.ts.
// =========================================================================

const SENTINEL_USERNAME = "SENTINEL-USER-4a9f2c";
const SENTINEL_PASSWORD = "SENTINEL-PASS-b7e13d0f";
const SENTINEL_OTP = "SENTINEL-OTP-908172";

function markedGuard(run_id = "run-sensitive-1") {
	const begun = beginSensitiveRunGuard(run_id);
	if (!begun.ok) throw new Error("baseline guard should begin");
	const marked = markRunSensitive(begun.guard, {
		trigger: "confidential-field-delivery",
		sentinels: [SENTINEL_USERNAME, SENTINEL_PASSWORD, SENTINEL_OTP],
	});
	if (!marked.ok) throw new Error("guard should mark sensitive");
	return marked.guard;
}

function surface(
	kind: BrowserUseGovernedSurface["kind"],
	label: string,
	content: string,
): BrowserUseGovernedSurface {
	return { kind, label, content };
}

describe("Sensitive Run Guard marker lifecycle", () => {
	test("begins non-sensitive with no sentinels", () => {
		const begun = beginSensitiveRunGuard("run-1");
		expect(begun.ok).toBe(true);
		if (!begun.ok) return;
		expect(begun.guard.sensitive).toBe(false);
		expect(begun.guard.trigger).toBeNull();
		expect(begun.guard.sentinels).toEqual([]);
	});

	test("rejects an unsafe run id", () => {
		const begun = beginSensitiveRunGuard("../escape");
		expect(begun.ok).toBe(false);
		if (begun.ok) return;
		expect(begun.rejection.code).toBe("sensitive_run_id_invalid");
	});

	test("marks sensitive when confidential delivery participates", () => {
		const guard = markedGuard();
		expect(guard.sensitive).toBe(true);
		expect(guard.trigger).toBe("confidential-field-delivery");
		expect(guard.sentinels).toHaveLength(3);
	});

	test("never mutates the input guard in place", () => {
		const begun = beginSensitiveRunGuard("run-immut");
		if (!begun.ok) throw new Error("begin");
		markRunSensitive(begun.guard, {
			trigger: "confidential-field-delivery",
			sentinels: [SENTINEL_PASSWORD],
		});
		expect(begun.guard.sensitive).toBe(false);
		expect(begun.guard.sentinels).toEqual([]);
	});

	test("refuses a second mark so double delivery is visible, not masked", () => {
		const second = markRunSensitive(markedGuard(), {
			trigger: "secret-lease-acquired",
			sentinels: [SENTINEL_PASSWORD],
		});
		expect(second.ok).toBe(false);
		if (second.ok) return;
		expect(second.rejection.code).toBe("sensitive_already_marked");
	});

	test("refuses marking with no sentinels", () => {
		const begun = beginSensitiveRunGuard("run-nosent");
		if (!begun.ok) throw new Error("begin");
		const marked = markRunSensitive(begun.guard, {
			trigger: "confidential-field-delivery",
			sentinels: [],
		});
		expect(marked.ok).toBe(false);
		if (marked.ok) return;
		expect(marked.rejection.code).toBe("sensitive_sentinel_invalid");
	});

	test("refuses a too-short sentinel that would false-match ordinary tokens", () => {
		const begun = beginSensitiveRunGuard("run-short");
		if (!begun.ok) throw new Error("begin");
		const marked = markRunSensitive(begun.guard, {
			trigger: "confidential-field-delivery",
			sentinels: ["abc"],
		});
		expect(marked.ok).toBe(false);
		if (marked.ok) return;
		expect(marked.rejection.code).toBe("sensitive_sentinel_invalid");
	});
});

describe("containment sweep", () => {
	test("proves containment when no sentinel appears on any surface", () => {
		const guard = markedGuard();
		const verdict = sweepGovernedSurfaces(guard, [
			surface("stdout-envelope", "task-run", '{"status":"ok","field":"[redacted]"}'),
			surface("run-store-file", "run.json", '{"phase":"terminal","method_step":null}'),
			surface("artifact", "shot.txt", "structural evidence only"),
			surface("diagnostic", "repair", "re-mint the verified handoff"),
			surface("crash-surface", "error", "Error: step threw; field cleared"),
			surface("log", "console", "auth transaction advanced"),
		]);
		expect(verdict.contained).toBe(true);
		if (!verdict.contained) return;
		expect(verdict.swept_surfaces).toBe(6);
		expect(new Set(verdict.swept_kinds)).toEqual(
			new Set(BROWSER_USE_GOVERNED_SURFACE_KINDS),
		);
	});

	test("catches a password leak on a persisted run-store file", () => {
		const guard = markedGuard();
		const verdict = sweepGovernedSurfaces(guard, [
			surface(
				"run-store-file",
				"run.json",
				`{"note":"password was ${SENTINEL_PASSWORD}"}`,
			),
		]);
		expect(verdict.contained).toBe(false);
		if (verdict.contained) return;
		expect(verdict.leaks).toHaveLength(1);
		expect(verdict.leaks[0]?.surface_kind).toBe("run-store-file");
		expect(verdict.leaks[0]?.sentinel_index).toBe(1);
	});

	test("catches a leak on the crash surface", () => {
		const guard = markedGuard();
		const verdict = sweepGovernedSurfaces(guard, [
			surface(
				"crash-surface",
				"heap-dump",
				`fatal: value=${SENTINEL_OTP} in flight`,
			),
		]);
		expect(verdict.contained).toBe(false);
		if (verdict.contained) return;
		expect(verdict.leaks[0]?.surface_kind).toBe("crash-surface");
		expect(verdict.leaks[0]?.sentinel_index).toBe(2);
	});

	test("counts multiple occurrences of the same sentinel", () => {
		const guard = markedGuard();
		const verdict = sweepGovernedSurfaces(guard, [
			surface(
				"log",
				"console",
				`${SENTINEL_USERNAME} ... ${SENTINEL_USERNAME}`,
			),
		]);
		expect(verdict.contained).toBe(false);
		if (verdict.contained) return;
		expect(verdict.leaks[0]?.occurrences).toBe(2);
	});

	test("never re-emits the raw leaked value in the finding", () => {
		const guard = markedGuard();
		const verdict = sweepGovernedSurfaces(guard, [
			surface("artifact", "trace", `token=${SENTINEL_PASSWORD}`),
		]);
		if (verdict.contained) throw new Error("expected a leak");
		const serialized = JSON.stringify(verdict.leaks);
		expect(serialized).not.toContain(SENTINEL_PASSWORD);
	});
});

describe("release gate", () => {
	test("releases a contained sensitive run", () => {
		const guard = markedGuard();
		const gate = assertContainmentBeforeRelease(guard, [
			surface("stdout-envelope", "task-run", '{"status":"ok"}'),
		]);
		expect(gate.release).toBe(true);
	});

	test("fails closed on a leak and preserves the verdict for repair", () => {
		const guard = markedGuard();
		const gate = assertContainmentBeforeRelease(guard, [
			surface("artifact", "trace", `pw=${SENTINEL_PASSWORD}`),
		]);
		expect(gate.release).toBe(false);
		if (gate.release) return;
		expect(gate.reason).toBe("containment_failed");
		expect(gate.verdict?.contained).toBe(false);
	});

	test("refuses to release-gate a non-sensitive run", () => {
		const begun = beginSensitiveRunGuard("run-plain");
		if (!begun.ok) throw new Error("begin");
		const gate = assertContainmentBeforeRelease(begun.guard, []);
		expect(gate.release).toBe(false);
		if (gate.release) return;
		expect(gate.reason).toBe("run_not_sensitive");
	});
});
