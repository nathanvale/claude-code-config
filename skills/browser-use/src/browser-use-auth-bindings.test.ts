import { describe, expect, test } from "bun:test";
import {
	type BrowserUseAuthContext,
	type BrowserUseBindingAuthMethod,
	type BrowserUseBindingMatchInput,
	type BrowserUseImportCandidate,
	type BrowserUseItemBinding,
	type BrowserUseVaultItemEvidence,
	BROWSER_USE_AUTH_CONTEXTS,
	BROWSER_USE_BINDING_AUTH_METHODS,
	BROWSER_USE_BINDING_STALE_STATES,
	BROWSER_USE_IMPORT_CANDIDATE_KEYS,
	BROWSER_USE_ITEM_BINDING_KEYS,
	BROWSER_USE_SECRET_SHAPE_MAX_STRING_LENGTH,
	BROWSER_USE_SECRET_SHAPE_PATTERNS,
	BROWSER_USE_VAULT_ITEM_EVIDENCE_KEYS,
	assessBindingMethod,
	assessBindingUsability,
	importCandidates,
	matchItemBinding,
	normalizeOrigin,
	screenImportCandidate,
	secretShapeFindingOf,
	validateImportCandidateShape,
	validateItemBindingShape,
	validateVaultItemEvidenceShape,
} from "./browser-use-auth-bindings";
import { BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE } from "./browser-use-auth-model";

// ---------------------------------------------------------------------------
// Item Binding + Import Candidate model seam (auth U3a PR1, ADR 0029 SD1-SD6;
// R10, R11, R13). Proves: legacy data proposes and never binds (hints rank,
// never authorize; legacy origins become grant-requiring proposals), the
// single-owner match policy binds only on exactly one live-evidence match,
// candidate screening refuses secret-positive input without echoing bytes,
// stale bindings sweep to the one revoked-binding repair continuation, and
// the passkey/user-presence lane is unrepresentable as a binding method.
// All continuations are structural clones of the code-owned cause table.
// ---------------------------------------------------------------------------

const PORTAL_ORIGIN = "https://portal.example.com";
const LEGACY_ORIGIN = "https://legacy.example.com";

function baseEvidence(
	overrides: Partial<BrowserUseVaultItemEvidence> = {},
): BrowserUseVaultItemEvidence {
	return {
		item_id: "item-1",
		vault_id: "vault-1",
		origins: [PORTAL_ORIGIN],
		login_paths: ["/login"],
		supported_methods: ["password", "otp"],
		state: "active",
		...overrides,
	};
}

function baseBinding(
	overrides: Partial<BrowserUseItemBinding> = {},
): BrowserUseItemBinding {
	return {
		service_id: "oncore",
		auth_context: "interactive-login",
		allowed_origins: [PORTAL_ORIGIN],
		allowed_login_paths: ["/login"],
		vault_id: "vault-1",
		item_id: "item-1",
		allowed_auth_methods: ["password", "otp"],
		binding_revision: 1,
		...overrides,
	};
}

function baseCandidate(
	overrides: Partial<BrowserUseImportCandidate> = {},
): BrowserUseImportCandidate {
	return {
		candidate_id: "cand-1",
		service_id: "oncore",
		auth_context: "interactive-login",
		legacy_context_prose: null,
		hint_item_id: null,
		proposed_origins: [PORTAL_ORIGIN],
		legacy_vault_name: null,
		provenance: "legacy-auth-pointer",
		...overrides,
	};
}

function baseMatchInput(
	overrides: Partial<BrowserUseBindingMatchInput> = {},
): BrowserUseBindingMatchInput {
	return {
		service_id: "oncore",
		auth_context: "interactive-login",
		target_origins: [PORTAL_ORIGIN],
		login_path: null,
		vault_id: "vault-1",
		items: [baseEvidence()],
		hint: null,
		...overrides,
	};
}

