import type { VaultGitReceiptStore } from "../src/store.ts";

/**
 * Admit R34 runtime activation for one test fixture.
 *
 * Write-capable engine commands refuse with blocker `activation_blocked`
 * until an operator admission exists; fixtures that exercise writes call this
 * once during setup. Un-admitted refusal behavior keeps its own dedicated
 * tests that deliberately skip this helper.
 */
export async function admitActivationForTest(
	store: VaultGitReceiptStore,
): Promise<void> {
	await store.admitActivation({
		schemaVersion: 1,
		admittedAt: "2026-08-09T00:00:00.000Z",
		note: "test fixture admission",
	});
}
