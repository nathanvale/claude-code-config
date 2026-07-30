import { describe, expect, test } from "bun:test";
import type {
	BrowserUseAuthProvider,
	BrowserUseDeliveryContextInput,
} from "./browser-use-auth-provider";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import type {
	BrowserUseAuthTransactionFragment,
} from "./browser-use-auth-model";
import {
	applyAuthTransition,
	beginAuthTransaction,
} from "./browser-use-auth-transaction";
import { createBrowserUseConfidentialDeliveryQuarantine } from "./browser-use-confidential-delivery-quarantine";
import {
	type BrowserUseVerifiedTarget,
	createBrowserUseNativeConfidentialDeliveryHook,
} from "./browser-use-confidential-field-delivery";
import type {
	BrowserUseSecretHandle,
	BrowserUseTokenRetrievalPort,
} from "./browser-use-op";
import { deliverPreparedRunbookAuthField } from "./browser-use-runbook-command";

const TARGET: BrowserUseVerifiedTarget = {
	lane_id: "agent-browser",
	run_id: "run-auth-delivery",
	top_level_origin: "https://idp.test",
	frame_origin: "https://idp.test",
	target_id: "target-1",
	page_id: "page-1",
	frame_id: "frame-1",
	account_ref: "account-primary",
	target_proof_digest: "d".repeat(64),
};

const BINDING: BrowserUseItemBinding = {
	service_id: "oncore",
	service_account_id: "service-account-1",
	auth_context: "interactive-login",
	allowed_origins: [TARGET.top_level_origin],
	allowed_login_paths: [],
	vault_id: "vault-1",
	item_id: "item-1",
	item_revision: 7,
	allowed_auth_methods: ["password", "otp"],
	binding_revision: 1,
};

function advance(
	fragment: BrowserUseAuthTransactionFragment,
	event: Parameters<typeof applyAuthTransition>[1],
): BrowserUseAuthTransactionFragment {
	const next = applyAuthTransition(fragment, event);
	if (!next.ok) throw new Error(next.rejection.code);
	return next.fragment;
}

function passwordFragment(): BrowserUseAuthTransactionFragment {
	const begun = beginAuthTransaction({
		binding: {
			run_id: TARGET.run_id,
			handoff_evidence_id: "handoff-1",
			lane_id: "agent-browser",
			environment: "agent-chrome",
			profile: "default",
			service_id: BINDING.service_id,
			auth_context: BINDING.auth_context,
			origin: TARGET.top_level_origin,
			target_id: TARGET.target_id,
			page_id: TARGET.page_id,
			frame_id: TARGET.frame_id,
		},
		method: "password",
		attempt_limit: 3,
		attempts_already_consumed: 0,
	});
	if (!begun.ok) throw new Error(begun.rejection.code);
	let fragment = begun.fragment;
	for (const event of [
		{ type: "pre-auth-proved" as const },
		{ type: "preparation-complete" as const },
		{ type: "lease-granted" as const },
		{
			type: "method-step-complete" as const,
			step: "identify-auth-state" as const,
		},
	]) {
		fragment = advance(fragment, event);
	}
	return fragment;
}

function tokenPort(journal: string[]): BrowserUseTokenRetrievalPort {
	return {
		getServiceAccountIdentity: async () => ({
			ok: true,
			identity: {
				service_account_id: BINDING.service_account_id,
				state: "ACTIVE",
				type: "SERVICE_ACCOUNT",
			},
		}),
		listVaults: async () => ({ ok: true, vaults: [] }),
		listLoginItems: async () => ({ ok: true, items: [] }),
		getLoginItem: async () => ({
			ok: false,
			rejection: { code: "item-missing", message: "absent" },
		}),
		fetchCredentialField: async (input): Promise<{
			ok: true;
			handle: BrowserUseSecretHandle;
		}> => {
			journal.push(`fetch:${input.field}`);
			return {
				ok: true,
				handle: {
					handle_id: `opaque-${input.field}`,
					field: input.field,
					expires_at_epoch_ms: 9_999_999,
				},
			};
		},
	};
}

