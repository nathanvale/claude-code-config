import { afterEach, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { openBrowserUsePaths } from "./browser-use-paths";
import {
	fixedClock,
	makeVolatileOverlayFs,
	type VolatileOverlayFs,
} from "./browser-use-platform-test-helpers";
import {
	activateRunbookGeneration,
	commitRunbookGenerationCutover,
	projectRunbookGenerationSynchronization,
	resolveRetainedRunbookGeneration,
	resolveSelectedRunbookGeneration,
	runbookGenerationDirectory,
	withRunbookGenerationSelectionBarrier,
	type BrowserUseGenerationCatalog,
	type BrowserUseGenerationCrashBoundary,
	type BrowserUseGenerationDeps,
	type BrowserUseSelectedGeneration,
} from "./browser-use-runbook-generation";
import type { BrowserUseRunExecutionBinding } from "./browser-use-runbook-actions";

const overlays = new Set<VolatileOverlayFs>();
afterEach(() => {
	for (const overlay of overlays) overlay.dispose();
	overlays.clear();
});

function catalogFor(revision: string): BrowserUseGenerationCatalog {
	const runbookBytes = JSON.stringify({
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: "demo",
		flow_id: "read",
		flow_name: "demo-read",
		version: revision,
		summary: `Read demo state ${revision}.`,
		allowed_origins: ["https://example.test"],
		inputs: [],
		steps: [{ kind: "snapshot", interactive: false }],
	});
	const runbookDigest = new Bun.CryptoHasher("sha256").update(runbookBytes).digest("hex");
	const registryBytes = JSON.stringify({ actions: [] });
	const registryDigest = new Bun.CryptoHasher("sha256").update(registryBytes).digest("hex");
	const files = [
		{ relative_path: "actions/registry.json", bytes: registryBytes, digest: registryDigest },
		{ relative_path: "runbooks/demo/read/runbook.json", bytes: runbookBytes, digest: runbookDigest },
	];
	return {
		commit: revision.repeat(40).slice(0, 40),
		catalog_digest: new Bun.CryptoHasher("sha256").update(files.map((file) => `${file.relative_path}\0${file.digest}\0`).join("")).digest("hex"),
		action_registry_digest: registryDigest,
		files,
	};
}

async function fixture() {
	const overlay = makeVolatileOverlayFs();
	overlays.add(overlay);
	const opened = await openBrowserUsePaths(overlay.fs, {
		HOME: "/home/agent",
		XDG_CONFIG_HOME: "/xdg/config",
		XDG_DATA_HOME: "/xdg/data",
		XDG_STATE_HOME: "/xdg/state",
		XDG_CACHE_HOME: "/xdg/cache",
		XDG_RUNTIME_DIR: "/xdg/runtime",
	});
	if (!opened.ok) throw new Error(opened.refusal.code);
	const clock = fixedClock();
	const reconstruct = (overrides: Partial<BrowserUseGenerationDeps> = {}): BrowserUseGenerationDeps => ({
		fs: overlay.fs,
		paths: opened.paths,
		clock: clock.now,
		...overrides,
	});
	return { overlay, reconstruct, catalogA: catalogFor("1"), catalogB: catalogFor("2") };
}

async function activate(
	deps: BrowserUseGenerationDeps,
	catalog: BrowserUseGenerationCatalog,
	expectedEpoch: number,
) {
	return await activateRunbookGeneration(deps, {
		catalog,
		reviewedCatalogDigest: catalog.catalog_digest,
		expectedEpoch,
	});
}

async function selected(deps: BrowserUseGenerationDeps): Promise<BrowserUseSelectedGeneration> {
	const result = await resolveSelectedRunbookGeneration(deps);
	if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
	return result;
}

async function retainedGenerationIds(deps: BrowserUseGenerationDeps): Promise<string[]> {
	return (await deps.fs.readDirectory(deps.paths.data.runbookGenerationsDir))
		.filter((entry) => entry.startsWith("gen-"))
		.sort();
}

function bindingFor(generation: BrowserUseSelectedGeneration): BrowserUseRunExecutionBinding {
	const runbook = generation.manifest.runbooks[0];
	if (runbook === undefined) throw new Error("fixture generation has no Runbook");
	return {
		schema_version: "1",
		generation_id: generation.generation_id,
		activation_epoch: generation.epoch,
		service_id: runbook.service_id,
		flow_id: runbook.flow_id,
		runbook_version: "1",
		runbook_digest: runbook.record_digest,
		action_registry_digest: generation.action_registry_digest,
		normalized_input_digest: "0".repeat(64),
		item_key_digest: "1".repeat(64),
		target_scope: "https://example.test",
		postcondition: { id: "done", summary: "Done." },
	};
}

describe("immutable Runbook Generation activation", () => {
	test("selects first generation and repeats as no-op", async () => {
		const { reconstruct, catalogA } = await fixture();
		expect(await activateRunbookGeneration(reconstruct(), { catalog: catalogA, reviewedCatalogDigest: catalogA.catalog_digest, expectedEpoch: 0 })).toMatchObject({ ok: true, changed: true, epoch: 1 });
		expect(await activateRunbookGeneration(reconstruct(), { catalog: catalogA, reviewedCatalogDigest: catalogA.catalog_digest, expectedEpoch: 1 })).toMatchObject({ ok: true, changed: false, epoch: 1 });
	});

	test("post-commit retry returns the original committed digest and epoch", async () => {
		const { overlay, reconstruct, catalogA, catalogB } = await fixture();
		await activateRunbookGeneration(reconstruct(), { catalog: catalogA, reviewedCatalogDigest: catalogA.catalog_digest, expectedEpoch: 0 });
		let observed = false;
		const interrupted = await activateRunbookGeneration(reconstruct({
			crash(boundary) {
				if (boundary !== "after_authority_commit") return false;
				observed = true;
				overlay.crash();
				return true;
			},
		}), { catalog: catalogB, reviewedCatalogDigest: catalogB.catalog_digest, expectedEpoch: 1 });
		expect(observed).toBe(true);
		expect(interrupted).toMatchObject({ ok: false, code: "activation_interrupted" });
		expect(await activateRunbookGeneration(reconstruct(), { catalog: catalogB, reviewedCatalogDigest: catalogB.catalog_digest, expectedEpoch: 1 })).toMatchObject({
			ok: true,
			changed: false,
			catalog_digest: catalogB.catalog_digest,
			epoch: 2,
		});
	});

	test("post-commit corrupt authority refuses without minting another epoch", async () => {
		const { overlay, reconstruct, catalogA, catalogB } = await fixture();
		await activate(reconstruct(), catalogA, 0);
		await activate(reconstruct({
			crash(boundary) {
				if (boundary !== "after_authority_commit") return false;
				overlay.crash();
				return true;
			},
		}), catalogB, 1);
		const generation = runbookGenerationDirectory(reconstruct().paths, `gen-${catalogB.catalog_digest}`);
		overlay.tamperFile(join(generation, "runbooks", "demo", "read", "runbook.json"), "tampered");
		expect(await activate(reconstruct(), catalogB, 1)).toMatchObject({ ok: false, code: "activation_generation_corrupt" });
		const authority = JSON.parse(await reconstruct().fs.readTextFile(reconstruct().paths.data.runbookGenerationAuthorityFile)) as { epoch: number };
		expect(authority.epoch).toBe(2);
		expect(await retainedGenerationIds(reconstruct())).toEqual([
			`gen-${catalogA.catalog_digest}`,
			`gen-${catalogB.catalog_digest}`,
		].sort());
	});

	for (const boundary of [
		"before_stage",
		"after_stage",
		"after_verification",
		"before_authority_commit",
		"after_authority_commit",
	] satisfies BrowserUseGenerationCrashBoundary[]) {
		test(`${boundary} reconstructs one deterministic authority outcome`, async () => {
			const { overlay, reconstruct, catalogA, catalogB } = await fixture();
			await activate(reconstruct(), catalogA, 0);
			const interrupted = await activate(reconstruct({
				crash(observed) {
					if (observed !== boundary) return false;
					overlay.crash();
					return true;
				},
			}), catalogB, 1);
			expect(interrupted).toMatchObject({ ok: false, code: "activation_interrupted" });

			let fallbackReads = 0;
			const reconstructed = reconstruct({ legacyFallback: async () => { fallbackReads += 1; } });
			const active = await selected(reconstructed);
			const committed = boundary === "after_authority_commit";
			expect(active).toMatchObject({
				catalog_digest: committed ? catalogB.catalog_digest : catalogA.catalog_digest,
				epoch: committed ? 2 : 1,
			});
			expect(await retainedGenerationIds(reconstructed)).toEqual(
				(boundary === "before_stage" ? [catalogA] : [catalogA, catalogB])
					.map((catalog) => `gen-${catalog.catalog_digest}`)
					.sort(),
			);
			expect(fallbackReads).toBe(0);

			if (committed) {
				expect(await activate(reconstruct(), catalogB, 1)).toMatchObject({
					ok: true,
					changed: false,
					catalog_digest: catalogB.catalog_digest,
					epoch: 2,
				});
			}
		});
	}

	test("refuses stale digest and epoch", async () => {
		const { reconstruct, catalogA, catalogB } = await fixture();
		expect(await activateRunbookGeneration(reconstruct(), { catalog: catalogA, reviewedCatalogDigest: "f".repeat(64), expectedEpoch: 0 })).toMatchObject({ ok: false, code: "catalog_drift" });
		await activateRunbookGeneration(reconstruct(), { catalog: catalogA, reviewedCatalogDigest: catalogA.catalog_digest, expectedEpoch: 0 });
		expect(await activateRunbookGeneration(reconstruct(), { catalog: catalogB, reviewedCatalogDigest: catalogB.catalog_digest, expectedEpoch: 0 })).toMatchObject({ ok: false, code: "activation_epoch_conflict" });
	});

	test("failed generation rename preserves prior authority", async () => {
		const { overlay, reconstruct, catalogA, catalogB } = await fixture();
		await activate(reconstruct(), catalogA, 0);
		overlay.failRenameExdev = true;
		expect(await activate(reconstruct(), catalogB, 1)).toMatchObject({ ok: false, code: "activation_store_unsafe" });
		overlay.failRenameExdev = false;
		overlay.crash();
		expect(await selected(reconstruct())).toMatchObject({ catalog_digest: catalogA.catalog_digest, epoch: 1 });
		expect(await retainedGenerationIds(reconstruct())).toEqual([`gen-${catalogA.catalog_digest}`]);
	});

	test("failed authority directory fsync reconstructs prior authority", async () => {
		const { overlay, reconstruct, catalogA, catalogB } = await fixture();
		const deps = reconstruct();
		await activate(deps, catalogA, 0);
		const authorityDirectory = dirname(deps.paths.data.runbookGenerationAuthorityFile);
		overlay.hooks.onBeforeFsync = (path) => {
			if (path !== authorityDirectory) return;
			overlay.hooks.onBeforeFsync = undefined;
			throw new Error("injected authority directory fsync failure");
		};
		expect(await activate(reconstruct(), catalogB, 1)).toMatchObject({ ok: false, code: "activation_store_unsafe" });
		overlay.crash();
		expect(await selected(reconstruct())).toMatchObject({ catalog_digest: catalogA.catalog_digest, epoch: 1 });
		expect(await retainedGenerationIds(reconstruct())).toEqual([
			`gen-${catalogA.catalog_digest}`,
			`gen-${catalogB.catalog_digest}`,
		].sort());
	});

	for (const tamper of ["manifest", "file"] as const) {
		test(`staged ${tamper} tamper refuses before authority commit`, async () => {
			const { overlay, reconstruct, catalogA, catalogB } = await fixture();
			await activate(reconstruct(), catalogA, 0);
			const generation = runbookGenerationDirectory(reconstruct().paths, `gen-${catalogB.catalog_digest}`);
			const result = await activate(reconstruct({
				crash(boundary) {
					if (boundary !== "after_stage") return false;
					overlay.tamperFile(
						tamper === "manifest" ? join(generation, "manifest.json") : join(generation, "runbooks", "demo", "read", "runbook.json"),
						"tampered",
					);
					return false;
				},
			}), catalogB, 1);
			expect(result).toMatchObject({ ok: false, code: "activation_generation_corrupt" });
			expect(await selected(reconstruct())).toMatchObject({ catalog_digest: catalogA.catalog_digest, epoch: 1 });
		});
	}

	test("active pointer tamper refuses activation and post-cutover fallback", async () => {
		const { overlay, reconstruct, catalogA, catalogB } = await fixture();
		const deps = reconstruct();
		await activate(deps, catalogA, 0);
		await commitRunbookGenerationCutover(deps);
		overlay.tamperFile(deps.paths.data.runbookGenerationAuthorityFile, "not-json");
		expect(await activate(reconstruct(), catalogB, 1)).toMatchObject({ ok: false, code: "activation_authority_corrupt" });
		let fallbackReads = 0;
		expect(await resolveSelectedRunbookGeneration(reconstruct({ legacyFallback: async () => { fallbackReads += 1; } }))).toMatchObject({ ok: false, code: "activation_required" });
		expect(fallbackReads).toBe(0);
	});

	test("active pointer provenance drift refuses without allocating an epoch", async () => {
		const { overlay, reconstruct, catalogA, catalogB } = await fixture();
		const deps = reconstruct();
		await activate(deps, catalogA, 0);
		const authority = JSON.parse(await deps.fs.readTextFile(deps.paths.data.runbookGenerationAuthorityFile)) as Record<string, unknown>;
		authority.catalog_digest = "f".repeat(64);
		overlay.tamperFile(deps.paths.data.runbookGenerationAuthorityFile, JSON.stringify(authority));
		expect(await activate(reconstruct(), catalogB, 1)).toMatchObject({ ok: false, code: "activation_authority_corrupt" });
	});

	test("post-cutover selected-file tamper never reads fallback", async () => {
		const { overlay, reconstruct, catalogA } = await fixture();
		const deps = reconstruct();
		await activate(deps, catalogA, 0);
		await commitRunbookGenerationCutover(deps);
		overlay.tamperFile(join(runbookGenerationDirectory(deps.paths, `gen-${catalogA.catalog_digest}`), "runbooks", "demo", "read", "runbook.json"), "tampered");
		let fallbackReads = 0;
		expect(await resolveSelectedRunbookGeneration(reconstruct({ legacyFallback: async () => { fallbackReads += 1; } }))).toMatchObject({ ok: false, code: "activation_required" });
		expect(fallbackReads).toBe(0);
	});

	test("concurrent activation admits one next epoch", async () => {
		const { overlay, reconstruct, catalogA, catalogB } = await fixture();
		await activate(reconstruct(), catalogA, 0);
		const pause = overlay.pauseAfterRead();
		const first = activate(reconstruct(), catalogB, 1);
		expect(await pause.reached).toBe(reconstruct().paths.data.runbookGenerationAuthorityFile);
		const contender = await activate(reconstruct(), catalogB, 1);
		expect(contender).toMatchObject({ ok: false, code: "activation_store_unsafe" });
		pause.release();
		expect(await first).toMatchObject({ ok: true, changed: true, epoch: 2 });
		expect(await activate(reconstruct(), catalogB, 1)).toMatchObject({ ok: true, changed: false, epoch: 2 });
	});

	test("fresh-run selection race refuses the old binding before dispatch", async () => {
		const { reconstruct, catalogA, catalogB } = await fixture();
		await activate(reconstruct(), catalogA, 0);
		const prior = await selected(reconstruct());
		await activate(reconstruct(), catalogB, 1);
		let dispatches = 0;
		expect(await withRunbookGenerationSelectionBarrier(reconstruct(), prior, async () => {
			dispatches += 1;
			return { ok: true };
		})).toMatchObject({ ok: false, code: "activation_epoch_conflict" });
		expect(dispatches).toBe(0);
		const current = await selected(reconstruct());
		expect(await withRunbookGenerationSelectionBarrier(reconstruct(), current, async () => {
			dispatches += 1;
			return { ok: true };
		})).toEqual({ ok: true });
		expect(dispatches).toBe(1);
	});

	test("nonterminal mutation run blocks activation while retained read-only authority resolves", async () => {
		const { reconstruct, catalogA, catalogB } = await fixture();
		await activate(reconstruct(), catalogA, 0);
		const prior = await selected(reconstruct());
		let inspectedGeneration: string | null | undefined;
		expect(await activate(reconstruct({
			nonterminalMutationRuns: async (generationId) => {
				inspectedGeneration = generationId;
				return ["run-mutation"];
			},
		}), catalogB, 1)).toMatchObject({ ok: false, code: "activation_blocked_by_run" });
		expect(inspectedGeneration).toBe(prior.generation_id);
		expect(await resolveRetainedRunbookGeneration(reconstruct(), bindingFor(prior))).toMatchObject({
			ok: true,
			generation_id: prior.generation_id,
			epoch: 1,
		});
	});

	test("missing retained generation never falls forward to current authority", async () => {
		const { reconstruct, catalogA, catalogB } = await fixture();
		await activate(reconstruct(), catalogA, 0);
		const prior = await selected(reconstruct());
		await activate(reconstruct(), catalogB, 1);
		await reconstruct().fs.removeDirectoryRecursive(runbookGenerationDirectory(reconstruct().paths, prior.generation_id));
		let fallbackReads = 0;
		const retained = await resolveRetainedRunbookGeneration(reconstruct({ legacyFallback: async () => { fallbackReads += 1; } }), bindingFor(prior));
		expect(retained).toMatchObject({ ok: false, code: "activation_generation_corrupt" });
		expect((retained as { generation_id?: string }).generation_id).toBeUndefined();
		expect((await selected(reconstruct())).catalog_digest).toBe(catalogB.catalog_digest);
		expect(fallbackReads).toBe(0);
	});

	for (const damage of ["tampered", "incomplete"] as const) {
		test(`${damage} retained generation refuses revalidation`, async () => {
			const { overlay, reconstruct, catalogA, catalogB } = await fixture();
			await activate(reconstruct(), catalogA, 0);
			const prior = await selected(reconstruct());
			await activate(reconstruct(), catalogB, 1);
			const runbookPath = join(runbookGenerationDirectory(reconstruct().paths, prior.generation_id), "runbooks", "demo", "read", "runbook.json");
			if (damage === "tampered") overlay.tamperFile(runbookPath, "tampered");
			else await reconstruct().fs.unlink(runbookPath);
			expect(await resolveRetainedRunbookGeneration(reconstruct(), bindingFor(prior))).toMatchObject({ ok: false, code: "activation_generation_corrupt" });
		});
	}

	test("post-cutover missing authority never reads fallback", async () => {
		const { reconstruct, catalogA } = await fixture();
		const deps = reconstruct();
		await activateRunbookGeneration(deps, { catalog: catalogA, reviewedCatalogDigest: catalogA.catalog_digest, expectedEpoch: 0 });
		await commitRunbookGenerationCutover(deps);
		await deps.fs.unlink(deps.paths.data.runbookGenerationAuthorityFile);
		let reads = 0;
		expect(await resolveSelectedRunbookGeneration(reconstruct({ legacyFallback: async () => { reads += 1; } }))).toMatchObject({ ok: false, code: "activation_required" });
		expect(reads).toBe(0);
	});

	test("projects synchronization states", () => {
		const projected = projectRunbookGenerationSynchronization(
			{ available: true, catalog_digest: "b".repeat(64), records: { "demo/same": "1".repeat(64), "demo/new": "3".repeat(64) } },
			{ available: true, catalog_digest: "a".repeat(64), generation_id: `gen-${"a".repeat(64)}`, epoch: 3, records: { "demo/same": "1".repeat(64), "demo/deleted": "2".repeat(64) } },
		);
		expect(projected.catalog_status).toBe("activation-required");
		expect(projected.records.map((record) => record.status)).toEqual(["deletion-pending-activation", "new-pending-activation", "in-sync"]);
	});
});
