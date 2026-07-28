import { describe, expect, test } from "bun:test";
import {
	BROWSER_USE_BLOCKED_RUN_STATES,
	BROWSER_USE_RUN_STATES,
	BROWSER_USE_TASK_INTENT_DEFINITIONS,
	BROWSER_USE_TASK_INTENTS,
	BROWSER_USE_TERMINAL_RUN_STATES,
	type BrowserUseAuthFragmentSlot,
	type BrowserUseSharedRun,
	applyAuthCommit,
	checkSameLaneResume,
	classifyCancellation,
	revalidateAuthAttestation,
	validateSharedRun,
} from "./browser-use-run-model";

// =========================================================================
// Shared Browser Use run model (platform plan 2026-07-21-002 U1).
//
// Pure-model proof of the U1 scenarios: typed awaiting-auth, stale auth
// outcome, same-lane resume, mismatched profile, and cancel after possible
// mutation. Persistence lands in U2; these guards are the semantics it wraps.
// =========================================================================

const FRAGMENT: BrowserUseAuthFragmentSlot = {
	schema_version: "1",
	fragment: { opaque: "auth-owned" },
};

const AUTH_CONTRACT = {
	validateSecretFreeFragment: (fragment: BrowserUseAuthFragmentSlot) =>
		fragment === FRAGMENT,
	verifyAttestation: async () => true,
};

const RUNBOOK_TARGET_BINDING = {
	schema_version: "1",
	mode: "automatic",
	binding_id: "candidate-opaque-1",
} as const;

const RUNBOOK_PROGRESS = {
	schema_version: "1",
	service_id: "oncore",
	flow_id: "snapshot-verify",
	runbook_version: "1",
	next_step: 1,
	total_steps: 2,
} as const;

function baseRun(overrides: Partial<BrowserUseSharedRun> = {}): BrowserUseSharedRun {
	return {
		run_id: "run-1",
		revision: 3,
		state: "running",
		task_intent: "routine-automation",
		environment_profile: { environment: "agent-chrome", profile: "default" },
		adapter_id: "agent-browser",
		handoff_evidence_id: "evidence-1",
		mutation_dispatched: false,
		artifacts: [],
		...overrides,
	};
}

