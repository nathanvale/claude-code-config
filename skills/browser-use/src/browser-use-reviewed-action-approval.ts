import { createHash, createPublicKey, verify } from "node:crypto";
import {
	type BrowserUseActionContainmentPolicy,
	type BrowserUseActionEffectClass,
	exactOriginValid as exactOrigin,
} from "./browser-use-runbook-actions";
import { isJsonObject as isPlainObject } from "./browser-use-core";

const SAFE_COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const SAFE_DIGEST = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;

// Verifier identity contract: owned here beside receipt verification so the
// promotion front door and runtime reader cannot drift from it.
export const REVIEWED_ACTION_VERIFIER_CONTRACT = "browser-use.reviewed-action-verifier";
export const REVIEWED_ACTION_VERIFIER_SCHEMA_VERSION = "1";
export const REVIEWED_ACTION_VERIFIER_FILE = "reviewed-action-verifier.json";

/** Exact mechanically-derived facts the external broker approves. */
export type BrowserUseReviewedActionApprovalFacts = {
	source_commit: string;
	action_id: string;
	approved_digest: string;
	approved_origin: string;
	approved_effect: BrowserUseActionEffectClass;
	audited_capabilities: readonly string[];
	containment: BrowserUseActionContainmentPolicy;
	input_schema_digest: string;
	result_schema_digest: string;
	postcondition_digest: string | null;
};

/** Signed Reviewed Action receipt emitted only by the presence-backed broker. */
export type BrowserUseReviewedActionPromotionReceipt =
	BrowserUseReviewedActionApprovalFacts & {
		contract: "browser-use.reviewed-action-promotion";
		schema_version: "1";
		receipt_id: string;
		disposition: "approved";
		approval_reference: string;
		presence_backed: true;
		issued_at_epoch_ms: number;
		verifier_key_id: string;
		signature: string;
	};

/** Public verifier identity; its private signing authority is absent here. */
export type BrowserUseReviewedActionVerifierIdentity = {
	key_id: string;
	public_key: string;
};

/** Validate the pinned P-256 verifier identity emitted by the native broker. */
export function reviewedActionVerifierIdentityIsValid(
	identity: BrowserUseReviewedActionVerifierIdentity,
): boolean {
	if (!SAFE_ID.test(identity.key_id)) return false;
	let raw: Buffer;
	try {
		raw = Buffer.from(identity.public_key, "base64");
	} catch {
		return false;
	}
	return (
		raw.length === 65 &&
		raw[0] === 4 &&
		createHash("sha256").update(raw).digest("hex") === identity.key_id
	);
}

/** Offline verifier result with no signing or promotion capability. */
export type BrowserUseReviewedActionApprovalVerifier = {
	verify(
		receipt: BrowserUseReviewedActionPromotionReceipt,
	): { ok: true } | { ok: false; code: string };
};

/** Presence-gated authority implemented outside the ordinary agent process. */
export type BrowserUseReviewedActionPromotionBrokerPort = {
	issueReviewedActionPromotion(input: {
		facts: BrowserUseReviewedActionApprovalFacts;
		candidate_bytes: string;
		approval_reference: string;
	}): Promise<
		| { ok: true; receipt: BrowserUseReviewedActionPromotionReceipt }
		| {
				ok: false;
				rejection: {
					code:
						| "biometric-capability-missing"
						| "presence-cancelled"
						| "headless-environment"
						| "signing-key-missing"
						| "signing-key-already-enrolled"
						| "signing-key-custody-invalid"
						| "broker-response-unknown"
						| "broker-failed";
					message: string;
				};
		  }
	>;
};

/** Agent-visible promotion request surface with no signing capability. */
export type BrowserUseReviewedActionPromotionRouter = {
	requestPromotion(input: {
		facts: BrowserUseReviewedActionApprovalFacts;
		candidate_bytes: string;
		approval_reference: string;
	}): Promise<
		| { ok: true; receipt: BrowserUseReviewedActionPromotionReceipt }
		| { ok: false; code: string; message: string }
	>;
};

/** Dependencies available to the agent process for offline verification only. */
export type BrowserUseReviewedActionApprovalVerifierDeps = {
	verifier: BrowserUseReviewedActionVerifierIdentity;
	verifySignature(input: {
		digest: string;
		signature: string;
		key_id: string;
		public_key: string;
	}): boolean;
};

type SignedApprovalFacts = BrowserUseReviewedActionApprovalFacts & {
	receipt_id: string;
	approval_reference: string;
	issued_at_epoch_ms: number;
	verifier_key_id: string;
};

const RECEIPT_KEYS = [
	"contract",
	"schema_version",
	"receipt_id",
	"disposition",
	"source_commit",
	"action_id",
	"approved_digest",
	"approved_origin",
	"approved_effect",
	"audited_capabilities",
	"containment",
	"input_schema_digest",
	"result_schema_digest",
	"postcondition_digest",
	"approval_reference",
	"presence_backed",
	"issued_at_epoch_ms",
	"verifier_key_id",
	"signature",
] as const;

