import { describe, expect, test } from "bun:test";
import {
	BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE,
	type BrowserUseAuthTransactionFragment,
	validateAuthFragmentShape,
} from "./browser-use-auth-model";
import {
	type BrowserUseAuthTransactionEvent,
	type BrowserUseAuthTransactionStart,
	type BrowserUseAuthTransitionRejection,
	applyAuthTransition,
	beginAuthTransaction,
	resumeAuthTransactionAfterRestart,
} from "./browser-use-auth-transaction";

// =========================================================================
// Browser Authentication Transaction engine (auth plan U2, R14-R19/R21;
// AE4-AE6, AE11).
//
// Deterministic transition proof over the plan's scenario list: username-
// first / combined / password-only choreography, approved IdP re-proof,
// wrong credentials with human-gated retry budgets, OTP re-entry, lockout /
// rate limit / challenge escalation, submit timeout (unknown effect, AE6),
// competing agent wait (AE11), cancel truth before and after possible
// external effect, restart at every phase, and an illegal-event property
// sweep — every rejection is typed and every blocked state carries exactly
// one continuation.
// =========================================================================

const START: BrowserUseAuthTransactionStart = {
	binding: {
		run_id: "run-1",
		handoff_evidence_id: "evidence-1",
		lane_id: "agent-browser",
		environment: "agent-chrome",
		profile: "default",
		service_id: "oncore",
		auth_context: "timesheet",
		origin: "https://portal.example.com",
		target_id: "target-1",
		page_id: "page-1",
		frame_id: "frame-1",
	},
	method: "password",
	attempt_limit: 3,
	attempts_already_consumed: 0,
};

function begun(
	overrides: Partial<BrowserUseAuthTransactionStart> = {},
): BrowserUseAuthTransactionFragment {
	const result = beginAuthTransaction({ ...START, ...overrides });
	if (!result.ok) throw new Error(result.rejection.message);
	return result.fragment;
}

function drive(
	fragment: BrowserUseAuthTransactionFragment,
	events: readonly BrowserUseAuthTransactionEvent[],
): BrowserUseAuthTransactionFragment {
	let current = fragment;
	for (const event of events) {
		const result = applyAuthTransition(current, event);
		if (!result.ok) {
			throw new Error(`${event.type}: ${result.rejection.message}`);
		}
		current = result.fragment;
	}
	return current;
}

// Event paths to representative fragments at each phase.
const TO_SENSITIVE_INTERVAL: readonly BrowserUseAuthTransactionEvent[] = [
	{ type: "pre-auth-proved" },
	{ type: "preparation-complete" },
	{ type: "lease-granted" },
];

const USERNAME_FIRST_STEPS: readonly BrowserUseAuthTransactionEvent[] = [
	{ type: "method-step-complete", step: "identify-auth-state" },
	{ type: "method-step-complete", step: "select-account-context" },
	{ type: "method-step-complete", step: "fill-username" },
	{ type: "method-step-complete", step: "submit-username" },
	{ type: "method-step-complete", step: "reprove-target" },
	{ type: "method-step-complete", step: "fill-password" },
];

const TO_WRITE_AHEAD: readonly BrowserUseAuthTransactionEvent[] = [
	...TO_SENSITIVE_INTERVAL,
	...USERNAME_FIRST_STEPS,
	{ type: "submission-dispatched" },
];

function expectRejection(
	fragment: BrowserUseAuthTransactionFragment,
	event: BrowserUseAuthTransactionEvent,
	code: BrowserUseAuthTransitionRejection["code"],
): void {
	const result = applyAuthTransition(fragment, event);
	expect(result.ok).toBe(false);
	if (!result.ok) expect(result.rejection.code).toBe(code);
}

