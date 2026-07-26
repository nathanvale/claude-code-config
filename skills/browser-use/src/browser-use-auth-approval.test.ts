import { describe, expect, test } from "bun:test";
import { BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE } from "./browser-use-auth-model";
import {
	BROWSER_USE_APPROVAL_CAUSE_BY_PURPOSE,
	BROWSER_USE_APPROVAL_CAUSES,
	BROWSER_USE_APPROVAL_PURPOSES,
	type BrowserUseApprovalBoundFacts,
	type BrowserUseApprovalBrokerPort,
	type BrowserUseApprovalPresenceRejection,
	type BrowserUseApprovalVerifierDeps,
	type BrowserUseGrantSubject,
	type BrowserUseOneUseGrant,
	type BrowserUseStandingPolicy,
	type BrowserUseVerifierIdentity,
	approvalBoundFactsDigestOf,
	createApprovalRouter,
	createApprovalVerifier,
	oneUseGrantDigestOf,
	presenceRefusalContinuationOf,
	standingPolicyDigestOf,
	validateOneUseGrantShape,
	validateStandingPolicyShape,
} from "./browser-use-auth-approval";

// =========================================================================
// ApprovalBrokerPort + human-gated approval routing (auth U3a PR1, R20,
// KTD11, KTD14; ADR 0028).
//
// Seam proof: the presence-requiring broker lifecycle (create/expand/
// replace/revoke) is structurally split from the presence-free verifier —
// routine standing-policy evaluation and one-use grant consumption run
// mechanically with the broker absent (missing native capability is legal);
// direct cache edits fail signature verification; fact drift invalidates
// permanently; one-use consumption is atomic and invalid grants never burn
// the reservation; only the four R20 causes can ever reach the broker.
// =========================================================================

const VERIFIER: BrowserUseVerifierIdentity = {
	key_id: "verifier-key-1",
	public_key: "public-key-1",
};

function baseFacts(
	overrides: Partial<BrowserUseApprovalBoundFacts> = {},
): BrowserUseApprovalBoundFacts {
	return {
		service_id: "oncore",
		auth_context: "interactive-login",
		environment: "agent-chrome",
		profile: "default",
		origin: "https://portal.example.com",
		runbook_id: null,
		action: "submit-timesheet",
		mutation_class: "read-write",
		...overrides,
	};
}

function signedPolicy(
	overrides: Partial<Omit<BrowserUseStandingPolicy, "signature">> = {},
): BrowserUseStandingPolicy {
	const unsigned: Omit<BrowserUseStandingPolicy, "signature"> = {
		policy_id: "policy-1",
		cause: "create",
		purpose: "binding-selection",
		bound_facts: baseFacts(),
		confirmed_limits: { max_actions: "5" },
		issued_at_epoch_ms: 1_000,
		verifier_key_id: VERIFIER.key_id,
		...overrides,
	};
	return { ...unsigned, signature: `sig:${standingPolicyDigestOf(unsigned)}` };
}

const BASE_SUBJECT: BrowserUseGrantSubject = {
	purpose: "binding-selection",
	selected_item_id: "item-1",
};

function signedGrant(
	overrides: Partial<Omit<BrowserUseOneUseGrant, "signature">> = {},
): BrowserUseOneUseGrant {
	const unsigned: Omit<BrowserUseOneUseGrant, "signature"> = {
		grant_id: "grant-1",
		subject: BASE_SUBJECT,
		bound_facts: baseFacts(),
		issued_at_epoch_ms: 1_000,
		expires_at_epoch_ms: 2_000,
		verifier_key_id: VERIFIER.key_id,
		...overrides,
	};
	return { ...unsigned, signature: `sig:${oneUseGrantDigestOf(unsigned)}` };
}

