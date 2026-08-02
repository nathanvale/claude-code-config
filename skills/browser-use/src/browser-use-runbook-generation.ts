import { createHash } from "node:crypto";
import { dirname, join, posix } from "node:path";
import { redactUnsafeText } from "./browser-use-core";
import type { BrowserUseAdmittedPaths, BrowserUsePlatformFs } from "./browser-use-paths";
import type { BrowserUseActiveGenerationSeam } from "./browser-use-runbook";
import type {
	BrowserUseActionGenerationSeam,
	BrowserUseReviewedActionRecord,
	BrowserUseRunExecutionBinding,
} from "./browser-use-runbook-actions";
import { reviewedActionRecordIsValid } from "./browser-use-runbook-actions";
import type { BrowserUseReviewedActionApprovalVerifier } from "./browser-use-reviewed-action-approval";
import {
	type BrowserUseAuthoredReviewedActionRecord,
	verifyAuthoredReviewedActionPromotion,
} from "./browser-use-reviewed-action-authoring";
import { parseRunbookRecord, projectRunbookCatalogRow, validateRunbook } from "./browser-use-runbook-model";
import { withExclusiveFileLock } from "./browser-use-store";

const GENERATION_CONTRACT = "browser-use.runbook-generation";
const AUTHORITY_CONTRACT = "browser-use.runbook-generation-authority";
const CUTOVER_CONTRACT = "browser-use.runbook-generation-cutover";
const SCHEMA_VERSION = "1";
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const SAFE_DIGEST = /^[0-9a-f]{64}$/;
const SAFE_RELATIVE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\0)[a-zA-Z0-9._/-]+$/;

export type BrowserUseGenerationCatalog = {
	commit: string;
	catalog_digest: string;
	action_registry_digest: string;
	files: readonly { relative_path: string; bytes: string; digest: string }[];
};
export type BrowserUseGenerationCrashBoundary = "before_stage" | "after_stage" | "after_verification" | "before_authority_commit" | "after_authority_commit";
export type BrowserUseGenerationDeps = {
	fs: BrowserUsePlatformFs;
	paths: BrowserUseAdmittedPaths;
	clock: () => number;
	crash?: (boundary: BrowserUseGenerationCrashBoundary) => boolean;
	legacyFallback?: () => Promise<unknown | undefined>;
	nonterminalMutationRuns?: (activeGenerationId: string | null) => Promise<readonly string[]>;
};
export type BrowserUseRunbookGenerationManifest = {
	contract: typeof GENERATION_CONTRACT;
	schema_version: typeof SCHEMA_VERSION;
	generation_id: string;
	source_commit: string;
	catalog_digest: string;
	action_registry_digest: string;
	files: readonly { relative_path: string; digest: string }[];
	runbooks: readonly { service_id: string; flow_id: string; relative_path: string; record_digest: string }[];
};
export type BrowserUseRunbookGenerationAuthority = {
	contract: typeof AUTHORITY_CONTRACT;
	schema_version: typeof SCHEMA_VERSION;
	active_generation_id: string;
	previous_generation_id: string | null;
	catalog_digest: string;
	manifest_digest: string;
	epoch: number;
	selected_at_epoch_ms: number;
};
export type BrowserUseGenerationFailure = {
	ok: false;
	code: "catalog_drift" | "activation_epoch_conflict" | "activation_blocked_by_run" | "activation_store_unsafe" | "activation_generation_corrupt" | "activation_authority_corrupt" | "activation_interrupted" | "activation_required" | "pre_cutover_unavailable";
	message: string;
};
export type BrowserUseGenerationActivationSuccess = { ok: true; changed: boolean; generation_id: string; previous_generation_id: string | null; catalog_digest: string; epoch: number };
export type BrowserUseSelectedGeneration = {
	ok: true;
	generation_id: string;
	previous_generation_id: string | null;
	catalog_digest: string;
	action_registry_digest: string;
	manifest_digest: string;
	epoch: number;
	manifest: BrowserUseRunbookGenerationManifest;
};

