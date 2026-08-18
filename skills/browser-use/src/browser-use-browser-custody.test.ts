import { describe, expect, test } from "bun:test";
import {
	acquireBrowserLaneLease,
	acquireTargetOperationLease,
	browserAuthorityIdOf,
	heartbeatBrowserLaneLease,
	heartbeatTargetOperationLease,
	releaseBrowserLaneLease,
	releaseRunTargetOwnership,
	releaseTargetOperationLease,
} from "./browser-use-browser-custody";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";

async function fixture() {
	const xdg = makeTempXdgEnv();
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	let now = 1_000;
	return {
		deps: { fs, paths: opened.paths, clock: () => now },
		advance: (durationMs: number) => {
			now += durationMs;
		},
		cleanup: () => xdg.dispose(),
	};
}

const AUTHORITY = browserAuthorityIdOf({
	environmentName: "agent-chrome",
	environmentProfile: "default",
	endpointHttp: "http://127.0.0.1:9242",
	endpointWs: "ws://127.0.0.1:9242/devtools/browser/authority-a",
});

function creationReceipt(
	runId: string,
	rawTargetId: string,
	adapterId:
		| "agent-browser"
		| "chrome-devtools-mcp"
		| "playwright-cdp" = "agent-browser",
) {
	return {
		kind: "adapter-creation-receipt" as const,
		adapter_id: adapterId,
		run_id: runId,
		raw_target_id: rawTargetId,
	};
}

