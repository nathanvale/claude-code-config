import { describe, expect, test } from "bun:test";
import type { BrowserUseTokenRetrievalPort } from "./browser-use-op";
import {
	acquireBrowserUseAuthAccess,
	managedBrowserUseAuthAccessProvider,
} from "./browser-use-auth-access";

const tokenRetrieval = {
	listVaults: async () => ({ ok: true as const, vaults: [] }),
	listLoginItems: async () => ({ ok: true as const, items: [] }),
	getLoginItem: async () => ({
		ok: false as const,
		rejection: { code: "item-missing" as const, message: "missing" },
	}),
	fetchCredentialField: async () => ({
		ok: false as const,
		rejection: { code: "item-missing" as const, message: "missing" },
	}),
} satisfies BrowserUseTokenRetrievalPort;
const request = {
	run_id: "run-fixture",
	service_id: "github",
	environment: "agent-chrome",
	profile: "default",
	allowed_origins: ["https://github.com"],
	ttl_ms: 30_000,
};

describe("Browser Authentication access authority", () => {
	test("prefers one short-lived managed exactly-one-vault lease", async () => {
		let userPresentCalls = 0;
		const result = await acquireBrowserUseAuthAccess({
			now: () => 10_000,
			request,
			managed: managedBrowserUseAuthAccessProvider({
				tokenRetrieval,
				now: () => 10_000,
			}),
			userPresent: async () => {
				userPresentCalls += 1;
				return { ok: false, cause: "authority-unavailable" };
			},
		});
		expect(result).toMatchObject({
			ok: true,
			lease: {
				access_path: "managed-service-token",
				required_vault_scope: "exactly-one-vault",
				expires_at_epoch_ms: 40_000,
			},
		});
		expect(userPresentCalls).toBe(0);
	});

	test("accepts a managed lease issued from a later clock instant", async () => {
		const clock = [10_000, 10_005, 10_006] as const;
		let clockReads = 0;
		const now = () =>
			clock[Math.min(clockReads++, clock.length - 1)] as number;
		const result = await acquireBrowserUseAuthAccess({
			now,
			request,
			managed: managedBrowserUseAuthAccessProvider({ tokenRetrieval, now }),
		});
		expect(result).toMatchObject({
			ok: true,
			lease: {
				access_path: "managed-service-token",
				expires_at_epoch_ms: 40_005,
			},
		});
	});

	test("falls back to one bounded user-present desktop lease", async () => {
		const result = await acquireBrowserUseAuthAccess({
			now: () => 10_000,
			request,
			managed: async () => ({ ok: false, cause: "authority-unavailable" }),
			userPresent: async () => ({
				ok: true,
				lease: {
					access_path: "user-present-desktop",
					required_vault_scope: "exactly-one-vault",
					expires_at_epoch_ms: 40_000,
					token_retrieval: tokenRetrieval,
					release: async () => {},
				},
			}),
		});
		expect(result).toMatchObject({
			ok: true,
			lease: { access_path: "user-present-desktop" },
		});
	});

	test("returns one typed recovery when neither authority path is available", async () => {
		const result = await acquireBrowserUseAuthAccess({
			now: () => 10_000,
			request,
		});
		expect(result).toMatchObject({
			ok: false,
			cause: "auth-access-unavailable",
			continuation: {
				next_action_id: "enroll-browser-automation-token",
			},
		});
	});

	test("rejects malformed or overlong authority as typed recovery", async () => {
		let releases = 0;
		const result = await acquireBrowserUseAuthAccess({
			now: () => 10_000,
			request,
			managed: async () => ({
				ok: true,
				lease: {
					access_path: "managed-service-token",
					required_vault_scope: "exactly-one-vault",
					expires_at_epoch_ms: 40_001,
					token_retrieval: tokenRetrieval,
					release: async () => {
						releases += 1;
					},
				},
			}),
		});
		expect(result).toMatchObject({
			ok: false,
			cause: "auth-access-authority-invalid",
			continuation: {
				next_action_id: "enroll-browser-automation-token",
			},
		});
		expect(releases).toBe(1);
	});

	test("provider faults become typed recovery", async () => {
		const result = await acquireBrowserUseAuthAccess({
			now: () => 10_000,
			request,
			managed: async () => {
				throw new Error("provider failed");
			},
		});
		expect(result).toMatchObject({
			ok: false,
			cause: "auth-access-authority-invalid",
		});
	});
});
