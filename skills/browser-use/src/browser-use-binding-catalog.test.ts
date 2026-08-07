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

describe("private Binding Catalog", () => {
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
