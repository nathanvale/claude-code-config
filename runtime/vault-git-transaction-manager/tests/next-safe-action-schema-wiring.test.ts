import { describe, expect, test } from "bun:test";

import {
	VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION,
} from "../src/activation-contract.ts";
import {
	VAULT_GIT_NEXT_ACTION_IDS,
	VAULT_GIT_SCHEMA_VERSION,
} from "../src/model.ts";
import {
	VAULT_GIT_NEXT_SAFE_ACTION_IDS,
	composeVaultGitLifecycleResult,
	projectVaultGitNextSafeAction,
	rehydrateVaultGitPersistedNextAction,
} from "../src/next-safe-action.ts";

/**
 * Core seam (ADR-0002 U1 point 1, 2, 3, 10): data.next_action is the authoritative
 * Next Safe Action discriminated union in the versioned lifecycle contract; the
 * compat id + summary are derived fields on that union; the lifecycle-result
 * constructor rejects a supplied compat id/summary that diverges from the union;
 * the public lifecycle/discovery schema literal is 2 and the activation-result
 * schema literal is 3. Independent oracle: literals and argv hand-authored here.
 */

const TXN = "txn_11111111111111111111111111111111";

describe("vault-git U1 schema wiring — versioned union in data.next_action", () => {
	// Point 1: public JSON lifecycle/discovery schema literal is 2.
	test("lifecycle/discovery schema version literal is 2", () => {
		expect(VAULT_GIT_SCHEMA_VERSION).toBe("2");
	});

	// Point 1: activation-result public schema literal is 3.
	test("activation-result schema version literal is 3", () => {
		expect(VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION).toBe("3");
	});

	// Point 2: data.next_action IS the union — it carries the discriminant kind and
	// the invoke-shape fields, PLUS top-level id and summary as compat, never nested
	// under a legacy { id, summary } object.
	test("next_action is the union itself with derived top-level id + summary", () => {
		const payload = composeVaultGitLifecycleResult({
			command: "repair",
			outcome: "repaired",
			phase: "repairable",
			write_permission: "owner",
			changed_state: "none",
			retry_safety: "same_input_safe",
			blockers: [],
			transaction_id: TXN,
			// A legacy action ref; the composer projects its authoritative union and
			// derives the compat id/summary. Selectors come from the payload (TXN).
			next_action: {
				id: "reconcile_quarantine",
				summary: "Reconcile the quarantined host transaction.",
			},
		});
		const union = projectVaultGitNextSafeAction({
			action_id: "reconcile_quarantine",
			selectors: { transaction_id: TXN },
		}).continuation;
		// The union owner is authoritative; the payload's next_action equals it,
		// with the compat id + summary present at the top level.
		expect(payload.next_action).toMatchObject({
			kind: "invoke",
			id: "reconcile_quarantine",
			action_id: "reconcile_quarantine",
			summary: "Reconcile the quarantined host transaction.",
			executable: "vault-git",
			argv: [
				"repair",
				"reconcile-quarantine",
				"--transaction-id",
				TXN,
				"--json",
			],
		});
		// The semantic action_id is the union's own action id.
		expect(
			(payload.next_action as { action_id: string }).action_id,
		).toBe(union.kind === "none" ? "none" : union.action_id);
		// Not nested under a legacy object.
		expect(
			(payload.next_action as Record<string, unknown>).next_action,
		).toBeUndefined();
	});

	// Point 3: the composer rejects an already-built union whose authoritative fields
	// diverge from a fresh projection of its own compat id. A caller cannot assert a
	// semantic action_id or argv that contradicts the catalog projection.
	test("composer rejects a divergent already-built union", () => {
		expect(() =>
			composeVaultGitLifecycleResult({
				command: "repair",
				outcome: "repaired",
				phase: "repairable",
				write_permission: "owner",
				changed_state: "none",
				retry_safety: "same_input_safe",
				blockers: [],
				transaction_id: TXN,
				// A hand-built union claiming reconcile_quarantine but carrying a
				// different action's argv — divergence the composer must refuse.
				next_action: {
					kind: "invoke",
					id: "reconcile_quarantine",
					action_id: "reconcile_quarantine",
					summary: "Reconcile the quarantined host transaction.",
					executable: "vault-git",
					argv: ["janitor", "--json"],
				},
			}),
		).toThrow(/diverg|argv|action_id|kind/i);
	});

	// A custom human summary is always allowed on an already-built union; only the
	// authoritative fields are checked for divergence.
	test("composer keeps a custom summary on a matching already-built union", () => {
		const payload = composeVaultGitLifecycleResult({
			command: "repair",
			outcome: "repaired",
			phase: "repairable",
			write_permission: "owner",
			changed_state: "none",
			retry_safety: "same_input_safe",
			blockers: [],
			transaction_id: TXN,
			next_action: {
				kind: "invoke",
				id: "reconcile_quarantine",
				action_id: "reconcile_quarantine",
				summary: "A deliberately custom human summary.",
				executable: "vault-git",
				argv: ["repair", "reconcile-quarantine", "--transaction-id", TXN, "--json"],
			},
		});
		expect(payload.next_action.summary).toBe("A deliberately custom human summary.");
		expect((payload.next_action as { action_id: string }).action_id).toBe(
			"reconcile_quarantine",
		);
	});

	// Point 3 fail-closed: a non-terminal action that cannot project to an executable
	// continuation (missing required selector) surfaces as a visible blocker, never a
	// silent semantic degradation.
	test("fail-closed: an unprojectable non-terminal action blocks with continuation_unavailable", () => {
		const payload = composeVaultGitLifecycleResult({
			command: "repair",
			outcome: "refused",
			phase: "repairable",
			write_permission: "denied",
			changed_state: "none",
			retry_safety: "same_input_safe",
			blockers: [],
			// reconcile_quarantine needs a transaction_id; none supplied → unavailable.
			next_action: { id: "reconcile_quarantine" },
		});
		expect(payload.next_action.kind).toBe("none");
		expect(payload.next_action.id).toBe("reconcile_quarantine");
		expect(payload.blockers).toContain("continuation_unavailable");
		expect(payload.retry_safety).toBe("operator_required");
	});

	// Point 3: a terminal none union carries no invoke fields and no runtime action
	// affordance; the composer derives that from the union, not the id string.
	test("terminal none projects a union with no invoke argv", () => {
		const payload = composeVaultGitLifecycleResult({
			command: "status",
			outcome: "read_only",
			phase: "closed",
			write_permission: "denied",
			changed_state: "none",
			retry_safety: "same_input_safe",
			blockers: [],
			next_action: { id: "none", summary: "No further action; this workflow is finished." },
		});
		expect(payload.next_action.kind).toBe("none");
		expect((payload.next_action as Record<string, unknown>).argv).toBeUndefined();
		// The explicit terminal none is a legitimate stop, not a fail-closed block.
		expect(payload.blockers).not.toContain("continuation_unavailable");
	});

	// Point 10: the Next Safe Action catalog owns a superset of the master
	// lifecycle/engine action-id vocabulary; every emitted master id resolves to a
	// concrete union so the two sets cannot silently drift apart.
	test("every master next-action id is owned by the Next Safe Action catalog projection", () => {
		const catalogIds = new Set(VAULT_GIT_NEXT_SAFE_ACTION_IDS);
		const contextual = new Set([
			"inspect_status",
			"retry_remote",
			"run_repair",
			"change_input",
			"change_owned_paths",
		]);
		for (const id of VAULT_GIT_NEXT_ACTION_IDS) {
			if (contextual.has(id)) continue;
			expect(catalogIds.has(id)).toBe(true);
		}
	});

	// Rehydration fail-closed: a persisted semantic-only catalog id (in the Next Safe
	// Action catalog but NOT a public compatibility id, and not in the semantic->compat
	// mapping) has no compatibility contract, so it must NOT become a runnable
	// continuation. It rehydrates to a FULL terminal none — never a runnable union
	// carrying id "none" — protecting corrupted or future durable ids.
	test("a semantic-only catalog id with no compat contract fails closed to a full terminal none", () => {
		const semanticOnly = "resume_vault_content_promotion";
		// Guard the premise: it is a real semantic catalog id but not a public id.
		expect(VAULT_GIT_NEXT_SAFE_ACTION_IDS).toContain(semanticOnly);
		expect(VAULT_GIT_NEXT_ACTION_IDS).not.toContain(semanticOnly);

		const union = rehydrateVaultGitPersistedNextAction(semanticOnly);
		expect(union.kind).toBe("none");
		expect(union.id).toBe("none");
		expect(union.action_id).toBe("none");
		// No runnable affordance leaked through.
		expect((union as Record<string, unknown>).argv).toBeUndefined();
		expect((union as Record<string, unknown>).executable).toBeUndefined();
	});

	// A mapped semantic id (reprojected from a legacy id) maps back to its legacy
	// compat id, never "none".
	test("a mapped semantic id rehydrates to its legacy compatibility id", () => {
		const union = rehydrateVaultGitPersistedNextAction("inspect_doctor_task", {
			doctor_task_id: `doctor_task_${"1".repeat(32)}`,
		});
		expect(union.action_id).toBe("inspect_doctor_task");
		expect(union.id).toBe("inspect_status");
		expect(union.kind).toBe("invoke");
	});
});
