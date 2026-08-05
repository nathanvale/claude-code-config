import { describe, expect, test } from "bun:test";
import {
	BROWSER_USE_AUTH_ATTESTATION_KEYS,
	BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE,
	BROWSER_USE_AUTH_BLOCKED_CAUSES,
	BROWSER_USE_AUTH_FRAGMENT_KEYS,
	BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION,
	BROWSER_USE_AUTH_PHASES,
	type BrowserUseAuthAttestation,
	type BrowserUseAuthTransactionFragment,
	authAttestationDigestOf,
	validateAuthFragmentShape,
} from "./browser-use-auth-model";

// =========================================================================
// Browser Authentication Transaction model (auth plan U2, R6/R14-R21/R30).
//
// Pure-model proof: fragment admission is fail-closed over exact key sets,
// vocabulary membership, secret-shaped values, and cross-field invariants;
// every blocked cause owns exactly one continuation and one platform state;
// the bounded attestation digest is deterministic and edit-sensitive.
// =========================================================================

function baseFragment(
	overrides: Partial<BrowserUseAuthTransactionFragment> = {},
): BrowserUseAuthTransactionFragment {
	return {
		schema_version: BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION,
		fragment_revision: 4,
		phase: "sensitive-interval",
		status: "active",
		method: "password",
		method_step: "identify-auth-state",
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
		attempt: { budget_key: "oncore::timesheet::https://portal.example.com", limit: 3, consumed: 0 },
		submission_started: false,
		external_effect: "none",
		submit_outcome: null,
		blocked_cause: null,
		continuation: null,
		terminal_outcome: null,
		identity_basis: null,
		identity_basis_digest: null,
		attestation_digest: null,
		fresh_until_epoch_ms: null,
		...overrides,
	};
}

function baseAttestation(
	overrides: Partial<BrowserUseAuthAttestation> = {},
): BrowserUseAuthAttestation {
	return {
		run_id: "run-1",
		handoff_evidence_id: "evidence-1",
		lane_id: "agent-browser",
		implementation_integrity_key: "integrity-key-1",
		environment: "agent-chrome",
		profile: "default",
		target_id: "target-1",
		page_id: "page-1",
		frame_id: "frame-1",
		service_id: "oncore",
		auth_context: "timesheet",
		subject_reference: "subject-ref-1",
		account_reference: "account-ref-1",
		tenant_reference: "tenant-ref-1",
		identity_basis: "session-identity-proof",
		identity_basis_digest: "basis-digest-1",
		observed_at_epoch_ms: 1_000,
		fresh_until_epoch_ms: 2_000,
		...overrides,
	};
}

describe("blocked cause table (R21)", () => {
	test("every blocked cause owns exactly one continuation and one platform state", () => {
		for (const cause of BROWSER_USE_AUTH_BLOCKED_CAUSES) {
			const entry = BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE[cause];
			expect(entry.continuation.next_action_id.length).toBeGreaterThan(0);
			expect(entry.continuation.summary.length).toBeGreaterThan(0);
			expect([
				"awaiting-auth",
				"awaiting-approval",
				"awaiting-user-presence",
				"needs-human",
			]).toContain(entry.run_state);
		}
	});

	test("the competing-agent wait continuation is machine-readable (AE11)", () => {
		expect(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["lease-unavailable"].continuation
				.next_action_id,
		).toBe("wait-for-lease-holder");
	});

	test("first binding approval owns the selection-grant continuation", () => {
		expect(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["binding-approval-required"]
				.continuation.next_action_id,
		).toBe("request-binding-selection-grant");
	});

	test("unknown post-submit state offers same-lane inspection, never retry (AE6)", () => {
		expect(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["unknown-post-submit-state"]
				.continuation.next_action_id,
		).toBe("inspect-post-submit-state");
	});
});