function verifierHarness(
	overrides: Partial<BrowserUseApprovalVerifierDeps> = {},
) {
	const invalidated = new Set<string>();
	const consumed = new Set<string>();
	const reserved = new Set<string>();
	const reserveCalls: string[] = [];
	const invalidateCalls: string[] = [];
	const deps: BrowserUseApprovalVerifierDeps = {
		verifier: VERIFIER,
		verifySignature: ({ digest, signature, key_id }) =>
			key_id === VERIFIER.key_id && signature === `sig:${digest}`,
		ledger: {
			isPolicyInvalidated: (policyId) => invalidated.has(policyId),
			isGrantConsumed: (grantId) => consumed.has(grantId),
		},
		reserveGrant: (grantId) => {
			reserveCalls.push(grantId);
			if (reserved.has(grantId)) return false;
			reserved.add(grantId);
			return true;
		},
		invalidatePolicy: (policyId) => {
			invalidateCalls.push(policyId);
			invalidated.add(policyId);
		},
		...overrides,
	};
	return {
		deps,
		verifier: createApprovalVerifier(deps),
		reserveCalls,
		invalidateCalls,
		invalidated,
		consumed,
	};
}

function brokerHarness(rejection?: BrowserUseApprovalPresenceRejection) {
	const calls: unknown[] = [];
	const broker: BrowserUseApprovalBrokerPort = {
		async issueOneUseGrant(input) {
			calls.push(input);
			if (rejection !== undefined) return { ok: false, rejection };
			return {
				ok: true,
				grant: signedGrant({
					subject: input.subject,
					bound_facts: input.bound_facts,
				}),
			};
		},
		async issueStandingPolicy(input) {
			calls.push(input);
			if (rejection !== undefined) return { ok: false, rejection };
			return {
				ok: true,
				policy: signedPolicy({
					cause: input.cause,
					purpose: input.purpose,
					bound_facts: input.bound_facts,
					confirmed_limits: input.confirmed_limits,
				}),
			};
		},
		async revokeAuthorization(input) {
			calls.push(input);
			if (rejection !== undefined) return { ok: false, rejection };
			return { ok: true };
		},
	};
	return { broker, calls };
}

describe("R20 approval vocabularies", () => {
	test("the cause vocabulary is closed to exactly create/expand/replace/revoke", () => {
		expect([...BROWSER_USE_APPROVAL_CAUSES]).toEqual([
			"create",
			"expand",
			"replace",
			"revoke",
		]);
	});

	test("the cause-by-purpose mapping is total over the purpose vocabulary", () => {
		for (const purpose of BROWSER_USE_APPROVAL_PURPOSES) {
			expect(BROWSER_USE_APPROVAL_CAUSES).toContain(
				BROWSER_USE_APPROVAL_CAUSE_BY_PURPOSE[purpose],
			);
		}
		expect(Object.keys(BROWSER_USE_APPROVAL_CAUSE_BY_PURPOSE).sort()).toEqual(
			[...BROWSER_USE_APPROVAL_PURPOSES].sort(),
		);
	});
});

describe("approval digests", () => {
	test("digests are full 64-hex sha256, deterministic, and field-sensitive", () => {
		const facts = baseFacts();
		const digest = approvalBoundFactsDigestOf(facts);
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
		expect(approvalBoundFactsDigestOf(baseFacts())).toBe(digest);
		expect(
			approvalBoundFactsDigestOf(baseFacts({ environment: "other-env" })),
		).not.toBe(digest);

		const { signature: _p, ...unsignedPolicy } = signedPolicy();
		expect(standingPolicyDigestOf(unsignedPolicy)).toMatch(/^[0-9a-f]{64}$/);
		const { signature: _g, ...unsignedGrant } = signedGrant();
		expect(oneUseGrantDigestOf(unsignedGrant)).toMatch(/^[0-9a-f]{64}$/);
		expect(
			oneUseGrantDigestOf({ ...unsignedGrant, grant_id: "grant-2" }),
		).not.toBe(oneUseGrantDigestOf(unsignedGrant));
	});
});

