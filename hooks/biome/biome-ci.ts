#!/usr/bin/env bun

/**
 * Stop hook: run a project-wide Biome check when Biome-relevant files changed.
 *
 * Adapted from side-quest-engineering's biome-runner plugin setup. Warnings are
 * allowed through so existing style debt does not create end-of-session noise.
 */

import { existsSync } from "node:fs";

const BIOME_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".json", ".jsonc", ".css"];

interface BiomeDiagnostic {
	file: string;
	line: number;
	message: string;
	code: string;
	severity: "error" | "warning";
}

interface BiomeReporterDiagnostic {
	severity?: string;
	description?: string;
	message?: string;
	category?: string;
	location?: {
		path?: string;
		start?: {
			line?: number;
		};
	};
}

async function getGitRoot(): Promise<string | null> {
	const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout] = await Promise.all([proc.exited, proc.stdout.text()]);
	if (exitCode !== 0) return null;
	return stdout.trim() || null;
}

async function hasChangedBiomeFiles(): Promise<boolean> {
	const commands = [
		["git", "diff", "--cached", "--name-only", "--diff-filter=d"],
		["git", "diff", "--name-only", "--diff-filter=d"],
		["git", "ls-files", "--others", "--exclude-standard"],
	];
	const outputs = await Promise.all(
		commands.map(async (command) => {
			const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
			const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
			return stdout;
		}),
	);
	return outputs.some((output) =>
		output
			.trim()
			.split("\n")
			.some((file) => file && BIOME_EXTENSIONS.some((extension) => file.endsWith(extension))),
	);
}

function parseBiomeOutput(output: string): BiomeDiagnostic[] {
	try {
		const report = JSON.parse(output) as { diagnostics?: BiomeReporterDiagnostic[] };
		return (report.diagnostics ?? [])
			.filter((diagnostic) => diagnostic.severity === "error" || diagnostic.severity === "warning")
			.map((diagnostic) => ({
				file: diagnostic.location?.path ?? "unknown",
				line: diagnostic.location?.start?.line ?? 0,
				message: diagnostic.description ?? diagnostic.message ?? "Unknown issue",
				code: diagnostic.category ?? "unknown",
				severity: diagnostic.severity as "error" | "warning",
			}));
	} catch {
		return [];
	}
}

async function main(): Promise<void> {
	try {
		const raw = await Bun.stdin.text();
		if (raw.trim()) {
			const input = JSON.parse(raw) as { stop_hook_active?: boolean };
			if (input.stop_hook_active === true) process.exit(0);
		}
	} catch {
		// Empty or non-JSON stdin should not block the stop hook.
	}

	const gitRoot = await getGitRoot();
	if (!gitRoot) process.exit(0);
	if (!(await hasChangedBiomeFiles())) process.exit(0);
	if (!existsSync(`${gitRoot}/biome.json`) && !existsSync(`${gitRoot}/biome.jsonc`)) process.exit(0);

	const proc = Bun.spawn(["bunx", "@biomejs/biome", "check", "--diagnostic-level=error", "--reporter=json", gitRoot], {
		cwd: gitRoot,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, CI: "true" },
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		proc.stdout.text(),
		proc.stderr.text(),
	]);

	if (exitCode === 0) process.exit(0);

	const diagnostics = parseBiomeOutput(stdout);
	const fallbackDiagnostics = diagnostics.length > 0 ? diagnostics : parseBiomeOutput(stderr);
	const errors = fallbackDiagnostics.filter((diagnostic) => diagnostic.severity === "error");
	if (errors.length === 0) process.exit(0);

	process.stderr.write(
		JSON.stringify({
			tool: "biome-ci",
			status: "error",
			errorCount: errors.length,
			errors: errors.slice(0, 30).map((error) => ({
				file: error.file,
				line: error.line,
				message: `[${error.code}] ${error.message}`,
			})),
		}),
	);
	process.exit(2);
}

if (import.meta.main) {
	const selfDestruct = setTimeout(() => {
		process.stderr.write("biome-ci: timed out\n");
		process.exit(0);
	}, 96_000);
	selfDestruct.unref();
	main();
}
