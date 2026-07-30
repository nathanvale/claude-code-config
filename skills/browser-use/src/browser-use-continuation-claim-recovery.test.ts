import { afterAll, describe, expect, test } from "bun:test";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import type {
	BrowserUseAuthRunContinuation,
	BrowserUseSharedRun,
} from "./browser-use-run-model";
import { isBrowserUseAuthRunContinuation } from "./browser-use-run-model";
import {
	BROWSER_USE_EXTERNAL_EFFECT_NONE,
	claimRunContinuation,
	createSharedRun,
	loadSharedRun,
	recoverRunContinuationPreEffectClaim,
	type RunStoreDeps,
} from "./browser-use-runs";
import { readDurableFile } from "./browser-use-store";

const disposables: { dispose(): void }[] = [];

afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

async function makeDeps(): Promise<RunStoreDeps> {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return { fs, paths: opened.paths, clock: fixedClock().now };
}

function authContinuation(
	runId: string,
	overrides: Partial<BrowserUseAuthRunContinuation> = {},
): BrowserUseAuthRunContinuation {
	return {
		schema_version: "1",
		kind: "auth",
		continuation_id: `continuation-${runId}`,
		run_id: runId,
		state: "pending",
		reason: "login-required",
		required_actor: "agent",
		safe_to_retry: false,
		checkpoint: "before-auth-delivery",
		expires_at_epoch_ms: 10_000,
		resume_action: {
			command: "run",
			args: ["resume", "--run", runId, "--json"],
		},
		bindings: {
			generation_id: "generation-a",
			activation_epoch: 3,
			route_digest: "a".repeat(64),
			lane_id: "daily-work",
			adapter_id: "agent-browser",
			handoff_evidence_id: "handoff-a",
			environment: "agent-chrome",
			profile: "default",
			target_binding_id: "target-a",
			expected_identity: {
				subject_ref: "subject-a",
				account_ref: "account-a",
				tenant_ref: "tenant-a",
			},
		},
		next_action_id: "resume-auth-continuation",
		summary: "Resume the exact auth continuation.",
		...overrides,
	};
}

function blockedRun(
	runId: string,
	continuation: BrowserUseAuthRunContinuation,
): Omit<BrowserUseSharedRun, "revision"> {
	return {
		run_id: runId,
		state: "awaiting-auth",
		task_intent: "runbook-execution",
		environment_profile: {
			environment: "agent-chrome",
			profile: "default",
		},
		adapter_id: "agent-browser",
		handoff_evidence_id: "handoff-a",
		mutation_dispatched: false,
		artifacts: [],
		continuation,
	};
}

async function createClaimedRun(
	deps: RunStoreDeps,
	runId: string,
	claimantId = "orchestrator-a",
): Promise<BrowserUseSharedRun> {
	const continuation = authContinuation(runId);
	const created = await createSharedRun(deps, blockedRun(runId, continuation));
	expect(created.ok).toBe(true);
	if (!created.ok) throw new Error("unreachable");
	const claimed = await claimRunContinuation(deps, {
		runId,
		continuationId: continuation.continuation_id,
		expectedRevision: created.run.revision,
		claimantId,
		actor: "agent",
	});
	expect(claimed.status).toBe("claimed");
	if (claimed.status !== "claimed") throw new Error("unreachable");
	return claimed.run;
}

async function rawRun(deps: RunStoreDeps, runId: string): Promise<string> {
	const read = await readDurableFile(deps.fs, deps.paths.state.runFile(runId));
	expect(read.status).toBe("present");
	if (read.status !== "present") throw new Error("unreachable");
	return read.raw;
}

function claimedAuthContinuation(
	run: BrowserUseSharedRun,
): BrowserUseAuthRunContinuation {
	const continuation = run.continuation;
	expect(isBrowserUseAuthRunContinuation(continuation)).toBe(true);
	if (!isBrowserUseAuthRunContinuation(continuation)) {
		throw new Error("unreachable");
	}
	return continuation;
}