describe("secret-shape guard (D3)", () => {
	test("mirrors the fragment patterns and extends them", () => {
		const sources = BROWSER_USE_SECRET_SHAPE_PATTERNS.map((p) => p.source);
		expect(sources).toContain("op:\\/\\/");
		expect(sources).toContain("wss?:\\/\\/");
		expect(sources).toContain("otpauth:\\/\\/");
		expect(BROWSER_USE_SECRET_SHAPE_MAX_STRING_LENGTH).toBe(256);
	});

	test("classifies each secret-shaped family and clears clean strings", () => {
		expect(secretShapeFindingOf("op://Private/GitHub/password")).toEqual({
			reason: "secret-reference",
		});
		expect(secretShapeFindingOf("wss://relay.example.com/live")).toEqual({
			reason: "live-endpoint-reference",
		});
		expect(secretShapeFindingOf("ws://relay.example.com")).toEqual({
			reason: "live-endpoint-reference",
		});
		expect(secretShapeFindingOf("otpauth://totp/example")).toEqual({
			reason: "totp-seed-shaped",
		});
		expect(secretShapeFindingOf("JBSWY3DPEHPK3PXP".repeat(2))).toEqual({
			reason: "totp-seed-shaped",
		});
		expect(secretShapeFindingOf("jbswy3dpehpk3pxp".repeat(2))).toEqual({
			reason: "totp-seed-shaped",
		});
		expect(secretShapeFindingOf("a".repeat(257))).toEqual({
			reason: "exceeds-bounded-length",
		});
		expect(secretShapeFindingOf(PORTAL_ORIGIN)).toBeUndefined();
		expect(secretShapeFindingOf("item-1")).toBeUndefined();
	});

	test("boundary negatives: at the length bound and one under the base32 run", () => {
		// Exactly 256 chars (no base32-length letter run) is within the bound.
		expect(secretShapeFindingOf("a-".repeat(128))).toBeUndefined();
		// A 31-char base32 run is one under the flagged run length, either case.
		expect(
			secretShapeFindingOf("JBSWY3DPEHPK3PXP".repeat(2).slice(0, 31)),
		).toBeUndefined();
		expect(
			secretShapeFindingOf("jbswy3dpehpk3pxp".repeat(2).slice(0, 31)),
		).toBeUndefined();
	});
});

describe("origin normalization (R10)", () => {
	test("strips path, query, fragment, and the default port; lowercases", () => {
		const result = normalizeOrigin("https://Portal.Example.com:443/login?next=/a#f");
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.origin).toBe(PORTAL_ORIGIN);
	});

	test("keeps a non-default port", () => {
		const result = normalizeOrigin("https://portal.example.com:8443/x");
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.origin).toBe("https://portal.example.com:8443");
	});

	test("refuses unparseable and non-http(s) input", () => {
		const junk = normalizeOrigin("not a url");
		expect(junk.ok).toBe(false);
		if (!junk.ok) expect(junk.rejection.code).toBe("origin_unparseable");
		const mailto = normalizeOrigin("mailto:x@example.com");
		expect(mailto.ok).toBe(false);
	});
});

