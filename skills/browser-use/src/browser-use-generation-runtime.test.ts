import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createBrowserUseGenerationRuntime } from "./browser-use-generation-runtime";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";
import { stageGeneration } from "./browser-use-retention";
import type { BrowserUseCorpusGenerationManifestPayload } from "./browser-use-schemas";
import {
	shippedCatalogDigest,
} from "./browser-use-catalog-digest";
import { shippedRunbooksRoot } from "./browser-use-runbook";

const disposables: { dispose(): void }[] = [];

afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

describe("createBrowserUseGenerationRuntime", () => {
	test("resolves active records, excludes inactive ids, and emits binding identity", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error("paths refused");

		const generationId = "generation-runtime-a";
		const runbook = `${JSON.stringify({
			contract: "browser-use.runbook",
			schema_version: "2",
			service_id: "acme",
			flow_id: "read",
			flow_name: "read",
			version: "1.0.0",
			summary: "Read portal state.",
			allowed_origins: ["https://portal.example"],
			auth_context_ref: "acme-session",
			inputs: [],
			steps: [{ kind: "snapshot", interactive: false }],
		})}\n`;
		const registry = `${JSON.stringify({ actions: [] })}\n`;
		const authCandidate = `${JSON.stringify({
			candidate_id: "candidate-acme",
			service_id: "acme",
			auth_context: "interactive-login",
			legacy_context_prose: null,
			hint_item_id: null,
			proposed_origins: ["https://portal.example"],
			legacy_vault_name: null,
			provenance: "legacy-auth-pointer",
		})}\n`;
		const sessionPolicy = {
			schema_version: "1",
			approved_service_origins: ["https://portal.example"],
			approved_identity_provider_origins: ["https://login.example"],
			auth_flow: {
				schema_version: "1",
				fields: {
					username: { role: "textbox", name: "Email address" },
				},
				identify_state: {
					action_id: "acme-identify-auth-state",
					expected_digest: "1".repeat(64),
				},
				username_submit: {
					action_id: "acme-submit-username",
					expected_digest: "2".repeat(64),
				},
			},
			identity_verifier: {
				schema_version: "1",
				action: {
					action_id: "acme-verify-session",
					expected_digest: "3".repeat(64),
				},
				expected: {
					subject_reference: "acme-subject",
					account_reference: "acme-account",
					tenant_reference: "acme-tenant",
				},
				freshness_ms: 60_000,
			},
		} as const;
		const authRouteRecord = {
			auth_context_ref: "acme-session",
			candidate_id: "candidate-acme",
			status: "active",
			session_policy: sessionPolicy,
		} as const;
		const authRoute = `${JSON.stringify(authRouteRecord)}\n`;
		const legacyAuthRouteRecord = {
			auth_context_ref: "legacy-acme-session",
			candidate_id: "candidate-acme",
			status: "active",
		} as const;
		const legacyAuthRoute = `${JSON.stringify(legacyAuthRouteRecord)}\n`;
		const staged = await stageGeneration(
			{ fs, paths: opened.paths, clock: () => 100 },
			{
				generationId,
				files: [
					{
						relPath: "runbooks/acme/read/runbook.json",
						contents: runbook,
					},
					{ relPath: "actions/registry.json", contents: registry },
					{
						relPath: "auth/candidates/candidate-acme.json",
						contents: authCandidate,
					},
					{
						relPath: "auth/routes/acme-session.json",
						contents: authRoute,
					},
					{
						relPath: "auth/routes/legacy-acme-session.json",
						contents: legacyAuthRoute,
					},
				],
			},
		);
		expect(staged.ok).toBe(true);
		if (!staged.ok) throw new Error("generation staging failed");

		const manifest: BrowserUseCorpusGenerationManifestPayload = {
			contract: "browser-use.corpus-generation-manifest",
			schema_version: "1",
			generation_id: generationId,
			generation_content_hash: staged.record.content_hash,
			candidate_manifest_digest: "a".repeat(64),
			activation_epoch: 2,
			activated_at_epoch_ms: 200,
			source_snapshot: {
				snapshot_id: "snapshot-a",
				snapshot_digest: "b".repeat(64),
			},
			canonical_targets: [
				{
					canonical_target_id: "acme/read",
					activation: "active",
					runbook_path: "runbooks/acme/read/runbook.json",
					runbook_digest: sha256(runbook),
					source_relative_paths: ["acme/read.md"],
					proof_refs: ["proof-read"],
					inactive_reason: null,
				},
				{
					canonical_target_id: "finance/pay",
					activation: "inactive",
					runbook_path: "runbooks/finance/pay/runbook.json",
					runbook_digest: "c".repeat(64),
					source_relative_paths: ["finance/pay.md"],
					proof_refs: [],
					inactive_reason: "financial mutation remains staged",
				},
			],
			action_registry: {
				registry_path: "actions/registry.json",
				registry_digest: sha256(registry),
				actions: [],
			},
			auth: {
				candidates: [
					{
						candidate_id: "candidate-acme",
						path: "auth/candidates/candidate-acme.json",
						digest: sha256(authCandidate),
					},
				],
				routes: [
					{
						auth_context_ref: "acme-session",
						candidate_id: "candidate-acme",
						path: "auth/routes/acme-session.json",
						digest: sha256(authRoute),
					},
					{
						auth_context_ref: "legacy-acme-session",
						candidate_id: "candidate-acme",
						path: "auth/routes/legacy-acme-session.json",
						digest: sha256(legacyAuthRoute),
					},
				],
			},
			proofs: [],
			shipped_catalog_digest: await shippedCatalogDigest(
				shippedRunbooksRoot(),
				fs,
			),
			prior_generation: null,
			retained_generations: [],
		};

		const openedRuntime = await createBrowserUseGenerationRuntime(
			{ fs, paths: opened.paths },
			manifest,
		);
		expect(openedRuntime.ok).toBe(true);
		if (!openedRuntime.ok) throw new Error(openedRuntime.failure.code);
		expect(await openedRuntime.runtime.activeGenerationSeam.listIds()).toEqual([
			{ serviceId: "acme", flowId: "read" },
		]);
		expect(
			await openedRuntime.runtime.activeGenerationSeam.loadRunbook({
				serviceId: "acme",
				flowId: "read",
			}),
		).toMatchObject({ ok: true, runbook: { version: "1.0.0" } });
		expect(
			await openedRuntime.runtime.activeGenerationSeam.loadRunbook({
				serviceId: "finance",
				flowId: "pay",
			}),
		).toMatchObject({
			ok: false,
			absent: false,
			failure: { code: "runbook_inactive" },
		});
		expect(
			openedRuntime.runtime.bindingIdentityFor({
				serviceId: "acme",
				flowId: "read",
			}),
		).toEqual({
			generation_id: generationId,
			activation_epoch: 2,
			runbook_digest: sha256(runbook),
			action_registry_digest: sha256(registry),
		});
		expect(
			await openedRuntime.runtime.authGenerationSeam.loadAuthCandidate(
				"acme-session",
			),
		).toEqual({
			ok: true,
			resolution: {
				generation_id: generationId,
				activation_epoch: 2,
				auth_context_ref: "acme-session",
				route_digest: sha256(authRoute),
				candidate_digest: sha256(authCandidate),
				route: authRouteRecord,
				candidate: JSON.parse(authCandidate),
			},
		});
		expect(
			await openedRuntime.runtime.authGenerationSeam.loadAuthCandidate(
				"legacy-acme-session",
			),
		).toEqual({
			ok: true,
			resolution: {
				generation_id: generationId,
				activation_epoch: 2,
				auth_context_ref: "legacy-acme-session",
				route_digest: sha256(legacyAuthRoute),
				candidate_digest: sha256(authCandidate),
				route: legacyAuthRouteRecord,
				candidate: JSON.parse(authCandidate),
			},
		});

		const mismatched = await createBrowserUseGenerationRuntime(
			{ fs, paths: opened.paths },
			{
				...manifest,
				auth: {
					...manifest.auth,
					candidates: manifest.auth.candidates.map((candidate) => ({
						...candidate,
						digest: "f".repeat(64),
					})),
				},
			},
		);
		expect(mismatched.ok).toBe(true);
		if (!mismatched.ok) throw new Error(mismatched.failure.code);
		expect(
			await mismatched.runtime.authGenerationSeam.loadAuthCandidate(
				"acme-session",
			),
		).toEqual({
			ok: false,
			failure: {
				code: "auth_generation_record_corrupt",
				message:
					"the captured generation auth candidate is unreadable or digest-mismatched.",
			},
		});
	});

	test("refuses shipped-catalog drift before exposing generation authority", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error("paths refused");
		const manifest = {
			contract: "browser-use.corpus-generation-manifest",
			schema_version: "1",
			generation_id: "generation-runtime-drift",
			generation_content_hash: "a".repeat(64),
			candidate_manifest_digest: "b".repeat(64),
			activation_epoch: 2,
			activated_at_epoch_ms: 200,
			source_snapshot: {
				snapshot_id: "snapshot-a",
				snapshot_digest: "c".repeat(64),
			},
			canonical_targets: [],
			action_registry: {
				registry_path: "actions/registry.json",
				registry_digest: "d".repeat(64),
				actions: [],
			},
			auth: { candidates: [], routes: [] },
			proofs: [],
			shipped_catalog_digest: "e".repeat(64),
			prior_generation: null,
			retained_generations: [],
		} satisfies BrowserUseCorpusGenerationManifestPayload;
		const result = await createBrowserUseGenerationRuntime(
			{ fs, paths: opened.paths },
			manifest,
		);
		expect(result).toMatchObject({
			ok: false,
			failure: { code: "runbook_catalog_drift" },
		});
	});
});
