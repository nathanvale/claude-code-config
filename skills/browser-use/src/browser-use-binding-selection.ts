import { createHash } from "node:crypto";
import {
	type BrowserUseBindingResolutionKey,
	type BrowserUseItemBinding,
	type BrowserUseVaultItemEvidence,
	BROWSER_USE_BINDING_RESOLUTION_KEY_KEYS,
	secretShapeFindingOf,
	validateItemBindingShape,
} from "./browser-use-auth-bindings";

const MAXIMUM_SELECTION_GRANT_LIFETIME_MS = 2 * 60_000;

/** Exact facts bound into one first-binding selection ceremony. */
export type BrowserUseBindingSelectionFacts = {
	run_id: string;
	service_id: string;
	origin: string;
	vault_id: string;
	candidate_set_digest: string;
};

/** Short-lived authority for one selected opaque item and one binding revision. */
export type BrowserUseBindingSelectionGrant = {
	grant_id: string;
	resolution_key: BrowserUseBindingResolutionKey;
	binding: BrowserUseItemBinding;
	facts: BrowserUseBindingSelectionFacts;
	issued_at_epoch_ms: number;
	expires_at_epoch_ms: number;
	verifier_key_id: string;
	signature: string;
};

/** Input to the descriptor-private native binding selection ceremony. */
export type BrowserUseBindingSelectionRequest = {
	resolution_key: BrowserUseBindingResolutionKey;
	facts: BrowserUseBindingSelectionFacts;
	candidate_count: number;
};

/** Typed native ceremony refusal. Descriptor values never cross this Port. */
export type BrowserUseBindingSelectionRejection = {
	code:
		| "broker-unavailable"
		| "biometric-capability-missing"
		| "presence-cancelled"
		| "headless-environment"
		| "selection-no-response"
		| "selection-ambiguous"
		| "selection-candidates-drifted";
	message: string;
};

/** Native Port that owns candidate descriptors, local selection, and signing. */
export type BrowserUseBindingSelectionCeremonyPort = {
	requestBindingSelection(input: BrowserUseBindingSelectionRequest): Promise<
		| { ok: true; grant: BrowserUseBindingSelectionGrant }
		| { ok: false; rejection: BrowserUseBindingSelectionRejection }
	>;
};

/** Presence-free verifier plus atomic one-use reservation owner. */
export type BrowserUseBindingSelectionGrantVerifier = {
	/** Verify exact shape, verifier identity, and signature; stored grants remain readable after expiry. */
	verifyStored(grant: unknown): Promise<
		| { ok: true; grant: BrowserUseBindingSelectionGrant }
		| { ok: false; code: string }
	>;
	verifyAndReserve(input: {
		grant: unknown;
		expected: BrowserUseBindingSelectionRequest;
		at_epoch_ms: number;
	}): Promise<
		| { ok: true; grant: BrowserUseBindingSelectionGrant }
		| { ok: false; code: string }
	>;
};

/** Dependencies for cryptographic verification and durable one-use reservation. */
export type BrowserUseBindingSelectionGrantVerifierDeps = {
	verifier: { key_id: string };
	verifySignature(input: {
		digest: string;
		signature: string;
		key_id: string;
	}): boolean;
	reserveGrant(grant_id: string): Promise<boolean>;
};

const FACT_KEYS = [
	"run_id",
	"service_id",
	"origin",
	"vault_id",
	"candidate_set_digest",
] as const satisfies readonly (keyof BrowserUseBindingSelectionFacts)[];

const GRANT_KEYS = [
	"grant_id",
	"resolution_key",
	"binding",
	"facts",
	"issued_at_epoch_ms",
	"expires_at_epoch_ms",
	"verifier_key_id",
	"signature",
] as const satisfies readonly (keyof BrowserUseBindingSelectionGrant)[];

function canonicalValueOf(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalValueOf);
	if (typeof value === "object" && value !== null) {
		const record = value as Record<string, unknown>;
		return Object.keys(record)
			.sort()
			.map((key) => [key, canonicalValueOf(record[key])]);
	}
	return value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 1_024 && secretShapeFindingOf(value) === undefined;
}

function factsAreValid(value: unknown): value is BrowserUseBindingSelectionFacts {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const facts = value as Record<string, unknown>;
	if (!exactKeys(facts, FACT_KEYS)) return false;
	if (
		!["run_id", "service_id", "origin", "vault_id"].every((key) =>
			safeString(facts[key]),
		)
	) {
		return false;
	}
	if (!/^[0-9a-f]{64}$/.test(facts.candidate_set_digest as string)) return false;
	try {
		const parsed = new URL(facts.origin as string);
		return parsed.origin === facts.origin && parsed.protocol === "https:";
	} catch {
		return false;
	}
}

function resolutionKeyIsValid(value: unknown): value is BrowserUseBindingResolutionKey {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const key = value as Record<string, unknown>;
	return exactKeys(key, BROWSER_USE_BINDING_RESOLUTION_KEY_KEYS) && BROWSER_USE_BINDING_RESOLUTION_KEY_KEYS.every((field) => safeString(key[field]));
}