describe("begin (R1/R19)", () => {
	test("begin binds the handoff and derives the shared attempt budget key", () => {
		const fragment = begun();
		expect(fragment.phase).toBe("pre-auth-proof");
		expect(fragment.status).toBe("active");
		expect(fragment.attempt.budget_key).toBe(
			"oncore::timesheet::https://portal.example.com",
		);
		expect(validateAuthFragmentShape(fragment)).toEqual([]);
	});

	test("begin fails closed on an inadmissible binding", () => {
		const result = beginAuthTransaction({
			...START,
			binding: { ...START.binding, origin: "" },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.rejection.code).toBe("auth_fragment_invalid");
	});
});

describe("happy path → authenticated terminal truth", () => {
	test("username-first choreography reaches a bounded attestation", () => {
		const fragment = drive(begun(), [
			...TO_WRITE_AHEAD,
			{ type: "submit-outcome-observed", outcome: "success" },
			{ type: "cleanup-complete" },
			{
				type: "postcondition-proven",
				identity_basis: "session-identity-proof",
				identity_basis_digest: "basis-digest-1",
			},
			{
				type: "attestation-issued",
				attestation_digest: "attestation-digest-1",
				fresh_until_epoch_ms: 9_000,
			},
		]);
		expect(fragment.status).toBe("terminal");
		expect(fragment.terminal_outcome).toBe("authenticated");
		expect(fragment.attempt.consumed).toBe(1);
		expect(fragment.identity_basis).toBe("session-identity-proof");
		expect(validateAuthFragmentShape(fragment)).toEqual([]);
	});

	test("combined-form and password-only choreographies are expressible (R15)", () => {
		const combined = drive(begun(), [
			...TO_SENSITIVE_INTERVAL,
			{ type: "method-step-complete", step: "identify-auth-state" },
			{ type: "method-step-complete", step: "fill-username" },
			{ type: "method-step-complete", step: "reprove-target" },
			{ type: "method-step-complete", step: "fill-password" },
		]);
		expect(combined.method_step).toBe("fill-password");

		const passwordOnly = drive(begun(), [
			...TO_SENSITIVE_INTERVAL,
			{ type: "method-step-complete", step: "identify-auth-state" },
			{ type: "method-step-complete", step: "reprove-target" },
			{ type: "method-step-complete", step: "fill-password" },
		]);
		expect(passwordOnly.method_step).toBe("fill-password");
	});

	test("login already complete skips to post-auth proof and still needs identity basis (R25)", () => {
		const fragment = drive(begun({ method: "session-reuse" }), [
			{ type: "session-already-authenticated" },
		]);
		expect(fragment.phase).toBe("post-auth-proof");
		expect(fragment.submission_started).toBe(false);
	});

	test("a terminal transaction accepts no further event", () => {
		const fragment = drive(begun(), [{ type: "cancel" }]);
		expectRejection(fragment, { type: "pre-auth-proved" }, "auth_fragment_terminal");
	});
});

describe("delivery-proof anchors (R14, AE4)", () => {
	test("fill-password without an immediately preceding re-proof is rejected", () => {
		const fragment = drive(begun(), [
			...TO_SENSITIVE_INTERVAL,
			{ type: "method-step-complete", step: "identify-auth-state" },
			{ type: "method-step-complete", step: "fill-username" },
		]);
		expectRejection(
			fragment,
			{ type: "method-step-complete", step: "fill-password" },
			"auth_step_out_of_order",
		);
	});

	test("the sensitive interval always begins by identifying the auth state", () => {
		const fragment = drive(begun(), TO_SENSITIVE_INTERVAL);
		expectRejection(
			fragment,
			{ type: "method-step-complete", step: "fill-username" },
			"auth_step_out_of_order",
		);
	});

	test("steps never move backwards", () => {
		const fragment = drive(begun(), [
			...TO_SENSITIVE_INTERVAL,
			{ type: "method-step-complete", step: "identify-auth-state" },
			{ type: "method-step-complete", step: "submit-username" },
		]);
		expectRejection(
			fragment,
			{ type: "method-step-complete", step: "fill-username" },
			"auth_step_out_of_order",
		);
	});

	test("an unapproved redirect blocks as origin mismatch before delivery (AE4)", () => {
		const fragment = drive(begun(), [
			...TO_SENSITIVE_INTERVAL,
			{ type: "blocked", cause: "origin-mismatch" },
		]);
		expect(fragment.status).toBe("blocked");
		expect(fragment.continuation?.next_action_id).toBe("inspect-origin-mismatch");
		expectRejection(
			fragment,
			{ type: "blocked-cause-resolved" },
			"auth_cause_not_resolvable",
		);
	});

	test("stale refs and target replacement block as target-proof-invalid and resume by re-proving", () => {
		const blocked = drive(begun(), [
			...TO_SENSITIVE_INTERVAL,
			{ type: "blocked", cause: "target-proof-invalid" },
		]);
		expect(blocked.continuation?.next_action_id).toBe("reprove-target-and-restart");
		const resumed = drive(blocked, [{ type: "blocked-cause-resolved" }]);
		expect(resumed.phase).toBe("pre-auth-proof");
		expect(resumed.status).toBe("active");
	});
});

describe("submission and write-ahead truth (R19)", () => {
	test("submission requires a completed password or OTP fill", () => {
		const fragment = drive(begun(), TO_SENSITIVE_INTERVAL);
		expectRejection(fragment, { type: "submission-dispatched" }, "auth_step_out_of_order");
	});

	test("dispatch consumes one attempt and persists the in-flight marker", () => {
		const fragment = drive(begun(), TO_WRITE_AHEAD);
		expect(fragment.phase).toBe("write-ahead-submission");
		expect(fragment.submission_started).toBe(true);
		expect(fragment.external_effect).toBe("possible");
		expect(fragment.attempt.consumed).toBe(1);
	});

	test("an exhausted attempt budget refuses dispatch", () => {
		const fragment = drive(
			begun({ attempt_limit: 1, attempts_already_consumed: 1 }),
			[...TO_SENSITIVE_INTERVAL, ...USERNAME_FIRST_STEPS],
		);
		expectRejection(
			fragment,
			{ type: "submission-dispatched" },
			"auth_attempt_budget_exhausted",
		);
	});

	test("wrong password blocks with a human-gated retry that never blind-retries", () => {
		const blocked = drive(begun(), [
			...TO_WRITE_AHEAD,
			{ type: "submit-outcome-observed", outcome: "wrong-password" },
			{ type: "cleanup-complete" },
		]);
		expect(blocked.status).toBe("blocked");
		expect(blocked.blocked_cause).toBe("wrong-password");
		expect(blocked.continuation?.next_action_id).toBe("approve-credential-retry");
		expect(blocked.attempt.consumed).toBe(1);
		expectRejection(blocked, { type: "blocked-cause-resolved" }, "auth_cause_not_resolvable");

		const retried = drive(blocked, [{ type: "human-retry-approved" }]);
		expect(retried.phase).toBe("pre-auth-proof");
		expect(retried.attempt.consumed).toBe(1);
	});

	test("human retry refuses once the shared budget is exhausted", () => {
		const blocked = drive(
			begun({ attempt_limit: 1 }),
			[
				...TO_WRITE_AHEAD,
				{ type: "submit-outcome-observed", outcome: "wrong-password" },
				{ type: "cleanup-complete" },
			],
		);
		expectRejection(blocked, { type: "human-retry-approved" }, "auth_attempt_budget_exhausted");
	});

	test("lockout and rate limit block with no mechanical resolution (R19)", () => {
		for (const outcome of ["lockout", "rate-limit"] as const) {
			const blocked = drive(begun(), [
				...TO_WRITE_AHEAD,
				{ type: "submit-outcome-observed", outcome },
				{ type: "cleanup-complete" },
			]);
			expect(blocked.blocked_cause).toBe(outcome);
			expectRejection(blocked, { type: "blocked-cause-resolved" }, "auth_cause_not_resolvable");
			expectRejection(blocked, { type: "human-retry-approved" }, "auth_retry_requires_human");
		}
	});

	test("challenge escalation pauses for user presence", () => {
		const blocked = drive(begun(), [
			...TO_WRITE_AHEAD,
			{ type: "submit-outcome-observed", outcome: "challenge-escalation" },
			{ type: "cleanup-complete" },
		]);
		expect(blocked.blocked_cause).toBe("challenge-escalation");
		expect(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["challenge-escalation"].run_state,
		).toBe("awaiting-user-presence");
	});

	test("submit timeout reports unknown effect and only same-lane inspection continues (AE6)", () => {
		const blocked = drive(begun(), [
			...TO_WRITE_AHEAD,
			{ type: "submit-outcome-observed", outcome: "timeout-unknown" },
			{ type: "cleanup-complete" },
		]);
		expect(blocked.blocked_cause).toBe("unknown-post-submit-state");
		expect(blocked.external_effect).toBe("unknown");
		expect(blocked.continuation?.next_action_id).toBe("inspect-post-submit-state");
		expectRejection(blocked, { type: "blocked-cause-resolved" }, "auth_cause_not_resolvable");
		expectRejection(blocked, { type: "human-retry-approved" }, "auth_retry_requires_human");
	});

	test("cleanup failure blocks and resumes only through repair", () => {
		const blocked = drive(begun(), [
			...TO_WRITE_AHEAD,
			{ type: "submit-outcome-observed", outcome: "wrong-password" },
			{ type: "cleanup-failed" },
		]);
		expect(blocked.blocked_cause).toBe("cleanup-failure");
		const repaired = drive(blocked, [{ type: "blocked-cause-resolved" }]);
		expect(repaired.phase).toBe("cleanup");
	});
});

describe("OTP re-entry (R12/R15)", () => {
	const TO_OTP_REENTRY: readonly BrowserUseAuthTransactionEvent[] = [
		...TO_WRITE_AHEAD,
		{ type: "submit-outcome-observed", outcome: "otp-required" },
		{ type: "cleanup-complete" },
	];

	test("otp-required re-enters the sensitive interval and re-proves before the OTP fill", () => {
		const fragment = drive(begun({ method: "otp" }), TO_OTP_REENTRY);
		expect(fragment.phase).toBe("sensitive-interval");
		expect(fragment.submit_outcome).toBe("otp-required");

		expectRejection(
			fragment,
			{ type: "method-step-complete", step: "fill-otp" },
			"auth_step_out_of_order",
		);
		const submitted = drive(fragment, [
			{ type: "method-step-complete", step: "reprove-target" },
			{ type: "method-step-complete", step: "fill-otp" },
			{ type: "submission-dispatched" },
		]);
		expect(submitted.attempt.consumed).toBe(2);
		expect(submitted.submit_outcome).toBeNull();
	});

	test("wrong OTP blocks with the human-gated retry", () => {
		const blocked = drive(begun({ method: "otp" }), [
			...TO_OTP_REENTRY,
			{ type: "method-step-complete", step: "reprove-target" },
			{ type: "method-step-complete", step: "fill-otp" },
			{ type: "submission-dispatched" },
			{ type: "submit-outcome-observed", outcome: "wrong-otp" },
			{ type: "cleanup-complete" },
		]);
		expect(blocked.blocked_cause).toBe("wrong-otp");
	});

	test("an OTP demand under a password-only method blocks as unsupported", () => {
		const blocked = drive(begun({ method: "password" }), TO_OTP_REENTRY);
		expect(blocked.blocked_cause).toBe("unsupported-method");
	});

	test("fill-otp is illegal without an otp-required outcome", () => {
		const fragment = drive(begun(), [
			...TO_SENSITIVE_INTERVAL,
			{ type: "method-step-complete", step: "identify-auth-state" },
		]);
		expectRejection(
			fragment,
			{ type: "method-step-complete", step: "fill-otp" },
			"auth_step_out_of_order",
		);
	});
});

describe("competing agent and preparation repairs (R21, AE11)", () => {
	test("an unavailable lease blocks with the machine-readable wait continuation", () => {
		const blocked = drive(begun(), [
			{ type: "pre-auth-proved" },
			{ type: "preparation-complete" },
			{ type: "lease-unavailable" },
		]);
		expect(blocked.blocked_cause).toBe("lease-unavailable");
		expect(blocked.continuation?.next_action_id).toBe("wait-for-lease-holder");
		const resumed = drive(blocked, [{ type: "blocked-cause-resolved" }]);
		expect(resumed.phase).toBe("lease-request");
	});

	test("preparation causes resume in place after repair", () => {
		for (const cause of [
			"missing-token",
			"invalid-vault-scope",
			"ambiguous-binding-selection",
			"revoked-binding",
		] as const) {
			const blocked = drive(begun(), [
				{ type: "pre-auth-proved" },
				{ type: "blocked", cause },
			]);
			expect(blocked.continuation).toEqual(
				BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE[cause].continuation,
			);
			const resumed = drive(blocked, [{ type: "blocked-cause-resolved" }]);
			expect(resumed.phase).toBe("secret-free-preparation");
		}
	});

	test("a blocked fragment refuses every event except resolution, retry, or cancel", () => {
		const blocked = drive(begun(), [
			{ type: "pre-auth-proved" },
			{ type: "preparation-complete" },
			{ type: "lease-unavailable" },
		]);
		expectRejection(blocked, { type: "lease-granted" }, "auth_blocked_requires_resolution");
	});

	test("a cause cannot be raised from a phase that does not own it", () => {
		const fragment = drive(begun(), TO_SENSITIVE_INTERVAL);
		expectRejection(
			fragment,
			{ type: "blocked", cause: "missing-token" },
			"auth_blocked_cause_illegal",
		);
	});
});

describe("cancel truth (R37)", () => {
	test("cancel before any submission reports external effect none", () => {
		const cancelled = drive(begun(), [
			...TO_SENSITIVE_INTERVAL,
			{ type: "cancel" },
		]);
		expect(cancelled.terminal_outcome).toBe("cancelled");
		expect(cancelled.external_effect).toBe("none");
	});

	test("cancel with a submission in flight preserves the possible-effect truth", () => {
		const cancelled = drive(begun(), [...TO_WRITE_AHEAD, { type: "cancel" }]);
		expect(cancelled.terminal_outcome).toBe("cancelled");
		expect(cancelled.external_effect).toBe("possible");
	});

	test("cancel after a timeout preserves the unknown-effect truth", () => {
		const cancelled = drive(begun(), [
			...TO_WRITE_AHEAD,
			{ type: "submit-outcome-observed", outcome: "timeout-unknown" },
			{ type: "cancel" },
		]);
		expect(cancelled.external_effect).toBe("unknown");
	});

	test("cancel applies from a blocked state too", () => {
		const cancelled = drive(begun(), [
			{ type: "pre-auth-proved" },
			{ type: "blocked", cause: "missing-token" },
			{ type: "cancel" },
		]);
		expect(cancelled.status).toBe("terminal");
		expect(cancelled.blocked_cause).toBeNull();
		expect(cancelled.continuation).toBeNull();
	});
});

describe("restart resume (R19, AE11)", () => {
	test("a blocked fragment resumes verbatim — its continuation is the answer", () => {
		const blocked = drive(begun(), [
			{ type: "pre-auth-proved" },
			{ type: "blocked", cause: "missing-token" },
		]);
		const resumed = resumeAuthTransactionAfterRestart(blocked);
		expect(resumed.ok).toBe(true);
		if (resumed.ok) expect(resumed.fragment).toEqual(blocked);
	});

	test("a terminal fragment resumes verbatim", () => {
		const cancelled = drive(begun(), [{ type: "cancel" }]);
		const resumed = resumeAuthTransactionAfterRestart(cancelled);
		expect(resumed.ok).toBe(true);
		if (resumed.ok) expect(resumed.fragment).toEqual(cancelled);
	});

	test("a crash after write-ahead blocks as unknown post-submit state with the attempt consumed", () => {
		const inFlight = drive(begun(), TO_WRITE_AHEAD);
		const resumed = resumeAuthTransactionAfterRestart(inFlight);
		expect(resumed.ok).toBe(true);
		if (resumed.ok) {
			expect(resumed.fragment.status).toBe("blocked");
			expect(resumed.fragment.blocked_cause).toBe("unknown-post-submit-state");
			expect(resumed.fragment.attempt.consumed).toBe(1);
		}
	});

	test("every other active phase restarts at pre-auth proof without secrets", () => {
		const activePaths: readonly (readonly BrowserUseAuthTransactionEvent[])[] = [
			[],
			[{ type: "pre-auth-proved" }],
			[{ type: "pre-auth-proved" }, { type: "preparation-complete" }],
			TO_SENSITIVE_INTERVAL,
			[...TO_SENSITIVE_INTERVAL, ...USERNAME_FIRST_STEPS],
			[
				...TO_WRITE_AHEAD,
				{ type: "submit-outcome-observed", outcome: "success" },
			],
			[
				...TO_WRITE_AHEAD,
				{ type: "submit-outcome-observed", outcome: "success" },
				{ type: "cleanup-complete" },
			],
			[
				...TO_WRITE_AHEAD,
				{ type: "submit-outcome-observed", outcome: "success" },
				{ type: "cleanup-complete" },
				{
					type: "postcondition-proven",
					identity_basis: "session-identity-proof",
					identity_basis_digest: "basis-digest-1",
				},
			],
		];
		for (const path of activePaths) {
			const resumed = resumeAuthTransactionAfterRestart(drive(begun(), path));
			expect(resumed.ok).toBe(true);
			if (resumed.ok) {
				expect(resumed.fragment.status).toBe("active");
				expect(resumed.fragment.phase).toBe("pre-auth-proof");
				expect(resumed.fragment.method_step).toBeNull();
				expect(validateAuthFragmentShape(resumed.fragment)).toEqual([]);
			}
		}
	});
});

describe("illegal-event property sweep (verification contract)", () => {
	const ALL_EVENTS: readonly BrowserUseAuthTransactionEvent[] = [
		{ type: "pre-auth-proved" },
		{ type: "session-already-authenticated" },
		{ type: "preparation-complete" },
		{ type: "lease-granted" },
		{ type: "lease-unavailable" },
		{ type: "method-step-complete", step: "identify-auth-state" },
		{ type: "submission-dispatched" },
		{ type: "submit-outcome-observed", outcome: "success" },
		{ type: "cleanup-complete" },
		{ type: "cleanup-failed" },
		{
			type: "postcondition-proven",
			identity_basis: "session-identity-proof",
			identity_basis_digest: "basis-digest-1",
		},
		{ type: "postcondition-unproven" },
		{
			type: "attestation-issued",
			attestation_digest: "attestation-digest-1",
			fresh_until_epoch_ms: 9_000,
		},
		{ type: "blocked", cause: "adapter-crash" },
		{ type: "blocked-cause-resolved" },
		{ type: "human-retry-approved" },
	];

	const PHASE_PATHS: Readonly<
		Record<string, readonly BrowserUseAuthTransactionEvent[]>
	> = {
		"pre-auth-proof": [],
		"secret-free-preparation": [{ type: "pre-auth-proved" }],
		"lease-request": [
			{ type: "pre-auth-proved" },
			{ type: "preparation-complete" },
		],
		"sensitive-interval": TO_SENSITIVE_INTERVAL,
		"write-ahead-submission": TO_WRITE_AHEAD,
		cleanup: [
			...TO_WRITE_AHEAD,
			{ type: "submit-outcome-observed", outcome: "success" },
		],
		"post-auth-proof": [
			...TO_WRITE_AHEAD,
			{ type: "submit-outcome-observed", outcome: "success" },
			{ type: "cleanup-complete" },
		],
		"bounded-attestation": [
			...TO_WRITE_AHEAD,
			{ type: "submit-outcome-observed", outcome: "success" },
			{ type: "cleanup-complete" },
			{
				type: "postcondition-proven",
				identity_basis: "session-identity-proof",
				identity_basis_digest: "basis-digest-1",
			},
		],
	};

	test("every event either advances legally or rejects typed, never crashes or mutates", () => {
		for (const [phase, path] of Object.entries(PHASE_PATHS)) {
			const fragment = drive(begun(), path);
			expect(fragment.phase).toBe(phase as BrowserUseAuthTransactionFragment["phase"]);
			const frozen = structuredClone(fragment);
			for (const event of ALL_EVENTS) {
				const result = applyAuthTransition(fragment, event);
				expect(fragment).toEqual(frozen);
				if (!result.ok) {
					expect(result.rejection.code.startsWith("auth_")).toBe(true);
					continue;
				}
				const issues = validateAuthFragmentShape(result.fragment);
				expect(issues).toEqual([]);
				expect(result.fragment.fragment_revision).toBe(
					fragment.fragment_revision + 1,
				);
				if (result.fragment.status === "blocked") {
					expect(result.fragment.blocked_cause).not.toBeNull();
					expect(result.fragment.continuation).not.toBeNull();
				}
			}
		}
	});

	test("an inadmissible fragment rejects every event", () => {
		const fragment = begun();
		const corrupted = {
			...fragment,
			binding: { ...fragment.binding, origin: "op://vault/item" },
		} as BrowserUseAuthTransactionFragment;
		expectRejection(corrupted, { type: "pre-auth-proved" }, "auth_fragment_invalid");
		const resumed = resumeAuthTransactionAfterRestart(corrupted);
		expect(resumed.ok).toBe(false);
	});

	test("a terminal-phase fragment with a non-terminal status rejects typed, never crashes", () => {
		const crafted = {
			...begun(),
			phase: "terminal",
			status: "active",
		} as BrowserUseAuthTransactionFragment;
		for (const event of ALL_EVENTS) {
			expectRejection(crafted, event, "auth_fragment_invalid");
		}
		const resumed = resumeAuthTransactionAfterRestart(crafted);
		expect(resumed.ok).toBe(false);
	});
});
