#!/usr/bin/env bun

/**
 * browser-domain-memory prerequisite preflight.
 *
 * The executable gate later browser-domain-memory units run before touching
 * runtime work. It proves three readiness surfaces and exits:
 *
 *  1. prototype evidence (the active plan's lift sources),
 *  2. root deterministic-replay runtime dependencies, and
 *  3. the script-local private facade package.
 *
 * It does NOT expose capture, replay, config, storage, auth, or promotion
 * commands. It is a readiness gate, not the browser-domain-memory CLI.
 *
 * Output: a small machine-readable result on stdout. Exit 0 = ready, exit 1 =
 * a prerequisite is missing (the result names which one and the repair action),
 * exit 2 = usage error.
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import {
	type CheckResult,
	REPO_ROOT,
	SCRIPT_DIR,
	allOk,
	checkPrototypeEvidence,
} from "./prerequisites";

const VERSION = "0.1.0";
const READY_EXIT_CODE = 0;
const NOT_READY_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;

/** Root deterministic-replay deps required by R4/R5. */
export const REQUIRED_REPLAY_PACKAGES = [
	{
		name: "@puppeteer/replay",
		reason:
			"Recorder JSON parsing/replay for deterministic mode. Add to root package.json.",
	},
	{
		name: "puppeteer-core",
		reason:
			"Direct browser driver. `puppeteer` is only an optional peer; no driver exists without puppeteer-core. Add to root package.json.",
	},
] as const;

/** Script-local private facade package required by R6/R7. */
export const FACADE_PACKAGE = "@side-quest/cli-command-facade";

export type PreflightCheckGroup = {
	readonly surface: "prototype_evidence" | "replay_dependencies" | "facade_package";
	readonly ok: boolean;
	readonly checks: readonly CheckResult[];
};

export type PreflightResult = {
	readonly ok: boolean;
	readonly contract: "browser-domain-memory.prerequisites";
	readonly schema_version: "1";
	readonly version: string;
	readonly surfaces: readonly PreflightCheckGroup["surface"][];
	readonly groups: readonly PreflightCheckGroup[];
	/** Ordered, deduped repair actions for every failing check. */
	readonly repair_actions: readonly string[];
};

/** A package's resolution outcome: present (with version) or missing. */
export type PackageResolution = {
	readonly resolved: boolean;
	readonly version: string | null;
};

export type PreflightOptions = {
	readonly repoRoot?: string;
	readonly scriptDir?: string;
	/** Override package resolution (tests stub this). */
	readonly resolvePackage?: (name: string, fromDir: string) => PackageResolution;
};

/**
 * Resolve a package from a base directory, reading its declared version from
 * the package's own package.json. Uses createRequire so resolution honours the
 * node_modules surface at `fromDir` (R5/R6: deps must resolve from where
 * runtime code will load them, not from a sibling skill's link).
 */
function defaultResolvePackage(
	name: string,
	fromDir: string,
): PackageResolution {
	const require = createRequire(join(fromDir, "package.json"));
	let manifestPath: string;
	try {
		manifestPath = require.resolve(`${name}/package.json`);
	} catch {
		// Fall back to entry resolution: a package may not export package.json.
		try {
			require.resolve(name);
			return { resolved: true, version: null };
		} catch {
			return { resolved: false, version: null };
		}
	}
	try {
		const manifest = require(manifestPath) as { version?: string };
		return { resolved: true, version: manifest.version ?? null };
	} catch {
		return { resolved: true, version: null };
	}
}

/** Check the required root deterministic-replay dependencies (R4/R5). */
export async function checkReplayDependencies(
	options: PreflightOptions = {},
): Promise<CheckResult[]> {
	const repoRoot = options.repoRoot ?? REPO_ROOT;
	const resolvePackage = options.resolvePackage ?? defaultResolvePackage;

	return REQUIRED_REPLAY_PACKAGES.map((pkg) => {
		const resolution = resolvePackage(pkg.name, repoRoot);
		if (!resolution.resolved) {
			return {
				ok: false,
				id: pkg.name,
				detail: `missing root dependency ${pkg.name}: ${pkg.reason}`,
			} satisfies CheckResult;
		}
		return {
			ok: true,
			id: pkg.name,
			detail: resolution.version
				? `present: ${pkg.name}@${resolution.version}`
				: `present: ${pkg.name}`,
		} satisfies CheckResult;
	});
}

