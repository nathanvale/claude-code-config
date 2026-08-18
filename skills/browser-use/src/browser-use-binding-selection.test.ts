import { describe, expect, test } from "bun:test";
import type { BrowserUseVaultItemEvidence } from "./browser-use-auth-bindings";
import {
	type BrowserUseBindingSelectionGrant,
	type BrowserUseBindingSelectionRequest,
	bindingSelectionCandidateDigestOf,
	bindingSelectionGrantDigestOf,
	createBindingSelectionGrantVerifier,
	validateBindingSelectionGrantShape,
} from "./browser-use-binding-selection";

function item(id: string, state: BrowserUseVaultItemEvidence["state"] = "active"): BrowserUseVaultItemEvidence {
	return {
		item_id: id,
		vault_id: "vault-1",
		origins: ["https://github.com"],
		login_paths: ["/login"],
		supported_methods: ["password"],
		state,
	};
}

const request: BrowserUseBindingSelectionRequest = {
	resolution_key: {
		binding_ref: "github",
		service_id: "github",
		auth_context: "interactive-login",
		environment: "agent-chrome",
		profile: "default",
	},
	facts: {
		run_id: "run-1",
		service_id: "github",
		origin: "https://github.com",
		vault_id: "vault-1",
		candidate_set_digest: bindingSelectionCandidateDigestOf([item("item-1"), item("item-2")]),
	},
	candidate_count: 2,
};

function unsignedGrant(): Omit<BrowserUseBindingSelectionGrant, "signature"> {
	return {
		grant_id: "grant-1",
		resolution_key: request.resolution_key,
		binding: {
			service_id: "github",
			auth_context: "interactive-login",
			allowed_origins: ["https://github.com"],
			allowed_login_paths: ["/login"],
			vault_id: "vault-1",
			item_id: "item-2",
			allowed_auth_methods: ["password"],
			binding_revision: 1,
		},
		facts: request.facts,
		issued_at_epoch_ms: 1_000,
		expires_at_epoch_ms: 2_000,
		verifier_key_id: "key-1",
	};
}

function signedGrant(): BrowserUseBindingSelectionGrant {
	const unsigned = unsignedGrant();
	return { ...unsigned, signature: `sig:${bindingSelectionGrantDigestOf(unsigned)}` };
}

function harness() {
	const consumed = new Set<string>();
	let writes = 0;
	const verifier = createBindingSelectionGrantVerifier({
		verifier: { key_id: "key-1" },
		verifySignature: ({ digest, signature }) => signature === `sig:${digest}`,
		reserveGrant: async (grantId) => {
			if (consumed.has(grantId)) return false;
			consumed.add(grantId);
			writes += 1;
			return true;
		},
	});
	return { verifier, reservationWrites: () => writes };
}

describe("binding selection candidate digest", () => {
	test("ordered redacted evidence detects reorder, move, and field drift", () => {
		const candidates = [item("item-1"), item("item-2")];
		const digest = bindingSelectionCandidateDigestOf(candidates);
		expect(bindingSelectionCandidateDigestOf([...candidates].reverse())).not.toBe(digest);
		expect(bindingSelectionCandidateDigestOf([item("item-1"), item("item-2", "moved")])).not.toBe(digest);
		expect(bindingSelectionCandidateDigestOf([item("item-1"), { ...item("item-2"), login_paths: ["/session"] }])).not.toBe(digest);
	});
});

describe("binding selection grant verification", () => {
	test("admits bounded cryptographic digest and signature fields without secret heuristics", () => {
		const grant = signedGrant();
		expect(
			validateBindingSelectionGrantShape({
				...grant,
				facts: {
					...grant.facts,
					candidate_set_digest: "abcdef0123456789".repeat(4),
				},
				signature: "A".repeat(96),
			}),
		).toEqual([]);
		expect(
			validateBindingSelectionGrantShape({
				...grant,
				expires_at_epoch_ms: grant.issued_at_epoch_ms + 120_001,
			}),
		).toContain("grant_lifetime_invalid");
	});

	test("one valid grant reserves once; replay loses without a second reservation write", async () => {
		const { verifier, reservationWrites } = harness();
		const grant = signedGrant();
		expect(await verifier.verifyAndReserve({ grant, expected: request, at_epoch_ms: 1_500 })).toMatchObject({ ok: true });
		expect(await verifier.verifyAndReserve({ grant, expected: request, at_epoch_ms: 1_500 })).toEqual({ ok: false, code: "grant_consumed" });
		expect(reservationWrites()).toBe(1);
	});

	test("forgery, expiry, and wrong run/origin/vault fail before reservation", async () => {
		for (const fixture of [
			{ grant: { ...signedGrant(), signature: "forged" }, expected: request, at: 1_500, code: "grant_signature_invalid" },
			{ grant: signedGrant(), expected: request, at: 2_000, code: "grant_expired" },
			{ grant: signedGrant(), expected: { ...request, facts: { ...request.facts, run_id: "run-other" } }, at: 1_500, code: "grant_context_mismatch" },
			{ grant: signedGrant(), expected: { ...request, facts: { ...request.facts, origin: "https://example.test" } }, at: 1_500, code: "grant_context_mismatch" },
			{ grant: signedGrant(), expected: { ...request, facts: { ...request.facts, vault_id: "vault-other" } }, at: 1_500, code: "grant_context_mismatch" },
		] as const) {
			const { verifier, reservationWrites } = harness();
			expect(await verifier.verifyAndReserve({ grant: fixture.grant, expected: fixture.expected, at_epoch_ms: fixture.at })).toEqual({ ok: false, code: fixture.code });
			expect(reservationWrites()).toBe(0);
		}
	});
});
