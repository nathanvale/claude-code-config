import { describe, expect, test } from "bun:test";

import {
	createVaultGitActivationRestriction,
	projectVaultGitActivationRestrictionJson,
	renderVaultGitActivationRestriction,
	VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID,
	VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION,
} from "../src/index.ts";

describe("shared activation restriction semantics", () => {
	test("renders human and JSON output from one privacy-classified object", () => {
		const restriction = createVaultGitActivationRestriction({
			stoppedAction: "vault_write",
			cause: "binding_changed",
		});
		const json = projectVaultGitActivationRestrictionJson(restriction);
		const human = renderVaultGitActivationRestriction(restriction);

		expect(restriction).toEqual({
			privacy: "public",
			stoppedAction: "vault_write",
			cause: {
				id: "binding_changed",
				summary: "A prepared activation binding changed before admission.",
			},
			protection: "Vault Git kept canonical write permission denied.",
			observedSafeState: "Nothing changed.",
			writePermission: "denied",
			changedState: "none",
			manualHandoff: {
				availability: "unavailable",
				summary: "Manual handoff is not available from activation trust.",
			},
			nextAction: {
				id: "prepare_fresh",
				summary: "Prepare fresh V2 evidence, then return to human review.",
			},
		});
		expect(json).toEqual({
			contract_id: VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID,
			schema_version: VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION,
			status: "restricted",
			privacy: "public",
			stopped_action: restriction.stoppedAction,
			cause: restriction.cause,
			protection: restriction.protection,
			observed_safe_state: restriction.observedSafeState,
			write_permission: restriction.writePermission,
			changed_state: restriction.changedState,
			manual_handoff: restriction.manualHandoff,
			next_action: restriction.nextAction,
		});
		for (const value of [
			restriction.stoppedAction,
			restriction.cause.id,
			restriction.cause.summary,
			restriction.protection,
			restriction.observedSafeState,
			restriction.writePermission,
			restriction.changedState,
			restriction.manualHandoff.availability,
			restriction.manualHandoff.summary,
			restriction.nextAction.id,
			restriction.nextAction.summary,
		]) {
			expect(human).toContain(value);
		}
	});

	test("maps every closed cause to exactly one safe action", () => {
		for (const [cause, nextAction, missingConfiguration] of [
			[
				"configuration_missing",
				"configure_activation_identity",
				["ssh_identity_file"],
			],
			["admission_missing", "review_prepared"],
			["human_capability_required", "return_to_human_review"],
			["evidence_changed", "prepare_fresh"],
			["binding_changed", "prepare_fresh"],
			["invalidated", "prepare_fresh"],
			["revoked", "prepare_fresh"],
			["revalidation_unavailable", "inspect_configured_vault"],
		] as const) {
			const restriction = createVaultGitActivationRestriction({
				stoppedAction: "activation_admission",
				cause,
				...(missingConfiguration ? { missingConfiguration } : {}),
			});
			expect(restriction.nextAction.id, cause).toBe(nextAction);
			expect(Object.keys(restriction).filter((key) => key === "nextAction")).toHaveLength(1);
		}
	});

	test("projects only stable absent configuration field names", () => {
		const restriction = createVaultGitActivationRestriction({
			stoppedAction: "vault_write",
			cause: "configuration_missing",
			missingConfiguration: ["ssh_identity_file", "ssh_known_hosts"],
		});

		expect(projectVaultGitActivationRestrictionJson(restriction)).toMatchObject({
			schema_version: "2",
			cause: { id: "configuration_missing" },
			missing_configuration: ["ssh_identity_file", "ssh_known_hosts"],
			next_action: { id: "configure_activation_identity" },
		});
		expect(renderVaultGitActivationRestriction(restriction)).toContain(
			"missing_configuration: ssh_identity_file, ssh_known_hosts",
		);
	});

	test("public projections cannot carry private diagnostics or authority", () => {
		const restriction = createVaultGitActivationRestriction({
			stoppedAction: "activation_admission",
			cause: "revalidation_unavailable",
		});
		const projections = JSON.stringify({
			human: renderVaultGitActivationRestriction(restriction),
			json: projectVaultGitActivationRestrictionJson(restriction),
		});

		expect(projections).not.toMatch(
			/\/Users\/|\/private\/|github\.com|identity|credential|capability|command output|diagnostic/i,
		);
		expect(projections).not.toContain("allowed");
		expect(projections).toContain('"write_permission":"denied"');
	});

	test("rejects vocabulary outside the deterministic authority", () => {
		expect(() =>
			createVaultGitActivationRestriction({
				stoppedAction: "model_decision" as "vault_write",
				cause: "looks_ready" as "binding_changed",
			}),
		).toThrow("activation restriction invalid");
	});
});
