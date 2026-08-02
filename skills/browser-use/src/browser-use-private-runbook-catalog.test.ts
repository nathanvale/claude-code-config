import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadPrivateRunbookCatalogFromGit,
	type BrowserUsePromotionVerifier,
} from "./browser-use-private-runbook-catalog";

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

	test("refuses action-bearing source without verifier-backed promotion", async () => {
		const root = await fixture({ action: true });
		const loaded = await loadPrivateRunbookCatalogFromGit({ repoRoot: root });
		expect(loaded).toMatchObject({ ok: false, code: "promotion_verifier_unavailable" });
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