function sha256(bytes: string): string { return createHash("sha256").update(bytes).digest("hex"); }
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (typeof value === "object" && value !== null) return `{${Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
	return JSON.stringify(value);
}
function fail(code: BrowserUseGenerationFailure["code"], message: string): BrowserUseGenerationFailure { return { ok: false, code, message: redactUnsafeText(message) }; }
function pathsOf(paths: BrowserUseAdmittedPaths) {
	return {
		root: dirname(paths.data.runbookGenerationsDir),
		generations: paths.data.runbookGenerationsDir,
		authority: paths.data.runbookGenerationAuthorityFile,
		cutover: paths.data.runbookGenerationCutoverFile,
		lock: join(paths.runtime.locksDir, "runbook-generation-activation.lock"),
	};
}
export function runbookGenerationAuthorityPath(paths: BrowserUseAdmittedPaths): string { return pathsOf(paths).authority; }
export function runbookGenerationDirectory(paths: BrowserUseAdmittedPaths, generationId: string): string {
	if (!/^gen-[0-9a-f]{64}$/.test(generationId)) throw new TypeError("invalid generation id");
	return join(pathsOf(paths).generations, generationId);
}
function catalogDigest(files: BrowserUseGenerationCatalog["files"]): string {
	return sha256([...files].sort((a, b) => a.relative_path.localeCompare(b.relative_path)).map((file) => `${file.relative_path}\0${file.digest}\0`).join(""));
}
type GenerationRegistryEntry = { asset_path: string; record: BrowserUseReviewedActionRecord; promotion_history: readonly unknown[] };
function registryEntries(value: unknown): readonly GenerationRegistryEntry[] | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value) || !Array.isArray((value as { actions?: unknown }).actions)) return undefined;
	const result: GenerationRegistryEntry[] = [];
	for (const entry of (value as { actions: unknown[] }).actions) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return undefined;
		const assetPath = (entry as { asset_path?: unknown }).asset_path;
		const record = (entry as { record?: unknown }).record;
		const promotionHistory = (entry as { promotion_history?: unknown }).promotion_history;
		if (typeof assetPath !== "string" || !SAFE_RELATIVE.test(assetPath) || !reviewedActionRecordIsValid(record)) return undefined;
		if (promotionHistory !== undefined && !Array.isArray(promotionHistory)) return undefined;
		result.push({ asset_path: assetPath, record, promotion_history: promotionHistory ?? [] });
	}
	return result;
}
function catalogIsComplete(catalog: BrowserUseGenerationCatalog): boolean {
	if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(catalog.commit) || !SAFE_DIGEST.test(catalog.catalog_digest) || !SAFE_DIGEST.test(catalog.action_registry_digest)) return false;
	const paths = new Set<string>();
	for (const file of catalog.files) {
		if (!SAFE_RELATIVE.test(file.relative_path) || paths.has(file.relative_path) || sha256(file.bytes) !== file.digest) return false;
		paths.add(file.relative_path);
	}
	const registry = catalog.files.find((file) => file.relative_path === "actions/registry.json");
	if (registry === undefined || registry.digest !== catalog.action_registry_digest) return false;
	try { if (registryEntries(JSON.parse(registry.bytes)) === undefined) return false; } catch { return false; }
	return catalogDigest(catalog.files) === catalog.catalog_digest;
}
async function ensurePrivateDirectory(fs: BrowserUsePlatformFs, path: string): Promise<boolean> {
	try {
		if ((await fs.lstat(path)) === undefined) await fs.mkdir(path, { recursive: true, mode: PRIVATE_DIR_MODE });
		const stat = await fs.lstat(path); const uid = process.getuid?.();
		return stat?.kind === "directory" && (stat.mode & 0o077) === 0 && (uid === undefined || stat.uid === uid);
	} catch { return false; }
}
async function ensureStore(deps: BrowserUseGenerationDeps): Promise<boolean> {
	const paths = pathsOf(deps.paths);
	for (const directory of [paths.root, paths.generations, deps.paths.runtime.locksDir]) if (!(await ensurePrivateDirectory(deps.fs, directory))) return false;
	return true;
}
async function readJson(fs: BrowserUsePlatformFs, path: string): Promise<unknown | undefined> { try { return JSON.parse(await fs.readTextFile(path)); } catch { return undefined; } }
function parseAuthority(value: unknown): BrowserUseRunbookGenerationAuthority | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const r = value as Record<string, unknown>;
	if (r.contract !== AUTHORITY_CONTRACT || r.schema_version !== SCHEMA_VERSION || typeof r.active_generation_id !== "string" || !/^gen-[0-9a-f]{64}$/.test(r.active_generation_id) || !(r.previous_generation_id === null || (typeof r.previous_generation_id === "string" && /^gen-[0-9a-f]{64}$/.test(r.previous_generation_id))) || typeof r.catalog_digest !== "string" || !SAFE_DIGEST.test(r.catalog_digest) || typeof r.manifest_digest !== "string" || !SAFE_DIGEST.test(r.manifest_digest) || typeof r.epoch !== "number" || !Number.isSafeInteger(r.epoch) || r.epoch < 1 || typeof r.selected_at_epoch_ms !== "number") return undefined;
	return r as BrowserUseRunbookGenerationAuthority;
}
function parseManifest(value: unknown): BrowserUseRunbookGenerationManifest | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const r = value as Record<string, unknown>;
	if (r.contract !== GENERATION_CONTRACT || r.schema_version !== SCHEMA_VERSION || typeof r.generation_id !== "string" || !/^gen-[0-9a-f]{64}$/.test(r.generation_id) || typeof r.source_commit !== "string" || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(r.source_commit) || typeof r.catalog_digest !== "string" || !SAFE_DIGEST.test(r.catalog_digest) || typeof r.action_registry_digest !== "string" || !SAFE_DIGEST.test(r.action_registry_digest) || !Array.isArray(r.files) || !Array.isArray(r.runbooks)) return undefined;
	for (const file of r.files) if (typeof file !== "object" || file === null || Array.isArray(file) || typeof (file as { relative_path?: unknown }).relative_path !== "string" || !SAFE_RELATIVE.test((file as { relative_path: string }).relative_path) || typeof (file as { digest?: unknown }).digest !== "string" || !SAFE_DIGEST.test((file as { digest: string }).digest)) return undefined;
	for (const runbook of r.runbooks) if (typeof runbook !== "object" || runbook === null || Array.isArray(runbook) || typeof (runbook as { service_id?: unknown }).service_id !== "string" || typeof (runbook as { flow_id?: unknown }).flow_id !== "string" || typeof (runbook as { relative_path?: unknown }).relative_path !== "string" || !SAFE_RELATIVE.test((runbook as { relative_path: string }).relative_path) || typeof (runbook as { record_digest?: unknown }).record_digest !== "string" || !SAFE_DIGEST.test((runbook as { record_digest: string }).record_digest)) return undefined;
	return r as BrowserUseRunbookGenerationManifest;
}
async function walkFiles(fs: BrowserUsePlatformFs, root: string): Promise<readonly string[] | undefined> {
	const files: string[] = [];
	async function walk(directory: string, prefix: string): Promise<boolean> {
		const stat = await fs.lstat(directory); const uid = process.getuid?.();
		if (stat?.kind !== "directory" || (stat.mode & 0o077) !== 0 || (uid !== undefined && stat.uid !== uid)) return false;
		for (const entry of [...(await fs.readDirectory(directory))].sort()) {
			const path = join(directory, entry); const relative = prefix === "" ? entry : `${prefix}/${entry}`; const child = await fs.lstat(path);
			if (child?.kind === "directory") { if (!(await walk(path, relative))) return false; }
			else if (child?.kind !== "file" || (child.mode & 0o077) !== 0 || (uid !== undefined && child.uid !== uid)) return false;
			else files.push(relative);
		}
		return true;
	}
	return (await walk(root, "")) ? files : undefined;
}
async function validateGeneration(deps: BrowserUseGenerationDeps, generationId: string, expectedManifestDigest?: string): Promise<{ ok: true; manifest: BrowserUseRunbookGenerationManifest; manifestDigest: string } | BrowserUseGenerationFailure> {
	const root = runbookGenerationDirectory(deps.paths, generationId);
	const files = await walkFiles(deps.fs, root);
	if (files === undefined) return fail("activation_generation_corrupt", "the selected generation tree is missing or unsafe.");
	let bytes: string; try { bytes = await deps.fs.readTextFile(join(root, "manifest.json")); } catch { return fail("activation_generation_corrupt", "the selected generation manifest is unreadable."); }
	const manifestDigest = sha256(bytes);
	if (expectedManifestDigest !== undefined && manifestDigest !== expectedManifestDigest) return fail("activation_generation_corrupt", "the selected generation manifest digest drifted.");
	let value: unknown; try { value = JSON.parse(bytes); } catch { return fail("activation_generation_corrupt", "the selected generation manifest is invalid JSON."); }
	const manifest = parseManifest(value);
	if (manifest === undefined || manifest.generation_id !== generationId || `gen-${manifest.catalog_digest}` !== generationId || catalogDigest(manifest.files.map((file) => ({ ...file, bytes: "" }))) !== manifest.catalog_digest) return fail("activation_generation_corrupt", "the selected generation manifest is invalid.");
	const expected = [...manifest.files.map((file) => file.relative_path), "manifest.json"].sort();
	if (JSON.stringify(files) !== JSON.stringify(expected)) return fail("activation_generation_corrupt", "the selected generation contains missing or unmanifested files.");
	for (const file of manifest.files) try { if ((await deps.fs.hashFile(join(root, ...file.relative_path.split("/")))) !== file.digest) return fail("activation_generation_corrupt", "a selected generation component digest drifted."); } catch { return fail("activation_generation_corrupt", "a selected generation component is unreadable."); }
	return { ok: true, manifest, manifestDigest };
}
function manifestFor(catalog: BrowserUseGenerationCatalog): BrowserUseRunbookGenerationManifest {
	const runbooks: Array<BrowserUseRunbookGenerationManifest["runbooks"][number]> = [];
	for (const file of catalog.files) {
		if (!file.relative_path.startsWith("runbooks/") || !file.relative_path.endsWith("/runbook.json")) continue;
		try {
			const parsed = parseRunbookRecord(JSON.parse(file.bytes));
			if (!parsed.ok || validateRunbook(parsed.runbook).length > 0 || file.relative_path !== `runbooks/${parsed.runbook.service_id}/${parsed.runbook.flow_id}/runbook.json`) continue;
			runbooks.push({ service_id: parsed.runbook.service_id, flow_id: parsed.runbook.flow_id, relative_path: file.relative_path, record_digest: file.digest });
		} catch { }
	}
	return { contract: GENERATION_CONTRACT, schema_version: SCHEMA_VERSION, generation_id: `gen-${catalog.catalog_digest}`, source_commit: catalog.commit, catalog_digest: catalog.catalog_digest, action_registry_digest: catalog.action_registry_digest, files: catalog.files.map(({ relative_path, digest }) => ({ relative_path, digest })).sort((a, b) => a.relative_path.localeCompare(b.relative_path)), runbooks: runbooks.sort((a, b) => `${a.service_id}/${a.flow_id}`.localeCompare(`${b.service_id}/${b.flow_id}`)) };
}
async function stageGeneration(deps: BrowserUseGenerationDeps, catalog: BrowserUseGenerationCatalog): Promise<{ ok: true; generationId: string; manifestDigest: string } | BrowserUseGenerationFailure> {
	const generationId = `gen-${catalog.catalog_digest}`; const destination = runbookGenerationDirectory(deps.paths, generationId);
	if ((await deps.fs.lstat(destination)) !== undefined) { const verified = await validateGeneration(deps, generationId); return verified.ok ? { ok: true, generationId, manifestDigest: verified.manifestDigest } : verified; }
	const stageRoot = join(pathsOf(deps.paths).generations, `.stage-${catalog.catalog_digest}-${process.pid}`);
	if ((await deps.fs.lstat(stageRoot)) !== undefined) return fail("activation_store_unsafe", "the generation staging path already exists; repair the orphan before retrying.");
	try {
		await deps.fs.mkdir(stageRoot, { recursive: false, mode: PRIVATE_DIR_MODE }); const directories = new Set([stageRoot]);
		for (const file of [...catalog.files].sort((a, b) => a.relative_path.localeCompare(b.relative_path))) {
			if (!SAFE_RELATIVE.test(file.relative_path) || sha256(file.bytes) !== file.digest) return fail("activation_generation_corrupt", "the proved catalog closure changed before staging.");
			const path = join(stageRoot, ...file.relative_path.split("/")); const directory = dirname(path);
			if (!directories.has(directory)) { await deps.fs.mkdir(directory, { recursive: true, mode: PRIVATE_DIR_MODE }); directories.add(directory); }
			await deps.fs.createExclusive(path, file.bytes, PRIVATE_FILE_MODE);
		}
		const manifest = manifestFor(catalog);
		if (manifest.runbooks.length !== catalog.files.filter((file) => file.relative_path.startsWith("runbooks/") && file.relative_path.endsWith("/runbook.json")).length) return fail("activation_generation_corrupt", "a source Runbook became invalid before generation staging.");
		const manifestBytes = canonical(manifest); await deps.fs.createExclusive(join(stageRoot, "manifest.json"), manifestBytes, PRIVATE_FILE_MODE);
		for (const directory of [...directories].sort((a, b) => b.length - a.length)) await deps.fs.syncDirectory(directory);
		await deps.fs.rename(stageRoot, destination); await deps.fs.syncDirectory(pathsOf(deps.paths).generations);
		return { ok: true, generationId, manifestDigest: sha256(manifestBytes) };
	} catch { return fail("activation_store_unsafe", "generation staging failed before selection."); }
}
async function readAuthority(deps: BrowserUseGenerationDeps): Promise<{ status: "missing" } | { status: "corrupt" } | { status: "present"; authority: BrowserUseRunbookGenerationAuthority }> {
	const path = pathsOf(deps.paths).authority; const stat = await deps.fs.lstat(path);
	if (stat === undefined) return { status: "missing" };
	if (stat.kind !== "file" || (stat.mode & 0o077) !== 0) return { status: "corrupt" };
	const authority = parseAuthority(await readJson(deps.fs, path)); return authority === undefined ? { status: "corrupt" } : { status: "present", authority };
}
async function commitAuthority(deps: BrowserUseGenerationDeps, authority: BrowserUseRunbookGenerationAuthority): Promise<boolean> {
	const paths = pathsOf(deps.paths); const temp = `${paths.authority}.next-${process.pid}-${authority.epoch}`;
	try { await deps.fs.createExclusive(temp, canonical(authority), PRIVATE_FILE_MODE); await deps.fs.rename(temp, paths.authority); await deps.fs.syncDirectory(paths.root); return true; } catch { try { await deps.fs.unlink(temp); } catch {} return false; }
}
export async function activateRunbookGeneration(deps: BrowserUseGenerationDeps, input: { catalog: BrowserUseGenerationCatalog; reviewedCatalogDigest: string; expectedEpoch: number }): Promise<BrowserUseGenerationActivationSuccess | BrowserUseGenerationFailure> {
	if (input.reviewedCatalogDigest !== input.catalog.catalog_digest || !catalogIsComplete(input.catalog) || !Number.isSafeInteger(input.expectedEpoch) || input.expectedEpoch < 0) return fail("catalog_drift", "the reviewed whole-catalog digest does not match the proved commit closure.");
	if (!(await ensureStore(deps))) return fail("activation_store_unsafe", "the Runbook Generation XDG store is not a private admitted directory.");
	const outcome = await withExclusiveFileLock<BrowserUseGenerationActivationSuccess | BrowserUseGenerationFailure>(deps.fs, { lockPath: pathsOf(deps.paths).lock, holderId: `runbook-activate-${process.pid}-${input.catalog.catalog_digest.slice(0, 12)}`, staleAfterMs: 30_000, clock: deps.clock }, async () => {
		const current = await readAuthority(deps); if (current.status === "corrupt") return fail("activation_authority_corrupt", "the active generation authority is corrupt; no selection changed.");
		const authority = current.status === "present" ? current.authority : undefined; const epoch = authority?.epoch ?? 0;
		if (epoch !== input.expectedEpoch) return fail("activation_epoch_conflict", "the activation epoch changed; inspect active authority and retry from the new epoch.");
		if (authority?.catalog_digest === input.catalog.catalog_digest) { const verified = await validateGeneration(deps, authority.active_generation_id, authority.manifest_digest); return verified.ok ? { ok: true, changed: false, generation_id: authority.active_generation_id, previous_generation_id: authority.previous_generation_id, catalog_digest: authority.catalog_digest, epoch: authority.epoch } : verified; }
		const blockers = await deps.nonterminalMutationRuns?.(authority?.active_generation_id ?? null); if (blockers !== undefined && blockers.length > 0) return fail("activation_blocked_by_run", "a prior-generation mutation-capable run is nonterminal; finish or cancel it before activation.");
		if (deps.crash?.("before_stage")) return fail("activation_interrupted", "activation interrupted before generation staging.");
		const staged = await stageGeneration(deps, input.catalog); if (!staged.ok) return staged;
		if (deps.crash?.("after_stage")) return fail("activation_interrupted", "activation interrupted after staging; prior authority remains selected.");
		const verified = await validateGeneration(deps, staged.generationId, staged.manifestDigest); if (!verified.ok) return verified;
		if (deps.crash?.("after_verification") || deps.crash?.("before_authority_commit")) return fail("activation_interrupted", "activation interrupted before authority commit; prior authority remains selected.");
		const next: BrowserUseRunbookGenerationAuthority = { contract: AUTHORITY_CONTRACT, schema_version: SCHEMA_VERSION, active_generation_id: staged.generationId, previous_generation_id: authority?.active_generation_id ?? null, catalog_digest: input.catalog.catalog_digest, manifest_digest: staged.manifestDigest, epoch: epoch + 1, selected_at_epoch_ms: deps.clock() };
		if (!(await commitAuthority(deps, next))) return fail("activation_store_unsafe", "the active generation authority could not be atomically committed.");
		return { ok: true, changed: true, generation_id: next.active_generation_id, previous_generation_id: next.previous_generation_id, catalog_digest: next.catalog_digest, epoch: next.epoch };
	});
	return "failure" in outcome ? fail("activation_store_unsafe", `the activation lock was unavailable (${outcome.failure.code}).`) : outcome;
}
export async function commitRunbookGenerationCutover(deps: BrowserUseGenerationDeps): Promise<{ ok: true } | BrowserUseGenerationFailure> {
	if (!(await ensureStore(deps))) return fail("activation_store_unsafe", "the Runbook Generation XDG store is unavailable.");
	const selected = await resolveSelectedRunbookGeneration({ ...deps, legacyFallback: undefined }); if (!selected.ok) return selected;
	const paths = pathsOf(deps.paths); const stat = await deps.fs.lstat(paths.cutover); const existing = await readJson(deps.fs, paths.cutover);
	if (typeof existing === "object" && existing !== null && (existing as { contract?: unknown }).contract === CUTOVER_CONTRACT) return { ok: true };
	if (stat !== undefined) return fail("activation_store_unsafe", "the cutover marker exists but is corrupt; repair it without enabling fallback.");
	const temp = `${paths.cutover}.next-${process.pid}`;
	try { await deps.fs.createExclusive(temp, canonical({ contract: CUTOVER_CONTRACT, schema_version: SCHEMA_VERSION, generation_id: selected.generation_id, epoch: selected.epoch }), PRIVATE_FILE_MODE); await deps.fs.rename(temp, paths.cutover); await deps.fs.syncDirectory(paths.root); return { ok: true }; } catch { return fail("activation_store_unsafe", "cutover marker commit failed."); }
}
export async function resolveSelectedRunbookGeneration(deps: BrowserUseGenerationDeps): Promise<BrowserUseSelectedGeneration | BrowserUseGenerationFailure> {
	const paths = pathsOf(deps.paths); const cutoverStat = await deps.fs.lstat(paths.cutover); const cutover = await readJson(deps.fs, paths.cutover); const cutoverActive = cutoverStat !== undefined;
	if (cutoverActive && !(typeof cutover === "object" && cutover !== null && (cutover as { contract?: unknown }).contract === CUTOVER_CONTRACT)) return fail("activation_required", "the Runbook Generation cutover marker is corrupt; no fallback was read.");
	const authority = await readAuthority(deps);
	if (authority.status === "corrupt") return cutoverActive ? fail("activation_required", "active Runbook Generation authority is corrupt after cutover; no fallback was read.") : fail("activation_authority_corrupt", "active Runbook Generation authority is corrupt; no fallback was read.");
	if (authority.status === "missing") { if (cutoverActive) return fail("activation_required", "active Runbook Generation authority is missing after cutover; activate from the setup-owned source checkout."); await deps.legacyFallback?.(); return fail("pre_cutover_unavailable", "no selected Runbook Generation exists before bootstrap cutover."); }
	const verified = await validateGeneration(deps, authority.authority.active_generation_id, authority.authority.manifest_digest);
	if (!verified.ok) { if (cutoverActive) return fail("activation_required", "the active Runbook Generation is corrupt after cutover; no fallback was read."); await deps.legacyFallback?.(); return verified; }
	if (verified.manifest.catalog_digest !== authority.authority.catalog_digest) return cutoverActive ? fail("activation_required", "active generation provenance drifted after cutover; no fallback was read.") : fail("activation_authority_corrupt", "active generation provenance does not match its authority.");
	return { ok: true, generation_id: authority.authority.active_generation_id, previous_generation_id: authority.authority.previous_generation_id, catalog_digest: authority.authority.catalog_digest, action_registry_digest: verified.manifest.action_registry_digest, manifest_digest: verified.manifestDigest, epoch: authority.authority.epoch, manifest: verified.manifest };
}
export async function resolveRetainedRunbookGeneration(deps: BrowserUseGenerationDeps, binding: BrowserUseRunExecutionBinding): Promise<BrowserUseSelectedGeneration | BrowserUseGenerationFailure> {
	const verified = await validateGeneration(deps, binding.generation_id); if (!verified.ok) return verified;
	const runbook = verified.manifest.runbooks.find((record) => record.service_id === binding.service_id && record.flow_id === binding.flow_id);
	if (runbook === undefined || runbook.record_digest !== binding.runbook_digest || verified.manifest.action_registry_digest !== binding.action_registry_digest) return fail("activation_generation_corrupt", "the retained generation no longer satisfies the run's pinned authority.");
	return { ok: true, generation_id: binding.generation_id, previous_generation_id: null, catalog_digest: verified.manifest.catalog_digest, action_registry_digest: verified.manifest.action_registry_digest, manifest_digest: verified.manifestDigest, epoch: binding.activation_epoch, manifest: verified.manifest };
}
export async function withRunbookGenerationSelectionBarrier<T extends { ok: boolean }>(deps: BrowserUseGenerationDeps, selected: BrowserUseSelectedGeneration, body: () => Promise<T>): Promise<T | BrowserUseGenerationFailure> {
	if (!(await ensureStore(deps))) return fail("activation_store_unsafe", "the Runbook Generation store is unavailable.");
	const outcome = await withExclusiveFileLock<T | BrowserUseGenerationFailure>(deps.fs, { lockPath: pathsOf(deps.paths).lock, holderId: `runbook-bind-${process.pid}-${selected.epoch}`, staleAfterMs: 30_000, clock: deps.clock }, async () => {
		const authority = await readAuthority(deps);
		if (authority.status !== "present" || authority.authority.active_generation_id !== selected.generation_id || authority.authority.epoch !== selected.epoch || authority.authority.manifest_digest !== selected.manifest_digest) return fail("activation_epoch_conflict", "active generation changed during fresh-run preparation; retry wholly against the current generation.");
		const verified = await validateGeneration(deps, selected.generation_id, selected.manifest_digest); return verified.ok ? await body() : verified;
	});
	return "failure" in outcome ? fail("activation_store_unsafe", "the generation selection barrier is unavailable.") : outcome;
}
export function createSelectedGenerationRunbookSeam(deps: BrowserUseGenerationDeps, selected: BrowserUseSelectedGeneration): BrowserUseActiveGenerationSeam {
	const root = runbookGenerationDirectory(deps.paths, selected.generation_id); const byId = new Map(selected.manifest.runbooks.map((record) => [`${record.service_id}/${record.flow_id}`, record]));
	return { fallback: "forbid", async listIds() { return selected.manifest.runbooks.map((record) => ({ serviceId: record.service_id, flowId: record.flow_id })); }, async loadRunbook(id) {
		const record = byId.get(`${id.serviceId}/${id.flowId}`); if (record === undefined) return { ok: false, absent: true };
		try { const raw = await deps.fs.readTextFile(join(root, ...record.relative_path.split("/"))); if (sha256(raw) !== record.record_digest) return { ok: false, absent: false, failure: { code: "runbook_record_corrupt", message: "active generation Runbook digest drifted." } }; const parsed = parseRunbookRecord(JSON.parse(raw)); if (!parsed.ok || validateRunbook(parsed.runbook).length > 0) return { ok: false, absent: false, failure: { code: "runbook_record_invalid", message: "active generation Runbook is invalid." } }; return { ok: true, runbook: parsed.runbook, health: projectRunbookCatalogRow(parsed.runbook, "healthy").health }; } catch { return { ok: false, absent: false, failure: { code: "runbook_record_corrupt", message: "active generation Runbook is unreadable." } }; }
	} };
}
export function createSelectedGenerationActionSeam(deps: BrowserUseGenerationDeps, selected: BrowserUseSelectedGeneration, approvalVerifier?: BrowserUseReviewedActionApprovalVerifier): BrowserUseActionGenerationSeam {
	const root = runbookGenerationDirectory(deps.paths, selected.generation_id); let registry: Promise<readonly GenerationRegistryEntry[] | undefined> | undefined;
	const load = () => registry ??= (async () => { try { const raw = await deps.fs.readTextFile(join(root, "actions", "registry.json")); return sha256(raw) === selected.action_registry_digest ? registryEntries(JSON.parse(raw)) : undefined; } catch { return undefined; } })();
	return { async loadActionRecord(actionId) { const entry = (await load())?.find((candidate) => candidate.record.action_id === actionId); return entry === undefined ? { ok: false, absent: true } : { ok: true, record: entry.record }; }, async loadActionAssetBytes(assetId) { const entry = (await load())?.find((candidate) => candidate.record.asset_id === assetId); if (entry === undefined) return { ok: false, reason: "bytes_unavailable" }; try { const relative = posix.join("actions", entry.asset_path); const file = selected.manifest.files.find((candidate) => candidate.relative_path === relative); if (file === undefined) return { ok: false, reason: "bytes_unavailable" }; const bytes = await deps.fs.readTextFile(join(root, ...relative.split("/"))); return sha256(bytes) === file.digest ? { ok: true, bytes } : { ok: false, reason: "bytes_unavailable" }; } catch { return { ok: false, reason: "bytes_unavailable" }; } }, ...(approvalVerifier === undefined ? {} : { async verifyPromotion(input: { actionId: string; record: BrowserUseReviewedActionRecord; assetBytes: string }) { const entry = (await load())?.find((candidate) => candidate.record.action_id === input.actionId); if (entry === undefined) return { ok: false as const, code: "action_registry_record_missing" }; const verified = verifyAuthoredReviewedActionPromotion({ commit: selected.manifest.source_commit, record: input.record as BrowserUseAuthoredReviewedActionRecord, assetBytes: input.assetBytes, promotionHistory: entry.promotion_history, verifier: approvalVerifier }); return verified.ok ? { ok: true as const } : verified; } }) };
}
export type BrowserUseCatalogSynchronization = "in-sync" | "activation-required" | "source-unavailable";
export type BrowserUseRecordSynchronization = "in-sync" | "new-pending-activation" | "deletion-pending-activation";
export function projectRunbookGenerationSynchronization(source: { available: false } | { available: true; catalog_digest: string; records: Readonly<Record<string, string>> }, active: { available: false } | { available: true; catalog_digest: string; generation_id: string; epoch: number; records: Readonly<Record<string, string>> }) {
	if (!source.available) return { catalog_status: "source-unavailable" as const, source_catalog_digest: null, active_catalog_digest: active.available ? active.catalog_digest : null, active_generation_id: active.available ? active.generation_id : null, active_epoch: active.available ? active.epoch : null, records: active.available ? Object.entries(active.records).sort(([a], [b]) => a.localeCompare(b)).map(([id, record_digest]) => ({ id, record_digest, status: "in-sync" as const })) : [] };
	const records = new Map<string, { id: string; record_digest: string; status: BrowserUseRecordSynchronization }>();
	for (const [id, digest] of Object.entries(source.records)) records.set(id, { id, record_digest: digest, status: active.available && active.records[id] === digest ? "in-sync" : "new-pending-activation" });
	if (active.available) for (const [id, digest] of Object.entries(active.records)) if (!records.has(id)) records.set(id, { id, record_digest: digest, status: "deletion-pending-activation" });
	return { catalog_status: active.available && active.catalog_digest === source.catalog_digest ? "in-sync" as const : "activation-required" as const, source_catalog_digest: source.catalog_digest, active_catalog_digest: active.available ? active.catalog_digest : null, active_generation_id: active.available ? active.generation_id : null, active_epoch: active.available ? active.epoch : null, records: [...records.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}
