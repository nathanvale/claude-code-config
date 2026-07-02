#!/usr/bin/env bun

/**
 * Prove this repo works as a `bunx skills add` source.
 *
 * Runs the pinned provider's local-path discovery (`--list`; never installs)
 * against the target root and asserts every catalog id from `skills/<id>/SKILL.md`
 * appears in the listing. Pinned to skills@1.5.14 so an upstream `--list`
 * format change cannot silently break a Definition-of-Done gate.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PINNED_PROVIDER = "skills@1.5.14";
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const targetRoot = Bun.argv[2] ?? repoRoot;

function catalogIds(root: string): string[] {
	const catalog = join(root, "skills");
	if (!existsSync(catalog)) return [];
	return readdirSync(catalog, { withFileTypes: true })
		.filter(
			(entry) =>
				(entry.isDirectory() || entry.isSymbolicLink()) &&
				existsSync(join(catalog, entry.name, "SKILL.md")),
		)
		.map((entry) => entry.name)
		.sort();
}

function listedIds(root: string): string[] {
	const result = spawnSync(
		"bunx",
		[PINNED_PROVIDER, "add", root, "--list", "-y"],
		{ encoding: "utf8", timeout: 120_000 },
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`${PINNED_PROVIDER} add --list exited ${result.status ?? "null"}: ${(result.stderr || result.stdout).trim().slice(-500)}`,
		);
	}
	// Discovery output is a prompt-style tree; skill id lines are a lone token
	// after the box-drawing prefix. Strip ANSI first.
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes
	const plain = result.stdout.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
	const ids = new Set<string>();
	for (const line of plain.split("\n")) {
		const match = line.match(/^│\s+([a-z0-9][a-z0-9-]*)\s*$/);
		if (match?.[1]) ids.add(match[1]);
	}
	return [...ids].sort();
}

try {
	const expected = catalogIds(targetRoot);
	if (expected.length === 0) {
		console.error(
			`No catalog skills found under ${join(targetRoot, "skills")}; a skills source needs skills/<id>/SKILL.md entries.`,
		);
		process.exit(1);
	}
	const listed = new Set(listedIds(targetRoot));
	const missing = expected.filter((id) => !listed.has(id));
	if (missing.length > 0) {
		console.error(
			`Publisher check failed: ${missing.length} catalog id(s) missing from ${PINNED_PROVIDER} discovery: ${missing.join(", ")}`,
		);
		console.error(
			"Repair: check each missing skill's SKILL.md frontmatter (name/description) parses, then rerun bun run prove:skills-publisher.",
		);
		process.exit(1);
	}
	console.log(
		`Publisher check passed: ${expected.length}/${expected.length} catalog ids discoverable via ${PINNED_PROVIDER} (${listed.size} total listed).`,
	);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	console.error(
		"Repair: ensure bunx can fetch the pinned provider and the target root is a valid skills source, then rerun.",
	);
	process.exit(1);
}