// Signs fully-typed receipt facts: must NOT drop undefined-valued entries
// (unlike canonicalJsonStable) — absent-vs-undefined is part of the signed bytes.
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (typeof value === "object" && value !== null) {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}


/** Hash the exact receipt facts signed by the isolated approval broker. */
export function reviewedActionApprovalFactsDigest(
	facts: SignedApprovalFacts,
): string {
	return createHash("sha256").update(canonical(facts)).digest("hex");
}

/** Validate a promotion receipt without invoking signing authority. */
export function reviewedActionPromotionReceiptIsValid(
	value: unknown,
): value is BrowserUseReviewedActionPromotionReceipt {
	if (!isPlainObject(value)) return false;
	const keys = Object.keys(value).sort();
	const expectedKeys = [...RECEIPT_KEYS].sort();
	if (
		keys.length !== expectedKeys.length ||
		!keys.every((key, index) => key === expectedKeys[index])
	) {
		return false;
	}
	return (
		value.contract === "browser-use.reviewed-action-promotion" &&
		value.schema_version === "1" &&
		value.disposition === "approved" &&
		value.presence_backed === true &&
		typeof value.receipt_id === "string" &&
		SAFE_ID.test(value.receipt_id) &&
		typeof value.action_id === "string" &&
		SAFE_ID.test(value.action_id) &&
		typeof value.source_commit === "string" &&
		SAFE_COMMIT.test(value.source_commit) &&
		typeof value.approved_digest === "string" &&
		SAFE_DIGEST.test(value.approved_digest) &&
		typeof value.approved_origin === "string" &&
		exactOrigin(value.approved_origin) &&
		(value.approved_effect === "read" || value.approved_effect === "mutation") &&
		Array.isArray(value.audited_capabilities) &&
		value.audited_capabilities.length > 0 &&
		value.audited_capabilities.every(
			(capability) => typeof capability === "string" && SAFE_ID.test(capability),
		) &&
		new Set(value.audited_capabilities).size === value.audited_capabilities.length &&
		(value.containment === "none" ||
			value.containment === "read-only-observation") &&
		typeof value.input_schema_digest === "string" &&
		SAFE_DIGEST.test(value.input_schema_digest) &&
		typeof value.result_schema_digest === "string" &&
		SAFE_DIGEST.test(value.result_schema_digest) &&
		(value.postcondition_digest === null ||
			(typeof value.postcondition_digest === "string" &&
				SAFE_DIGEST.test(value.postcondition_digest))) &&
		typeof value.approval_reference === "string" &&
		SAFE_ID.test(value.approval_reference) &&
		typeof value.issued_at_epoch_ms === "number" &&
		Number.isSafeInteger(value.issued_at_epoch_ms) &&
		value.issued_at_epoch_ms >= 0 &&
		typeof value.verifier_key_id === "string" &&
		SAFE_ID.test(value.verifier_key_id) &&
		typeof value.signature === "string" &&
		value.signature.length > 0 &&
		value.signature.length <= 4096
	);
}

function unsignedFacts(
	receipt: BrowserUseReviewedActionPromotionReceipt,
): SignedApprovalFacts {
	return {
		source_commit: receipt.source_commit,
		action_id: receipt.action_id,
		approved_digest: receipt.approved_digest,
		approved_origin: receipt.approved_origin,
		approved_effect: receipt.approved_effect,
		audited_capabilities: receipt.audited_capabilities,
		containment: receipt.containment,
		input_schema_digest: receipt.input_schema_digest,
		result_schema_digest: receipt.result_schema_digest,
		postcondition_digest: receipt.postcondition_digest,
		receipt_id: receipt.receipt_id,
		approval_reference: receipt.approval_reference,
		issued_at_epoch_ms: receipt.issued_at_epoch_ms,
		verifier_key_id: receipt.verifier_key_id,
	};
}

/** Build the broker-free offline verifier used by activation and execution. */
export function createReviewedActionApprovalVerifier(
	deps: BrowserUseReviewedActionApprovalVerifierDeps,
): BrowserUseReviewedActionApprovalVerifier {
	return {
		verify(receipt) {
			if (!reviewedActionPromotionReceiptIsValid(receipt)) {
				return { ok: false, code: "action_promotion_receipt_invalid" };
			}
			if (receipt.verifier_key_id !== deps.verifier.key_id) {
				return { ok: false, code: "action_promotion_verifier_stale" };
			}
			return deps.verifySignature({
				digest: reviewedActionApprovalFactsDigest(unsignedFacts(receipt)),
				signature: receipt.signature,
				key_id: receipt.verifier_key_id,
				public_key: deps.verifier.public_key,
			})
				? { ok: true }
				: { ok: false, code: "action_promotion_signature_invalid" };
		},
	};
}