function provider(
	port: BrowserUseTokenRetrievalPort,
): Pick<BrowserUseAuthProvider, "buildAgentBrowserDeliveryContext"> {
	return {
		buildAgentBrowserDeliveryContext(
			input: BrowserUseDeliveryContextInput,
		) {
			return { ...input, tokenRetrieval: port };
		},
	};
}

function deliveryHarness(
	journal: string[],
	nativeResult:
		| {
				kind: "delivered";
				field: "password" | "otp-current";
		  }
		| { kind: "blocked" }
		| { kind: "unknown" },
) {
	const quarantine = createBrowserUseConfidentialDeliveryQuarantine({
		runCommand: async () => ({
			exitCode: 0,
			stdout: "",
			stderr: "",
		}),
	});
	const nativeInputs: unknown[] = [];
	const hook = createBrowserUseNativeConfidentialDeliveryHook({
		quarantine: {
			pause: async (input) => {
				journal.push("pause");
				return quarantine.quarantine.pause(input);
			},
			cleanup: async (input) => {
				journal.push("cleanup");
				return quarantine.quarantine.cleanup(input);
			},
			resume: async (input) => {
				journal.push("resume");
				return quarantine.quarantine.resume(input);
			},
		},
		consumePrivatePipeAndDeliver: async (input) => {
			journal.push("native");
			nativeInputs.push(input);
			const protocol_trace = [
				"Target.getTargetInfo",
				"Page.getFrameTree",
				"Accessibility.getFullAXTree",
				"DOM.describeNode",
				"DOM.resolveNode",
				"Runtime.callFunctionOn",
			] as const;
			if (nativeResult.kind === "delivered") {
				return {
					schema_version: 1,
					ok: true,
					write_state: "delivered",
					shape: {
						field: nativeResult.field,
						byte_length: 12,
					},
					protocol_trace,
				};
			}
			return {
				schema_version: 1,
				ok: false,
				write_state:
					nativeResult.kind === "unknown"
						? "write-outcome-unknown"
						: "blocked-before-write",
				rejection: {
					code:
						nativeResult.kind === "unknown"
							? "write-outcome-unknown"
							: "field-missing",
					message:
						"confidential field delivery blocked; inspect the typed code.",
				},
				protocol_trace:
					nativeResult.kind === "blocked"
						? protocol_trace.slice(0, -1)
						: protocol_trace,
			};
		},
	});
	return { hook, quarantine, nativeInputs };
}

