import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultPlatformFs, openBrowserUsePaths } from "./browser-use-paths";
import {
	activateRunbookGeneration,
	commitRunbookGenerationCutover,
	projectRunbookGenerationSynchronization,
	resolveSelectedRunbookGeneration,
	type BrowserUseGenerationCatalog,
} from "./browser-use-runbook-generation";

const cleanup = new Set<string>();
afterEach(async () => {
	for (const path of cleanup) await rm(path, { recursive: true, force: true });
	cleanup.clear();
});

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "browser-use-generation-"));
	const canonicalRoot = await realpath(root);
	cleanup.add(canonicalRoot);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, {
		HOME: canonicalRoot,
		XDG_CONFIG_HOME: join(canonicalRoot, "config"),
		XDG_DATA_HOME: join(canonicalRoot, "data"),
		XDG_STATE_HOME: join(canonicalRoot, "state"),
		XDG_CACHE_HOME: join(canonicalRoot, "cache"),
		XDG_RUNTIME_DIR: join(canonicalRoot, "runtime"),
	});
	if (!opened.ok) throw new Error(opened.refusal.code);
	const runbookBytes = JSON.stringify({
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: "demo",
		flow_id: "read",
		flow_name: "demo-read",
		version: "1",
		summary: "Read demo state.",
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
	const catalog: BrowserUseGenerationCatalog = {
		commit: "1".repeat(40),
		catalog_digest: new Bun.CryptoHasher("sha256").update(files.map((file) => `${file.relative_path}\0${file.digest}\0`).join("")).digest("hex"),
		action_registry_digest: registryDigest,
		files,
	};
	return { deps: { fs, paths: opened.paths, clock: () => 1000 }, catalog };
}

describe("immutable Runbook Generation activation", () => {
	test("selects first generation and repeats as no-op", async () => {
		const { deps, catalog } = await fixture();
		expect(await activateRunbookGeneration(deps, { catalog, reviewedCatalogDigest: catalog.catalog_digest, expectedEpoch: 0 })).toMatchObject({ ok: true, changed: true, epoch: 1 });
		expect(await activateRunbookGeneration(deps, { catalog, reviewedCatalogDigest: catalog.catalog_digest, expectedEpoch: 1 })).toMatchObject({ ok: true, changed: false, epoch: 1 });
	});

	test("refuses stale digest and epoch", async () => {
		const { deps, catalog } = await fixture();
		expect(await activateRunbookGeneration(deps, { catalog, reviewedCatalogDigest: "f".repeat(64), expectedEpoch: 0 })).toMatchObject({ ok: false, code: "catalog_drift" });
		await activateRunbookGeneration(deps, { catalog, reviewedCatalogDigest: catalog.catalog_digest, expectedEpoch: 0 });
		expect(await activateRunbookGeneration(deps, { catalog, reviewedCatalogDigest: catalog.catalog_digest, expectedEpoch: 0 })).toMatchObject({ ok: false, code: "activation_epoch_conflict" });
	});

	test("post-cutover missing authority never reads fallback", async () => {
		const { deps, catalog } = await fixture();
		await activateRunbookGeneration(deps, { catalog, reviewedCatalogDigest: catalog.catalog_digest, expectedEpoch: 0 });
		await commitRunbookGenerationCutover(deps);
		await deps.fs.unlink(deps.paths.data.runbookGenerationAuthorityFile);
		let reads = 0;
		expect(await resolveSelectedRunbookGeneration({ ...deps, legacyFallback: async () => { reads += 1; } })).toMatchObject({ ok: false, code: "activation_required" });
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
