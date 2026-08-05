import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadPrivateRunbookCatalogFromGit,
	type BrowserUsePromotionVerifier,
} from "./browser-use-private-runbook-catalog";
import {
	activateRunbookGeneration,
	resolveSelectedRunbookGeneration,
} from "./browser-use-runbook-generation";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";

const cleanup = new Set<string>();

afterEach(async () => {
	for (const path of cleanup) await rm(path, { recursive: true, force: true });
	cleanup.clear();
});

async function git(root: string, ...args: string[]): Promise<void> {
	const process = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
	if ((await process.exited) !== 0) throw new Error(await new Response(process.stderr).text());
}

async function fixture(input?: { action?: boolean }): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "browser-use-private-catalog-"));
	cleanup.add(root);
	await git(root, "init", "-q");
	await git(root, "config", "user.email", "test@example.invalid");
	await git(root, "config", "user.name", "Catalog Test");
	const runbookRoot = join(root, "skills/browser-use/runbooks/demo/read");
	await mkdir(runbookRoot, { recursive: true });
	const actionBytes = "async ({ inputs }) => ({ count: 1 });";
	const actionDigest = new Bun.CryptoHasher("sha256").update(actionBytes).digest("hex");
	await writeFile(
		join(runbookRoot, "runbook.json"),
		JSON.stringify({
			contract: "browser-use.runbook",
			schema_version: "2",
			service_id: "demo",
			flow_id: "read",
			flow_name: "demo-read",
			version: "1",
			summary: "Read demo state.",
			allowed_origins: ["https://example.test"],
			inputs: [],
			steps: input?.action
				? [{ kind: "action", action_id: "demo-read", expected_digest: actionDigest, inputs: {} }]
				: [{ kind: "snapshot", interactive: false }],
		}),
	);
	if (input?.action) {
		const snapshotRoot = join(root, "skills/browser-use/runbooks/demo/snapshot");
		await mkdir(snapshotRoot, { recursive: true });
		await writeFile(
			join(snapshotRoot, "runbook.json"),
			JSON.stringify({
				contract: "browser-use.runbook",
				schema_version: "2",
				service_id: "demo",
				flow_id: "snapshot",
				flow_name: "demo-snapshot",
				version: "1",
				summary: "Read one demo snapshot.",
				allowed_origins: ["https://example.test"],
				inputs: [],
				steps: [{ kind: "snapshot", interactive: false }],
			}),
		);
	}
	if (input?.action) {
		const actionsRoot = join(root, "skills/browser-use/actions");
		await mkdir(join(actionsRoot, "demo"), { recursive: true });
		await writeFile(join(actionsRoot, "demo/read.js"), actionBytes);
		await writeFile(
			join(actionsRoot, "registry.json"),
			JSON.stringify({
				actions: [
					{
						asset_path: "demo/read.js",
						record: {
							action_id: "demo-read",
							asset_id: actionDigest,
							expected_digest: actionDigest,
							allowed_origin: "https://example.test",
							effect_class: "mutation",
							containment: "none",
							input_schema: { kind: "object", fields: {} },
							result_schema: { kind: "object", fields: {} },
							result_sensitivity: "low",
							required_postcondition: {
								kind: "element-visible",
								selector: ".done",
							},
							source_provenance: "test fixture",
							promotion_receipt: {
								approved_digest: actionDigest,
								disposition: "approved",
								approved_origin: "https://example.test",
								approved_effect: "mutation",
								approver_ref: "test-verifier",
							},
						},
					},
				],
			}),
		);
	}
	if (!input?.action) {
		const actionsRoot = join(root, "skills/browser-use/actions");
		await mkdir(actionsRoot, { recursive: true });
		await writeFile(join(actionsRoot, "registry.json"), JSON.stringify({ actions: [] }));
	}
	await git(root, "add", "skills/browser-use/runbooks", "skills/browser-use/actions");
	await git(root, "commit", "-qm", "test fixture");
	return root;
}

