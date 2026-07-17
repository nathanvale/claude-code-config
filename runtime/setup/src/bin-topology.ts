import { lstat, readdir, readFile, readlink, realpath, rm, symlink } from "node:fs/promises";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";

import type { SetupDomainResult, SetupFinding } from "./model.ts";
import { canonicalPath, isInsideOrEqual, unsafeExistingParent } from "./path-safety.ts";

/** Workspace roots enumerated for PATH-bin declarations. */
export const BIN_PACKAGE_ROOTS = ["runtime", "skills"] as const;

/** Destination directory for PATH bins, relative to the selected home. */
export const BIN_DIR_SUBPATH = ".bun/bin" as const;

const SAFE_BIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** One validated package-owned PATH-bin declaration. */
export interface BinDeclaration {
	readonly name: string;
	readonly packageDir: string;
	readonly entry: string;
}

export interface BinManifest {
	readonly declarations: readonly BinDeclaration[];
	readonly findings: readonly SetupFinding[];
}

/** Read every PATH-bin declaration; `setup.pathBin` wins over `#bin` per package. */
export async function readBinManifest(sourceRepoRoot: string): Promise<BinManifest> {
	const findings: SetupFinding[] = [];
	const candidates: BinDeclaration[] = [];
	for (const root of BIN_PACKAGE_ROOTS) {
		const rootDir = join(sourceRepoRoot, root);
		let children: string[];
		try {
			children = [...(await readdir(rootDir))].sort((a, b) => a.localeCompare(b));
		} catch {
			continue;
		}
		for (const child of children) {
			const packageDir = join(rootDir, child);
			const manifestPath = join(packageDir, "package.json");
			let parsed: unknown;
			try {
				parsed = JSON.parse(await readFile(manifestPath, "utf8"));
			} catch (error) {
				if (await exists(manifestPath)) {
					findings.push(declarationFinding(manifestPath, `Package manifest is unreadable: ${error instanceof Error ? error.message : String(error)}`));
				}
				continue;
			}
			const declared = declaredBins(parsed);
			if (!declared) continue;
			for (const name of Object.keys(declared).sort((a, b) => a.localeCompare(b))) {
				const validated = await validateDeclaration(packageDir, manifestPath, name, declared[name]);
				if ("finding" in validated) findings.push(validated.finding);
				else candidates.push(validated.declaration);
			}
		}
	}
	const counts = new Map<string, number>();
	for (const candidate of candidates) counts.set(candidate.name, (counts.get(candidate.name) ?? 0) + 1);
	const declarations: BinDeclaration[] = [];
	for (const candidate of candidates) {
		if ((counts.get(candidate.name) ?? 0) > 1) {
			findings.push(declarationFinding(join(candidate.packageDir, "package.json"), `Bin name '${candidate.name}' is declared by multiple packages.`));
			continue;
		}
		declarations.push(candidate);
	}
	declarations.sort((a, b) => a.name.localeCompare(b.name));
	return { declarations, findings };
}

async function validateDeclaration(
	packageDir: string,
	manifestPath: string,
	name: string,
	entryValue: unknown,
): Promise<{ declaration: BinDeclaration } | { finding: SetupFinding }> {
	if (!SAFE_BIN_NAME.test(name)) {
		return { finding: declarationFinding(manifestPath, `Bin name '${name}' is not a safe single path segment.`) };
	}
	if (typeof entryValue !== "string" || entryValue.trim() === "") {
		return { finding: declarationFinding(manifestPath, `Bin entry for '${name}' is not a path string.`) };
	}
	const canonicalPackageDir = await canonicalPath(packageDir);
	const entryPath = resolve(packageDir, entryValue);
	let canonicalEntry: string;
	try {
		canonicalEntry = await realpath(entryPath);
	} catch {
		return { finding: targetFinding(entryPath, `Bin entry for '${name}' is missing on disk.`) };
	}
	if (!isInsideOrEqual(canonicalPackageDir, canonicalEntry)) {
		return { finding: declarationFinding(manifestPath, `Bin entry for '${name}' resolves outside its package.`) };
	}
	if (!(await readFile(canonicalEntry, "utf8")).startsWith("#!")) {
		return { finding: targetFinding(canonicalEntry, `Bin entry for '${name}' lacks a '#!' shebang.`) };
	}
	return { declaration: { name, packageDir: canonicalPackageDir, entry: canonicalEntry } };
}

