import { describe, expect, test } from "bun:test";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import {
	type BrowserUseDeliveryHook,
	type BrowserUseHumanChallenge,
	type BrowserUseTargetReproof,
	type BrowserUseVerifiedTarget,
	deliverConfidentialFields,
} from "./browser-use-confidential-field-delivery";
import type { BrowserUseAuthBlockedCause } from "./browser-use-auth-model";
import type {
	BrowserUseOpCredentialField,
	BrowserUseSecretHandle,
	BrowserUseTokenRetrievalPort,
} from "./browser-use-op";

// =========================================================================
// Confidential Field Delivery choreography (auth plan U4/U5, R14-R18,
// R22-R26; AE4-AE12). Proves the pure choreography holds no bytes, re-proves
// the target before each field, preserves lane + target on resume, and turns
// human-only challenges into resumable continuations — all over fakes.
// =========================================================================

const TARGET: BrowserUseVerifiedTarget = {
	lane_id: "agent-browser",
	run_id: "run-cfd-1",
	top_level_origin: "https://oncore.test",
	frame_origin: "https://oncore.test",
	target_id: "target-1",
	page_id: "page-1",
	frame_id: "frame-1",
	account_ref: "acct-ref-redacted",
	target_proof_digest: "d".repeat(32),
};

const BINDING: BrowserUseItemBinding = {
	service_id: "oncore",
	auth_context: "interactive-login",
	allowed_origins: ["https://oncore.test"],
	allowed_login_paths: [],
	vault_id: "vault-1",
	item_id: "item-1",
	allowed_auth_methods: ["password", "otp"],
	binding_revision: 1,
};

function handle(field: BrowserUseOpCredentialField): BrowserUseSecretHandle {
	return { handle_id: `h-${field}`, field, expires_at_epoch_ms: 9_999_999 };
}

// A TokenRetrievalPort fake that yields OPAQUE handles only (never bytes).
function fakePort(
	overrides: Partial<BrowserUseTokenRetrievalPort> = {},
): BrowserUseTokenRetrievalPort {
	return {
		listVaults: async () => ({ ok: true, vaults: [] }),
		listLoginItems: async () => ({ ok: true, items: [] }),
		getLoginItem: async () => ({
			ok: false,
			rejection: { code: "item-missing", message: "n/a" },
		}),
		fetchCredentialField: async (input) => ({ ok: true, handle: handle(input.field) }),
		...overrides,
	};
}

// A reproof fake that reproduces the target's digest (proof holds).
const reproveOk: BrowserUseTargetReproof = async ({ target }) => ({
	proven: true,
	observed_digest: target.target_proof_digest,
});

// A delivery-hook fake recording which fields it was asked to write; it reports
// only outcome + non-secret shape — it never sees or returns a value.
function recordingHook(byteLen = 10): {
	hook: BrowserUseDeliveryHook;
	fields: BrowserUseOpCredentialField[];
	handleIds: string[];
} {
	const fields: BrowserUseOpCredentialField[] = [];
	const handleIds: string[] = [];
	const hook: BrowserUseDeliveryHook = async (input) => {
		fields.push(input.field);
		handleIds.push(input.handle.handle_id);
		return { ok: true, shape: { field: input.field, byte_length: byteLen } };
	};
	return { hook, fields, handleIds };
}

