#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

type Workspaces =
	| string[]
	| {
			packages?: string[];
			catalog?: Record<string, string>;
			catalogs?: Record<string, Record<string, string>>;
	  };

type PackageJson = {
	name?: string;
	version?: string;
	description?: string;
	license?: string;
	private?: boolean;
	workspaces?: Workspaces;
	bin?: Record<string, string> | string;
	scripts?: Record<string, string>;
	files?: string[];
	publishConfig?: {
		access?: string;
		tag?: string;
		registry?: string;
	};
	engines?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	bundleDependencies?: string[] | boolean;
	bundledDependencies?: string[] | boolean;
};

type TsconfigJson = {
	extends?: string;
	compilerOptions?: Record<string, unknown>;
	include?: string[];
	exclude?: string[];
};

type WorkspacePackage = {
	path: string;
	packageJson: PackageJson | null;
};

type Finding = {
	path: string;
	message: string;
};

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const expectedTsconfigOptions = {
	target: "ESNext",
	lib: ["ESNext"],
	module: "Preserve",
	moduleDetection: "force",
	moduleResolution: "bundler",
	allowImportingTsExtensions: true,
	verbatimModuleSyntax: true,
	noEmit: true,
	strict: true,
	skipLibCheck: true,
	noFallthroughCasesInSwitch: true,
	noImplicitOverride: true,
	resolveJsonModule: true,
} satisfies Record<string, unknown>;
const expectedTypecheckScript = "tsc --noEmit -p tsconfig.json";
const packageTsconfigPath = "tsconfig.json";
const requiredCatalogDependencies = ["typescript", "@types/bun", "@types/node"];
const toolchainDependencyNames = new Set(requiredCatalogDependencies);
const localLockfileNames = new Set([
	"bun.lock",
	"bun.lockb",
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
]);

const findings: Finding[] = [];

function repoPath(path: string): string {
	return join(repoRoot, path);
}

function displayPath(path: string): string {
	return relative(repoRoot, path);
}

function readPackageJson(path: string): PackageJson | null {
	const packagePath = join(path, "package.json");

	if (!existsSync(packagePath)) {
		findings.push({
			path: displayPath(packagePath),
			message: "Missing package.json.",
		});
		return null;
	}

	try {
		return JSON.parse(readFileSync(packagePath, "utf8")) as PackageJson;
	} catch (error) {
		findings.push({
			path: displayPath(packagePath),
			message: `Invalid JSON in package.json: ${(error as Error).message}.`,
		});
		return null;
	}
}

function readTsconfigJson(path: string): TsconfigJson | null {
	if (!existsSync(path)) {
		findings.push({
			path: displayPath(path),
			message: "Missing tsconfig.json.",
		});
		return null;
	}

	try {
		return JSON.parse(readFileSync(path, "utf8")) as TsconfigJson;
	} catch (error) {
		findings.push({
			path: displayPath(path),
			message: `Invalid JSON in tsconfig.json: ${(error as Error).message}.`,
		});
		return null;
	}
}

function workspacePackages(workspaces: Workspaces | undefined): string[] {
	if (Array.isArray(workspaces)) {
		return workspaces;
	}

	return workspaces?.packages ?? [];
}

function workspaceCatalog(workspaces: Workspaces | undefined): Record<string, string> {
	if (!workspaces || Array.isArray(workspaces)) {
		return {};
	}

	return workspaces.catalog ?? {};
}

function expandWorkspaceEntry(workspaceEntry: string): string[] {
	if (!workspaceEntry.endsWith("/*")) {
		return existsSync(repoPath(join(workspaceEntry, "package.json")))
			? [workspaceEntry]
			: [];
	}

	const parentPath = workspaceEntry.slice(0, -2);
	const absoluteParentPath = repoPath(parentPath);

	if (!existsSync(absoluteParentPath)) {
		return [];
	}

	return readdirSync(absoluteParentPath)
		.map((entry) => join(parentPath, entry))
		.filter((packagePath) =>
			statSync(repoPath(packagePath)).isDirectory() &&
			existsSync(repoPath(join(packagePath, "package.json"))),
		)
		.sort();
}