describe("shape validators (fail-closed)", () => {
	test("a schema-exact policy and grant are admitted with zero issues", () => {
		expect(validateStandingPolicyShape(signedPolicy())).toEqual([]);
		expect(validateOneUseGrantShape(signedGrant())).toEqual([]);
	});

	test("non-object candidates fail closed", () => {
		const policyIssues = validateStandingPolicyShape("policy");
		expect(policyIssues[0]?.code).toBe("approval_field_invalid");
		const grantIssues = validateOneUseGrantShape(null);
		expect(grantIssues[0]?.code).toBe("approval_field_invalid");
	});

	test("a grant with an extra 'password' key fails key-set admission", () => {
		const issues = validateOneUseGrantShape({
			...signedGrant(),
			password: "hunter2",
		});
		expect(issues[0]?.code).toBe("approval_key_set_invalid");
	});

	test("a signature is exempt from the bounded screen but capped in length", () => {
		// Deliberate exemption: real signatures exceed the 256-char redacted
		// bound and can contain long base32-like runs; they are verified,
		// never echoed.
		const longSignature = { ...signedPolicy(), signature: "A".repeat(300) };
		expect(
			validateStandingPolicyShape(longSignature).some(
				(i) => i.path === "policy.signature",
			),
		).toBe(false);
		// The exemption is named, not unbounded: the explicit cap still holds.
		const overCap = { ...signedGrant(), signature: "A".repeat(4097) };
		const issues = validateOneUseGrantShape(overCap);
		expect(
			issues.some(
				(i) =>
					i.code === "approval_field_invalid" && i.path === "grant.signature",
			),
		).toBe(true);
	});

	test("a secret-shaped confirmed limit fails without echoing the value", () => {
		const sentinel = "op://vault/item/password";
		const issues = validateStandingPolicyShape(
			signedPolicy({ confirmed_limits: { credential_ref: sentinel } }),
		);
		expect(issues.some((i) => i.code === "approval_value_secret_shaped")).toBe(
			true,
		);
		expect(JSON.stringify(issues)).not.toContain("op://");
	});
});

