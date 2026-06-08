#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

type PackageJson = {
	name?: string;
	version?: string;
	description?: string;
	license?: string;
	private?: boolean;
	workspaces?: string[];
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

type Finding = {
	path: string;
	message: string;
};

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const facadePackage = "runtime/cli-command-facade";
const facadeName = "@side-quest/cli-command-facade";
const activeWorkspacePackages = [
	facadePackage,
	"skills/browser-use",
	"skills/create-cli",
	"skills/fallow",
	"skills/test-runner",
];
const facadeConsumers = activeWorkspacePackages.filter(
	(packagePath) => packagePath !== facadePackage,
);
const requiredWorkspaceGlobs = [
	"runtime/*",
	"skills/browser-use",
	"skills/create-cli",
	"skills/fallow",
	"skills/test-runner",
];
const expectedBins = {
	"skills/browser-use": {
		"browser-adapter-map": "./src/browser-adapter-map.ts",
		"browser-adapter-router": "./src/browser-adapter-router.ts",
		"browser-use": "./src/browser-use.ts",
		"preflight-browser-adapter": "./src/preflight-browser-adapter.ts",
		"preflight-warm-chrome": "./src/preflight-warm-chrome.ts",
	},
	"skills/create-cli": {
		"create-cli-facade-smoke": "./src/facade-resolution-smoke.ts",
	},
	"skills/fallow": {
		"fallow-runner": "./src/fallow-runner.ts",
	},
	"skills/test-runner": {
		"test-runner": "./src/test-runner.sh",
		"test-runner-benchmark": "./src/test-runner.benchmark.ts",
	},
} satisfies Record<string, Record<string, string>>;
const commandContractPaths = [
	"skills/browser-use/src/command-contract.ts",
	"skills/fallow/src/command-contract.ts",
	"skills/test-runner/src/command-contract.ts",
];
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

	return JSON.parse(readFileSync(packagePath, "utf8")) as PackageJson;
}

function expectedShebangForBinTarget(binTarget: string): string | null {
	if (binTarget.endsWith(".ts")) {
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
			message: `Public package files allowlist includes test or fixture payload ${evidencePath}.`,
		});
	}

	for (const [binName, binTarget] of Object.entries(bins)) {
		if (files.length > 0 && !fileAllowlistCoversBin(files, binTarget)) {
			findings.push({
				path: packageJsonPath,
				message: `Public package files allowlist does not cover bin ${binName} -> ${binTarget}.`,
			});
		}

		if (binTarget.endsWith(".ts") && hasBlankValue(packageJson.engines?.bun)) {
			findings.push({
				path: packageJsonPath,
				message: `Direct TypeScript bin ${binName} needs engines.bun before private is false.`,
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
const rootWorkspaces = new Set(rootPackage?.workspaces ?? []);

for (const workspaceGlob of requiredWorkspaceGlobs) {
	if (!rootWorkspaces.has(workspaceGlob)) {
		findings.push({
			path: "package.json",
			message: `Missing workspace entry ${workspaceGlob}.`,
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
	const requiredLockMarkers = [
		`"${facadePackage}"`,
		`"name": "${facadeName}"`,
		`"${facadeName}": ["${facadeName}@workspace:${facadePackage}"]`,
	];

	for (const marker of requiredLockMarkers) {
		if (!rootLock.includes(marker)) {
			findings.push({
				path: "bun.lock",
				message: `Missing lockfile marker ${marker}.`,
			});
		}
	}

	for (const [packagePath, bins] of Object.entries(expectedBins)) {
		const packageMarker = `    "${packagePath}": {`;

		if (!rootLock.includes(packageMarker)) {
			findings.push({
				path: "bun.lock",
				message: `Missing lockfile workspace package marker ${packagePath}.`,
			});
			continue;
		}

		for (const [binName, binTarget] of Object.entries(bins)) {
			const binMarker = `        "${binName}": "${binTarget}",`;

			if (!rootLock.includes(binMarker)) {
				findings.push({
					path: "bun.lock",
					message: `Missing lockfile bin marker ${binName} -> ${binTarget}.`,
				});
			}
		}
	}
}

const facadePackageJson = readPackageJson(repoPath(facadePackage));
if (facadePackageJson?.name !== facadeName) {
	findings.push({
		path: `${facadePackage}/package.json`,
		message: `Facade package name must be ${facadeName}.`,
	});
}

for (const packagePath of activeWorkspacePackages) {
	const localLockfiles = walkForLocalLockfiles(repoPath(packagePath));
	const packageJson = readPackageJson(repoPath(packagePath));

	checkDistributionReadiness(packagePath, packageJson);

	for (const lockfile of localLockfiles) {
		findings.push({
			path: displayPath(lockfile),
			message: "Use the root Bun lockfile for active workspace packages.",
		});
	}
}

for (const packagePath of facadeConsumers) {
	const packageJson = readPackageJson(repoPath(packagePath));
	const facadeSpec =
		packageJson?.dependencies?.[facadeName] ??
		packageJson?.devDependencies?.[facadeName];

	if (facadeSpec !== "workspace:*") {
		findings.push({
			path: `${packagePath}/package.json`,
			message: `${facadeName} must use workspace:* in active consumers.`,
		});
	}
}

for (const [packagePath, bins] of Object.entries(expectedBins)) {
	const packageJson = readPackageJson(repoPath(packagePath));
	const binsByName = packageBins(packageJson);
	const packageScripts = packageJson?.scripts ?? {};

	for (const [binName, binTarget] of Object.entries(bins)) {
		if (binsByName[binName] !== binTarget) {
			findings.push({
				path: `${packagePath}/package.json`,
				message: `Missing bin ${binName} -> ${binTarget}.`,
			});
		}

		if (packageScripts[binName] !== binTarget) {
			findings.push({
				path: `${packagePath}/package.json`,
				message: `Missing local script ${binName} -> ${binTarget}.`,
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

for (const contractPath of commandContractPaths) {
	const contractText = readFileSync(repoPath(contractPath), "utf8");
	const rawScriptPathMatches = contractText.match(/script:\s*"scripts\//g) ?? [];

	if (rawScriptPathMatches.length > 0) {
		findings.push({
			path: contractPath,
			message: "Command metadata must advertise package bin names, not raw scripts/ paths.",
		});
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