describe("run state vocabulary (R24)", () => {
	test("run states carry the nine plan states, blocked and terminal subsets included", () => {
		expect(BROWSER_USE_RUN_STATES).toEqual([
			"awaiting-auth",
			"awaiting-approval",
			"awaiting-user-presence",
			"ready",
			"running",
			"confirmed",
			"not-achieved",
			"unknown",
			"needs-human",
		]);
		for (const state of BROWSER_USE_BLOCKED_RUN_STATES) {
			expect(BROWSER_USE_RUN_STATES).toContain(state);
		}
		for (const state of BROWSER_USE_TERMINAL_RUN_STATES) {
			expect(BROWSER_USE_RUN_STATES).toContain(state);
		}
	});

	test("a blocked awaiting-auth run without a continuation is a typed issue", () => {
		const issues = validateSharedRun(baseRun({ state: "awaiting-auth" }));
		expect(issues).toEqual([
			expect.objectContaining({ code: "run_blocked_without_continuation" }),
		]);
	});

	test("a blocked run with exactly one continuation validates clean", () => {
		const issues = validateSharedRun(
			baseRun({
				state: "awaiting-auth",
				continuation: {
					next_action_id: "prepare_auth_binding",
					summary: "Prepare the credential binding, then resume this run.",
				},
			}),
		);
		expect(issues).toEqual([]);
	});

	test("ready without a committed attestation is a typed issue (R6)", () => {
		const issues = validateSharedRun(baseRun({ state: "ready" }));
		expect(issues).toEqual([
			expect.objectContaining({ code: "run_ready_without_attestation" }),
		]);
	});

	test("an unregistered adapter id is a typed issue", () => {
		const issues = validateSharedRun(
			baseRun({ adapter_id: "cold-browser" as never }),
		);
		expect(issues).toEqual([
			expect.objectContaining({ code: "run_adapter_unregistered" }),
		]);
	});

	test("a private target binding requires a handoff-bound Agent Browser runbook run", () => {
		const valid = validateSharedRun(
			baseRun({
				task_intent: "runbook-execution",
				runbook_target_binding: RUNBOOK_TARGET_BINDING,
				runbook_progress: RUNBOOK_PROGRESS,
			}),
		);
		expect(valid).toEqual([]);

		const invalid = validateSharedRun(
			baseRun({
				task_intent: "runbook-execution",
				handoff_evidence_id: undefined,
				runbook_target_binding: RUNBOOK_TARGET_BINDING,
				runbook_progress: RUNBOOK_PROGRESS,
			}),
		);
		expect(invalid).toEqual([
			expect.objectContaining({ code: "runbook_target_binding_invalid" }),
		]);
	});

	test("runbook progress validates identity and bounded cursor", () => {
		expect(
			validateSharedRun(
				baseRun({
					task_intent: "runbook-execution",
					runbook_target_binding: RUNBOOK_TARGET_BINDING,
					runbook_progress: RUNBOOK_PROGRESS,
				}),
			),
		).toEqual([]);

		expect(
			validateSharedRun(
				baseRun({
					task_intent: "runbook-execution",
					runbook_target_binding: RUNBOOK_TARGET_BINDING,
					runbook_progress: {
						...RUNBOOK_PROGRESS,
						next_step: 3,
					},
				}),
			),
		).toEqual([expect.objectContaining({ code: "runbook_progress_invalid" })]);
	});

	test("runbook target and progress state must be committed as a pair", () => {
		for (const privateState of [
			{ runbook_target_binding: RUNBOOK_TARGET_BINDING },
			{ runbook_progress: RUNBOOK_PROGRESS },
		]) {
			expect(
				validateSharedRun(
					baseRun({
						task_intent: "runbook-execution",
						...privateState,
					}),
				),
			).toEqual([
				expect.objectContaining({ code: "runbook_private_state_incomplete" }),
			]);
		}
	});
});

