#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

type PackageJson = {
	name?: string;
	private?: boolean;
	workspaces?: string[];
	bin?: Record<string, string> | string;
	scripts?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
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
	"skills/browser-use/scripts",
	"skills/create-cli/scripts",
	"skills/fallow/scripts",
	"skills/test-runner/scripts",
];
const facadeConsumers = activeWorkspacePackages.filter(
	(packagePath) => packagePath !== facadePackage,
);
const requiredWorkspaceGlobs = [
	"runtime/*",
	"skills/browser-use/scripts",
	"skills/create-cli/scripts",
	"skills/fallow/scripts",
	"skills/test-runner/scripts",
];
const expectedBins = {
	"skills/browser-use/scripts": {
		"browser-adapter-map": "./browser-adapter-map.sh",
		"browser-adapter-router": "./browser-adapter-router.sh",
		"browser-use": "./browser-use.sh",
		"preflight-browser-adapter": "./preflight-browser-adapter.sh",
		"preflight-warm-chrome": "./preflight-warm-chrome.sh",
	},
	"skills/create-cli/scripts": {
		"create-cli-facade-smoke": "./facade-resolution-smoke.ts",
	},
	"skills/fallow/scripts": {
		"fallow-runner": "./fallow-runner.ts",
	},
	"skills/test-runner/scripts": {
		"test-runner": "./test-runner.sh",
		"test-runner-benchmark": "./test-runner.benchmark.ts",
	},
} satisfies Record<string, Record<string, string>>;
const commandContractPaths = [
	"skills/browser-use/scripts/command-contract.ts",
	"skills/fallow/scripts/command-contract.ts",
	"skills/test-runner/scripts/command-contract.ts",
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
	const packageBins =
		typeof packageJson?.bin === "string" ? {} : (packageJson?.bin ?? {});
	const packageScripts = packageJson?.scripts ?? {};

	for (const [binName, binTarget] of Object.entries(bins)) {
		if (packageBins[binName] !== binTarget) {
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