describe("evaluateStandingAuthorization (presence-free, R20/KTD11)", () => {
	test("routine evaluation is mechanical over exactly the verifier seams", () => {
		// The no-broker guarantee is structural (see the type-level
		// impossibility proof at the bottom of this file); the runtime proof
		// here is that routine evaluation drives only the injected verifier seams.
		const seamCalls: string[] = [];
		const harness = verifierHarness();
		const deps: BrowserUseApprovalVerifierDeps = {
			...harness.deps,
			verifySignature: (input) => {
				seamCalls.push("verifySignature");
				return harness.deps.verifySignature(input);
			},
			ledger: {
				isPolicyInvalidated: (policyId) => {
					seamCalls.push("isPolicyInvalidated");
					return harness.deps.ledger.isPolicyInvalidated(policyId);
				},
				isGrantConsumed: (grantId) => {
					seamCalls.push("isGrantConsumed");
					return harness.deps.ledger.isGrantConsumed(grantId);
				},
			},
		};
		const verifier = createApprovalVerifier(deps);
		const policy = signedPolicy();
		const before = structuredClone(policy);
		const result = verifier.evaluateStandingAuthorization({
			policy,
			facts: baseFacts(),
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.policy_id).toBe("policy-1");
		expect(seamCalls).toEqual(["isPolicyInvalidated", "verifySignature"]);
		expect(policy).toEqual(before);
	});

	test("an edited policy carrying the original signature fails signature verification", () => {
		const { verifier } = verifierHarness();
		const policy = signedPolicy();
		const edited = {
			...policy,
			bound_facts: {
				...policy.bound_facts,
				origin: "https://evil.example.com",
			},
		};
		const result = verifier.evaluateStandingAuthorization({
			policy: edited,
			facts: edited.bound_facts,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.refusal.code).toBe("policy_signature_invalid");
		}
	});

	test("fact drift invalidates permanently; later fact reversion never revives", () => {
		const { verifier, invalidateCalls } = verifierHarness();
		const policy = signedPolicy();
		const drifted = verifier.evaluateStandingAuthorization({
			policy,
			facts: baseFacts({ environment: "other-env" }),
		});
		expect(drifted.ok).toBe(false);
		if (!drifted.ok) expect(drifted.refusal.code).toBe("policy_facts_drifted");
		expect(invalidateCalls).toEqual(["policy-1"]);

		const revived = verifier.evaluateStandingAuthorization({
			policy,
			facts: baseFacts(),
		});
		expect(revived.ok).toBe(false);
		if (!revived.ok) expect(revived.refusal.code).toBe("policy_invalidated");
		expect(invalidateCalls.length).toBe(1);
	});

	test("verifier rotation refuses every policy signed under the old key", () => {
		const { verifier } = verifierHarness({
			verifier: { key_id: "verifier-key-2", public_key: "public-key-2" },
		});
		const result = verifier.evaluateStandingAuthorization({
			policy: signedPolicy(),
			facts: baseFacts(),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("policy_verifier_stale");
	});

	test("a malformed policy refuses policy_shape_invalid", () => {
		const { verifier } = verifierHarness();
		const result = verifier.evaluateStandingAuthorization({
			policy: { ...signedPolicy(), password: "hunter2" },
			facts: baseFacts(),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("policy_shape_invalid");
	});
});

describe("consumeOneUseGrant (atomic one-use, R20)", () => {
	const at = 1_500;

	test("a valid grant consumes exactly once", () => {
		const { verifier, reserveCalls } = verifierHarness();
		const result = verifier.consumeOneUseGrant({
			grant: signedGrant(),
			expected: BASE_SUBJECT,
			facts: baseFacts(),
			at_epoch_ms: at,
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.subject).toEqual(BASE_SUBJECT);
		expect(reserveCalls).toEqual(["grant-1"]);
	});

	test("replay loses atomically: two consumes yield exactly one ok", () => {
		const { verifier, reserveCalls } = verifierHarness();
		const grant = signedGrant();
		const input = {
			grant,
			expected: BASE_SUBJECT,
			facts: baseFacts(),
			at_epoch_ms: at,
		};
		const first = verifier.consumeOneUseGrant(input);
		const second = verifier.consumeOneUseGrant(input);
		const outcomes = [first, second];
		expect(outcomes.filter((o) => o.ok).length).toBe(1);
		const loser = outcomes.find((o) => !o.ok);
		if (loser !== undefined && !loser.ok) {
			expect(loser.refusal.code).toBe("grant_consumed");
		}
		expect(reserveCalls.length).toBe(2);
	});

	test("an expired grant never burns the reservation", () => {
		const { verifier, reserveCalls } = verifierHarness();
		const result = verifier.consumeOneUseGrant({
			grant: signedGrant(),
			expected: BASE_SUBJECT,
			facts: baseFacts(),
			at_epoch_ms: 2_001,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("grant_expired");
		expect(reserveCalls.length).toBe(0);
	});

	test("a shape-invalid grant never burns the reservation", () => {
		const { verifier, reserveCalls } = verifierHarness();
		const result = verifier.consumeOneUseGrant({
			grant: { ...signedGrant(), password: "hunter2" },
			expected: BASE_SUBJECT,
			facts: baseFacts(),
			at_epoch_ms: at,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("grant_shape_invalid");
		expect(reserveCalls.length).toBe(0);
	});

	test("a signature-invalid grant never burns the reservation", () => {
		const { verifier, reserveCalls } = verifierHarness();
		const result = verifier.consumeOneUseGrant({
			grant: { ...signedGrant(), signature: "sig:forged" },
			expected: BASE_SUBJECT,
			facts: baseFacts(),
			at_epoch_ms: at,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("grant_signature_invalid");
		expect(reserveCalls.length).toBe(0);
	});

	test("cross-purpose replay refuses grant_purpose_mismatch", () => {
		const { verifier, reserveCalls } = verifierHarness();
		const result = verifier.consumeOneUseGrant({
			grant: signedGrant(),
			expected: {
				purpose: "origin-expansion",
				approved_origin: "https://portal.example.com",
			},
			facts: baseFacts(),
			at_epoch_ms: at,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("grant_purpose_mismatch");
		expect(reserveCalls.length).toBe(0);
	});

	test("matching purpose with drifted bound facts refuses grant_facts_mismatch", () => {
		const { verifier, reserveCalls } = verifierHarness();
		const result = verifier.consumeOneUseGrant({
			grant: signedGrant(),
			expected: BASE_SUBJECT,
			facts: baseFacts({ environment: "other-env" }),
			at_epoch_ms: at,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("grant_facts_mismatch");
		expect(reserveCalls.length).toBe(0);
	});

	test("verifier rotation refuses every grant signed under the old key", () => {
		const { verifier } = verifierHarness({
			verifier: { key_id: "verifier-key-2", public_key: "public-key-2" },
		});
		const result = verifier.consumeOneUseGrant({
			grant: signedGrant(),
			expected: BASE_SUBJECT,
			facts: baseFacts(),
			at_epoch_ms: at,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("grant_verifier_stale");
	});
});

describe("presenceRefusalContinuationOf (single continuation owner, R21)", () => {
	test("human-identity-attestation maps to the attestation table row; all others to user-presence", () => {
		const attestationRow =
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["human-identity-attestation-required"]
				.continuation;
		const presenceRow =
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["user-presence-required"]
				.continuation;
		for (const purpose of BROWSER_USE_APPROVAL_PURPOSES) {
			const continuation = presenceRefusalContinuationOf(purpose);
			const expected =
				purpose === "human-identity-attestation" ? attestationRow : presenceRow;
			expect(continuation).toEqual(expected);
			expect(continuation).not.toBe(expected); // structured clone, never the table row itself
		}
		expect(
			presenceRefusalContinuationOf("human-identity-attestation")
				.next_action_id,
		).toBe("complete-human-identity-attestation");
		expect(presenceRefusalContinuationOf("binding-selection").next_action_id).toBe(
			"complete-user-presence",
		);
	});
});

describe("approval router (broker absence is legal, ADR 0028)", () => {
	const grantInput = {
		subject: BASE_SUBJECT,
		bound_facts: baseFacts(),
		display: ["Select the login item for oncore"],
	};

	test("broker null: every request refuses broker-unavailable; verification is unaffected", async () => {
		const router = createApprovalRouter({ broker: null });
		const expectedContinuation = presenceRefusalContinuationOf(
			"binding-selection",
		);

		const grantResult = await router.requestGrant(grantInput);
		expect(grantResult.ok).toBe(false);
		if (!grantResult.ok) {
			expect(grantResult.refusal.code).toBe("broker-unavailable");
			expect(grantResult.refusal.continuation).toEqual(expectedContinuation);
		}

		const policyResult = await router.requestPolicy({
			purpose: "binding-selection",
			bound_facts: baseFacts(),
			confirmed_limits: { max_actions: "5" },
		});
		expect(policyResult.ok).toBe(false);
		if (!policyResult.ok) {
			expect(policyResult.refusal.code).toBe("broker-unavailable");
			expect(policyResult.refusal.continuation).toEqual(expectedContinuation);
		}

		const revocationResult = await router.requestRevocation({
			policy_id: "policy-1",
		});
		expect(revocationResult.ok).toBe(false);
		if (!revocationResult.ok) {
			expect(revocationResult.refusal.code).toBe("broker-unavailable");
		}

		// Offline verifiability: previously issued authority still proves out
		// with zero broker involvement — structural, the verifier has no broker dep.
		const { verifier } = verifierHarness();
		const policyOk = verifier.evaluateStandingAuthorization({
			policy: signedPolicy(),
			facts: baseFacts(),
		});
		expect(policyOk.ok).toBe(true);
		const grantOk = verifier.consumeOneUseGrant({
			grant: signedGrant(),
			expected: BASE_SUBJECT,
			facts: baseFacts(),
			at_epoch_ms: 1_500,
		});
		expect(grantOk.ok).toBe(true);
	});

	test("secret-shaped display lines are screened before the broker is ever invoked", async () => {
		const { broker, calls } = brokerHarness();
		const router = createApprovalRouter({ broker });
		const result = await router.requestGrant({
			...grantInput,
			display: ["op://v/i/password"],
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.refusal.code).toBe("display-secret-shaped");
			expect(JSON.stringify(result.refusal)).not.toContain("op://");
		}
		expect(calls.length).toBe(0);
	});

	test("secret-shaped confirmed limits and bound facts are screened before the broker is ever invoked (R16)", async () => {
		const { broker, calls } = brokerHarness();
		const router = createApprovalRouter({ broker });
		const limitResult = await router.requestPolicy({
			purpose: "binding-selection",
			bound_facts: baseFacts(),
			confirmed_limits: { credential_ref: "op://v/i/password" },
		});
		expect(limitResult.ok).toBe(false);
		if (!limitResult.ok) {
			expect(limitResult.refusal.code).toBe("display-secret-shaped");
			expect(limitResult.refusal.continuation).toEqual(
				presenceRefusalContinuationOf("binding-selection"),
			);
			// The refusal names the entry index only — never the key or value.
			expect(JSON.stringify(limitResult.refusal)).not.toContain("op://");
			expect(JSON.stringify(limitResult.refusal)).not.toContain(
				"credential_ref",
			);
		}
		const factResult = await router.requestPolicy({
			purpose: "binding-selection",
			bound_facts: baseFacts({ action: "op://v/i/password" }),
			confirmed_limits: { max_actions: "5" },
		});
		expect(factResult.ok).toBe(false);
		if (!factResult.ok) {
			expect(factResult.refusal.code).toBe("display-secret-shaped");
			expect(JSON.stringify(factResult.refusal)).not.toContain("op://");
		}
		expect(calls.length).toBe(0);
	});

	test("every presence rejection maps to a typed refusal carrying the purpose's continuation", async () => {
		const codes = [
			"broker-unavailable",
			"biometric-capability-missing",
			"presence-cancelled",
			"headless-environment",
		] as const;
		for (const code of codes) {
			const { broker } = brokerHarness({ code, message: "presence refused." });
			const router = createApprovalRouter({ broker });
			const result = await router.requestGrant(grantInput);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.refusal.code).toBe(code);
				expect(result.refusal.continuation).toEqual(
					presenceRefusalContinuationOf("binding-selection"),
				);
			}
		}
	});

	test("requestPolicy derives the cause internally — only the four R20 causes reach the broker", async () => {
		for (const purpose of BROWSER_USE_APPROVAL_PURPOSES) {
			const { broker, calls } = brokerHarness();
			const router = createApprovalRouter({ broker });
			const result = await router.requestPolicy({
				purpose,
				bound_facts: baseFacts(),
				confirmed_limits: {},
			});
			expect(result.ok).toBe(true);
			expect(calls.length).toBe(1);
			const received = calls[0] as { cause: string; purpose: string };
			expect(received.cause).toBe(BROWSER_USE_APPROVAL_CAUSE_BY_PURPOSE[purpose]);
			expect(received.purpose).toBe(purpose);
		}
	});

	test("a granted request passes the broker's grant through verbatim", async () => {
		const { broker } = brokerHarness();
		const router = createApprovalRouter({ broker });
		const result = await router.requestGrant(grantInput);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.grant.subject).toEqual(BASE_SUBJECT);
			expect(validateOneUseGrantShape(result.grant)).toEqual([]);
		}
		const revoked = await router.requestRevocation({ grant_id: "grant-1" });
		expect(revoked.ok).toBe(true);
	});
});

describe("type-level impossibilities (R20)", () => {
	test("unconfirmed limits and a broker verifier seam are unrepresentable", () => {
		function typeLevelOnly(
			broker: BrowserUseApprovalBrokerPort,
			deps: BrowserUseApprovalVerifierDeps,
		): void {
			void broker.issueStandingPolicy({
				cause: "create",
				purpose: "binding-selection",
				bound_facts: baseFacts(),
				// @ts-expect-error — proposals have no authority; only human-confirmed string values enter a policy
				confirmed_limits: { proposed: { max_actions: "5" }, confirmed: false },
			});
			// @ts-expect-error — R20 privilege split is structural: routine verification has no broker member
			const invalid: BrowserUseApprovalVerifierDeps = { ...deps, broker: null };
			void invalid;
		}
		void typeLevelOnly;
		expect(true).toBe(true);
	});
});