/** Digest the ordered redacted candidate set; reorder and state drift change it. */
export function bindingSelectionCandidateDigestOf(
	items: readonly BrowserUseVaultItemEvidence[],
): string {
	const rows = items.map((item) => [
		item.vault_id,
		item.item_id,
		item.state,
		[...item.origins],
		[...item.login_paths],
		[...item.supported_methods],
	]);
	return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

/** Digest the exact selection grant payload for native P-256 signing. */
export function bindingSelectionGrantDigestOf(
	grant: Omit<BrowserUseBindingSelectionGrant, "signature">,
): string {
	return createHash("sha256")
		.update(JSON.stringify(canonicalValueOf(grant)))
		.digest("hex");
}

/** Admit one selection grant without projecting descriptor-bearing values. */
export function validateBindingSelectionGrantShape(value: unknown): readonly string[] {
	const issues: string[] = [];
	if (typeof value !== "object" || value === null || Array.isArray(value)) return ["grant_shape_invalid"];
	const grant = value as Record<string, unknown>;
	if (!exactKeys(grant, GRANT_KEYS)) issues.push("grant_key_set_invalid");
	if (!safeString(grant.grant_id) || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(grant.grant_id as string)) issues.push("grant_id_invalid");
	if (!resolutionKeyIsValid(grant.resolution_key)) issues.push("grant_resolution_invalid");
	if (validateItemBindingShape(grant.binding).length > 0) issues.push("grant_binding_invalid");
	if (!factsAreValid(grant.facts)) issues.push("grant_facts_invalid");
	if (
		!Number.isSafeInteger(grant.issued_at_epoch_ms) ||
		!Number.isSafeInteger(grant.expires_at_epoch_ms) ||
		(grant.expires_at_epoch_ms as number) <=
			(grant.issued_at_epoch_ms as number) ||
		(grant.expires_at_epoch_ms as number) -
			(grant.issued_at_epoch_ms as number) >
			MAXIMUM_SELECTION_GRANT_LIFETIME_MS
	) {
		issues.push("grant_lifetime_invalid");
	}
	if (
		!safeString(grant.verifier_key_id) ||
		typeof grant.signature !== "string" ||
		grant.signature.length === 0 ||
		grant.signature.length > 4_096
	) {
		issues.push("grant_signature_invalid");
	}
	if (issues.length === 0) {
		const admitted = grant as BrowserUseBindingSelectionGrant;
		if (
			admitted.binding.service_id !== admitted.resolution_key.service_id ||
			admitted.binding.auth_context !== admitted.resolution_key.auth_context ||
			admitted.binding.vault_id !== admitted.facts.vault_id ||
			admitted.binding.allowed_origins.length !== 1 ||
			admitted.binding.allowed_origins[0] !== admitted.facts.origin ||
			admitted.facts.service_id !== admitted.resolution_key.service_id ||
			admitted.binding.binding_revision !== 1
		) issues.push("grant_binding_facts_mismatch");
	}
	return issues;
}

function requestMatchesGrant(
	request: BrowserUseBindingSelectionRequest,
	grant: BrowserUseBindingSelectionGrant,
): boolean {
	return (
		BROWSER_USE_BINDING_RESOLUTION_KEY_KEYS.every(
			(key) => request.resolution_key[key] === grant.resolution_key[key],
		) &&
		FACT_KEYS.every((key) => request.facts[key] === grant.facts[key])
	);
}

/** Build the offline verifier and atomic reservation gate for selection grants. */
export function createBindingSelectionGrantVerifier(
	deps: BrowserUseBindingSelectionGrantVerifierDeps,
): BrowserUseBindingSelectionGrantVerifier {
	async function verifyStored(grant: unknown) {
		if (validateBindingSelectionGrantShape(grant).length > 0) {
			return { ok: false as const, code: "grant_shape_invalid" };
		}
		const admitted = grant as BrowserUseBindingSelectionGrant;
		if (admitted.verifier_key_id !== deps.verifier.key_id) {
			return { ok: false as const, code: "grant_verifier_stale" };
		}
		const { signature, ...unsigned } = admitted;
		if (
			!deps.verifySignature({
				digest: bindingSelectionGrantDigestOf(unsigned),
				signature,
				key_id: admitted.verifier_key_id,
			})
		) {
			return { ok: false as const, code: "grant_signature_invalid" };
		}
		return { ok: true as const, grant: admitted };
	}
	return {
		verifyStored,
		async verifyAndReserve({ grant, expected, at_epoch_ms }) {
			const verified = await verifyStored(grant);
			if (!verified.ok) return verified;
			if (
				at_epoch_ms < verified.grant.issued_at_epoch_ms ||
				at_epoch_ms >= verified.grant.expires_at_epoch_ms
			) {
				return { ok: false, code: "grant_expired" };
			}
			if (!requestMatchesGrant(expected, verified.grant)) {
				return { ok: false, code: "grant_context_mismatch" };
			}
			if (!(await deps.reserveGrant(verified.grant.grant_id))) {
				return { ok: false, code: "grant_consumed" };
			}
			return verified;
		},
	};
}