describe("auth integration Port semantics (R6, KTD10)", () => {
	test("a matching revision commits fragment plus summary at revision + 1", () => {
		const run = baseRun({ state: "awaiting-auth", continuation: {
			next_action_id: "prepare_auth_binding",
			summary: "Prepare the credential binding, then resume this run.",
		} });
		const result = applyAuthCommit(
			run,
			{
				expected_revision: 3,
				fragment: FRAGMENT,
				summary: {
					state: "ready",
					attestation: {
						attestation_digest: "digest-1",
						fresh_until_epoch_ms: 10_000,
					},
				},
			},
			AUTH_CONTRACT,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.run.revision).toBe(4);
		expect(result.run.state).toBe("ready");
		// The fragment is stored verbatim and stays opaque to the platform.
		expect(result.run.auth_fragment).toEqual(FRAGMENT);
		// A ready run carries no blocked continuation.
		expect(result.run.continuation).toBeUndefined();
		// The input run is untouched (pure reducer).
		expect(run.revision).toBe(3);
	});

	test("a stale revision is a typed compare-and-swap rejection", () => {
		const result = applyAuthCommit(
			baseRun(),
			{
				expected_revision: 2,
				fragment: FRAGMENT,
				summary: {
					state: "awaiting-approval",
					continuation: {
						next_action_id: "request_approval",
						summary: "Request the signed approval, then resume.",
					},
				},
			},
			AUTH_CONTRACT,
		);
		expect(result).toEqual({
			ok: false,
			rejection: expect.objectContaining({ code: "run_revision_stale" }),
		});
	});

	test("ready without an attestation reference is rejected (R6)", () => {
		const result = applyAuthCommit(
			baseRun(),
			{
				expected_revision: 3,
				fragment: FRAGMENT,
				summary: { state: "ready" },
			},
			AUTH_CONTRACT,
		);
		expect(result).toEqual({
			ok: false,
			rejection: expect.objectContaining({ code: "run_ready_without_attestation" }),
		});
	});

	test("a blocked auth state without a continuation is rejected (typed awaiting-auth)", () => {
		const result = applyAuthCommit(
			baseRun(),
			{
				expected_revision: 3,
				fragment: FRAGMENT,
				summary: { state: "awaiting-auth" },
			},
			AUTH_CONTRACT,
		);
		expect(result).toEqual({
			ok: false,
			rejection: expect.objectContaining({
				code: "run_blocked_without_continuation",
			}),
		});
	});

	for (const state of BROWSER_USE_TERMINAL_RUN_STATES) {
		test(`terminal state ${state} rejects auth re-entry`, () => {
			const result = applyAuthCommit(
				baseRun({ state }),
				{
					expected_revision: 3,
					fragment: FRAGMENT,
					summary: {
						state: "awaiting-auth",
						continuation: {
							next_action_id: "prepare_auth_binding",
							summary:
								"Prepare the credential binding, then resume this run.",
						},
					},
				},
				AUTH_CONTRACT,
			);
			expect(result).toEqual({
				ok: false,
				rejection: expect.objectContaining({ code: "run_terminal" }),
			});
		});
	}

	test("a blocked outcome clears a stale attestation", () => {
		const result = applyAuthCommit(
			baseRun({
				state: "ready",
				auth_attestation: {
					attestation_digest: "stale-digest",
					fresh_until_epoch_ms: 10_000,
				},
			}),
			{
				expected_revision: 3,
				fragment: FRAGMENT,
				summary: {
					state: "awaiting-user-presence",
					continuation: {
						next_action_id: "satisfy_user_presence",
						summary: "Complete user presence, then resume.",
					},
				},
			},
			AUTH_CONTRACT,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.run.auth_attestation).toBeUndefined();
	});

	test("a blocked outcome carrying an attestation is rejected", () => {
		const result = applyAuthCommit(
			baseRun(),
			{
				expected_revision: 3,
				fragment: FRAGMENT,
				summary: {
					state: "awaiting-auth",
					attestation: {
						attestation_digest: "must-not-survive",
						fresh_until_epoch_ms: 10_000,
					},
					continuation: {
						next_action_id: "prepare_auth_binding",
						summary: "Prepare the auth binding, then resume.",
					},
				},
			},
			AUTH_CONTRACT,
		);
		expect(result).toEqual({
			ok: false,
			rejection: expect.objectContaining({
				code: "run_blocked_with_attestation",
			}),
		});
	});

	test("a fragment rejected by the auth-owned validator is never committed", () => {
		const unsafeFragment = {
			schema_version: "1",
			fragment: { password: "sentinel-secret" },
		};
		const result = applyAuthCommit(
			baseRun(),
			{
				expected_revision: 3,
				fragment: unsafeFragment,
				summary: {
					state: "awaiting-auth",
					continuation: {
						next_action_id: "repair_auth_fragment",
						summary: "Repair the auth fragment, then resume.",
					},
				},
			},
			{
				validateSecretFreeFragment: () => false,
			},
		);
		expect(result).toEqual({
			ok: false,
			rejection: expect.objectContaining({ code: "auth_fragment_unsafe" }),
		});
	});
});