describe("Browser custody", () => {
	test("one run retains ownership across adapter changes and another run refuses", async () => {
		const state = await fixture();
		try {
			const created = await acquireTargetOperationLease(state.deps, {
				authorityId: AUTHORITY,
				runId: "Alpha",
				adapterId: "agent-browser",
				rawTargetId: "target-alpha",
				operation: "read",
				ttlMs: 30_000,
				ownershipEvidence: creationReceipt("Alpha", "target-alpha"),
			});
			expect(created).toMatchObject({ ok: true, first_ownership: true });
			if (!created.ok) throw new Error("creation failed");
			await releaseTargetOperationLease(state.deps, created.lease);

			const crossAdapter = await acquireTargetOperationLease(state.deps, {
				authorityId: AUTHORITY,
				runId: "Alpha",
				adapterId: "playwright-cdp",
				rawTargetId: "target-alpha",
				operation: "action",
				ttlMs: 30_000,
			});
			expect(crossAdapter).toMatchObject({ ok: true, first_ownership: false });
			if (!crossAdapter.ok) throw new Error("cross adapter failed");
			await releaseTargetOperationLease(state.deps, crossAdapter.lease);

			const refused = await acquireTargetOperationLease(state.deps, {
				authorityId: AUTHORITY,
				runId: "Bravo",
				adapterId: "chrome-devtools-mcp",
				rawTargetId: "target-alpha",
				operation: "close",
				ttlMs: 30_000,
				ownershipEvidence: creationReceipt(
					"Bravo",
					"target-alpha",
					"playwright-cdp",
				),
			});
			expect(refused).toMatchObject({
				ok: false,
				code: "target_owned_by_other_run",
			});
		} finally {
			await state.cleanup();
		}
	});

	test("first ownership refuses absent or mismatched evidence", async () => {
		const state = await fixture();
		try {
			const absent = await acquireTargetOperationLease(state.deps, {
				authorityId: AUTHORITY,
				runId: "Alpha",
				adapterId: "agent-browser",
				rawTargetId: "target-alpha",
				operation: "adopt",
				ttlMs: 30_000,
			});
			expect(absent).toMatchObject({
				ok: false,
				code: "target_ownership_evidence_invalid",
			});

			const mismatched = await acquireTargetOperationLease(state.deps, {
				authorityId: AUTHORITY,
				runId: "Alpha",
				adapterId: "agent-browser",
				rawTargetId: "target-alpha",
				operation: "adopt",
				ttlMs: 30_000,
				ownershipEvidence: creationReceipt("Alpha", "target-other"),
			});
			expect(mismatched).toMatchObject({
				ok: false,
				code: "target_ownership_evidence_invalid",
			});

			const forgedCandidate = await acquireTargetOperationLease(state.deps, {
				authorityId: AUTHORITY,
				runId: "Alpha",
				adapterId: "agent-browser",
				rawTargetId: "target-forged",
				operation: "adopt",
				ttlMs: 30_000,
				ownershipEvidence: {
					kind: "explicit-adoption",
					adapter_id: "agent-browser",
					run_id: "Alpha",
					raw_target_id: "target-forged",
					target_envelope_id: "a".repeat(32),
					target_candidate_id: "b".repeat(24),
					target_candidate_identity: { kind: "cdp-target-id" },
				},
			});
			expect(forgedCandidate).toMatchObject({
				ok: false,
				code: "target_ownership_evidence_invalid",
			});
		} finally {
			await state.cleanup();
		}
	});

	test("bounded real concurrency produces one target owner", async () => {
		const state = await fixture();
		try {
			const inputs = ["Alpha", "Bravo"].map((runId) =>
				acquireTargetOperationLease(state.deps, {
					authorityId: AUTHORITY,
					runId,
					adapterId: "agent-browser" as const,
					rawTargetId: "target-race",
					operation: "read" as const,
					ttlMs: 30_000,
					ownershipEvidence: creationReceipt(runId, "target-race"),
				}),
			);
			const results = await Promise.all(inputs);
			expect(results.filter((result) => result.ok)).toHaveLength(1);
			expect(results.filter((result) => !result.ok)).toHaveLength(1);
			expect(results.find((result) => !result.ok)).toMatchObject({
				code: "target_lease_held",
			});
			for (const result of results) {
				if (result.ok) await releaseTargetOperationLease(state.deps, result.lease);
			}
		} finally {
			await state.cleanup();
		}
	});

	test("an expired owner cannot permanently strand a target", async () => {
		const state = await fixture();
		try {
			const alpha = await acquireTargetOperationLease(state.deps, {
				authorityId: AUTHORITY,
				runId: "Alpha",
				adapterId: "agent-browser",
				rawTargetId: "target-recoverable",
				operation: "read",
				ttlMs: 100,
				ownershipEvidence: creationReceipt("Alpha", "target-recoverable"),
			});
			if (!alpha.ok) throw new Error("alpha setup failed");
			await releaseTargetOperationLease(state.deps, alpha.lease);
			state.advance(101);

			const bravo = await acquireTargetOperationLease(state.deps, {
				authorityId: AUTHORITY,
				runId: "Bravo",
				adapterId: "chrome-devtools-mcp",
				rawTargetId: "target-recoverable",
				operation: "read",
				ttlMs: 100,
				ownershipEvidence: creationReceipt(
					"Bravo",
					"target-recoverable",
					"chrome-devtools-mcp",
				),
			});
			expect(bravo).toMatchObject({ ok: true, first_ownership: true });
			if (bravo.ok) await releaseTargetOperationLease(state.deps, bravo.lease);
		} finally {
			await state.cleanup();
		}
	});

	test("a Target Lease heartbeat extends both operation custody and target ownership", async () => {
		const state = await fixture();
		try {
			const acquired = await acquireTargetOperationLease(state.deps, {
				authorityId: AUTHORITY,
				runId: "Alpha",
				adapterId: "agent-browser",
				rawTargetId: "target-renewed",
				operation: "read",
				ttlMs: 100,
				ownershipEvidence: creationReceipt("Alpha", "target-renewed"),
			});
			if (!acquired.ok) throw new Error("target setup failed");
			state.advance(60);
			const heartbeat = await heartbeatTargetOperationLease(
				state.deps,
				acquired.lease,
				{ ttlMs: 100 },
			);
			expect(heartbeat.ok).toBe(true);
			if (!heartbeat.ok) throw new Error("target heartbeat failed");
			await releaseTargetOperationLease(state.deps, heartbeat.lease);
			state.advance(60);

			const sameRun = await acquireTargetOperationLease(state.deps, {
				authorityId: AUTHORITY,
				runId: "Alpha",
				adapterId: "playwright-cdp",
				rawTargetId: "target-renewed",
				operation: "action",
				ttlMs: 100,
			});
			expect(sameRun).toMatchObject({ ok: true, first_ownership: false });
			if (sameRun.ok) {
				await releaseTargetOperationLease(state.deps, sameRun.lease);
			}
		} finally {
			await state.cleanup();
		}
	});

	test("Browser Lane contention refuses before mutation and admits after release", async () => {
		const state = await fixture();
		try {
			const alpha = await acquireBrowserLaneLease(state.deps, {
				authorityId: AUTHORITY,
				runId: "Alpha",
				mutation: "viewport",
				ttlMs: 30_000,
			});
			expect(alpha.ok).toBe(true);
			if (!alpha.ok) throw new Error("alpha lane failed");
			const bravoHeld = await acquireBrowserLaneLease(state.deps, {
				authorityId: AUTHORITY,
				runId: "Bravo",
				mutation: "capture",
				ttlMs: 30_000,
			});
			expect(bravoHeld).toMatchObject({ ok: false, code: "browser_lane_held" });
			await releaseBrowserLaneLease(state.deps, alpha.lease);
			const bravo = await acquireBrowserLaneLease(state.deps, {
				authorityId: AUTHORITY,
				runId: "Bravo",
				mutation: "capture",
				ttlMs: 30_000,
			});
			expect(bravo.ok).toBe(true);
			if (bravo.ok) await releaseBrowserLaneLease(state.deps, bravo.lease);
		} finally {
			await state.cleanup();
		}
	});

	test("a Browser Lane heartbeat keeps a second run fenced past the original expiry", async () => {
		const state = await fixture();
		try {
			const acquired = await acquireBrowserLaneLease(state.deps, {
				authorityId: AUTHORITY,
				runId: "Alpha",
				mutation: "capture",
				ttlMs: 100,
			});
			if (!acquired.ok) throw new Error("lane setup failed");
			state.advance(60);
			const heartbeat = await heartbeatBrowserLaneLease(
				state.deps,
				acquired.lease,
				{ ttlMs: 100 },
			);
			expect(heartbeat.ok).toBe(true);
			if (!heartbeat.ok) throw new Error("lane heartbeat failed");
			state.advance(60);
			const refused = await acquireBrowserLaneLease(state.deps, {
				authorityId: AUTHORITY,
				runId: "Bravo",
				mutation: "viewport",
				ttlMs: 100,
			});
			expect(refused).toMatchObject({ ok: false, code: "browser_lane_held" });
			await releaseBrowserLaneLease(state.deps, heartbeat.lease);
		} finally {
			await state.cleanup();
		}
	});

	test("releasing one run preserves another run's target ownership", async () => {
		const state = await fixture();
		try {
			for (const [runId, targetId] of [
				["Alpha", "target-alpha"],
				["Bravo", "target-bravo"],
			] as const) {
				const acquired = await acquireTargetOperationLease(state.deps, {
					authorityId: AUTHORITY,
					runId,
					adapterId: "agent-browser",
					rawTargetId: targetId,
					operation: "read",
					ttlMs: 30_000,
					ownershipEvidence: creationReceipt(runId, targetId),
				});
				if (!acquired.ok) throw new Error("target setup failed");
				await releaseTargetOperationLease(state.deps, acquired.lease);
			}
			expect(await releaseRunTargetOwnership(state.deps, "Alpha")).toEqual({
				ok: true,
				released: 1,
			});
			const bravo = await acquireTargetOperationLease(state.deps, {
				authorityId: AUTHORITY,
				runId: "Bravo",
				adapterId: "playwright-cdp",
				rawTargetId: "target-bravo",
				operation: "read",
				ttlMs: 30_000,
			});
			expect(bravo).toMatchObject({ ok: true, first_ownership: false });
			if (bravo.ok) await releaseTargetOperationLease(state.deps, bravo.lease);
		} finally {
			await state.cleanup();
		}
	});
});
