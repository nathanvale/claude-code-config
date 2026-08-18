import { afterAll, describe, expect, test } from "bun:test";
import type { BrowserUseTokenRetrievalPort } from "./browser-use-op";
import {
	type BrowserUseBindingApprovalReceipt,
	bindingApprovalReceiptDigestOf,
} from "./browser-use-auth-bindings";
import { createBindingApprovalReceiptVerifier } from "./browser-use-auth-approval";
import { createBindingCatalog } from "./browser-use-binding-catalog";
import type {
	BrowserUseBindingSelectionGrant,
	BrowserUseBindingSelectionGrantVerifier,
} from "./browser-use-binding-selection";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";
import { createDefaultPlatformFs, openBrowserUsePaths } from "./browser-use-paths";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";

const disposals: Array<() => void> = [];
afterAll(async () => {
	for (const dispose of disposals) dispose();
});

function port(): BrowserUseTokenRetrievalPort {
	const unexpected = async () => {
		throw new Error("unexpected token-port call");
	};
	return {
		listVaults: unexpected,
		listLoginItems: unexpected,
		fetchCredentialField: unexpected,
		getLoginItem: async () => ({
			ok: true,
			item: {
				item_id: "item-1",
				vault_id: "vault-1",
				origins: ["https://legacy-sso.example.test"],
				login_paths: ["/login"],
				supported_methods: ["password", "otp"],
				state: "active",
			},
		}),
	};
}

describe("auth binding lifecycle CLI", () => {
	test("shows a selection-grant-backed binding through the redacted catalog projection", async () => {
		const xdg = makeTempXdgEnv();
		disposals.push(xdg.dispose);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error("binding fixture paths unavailable");
		const selectionVerifier: BrowserUseBindingSelectionGrantVerifier = {
			verifyStored: async (grant) => ({
				ok: true,
				grant: grant as BrowserUseBindingSelectionGrant,
			}),
			verifyAndReserve: async ({ grant }) => ({
				ok: true,
				grant: grant as BrowserUseBindingSelectionGrant,
			}),
		};
		const grant: BrowserUseBindingSelectionGrant = {
			grant_id: "selection-binding-show",
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
				vault_id: "vault-private",
				item_id: "item-private",
				allowed_auth_methods: ["password", "otp"],
				binding_revision: 1,
			},
			facts: {
				run_id: "run-selection-show",
				service_id: "github",
				origin: "https://github.com",
				vault_id: "vault-private",
				candidate_set_digest: "a".repeat(64),
			},
			issued_at_epoch_ms: 1_000,
			expires_at_epoch_ms: 91_000,
			verifier_key_id: "verifier-1",
			signature: "signed-selection",
		};
		const catalog = createBindingCatalog({
			fs,
			root: `${opened.paths.resolution.roots.state}/binding-catalog`,
			now: () => grant.issued_at_epoch_ms,
			selectionGrantVerifier: selectionVerifier,
		});
		expect(await catalog.commitSelectionGrant(grant)).toEqual({ ok: true });
		const runtime = makeRuntime({
			env: xdg.env,
			platformFs: fs,
			bindingApprovalReceiptVerifier: createBindingApprovalReceiptVerifier({
				verifier: { key_id: "verifier-1", public_key: "fixture" },
				verifySignature: () => true,
			}),
			bindingSelectionGrantVerifier: selectionVerifier,
		});
		const shown = await runForTest(
			[
				"auth", "binding", "show",
				"--binding", "github",
				"--service", "github",
				"--environment", "agent-chrome",
				"--profile", "default",
				"--json",
			],
			runtime,
		);
		expect(shown.exitCode).toBe(0);
		expect(parseJson(shown.stdout).data).toMatchObject({
			evaluation: { status: "binding-active", binding_ref: "github", revision: 1 },
		});
		expect(shown.stdout).not.toContain("vault-private");
		expect(shown.stdout).not.toContain("item-private");
	});

	test("creates once, lists without vault identity, and revokes before reuse", async () => {
		const xdg = makeTempXdgEnv();
		disposals.push(xdg.dispose);
		const verifier = createBindingApprovalReceiptVerifier({
			verifier: { key_id: "verifier-1", public_key: "fixture" },
			verifySignature: ({ digest, signature }) => signature === `sig:${digest}`,
		});
		let sequence = 0;
		const runtime = makeRuntime({
			env: xdg.env,
			platformFs: createDefaultPlatformFs(),
			authTokenRetrieval: port(),
			bindingApprovalReceiptVerifier: verifier,
			bindingApprovalBroker: {
				async issueBindingApproval(input) {
					sequence += 1;
					const unsigned: Omit<BrowserUseBindingApprovalReceipt, "signature"> = {
						contract: "browser-use.binding-approval",
						schema_version: "1",
						receipt_id: `receipt-${sequence}`,
						disposition: input.disposition,
						resolution_key: input.resolution_key,
						binding: input.binding,
						predecessor_receipt_id: input.predecessor_receipt_id,
						issued_at_epoch_ms: 1_000 + sequence,
						verifier_key_id: "verifier-1",
					};
					return {
						ok: true,
						receipt: {
							...unsigned,
							signature: `sig:${bindingApprovalReceiptDigestOf(unsigned)}`,
						},
					};
				},
			},
		});
		const coordinates = [
			"--binding", "oncore",
			"--service", "oncore",
			"--environment", "agent-chrome",
			"--profile", "oncore-clean",
		] as const;

		const created = await runForTest(
			[
				"auth", "binding", "create",
				...coordinates,
				"--origin", "https://portal.example.test",
				"--vault-id", "vault-1",
				"--item-id", "item-1",
				"--json",
			],
			runtime,
		);
		expect(created.exitCode, `${created.stdout}\n${created.stderr}`).toBe(0);
		expect(parseJson(created.stdout).data).toMatchObject({
			action: "binding create",
			evaluation: { status: "binding-active", binding_ref: "oncore", revision: 1 },
		});

		const listed = await runForTest(["auth", "binding", "list", "--json"], runtime);
		expect(listed.exitCode).toBe(0);
		expect(listed.stdout).not.toContain("vault-1");
		expect(listed.stdout).not.toContain("item-1");

		const revoked = await runForTest(
			["auth", "binding", "revoke", ...coordinates, "--json"],
			runtime,
		);
		expect(revoked.exitCode).toBe(0);
		const shown = await runForTest(
			["auth", "binding", "show", ...coordinates, "--json"],
			runtime,
		);
		expect(parseJson(shown.stdout).data).toMatchObject({
			evaluation: { status: "binding-revoked", binding_ref: "oncore", revision: 2 },
		});
	});
});