describe("shape validators (fail-closed Issue[])", () => {
	test("a well-formed binding, candidate, and evidence record admit cleanly", () => {
		expect(validateItemBindingShape(baseBinding())).toEqual([]);
		expect(validateImportCandidateShape(baseCandidate())).toEqual([]);
		expect(validateVaultItemEvidenceShape(baseEvidence())).toEqual([]);
	});

	test("binding record redaction fails closed (KTD7)", () => {
		const withUsername = { ...baseBinding(), username: "nathan" };
		expect(validateItemBindingShape(withUsername).map((i) => i.code)).toEqual([
			"binding_key_set_invalid",
		]);

		const longId = validateItemBindingShape(baseBinding({ item_id: "a".repeat(300) }));
		expect(longId.some((i) => i.code === "binding_value_secret_shaped")).toBe(true);

		const nonFixpoint = validateItemBindingShape(
			baseBinding({ allowed_origins: ["https://a.example.com/login"] }),
		);
		expect(nonFixpoint.some((i) => i.code === "binding_origin_invalid")).toBe(true);

		const nonObject = validateItemBindingShape("nope");
		expect(nonObject).toHaveLength(1);
		expect(nonObject[0]?.code).toBe("binding_field_invalid");
	});

	test("flag-shaped ids never admit; a tampered binding cannot reshape op argv", () => {
		const flagged = validateItemBindingShape(baseBinding({ item_id: "--reveal" }));
		expect(flagged.some((i) => i.code === "binding_field_invalid")).toBe(true);
		const flaggedVault = validateItemBindingShape(
			baseBinding({ vault_id: "-vault" }),
		);
		expect(flaggedVault.some((i) => i.code === "binding_field_invalid")).toBe(
			true,
		);
	});

	test("issue messages never echo values", () => {
		const issues = validateItemBindingShape(
			baseBinding({ item_id: "op://Private/GitHub/password" }),
		);
		expect(issues.length).toBeGreaterThan(0);
		expect(JSON.stringify(issues)).not.toContain("op://");
	});

	test("flag-shaped evidence ids never admit; evidence ids reach op argv via minted bindings", () => {
		const flagged = validateVaultItemEvidenceShape(
			baseEvidence({ item_id: "--reveal" }),
		);
		expect(flagged.some((i) => i.code === "evidence_field_invalid")).toBe(true);
		const flaggedVault = validateVaultItemEvidenceShape(
			baseEvidence({ vault_id: "-vault" }),
		);
		expect(flaggedVault.some((i) => i.code === "evidence_field_invalid")).toBe(
			true,
		);
	});

	test("evidence with an unknown state or key fails closed", () => {
		const badState = validateVaultItemEvidenceShape(
			baseEvidence({ state: "paused" as BrowserUseVaultItemEvidence["state"] }),
		);
		expect(badState.some((i) => i.code === "evidence_field_invalid")).toBe(true);
		const extraKey = validateVaultItemEvidenceShape({
			...baseEvidence(),
			notes: "x",
		});
		expect(extraKey.map((i) => i.code)).toEqual(["evidence_key_set_invalid"]);
	});
});

