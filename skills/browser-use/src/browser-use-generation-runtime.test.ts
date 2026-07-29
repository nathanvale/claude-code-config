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
			inputs: [],
			steps: [{ kind: "snapshot", interactive: false }],
		})}\n`;
		const registry = `${JSON.stringify({ actions: [] })}\n`;
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
			auth: { candidates: [], routes: [] },
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