describe("prepared runbook auth field delivery", () => {
	test("persists exact target re-proof before opaque password delivery", async () => {
		const journal: string[] = [];
		const harness = deliveryHarness(journal, {
			kind: "delivered",
			field: "password",
		});
		const result = await deliverPreparedRunbookAuthField({
			provider: provider(tokenPort(journal)),
			binding: BINDING,
			target: TARGET,
			fragment: passwordFragment(),
			field: "password",
			locator: { role: "textbox", name: "Password" },
			deliver: harness.hook,
			reproveTarget: async ({ target }) => {
				journal.push("reprove");
				return {
					proven: true,
					observed_digest: target.target_proof_digest,
				};
			},
			persistReproof: async (fragment) => {
				journal.push(`persist:${fragment.method_step}`);
				return true;
			},
		});

		expect(result).toMatchObject({
			status: "delivered",
			fragment: { method_step: "fill-password" },
		});
		expect(journal).toEqual([
			"reprove",
			"persist:reprove-target",
			"fetch:password",
			"pause",
			"native",
			"cleanup",
		]);
		expect(harness.nativeInputs).toHaveLength(1);
		expect(harness.nativeInputs[0]).toMatchObject({
			capability: {
				handle_id: "opaque-password",
				field: "password",
			},
			locator: {
				role: "textbox",
				accessible_name: "Password",
				input_kind: "password",
			},
		});
		expect(JSON.stringify(harness.nativeInputs)).not.toContain(
			'"value"',
		);
	});

	test("target drift blocks before handle mint or native delivery", async () => {
		const journal: string[] = [];
		const harness = deliveryHarness(journal, {
			kind: "delivered",
			field: "password",
		});
		const result = await deliverPreparedRunbookAuthField({
			provider: provider(tokenPort(journal)),
			binding: BINDING,
			target: TARGET,
			fragment: passwordFragment(),
			field: "password",
			locator: { role: "textbox", name: "Password" },
			deliver: harness.hook,
			reproveTarget: async () => {
				journal.push("reprove-drift");
				return {
					proven: false,
					cause: "target-proof-invalid",
				};
			},
			persistReproof: async () => {
				journal.push("persist");
				return true;
			},
		});

		expect(result).toEqual({
			status: "blocked",
			cause: "target-proof-invalid",
		});
		expect(journal).toEqual(["reprove-drift"]);
		expect(harness.nativeInputs).toEqual([]);
	});

	test("successful auth delivery can stay held until final proof", async () => {
		const journal: string[] = [];
		const harness = deliveryHarness(journal, {
			kind: "delivered",
			field: "password",
		});
		const result = await deliverPreparedRunbookAuthField({
			provider: provider(tokenPort(journal)),
			binding: BINDING,
			target: TARGET,
			fragment: passwordFragment(),
			field: "password",
			locator: { role: "textbox", name: "Password" },
			deliver: harness.hook,
			reproveTarget: async ({ target }) => ({
				proven: true,
				observed_digest: target.target_proof_digest,
			}),
			persistReproof: async () => true,
		});

		expect(result).toMatchObject({ status: "delivered" });
		expect(journal).toEqual([
			"fetch:password",
			"pause",
			"native",
			"cleanup",
		]);
		expect(harness.quarantine.inspect()).toEqual({
			state: "cleaned",
			write_state: "delivered",
		});
	});

	test("origin drift retains its human-owned blocked cause", async () => {
		const journal: string[] = [];
		const harness = deliveryHarness(journal, {
			kind: "delivered",
			field: "password",
		});
		const result = await deliverPreparedRunbookAuthField({
			provider: provider(tokenPort(journal)),
			binding: BINDING,
			target: TARGET,
			fragment: passwordFragment(),
			field: "password",
			locator: { role: "textbox", name: "Password" },
			deliver: harness.hook,
			reproveTarget: async () => ({
				proven: false,
				cause: "origin-mismatch",
			}),
			persistReproof: async () => true,
		});

		expect(result).toEqual({
			status: "blocked",
			cause: "origin-mismatch",
		});
		expect(journal).toEqual([]);
		expect(harness.nativeInputs).toEqual([]);
	});

	test("blocked-before-write reopens quarantine; unknown write keeps it closed", async () => {
		for (const kind of ["blocked", "unknown"] as const) {
			const journal: string[] = [];
			const harness = deliveryHarness(journal, { kind });
			const result = await deliverPreparedRunbookAuthField({
				provider: provider(tokenPort(journal)),
				binding: BINDING,
				target: TARGET,
				fragment: passwordFragment(),
				field: "password",
				locator: { role: "textbox", name: "Password" },
				deliver: harness.hook,
				reproveTarget: async ({ target }) => ({
					proven: true,
					observed_digest:
						target.target_proof_digest,
				}),
				persistReproof: async () => true,
			});

			if (kind === "unknown") {
				expect(result).toEqual({ status: "unknown" });
			} else {
				expect(result).toEqual({
					status: "blocked",
					cause: "capability-loss",
				});
			}
			expect(harness.quarantine.inspect().state).toBe(
				kind === "unknown" ? "quarantined" : "open",
			);
			expect(journal.includes("native")).toBe(true);
			expect(journal.includes("resume")).toBe(
				kind === "blocked",
			);
		}
	});

	test("refuses OTP delivery before an OTP transaction state is proven", async () => {
		const journal: string[] = [];
		const harness = deliveryHarness(journal, {
			kind: "delivered",
			field: "otp-current",
		});
		const result = await deliverPreparedRunbookAuthField({
			provider: provider(tokenPort(journal)),
			binding: BINDING,
			target: TARGET,
			fragment: passwordFragment(),
			field: "otp",
			locator: { role: "textbox", name: "Verification code" },
			deliver: harness.hook,
			reproveTarget: async ({ target }) => ({
				proven: true,
				observed_digest: target.target_proof_digest,
			}),
			persistReproof: async () => true,
		});

		expect(result).toEqual({
			status: "blocked",
			cause: "capability-loss",
		});
		expect(journal).toEqual([]);
		expect(harness.nativeInputs).toEqual([]);
	});
});
