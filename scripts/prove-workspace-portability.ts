#!/usr/bin/env bun

import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type CommandStep = {
	label: string;
	command: string[];
};

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const tempRoot = mkTempRoot();
const keepExport = Bun.argv.includes("--keep");
const exportPaths = [
	"package.json",
	"bun.lock",
	"scripts/check-workspace-facade-invariants.ts",
	"scripts/prove-workspace-portability.ts",
	"runtime/cli-command-facade",
	"skills/browser-use",
	"skills/create-cli/scripts",
	"skills/fallow",
	"skills/test-runner",
];
const excludedNames = new Set([
	".git",
	".DS_Store",
	"node_modules",
	"tsconfig.tsbuildinfo",
]);
const excludedRelativePaths = new Set([
	"skills/test-runner/scripts/.runner-output",
	"skills/test-runner/scripts/.benchmark-output",
	"skills/test-runner/scripts/var",
]);
const commands: CommandStep[] = [
	{
		label: "Install frozen workspace dependencies",
		command: ["bun", "install", "--frozen-lockfile"],
	},
	{
		label: "Check workspace facade invariants",
		command: ["bun", "run", "check:workspace-facade"],
	},
	{
		label: "Facade runtime typecheck",
		command: ["bun", "--filter", "@side-quest/cli-command-facade", "typecheck"],
	},
	{
		label: "Facade runtime tests",
		command: ["bun", "--filter", "@side-quest/cli-command-facade", "test"],
	},
	{
		label: "browser-use typecheck",
		command: ["bun", "--filter", "browser-use-scripts", "typecheck"],
	},
	{
		label: "browser-use tests",
		command: ["bun", "--filter", "browser-use-scripts", "test"],
	},
	{
		label: "create-cli typecheck",
		command: ["bun", "--filter", "create-cli-scripts", "typecheck"],
	},
	{
		label: "create-cli smoke",
		command: ["bun", "--filter", "create-cli-scripts", "smoke"],
	},
	{
		label: "fallow typecheck",
		command: ["bun", "--filter", "fallow-scripts", "typecheck"],
	},
	{
		label: "fallow tests",
		command: ["bun", "--filter", "fallow-scripts", "test"],
	},
	{
		label: "test-runner typecheck",
		command: ["bun", "--filter", "test-runner-scripts", "typecheck"],
	},
	{
		label: "test-runner tests",
		command: ["bun", "--filter", "test-runner-scripts", "test"],
	},
];

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
