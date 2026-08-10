import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	type BrowserUseBindingApprovalReceipt,
	bindingApprovalReceiptDigestOf,
} from "./browser-use-auth-bindings";
import { createBindingApprovalReceiptVerifier } from "./browser-use-auth-approval";
import { createBindingCatalog } from "./browser-use-binding-catalog";
import type { BrowserUseBindingSelectionGrant } from "./browser-use-binding-selection";
import { createDefaultPlatformFs } from "./browser-use-paths";

const roots: string[] = [];
afterAll(async () => {
	await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

function receipt(
	revision: number,
	disposition: "approved" | "revoked",
	predecessor_receipt_id: string | null,
): BrowserUseBindingApprovalReceipt {
	const unsigned: Omit<BrowserUseBindingApprovalReceipt, "signature"> = {
		contract: "browser-use.binding-approval",
		schema_version: "1",
		receipt_id: `receipt-${revision}`,
		disposition,
		resolution_key: {
			binding_ref: "oncore",
			service_id: "oncore",
			auth_context: "interactive-login",
			environment: "agent-chrome",
			profile: "oncore-clean",
		},
		binding: {
			service_id: "oncore",
			auth_context: "interactive-login",
			allowed_origins: ["https://portal.example.com"],
			allowed_login_paths: ["/login"],
			vault_id: "vault-1",
			item_id: "item-1",
			allowed_auth_methods: ["password", "otp"],
			binding_revision: revision,
		},
		predecessor_receipt_id,
		issued_at_epoch_ms: 1_000 + revision,
		verifier_key_id: "verifier-1",
	};
	return {
		...unsigned,
		signature: `sig:${bindingApprovalReceiptDigestOf(unsigned)}`,
	};
}

function selectionGrant(): BrowserUseBindingSelectionGrant {
	return {
		grant_id: "selection-grant-1",
		resolution_key: {
			binding_ref: "github",
			service_id: "github",
			auth_context: "interactive-login",
			environment: "agent-chrome",
			profile: "default",
		},
		binding: {
			service_id: "github",
			auth_context: "interactive-login",
			allowed_origins: ["https://github.com"],
			allowed_login_paths: [],
			vault_id: "vault-1",
			item_id: "item-6",
			allowed_auth_methods: ["password", "otp"],
			binding_revision: 1,
		},
		facts: {
			run_id: "run-selection",
			service_id: "github",
			origin: "https://github.com",
			vault_id: "vault-1",
			candidate_set_digest: "0123456789abcdef".repeat(4),
		},
		issued_at_epoch_ms: 1_000,
		expires_at_epoch_ms: 91_000,
		verifier_key_id: "verifier-1",
		signature: "signed-selection",
	};
}

describe("private Binding Catalog", () => {
	test("commits one first-binding selection and rejects a replay write", async () => {
		const base = await mkdtemp(join(tmpdir(), "browser-use-binding-catalog-"));
		roots.push(base);
		const grant = selectionGrant();
		const catalog = createBindingCatalog({
			fs: createDefaultPlatformFs(),
			root: join(base, "bindings"),
			selectionGrantVerifier: {
				verifyStored: async (value) =>
					typeof value === "object" &&
					value !== null &&
					"grant_id" in value &&
					value.grant_id === grant.grant_id
						? { ok: true, grant }
						: { ok: false, code: "grant_signature_invalid" },
				verifyAndReserve: async () => ({
					ok: false,
					code: "not_used_by_catalog",
				}),
			},
		});

		expect(await catalog.commitSelectionGrant(grant)).toEqual({ ok: true });
		expect(await catalog.commitSelectionGrant(grant)).toMatchObject({
			ok: false,
			code: "binding_revision_conflict",
		});
		expect(await catalog.resolve(grant.resolution_key)).toMatchObject({
			ok: true,
			status: "active",
			binding: { item_id: "item-6", binding_revision: 1 },
		});
		expect(await catalog.list()).toMatchObject({
			ok: true,
			bindings: [{ binding_ref: "github", revision: 1, status: "active" }],
		});
	});

	test("resolves an approved revision and stops after signed revocation", async () => {
		const base = await mkdtemp(join(tmpdir(), "browser-use-binding-catalog-"));
		roots.push(base);
		const catalog = createBindingCatalog({
			fs: createDefaultPlatformFs(),
			root: join(base, "bindings"),
			verifier: createBindingApprovalReceiptVerifier({
				verifier: { key_id: "verifier-1", public_key: "fixture" },
				verifySignature: ({ digest, signature }) => signature === `sig:${digest}`,
			}),
		});

		expect(await catalog.commit(receipt(1, "approved", null))).toEqual({ ok: true });
		expect(
			await catalog.resolve({
				binding_ref: "oncore",
				service_id: "oncore",
				auth_context: "interactive-login",
				environment: "agent-chrome",
				profile: "oncore-clean",
			}),
		).toMatchObject({ ok: true, status: "active", binding: { item_id: "item-1" } });
		expect(await catalog.list()).toEqual({
			ok: true,
			bindings: [
				{
					binding_ref: "oncore",
					service_id: "oncore",
					auth_context: "interactive-login",
					environment: "agent-chrome",
					profile: "oncore-clean",
					revision: 1,
					status: "active",
				},
			],
		});

		expect(
			await catalog.commit(receipt(2, "revoked", "receipt-1")),
		).toEqual({ ok: true });
		expect(
			await catalog.resolve({
				binding_ref: "oncore",
				service_id: "oncore",
				auth_context: "interactive-login",
				environment: "agent-chrome",
				profile: "oncore-clean",
			}),
		).toMatchObject({ ok: true, status: "revoked" });
	});
});
