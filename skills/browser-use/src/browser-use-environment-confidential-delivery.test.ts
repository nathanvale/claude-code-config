import { describe, expect, test } from "bun:test";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import type { BrowserUseVerifiedTarget } from "./browser-use-confidential-field-delivery";
import { createEnvironmentConfidentialAuthPorts } from "./browser-use-runtime";

const BINDING: BrowserUseItemBinding = {
	service_id: "oncore",
	service_account_id: "service-account-1",
	auth_context: "interactive-login",
	allowed_origins: ["https://oncore.test"],
	allowed_login_paths: ["/login"],
	vault_id: "vault-1",
	item_id: "item-1",
	item_revision: 7,
	allowed_auth_methods: ["password"],
	binding_revision: 1,
};

const TARGET: BrowserUseVerifiedTarget = {
	lane_id: "agent-browser",
	run_id: "run-u7-production",
	top_level_origin: "https://oncore.test",
	frame_origin: "https://oncore.test",
	target_id: "target-1",
	page_id: "page-1",
	frame_id: "frame-1",
	account_ref: "account-redacted",
	target_proof_digest: "d".repeat(64),
};

function capabilityTarget(target: BrowserUseVerifiedTarget) {
	return {
		lane_id: target.lane_id,
		run_id: target.run_id,
		target_id: target.target_id,
		page_id: target.page_id,
		frame_id: target.frame_id,
		top_level_origin: target.top_level_origin,
		frame_origin: target.frame_origin,
		target_proof_digest: target.target_proof_digest,
	};
}