describe("private runbook catalog Git closure", () => {
	test("loads canonical bytes from one commit and ignores unrelated dirt", async () => {
		const root = await fixture();
		await writeFile(join(root, "unrelated.txt"), "dirty");
		const loaded = await loadPrivateRunbookCatalogFromGit({ repoRoot: root });
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		expect(loaded.catalog.runbooks).toHaveLength(1);
		expect(loaded.catalog.catalog_digest).toMatch(/^[0-9a-f]{64}$/);
		expect(loaded.catalog.working_tree_drift).toEqual([]);
	});

	test("separates action-bearing records without a verifier from the activatable closure", async () => {
		const root = await fixture({ action: true });
		const loaded = await loadPrivateRunbookCatalogFromGit({ repoRoot: root });
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		expect(loaded.catalog.runbooks.map((runbook) => runbook.id)).toEqual([
			"demo/snapshot",
		]);
		expect(loaded.catalog.separated).toEqual([
			{
				path: "runbooks/demo/read/runbook.json",
				record_id: "demo/read",
				code: "promotion_verifier_unavailable",
				message:
					"action-bearing activation requires verifier-backed promotion authority.",
			},
		]);
		expect(
			loaded.catalog.files.map((file) => file.relative_path),
		).toEqual([
			"actions/registry.json",
			"runbooks/demo/snapshot/runbook.json",
		]);
		expect(loaded.catalog.catalog_digest).toBe(
			new Bun.CryptoHasher("sha256")
				.update(
					loaded.catalog.files
						.map((file) => `${file.relative_path}\0${file.digest}\0`)
						.join(""),
				)
				.digest("hex"),
		);
		const xdg = makeTempXdgEnv();
		try {
			const fs = createDefaultPlatformFs();
			const opened = await openBrowserUsePaths(fs, xdg.env);
			if (!opened.ok) throw new Error(opened.refusal.code);
			const deps = { fs, paths: opened.paths, clock: () => 1_000 };
			expect(
				await activateRunbookGeneration(deps, {
					catalog: loaded.catalog,
					reviewedCatalogDigest: loaded.catalog.catalog_digest,
					expectedEpoch: 0,
				}),
			).toMatchObject({ ok: true, changed: true, epoch: 1 });
			const selected = await resolveSelectedRunbookGeneration(deps);
			expect(selected.ok).toBe(true);
			if (!selected.ok) return;
			expect(selected.manifest.runbooks).toEqual([
				expect.objectContaining({
					service_id: "demo",
					flow_id: "snapshot",
				}),
			]);
			expect(selected.manifest.files.map((file) => file.relative_path)).toEqual([
				"actions/registry.json",
				"runbooks/demo/snapshot/runbook.json",
			]);
		} finally {
			xdg.dispose();
		}
	});

	test("refuses closure-path worktree drift but not unrelated dirt", async () => {
		const root = await fixture();
		await writeFile(join(root, "skills/browser-use/runbooks/demo/read/runbook.json"), "{}\n");
		const loaded = await loadPrivateRunbookCatalogFromGit({ repoRoot: root });
		expect(loaded).toMatchObject({ ok: false, code: "catalog_git_drift" });
	});

	test("accepts an action closure only through the injected verifier", async () => {
		const root = await fixture({ action: true });
		const verifier: BrowserUsePromotionVerifier = {
			verify: async () => ({ ok: true }),
		};
		const loaded = await loadPrivateRunbookCatalogFromGit({ repoRoot: root, promotionVerifier: verifier });
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		expect(loaded.catalog.separated).toEqual([]);
		expect(loaded.catalog.files.map((file) => file.relative_path)).toContain(
			"actions/demo/read.js",
		);
	});

	test("hard-fails the whole catalog when a present verifier rejects promotion", async () => {
		const root = await fixture({ action: true });
		expect(
			await loadPrivateRunbookCatalogFromGit({
				repoRoot: root,
				promotionVerifier: {
					verify: async () => ({ ok: false, code: "approval_invalid" }),
				},
			}),
		).toMatchObject({ ok: false, code: "promotion_verification_failed" });
	});

	test("maps a rejecting verifier promise to the typed promotion failure", async () => {
		const root = await fixture({ action: true });
		expect(
			await loadPrivateRunbookCatalogFromGit({
				repoRoot: root,
				promotionVerifier: {
					verify: async () => {
						throw new Error("verifier unavailable");
					},
				},
			}),
		).toMatchObject({ ok: false, code: "promotion_verification_failed" });
	});

	test("refuses invalid committed Runbooks rather than dropping them", async () => {
		const root = await fixture();
		await writeFile(
			join(root, "skills/browser-use/runbooks/demo/read/runbook.json"),
			"{}\n",
		);
		await git(root, "add", "skills/browser-use/runbooks/demo/read/runbook.json");
		await git(root, "commit", "-qm", "invalid record");
		expect(await loadPrivateRunbookCatalogFromGit({ repoRoot: root })).toMatchObject({
			ok: false,
			code: "catalog_record_invalid",
		});
	});

	test("refuses unknown fields and auth contexts from the activation source", async () => {
		for (const change of [
			(record: Record<string, unknown>) => ({ ...record, approval: true }),
			(record: Record<string, unknown>) => ({
				...record,
				auth_context_ref: "unknown-context",
			}),
		]) {
			const root = await fixture();
			const path = join(root, "skills/browser-use/runbooks/demo/read/runbook.json");
			const record = JSON.parse(await Bun.file(path).text()) as Record<string, unknown>;
			await writeFile(path, `${JSON.stringify(change(record))}\n`);
			await git(root, "add", "skills/browser-use/runbooks/demo/read/runbook.json");
			await git(root, "commit", "-qm", "invalid authoring field");
			expect(await loadPrivateRunbookCatalogFromGit({ repoRoot: root })).toMatchObject({
				ok: false,
				code: "catalog_record_invalid",
			});
		}
	});

	test("refuses a promoted action outside its Runbook origin boundary", async () => {
		const root = await fixture({ action: true });
		const path = join(root, "skills/browser-use/runbooks/demo/read/runbook.json");
		const record = JSON.parse(await Bun.file(path).text()) as Record<string, unknown>;
		record.allowed_origins = ["https://other.example.test"];
		await writeFile(path, `${JSON.stringify(record)}\n`);
		await git(root, "add", "skills/browser-use/runbooks/demo/read/runbook.json");
		await git(root, "commit", "-qm", "wrong action origin");
		expect(
			await loadPrivateRunbookCatalogFromGit({
				repoRoot: root,
				promotionVerifier: { verify: async () => ({ ok: true }) },
			}),
		).toMatchObject({ ok: false, code: "catalog_action_closure_incomplete" });
	});

	test("refuses symlink objects from the resolved commit tree", async () => {
		const root = await fixture();
		const path = join(
			root,
			"skills/browser-use/runbooks/demo/read/runbook.json",
		);
		await unlink(path);
		await symlink("../../../../actions/registry.json", path);
		await git(root, "add", "skills/browser-use/runbooks/demo/read/runbook.json");
		await git(root, "commit", "-qm", "symlink record");
		expect(await loadPrivateRunbookCatalogFromGit({ repoRoot: root })).toMatchObject({
			ok: false,
			code: "catalog_git_object_unsupported",
		});
	});

	test("refuses commit-scoped Git content filters", async () => {
		const root = await fixture();
		await writeFile(
			join(root, ".gitattributes"),
			"skills/browser-use/runbooks/** filter=test-filter\n",
		);
		await git(root, "add", ".gitattributes");
		await git(root, "commit", "-qm", "filtered catalog");
		expect(await loadPrivateRunbookCatalogFromGit({ repoRoot: root })).toMatchObject({
			ok: false,
			code: "catalog_git_filter_unsupported",
		});
	});
});