describe("candidate screening (SD3, SD5)", () => {
	test("a clean candidate passes through verbatim", () => {
		const candidate = baseCandidate();
		const result = screenImportCandidate(candidate);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.candidate).toEqual(candidate);
	});

	test("an unknown auth context is refused, never coerced (SD5)", () => {
		const candidate = {
			...baseCandidate(),
			auth_context: "cli-login" as BrowserUseAuthContext,
		};
		const issues = validateImportCandidateShape(candidate);
		expect(
			issues.some(
				(i) =>
					i.code === "candidate_auth_context_unknown" &&
					i.path === "candidate.auth_context",
			),
		).toBe(true);
		const result = screenImportCandidate(candidate);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("candidate-shape-invalid");
		}
	});

	test("a secret-shaped value refuses secret-positive without echoing bytes", () => {
		const result = screenImportCandidate(
			baseCandidate({ legacy_context_prose: "op://Private/GitHub/password" }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("secret-positive-candidate");
			expect(result.rejection.candidate_id).toBe("cand-1");
			expect(JSON.stringify(result.rejection)).not.toContain("op://");
		}
	});

	test("a secret-shaped candidate_id refuses with a null id and zero secret bytes", () => {
		const result = screenImportCandidate(
			baseCandidate({ candidate_id: "op://Private/GitHub/password" }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("secret-positive-candidate");
			expect(result.rejection.candidate_id).toBeNull();
		}
		expect(JSON.stringify(result)).not.toContain("op://");
	});

	test("a nested secret escalates to secret-positive, never a shape downgrade (SD3)", () => {
		// Buried under a clean-named nested key: the value sweep must recurse.
		const nestedValue = screenImportCandidate({
			...baseCandidate(),
			meta: { note: "op://Private/GitHub/password" },
		});
		expect(nestedValue.ok).toBe(false);
		if (!nestedValue.ok) {
			expect(nestedValue.rejection.code).toBe("secret-positive-candidate");
		}
		expect(JSON.stringify(nestedValue)).not.toContain("op://");

		// A secret-named nested key contaminates even with a clean value.
		const nestedKey = screenImportCandidate({
			...baseCandidate(),
			meta: { password: "hunter2-sentinel" },
		});
		expect(nestedKey.ok).toBe(false);
		if (!nestedKey.ok) {
			expect(nestedKey.rejection.code).toBe("secret-positive-candidate");
		}
		expect(JSON.stringify(nestedKey)).not.toContain("hunter2-sentinel");
	});

	test("nesting past the sweep depth bound is inadmissible, never assumed clean", () => {
		let nested: unknown = "clean";
		for (let level = 0; level < 10; level += 1) nested = { level: nested };
		const result = screenImportCandidate({ ...baseCandidate(), meta: nested });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("secret-positive-candidate");
		}
	});

	test("a secret-named unknown key escalates over the key-set violation", () => {
		const result = screenImportCandidate({
			...baseCandidate(),
			password: "hunter2-sentinel",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("secret-positive-candidate");
			expect(JSON.stringify(result)).not.toContain("hunter2-sentinel");
		}
		// No stripped/cleaned candidate exists anywhere on the refusal.
		expect(JSON.stringify(result)).not.toContain("proposed_origins");
	});

	test("a key-set violation never masks a secret-shaped value on a known field", () => {
		// The shape validator short-circuits on the unknown key; the screen's
		// independent sweep must still escalate the secret-shaped prose (SD3).
		const result = screenImportCandidate({
			...baseCandidate({
				legacy_context_prose: "op://Private/GitHub/password",
			}),
			colour: "x",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("secret-positive-candidate");
			expect(JSON.stringify(result)).not.toContain("op://");
		}
		// Same escalation when a required key is missing.
		const { service_id: _dropped, ...missingKey } = baseCandidate({
			legacy_context_prose: "op://Private/GitHub/password",
		});
		const missingResult = screenImportCandidate(missingKey);
		expect(missingResult.ok).toBe(false);
		if (!missingResult.ok) {
			expect(missingResult.rejection.code).toBe("secret-positive-candidate");
		}
	});

	test("a plain unknown key stays a shape violation", () => {
		const result = screenImportCandidate({ ...baseCandidate(), colour: "blue" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.rejection.code).toBe("candidate-shape-invalid");
	});

	test("non-object input refuses with a null candidate id, never a throw", () => {
		const result = screenImportCandidate(42);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("candidate-shape-invalid");
			expect(result.rejection.candidate_id).toBeNull();
		}
	});
});

describe("match policy (single owner; SD1, SD6, R10)", () => {
	test("exactly one live match binds deterministically from live evidence only", () => {
		const item = baseEvidence({
			origins: [PORTAL_ORIGIN, "https://sso.example.com"],
		});
		const result = matchItemBinding(baseMatchInput({ items: [item] }));
		expect(result.kind).toBe("bound");
		if (result.kind === "bound") {
			expect(result.binding).toEqual({
				service_id: "oncore",
				auth_context: "interactive-login",
				allowed_origins: [PORTAL_ORIGIN, "https://sso.example.com"],
				allowed_login_paths: ["/login"],
				vault_id: "vault-1",
				item_id: "item-1",
				allowed_auth_methods: ["password", "otp"],
				binding_revision: 1,
			});
			expect(validateItemBindingShape(result.binding)).toEqual([]);
		}
	});

	test("the hint never breaks a tie (SD1)", () => {
		const result = matchItemBinding(
			baseMatchInput({
				items: [baseEvidence(), baseEvidence({ item_id: "item-2" })],
				hint: { hint_item_id: "item-1", legacy_vault_name: null },
			}),
		);
		expect(result.kind).toBe("ambiguous-selection");
		if (result.kind === "ambiguous-selection") {
			expect(result.blocked_cause).toBe("ambiguous-binding-selection");
			expect(result.continuation).toEqual(
				BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["ambiguous-binding-selection"]
					.continuation,
			);
			expect(result.continuation.next_action_id).toBe(
				"request-binding-selection-grant",
			);
			expect(result.selection[0]).toEqual({
				item_id: "item-1",
				rank: 1,
				hinted: true,
				matched_origin: PORTAL_ORIGIN,
			});
			expect(result.selection).toHaveLength(2);
		}
	});

	test("live evidence overrides a contradicting hint", () => {
		const result = matchItemBinding(
			baseMatchInput({
				items: [baseEvidence({ item_id: "item-live" })],
				hint: { hint_item_id: "item-legacy", legacy_vault_name: null },
			}),
		);
		expect(result.kind).toBe("bound");
		if (result.kind === "bound") {
			expect(result.binding.item_id).toBe("item-live");
		}
	});

	test("zero matches carry the legacy vault repair hint outside the continuation (SD6)", () => {
		const result = matchItemBinding(
			baseMatchInput({
				items: [],
				hint: { hint_item_id: null, legacy_vault_name: "Old Personal" },
			}),
		);
		expect(result.kind).toBe("missing-item");
		if (result.kind === "missing-item") {
			expect(result.blocked_cause).toBe("revoked-binding");
			expect(result.continuation).toEqual(
				BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["revoked-binding"].continuation,
			);
			expect(result.continuation.next_action_id).toBe("repair-item-binding");
			expect(JSON.stringify(result.continuation)).not.toContain("Old Personal");
			expect(result.repair_hint).toEqual({ legacy_vault_name: "Old Personal" });
		}
	});

	test("a mismatching legacy vault name is display-only when the item lives in the token vault (SD6)", () => {
		// The hint's legacy_vault_name contradicts live reality, but the item
		// IS in the token-scoped vault: it binds normally — the mismatch lives
		// in the dead hint, never in eligibility.
		const result = matchItemBinding(
			baseMatchInput({
				items: [baseEvidence()],
				hint: { hint_item_id: null, legacy_vault_name: "Old Personal" },
			}),
		);
		expect(result.kind).toBe("bound");
		if (result.kind === "bound") {
			expect(result.binding.item_id).toBe("item-1");
			expect(result.binding.vault_id).toBe("vault-1");
		}
	});

	test("a path match on the wrong origin never binds (R10)", () => {
		const result = matchItemBinding(
			baseMatchInput({
				login_path: "/login",
				items: [
					baseEvidence({
						origins: ["https://other.example.com"],
						login_paths: ["/login"],
					}),
				],
			}),
		);
		expect(result.kind).toBe("missing-item");
	});

	test("items outside the proven vault or non-active never qualify", () => {
		const result = matchItemBinding(
			baseMatchInput({
				items: [
					baseEvidence({ vault_id: "vault-other" }),
					baseEvidence({ item_id: "item-2", state: "archived" }),
				],
			}),
		);
		expect(result.kind).toBe("missing-item");
	});

	test("ambiguous ranking: hinted, then login-path prefix, then item id", () => {
		const result = matchItemBinding(
			baseMatchInput({
				login_path: "/login",
				items: [
					baseEvidence({ item_id: "item-a", login_paths: ["/other"] }),
					baseEvidence({ item_id: "item-b", login_paths: ["/login"] }),
				],
			}),
		);
		expect(result.kind).toBe("ambiguous-selection");
		if (result.kind === "ambiguous-selection") {
			expect(result.selection.map((s) => s.item_id)).toEqual([
				"item-b",
				"item-a",
			]);
			expect(result.selection.map((s) => s.rank)).toEqual([1, 2]);
			expect(result.selection.every((s) => !s.hinted)).toBe(true);
		}
	});

	test("structurally broken input refuses, never throws", () => {
		const result = matchItemBinding(baseMatchInput({ service_id: "" }));
		expect(result.kind).toBe("refused");
		if (result.kind === "refused") {
			expect(result.rejection.code).toBe("match_input_invalid");
		}
		const nonFixpoint = matchItemBinding(
			baseMatchInput({ target_origins: ["https://portal.example.com/login"] }),
		);
		expect(nonFixpoint.kind).toBe("refused");
	});

	test("calls never mutate inputs; continuations are clones of the table", () => {
		const tableBefore = structuredClone(BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE);
		const input = baseMatchInput({
			items: [baseEvidence(), baseEvidence({ item_id: "item-2" })],
		});
		const inputBefore = structuredClone(input);
		const result = matchItemBinding(input);
		expect(result.kind).toBe("ambiguous-selection");
		if (result.kind === "ambiguous-selection") {
			result.continuation.next_action_id = "mutated";
		}
		expect(input).toEqual(inputBefore);
		expect(BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE).toEqual(tableBefore);
	});
});

describe("candidate import (SD2, SD3, SD4)", () => {
	test("a legacy-only origin becomes a proposal, never a widened binding (SD2)", () => {
		const results = importCandidates({
			candidates: [
				baseCandidate({ proposed_origins: [PORTAL_ORIGIN, LEGACY_ORIGIN] }),
			],
			vault_id: "vault-1",
			items: [baseEvidence()],
		});
		expect(results).toHaveLength(1);
		const result = results[0];
		expect(result?.ok).toBe(true);
		if (result?.ok) {
			expect(result.disposition.kind).toBe("bound");
			if (result.disposition.kind === "bound") {
				expect(result.disposition.binding.allowed_origins).toEqual([
					PORTAL_ORIGIN,
				]);
				expect(result.disposition.origin_proposals).toEqual([
					{
						origin: LEGACY_ORIGIN,
						provenance: "legacy-import",
						requires_grant: true,
					},
				]);
			}
		}
	});

	test("proposed origins are normalized before matching; no proposals when live covers all", () => {
		const results = importCandidates({
			candidates: [
				baseCandidate({
					proposed_origins: ["https://Portal.Example.com:443/login?x=1"],
				}),
			],
			vault_id: "vault-1",
			items: [baseEvidence()],
		});
		const result = results[0];
		expect(result?.ok).toBe(true);
		if (result?.ok) {
			expect(result.disposition.kind).toBe("bound");
			if (result.disposition.kind === "bound") {
				expect(result.disposition.origin_proposals).toEqual([]);
			}
		}
	});

	test("an unparseable proposed origin refuses that candidate as shape-invalid", () => {
		const results = importCandidates({
			candidates: [baseCandidate({ proposed_origins: ["not a url"] })],
			vault_id: "vault-1",
			items: [baseEvidence()],
		});
		const result = results[0];
		expect(result?.ok).toBe(false);
		if (result && !result.ok) {
			expect(result.rejection.code).toBe("candidate-shape-invalid");
		}
	});

	test("a secret-positive candidate never blocks its siblings", () => {
		const results = importCandidates({
			candidates: [
				baseCandidate(),
				baseCandidate({
					candidate_id: "cand-2",
					legacy_context_prose: "op://Private/GitHub/password",
				}),
				baseCandidate({ candidate_id: "cand-3", service_id: "timesheet" }),
			],
			vault_id: "vault-1",
			items: [baseEvidence()],
		});
		expect(results).toHaveLength(3);
		expect(results.map((r) => r.candidate_id)).toEqual([
			"cand-1",
			"cand-2",
			"cand-3",
		]);
		expect(results[0]?.ok).toBe(true);
		expect(results[2]?.ok).toBe(true);
		const rejected = results[1];
		expect(rejected?.ok).toBe(false);
		if (rejected && !rejected.ok) {
			expect(rejected.rejection.code).toBe("secret-positive-candidate");
		}
		expect(JSON.stringify(results)).not.toContain("op://");
	});

	test("an invalid batch vault_id names the batch input, never candidate shape", () => {
		const results = importCandidates({
			candidates: [baseCandidate(), baseCandidate({ candidate_id: "cand-2" })],
			vault_id: "",
			items: [baseEvidence()],
		});
		expect(results).toHaveLength(2);
		expect(results.map((r) => r.candidate_id)).toEqual(["cand-1", "cand-2"]);
		for (const result of results) {
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.rejection.code).toBe("import-input-invalid");
				expect(result.rejection.message).toBe(
					"import input invalid (vault_id); no candidate was evaluated.",
				);
			}
		}
	});

	test("independent bindings share an item without linking (SD4)", () => {
		const item = baseEvidence();
		const results = importCandidates({
			candidates: [
				baseCandidate(),
				baseCandidate({ candidate_id: "cand-2", service_id: "timesheet" }),
			],
			vault_id: "vault-1",
			items: [item],
		});
		const bindings: BrowserUseItemBinding[] = [];
		for (const result of results) {
			expect(result.ok).toBe(true);
			if (result.ok && result.disposition.kind === "bound") {
				bindings.push(result.disposition.binding);
			}
		}
		expect(bindings).toHaveLength(2);
		expect(bindings[0]?.item_id).toBe(bindings[1]?.item_id ?? "");
		expect(bindings[0]?.service_id).not.toBe(bindings[1]?.service_id);

		// Revoking service A's live item never crosses to service B (SD4).
		const bindingA = bindings[0];
		const bindingB = bindings[1];
		if (bindingA === undefined || bindingB === undefined) throw new Error("unreachable");
		const revokedA = assessBindingUsability(bindingA, { item: null });
		expect(revokedA.usable).toBe(false);
		const liveB = assessBindingUsability(bindingB, { item });
		expect(liveB.usable).toBe(true);
	});
});

