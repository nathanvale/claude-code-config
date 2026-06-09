#!/usr/bin/env bun

import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type Workspaces =
	| string[]
	| {
			packages?: string[];
	  };

type PackageJson = {
	name?: string;
	workspaces?: Workspaces;
	scripts?: Record<string, string>;
};

type CommandStep = {
	label: string;
	command: string[];
};

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const tempRoot = mkTempRoot();
const keepExport = Bun.argv.includes("--keep");
const rootExportPaths = [
	"package.json",
	"bun.lock",
	"scripts/check-workspace-facade-invariants.ts",
	"scripts/prove-workspace-portability.ts",
];
const excludedNames = new Set([
	".git",
	".DS_Store",
	"node_modules",
	"tsconfig.tsbuildinfo",
]);
const excludedRelativePaths = new Set([
	"skills/browser-use/dist",
	"skills/test-runner/var",
]);
const portableVerificationScripts = ["typecheck", "test", "smoke", "pack:dry-run"];
const rootPackageJson = readPackageJson("package.json");
const workspacePackagePaths = discoverWorkspacePackagePaths(rootPackageJson);
const exportPaths = [...rootExportPaths, ...workspacePackagePaths];
const commands = buildCommandSteps(workspacePackagePaths);

function readPackageJson(relativePath: string): PackageJson {
	const absolutePath = join(repoRoot, relativePath);

	if (!existsSync(absolutePath)) {
		throw new Error(`Missing package metadata: ${relativePath}`);
	}

	try {
		return JSON.parse(readFileSync(absolutePath, "utf8")) as PackageJson;
	} catch (error) {
		throw new Error(
			`Invalid JSON in ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function workspaceEntries(workspaces: Workspaces | undefined): string[] {
	if (Array.isArray(workspaces)) {
		return workspaces;
	}

	return workspaces?.packages ?? [];
}

function expandWorkspaceEntry(workspaceEntry: string): string[] {
	if (!workspaceEntry.endsWith("/*")) {
		return existsSync(join(repoRoot, workspaceEntry, "package.json"))
			? [workspaceEntry]
			: [];
	}

	const parentPath = workspaceEntry.slice(0, -2);
	const absoluteParentPath = join(repoRoot, parentPath);

	if (!existsSync(absoluteParentPath)) {
		return [];
	}

	return readdirSync(absoluteParentPath)
		.map((entry) => join(parentPath, entry))
		.filter((packagePath) =>
			existsSync(join(repoRoot, packagePath, "package.json")),
		)
		.sort();
}

function discoverWorkspacePackagePaths(rootPackage: PackageJson): string[] {
	const packagePaths = new Set<string>();

	for (const workspaceEntry of workspaceEntries(rootPackage.workspaces)) {
		for (const packagePath of expandWorkspaceEntry(workspaceEntry)) {
			packagePaths.add(packagePath);
		}
	}

	return [...packagePaths].sort();
}

function buildCommandSteps(packagePaths: string[]): CommandStep[] {
	const steps: CommandStep[] = [
		{
			label: "Install frozen workspace dependencies",
			command: ["bun", "install", "--frozen-lockfile"],
		},
		{
			label: "Check workspace facade invariants",
			command: ["bun", "run", "check:workspace-facade"],
		},
	];

	for (const packagePath of packagePaths) {
		const packageJson = readPackageJson(join(packagePath, "package.json"));
		const packageName = packageJson.name;

		if (!packageName) {
			throw new Error(`Missing package name in ${packagePath}/package.json`);
		}

		for (const scriptName of portableVerificationScripts) {
			if (!packageJson.scripts?.[scriptName]) {
				continue;
			}

			steps.push({
				label: `${packageName} ${scriptName}`,
				command: ["bun", "--filter", packageName, scriptName],
			});
		}
	}

	return steps;
}

function mkTempRoot(): string {
	const root = join(
		tmpdir(),
		`claude-code-config-portability-${Date.now()}-${Math.random()
			.toString(36)
			.slice(2, 8)}`,
	);
	mkdirSync(root, { recursive: true });
	return root;
}

function shouldCopy(source: string): boolean {
	const name = basename(source);
	const sourceRelativePath = relative(repoRoot, source);

	if (excludedNames.has(name)) {
		return false;
	}

	for (const excludedPath of excludedRelativePaths) {
		if (
			sourceRelativePath === excludedPath ||
			sourceRelativePath.startsWith(`${excludedPath}/`)
		) {
			return false;
		}
	}

	return true;
}

function copyExportPayload(): void {
	for (const path of exportPaths) {
		const source = join(repoRoot, path);
		const target = join(tempRoot, path);

		if (!existsSync(source)) {
			throw new Error(`Missing export payload path: ${path}`);
		}

		mkdirSync(join(target, ".."), { recursive: true });
		cpSync(source, target, {
			recursive: true,
			filter: shouldCopy,
			force: true,
			errorOnExist: false,
		});
	}
}

function runStep(step: CommandStep): void {
	console.log(`==> ${step.label}`);
	console.log(`$ ${step.command.join(" ")}`);

	const result = spawnSync(step.command[0], step.command.slice(1), {
		cwd: tempRoot,
		env: process.env,
		stdio: "inherit",
	});

	if (result.error) {
		throw result.error;
	}

	if (result.status !== 0) {
		throw new Error(`${step.label} failed with exit ${result.status ?? "null"}`);
	}
}

function writeProofReceipt(): void {
	const receiptPath = join(tempRoot, "PORTABILITY-PROOF.json");
	const receipt = {
		status: "passed",
		source: repoRoot,
		export_root: tempRoot,
		payload: exportPaths,
		excluded: [...excludedNames, ...excludedRelativePaths],
		commands: commands.map((step) => step.command),
	};

	writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
	console.log(`Proof receipt: ${receiptPath}`);
}

try {
	copyExportPayload();
	for (const step of commands) {
		runStep(step);
	}
	writeProofReceipt();
	console.log(`Workspace portability proof passed: ${tempRoot}`);

	if (!keepExport) {
		const receipt = readFileSync(
			join(tempRoot, "PORTABILITY-PROOF.json"),
			"utf8",
		);
		rmSync(tempRoot, { recursive: true, force: true });
		console.log("Temporary export removed. Rerun with --keep to inspect it.");
		console.log(receipt);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	console.error(`Temporary export kept for inspection: ${tempRoot}`);
	process.exit(1);
}
