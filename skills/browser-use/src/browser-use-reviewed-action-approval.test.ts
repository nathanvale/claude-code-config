import { describe, expect, test } from "bun:test";
import {
	type BrowserUseReviewedActionApprovalFacts,
	createReviewedActionApprovalVerifier,
	reviewedActionApprovalFactsDigest,
	verifyReviewedActionApproval,
} from "./browser-use-reviewed-action-approval";

const FACTS: BrowserUseReviewedActionApprovalFacts = {
	source_commit: "1".repeat(40),
	action_id: "count-rows",
	approved_digest: "2".repeat(64),
	approved_origin: "https://portal.example.test",
	approved_effect: "read",
	audited_capabilities: ["dom-query", "dom-read"],
	containment: "read-only-observation",
	input_schema_digest: "3".repeat(64),
	result_schema_digest: "4".repeat(64),
	postcondition_digest: null,
};

function receipt(overrides: Record<string, unknown> = {}) {
	const facts = { ...FACTS, ...(overrides.facts as object | undefined) };
	return {
		contract: "browser-use.reviewed-action-promotion", schema_version: "1", receipt_id: "receipt-1", disposition: "approved", ...facts,
		approval_reference: "review-1", presence_backed: true, issued_at_epoch_ms: 1_000, verifier_key_id: "test-key",
		signature: `TEST:${reviewedActionApprovalFactsDigest({ ...facts, approval_reference: "review-1", receipt_id: "receipt-1", issued_at_epoch_ms: 1_000, verifier_key_id: "test-key" })}`,
		...overrides,
	};
}

function verifier() {
	return createReviewedActionApprovalVerifier({ verifier: { key_id: "test-key", public_key: "TEST-ONLY-PUBLIC-KEY" }, verifySignature: ({ digest, signature, key_id }) => key_id === "test-key" && signature === `TEST:${digest}` });
}

describe("Reviewed Action external-human approval boundary", () => {
	test("presence-backed approval binds exact source commit, bytes, origin, audit, schemas, and postcondition", () => {
		expect(verifyReviewedActionApproval({ facts: FACTS, receipts: [receipt()], verifier: verifier() })).toMatchObject({ ok: true, receipt_id: "receipt-1" });
	});

	test("agent metadata has no promotion authority and verifier has no signing method", () => {
		const boundary = verifier() as unknown as Record<string, unknown>;
		expect(boundary.promote).toBeUndefined();
		expect(boundary.sign).toBeUndefined();
		expect(verifyReviewedActionApproval({ facts: FACTS, receipts: [], verifier: verifier(), caller: "human", approver_ref: "operator", operator_audience: true } as never)).toMatchObject({ ok: false, code: "action_promotion_absent" });
	});

	test("forged, replayed, wrong-byte, wrong-origin, and wrong-commit approvals refuse", () => {
		const cases = [
			["forged", [receipt({ signature: "TEST:forged" })], FACTS, "action_promotion_signature_invalid"],
			["replayed", [receipt(), receipt()], FACTS, "action_promotion_replayed"],
			["bytes", [receipt()], { ...FACTS, approved_digest: "9".repeat(64) }, "action_promotion_facts_mismatch"],
			["origin", [receipt()], { ...FACTS, approved_origin: "https://other.example.test" }, "action_promotion_facts_mismatch"],
			["commit", [receipt()], { ...FACTS, source_commit: "8".repeat(40) }, "action_promotion_facts_mismatch"],
		] as const;
		for (const [label, receipts, facts, code] of cases) expect(verifyReviewedActionApproval({ facts, receipts, verifier: verifier() }), label).toMatchObject({ ok: false, code });
	});

	test("human approval cannot override a mechanically prohibited candidate", () => {
		expect(verifyReviewedActionApproval({ facts: FACTS, receipts: [receipt()], verifier: verifier(), mechanicalAudit: { ok: false, code: "action_capability_network" } })).toMatchObject({ ok: false, code: "action_capability_network" });
	});
});