describe("environment confidential delivery production port", () => {
	test("one target-bound opaque capability reaches the native private process once", async () => {
		let now = 1_000;
		const nativeInputs: unknown[] = [];
		const ports = createEnvironmentConfidentialAuthPorts({
			env: {},
			now: () => now,
			executePrivateDelivery: async (input) => {
				nativeInputs.push(input);
				return {
					schema_version: 1,
					ok: true,
					write_state: "delivered",
					shape: { field: "password", byte_length: 19 },
					protocol_trace: [
						"Target.getTargetInfo",
						"Page.getFrameTree",
						"Accessibility.getFullAXTree",
						"DOM.describeNode",
						"DOM.resolveNode",
						"Runtime.callFunctionOn",
					],
				};
			},
		});
		const fetched = await ports.tokenRetrieval.fetchCredentialField({
			binding: BINDING,
			field: "password",
			target: capabilityTarget(TARGET),
		});
		expect(fetched.ok).toBe(true);
		if (!fetched.ok) return;
		const native = ports.confidentialDelivery.forBrowser({
			browser_ws_endpoint:
				"ws://127.0.0.1:9243/devtools/browser/browser-id",
			browser_pid: 4242,
		});
		const request = {
			schema_version: 1 as const,
			capability: fetched.handle,
			target: capabilityTarget(TARGET),
			locator: {
				role: "textbox" as const,
				accessible_name: "Password",
				input_kind: "password" as const,
			},
		};

		expect(await native.consumePrivatePipeAndDeliver(request)).toMatchObject({
			ok: true,
			write_state: "delivered",
		});
		expect(nativeInputs).toEqual([
			{
				browser_ws_endpoint:
					"ws://127.0.0.1:9243/devtools/browser/browser-id",
				browser_pid: 4242,
				binding: BINDING,
				field: "password",
				target: capabilityTarget(TARGET),
				locator: {
					role: "textbox",
					accessible_name: "Password",
					input_kind: "password",
				},
			},
		]);
		expect(JSON.stringify(nativeInputs)).not.toContain("credential");

		now += 1;
		expect(await native.consumePrivatePipeAndDeliver(request)).toMatchObject({
			ok: false,
			write_state: "blocked-before-write",
			rejection: { code: "invalid-request" },
		});
		expect(nativeInputs).toHaveLength(1);
	});

	test("target drift or expiry consumes the handle and never starts native delivery", async () => {
		let now = 5_000;
		const nativeInputs: unknown[] = [];
		const ports = createEnvironmentConfidentialAuthPorts({
			env: {},
			now: () => now,
			executePrivateDelivery: async (input) => {
				nativeInputs.push(input);
				return { ok: true };
			},
		});
		const fetched = await ports.tokenRetrieval.fetchCredentialField({
			binding: BINDING,
			field: "password",
			target: capabilityTarget(TARGET),
		});
		expect(fetched.ok).toBe(true);
		if (!fetched.ok) return;
		const native = ports.confidentialDelivery.forBrowser({
			browser_ws_endpoint:
				"ws://127.0.0.1:9243/devtools/browser/browser-id",
			browser_pid: 4242,
		});
		const request = {
			schema_version: 1 as const,
			capability: fetched.handle,
			target: {
				...capabilityTarget(TARGET),
				target_id: "target-drift",
			},
			locator: {
				role: "textbox" as const,
				accessible_name: "Password",
				input_kind: "password" as const,
			},
		};
		expect(await native.consumePrivatePipeAndDeliver(request)).toMatchObject({
			ok: false,
			write_state: "blocked-before-write",
		});
		expect(
			await native.consumePrivatePipeAndDeliver({
				...request,
				target: capabilityTarget(TARGET),
			}),
		).toMatchObject({ ok: false, write_state: "blocked-before-write" });

		const expired = await ports.tokenRetrieval.fetchCredentialField({
			binding: BINDING,
			field: "password",
			target: capabilityTarget(TARGET),
		});
		expect(expired.ok).toBe(true);
		if (!expired.ok) return;
		now = expired.handle.expires_at_epoch_ms;
		expect(
			await native.consumePrivatePipeAndDeliver({
				...request,
				capability: expired.handle,
				target: capabilityTarget(TARGET),
			}),
		).toMatchObject({ ok: false, write_state: "blocked-before-write" });
		expect(nativeInputs).toHaveLength(0);
	});

	test("localhost aliases and invalid browser PIDs block before native delivery", async () => {
		const nativeInputs: unknown[] = [];
		const ports = createEnvironmentConfidentialAuthPorts({
			env: {},
			now: () => 7_000,
			executePrivateDelivery: async (input) => {
				nativeInputs.push(input);
				return { ok: true };
			},
		});
		for (const browser of [
			{
				browser_ws_endpoint:
					"ws://localhost:9243/devtools/browser/browser-id",
				browser_pid: 4242,
			},
			{
				browser_ws_endpoint:
					"ws://127.0.0.1:9243/devtools/browser/browser-id",
				browser_pid: 0,
			},
		]) {
			const fetched = await ports.tokenRetrieval.fetchCredentialField({
				binding: BINDING,
				field: "password",
				target: capabilityTarget(TARGET),
			});
			expect(fetched.ok).toBe(true);
			if (!fetched.ok) continue;
			const result = await ports.confidentialDelivery
				.forBrowser(browser)
				.consumePrivatePipeAndDeliver({
					schema_version: 1,
					capability: fetched.handle,
					target: capabilityTarget(TARGET),
					locator: {
						role: "textbox",
						accessible_name: "Password",
						input_kind: "password",
					},
				});
			expect(result).toMatchObject({
				ok: false,
				write_state: "blocked-before-write",
			});
		}
		expect(nativeInputs).toHaveLength(0);
	});

	test("a post-consumption native process failure is write-outcome-unknown", async () => {
		const ports = createEnvironmentConfidentialAuthPorts({
			env: {},
			now: () => 9_000,
			executePrivateDelivery: async () => {
				throw new Error("simulated post-spawn interruption");
			},
		});
		const fetched = await ports.tokenRetrieval.fetchCredentialField({
			binding: BINDING,
			field: "password",
			target: capabilityTarget(TARGET),
		});
		expect(fetched.ok).toBe(true);
		if (!fetched.ok) return;
		const native = ports.confidentialDelivery.forBrowser({
			browser_ws_endpoint:
				"ws://127.0.0.1:9243/devtools/browser/browser-id",
			browser_pid: 4242,
		});
		const request = {
			schema_version: 1 as const,
			capability: fetched.handle,
			target: capabilityTarget(TARGET),
			locator: {
				role: "textbox" as const,
				accessible_name: "Password",
				input_kind: "password" as const,
			},
		};
		expect(await native.consumePrivatePipeAndDeliver(request)).toMatchObject({
			ok: false,
			write_state: "write-outcome-unknown",
			rejection: { code: "write-outcome-unknown" },
		});
		expect(await native.consumePrivatePipeAndDeliver(request)).toMatchObject({
			ok: false,
			write_state: "blocked-before-write",
		});
	});
});
