import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runForTest } from "./browser-use";
import {
	type BrowserUseAuthoredReviewedActionRecord,
	verifyAuthoredReviewedActionPromotion,
} from "./browser-use-reviewed-action-authoring";
import { readRunbookSourceCatalog } from "./browser-use-runbook-authoring";
import {
	activateRunbookGeneration,
	createSelectedGenerationActionSeam,
	createSelectedGenerationRunbookSeam,
	projectRunbookGenerationSynchronization,
	resolveSelectedRunbookGeneration,
} from "./browser-use-runbook-generation";
import { loadPrivateRunbookCatalogFromGit } from "./browser-use-private-runbook-catalog";
import { createDefaultPlatformFs, openBrowserUsePaths } from "./browser-use-paths";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";
import { createTestOnlyReviewedActionPromotionAuthority } from "./fixtures/reviewed-action-promotion-test-fixture";

const cleanup = new Set<string>();
afterEach(async () => {
	for (const path of cleanup) await rm(path, { recursive: true, force: true });
	cleanup.clear();
});

const UNIFI_RUNBOOK = `${JSON.stringify({
	contract: "browser-use.runbook",
	schema_version: "2",
	service_id: "unifi",
	flow_id: "login-screen-verify",
	flow_name: "verify-login-screen",
	version: "1",
	summary: "Read-only UniFi proof: open the observed login URL, verify it, and capture a fresh interactive snapshot.",
	allowed_origins: ["https://192.168.1.1"],
	inputs: [],
	steps: [
		{
			kind: "open",
			url: "https://192.168.1.1/login",
			postcondition: { kind: "url-equals", url: "https://192.168.1.1/login" },
		},
		{ kind: "snapshot", interactive: true },
	],
}, null, 2)}\n`;

const ACTION_CANDIDATE = {
	contract: "browser-use.reviewed-action-candidate",
	schema_version: "1",
	action_id: "count-visible-rows",
	origin: "https://portal.example.test",
	source: "async ({ inputs }) => ({ rows: document.querySelectorAll('.row').length })",
	containment: "read-only-observation",
	input_schema: { kind: "object", fields: {} },
	result_schema: {
		kind: "object",
		fields: { rows: { required: true, schema: { kind: "number", integer: true } } },
	},
	result_sensitivity: "low",
};