describe("binding liveness + method admission (R11, R13)", () => {
	test("stale states sweep to revoked-binding with the repair continuation, never a replacement", () => {
		const binding = baseBinding();
		const sweep: {
			live: Parameters<typeof assessBindingUsability>[1];
			expected: (typeof BROWSER_USE_BINDING_STALE_STATES)[number];
		}[] = [
			{ live: { item: baseEvidence({ state: "archived" }) }, expected: "archived" },
			{ live: { item: baseEvidence({ state: "deleted" }) }, expected: "deleted" },
			{ live: { item: baseEvidence({ state: "revoked" }) }, expected: "revoked" },
			{ live: { item: baseEvidence({ state: "expired" }) }, expected: "expired" },
			{
				live: { item: baseEvidence({ state: "out-of-scope" }) },
				expected: "out-of-scope",
			},
			{ live: { item: null }, expected: "deleted" },
			{
				live: { item: baseEvidence({ vault_id: "vault-other" }) },
				expected: "moved",
			},
		];
		for (const { live, expected } of sweep) {
			const result = assessBindingUsability(binding, live);
			expect(result.usable).toBe(false);
			if (!result.usable) {
				expect(result.stale_state).toBe(expected);
				expect(result.blocked_cause).toBe("revoked-binding");
				expect(result.continuation).toEqual(
					BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["revoked-binding"].continuation,
				);
				expect(JSON.stringify(result)).not.toContain('"binding"');
			}
		}
	});

	test("a cache-widened origin set fails the derivation check (KTD11/SD2)", () => {
		// An edited binding carrying an origin the live item never derived is
		// out-of-scope even though the live item is active — import/edits never
		// silently widen the authorized origin set.
		const widened = baseBinding({
			allowed_origins: [PORTAL_ORIGIN, "https://evil.example.com"],
		});
		const result = assessBindingUsability(widened, { item: baseEvidence() });
		expect(result.usable).toBe(false);
		if (!result.usable) {
			expect(result.stale_state).toBe("out-of-scope");
			expect(result.blocked_cause).toBe("revoked-binding");
		}
	});

	test("a live read for a different item never keeps the binding usable (R11)", () => {
		// A different active item sharing the vault and origins is a
		// substitution, not liveness proof for the bound item.
		const result = assessBindingUsability(baseBinding(), {
			item: baseEvidence({ item_id: "item-other" }),
		});
		expect(result.usable).toBe(false);
		if (!result.usable) {
			expect(result.stale_state).toBe("moved");
			expect(result.blocked_cause).toBe("revoked-binding");
		}
	});

	test("an active live item in the bound vault keeps the binding usable", () => {
		const result = assessBindingUsability(baseBinding(), { item: baseEvidence() });
		expect(result.usable).toBe(true);
		if (result.usable) expect(result.binding).toEqual(baseBinding());
	});

	test("user-presence blocks unsupported-method; the passkey lane never reaches a fetch (R13, D5)", () => {
		const result = assessBindingMethod(baseBinding(), "user-presence");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.blocked_cause).toBe("unsupported-method");
			expect(result.continuation.next_action_id).toBe(
				"choose-supported-auth-method",
			);
			expect(result.continuation).toEqual(
				BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["unsupported-method"].continuation,
			);
		}
	});

	test("session-reuse is always admitted, even without a binding", () => {
		expect(assessBindingMethod(null, "session-reuse")).toEqual({ ok: true });
		expect(assessBindingMethod(baseBinding(), "session-reuse")).toEqual({
			ok: true,
		});
	});

	test("password/otp admit only when the binding lists them", () => {
		expect(assessBindingMethod(baseBinding(), "password")).toEqual({ ok: true });
		expect(assessBindingMethod(baseBinding(), "otp")).toEqual({ ok: true });
		const passwordOnly = baseBinding({ allowed_auth_methods: ["password"] });
		const otpResult = assessBindingMethod(passwordOnly, "otp");
		expect(otpResult.ok).toBe(false);
		if (!otpResult.ok) expect(otpResult.blocked_cause).toBe("unsupported-method");
		const noBinding = assessBindingMethod(null, "password");
		expect(noBinding.ok).toBe(false);
	});
});