describe("happy-path delivery", () => {
	test("delivers each planned field and emits a lane-preserving resume directive", async () => {
		const { hook, fields, handleIds } = recordingHook();
		const result = await deliverConfidentialFields({
			binding: BINDING,
			target: TARGET,
			fields: ["password"],
			tokenRetrieval: fakePort(),
			deliver: hook,
			reproveTarget: reproveOk,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(fields).toEqual(["password"]);
		expect(handleIds).toEqual(["h-password"]);
		expect(result.resume.lane_id).toBe("agent-browser");
		expect(result.resume.target_id).toBe("target-1");
		expect(result.resume.discard_stale_refs).toBe(true);
		expect(result.resume.require_fresh_identity_basis).toBe(true);
		expect(result.resume.delivered_shapes).toEqual([
			{ field: "password", byte_length: 10 },
		]);
	});

	test("delivers username-first then password, re-proving before each", async () => {
		let reproofs = 0;
		const reprove: BrowserUseTargetReproof = async ({ target }) => {
			reproofs += 1;
			return { proven: true, observed_digest: target.target_proof_digest };
		};
		const { hook, fields } = recordingHook();
		const result = await deliverConfidentialFields({
			binding: BINDING,
			target: TARGET,
			fields: ["username", "password"],
			tokenRetrieval: fakePort(),
			deliver: hook,
			reproveTarget: reprove,
		});
		expect(result.ok).toBe(true);
		expect(fields).toEqual(["username", "password"]);
		expect(reproofs).toBe(2);
	});

	test("delivers current-OTP under an otp-permitted binding", async () => {
		const { hook, fields } = recordingHook(6);
		const result = await deliverConfidentialFields({
			binding: BINDING,
			target: TARGET,
			fields: ["otp-current"],
			tokenRetrieval: fakePort(),
			deliver: hook,
			reproveTarget: reproveOk,
		});
		expect(result.ok).toBe(true);
		expect(fields).toEqual(["otp-current"]);
	});
});

describe("target re-proof gate (R14)", () => {
	test("blocks on origin mismatch before any secret handle is minted", async () => {
		let fetched = false;
		const port = fakePort({
			fetchCredentialField: async (input) => {
				fetched = true;
				return { ok: true, handle: handle(input.field) };
			},
		});
		const result = await deliverConfidentialFields({
			binding: BINDING,
			target: TARGET,
			fields: ["password"],
			tokenRetrieval: port,
			deliver: recordingHook().hook,
			reproveTarget: async () => ({ proven: false, cause: "origin-mismatch" }),
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.blocked.blocked_cause).toBe("origin-mismatch");
		expect(fetched).toBe(false);
	});

	test("blocks target-proof-invalid when the observed digest drifts", async () => {
		const result = await deliverConfidentialFields({
			binding: BINDING,
			target: TARGET,
			fields: ["password"],
			tokenRetrieval: fakePort(),
			deliver: recordingHook().hook,
			reproveTarget: async () => ({ proven: true, observed_digest: "different" }),
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.blocked.blocked_cause).toBe("target-proof-invalid");
		expect(result.blocked.external_effect_possible).toBe(false);
	});
});

describe("binding permission gate (R12)", () => {
	test("blocks unsupported-method when the binding forbids OTP", async () => {
		const noOtp: BrowserUseItemBinding = {
			...BINDING,
			allowed_auth_methods: ["password"],
		};
		const result = await deliverConfidentialFields({
			binding: noOtp,
			target: TARGET,
			fields: ["otp-current"],
			tokenRetrieval: fakePort(),
			deliver: recordingHook().hook,
			reproveTarget: reproveOk,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.blocked.blocked_cause).toBe("unsupported-method");
	});
});

describe("token retrieval faults map to blocked causes", () => {
	test("missing token blocks missing-token, no delivery", async () => {
		const { hook, fields } = recordingHook();
		const result = await deliverConfidentialFields({
			binding: BINDING,
			target: TARGET,
			fields: ["password"],
			tokenRetrieval: fakePort({
				fetchCredentialField: async () => ({
					ok: false,
					rejection: { code: "token-invalid", message: "n/a" },
				}),
			}),
			deliver: hook,
			reproveTarget: reproveOk,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.blocked.blocked_cause).toBe("missing-token");
		expect(fields).toEqual([]);
	});

	test("a moved item blocks revoked-binding", async () => {
		const result = await deliverConfidentialFields({
			binding: BINDING,
			target: TARGET,
			fields: ["password"],
			tokenRetrieval: fakePort({
				fetchCredentialField: async () => ({
					ok: false,
					rejection: { code: "item-missing", message: "n/a" },
				}),
			}),
			deliver: recordingHook().hook,
			reproveTarget: reproveOk,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.blocked.blocked_cause).toBe("revoked-binding");
	});
});

describe("delivery-hook failure (R18/R19)", () => {
	test("a failed write reports possible effect and cleared field", async () => {
		const result = await deliverConfidentialFields({
			binding: BINDING,
			target: TARGET,
			fields: ["password"],
			tokenRetrieval: fakePort(),
			deliver: async () => ({
				ok: false,
				reason: "field-write-failed",
				field_cleared: true,
			}),
			reproveTarget: reproveOk,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.blocked.blocked_cause).toBe("capability-loss");
		expect(result.blocked.external_effect_possible).toBe(true);
		expect(result.blocked.fields_cleared).toBe(true);
	});

	test("helper-observed target drift blocks target-proof-invalid; effect is possible (write-ahead honesty)", async () => {
		const result = await deliverConfidentialFields({
			binding: BINDING,
			target: TARGET,
			fields: ["password"],
			tokenRetrieval: fakePort(),
			deliver: async () => ({
				ok: false,
				reason: "target-drift",
				field_cleared: true,
			}),
			reproveTarget: reproveOk,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.blocked.blocked_cause).toBe("target-proof-invalid");
		// Any failure other than helper-unavailable cannot rule out a landed write.
		expect(result.blocked.external_effect_possible).toBe(true);
	});

	test("a mid-action helper crash reports possible effect (unknown-outcome, R19)", async () => {
		const result = await deliverConfidentialFields({
			binding: BINDING,
			target: TARGET,
			fields: ["password"],
			tokenRetrieval: fakePort(),
			deliver: async () => ({
				ok: false,
				reason: "helper-crash",
				field_cleared: false,
			}),
			reproveTarget: reproveOk,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.blocked.blocked_cause).toBe("capability-loss");
		// A crash mid-action cannot rule out that the bounded write landed.
		expect(result.blocked.external_effect_possible).toBe(true);
	});

	test("a helper that never started (helper-unavailable) honestly claims no external effect", async () => {
		const result = await deliverConfidentialFields({
			binding: BINDING,
			target: TARGET,
			fields: ["password"],
			tokenRetrieval: fakePort(),
			deliver: async () => ({
				ok: false,
				reason: "helper-unavailable",
				field_cleared: false,
			}),
			reproveTarget: reproveOk,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.blocked.blocked_cause).toBe("capability-loss");
		expect(result.blocked.external_effect_possible).toBe(false);
	});
});

describe("human-only challenges (R16/R26)", () => {
	const cases: Array<[BrowserUseHumanChallenge, BrowserUseAuthBlockedCause]> = [
		["passkey", "user-presence-required"],
		["captcha", "user-presence-required"],
		["consent", "user-presence-required"],
		["recovery-code", "user-presence-required"],
		["ambiguous-identity", "human-identity-attestation-required"],
	];
	for (const [challenge, cause] of cases) {
		test(`${challenge} stops before any secret access with a resumable continuation`, async () => {
			let fetched = false;
			const result = await deliverConfidentialFields({
				binding: BINDING,
				target: TARGET,
				fields: ["password"],
				tokenRetrieval: fakePort({
					fetchCredentialField: async (input) => {
						fetched = true;
						return { ok: true, handle: handle(input.field) };
					},
				}),
				deliver: recordingHook().hook,
				reproveTarget: reproveOk,
				detected_challenge: challenge,
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.blocked.blocked_cause).toBe(cause);
			expect(result.blocked.continuation.next_action_id.length).toBeGreaterThan(0);
			expect(fetched).toBe(false);
		});
	}
});

describe("empty field plan fails closed", () => {
	test("nothing to deliver is a caller error, not a success", async () => {
		const result = await deliverConfidentialFields({
			binding: BINDING,
			target: TARGET,
			fields: [],
			tokenRetrieval: fakePort(),
			deliver: recordingHook().hook,
			reproveTarget: reproveOk,
		});
		expect(result.ok).toBe(false);
	});
});
