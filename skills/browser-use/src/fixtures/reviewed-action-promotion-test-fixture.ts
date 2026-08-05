import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
	type BrowserUseReviewedActionApprovalVerifier,
	type BrowserUseReviewedActionPromotionRouter,
	type BrowserUseReviewedActionVerifierIdentity,
	createP256ReviewedActionApprovalVerifier,
	createReviewedActionPromotionRouter,
	reviewedActionApprovalFactsDigest,
} from "../browser-use-reviewed-action-approval";
import type { BrowserUseReviewedActionOperatorBroker } from "../browser-use-reviewed-action-promotion";

/** Test-only promotion authority; private signing material never leaves this fixture. */
export type TestOnlyReviewedActionPromotionAuthority = {
	identity: BrowserUseReviewedActionVerifierIdentity;
	verifier: BrowserUseReviewedActionApprovalVerifier;
	router: BrowserUseReviewedActionPromotionRouter;
	operatorBroker: BrowserUseReviewedActionOperatorBroker;
};

/**
 * Create an ephemeral P-256 broker fixture that drives the real issuance router.
 *
 * The production verifier verifies every receipt. This fixture replaces only
 * Secure Enclave custody and Touch ID, which hermetic tests cannot provide.
 */
export function createTestOnlyReviewedActionPromotionAuthority(): TestOnlyReviewedActionPromotionAuthority {
	const { privateKey, publicKey } = generateKeyPairSync("ec", {
		namedCurve: "prime256v1",
	});
	const jwk = publicKey.export({ format: "jwk" });
	if (jwk.x === undefined || jwk.y === undefined) {
		throw new Error("TEST-ONLY P-256 authority could not export its public key");
	}
	const raw = Buffer.concat([
		Buffer.from([4]),
		Buffer.from(jwk.x, "base64url"),
		Buffer.from(jwk.y, "base64url"),
	]);
	const identity = {
		key_id: createHash("sha256").update(raw).digest("hex"),
		public_key: raw.toString("base64"),
	};
	const verifier = createP256ReviewedActionApprovalVerifier(identity);
	let receiptSequence = 0;
	const operatorBroker: BrowserUseReviewedActionOperatorBroker = {
		readVerifierIdentity: async () => ({ ok: true, identity }),
			async issueReviewedActionPromotion(input) {
				if (
					createHash("sha256")
						.update(input.candidate_bytes)
						.digest("hex") !== input.facts.approved_digest
				) {
					return {
						ok: false as const,
						rejection: {
							code: "broker-failed" as const,
							message: "TEST-ONLY broker refused bytes that differ from the reviewed digest.",
						},
					};
				}
				receiptSequence += 1;
				const unsigned = {
					...input.facts,
					receipt_id: `test-only-receipt-${receiptSequence}`,
					approval_reference: input.approval_reference,
					issued_at_epoch_ms: receiptSequence,
					verifier_key_id: identity.key_id,
				};
				return {
					ok: true as const,
					receipt: {
						contract: "browser-use.reviewed-action-promotion" as const,
						schema_version: "1" as const,
						disposition: "approved" as const,
						presence_backed: true as const,
						...unsigned,
						signature: sign(
							"sha256",
							Buffer.from(reviewedActionApprovalFactsDigest(unsigned), "hex"),
							privateKey,
						).toString("base64"),
					},
				};
			},
	};
	const router = createReviewedActionPromotionRouter({
		verifier,
		broker: operatorBroker,
	});
	return { identity, verifier, router, operatorBroker };
}
