import { describe, expect, test } from "bun:test";
import type { BrowserUseResolvedAuthCandidate } from "./browser-use-auth-bindings";
import type {
	BrowserUseAuthProvider,
	BrowserUsePreparationBlockDetail,
	BrowserUsePreparationBlockedCause,
} from "./browser-use-auth-provider";
import { prepareRunbookGenerationAuthBinding } from "./browser-use-runbook-command";

const RESOLUTION: BrowserUseResolvedAuthCandidate = {
	generation_id: "generation-a",
	activation_epoch: 4,
	auth_context_ref: "oncore-session",
	route_digest: "a".repeat(64),
	candidate_digest: "b".repeat(64),
	candidate: {
		candidate_id: "candidate-oncore",
		service_id: "oncore",
		auth_context: "interactive-login",
		legacy_context_prose: null,
		hint_item_id: null,
		proposed_origins: ["https://portal.example.com"],
		legacy_vault_name: null,
		provenance: "legacy-auth-pointer",
	},
};

describe("runbook generation auth binding", () => {
	test("prepares the captured candidate before runbook execution", async () => {
		const calls: unknown[] = [];
		const provider: Pick<BrowserUseAuthProvider, "prepareGenerationBinding"> = {
			async prepareGenerationBinding(input) {
				calls.push(input);
				return {
					ok: true,
					event: { type: "preparation-complete" },
					binding: {
						service_id: "oncore",
						service_account_id: "service-account-1",
						auth_context: "interactive-login",
						allowed_origins: ["https://portal.example.com"],
						allowed_login_paths: [],
						vault_id: "vault-1",
						item_id: "item-1",
						item_revision: 7,
						allowed_auth_methods: ["password"],
						binding_revision: 1,
					},
				};
			},
		};

		expect(
			await prepareRunbookGenerationAuthBinding(
				provider,
				RESOLUTION,
				["https://portal.example.com"],
			),
		).toEqual({ ok: true });
		expect(calls).toEqual([
			{
				resolution: RESOLUTION,
				target_origins: ["https://portal.example.com"],
				login_path: null,
				method: "password",
			},
		]);
	});

	test("maps a blocked live proof to one typed repair action", async () => {
		const provider: Pick<BrowserUseAuthProvider, "prepareGenerationBinding"> = {
			async prepareGenerationBinding() {
				return {
					ok: false,
					event: { type: "blocked", cause: "invalid-vault-scope" },
					continuation: {
						next_action_id: "repair-vault-grant",
						summary: "Repair the token's vault grant to exactly one visible vault.",
					},
					detail: { kind: "vault-scope", visible_count: 2 },
				};
			},
		};

		const result = await prepareRunbookGenerationAuthBinding(
			provider,
			RESOLUTION,
			["https://portal.example.com"],
		);
		expect(result).toEqual({
			ok: false,
			failure: {
				code: "runbook_auth_invalid_vault_scope",
				message: "Repair the token's vault grant to exactly one visible vault.",
				actionId: "repair-vault-grant",
				exitCode: 20,
				recoverability: "repair_state",
				authBlockedCause: "invalid-vault-scope",
			},
		});
	});

	test("preserves the selection-grant continuation for an ambiguous binding", async () => {
		const provider: Pick<BrowserUseAuthProvider, "prepareGenerationBinding"> = {
			async prepareGenerationBinding() {
				return {
					ok: false,
					event: { type: "blocked", cause: "ambiguous-binding-selection" },
					continuation: {
						next_action_id: "request-binding-selection-grant",
						summary: "Request a signed one-use grant to select one login item.",
					},
					detail: { kind: "selection", selection: [] },
				};
			},
		};

		const result = await prepareRunbookGenerationAuthBinding(
			provider,
			RESOLUTION,
			["https://portal.example.com"],
		);
		expect(result).toEqual({
			ok: false,
			failure: {
				code: "runbook_auth_ambiguous_binding_selection",
				message: "Request a signed one-use grant to select one login item.",
				actionId: "request-binding-selection-grant",
				exitCode: 20,
				recoverability: "repair_state",
				authBlockedCause: "ambiguous-binding-selection",
			},
		});
	});

	const continuationRows = [
		{
			cause: "missing-token",
			nextAction: "enroll-browser-automation-token",
			summary: "Enroll a browser automation token.",
			detail: {
				kind: "token",
				rejection: {
					code: "token-invalid",
					message: "the environment token is missing.",
				},
			},
		},
		{
			cause: "invalid-vault-scope",
			nextAction: "repair-vault-grant",
			summary: "Repair the token's vault grant.",
			detail: { kind: "vault-scope", visible_count: 2 },
		},
		{
			cause: "ambiguous-binding-selection",
			nextAction: "request-binding-selection-grant",
			summary: "Request a signed selection grant.",
			detail: { kind: "selection", selection: [] },
		},
		{
			cause: "revoked-binding",
			nextAction: "repair-item-binding",
			summary: "Repair the item binding.",
			detail: {
				kind: "binding-repair",
				repair_hint: { legacy_vault_name: null },
				stale_state: "revision-changed",
			},
		},
		{
			cause: "unsupported-method",
			nextAction: "choose-supported-auth-method",
			summary: "Choose another supported method.",
			detail: { kind: "method" },
		},
		{
			cause: "capability-loss",
			nextAction: "inspect-capability-loss",
			summary: "Inspect the lost lane capability.",
			detail: { kind: "capability", message: "capability unavailable" },
		},
	] as const satisfies readonly {
		cause: BrowserUsePreparationBlockedCause;
		nextAction:
			| "enroll-browser-automation-token"
			| "repair-vault-grant"
			| "request-binding-selection-grant"
			| "repair-item-binding"
			| "choose-supported-auth-method"
			| "inspect-capability-loss";
		summary: string;
		detail: BrowserUsePreparationBlockDetail;
	}[];

	for (const row of continuationRows) {
		test(`preserves the ${row.cause} contract continuation`, async () => {
			const provider: Pick<
				BrowserUseAuthProvider,
				"prepareGenerationBinding"
			> = {
				async prepareGenerationBinding() {
					return {
						ok: false,
						event: { type: "blocked", cause: row.cause },
						continuation: {
							next_action_id: row.nextAction,
							summary: row.summary,
						},
						detail: row.detail,
					};
				},
			};

			const result = await prepareRunbookGenerationAuthBinding(
				provider,
				RESOLUTION,
				["https://portal.example.com"],
			);
			expect(result).toEqual({
				ok: false,
				failure: {
					code: `runbook_auth_${row.cause.replaceAll("-", "_")}`,
					message: row.summary,
					actionId: row.nextAction,
					exitCode: 20,
					recoverability: "repair_state",
					authBlockedCause: row.cause,
				},
			});
		});
	}
});