describe("fragment admission (R6) → exact key sets", () => {
	test("a sound active fragment admits cleanly", () => {
		expect(validateAuthFragmentShape(baseFragment())).toEqual([]);
	});

	test("a non-object candidate is one typed refusal, never a crash", () => {
		for (const candidate of [null, undefined, 7, "fragment", [baseFragment()]]) {
			const issues = validateAuthFragmentShape(candidate);
			expect(issues.length).toBe(1);
			expect(issues[0]?.code).toBe("fragment_field_invalid");
		}
	});

	test("an unknown top-level key fails admission as a schema extension", () => {
		const extended = { ...baseFragment(), password: "hunter2" };
		const issues = validateAuthFragmentShape(extended);
		expect(issues[0]?.code).toBe("fragment_key_set_invalid");
	});

	test("a missing required key fails admission", () => {
		const { attempt: _attempt, ...rest } = baseFragment();
		const issues = validateAuthFragmentShape(rest);
		expect(issues[0]?.code).toBe("fragment_key_set_invalid");
	});

	test("an unknown binding key fails admission", () => {
		const fragment = baseFragment();
		const issues = validateAuthFragmentShape({
			...fragment,
			binding: { ...fragment.binding, secret_value: "x" },
		});
		expect(issues[0]?.code).toBe("fragment_key_set_invalid");
	});

	test("an unknown schema version fails admission", () => {
		const issues = validateAuthFragmentShape({
			...baseFragment(),
			schema_version: "browser-use-auth-fragment/2",
		});
		expect(issues.some((issue) => issue.code === "fragment_schema_version_unknown")).toBe(
			true,
		);
	});

	test("the exported key manifests cover the fragment exactly", () => {
		expect(Object.keys(baseFragment()).sort()).toEqual(
			[...BROWSER_USE_AUTH_FRAGMENT_KEYS].sort(),
		);
	});
});

describe("fragment admission (R6) → secret-shaped values", () => {
	test("an op:// reference anywhere in a string fails admission", () => {
		const fragment = baseFragment();
		const issues = validateAuthFragmentShape({
			...fragment,
			binding: { ...fragment.binding, service_id: "op://vault/item/password" },
		});
		expect(issues[0]?.code).toBe("fragment_value_secret_shaped");
	});

	test("a raw websocket endpoint fails admission", () => {
		const fragment = baseFragment();
		const issues = validateAuthFragmentShape({
			...fragment,
			binding: { ...fragment.binding, target_id: "ws://127.0.0.1:9222/devtools" },
		});
		expect(issues[0]?.code).toBe("fragment_value_secret_shaped");
	});

	test("an unbounded string fails admission", () => {
		const fragment = baseFragment();
		const issues = validateAuthFragmentShape({
			...fragment,
			binding: { ...fragment.binding, page_id: "p".repeat(300) },
		});
		expect(issues[0]?.code).toBe("fragment_value_secret_shaped");
	});

	test("negative or non-integer counts fail admission", () => {
		const fragment = baseFragment();
		expect(
			validateAuthFragmentShape({
				...fragment,
				attempt: { ...fragment.attempt, consumed: -1 },
			})[0]?.code,
		).toBe("fragment_field_invalid");
		expect(
			validateAuthFragmentShape({ ...fragment, fragment_revision: 1.5 })[0]?.code,
		).toBe("fragment_field_invalid");
	});
});