async function git(root: string, ...args: string[]): Promise<string> {
	const child = Bun.spawn(["git", ...args], {
		cwd: root,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Catalog E2E",
			GIT_AUTHOR_EMAIL: "catalog-e2e@example.invalid",
			GIT_COMMITTER_NAME: "Catalog E2E",
			GIT_COMMITTER_EMAIL: "catalog-e2e@example.invalid",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) throw new Error(stderr);
	return stdout.trim();
}

async function fixture() {
	const sourceRoot = await mkdtemp(join(tmpdir(), "browser-use-composed-e2e-"));
	cleanup.add(sourceRoot);
	await mkdir(join(sourceRoot, "skills/browser-use/actions"), { recursive: true });
	await mkdir(join(sourceRoot, "skills/browser-use/runbooks"), { recursive: true });
	await writeFile(join(sourceRoot, "skills/browser-use/actions/registry.json"), '{"actions":[]}\n');
	await git(sourceRoot, "init", "-q");
	const xdg = makeTempXdgEnv();
	cleanup.add(xdg.base);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(opened.refusal.code);
	return { sourceRoot, xdg, deps: { fs, paths: opened.paths, clock: () => 1_000 } };
}

function promotionVerifier(verifier: ReturnType<typeof createTestOnlyReviewedActionPromotionAuthority>["verifier"]) {
	return {
		async verify(input: {
			commit: string;
			assetBytes: string;
			record: unknown;
			promotionHistory: readonly unknown[];
		}) {
			const result = verifyAuthoredReviewedActionPromotion({
				commit: input.commit,
				record: input.record as BrowserUseAuthoredReviewedActionRecord,
				assetBytes: input.assetBytes,
				promotionHistory: input.promotionHistory,
				verifier,
			});
			return result.ok ? { ok: true as const } : result;
		},
	};
}

describe("authoring-to-active-generation composed acceptance", () => {
	test("production front doors compose UniFi plus a promoted action and preserve AE4 generation semantics", async () => {
		const { sourceRoot, xdg, deps } = await fixture();
		const authority = createTestOnlyReviewedActionPromotionAuthority();
		const actionFile = join(sourceRoot, "action-candidate.json");
		await writeFile(actionFile, `${JSON.stringify(ACTION_CANDIDATE, null, 2)}\n`);
		const authoringRuntime = makeRuntime({
			env: xdg.env,
			sourceCheckoutRoot: sourceRoot,
			reviewedActionApprovalVerifier: authority.verifier,
			reviewedActionPromotionBroker: authority.operatorBroker,
		});
		const actionApplied = await runForTest(["action", "apply", "--file", actionFile, "--json"], authoringRuntime);
		expect(actionApplied.exitCode).toBe(0);
		const actionResult = (parseJson(actionApplied.stdout).data as { result: { digest: string } }).result;
		await git(sourceRoot, "add", "skills/browser-use/actions/registry.json", `skills/browser-use/actions/assets/${actionResult.digest}.js`);
		await git(sourceRoot, "commit", "-qm", "candidate");
		const promoted = await runForTest(
			[
				"action",
				"promote",
				"--id",
				"count-visible-rows",
				"--approval-reference",
				"test-only-review",
				"--json",
			],
			authoringRuntime,
		);
		expect(promoted.exitCode).toBe(0);
		expect(parseJson(promoted.stdout).data).toMatchObject({
			result: { ok: true, approved_digest: actionResult.digest },
		});
		await git(sourceRoot, "add", "skills/browser-use/actions/registry.json");
		await git(sourceRoot, "commit", "-qm", "promotion receipt");

		const actionRunbook = `${JSON.stringify({
			contract: "browser-use.runbook",
			schema_version: "2",
			service_id: "fixture-auth",
			flow_id: "business-after-login",
			flow_name: "business-after-login",
			version: "1",
			summary: "Authenticate generically, then count visible business rows.",
			allowed_origins: ["https://portal.example.test"],
			auth_context_ref: "interactive-login",
			inputs: [],
			steps: [{ kind: "action", action_id: "count-visible-rows", expected_digest: actionResult.digest, inputs: {} }],
		}, null, 2)}\n`;
		const actionRunbookFile = join(sourceRoot, "action-runbook.json");
		const unifiFile = join(sourceRoot, "unifi-runbook.json");
		await writeFile(actionRunbookFile, actionRunbook);
		await writeFile(unifiFile, UNIFI_RUNBOOK);
		const actionRunbookApplied = await runForTest(["runbook", "apply", "--file", actionRunbookFile, "--json"], authoringRuntime);
		const unifiApplied = await runForTest(["runbook", "apply", "--file", unifiFile, "--json"], authoringRuntime);
		expect(actionRunbookApplied.exitCode).toBe(0);
		expect(unifiApplied.exitCode).toBe(0);
		expect((parseJson(unifiApplied.stdout).data as { result: { synchronization_status: string } }).result.synchronization_status).toBe("new-pending-activation");
		await git(sourceRoot, "add", "skills/browser-use/runbooks");
		await git(sourceRoot, "commit", "-qm", "composed catalog");

		const loaded = await loadPrivateRunbookCatalogFromGit({
			repoRoot: sourceRoot,
			promotionVerifier: promotionVerifier(authority.verifier),
		});
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) throw new Error(loaded.message);
		const first = await activateRunbookGeneration(deps, {
			catalog: loaded.catalog,
			reviewedCatalogDigest: loaded.catalog.catalog_digest,
			expectedEpoch: 0,
		});
		expect(first).toMatchObject({ ok: true, changed: true, epoch: 1, previous_generation_id: null });
		const repeated = await activateRunbookGeneration(deps, {
			catalog: loaded.catalog,
			reviewedCatalogDigest: loaded.catalog.catalog_digest,
			expectedEpoch: 1,
		});
		expect(repeated).toMatchObject({ ok: true, changed: false, epoch: 1 });

		const selected = await resolveSelectedRunbookGeneration(deps);
		expect(selected.ok).toBe(true);
		if (!selected.ok) throw new Error(selected.message);
		const activeRunbookSeam = createSelectedGenerationRunbookSeam(deps, selected);
		const activeRunbooks = await activeRunbookSeam.listIds();
		expect(activeRunbooks).toContainEqual({ serviceId: "unifi", flowId: "login-screen-verify" });
		const activeAuthRunbook = await activeRunbookSeam.loadRunbook({ serviceId: "fixture-auth", flowId: "business-after-login" });
		expect(activeAuthRunbook).toMatchObject({
			ok: true,
			runbook: { auth_context_ref: "interactive-login", steps: [{ kind: "action", action_id: "count-visible-rows" }] },
		});
		const activeAction = createSelectedGenerationActionSeam(deps, selected, authority.verifier);
		const activeRecord = await activeAction.loadActionRecord("count-visible-rows");
		expect(activeRecord.ok).toBe(true);
		if (!activeRecord.ok) throw new Error("active Reviewed Action missing");
		const activeBytes = await activeAction.loadActionAssetBytes(activeRecord.record.asset_id);
		expect(activeBytes.ok).toBe(true);
		if (!activeBytes.ok) throw new Error("active Reviewed Action bytes missing");
		expect(await activeAction.verifyPromotion?.({
			actionId: "count-visible-rows",
			record: activeRecord.record,
			assetBytes: activeBytes.bytes,
		})).toEqual({ ok: true });
		const source = await readRunbookSourceCatalog({ sourceRoot, approvalVerifier: authority.verifier });
		expect(source.ok).toBe(true);
		if (!source.ok) throw new Error(source.message);
		const sync = projectRunbookGenerationSynchronization(
			{ available: true, catalog_digest: source.catalog.catalog_digest, records: Object.fromEntries(source.catalog.records.flatMap((record) => record.record_digest === null ? [] : [[record.id, record.record_digest]])) },
			{ available: true, catalog_digest: selected.catalog_digest, generation_id: selected.generation_id, epoch: selected.epoch, records: Object.fromEntries(selected.manifest.runbooks.map((record) => [`${record.service_id}/${record.flow_id}`, record.record_digest])) },
		);
		expect(sync.catalog_status).toBe("in-sync");

		const laterRunbookFile = join(sourceRoot, "later-runbook.json");
		await writeFile(laterRunbookFile, `${JSON.stringify({
			contract: "browser-use.runbook", schema_version: "2", service_id: "fixture", flow_id: "later-read", flow_name: "later-read", version: "1", summary: "Read later state.", allowed_origins: ["https://portal.example.test"], inputs: [], steps: [{ kind: "snapshot", interactive: false }],
		}, null, 2)}\n`);
		expect((await runForTest(["runbook", "apply", "--file", laterRunbookFile, "--json"], authoringRuntime)).exitCode).toBe(0);
		await git(sourceRoot, "add", "skills/browser-use/runbooks/fixture/later-read/runbook.json");
		await git(sourceRoot, "commit", "-qm", "later catalog");
		const later = await loadPrivateRunbookCatalogFromGit({ repoRoot: sourceRoot, promotionVerifier: promotionVerifier(authority.verifier) });
		if (!later.ok) throw new Error(later.message);
		expect(await activateRunbookGeneration(deps, { catalog: later.catalog, reviewedCatalogDigest: later.catalog.catalog_digest, expectedEpoch: 1 })).toMatchObject({
			ok: true,
			changed: true,
			epoch: 2,
			previous_generation_id: selected.generation_id,
		});
	});

	test("ordinary action CLI has no promotion command", async () => {
		const { sourceRoot } = await fixture();
		const result = await runForTest(["action", "promote", "--id", "count-visible-rows", "--json"], makeRuntime({ sourceCheckoutRoot: sourceRoot }));
		expect(result.exitCode).toBe(2);
		expect(result.stdout).not.toContain("reviewed-action-promotion");
	});
});
