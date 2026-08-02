import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, posix, resolve } from "node:path";
import { redactUnsafeText } from "./browser-use-core";
import {
	type BrowserUseRunbook,
	parseRunbookRecord,
	validateRunbook,
} from "./browser-use-runbook-model";
import {
	actionAssetDigest,
	actionDigestIsValid,
	reviewedActionRecordIsValid,
} from "./browser-use-runbook-actions";

const DEFAULT_RUNBOOKS_PATH = "skills/browser-use/runbooks";
const DEFAULT_ACTIONS_PATH = "skills/browser-use/actions";
const SAFE_COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\0)[^\\]+$/;

export type BrowserUsePrivateCatalogFile = { relative_path: string; source_path: string; bytes: string; digest: string };
export type BrowserUsePrivateCatalogRunbook = { id: string; record_digest: string; relative_path: string; runbook: BrowserUseRunbook };
export type BrowserUsePrivateRunbookCatalog = { commit: string; catalog_digest: string; action_registry_digest: string; files: readonly BrowserUsePrivateCatalogFile[]; runbooks: readonly BrowserUsePrivateCatalogRunbook[]; working_tree_drift: readonly string[] };
export type BrowserUsePromotionVerifier = { verify(input: { commit: string; actionId: string; expectedDigest: string; assetBytes: string; record: unknown; promotionHistory: readonly unknown[] }): Promise<{ ok: true } | { ok: false; code: string }> };
export type BrowserUsePrivateCatalogFailure = { ok: false; code: "catalog_source_unavailable" | "catalog_git_unavailable" | "catalog_git_provenance_invalid" | "catalog_git_object_unsupported" | "catalog_git_filter_unsupported" | "catalog_git_drift" | "catalog_record_invalid" | "catalog_action_closure_incomplete" | "promotion_verifier_unavailable" | "promotion_verification_failed"; message: string };
export type BrowserUseGitCommand = (args: readonly string[]) => Promise<{ exitCode: number; stdout: Uint8Array; stderr: string }>;
type GitTreeEntry = { mode: string; type: string; oid: string; path: string };
type RegistryEntry = { asset_path: string; record: Record<string, unknown>; promotion_history: readonly unknown[] };