function declaredBins(parsed: unknown): Record<string, unknown> | undefined {
	if (typeof parsed !== "object" || parsed === null) return undefined;
	const setupField = (parsed as { setup?: unknown }).setup;
	if (typeof setupField === "object" && setupField !== null) {
		const pathBin = (setupField as { pathBin?: unknown }).pathBin;
		if (isPlainRecord(pathBin)) return pathBin;
	}
	const bin = (parsed as { bin?: unknown }).bin;
	return isPlainRecord(bin) ? bin : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

/** One planned symlink mutation in the bin destination directory. */
export interface BinOperation {
	readonly name: string;
	readonly destination: string;
	readonly source: string;
	readonly action: "create" | "repair";
}

export interface BinTopologyOptions {
	/** Destination directory seam; defaults to `<home>/.bun/bin`. Tests never touch the real home. */
	readonly binDir?: string;
	/** PATH seam for the on-PATH advisory; defaults to `process.env.PATH`. */
	readonly pathEnv?: string;
}

export interface BinTopologyPlan {
	readonly domain: "bins";
	readonly sourceRoot: string;
	readonly homeRoot: string;
	readonly binDir: string;
	readonly operations: readonly BinOperation[];
	readonly findings: readonly SetupFinding[];
	/** Non-blocking evidence excluded from blocked/blockers computation. */
	readonly advisories: readonly SetupFinding[];
	readonly preserved: readonly string[];
}

/** Classify every declared bin against the destination directory without mutating. */
export async function inspectBinTopology(
	sourceRepoRoot: string,
	homeDir: string,
	options: BinTopologyOptions = {},
): Promise<BinTopologyPlan> {
	const manifest = await readBinManifest(sourceRepoRoot);
	const sourceRoot = await canonicalPath(sourceRepoRoot);
	const homeRoot = await canonicalPath(homeDir);
	const binDir = options.binDir ?? join(homeDir, BIN_DIR_SUBPATH);
	const findings: SetupFinding[] = [...manifest.findings];
	const advisories: SetupFinding[] = [];
	const operations: BinOperation[] = [];
	const preserved: string[] = [];
	const plan = (overrides: Partial<BinTopologyPlan> = {}): BinTopologyPlan => ({
		domain: "bins", sourceRoot, homeRoot, binDir,
		operations, findings, advisories, preserved,
		...overrides,
	});
	const unsafe = await unsafeExistingParent(homeRoot, join(binDir, "probe"));
	if (unsafe) {
		findings.push({ id: "unsafe_root", owner: "setup.bins", path: unsafe, summary: "Bin destination parent escapes the selected home.", repair: "human_repair" });
		return plan({ operations: [], preserved: manifest.declarations.map((declaration) => join(binDir, declaration.name)) });
	}
	if (!(await isDirectory(binDir))) {
		if (manifest.declarations.length > 0) {
			advisories.push({
				id: "bin_dir_unavailable",
				owner: "setup.bins",
				path: binDir,
				summary: "Bin destination directory is missing; PATH bins were not planned.",
				why: "Install Bun or create the directory so setup sync can deliver PATH bins.",
				repair: "human_repair",
			});
		}
		return plan({ operations: [] });
	}
	if (manifest.declarations.length > 0 && !(await binDirOnPath(binDir, options.pathEnv ?? process.env.PATH ?? ""))) {
		advisories.push({
			id: "bin_dir_not_on_path",
			owner: "setup.bins",
			path: binDir,
			summary: "Bin destination directory is not on PATH.",
			why: `Add ${binDir} to PATH so installed bins resolve from any CWD.`,
			repair: "human_repair",
		});
	}
	const declaredNames = new Set(manifest.declarations.map((declaration) => declaration.name));
	for (const declaration of manifest.declarations) {
		const destination = join(binDir, declaration.name);
		const shape = await pathShape(destination);
		if (shape === "missing") {
			operations.push({ name: declaration.name, destination, source: declaration.entry, action: "create" });
			continue;
		}
		if (shape === "symlink") {
			if ((await resolvedLinkTarget(destination)) === declaration.entry) continue;
			if (await ownedLinkTarget(destination, sourceRoot)) {
				operations.push({ name: declaration.name, destination, source: declaration.entry, action: "repair" });
				continue;
			}
			findings.push({ id: "foreign_symlink", owner: "external", path: destination, summary: `A foreign symlink occupies declared bin '${declaration.name}' and is preserved.`, repair: "human_repair" });
			preserved.push(destination);
			continue;
		}
		findings.push({ id: "real_entry", owner: "external", path: destination, summary: `A real entry occupies declared bin '${declaration.name}' and is preserved.`, repair: "human_repair" });
		preserved.push(destination);
	}
	for (const child of await sortedChildren(binDir)) {
		if (declaredNames.has(child)) continue;
		const path = join(binDir, child);
		if ((await pathShape(path)) !== "symlink") continue;
		if (!(await ownedLinkTarget(path, sourceRoot))) continue;
		advisories.push({
			id: "bin_orphan",
			owner: "setup.bins",
			path,
			summary: `Setup-owned bin link '${child}' no longer matches a declaration.`,
			why: "The declaration or its target is gone; unlink removes proven setup-owned bins.",
			repair: "run_unlink",
		});
	}
	return plan();
}

/** Apply planned bin mutations with per-link failure isolation and pre-mutation re-proof. */
export async function applyBinTopology(
	plan: BinTopologyPlan,
	options: { beforeMutation?: (phase: "remove" | "symlink", destination: string) => Promise<void> } = {},
): Promise<SetupDomainResult> {
	const applied: string[] = [];
	const failed: string[] = [];
	const deferred: string[] = [];
	for (const operation of plan.operations) {
		try {
			if (!(await operationStillProven(plan, operation))) {
				deferred.push(operation.destination);
				continue;
			}
			if (operation.action === "repair") {
				await options.beforeMutation?.("remove", operation.destination);
				if (!(await operationStillProven(plan, operation))) {
					deferred.push(operation.destination);
					continue;
				}
				await rm(operation.destination);
			}
			await options.beforeMutation?.("symlink", operation.destination);
			const trusted = await trustedBinSource(plan.sourceRoot, operation.source);
			if (await unsafeExistingParent(plan.homeRoot, operation.destination) || !trusted || (await pathShape(operation.destination)) !== "missing") {
				deferred.push(operation.destination);
				continue;
			}
			await symlink(trusted, operation.destination);
			applied.push(operation.destination);
		} catch {
			failed.push(operation.destination);
		}
	}
	return {
		domain: "bins",
		planned: plan.operations.map((operation) => operation.destination),
		applied,
		deferred,
		preserved: plan.preserved,
		failed,
	};
}

async function operationStillProven(plan: BinTopologyPlan, operation: BinOperation): Promise<boolean> {
	if (await unsafeExistingParent(plan.homeRoot, operation.destination)) return false;
	if (!(await trustedBinSource(plan.sourceRoot, operation.source))) return false;
	const shape = await pathShape(operation.destination);
	if (operation.action === "create") return shape === "missing";
	return shape === "symlink" && (await ownedLinkTarget(operation.destination, plan.sourceRoot)) !== undefined;
}

export interface RemovableBinsInspection {
	readonly removable: readonly string[];
	readonly preserved: readonly string[];
	readonly findings: readonly SetupFinding[];
}

/** Enumerate proven setup-owned bin links; ownership is target-inside-repo, dangling links included. */
export async function inspectRemovableBins(
	sourceRepoRoot: string,
	homeDir: string,
	options: BinTopologyOptions = {},
): Promise<RemovableBinsInspection> {
	const sourceRoot = await canonicalPath(sourceRepoRoot);
	const homeRoot = await canonicalPath(homeDir);
	const binDir = options.binDir ?? join(homeDir, BIN_DIR_SUBPATH);
	const unsafe = await unsafeExistingParent(homeRoot, join(binDir, "probe"));
	if (unsafe) {
		return {
			removable: [],
			preserved: [],
			findings: [{ id: "unsafe_root", owner: "setup.bins", path: unsafe, summary: "Bin destination parent escapes the selected home.", repair: "human_repair" }],
		};
	}
	const removable: string[] = [];
	for (const child of await sortedChildren(binDir)) {
		const path = join(binDir, child);
		if ((await pathShape(path)) !== "symlink") continue;
		if (await ownedLinkTarget(path, sourceRoot)) removable.push(path);
	}
	return { removable, preserved: [], findings: [] };
}

async function trustedBinSource(sourceRoot: string, source: string): Promise<string | undefined> {
	try {
		const canonical = await realpath(source);
		if (!isInsideOrEqual(sourceRoot, canonical)) return undefined;
		return (await readFile(canonical, "utf8")).startsWith("#!") ? canonical : undefined;
	} catch {
		return undefined;
	}
}

/** Canonical target when it resolves inside the repo; lexical fallback keeps dangling links owned. */
async function ownedLinkTarget(path: string, sourceRoot: string): Promise<string | undefined> {
	try {
		const raw = await readlink(path);
		const target = isAbsolute(raw) ? resolve(raw) : resolve(dirname(path), raw);
		let canonical: string;
		try {
			canonical = await realpath(target);
		} catch {
			canonical = join(await canonicalPath(dirname(target)), basename(target));
		}
		return isInsideOrEqual(sourceRoot, canonical) ? canonical : undefined;
	} catch {
		return undefined;
	}
}

async function resolvedLinkTarget(path: string): Promise<string | undefined> {
	try {
		return await realpath(path);
	} catch {
		return undefined;
	}
}

async function binDirOnPath(binDir: string, pathEnv: string): Promise<boolean> {
	const canonicalBin = await canonicalPath(binDir);
	for (const entry of pathEnv.split(delimiter)) {
		if (!entry) continue;
		if (resolve(entry) === resolve(binDir)) return true;
		if ((await canonicalPath(entry)) === canonicalBin) return true;
	}
	return false;
}

async function sortedChildren(path: string): Promise<readonly string[]> {
	try {
		return [...(await readdir(path))].sort((a, b) => a.localeCompare(b));
	} catch {
		return [];
	}
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		const stats = await lstat(path);
		if (stats.isDirectory()) return true;
		if (!stats.isSymbolicLink()) return false;
		return (await lstat(await realpath(path))).isDirectory();
	} catch {
		return false;
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}

async function pathShape(path: string): Promise<"missing" | "symlink" | "entry"> {
	try {
		return (await lstat(path)).isSymbolicLink() ? "symlink" : "entry";
	} catch {
		return "missing";
	}
}

function declarationFinding(path: string, summary: string): SetupFinding {
	return { id: "bin_declaration_invalid", owner: "setup.bins", path, summary, repair: "human_repair" };
}

function targetFinding(path: string, summary: string): SetupFinding {
	return { id: "bin_target_unhealthy", owner: "setup.bins", path, summary, repair: "human_repair" };
}