describe("attestation revalidation before mutation (R6/R30)", () => {
	const attested = baseRun({
		auth_attestation: {
			attestation_digest: "digest-1",
			fresh_until_epoch_ms: 10_000,
		},
	});
	const observedNow = {
		at_epoch_ms: 5_000,
		adapter_id: "agent-browser" as const,
		handoff_evidence_id: "evidence-1",
	};

	test("a fresh attestation on the same lane and handoff is valid", async () => {
		expect(
			await revalidateAuthAttestation(attested, observedNow, AUTH_CONTRACT),
		).toEqual({
			valid: true,
		});
	});

	test("a missing attestation is typed, never waved through", async () => {
		expect(
			await revalidateAuthAttestation(baseRun(), observedNow, AUTH_CONTRACT),
		).toEqual({
			valid: false,
			code: "attestation_missing",
			message: expect.any(String),
		});
	});

	test("freshness expiry invalidates the attestation (stale auth outcome)", async () => {
		expect(
			await revalidateAuthAttestation(
				attested,
				{ ...observedNow, at_epoch_ms: 10_001 },
				AUTH_CONTRACT,
			),
		).toEqual({
			valid: false,
			code: "attestation_expired",
			message: expect.any(String),
		});
	});

	test("an adapter lane change invalidates the attestation", async () => {
		expect(
			await revalidateAuthAttestation(attested, {
				...observedNow,
				adapter_id: "playwright-cdp",
			}, AUTH_CONTRACT),
		).toEqual({
			valid: false,
			code: "attestation_lane_changed",
			message: expect.any(String),
		});
	});

	test("a handoff change invalidates the attestation", async () => {
		expect(
			await revalidateAuthAttestation(attested, {
				...observedNow,
				handoff_evidence_id: "evidence-2",
			}, AUTH_CONTRACT),
		).toEqual({
			valid: false,
			code: "attestation_handoff_changed",
			message: expect.any(String),
		});
	});

	test("a blocked run cannot authorize mutation with an old attestation", async () => {
		expect(
			await revalidateAuthAttestation(
				{
					...attested,
					state: "awaiting-auth",
					continuation: {
						next_action_id: "prepare_auth_binding",
						summary: "Prepare the auth binding, then resume.",
					},
				},
				observedNow,
				AUTH_CONTRACT,
			),
		).toEqual({
			valid: false,
			code: "attestation_state_invalid",
			message: expect.any(String),
		});
	});

	test("missing run lane and handoff bindings fail closed", async () => {
		expect(
			await revalidateAuthAttestation(
				{ ...attested, adapter_id: undefined },
				observedNow,
				AUTH_CONTRACT,
			),
		).toMatchObject({ valid: false, code: "attestation_lane_changed" });
		expect(
			await revalidateAuthAttestation(
				{ ...attested, handoff_evidence_id: undefined },
				observedNow,
				AUTH_CONTRACT,
			),
		).toMatchObject({ valid: false, code: "attestation_handoff_changed" });
	});

	test("the auth-owned verifier rejects forged or drifted bindings", async () => {
		expect(
			await revalidateAuthAttestation(attested, observedNow, {
				verifyAttestation: async () => false,
			}),
		).toEqual({
			valid: false,
			code: "attestation_binding_invalid",
			message: expect.any(String),
		});
	});
});

describe("same-lane resume (R28)", () => {
	const profile = { environment: "agent-chrome", profile: "default" };

	test("resume on the original lane and profile is allowed", async () => {
		expect(
			checkSameLaneResume(baseRun(), {
				adapter_id: "agent-browser",
				environment_profile: profile,
			}),
		).toEqual({ ok: true });
	});

	test("an adapter change is a typed lane-mismatch refusal, never a switch", () => {
		expect(
			checkSameLaneResume(baseRun(), {
				adapter_id: "chrome-devtools-mcp",
				environment_profile: profile,
			}),
		).toEqual({
			ok: false,
			code: "run_lane_mismatch",
			message: expect.any(String),
		});
	});

	test("an unbound run lane cannot resume", () => {
		expect(
			checkSameLaneResume(baseRun({ adapter_id: undefined }), {
				adapter_id: "agent-browser",
				environment_profile: profile,
			}),
		).toEqual({
			ok: false,
			code: "run_lane_unbound",
			message: expect.any(String),
		});
	});

	test("a mismatched profile is a typed identity refusal (KTD13)", () => {
		expect(
			checkSameLaneResume(baseRun(), {
				adapter_id: "agent-browser",
				environment_profile: { environment: "agent-chrome", profile: "second" },
			}),
		).toEqual({
			ok: false,
			code: "run_profile_mismatch",
			message: expect.any(String),
		});
	});

	test("a mismatched environment is a typed identity refusal (KTD13)", () => {
		expect(
			checkSameLaneResume(baseRun(), {
				adapter_id: "agent-browser",
				environment_profile: {
					environment: "foreign-environment",
					profile: "default",
				},
			}),
		).toEqual({
			ok: false,
			code: "run_profile_mismatch",
			message: expect.any(String),
		});
	});
});