describe("vocabularies + key sets", () => {
	test("closed vocabularies carry the ADR 0029 members exactly", () => {
		expect(BROWSER_USE_AUTH_CONTEXTS).toEqual(["interactive-login"]);
		expect(BROWSER_USE_BINDING_AUTH_METHODS).toEqual(["password", "otp"]);
		expect(BROWSER_USE_BINDING_STALE_STATES).toEqual([
			"moved",
			"archived",
			"deleted",
			"revoked",
			"expired",
			"out-of-scope",
		]);
		expect(BROWSER_USE_ITEM_BINDING_KEYS).toHaveLength(8);
		expect(BROWSER_USE_IMPORT_CANDIDATE_KEYS).toHaveLength(8);
		expect(BROWSER_USE_VAULT_ITEM_EVIDENCE_KEYS).toHaveLength(6);
	});

	test("legacy contexts and presence methods are unrepresentable (SD5, R13)", () => {
		// @ts-expect-error auth contexts are a closed vocabulary; prose is never auto-mapped (SD5)
		const context: BrowserUseAuthContext = "cli-login";
		const methods: BrowserUseBindingAuthMethod[] = [
			"password",
			// @ts-expect-error user-presence is never a binding auth method (R13)
			"user-presence",
		];
		expect(context as string).toBe("cli-login");
		expect(methods).toHaveLength(2);
	});
});