/** Check the script-local private facade package (R6/R7). */
export async function checkFacadePackage(
	options: PreflightOptions = {},
): Promise<CheckResult[]> {
	const scriptDir = options.scriptDir ?? SCRIPT_DIR;
	const resolvePackage = options.resolvePackage ?? defaultResolvePackage;

	const resolution = resolvePackage(FACADE_PACKAGE, scriptDir);
	if (!resolution.resolved) {
		return [
			{
				ok: false,
				id: FACADE_PACKAGE,
				detail:
					`missing private package ${FACADE_PACKAGE} from skills/browser-domain-memory/scripts/. ` +
					"It is not on the public registry. Repair the script-local private link " +
					"(mirror skills/browser-use/scripts/), not a generic package install.",
			},
		];
	}
	return [
		{
			ok: true,
			id: FACADE_PACKAGE,
			detail: resolution.version
				? `present: ${FACADE_PACKAGE}@${resolution.version} (resolved from skills/browser-domain-memory/scripts/)`
				: `present: ${FACADE_PACKAGE} (resolved from skills/browser-domain-memory/scripts/)`,
		},
	];
}

/** Run every prerequisite check and assemble the machine-readable result. */
export async function runPreflight(
	options: PreflightOptions = {},
): Promise<PreflightResult> {
	const [prototype, replay, facade] = await Promise.all([
		checkPrototypeEvidence(options.repoRoot ?? REPO_ROOT),
		checkReplayDependencies(options),
		checkFacadePackage(options),
	]);

	const groups: PreflightCheckGroup[] = [
		{ surface: "prototype_evidence", ok: allOk(prototype), checks: prototype },
		{ surface: "replay_dependencies", ok: allOk(replay), checks: replay },
		{ surface: "facade_package", ok: allOk(facade), checks: facade },
	];

	const repairActions = Array.from(
		new Set(
			groups
				.flatMap((group) => group.checks)
				.filter((check) => !check.ok)
				.map((check) => check.detail),
		),
	);

	return {
		ok: groups.every((group) => group.ok),
		contract: "browser-domain-memory.prerequisites",
		schema_version: "1",
		version: VERSION,
		surfaces: groups.map((group) => group.surface),
		groups,
		repair_actions: repairActions,
	};
}

type ParsedArgv =
	| { kind: "help" }
	| { kind: "version" }
	| { kind: "run"; json: boolean }
	| { kind: "usage_error"; message: string };

export function parseArgv(argv: readonly string[]): ParsedArgv {
	let json = false;
	for (const arg of argv) {
		switch (arg) {
			case "-h":
			case "--help":
				return { kind: "help" };
			case "--version":
				return { kind: "version" };
			case "--json":
				json = true;
				break;
			default:
				return { kind: "usage_error", message: `unknown argument: ${arg}` };
		}
	}
	return { kind: "run", json };
}

const USAGE = `browser-domain-memory-prerequisites — readiness gate

Usage:
  browser-domain-memory-prerequisites [--json]
  browser-domain-memory-prerequisites --help | --version

Checks prototype evidence, root replay dependencies, and the script-local
facade package. Exit 0 = ready, 1 = a prerequisite is missing, 2 = usage error.`;

function renderPlain(result: PreflightResult): string {
	const lines = [`prerequisites: ${result.ok ? "ready" : "not ready"}`];
	for (const group of result.groups) {
		lines.push(`  ${group.surface}: ${group.ok ? "ok" : "FAIL"}`);
		for (const check of group.checks) {
			if (!check.ok) lines.push(`    - ${check.detail}`);
		}
	}
	return lines.join("\n");
}

export async function main(
	argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
	const parsed = parseArgv(argv);
	switch (parsed.kind) {
		case "help":
			process.stdout.write(`${USAGE}\n`);
			return READY_EXIT_CODE;
		case "version":
			process.stdout.write(`${VERSION}\n`);
			return READY_EXIT_CODE;
		case "usage_error":
			process.stderr.write(`${parsed.message}\n\n${USAGE}\n`);
			return USAGE_EXIT_CODE;
		case "run": {
			const result = await runPreflight();
			if (parsed.json) {
				process.stdout.write(`${JSON.stringify(result)}\n`);
			} else {
				process.stdout.write(`${renderPlain(result)}\n`);
			}
			return result.ok ? READY_EXIT_CODE : NOT_READY_EXIT_CODE;
		}
	}
}

if (import.meta.main) {
	main().then((code) => {
		process.exitCode = code;
	});
}