describe("fragment invariants (R6/R19/R21)", () => {
	test("a blocked fragment requires its cause's exactly-one code-owned continuation", () => {
		const missingContinuation = baseFragment({
			status: "blocked",
			blocked_cause: "lockout",
			continuation: null,
			method_step: null,
		});
		expect(
			validateAuthFragmentShape(missingContinuation)[0]?.code,
		).toBe("fragment_invariant_violated");

		const editedContinuation = baseFragment({
			status: "blocked",
			blocked_cause: "lockout",
			continuation: { next_action_id: "retry-now", summary: "Just retry." },
			method_step: null,
		});
		expect(
			validateAuthFragmentShape(editedContinuation)[0]?.code,
		).toBe("fragment_invariant_violated");

		const sound = baseFragment({
			status: "blocked",
			blocked_cause: "lockout",
			continuation: { ...BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE.lockout.continuation },
			method_step: null,
		});
		expect(validateAuthFragmentShape(sound)).toEqual([]);
	});

	test("only a blocked fragment carries a cause or continuation", () => {
		const issues = validateAuthFragmentShape(
			baseFragment({
				blocked_cause: "lockout",
				continuation: { ...BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE.lockout.continuation },
			}),
		);
		expect(issues[0]?.code).toBe("fragment_invariant_violated");
	});

	test("terminal status and terminal outcome appear together in the terminal phase", () => {
		expect(
			validateAuthFragmentShape(
				baseFragment({ status: "terminal", method_step: null }),
			)[0]?.code,
		).toBe("fragment_invariant_violated");
		expect(
			validateAuthFragmentShape(
				baseFragment({
					status: "terminal",
					terminal_outcome: "cancelled",
					phase: "sensitive-interval",
					method_step: null,
				}),
			).some((issue) => issue.code === "fragment_invariant_violated"),
		).toBe(true);
		expect(
			validateAuthFragmentShape(
				baseFragment({
					status: "terminal",
					terminal_outcome: "cancelled",
					phase: "terminal",
					method_step: null,
				}),
			),
		).toEqual([]);
	});

	test("a terminal phase with a non-terminal status fails admission (reverse invariant)", () => {
		const issues = validateAuthFragmentShape(
			baseFragment({ phase: "terminal", status: "active", method_step: null }),
		);
		expect(issues[0]?.code).toBe("fragment_invariant_violated");
	});

	test("an authenticated outcome requires an attestation and exactly one identity basis", () => {
		const issues = validateAuthFragmentShape(
			baseFragment({
				status: "terminal",
				phase: "terminal",
				terminal_outcome: "authenticated",
				method_step: null,
			}),
		);
		expect(issues.some((issue) => issue.code === "fragment_invariant_violated")).toBe(
			true,
		);
	});

	test("identity basis and its digest appear together", () => {
		const issues = validateAuthFragmentShape(
			baseFragment({ identity_basis: "session-identity-proof" }),
		);
		expect(issues[0]?.code).toBe("fragment_invariant_violated");
	});

	test("write-ahead ordering: an outcome or in-flight marker forbids external effect none", () => {
		expect(
			validateAuthFragmentShape(
				baseFragment({ submission_started: true, external_effect: "none" }),
			)[0]?.code,
		).toBe("fragment_invariant_violated");
		expect(
			validateAuthFragmentShape(
				baseFragment({
					submit_outcome: "wrong-password",
					external_effect: "none",
					submission_started: false,
				}),
			)[0]?.code,
		).toBe("fragment_invariant_violated");
	});

	test("an active write-ahead phase requires the in-flight marker", () => {
		const issues = validateAuthFragmentShape(
			baseFragment({
				phase: "write-ahead-submission",
				submission_started: false,
				method_step: null,
			}),
		);
		expect(issues[0]?.code).toBe("fragment_invariant_violated");
	});

	test("method steps exist only inside the sensitive interval", () => {
		const issues = validateAuthFragmentShape(
			baseFragment({ phase: "cleanup", method_step: "fill-password" }),
		);
		expect(issues[0]?.code).toBe("fragment_invariant_violated");
	});

	test("consumed attempts can never exceed the budget limit", () => {
		const fragment = baseFragment();
		const issues = validateAuthFragmentShape({
			...fragment,
			attempt: { ...fragment.attempt, limit: 2, consumed: 3 },
		});
		expect(issues[0]?.code).toBe("fragment_invariant_violated");
	});
});

describe("phase vocabulary", () => {
	test("the nine plan phases are fixed in order", () => {
		expect(BROWSER_USE_AUTH_PHASES).toEqual([
			"pre-auth-proof",
			"secret-free-preparation",
			"lease-request",
			"sensitive-interval",
			"write-ahead-submission",
			"cleanup",
			"post-auth-proof",
			"bounded-attestation",
			"terminal",
		]);
	});
});

describe("bounded attestation digest (R30)", () => {
	test("the digest is deterministic: same record, same full 64-hex digest", () => {
		const digest = authAttestationDigestOf(baseAttestation());
		expect(digest).toBe(authAttestationDigestOf(baseAttestation()));
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
	});

	test("editing any attestation field changes the digest", () => {
		const original = authAttestationDigestOf(baseAttestation());
		for (const key of BROWSER_USE_AUTH_ATTESTATION_KEYS) {
			const record = baseAttestation();
			const edited: BrowserUseAuthAttestation =
				key === "observed_at_epoch_ms" || key === "fresh_until_epoch_ms"
					? { ...record, [key]: record[key] + 1 }
					: key === "identity_basis"
						? { ...record, identity_basis: "human-identity-attestation" }
						: key === "lane_id"
							? { ...record, lane_id: "playwright-cdp" }
							: { ...record, [key]: `${record[key]}-edited` };
			expect(authAttestationDigestOf(edited)).not.toBe(original);
		}
	});
});
