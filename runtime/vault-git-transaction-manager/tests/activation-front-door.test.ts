import { afterEach, describe, expect, test } from "bun:test";

import { createVaultGitActivationAuthority } from "../src/activation-authority.ts";
import {
	createVaultGitActivationFrontDoor,
	type VaultGitActivationAuthorityFactory,
} from "../src/activation-front-door.ts";
import type { VaultGitActivationPreparer } from "../src/activation-preparation.ts";
import { createReceiptStore } from "../src/store.ts";
import {
	liveActivationBindingsForTest,
	preparedEvidenceForTest,
} from "./activation-fixture.ts";
import { createTempDirectoryFixture } from "./temp-directory-fixture.ts";

const tempDirectories = createTempDirectoryFixture();

afterEach(tempDirectories.cleanup);

describe("Vault Git activation front door", () => {
	test("prepares and inspects sanitized evidence without granting authority", async () => {
		const stateRoot = await tempDirectories.create("vault-git-activation-front-door-");
		const store = createReceiptStore({
			stateRoot,
			repositoryIdentity: "fixture-vault",
		});
		const evidence = preparedEvidenceForTest({
			capturedAt: "2026-08-12T00:00:00.000Z",
		});
		const preparer: VaultGitActivationPreparer = {
			async prepare() {
				await store.publishPreparedEvidence(evidence);
				return {
					status: "prepared",
					evidence,
					result: {
						contract_id: "vault-git.activation-result",
						schema_version: "2",
						status: "prepared",
						authority: "evidence_only",
						write_permission: "denied",
						changed_state: "none",
						evidence_reference: evidence.evidenceId,
						captured_at: evidence.capturedAt,
						display_fresh_until: "2026-08-12T00:10:00.000Z",
						next_action: {
							id: "review_prepared",
							summary: "Review the prepared evidence without granting write permission.",
						},
					},
				};
			},
			async revalidate() {
				return liveActivationBindingsForTest(evidence);
			},
		};
		const frontDoor = createVaultGitActivationFrontDoor({
			store,
			preparer,
			clock: () => "2026-08-12T00:01:00.000Z",
			createAuthority: authorityFactory(store, preparer),
		});

		const prepared = await frontDoor.prepare();
		const inspected = await frontDoor.inspect();

		expect(prepared).toMatchObject({
			status: "prepared",
			authority: "evidence_only",
			write_permission: "denied",
			changed_state: "none",
			evidence_reference: evidence.evidenceId,
			next_action: { id: "review_prepared" },
		});
		expect(inspected).toEqual(prepared);
		expect(await store.readActivation()).toBeNull();
		expect(JSON.stringify(prepared)).not.toMatch(
			/\/Users\/|sshIdentity|repositoryIdentity|capability/i,
		);
	});

	test("admits only the exact fresh evidence through the internal human review capability", async () => {
		const { store, evidence, frontDoor } = await createReviewFixture(
			"vault-git-activation-review-",
		);

		const result = await frontDoor.review({
			evidenceReference: evidence.evidenceId,
			decision: "activate",
		});

		expect(result).toMatchObject({
			contract_id: "vault-git.activation-result",
			schema_version: "2",
			status: "activated",
			authority: "human_admission",
			write_permission: "denied",
			changed_state: "local",
			evidence_reference: evidence.evidenceId,
			next_action: { id: "begin_transaction" },
		});
		expect(await store.readActivation()).toMatchObject({
			schemaVersion: 2,
			evidenceId: evidence.evidenceId,
			note: "human activation review",
		});
		expect(await frontDoor.validate()).toEqual({
			status: "admitted",
			evidenceId: evidence.evidenceId,
		});
		expect(await frontDoor.inspect()).toMatchObject({
			status: "activated",
			changed_state: "none",
			evidence_reference: evidence.evidenceId,
		});
		expect(JSON.stringify(result)).not.toMatch(/capability|repositoryIdentity/i);
	});

	test("rejects a stale evidence reference without creating admission state", async () => {
		const { store, frontDoor } = await createReviewFixture(
			"vault-git-activation-stale-",
		);

		const result = await frontDoor.review({
			evidenceReference: "evidence:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
			decision: "activate",
		});

		expect(result).toMatchObject({
			status: "restricted",
			cause: { id: "evidence_changed" },
			write_permission: "denied",
			changed_state: "none",
		});
		expect(await store.readActivation()).toBeNull();
	});

	test("fails inspection closed when private activation state cannot be read", async () => {
		const { frontDoor } = await createReviewFixture(
			"vault-git-activation-corrupt-",
			(store) => ({
				...store,
				async readActivation() {
					throw new Error("corrupt private activation state");
				},
			}),
		);

		const result = await frontDoor.inspect();

		expect(result).toMatchObject({
			status: "restricted",
			cause: { id: "revalidation_unavailable" },
			write_permission: "denied",
			changed_state: "none",
		});
	});

	test("keeps defer non-mutating and revocation human-owned", async () => {
		const { store, evidence, frontDoor } = await createReviewFixture(
			"vault-git-activation-decisions-",
		);

		const deferred = await frontDoor.review({
			evidenceReference: evidence.evidenceId,
			decision: "defer",
		});
		expect(deferred).toMatchObject({
			status: "deferred",
			authority: "evidence_only",
			write_permission: "denied",
			changed_state: "none",
			next_action: { id: "review_prepared" },
		});
		expect(await store.readActivation()).toBeNull();

		await frontDoor.review({
			evidenceReference: evidence.evidenceId,
			decision: "activate",
		});
		const revoked = await frontDoor.revoke({
			evidenceReference: evidence.evidenceId,
		});
		expect(revoked).toMatchObject({
			status: "revoked",
			authority: "none",
			write_permission: "denied",
			changed_state: "local",
			next_action: { id: "prepare_fresh" },
		});
		expect(await frontDoor.validate()).toEqual({
			status: "denied",
			reason: "revoked",
		});
		expect(await frontDoor.inspect()).toMatchObject({
			status: "restricted",
			cause: { id: "revoked" },
			write_permission: "denied",
		});
	});
});

async function createReviewFixture(
	prefix: string,
	selectStore: (
		store: ReturnType<typeof createReceiptStore>,
	) => ReturnType<typeof createReceiptStore> = (store) => store,
) {
	const stateRoot = await tempDirectories.create(prefix);
	const store = createReceiptStore({
		stateRoot,
		repositoryIdentity: "fixture-vault",
	});
	const evidence = preparedEvidenceForTest({
		capturedAt: "2026-08-12T00:00:00.000Z",
	});
	await store.publishPreparedEvidence(evidence);
	const preparer: VaultGitActivationPreparer = {
		async prepare() {
			throw new Error("prepare not expected");
		},
		async revalidate() {
			return liveActivationBindingsForTest(evidence);
		},
	};
	return {
		store,
		evidence,
		frontDoor: createVaultGitActivationFrontDoor({
			store: selectStore(store),
			preparer,
			clock: () => "2026-08-12T00:01:00.000Z",
			createAuthority: authorityFactory(store, preparer),
		}),
	};
}

function authorityFactory(
	store: ReturnType<typeof createReceiptStore>,
	preparer: VaultGitActivationPreparer,
): VaultGitActivationAuthorityFactory {
	return (validateHumanCapability) =>
		createVaultGitActivationAuthority({
			store,
			clock: () => "2026-08-12T00:01:00.000Z",
			validateHumanCapability,
			revalidate: preparer.revalidate,
		});
}
