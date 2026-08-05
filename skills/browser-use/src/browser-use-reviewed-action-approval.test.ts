import { describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type BrowserUseReviewedActionApprovalFacts,
	type BrowserUseReviewedActionPromotionBrokerPort,
	type BrowserUseReviewedActionPromotionReceipt,
	createP256ReviewedActionApprovalVerifier,
	createReviewedActionPromotionRouter,
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

function receipt(overrides: Record<string, unknown> = {}): BrowserUseReviewedActionPromotionReceipt {
	const facts = { ...FACTS, ...(overrides.facts as object | undefined) };
	const { facts: _facts, ...receiptOverrides } = overrides;
	return {
		contract: "browser-use.reviewed-action-promotion", schema_version: "1", receipt_id: "receipt-1", disposition: "approved", ...facts,
		approval_reference: "review-1", presence_backed: true, issued_at_epoch_ms: 1_000, verifier_key_id: "test-key",
		signature: `TEST:${reviewedActionApprovalFactsDigest({ ...facts, approval_reference: "review-1", receipt_id: "receipt-1", issued_at_epoch_ms: 1_000, verifier_key_id: "test-key" })}`,
		...receiptOverrides,
	} as BrowserUseReviewedActionPromotionReceipt;
}

function verifier() {
	return createReviewedActionApprovalVerifier({ verifier: { key_id: "test-key", public_key: "TEST-ONLY-PUBLIC-KEY" }, verifySignature: ({ digest, signature, key_id }) => key_id === "test-key" && signature === `TEST:${digest}` });
}

describe("Reviewed Action external-human approval boundary", () => {
	test("consumes the Swift-owned checked-in promotion vector", () => {
		const fixturePath = join(
			import.meta.dir,
			"../../../runtime/browser-use-security/targets/ApprovalBrokerTests/Fixtures/reviewed-action-promotion-v1.json",
		);
		const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
			generated_by: string;
			canonical_payload_base64: string;
			verifier: { key_id: string; public_key: string };
			receipt: BrowserUseReviewedActionPromotionReceipt;
		};
		expect(fixture.generated_by).toBe("GeneratePromotionFixture.swift");
		const { receipt: vector } = fixture;
		const unsigned = {
			source_commit: vector.source_commit,
			action_id: vector.action_id,
			approved_digest: vector.approved_digest,
			approved_origin: vector.approved_origin,
			approved_effect: vector.approved_effect,
			audited_capabilities: vector.audited_capabilities,
			containment: vector.containment,
			input_schema_digest: vector.input_schema_digest,
			result_schema_digest: vector.result_schema_digest,
			postcondition_digest: vector.postcondition_digest,
			receipt_id: vector.receipt_id,
			approval_reference: vector.approval_reference,
			issued_at_epoch_ms: vector.issued_at_epoch_ms,
			verifier_key_id: vector.verifier_key_id,
		};
		const canonicalPayload = Buffer.from(fixture.canonical_payload_base64, "base64");
		expect(createHash("sha256").update(canonicalPayload).digest("hex")).toBe(
			reviewedActionApprovalFactsDigest(unsigned),
		);
		expect(createP256ReviewedActionApprovalVerifier(fixture.verifier).verify(vector)).toEqual({ ok: true });
		for (const [field, value] of [
			["source_commit", "2".repeat(40)],
			["approved_digest", "9".repeat(64)],
			["approved_origin", "https://other.example.test"],
			["input_schema_digest", "5".repeat(64)],
			["result_schema_digest", "6".repeat(64)],
			["receipt_id", "receipt-mutated"],
			["approval_reference", "review-mutated"],
			["issued_at_epoch_ms", vector.issued_at_epoch_ms + 1],
			["verifier_key_id", "a".repeat(64)],
			["signature", Buffer.from("forged").toString("base64")],
		] as const) {
			expect(
				createP256ReviewedActionApprovalVerifier(fixture.verifier).verify({ ...vector, [field]: value }),
				field,
			).toMatchObject({ ok: false });
		}
	});

	test("production P-256 verifier accepts the broker signature and rejects a forgery", () => {
		const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
		const jwk = publicKey.export({ format: "jwk" });
		if (jwk.x === undefined || jwk.y === undefined) throw new Error("P-256 fixture key is incomplete");
		const rawPublicKey = Buffer.concat([
			Buffer.from([4]),
			Buffer.from(jwk.x, "base64url"),
			Buffer.from(jwk.y, "base64url"),
		]).toString("base64");
		const keyId = createHash("sha256").update(Buffer.from(rawPublicKey, "base64")).digest("hex");
		const unsigned = {
			...FACTS,
			receipt_id: "receipt-p256",
			approval_reference: "review-1",
			issued_at_epoch_ms: 1_000,
			verifier_key_id: keyId,
		};
		const signature = sign("sha256", Buffer.from(reviewedActionApprovalFactsDigest(unsigned), "hex"), privateKey).toString("base64");
		const signedReceipt = receipt({ ...unsigned, signature });
		const productionVerifier = createP256ReviewedActionApprovalVerifier({ key_id: keyId, public_key: rawPublicKey });
		expect(productionVerifier.verify(signedReceipt)).toEqual({ ok: true });
		expect(productionVerifier.verify({ ...signedReceipt, signature: Buffer.from("forged").toString("base64") })).toEqual({ ok: false, code: "action_promotion_signature_invalid" });
	});

	test("production P-256 verifier rejects an off-curve public key without throwing", () => {
		const rawPublicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]);
		const keyId = createHash("sha256").update(rawPublicKey).digest("hex");
		const productionVerifier = createP256ReviewedActionApprovalVerifier({
			key_id: keyId,
			public_key: rawPublicKey.toString("base64"),
		});
		expect(productionVerifier.verify(receipt({ verifier_key_id: keyId }))).toEqual({
			ok: false,
			code: "action_promotion_verifier_identity_invalid",
		});
	});

	test("presence-backed broker reviews exact bytes and issues an offline-verifiable receipt", async () => {
		const candidateBytes = "async ({ inputs }) => ({ rows: document.querySelectorAll('.row').length })";
		let reviewedBytes = "";
		const broker: BrowserUseReviewedActionPromotionBrokerPort = {
			async issueReviewedActionPromotion(input) {
				reviewedBytes = input.candidate_bytes;
				return { ok: true, receipt: receipt({ facts: input.facts }) };
			},
		};
		const router = createReviewedActionPromotionRouter({ broker, verifier: verifier() });
		const result = await router.requestPromotion({
			facts: FACTS,
			candidate_bytes: candidateBytes,
			approval_reference: "review-1",
		});
		expect(result).toMatchObject({ ok: true, receipt: { approved_digest: FACTS.approved_digest } });
		expect(reviewedBytes).toBe(candidateBytes);
	});

	test("agent lane cannot issue when the OS-isolated broker is absent", async () => {
		const router = createReviewedActionPromotionRouter({ broker: null, verifier: verifier() });
		expect(Object.keys(router).sort()).toEqual(["requestPromotion"]);
		expect(await router.requestPromotion({ facts: FACTS, candidate_bytes: "candidate", approval_reference: "review-1" })).toMatchObject({
			ok: false,
			code: "action_promotion_broker_unavailable",
		});
	});

	test("forwards signing-key custody refusals from the broker", async () => {
		for (const [brokerCode, routerCode] of [
			["signing-key-missing", "action_promotion_signing_key_missing"],
			[
				"signing-key-already-enrolled",
				"action_promotion_signing_key_already_enrolled",
			],
			[
				"signing-key-custody-invalid",
				"action_promotion_signing_key_custody_invalid",
			],
		] as const) {
			const message = `broker refusal: ${brokerCode}`;
			const broker: BrowserUseReviewedActionPromotionBrokerPort = {
				async issueReviewedActionPromotion() {
					return { ok: false, rejection: { code: brokerCode, message } };
				},
			};
			const router = createReviewedActionPromotionRouter({
				broker,
				verifier: verifier(),
			});
			expect(
				await router.requestPromotion({
					facts: FACTS,
					candidate_bytes: "candidate",
					approval_reference: "review-1",
				}),
			).toEqual({ ok: false, code: routerCode, message });
		}
	});

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