function discoverWorkspacePackagePaths(rootPackageJson: PackageJson | null): string[] {
	const packagePaths = new Set<string>();

	for (const workspaceEntry of workspacePackages(rootPackageJson?.workspaces)) {
		for (const packagePath of expandWorkspaceEntry(workspaceEntry)) {
			packagePaths.add(packagePath);
		}
	}

	return [...packagePaths].sort();
}

function directLocalScriptTarget(scriptValue: string): string | null {
	const directTargetMatch = scriptValue.match(
		/^(?:\.\/)?src\/[^\s]+\.(?:ts|tsx|js|mjs|cjs|sh)$/,
	);
	const bunRunTargetMatch = scriptValue.match(
		/^bun run ((?:\.\/)?src\/[^\s]+\.(?:ts|tsx|js|mjs|cjs|sh))$/,
	);

	return directTargetMatch?.[0] ?? bunRunTargetMatch?.[1] ?? null;
}

function discoverLocalScripts(packageJson: PackageJson | null): Record<string, string> {
	const localScripts: Record<string, string> = {};

	for (const [scriptName, scriptValue] of Object.entries(packageJson?.scripts ?? {})) {
		const scriptTarget = directLocalScriptTarget(scriptValue);

		if (scriptTarget) {
			localScripts[scriptName] = scriptTarget;
		}
	}

	return localScripts;
}

function discoverContractPaths(packagePath: string): string[] {
	const contractPaths: string[] = [];
	const packageContractPath = join(packagePath, "src/command-contract.ts");

	if (existsSync(repoPath(packageContractPath))) {
		contractPaths.push(packageContractPath);
	}

	const frontDoorsPath = repoPath(join(packagePath, "src/front-doors"));
	if (!existsSync(frontDoorsPath)) {
		return contractPaths;
	}

	for (const entry of readdirSync(frontDoorsPath).sort()) {
		const contractPath = join(
			packagePath,
			"src/front-doors",
			entry,
			"command-contract.ts",
		);
		if (existsSync(repoPath(contractPath))) {
			contractPaths.push(contractPath);
		}
	}

	return contractPaths;
}

function expectedShebangForBinTarget(binTarget: string): string | null {
	if (binTarget.endsWith(".ts") || binTarget.endsWith(".js")) {
		return "#!/usr/bin/env bun";
	}

	if (binTarget.endsWith(".sh")) {
		return "#!/usr/bin/env bash";
	}

	return null;
}

function readFirstLine(path: string): string {
	return readFileSync(path, "utf8").split(/\r?\n/, 1)[0] ?? "";
}

function packageBins(packageJson: PackageJson | null): Record<string, string> {
	if (!packageJson?.bin) {
		return {};
	}

	if (typeof packageJson.bin === "string") {
		return {
			[packageJson.name ?? "package-bin"]: packageJson.bin,
		};
	}

	return packageJson.bin;
}

function hasBlankValue(value: string | undefined): boolean {
	return !value || value.trim().length === 0;
}