function sha256(bytes: string | Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function failure(code: BrowserUsePrivateCatalogFailure["code"], message: string): BrowserUsePrivateCatalogFailure { return { ok: false, code, message: redactUnsafeText(message) }; }
function decoder(bytes: Uint8Array): string { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
function sourcePathToGenerationPath(path: string, runbooksPath: string, actionsPath: string): string {
	if (path === runbooksPath || path.startsWith(`${runbooksPath}/`)) return `runbooks/${path.slice(runbooksPath.length + 1)}`;
	return `actions/${path.slice(actionsPath.length + 1)}`;
}
function defaultGitCommand(repoRoot: string): BrowserUseGitCommand {
	return async (args) => {
		const child = Bun.spawn(["git", ...args], { cwd: repoRoot, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
		const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text()]);
		return { exitCode, stdout: new Uint8Array(stdout), stderr };
	};
}
async function gitText(git: BrowserUseGitCommand, args: readonly string[]): Promise<{ ok: true; text: string } | { ok: false }> {
	const result = await git(args); if (result.exitCode !== 0) return { ok: false };
	try { return { ok: true, text: decoder(result.stdout) }; } catch { return { ok: false }; }
}
function parseTree(bytes: Uint8Array): readonly GitTreeEntry[] | undefined {
	let text: string; try { text = decoder(bytes); } catch { return undefined; }
	const entries: GitTreeEntry[] = [];
	for (const row of text.split("\0")) {
		if (row === "") continue;
		const match = /^(\d{6}) ([a-z]+) ([0-9a-f]+)\t(.+)$/.exec(row); if (match === null) return undefined;
		entries.push({ mode: match[1] as string, type: match[2] as string, oid: match[3] as string, path: match[4] as string });
	}
	return entries;
}
function actionRefs(runbook: BrowserUseRunbook): readonly { actionId: string; expectedDigest: string }[] {
	const refs: Array<{ actionId: string; expectedDigest: string }> = [];
	for (const step of runbook.steps) {
		if (step.kind === "action") refs.push({ actionId: step.action_id, expectedDigest: step.expected_digest });
		else if (step.kind === "iterate") refs.push({ actionId: step.step.action_id, expectedDigest: step.step.expected_digest });
	}
	return refs;
}
function parseRegistry(raw: string): readonly RegistryEntry[] | undefined {
	let value: unknown; try { value = JSON.parse(raw); } catch { return undefined; }
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const actions = (value as { actions?: unknown }).actions; if (!Array.isArray(actions)) return undefined;
	const entries: RegistryEntry[] = [];
	for (const action of actions) {
		if (typeof action !== "object" || action === null || Array.isArray(action)) return undefined;
		const assetPath = (action as { asset_path?: unknown }).asset_path;
		const record = (action as { record?: unknown }).record;
		const promotionHistory = (action as { promotion_history?: unknown }).promotion_history;
		if (typeof assetPath !== "string" || !SAFE_RELATIVE_PATH.test(assetPath) || !reviewedActionRecordIsValid(record)) return undefined;
		if (promotionHistory !== undefined && !Array.isArray(promotionHistory)) return undefined;
		entries.push({ asset_path: assetPath, record: record as Record<string, unknown>, promotion_history: promotionHistory ?? [] });
	}
	return entries;
}
async function sourceRootIsAdmitted(repoRoot: string, git: BrowserUseGitCommand): Promise<boolean> {
	if (!isAbsolute(repoRoot)) return false;
	try {
		const [stat, canonical, top] = await Promise.all([lstat(repoRoot), realpath(repoRoot), gitText(git, ["rev-parse", "--show-toplevel"])]);
		if (!stat.isDirectory() || stat.isSymbolicLink() || !top.ok) return false;
		return resolve(top.text.trim()) === resolve(canonical);
	} catch { return false; }
}
async function filtersAreAbsent(git: BrowserUseGitCommand, commit: string, paths: readonly string[]): Promise<boolean> {
	if (paths.length === 0) return true;
	const checked = await gitText(git, ["check-attr", `--source=${commit}`, "filter", "--", ...paths]);
	if (!checked.ok) return false;
	return checked.text.split("\n").filter(Boolean).every((line) => /: filter: (?:unspecified|unset)$/.test(line));
}

export async function loadPrivateRunbookCatalogFromGit(input: { repoRoot: string; commitish?: string; runbooksPath?: string; actionsPath?: string; promotionVerifier?: BrowserUsePromotionVerifier; requirePromotionVerification?: boolean; git?: BrowserUseGitCommand }): Promise<{ ok: true; catalog: BrowserUsePrivateRunbookCatalog } | BrowserUsePrivateCatalogFailure> {
	const runbooksPath = input.runbooksPath ?? DEFAULT_RUNBOOKS_PATH;
	const actionsPath = input.actionsPath ?? DEFAULT_ACTIONS_PATH;
	if (!SAFE_RELATIVE_PATH.test(runbooksPath) || !SAFE_RELATIVE_PATH.test(actionsPath) || runbooksPath === actionsPath) return failure("catalog_source_unavailable", "private catalog source paths are not admitted relative paths.");
	const git = input.git ?? defaultGitCommand(input.repoRoot);
	if (!(await sourceRootIsAdmitted(input.repoRoot, git))) return failure("catalog_source_unavailable", "the invocation is not anchored to the owning source checkout.");
	const commitResult = await gitText(git, ["rev-parse", "--verify", `${input.commitish ?? "HEAD"}^{commit}`]);
	if (!commitResult.ok) return failure("catalog_git_unavailable", "the requested Git commit could not be resolved.");
	const commit = commitResult.text.trim();
	if (!SAFE_COMMIT.test(commit)) return failure("catalog_git_provenance_invalid", "Git did not resolve one full commit object.");
	const treeResult = await git(["ls-tree", "-rz", commit, "--", runbooksPath, actionsPath]);
	if (treeResult.exitCode !== 0) return failure("catalog_git_unavailable", "the commit tree could not be read.");
	const tree = parseTree(treeResult.stdout); if (tree === undefined) return failure("catalog_git_provenance_invalid", "the commit tree listing was malformed.");
	if (tree.some((entry) => entry.type !== "blob" || entry.mode !== "100644")) return failure("catalog_git_object_unsupported", "the catalog closure contains a symlink, submodule, executable, or non-blob object.");
	const runbookEntries = tree.filter((entry) => entry.path.startsWith(`${runbooksPath}/`) && entry.path.endsWith("/runbook.json"));
	const registryPath = `${actionsPath}/registry.json`;
	const registryTreeEntry = tree.find((entry) => entry.path === registryPath);
	const blobBytes = new Map<string, string>();
	for (const entry of [...runbookEntries, ...(registryTreeEntry === undefined ? [] : [registryTreeEntry])]) {
		const blob = await git(["cat-file", "blob", entry.oid]);
		if (blob.exitCode !== 0) return failure("catalog_git_provenance_invalid", "a catalog blob could not be read from the resolved commit.");
		try { blobBytes.set(entry.path, decoder(blob.stdout)); } catch { return failure("catalog_record_invalid", "a catalog record is not valid UTF-8."); }
	}
	const runbooks: BrowserUsePrivateCatalogRunbook[] = [];
	const refs: Array<{ actionId: string; expectedDigest: string }> = [];
	for (const entry of runbookEntries) {
		const raw = blobBytes.get(entry.path) as string; let parsedJson: unknown;
		try { parsedJson = JSON.parse(raw); } catch { return failure("catalog_record_invalid", "a source Runbook is not valid JSON."); }
		const parsed = parseRunbookRecord(parsedJson);
		if (!parsed.ok || validateRunbook(parsed.runbook).length > 0) return failure("catalog_record_invalid", "a source Runbook does not satisfy the model-owned contract.");
		const suffix = entry.path.slice(runbooksPath.length + 1);
		const expectedPath = `${parsed.runbook.service_id}/${parsed.runbook.flow_id}/runbook.json`;
		if (suffix !== expectedPath) return failure("catalog_record_invalid", "a source Runbook identity does not match its commit-tree path.");
		runbooks.push({ id: `${parsed.runbook.service_id}/${parsed.runbook.flow_id}`, record_digest: sha256(raw), relative_path: `runbooks/${suffix}`, runbook: parsed.runbook });
		refs.push(...actionRefs(parsed.runbook));
	}
	if (registryTreeEntry === undefined && refs.length > 0) return failure("catalog_action_closure_incomplete", "an action-bearing catalog has no committed action registry.");
	const registryBytes = registryTreeEntry === undefined ? "{\"actions\":[]}" : (blobBytes.get(registryPath) as string);
	const registry = parseRegistry(registryBytes); if (registry === undefined) return failure("catalog_action_closure_incomplete", "the committed action registry is invalid.");
	const registryById = new Map<string, RegistryEntry>();
	for (const entry of registry) {
		const actionId = entry.record.action_id;
		if (typeof actionId !== "string" || registryById.has(actionId)) return failure("catalog_action_closure_incomplete", "the committed action registry has an invalid or duplicate action id.");
		registryById.set(actionId, entry);
	}
	const closureEntries = new Map<string, GitTreeEntry>();
	for (const entry of runbookEntries) closureEntries.set(entry.path, entry);
	if (registryTreeEntry !== undefined) closureEntries.set(registryTreeEntry.path, registryTreeEntry);
	for (const ref of refs) {
		if (!actionDigestIsValid(ref.expectedDigest)) return failure("catalog_action_closure_incomplete", "a Runbook action reference does not carry an exact digest.");
		const registryEntry = registryById.get(ref.actionId);
		if (registryEntry === undefined) return failure("catalog_action_closure_incomplete", "a referenced action is absent from the committed registry.");
		const sourcePath = posix.join(actionsPath, registryEntry.asset_path);
		const treeEntry = tree.find((entry) => entry.path === sourcePath);
		if (treeEntry === undefined || treeEntry.type !== "blob" || treeEntry.mode !== "100644") return failure("catalog_action_closure_incomplete", "a referenced action asset is absent or unsupported in the commit tree.");
		let assetBytes: string; const existing = blobBytes.get(sourcePath);
		if (existing !== undefined) assetBytes = existing;
		else {
			const blob = await git(["cat-file", "blob", treeEntry.oid]);
			if (blob.exitCode !== 0) return failure("catalog_git_provenance_invalid", "a referenced action blob could not be read.");
			try { assetBytes = decoder(blob.stdout); } catch { return failure("catalog_action_closure_incomplete", "a referenced action asset is not valid UTF-8."); }
			blobBytes.set(sourcePath, assetBytes);
		}
		if (actionAssetDigest(assetBytes) !== ref.expectedDigest || registryEntry.record.expected_digest !== ref.expectedDigest) return failure("catalog_action_closure_incomplete", "a referenced action digest does not match the committed asset and registry.");
		if (input.promotionVerifier === undefined && input.requirePromotionVerification !== false) return failure("promotion_verifier_unavailable", "action-bearing activation requires verifier-backed promotion authority.");
		const verified = await input.promotionVerifier?.verify({ commit, actionId: ref.actionId, expectedDigest: ref.expectedDigest, assetBytes, record: registryEntry.record, promotionHistory: registryEntry.promotion_history });
		if (verified !== undefined && !verified.ok) return failure("promotion_verification_failed", "a referenced action lacks valid external-human promotion authority.");
		closureEntries.set(sourcePath, treeEntry);
	}
	const closurePaths = [...closureEntries.keys()].sort();
	if (!(await filtersAreAbsent(git, commit, closurePaths))) return failure("catalog_git_filter_unsupported", "the catalog closure uses a Git content filter or its filter state cannot be proven absent.");
	const status = await gitText(git, ["status", "--porcelain=v1", "--untracked-files=all", "--", ...closurePaths]);
	if (!status.ok) return failure("catalog_git_unavailable", "closure-local working-tree drift could not be inspected.");
	const drift = status.text.split("\n").filter(Boolean).sort();
	if (drift.length > 0) return failure("catalog_git_drift", "catalog closure paths differ from the resolved commit; review the source closure again.");
	const files: BrowserUsePrivateCatalogFile[] = [];
	for (const path of closurePaths) {
		const bytes = blobBytes.get(path); if (bytes === undefined) return failure("catalog_git_provenance_invalid", "a closure blob vanished before catalog assembly.");
		files.push({ relative_path: sourcePathToGenerationPath(path, runbooksPath, actionsPath), source_path: path, bytes, digest: sha256(bytes) });
	}
	if (registryTreeEntry === undefined) files.push({ relative_path: "actions/registry.json", source_path: registryPath, bytes: registryBytes, digest: sha256(registryBytes) });
	files.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
	const digestInput = files.map((file) => `${file.relative_path}\0${file.digest}\0`).join("");
	return { ok: true, catalog: { commit, catalog_digest: sha256(digestInput), action_registry_digest: sha256(registryBytes), files, runbooks: runbooks.sort((left, right) => left.id.localeCompare(right.id)), working_tree_drift: drift } };
}