describe("cancellation truth (R26, R37)", () => {
	test("cancel before any dispatched mutation reports no external effect", () => {
		expect(classifyCancellation(baseRun())).toEqual({
			external_effect: "none",
			rolled_back: false,
		});
	});

	test("cancel after a possible mutation reports unknown and never rollback", () => {
		expect(
			classifyCancellation(baseRun({ mutation_dispatched: true })),
		).toEqual({
			external_effect: "unknown",
			rolled_back: false,
		});
	});
});

describe("task intent catalog (R21-R23)", () => {
	test("every task intent has exactly one definition row", () => {
		expect(BROWSER_USE_TASK_INTENT_DEFINITIONS.map((d) => d.task_intent)).toEqual(
			[...BROWSER_USE_TASK_INTENTS],
		);
	});

	test("trace inspection, runbook execution, and HTTP replay stay distinct intents (R22)", () => {
		const ids = new Set(BROWSER_USE_TASK_INTENTS);
		expect(ids.has("trace-inspection")).toBe(true);
		expect(ids.has("runbook-execution")).toBe(true);
		expect(ids.has("http-replay")).toBe(true);
	});

	test("lighthouse audit and performance profiling stay distinct intents (R23)", () => {
		const ids = new Set(BROWSER_USE_TASK_INTENTS);
		expect(ids.has("lighthouse-audit")).toBe(true);
		expect(ids.has("performance-profile")).toBe(true);
	});
});

// --- U3: immutable execution binding + item-batch validation (R38, R12) ------

const EXEC_BINDING = {
	schema_version: "1",
	generation_id: "gen-a",
	activation_epoch: 3,
	service_id: "oncore",
	flow_id: "fill-timesheet",
	runbook_version: "1.0.0",
	runbook_digest: "a".repeat(64),
	action_registry_digest: "b".repeat(64),
	normalized_input_digest: "c".repeat(64),
	item_key_digest: "d".repeat(64),
	target_scope: "https://portal.example.com",
	postcondition: { id: "saved", summary: "draft saved" },
} as const;

describe("run execution binding validation (R38)", () => {
	test("a well-formed binding passes", () => {
		expect(
			validateSharedRun(baseRun({ run_execution_binding: EXEC_BINDING })),
		).toEqual([]);
	});

	test("a binding carrying BOTH input-custody forms refuses (R41)", () => {
		const issues = validateSharedRun(
			baseRun({
				run_execution_binding: {
					...EXEC_BINDING,
					governed_input_artifact_ref: "artifact://x",
				},
			}),
		);
		expect(issues.map((i) => i.code)).toContain("run_execution_binding_invalid");
	});

	test("a binding with a short digest refuses", () => {
		const issues = validateSharedRun(
			baseRun({
				run_execution_binding: { ...EXEC_BINDING, action_registry_digest: "short" },
			}),
		);
		expect(issues.map((i) => i.code)).toContain("run_execution_binding_invalid");
	});
});

describe("run item-batch validation (R12)", () => {
	test("a well-formed batch passes", () => {
		expect(
			validateSharedRun(
				baseRun({
					item_batch: {
						schema_version: "1",
						item_keys: ["mon", "tue"],
						checkpoints: [{ item_key: "mon", outcome: "confirmed" }],
					},
				}),
			),
		).toEqual([]);
	});

	test("a checkpoint referencing a key outside the sequence refuses", () => {
		const issues = validateSharedRun(
			baseRun({
				item_batch: {
					schema_version: "1",
					item_keys: ["mon"],
					checkpoints: [{ item_key: "wed", outcome: "confirmed" }],
				},
			}),
		);
		expect(issues.map((i) => i.code)).toContain("run_item_batch_invalid");
	});
});