/** Build the production offline verifier for Secure Enclave P-256 receipts. */
export function createP256ReviewedActionApprovalVerifier(
	identity: BrowserUseReviewedActionVerifierIdentity,
): BrowserUseReviewedActionApprovalVerifier {
	if (!reviewedActionVerifierIdentityIsValid(identity)) {
		return {
			verify: () => ({
				ok: false,
				code: "action_promotion_verifier_identity_invalid",
			}),
		};
	}
	const raw = Buffer.from(identity.public_key, "base64");
	let publicKey: ReturnType<typeof createPublicKey>;
	try {
		publicKey = createPublicKey({
			key: {
				kty: "EC",
				crv: "P-256",
				x: raw.subarray(1, 33).toString("base64url"),
				y: raw.subarray(33, 65).toString("base64url"),
			},
			format: "jwk",
		});
	} catch {
		return {
			verify: () => ({
				ok: false,
				code: "action_promotion_verifier_identity_invalid",
			}),
		};
	}
	return createReviewedActionApprovalVerifier({
		verifier: identity,
		verifySignature: ({ digest, signature }) => {
			try {
				return verify(
					"sha256",
					Buffer.from(digest, "hex"),
					publicKey,
					Buffer.from(signature, "base64"),
				);
			} catch {
				return false;
			}
		},
	});
}

/**
 * Route an exact-byte promotion request to the presence-backed broker.
 *
 * The returned object exposes no broker or signing method. Broker absence is a
 * legal refusal, and every emitted receipt is verified offline before the
 * caller may persist it.
 */
export function createReviewedActionPromotionRouter(input: {
	broker: BrowserUseReviewedActionPromotionBrokerPort | null;
	verifier: BrowserUseReviewedActionApprovalVerifier;
}): BrowserUseReviewedActionPromotionRouter {
	return {
		async requestPromotion(request) {
			if (!SAFE_ID.test(request.approval_reference)) {
				return {
					ok: false,
					code: "action_promotion_approval_reference_invalid",
					message: "the human review reference is not a safe identifier.",
				};
			}
			if (input.broker === null) {
				return {
					ok: false,
					code: "action_promotion_broker_unavailable",
					message: "the OS-isolated Reviewed Action approval broker is unavailable.",
				};
			}
			const issued = await input.broker.issueReviewedActionPromotion(request);
			if (!issued.ok) {
				return {
					ok: false,
					code: `action_promotion_${issued.rejection.code.replaceAll("-", "_")}`,
					message: issued.rejection.message,
				};
			}
			const verified = verifyReviewedActionApproval({
				facts: request.facts,
				receipts: [issued.receipt],
				verifier: input.verifier,
			});
			if (!verified.ok) {
				return {
					ok: false,
					code: verified.code,
					message: "the broker response did not verify against the exact reviewed facts.",
				};
			}
			if (issued.receipt.approval_reference !== request.approval_reference) {
				return {
					ok: false,
					code: "action_promotion_approval_reference_mismatch",
					message: "the broker response changed the human review reference.",
				};
			}
			return { ok: true, receipt: issued.receipt };
		},
	};
}

function factsMatch(
	left: BrowserUseReviewedActionApprovalFacts,
	right: BrowserUseReviewedActionApprovalFacts,
): boolean {
	const project = (facts: BrowserUseReviewedActionApprovalFacts) => ({
		source_commit: facts.source_commit,
		action_id: facts.action_id,
		approved_digest: facts.approved_digest,
		approved_origin: facts.approved_origin,
		approved_effect: facts.approved_effect,
		audited_capabilities: facts.audited_capabilities,
		containment: facts.containment,
		input_schema_digest: facts.input_schema_digest,
		result_schema_digest: facts.result_schema_digest,
		postcondition_digest: facts.postcondition_digest,
	});
	return canonical(project(left)) === canonical(project(right));
}

/** Resolve one exact signed receipt; caller labels and audience metadata are absent. */
export function verifyReviewedActionApproval(input: {
	facts: BrowserUseReviewedActionApprovalFacts;
	receipts: readonly unknown[];
	verifier: BrowserUseReviewedActionApprovalVerifier;
	mechanicalAudit?: { ok: true } | { ok: false; code: string };
}):
	| { ok: true; receipt_id: string; approval_reference: string }
	| { ok: false; code: string } {
	if (input.mechanicalAudit?.ok === false) {
		return { ok: false, code: input.mechanicalAudit.code };
	}
	if (input.receipts.length === 0) {
		return { ok: false, code: "action_promotion_absent" };
	}
	const seen = new Set<string>();
	for (const value of input.receipts) {
		if (!reviewedActionPromotionReceiptIsValid(value)) {
			return { ok: false, code: "action_promotion_receipt_invalid" };
		}
		if (seen.has(value.receipt_id)) {
			return { ok: false, code: "action_promotion_replayed" };
		}
		seen.add(value.receipt_id);
	}
	const exact = input.receipts.filter(
		(value): value is BrowserUseReviewedActionPromotionReceipt =>
			reviewedActionPromotionReceiptIsValid(value) && factsMatch(value, input.facts),
	);
	if (exact.length !== 1) {
		return { ok: false, code: "action_promotion_facts_mismatch" };
	}
	const verified = input.verifier.verify(exact[0]);
	if (!verified.ok) return verified;
	return {
		ok: true,
		receipt_id: exact[0].receipt_id,
		approval_reference: exact[0].approval_reference,
	};
}