describe("recoverRunContinuationPreEffectClaim", () => {
	test("atomically returns the matching pre-effect claim to pending without changing its binding", async () => {
		const deps = await makeDeps();
		const claimedRun = await createClaimedRun(deps, "run-recover-success");
		const claimed = claimedAuthContinuation(claimedRun);
		const { claim: _claim, state: _state, ...immutableContinuation } = claimed;

		const recovered = await recoverRunContinuationPreEffectClaim(deps, {
			runId: claimedRun.run_id,
			continuationId: claimed.continuation_id,
			expectedRevision: claimedRun.revision,
			claimantId: claimed.claim?.claimant_id ?? "",
			external_effect: BROWSER_USE_EXTERNAL_EFFECT_NONE,
		});

		expect(recovered).toMatchObject({
			status: "recovered",
			run: { revision: claimedRun.revision + 1 },
			continuation: { state: "pending" },
		});
		if (recovered.status !== "recovered") throw new Error("unreachable");
		expect(recovered.continuation).toEqual({
			...immutableContinuation,
			state: "pending",
		});
		expect(recovered.continuation).not.toHaveProperty("claim");
		const loaded = await loadSharedRun(deps, claimedRun.run_id);
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) throw new Error("unreachable");
		expect(loaded.run).toEqual(recovered.run);
	});

	test("rejects a stale revision after the same continuation and claimant complete an ABA cycle", async () => {
		const deps = await makeDeps();
		const firstClaim = await createClaimedRun(deps, "run-recover-aba");
		const continuation = claimedAuthContinuation(firstClaim);
		const firstClaimRevision = firstClaim.revision;
		const claimantId = continuation.claim?.claimant_id ?? "";

		const firstRecovery = await recoverRunContinuationPreEffectClaim(deps, {
			runId: firstClaim.run_id,
			continuationId: continuation.continuation_id,
			expectedRevision: firstClaimRevision,
			claimantId,
			external_effect: BROWSER_USE_EXTERNAL_EFFECT_NONE,
		});
		expect(firstRecovery.status).toBe("recovered");
		if (firstRecovery.status !== "recovered") throw new Error("unreachable");
		const secondClaim = await claimRunContinuation(deps, {
			runId: firstClaim.run_id,
			continuationId: continuation.continuation_id,
			expectedRevision: firstRecovery.run.revision,
			claimantId,
			actor: "agent",
		});
		expect(secondClaim.status).toBe("claimed");
		if (secondClaim.status !== "claimed") throw new Error("unreachable");
		const before = await rawRun(deps, firstClaim.run_id);

		expect(
			await recoverRunContinuationPreEffectClaim(deps, {
				runId: firstClaim.run_id,
				continuationId: continuation.continuation_id,
				expectedRevision: firstClaimRevision,
				claimantId,
				external_effect: BROWSER_USE_EXTERNAL_EFFECT_NONE,
			}),
		).toMatchObject({
			status: "mismatch",
			kind: "revision",
			run: { revision: secondClaim.run.revision },
		});
		expect(await rawRun(deps, firstClaim.run_id)).toBe(before);
	});

	test("rejects another claimant and preserves the standing claim bytes", async () => {
		const deps = await makeDeps();
		const claimedRun = await createClaimedRun(
			deps,
			"run-recover-other-claimant",
		);
		const continuation = claimedAuthContinuation(claimedRun);
		const before = await rawRun(deps, claimedRun.run_id);

		expect(
			await recoverRunContinuationPreEffectClaim(deps, {
				runId: claimedRun.run_id,
				continuationId: continuation.continuation_id,
				expectedRevision: claimedRun.revision,
				claimantId: "orchestrator-b",
				external_effect: BROWSER_USE_EXTERNAL_EFFECT_NONE,
			}),
		).toMatchObject({
			status: "mismatch",
			kind: "claimant-id",
			run: { revision: claimedRun.revision },
		});
		expect(await rawRun(deps, claimedRun.run_id)).toBe(before);
	});

	test("never releases in-progress or terminal continuation states", async () => {
		const deps = await makeDeps();
		for (const state of ["in-progress", "completed"] as const) {
			const runId = `run-recover-${state}`;
			const continuation = authContinuation(runId, {
				state,
				claim: {
					claimant_id: "orchestrator-a",
					claimed_at_epoch_ms: 1_000,
				},
			});
			const created = await createSharedRun(
				deps,
				blockedRun(runId, continuation),
			);
			expect(created.ok).toBe(true);
			if (!created.ok) throw new Error("unreachable");
			const before = await rawRun(deps, runId);

			expect(
				await recoverRunContinuationPreEffectClaim(deps, {
					runId,
					continuationId: continuation.continuation_id,
					expectedRevision: created.run.revision,
					claimantId: "orchestrator-a",
					external_effect: BROWSER_USE_EXTERNAL_EFFECT_NONE,
				}),
			).toMatchObject({
				status: "not-recoverable",
				kind: "state",
				run: { revision: created.run.revision },
			});
			expect(await rawRun(deps, runId)).toBe(before);
		}
	});

	test("fails closed when the external-effect observation is not exactly none", async () => {
		const deps = await makeDeps();
		const claimedRun = await createClaimedRun(
			deps,
			"run-recover-unknown-effect",
		);
		const continuation = claimedAuthContinuation(claimedRun);
		const before = await rawRun(deps, claimedRun.run_id);

		expect(
			await recoverRunContinuationPreEffectClaim(deps, {
				runId: claimedRun.run_id,
				continuationId: continuation.continuation_id,
				expectedRevision: claimedRun.revision,
				claimantId: continuation.claim?.claimant_id ?? "",
				external_effect:
					"browser-started" as typeof BROWSER_USE_EXTERNAL_EFFECT_NONE,
			}),
		).toEqual({
			status: "not-recoverable",
			kind: "external-effect",
		});
		expect(await rawRun(deps, claimedRun.run_id)).toBe(before);
	});
});
