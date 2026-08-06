#!/usr/bin/env bun

/**
 * PostToolUse hook: run Biome on files an agent just edited.
 *
 * Adapted from side-quest-engineering's biome-runner plugin setup. This hook
 * stays non-blocking unless Biome reports errors for the edited files.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const BIOME_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".json", ".jsonc", ".css"];

interface HookInput {
	tool_name: string;
	tool_input?: {
		file_path?: string;
		edits?: Array<{ file_path?: string }>;
	};
}

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

function extractFilePaths(input: HookInput): string[] {
	const seen = new Set<string>();
	if (input.tool_input?.file_path) seen.add(input.tool_input.file_path);
	for (const edit of input.tool_input?.edits ?? []) {
		if (edit.file_path) seen.add(edit.file_path);
	}
	return [...seen].filter((file) => BIOME_EXTENSIONS.some((extension) => file.endsWith(extension)));
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

async function getGitRoot(): Promise<string | null> {
	const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout] = await Promise.all([proc.exited, proc.stdout.text()]);
	if (exitCode !== 0) return null;
	return stdout.trim() || null;
}

async function main(): Promise<void> {
	let input: HookInput;
	try {
		input = (await Bun.stdin.json()) as HookInput;
	} catch {
		process.exit(0);
	}

	const filePaths = extractFilePaths(input);
	if (filePaths.length === 0) process.exit(0);

	const gitRoot = await getGitRoot();
	if (!gitRoot) process.exit(0);
	if (!existsSync(`${gitRoot}/biome.json`) && !existsSync(`${gitRoot}/biome.jsonc`)) process.exit(0);

	const proc = Bun.spawn(
		[
			"bunx",
			"@biomejs/biome",
			"check",
			"--diagnostic-level=error",
			"--reporter=json",
			"--",
			...filePaths.map((file) => resolve(file)),
		],
		{
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, CI: "true" },
		},
	);
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

	process.stdout.write(
		JSON.stringify({
			decision: "block",
			reason: `${errors.length} Biome error(s) in edited files`,
			hookSpecificOutput: {
				hookEventName: "PostToolUse",
				additionalContext: errors
					.slice(0, 20)
					.map((error) => `${error.file}:${error.line} [${error.code}] ${error.message}`)
					.join("\n"),
			},
		}),
	);
	process.exit(0);
}

if (import.meta.main) {
	const selfDestruct = setTimeout(() => {
		process.stderr.write("biome-check: timed out\n");
		process.exit(0);
	}, 24_000);
	selfDestruct.unref();
	main();
}