function normalizedBinTarget(binTarget: string): string {
	return binTarget.replace(/^\.\//, "");
}

function isSourceModeBinTarget(binTarget: string): boolean {
	const normalizedTarget = normalizedBinTarget(binTarget);

	return (
		normalizedTarget.startsWith("src/") ||
		normalizedTarget.startsWith("scripts/") ||
		/\.(ts|tsx|test\.js|test\.ts|live\.test\.ts|benchmark\.ts)$/.test(
			normalizedTarget,
		) ||
		/(^|\/)fixtures\//.test(normalizedTarget)
	);
}

function fileAllowlistCoversBin(files: string[], binTarget: string): boolean {
	const normalizedTarget = normalizedBinTarget(binTarget);

	return files.some((fileEntry) => {
		const normalizedEntry = fileEntry.replace(/^\.\//, "").replace(/\/$/, "");

		return (
			normalizedTarget === normalizedEntry ||
			normalizedTarget.startsWith(`${normalizedEntry}/`)
		);
	});
}

function hasBundledDependencyPayload(
	bundledDependencies: string[] | boolean | undefined,
): boolean {
	return (
		bundledDependencies === true ||
		(Array.isArray(bundledDependencies) && bundledDependencies.length > 0)
	);
}

function sameJsonValue(actual: unknown, expected: unknown): boolean {
	return JSON.stringify(actual) === JSON.stringify(expected);
}

function formatJsonValue(value: unknown): string {
	return JSON.stringify(value);
}

function dependencySpec(
	packageJson: PackageJson | null,
	dependencyName: string,
): string | undefined {
	return (
		packageJson?.dependencies?.[dependencyName] ??
		packageJson?.devDependencies?.[dependencyName]
	);
}

function directoryHasTypeScript(path: string): boolean {
	if (!existsSync(path)) {
		return false;
	}

	const entries = readdirSync(path);
	for (const entry of entries) {
		const entryPath = join(path, entry);
		const stats = statSync(entryPath);

		if (stats.isDirectory()) {
			if (directoryHasTypeScript(entryPath)) {
				return true;
			}
			continue;
		}

		if (/\.(ts|tsx)$/.test(entry)) {
			return true;
		}
	}

	return false;
}

function hasSourceTypeScript(packagePath: string): boolean {
	return directoryHasTypeScript(repoPath(join(packagePath, "src")));
}

function checkExpectedDevDependency(
	packagePath: string,
	packageJson: PackageJson | null,
	dependencyName: string,
	expectedSpec: string,
): void {
	const actualSpec = packageJson?.devDependencies?.[dependencyName];

	if (actualSpec !== expectedSpec) {
		findings.push({
			path: `${packagePath}/package.json`,
			message: `devDependencies.${dependencyName} must be ${expectedSpec}; root workspaces.catalog owns active TypeScript tool versions.`,
		});
	}
}

function checkLintPortability(
	packagePath: string,
	packageJson: PackageJson | null,
): void {
	const biomeSpec = dependencySpec(packageJson, "@biomejs/biome");

	if (biomeSpec !== undefined) {
		findings.push({
			path: `${packagePath}/package.json`,
			message:
				"Skill package declares @biomejs/biome; keep Biome a root-only dev gate so the bundle stays portable.",
		});
	}

	const nestedBiomePath = repoPath(join(packagePath, "biome.json"));

	if (!existsSync(nestedBiomePath)) {
		return;
	}

	let nestedBiome: { root?: boolean; extends?: string | string[] };

	try {
		nestedBiome = JSON.parse(readFileSync(nestedBiomePath, "utf8"));
	} catch (error) {
		findings.push({
			path: `${packagePath}/biome.json`,
			message: `Invalid JSON in biome.json: ${(error as Error).message}.`,
		});
		return;
	}

	const extendsValue = nestedBiome.extends;
	const extendsRoot = Array.isArray(extendsValue)
		? extendsValue.includes("//")
		: extendsValue === "//";

	if (!extendsRoot) {
		findings.push({
			path: `${packagePath}/biome.json`,
			message:
				'Nested skill biome.json must set extends: "//" so it cannot become a competing root; treat it as workspace-local only.',
		});
	}
}

function checkTypeScriptGovernance(
	packagePath: string,
	packageJson: PackageJson | null,
): void {
	const hasTypeScript =
		hasSourceTypeScript(packagePath) ||
		Boolean(packageJson?.scripts?.typecheck) ||
		Boolean(dependencySpec(packageJson, "typescript")) ||
		existsSync(repoPath(join(packagePath, packageTsconfigPath)));

	if (!hasTypeScript) {
		return;
	}

	const tsconfigPath = repoPath(join(packagePath, packageTsconfigPath));
	const tsconfig = readTsconfigJson(tsconfigPath);
	const compilerOptions = tsconfig?.compilerOptions ?? {};
	const typeEntries = Array.isArray(compilerOptions.types)
		? compilerOptions.types
		: [];
	const runtimeType = typeEntries.length === 1 ? typeEntries[0] : undefined;

	if (packageJson?.scripts?.typecheck !== expectedTypecheckScript) {
		findings.push({
			path: `${packagePath}/package.json`,
			message: `TypeScript governance expects scripts.typecheck to be ${expectedTypecheckScript}.`,
		});
	}

	checkExpectedDevDependency(packagePath, packageJson, "typescript", "catalog:");

	if (dependencySpec(packageJson, "bun-types")) {
		findings.push({
			path: `${packagePath}/package.json`,
			message: "Use @types/bun through root workspaces.catalog; do not declare direct bun-types in active packages.",
		});
	}

	if (runtimeType === "bun") {
		checkExpectedDevDependency(packagePath, packageJson, "@types/bun", "catalog:");

		if (dependencySpec(packageJson, "@types/node")) {
			findings.push({
				path: `${packagePath}/package.json`,
				message: "Bun CLI packages use @types/bun as the ambient runtime surface; do not add direct @types/node.",
			});
		}
	}

	if (runtimeType === "node") {
		checkExpectedDevDependency(packagePath, packageJson, "@types/node", "catalog:");

		if (dependencySpec(packageJson, "@types/bun")) {
			findings.push({
				path: `${packagePath}/package.json`,
				message: "Node library packages use @types/node for source typechecking; keep Bun test typing separate.",
			});
		}
	}

	if (runtimeType !== "bun" && runtimeType !== "node") {
		findings.push({
			path: displayPath(tsconfigPath),
			message: "compilerOptions.types must be exactly [\"bun\"] or [\"node\"] for active TypeScript packages.",
		});
	}

	if (tsconfig?.extends) {
		findings.push({
			path: displayPath(tsconfigPath),
			message: "Portable active package tsconfigs must be self-contained; do not extend repo-root config unless the export payload carries it.",
		});
	}

	for (const [optionName, expectedValue] of Object.entries(expectedTsconfigOptions)) {
		const actualValue = compilerOptions[optionName];

		if (!sameJsonValue(actualValue, expectedValue)) {
			findings.push({
				path: displayPath(tsconfigPath),
				message: `compilerOptions.${optionName} must be ${formatJsonValue(expectedValue)} for active TypeScript packages.`,
			});
		}
	}

	if ((compilerOptions.types as string[] | undefined)?.includes("bun-types")) {
		findings.push({
			path: displayPath(tsconfigPath),
			message: "Use compilerOptions.types [\"bun\"]; do not typecheck against direct bun-types.",
		});
	}
}

function walkFiles(path: string): string[] {
	const matches: string[] = [];

	for (const entry of readdirSync(path)) {
		if (entry === "node_modules" || entry === ".git") {
			continue;
		}

		const entryPath = join(path, entry);
		const stats = statSync(entryPath);

		if (stats.isDirectory()) {
			matches.push(...walkFiles(entryPath));
			continue;
		}

		matches.push(entryPath);
	}

	return matches;
}

function findDistributedTestOrFixturePaths(
	packagePath: string,
	files: string[],
): string[] {
	const matches: string[] = [];

	for (const fileEntry of files) {
		const allowlistPath = repoPath(join(packagePath, fileEntry));

		if (!existsSync(allowlistPath)) {
			matches.push(`${packagePath}/${fileEntry} (missing)`);
			continue;
		}

		const stats = statSync(allowlistPath);
		const candidatePaths = stats.isDirectory()
			? walkFiles(allowlistPath)
			: [allowlistPath];

		for (const candidatePath of candidatePaths) {
			const relativeCandidatePath = displayPath(candidatePath);

			if (
				/(^|\/)fixtures\//.test(relativeCandidatePath) ||
				/\.(test|live\.test|benchmark)\.ts$/.test(relativeCandidatePath)
			) {
				matches.push(relativeCandidatePath);
			}
		}
	}

	return matches;
}

function findDistributedWorkspaceMarkers(packagePath: string, files: string[]): string[] {
	const matches: string[] = [];

	for (const fileEntry of files) {
		const allowlistPath = repoPath(join(packagePath, fileEntry));

		if (!existsSync(allowlistPath)) {
			continue;
		}

		const stats = statSync(allowlistPath);
		const candidatePaths = stats.isDirectory()
			? walkFiles(allowlistPath)
			: [allowlistPath];

		for (const candidatePath of candidatePaths) {
			const text = readFileSync(candidatePath, "utf8");

			if (
				text.includes("@side-quest/cli-command-facade") ||
				text.includes("workspace:")
			) {
				matches.push(displayPath(candidatePath));
			}
		}
	}

	return matches;
}

function lockWorkspaceBlock(lockText: string, packagePath: string): string | null {
	const packageMarker = `    "${packagePath}": {`;
	const blockStart = lockText.indexOf(packageMarker);

	if (blockStart === -1) {
		return null;
	}

	const nextBlockMatch = lockText.slice(blockStart + packageMarker.length).match(
		/\n {4}"[^"]+": \{/,
	);

	if (!nextBlockMatch?.index) {
		return lockText.slice(blockStart);
	}

	return lockText.slice(blockStart, blockStart + packageMarker.length + nextBlockMatch.index);
}

function checkDistributionDependencySpecs(
	packagePath: string,
	scope: "dependencies" | "devDependencies",
	specs: Record<string, string> | undefined,
): void {
	for (const [dependencyName, dependencySpec] of Object.entries(specs ?? {})) {
		if (dependencySpec.startsWith("file:")) {
			findings.push({
				path: `${packagePath}/package.json`,
				message: `${scope}.${dependencyName} uses file:; keep private true until the distribution payload bundles or publishes that dependency.`,
			});
		}

		if (dependencySpec.startsWith("workspace:")) {
			findings.push({
				path: `${packagePath}/package.json`,
				message: `${scope}.${dependencyName} uses workspace:; keep private true until the dependency has a versioned publish plan.`,
			});
		}
	}
}

function checkDistributionReadiness(
	packagePath: string,
	packageJson: PackageJson | null,
): void {
	if (packageJson?.private !== false) {
		return;
	}

	const packageJsonPath = `${packagePath}/package.json`;
	const files = packageJson.files ?? [];
	const bins = packageBins(packageJson);
	const publishAccess = packageJson.publishConfig?.access;

	if (!packageJson.name || packageJson.name.trim().length === 0) {
		findings.push({
			path: packageJsonPath,
			message: "Public package needs a stable name before private is false.",
		});
	}

	if (
		hasBlankValue(packageJson.version) ||
		!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(packageJson.version ?? "")
	) {
		findings.push({
			path: packageJsonPath,
			message: "Public package needs an explicit semver version before private is false.",
		});
	}

	if (packageJson.version === "0.0.0") {
		findings.push({
			path: packageJsonPath,
			message: "Public package version cannot stay at 0.0.0 when private is false.",
		});
	}

	if (hasBlankValue(packageJson.description)) {
		findings.push({
			path: packageJsonPath,
			message: "Public package needs a description before private is false.",
		});
	}

	if (hasBlankValue(packageJson.license)) {
		findings.push({
			path: packageJsonPath,
			message: "Public package needs a license stance before private is false.",
		});
	}

	if (publishAccess !== "public" && publishAccess !== "restricted") {
		findings.push({
			path: packageJsonPath,
			message: "Public package needs publishConfig.access set to public or restricted before private is false.",
		});
	}

	if (
		publishAccess === "public" &&
		packageJson.license?.trim().toUpperCase() === "UNLICENSED"
	) {
		findings.push({
			path: packageJsonPath,
			message: "Public npm access cannot use UNLICENSED as the license stance.",
		});
	}

	if (hasBlankValue(packageJson.publishConfig?.tag)) {
		findings.push({
			path: packageJsonPath,
			message: "Public package needs publishConfig.tag before private is false.",
		});
	}

	if (files.length === 0) {
		findings.push({
			path: packageJsonPath,
			message: "Public package needs an explicit files allowlist before private is false.",
		});
	}

	for (const fileEntry of files) {
		if (["*", ".", "**/*"].includes(fileEntry)) {
			findings.push({
				path: packageJsonPath,
				message: `Public package files entry ${fileEntry} is too broad; use a narrow distribution allowlist.`,
			});
		}

		if (
			fileEntry.includes("var") ||
			fileEntry.includes(".runner-output") ||
			fileEntry.includes("node_modules")
		) {
			findings.push({
				path: packageJsonPath,
				message: `Public package files entry ${fileEntry} includes generated or dependency output.`,
			});
		}
	}

	for (const evidencePath of findDistributedTestOrFixturePaths(packagePath, files)) {
		findings.push({
			path: packageJsonPath,
			message: `Public package files allowlist includes missing, test, or fixture payload ${evidencePath}.`,
		});
	}

	for (const evidencePath of findDistributedWorkspaceMarkers(packagePath, files)) {
		findings.push({
			path: packageJsonPath,
			message: `Public package payload includes workspace-only marker in ${evidencePath}.`,
		});
	}

	for (const [binName, binTarget] of Object.entries(bins)) {
		if (isSourceModeBinTarget(binTarget)) {
			findings.push({
				path: packageJsonPath,
				message: `Public package bin ${binName} -> ${binTarget} points at source, tests, fixtures, or dev wrappers; publish bins are install contracts and repo-local source mode belongs in package scripts.`,
			});
		}

		if (files.length > 0 && !fileAllowlistCoversBin(files, binTarget)) {
			findings.push({
				path: packageJsonPath,
				message: `Public package files allowlist does not cover bin ${binName} -> ${binTarget}.`,
			});
		}

		if (
			(binTarget.endsWith(".ts") || binTarget.endsWith(".js")) &&
			hasBlankValue(packageJson.engines?.bun)
		) {
			findings.push({
				path: packageJsonPath,
				message: `Direct Bun bin ${binName} needs engines.bun before private is false.`,
			});
		}
	}

	if (hasBundledDependencyPayload(packageJson.bundleDependencies)) {
		findings.push({
			path: packageJsonPath,
			message: "Public package cannot use bundleDependencies until the bundled dependency payload is explicitly accepted.",
		});
	}

	if (hasBundledDependencyPayload(packageJson.bundledDependencies)) {
		findings.push({
			path: packageJsonPath,
			message: "Public package cannot use bundledDependencies until the bundled dependency payload is explicitly accepted.",
		});
	}

	checkDistributionDependencySpecs(
		packagePath,
		"dependencies",
		packageJson.dependencies,
	);
	checkDistributionDependencySpecs(
		packagePath,
		"devDependencies",
		packageJson.devDependencies,
	);
}

function walkForLocalLockfiles(path: string): string[] {
	const matches: string[] = [];

	for (const entry of readdirSync(path)) {
		if (entry === "node_modules" || entry === ".git") {
			continue;
		}

		const entryPath = join(path, entry);
		const stats = statSync(entryPath);

		if (stats.isDirectory()) {
			matches.push(...walkForLocalLockfiles(entryPath));
			continue;
		}

		if (localLockfileNames.has(entry)) {
			matches.push(entryPath);
		}
	}

	return matches;
}

const rootPackage = readPackageJson(repoRoot);
const workspacePackagePaths = discoverWorkspacePackagePaths(rootPackage);
const workspacePackagesByPath = new Map<string, WorkspacePackage>(
	workspacePackagePaths.map((packagePath) => [
		packagePath,
		{
			path: packagePath,
			packageJson: readPackageJson(repoPath(packagePath)),
		},
	]),
);
const workspacePackageNames = new Map<string, WorkspacePackage>();

for (const workspacePackage of workspacePackagesByPath.values()) {
	if (workspacePackage.packageJson?.name) {
		workspacePackageNames.set(workspacePackage.packageJson.name, workspacePackage);
	}
}

const rootWorkspaces = new Set(workspacePackages(rootPackage?.workspaces));
const rootCatalog = workspaceCatalog(rootPackage?.workspaces);

for (const workspaceEntry of rootWorkspaces) {
	const expandedPaths = expandWorkspaceEntry(workspaceEntry);

	if (expandedPaths.length === 0) {
		findings.push({
			path: "package.json",
			message: `Workspace entry ${workspaceEntry} does not resolve to any package.json.`,
		});
	}
}

for (const dependencyName of requiredCatalogDependencies) {
	const catalogSpec = rootCatalog[dependencyName];

	if (!catalogSpec) {
		findings.push({
			path: "package.json",
			message: `workspaces.catalog.${dependencyName} is required so root owns the active TypeScript toolchain.`,
		});
		continue;
	}

	if (/^[~^*]/.test(catalogSpec)) {
		findings.push({
			path: "package.json",
			message: `workspaces.catalog.${dependencyName} must be an exact version, not ${catalogSpec}.`,
		});
	}
}

for (const [dependencyName, dependencySpec] of Object.entries(
	rootPackage?.devDependencies ?? {},
)) {
	if (
		toolchainDependencyNames.has(dependencyName) &&
		dependencySpec !== rootCatalog[dependencyName]
	) {
		findings.push({
			path: "package.json",
			message: `Root devDependencies.${dependencyName} must match workspaces.catalog.${dependencyName}.`,
		});
	}
}

const rootLockPath = repoPath("bun.lock");
if (!existsSync(rootLockPath)) {
	findings.push({
		path: "bun.lock",
		message: "Missing root Bun lockfile.",
	});
} else {
	const rootLock = readFileSync(rootLockPath, "utf8");

	for (const [packagePath, workspacePackage] of workspacePackagesByPath) {
		const packageMarker = `    "${packagePath}": {`;
		const packageName = workspacePackage.packageJson?.name;

		if (!rootLock.includes(packageMarker)) {
			findings.push({
				path: "bun.lock",
				message: `Missing lockfile workspace package marker ${packagePath}.`,
			});
		}

		if (packageName && !rootLock.includes(`"name": "${packageName}"`)) {
			findings.push({
				path: "bun.lock",
				message: `Missing lockfile package name marker ${packageName}.`,
			});
		}

		const packageLockBlock = lockWorkspaceBlock(rootLock, packagePath);

		if (
			workspacePackage.packageJson?.private !== false &&
			packageLockBlock?.includes(`\n      "bin": {`)
		) {
			findings.push({
				path: "bun.lock",
				message: `Private repo-local package ${packagePath} has stale lockfile bin metadata; repo-local command entrypoints belong in package scripts.`,
			});
		}

		const bins = packageBins(workspacePackage.packageJson);

		for (const [binName, binTarget] of Object.entries(bins)) {
			const lockBinTarget = binTarget.startsWith("./")
				? binTarget
				: `./${binTarget}`;
			const normalizedLockBinTarget = normalizedBinTarget(binTarget);
			const binMarker = `        "${binName}": "${lockBinTarget}",`;
			const normalizedBinMarker = `        "${binName}": "${normalizedLockBinTarget}",`;

			if (!rootLock.includes(binMarker) && !rootLock.includes(normalizedBinMarker)) {
				findings.push({
					path: "bun.lock",
					message: `Missing lockfile bin marker ${binName} -> ${lockBinTarget}.`,
				});
			}
		}
	}
}

for (const [packagePath, workspacePackage] of workspacePackagesByPath) {
	const localLockfiles = walkForLocalLockfiles(repoPath(packagePath));
	const packageJson = workspacePackage.packageJson;

	checkDistributionReadiness(packagePath, packageJson);
	checkTypeScriptGovernance(packagePath, packageJson);
	checkLintPortability(packagePath, packageJson);

	if (packageJson?.private !== false && packageJson?.bin) {
		findings.push({
			path: `${packagePath}/package.json`,
			message: "Private repo-local package declares package bin entries; use package scripts for source-mode commands and reserve bin for published or externally consumed tools.",
		});
	}

	for (const lockfile of localLockfiles) {
		findings.push({
			path: displayPath(lockfile),
			message: "Use the root Bun lockfile for active workspace packages.",
		});
	}
}

for (const [packagePath, workspacePackage] of workspacePackagesByPath) {
	const packageJson = workspacePackage.packageJson;
	const declaredDependencies = {
		...packageJson?.dependencies,
		...packageJson?.devDependencies,
	};

	for (const [dependencyName, dependencySpec] of Object.entries(declaredDependencies)) {
		const dependencyWorkspacePackage = workspacePackageNames.get(dependencyName);

		if (!dependencyWorkspacePackage) {
			continue;
		}

		if (packageJson?.private !== false && dependencySpec !== "workspace:*") {
			findings.push({
				path: `${packagePath}/package.json`,
				message: `Private workspace package dependency ${dependencyName} must use workspace:*.`,
			});
		}

		if (
			packageJson?.private === false &&
			dependencyWorkspacePackage.packageJson?.private !== false
		) {
			findings.push({
				path: `${packagePath}/package.json`,
				message: `Public package dependency ${dependencyName} resolves to private workspace package ${dependencyWorkspacePackage.path}; publish, privately install, or bundle that dependency before private is false.`,
			});
		}
	}
}

for (const [packagePath, workspacePackage] of workspacePackagesByPath) {
	const packageJson = workspacePackage.packageJson;
	const localScripts = discoverLocalScripts(packageJson);

	if (Object.keys(localScripts).length === 0) {
		continue;
	}

	const skillPath = repoPath(join(packagePath, "SKILL.md"));
	const skillText = existsSync(skillPath) ? readFileSync(skillPath, "utf8") : "";

	for (const [scriptName, scriptTarget] of Object.entries(localScripts)) {
		const scriptTargetPath = repoPath(join(packagePath, scriptTarget));
		if (!existsSync(scriptTargetPath)) {
			findings.push({
				path: displayPath(scriptTargetPath),
				message: `Missing local script target for ${scriptName}.`,
			});
		}
	}

	for (const scriptName of Object.keys(localScripts)) {
		const bareInvocationPattern = new RegExp(
			`^${scriptName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`,
			"m",
		);

		if (bareInvocationPattern.test(skillText)) {
			findings.push({
				path: `${packagePath}/SKILL.md`,
				message: `Repo-local skill prose invokes bare command ${scriptName}; use package scripts with bun run in source-mode examples.`,
			});
		}
	}
}

for (const [packagePath, workspacePackage] of workspacePackagesByPath) {
	const packageJson = workspacePackage.packageJson;
	const bins = packageBins(packageJson);

	if (Object.keys(bins).length === 0) {
		continue;
	}

	const binsByName = packageBins(packageJson);

	for (const [binName, binTarget] of Object.entries(bins)) {
		if (binsByName[binName] !== binTarget) {
			findings.push({
				path: `${packagePath}/package.json`,
				message: `Missing bin ${binName} -> ${binTarget}.`,
			});
		}

		const binTargetPath = repoPath(join(packagePath, binTarget));
		if (!existsSync(binTargetPath)) {
			findings.push({
				path: displayPath(binTargetPath),
				message: `Missing bin target for ${binName}.`,
			});
			continue;
		}

		if ((statSync(binTargetPath).mode & 0o111) === 0) {
			findings.push({
				path: displayPath(binTargetPath),
				message: `Bin target for ${binName} is not executable.`,
			});
		}

		const expectedShebang = expectedShebangForBinTarget(binTarget);
		const actualShebang = readFirstLine(binTargetPath);

		if (expectedShebang && actualShebang !== expectedShebang) {
			findings.push({
				path: displayPath(binTargetPath),
				message: `Bin target for ${binName} must start with ${expectedShebang}.`,
			});
		}
	}
}

for (const [packagePath, workspacePackage] of workspacePackagesByPath) {
	const localScripts = discoverLocalScripts(workspacePackage.packageJson);
	const allowedScriptNames = new Set(Object.keys(localScripts));

	if (allowedScriptNames.size === 0) {
		continue;
	}

	for (const contractPath of discoverContractPaths(packagePath)) {
		const contractText = readFileSync(repoPath(contractPath), "utf8");

		const scriptValueMatches = contractText.matchAll(/script:\s*"([^"]+)"/g);

		for (const scriptValueMatch of scriptValueMatches) {
			const scriptValue = scriptValueMatch[1];

			if (!allowedScriptNames.has(scriptValue)) {
				findings.push({
					path: contractPath,
					message: `Command metadata script ${scriptValue} must be a declared local command name for ${packagePath}; contracts name command identity, not bun run, dist, src, or local paths.`,
				});
			}
		}
	}
}

if (findings.length > 0) {
	console.error("Workspace facade invariant check failed:");
	for (const finding of findings) {
		console.error(`- ${finding.path}: ${finding.message}`);
	}
	process.exit(1);
}

console.log("Workspace facade invariant check passed.");
