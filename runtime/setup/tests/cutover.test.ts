import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import {
	AGENT_SKILLS_FEATURE_DISPOSITION,
	INSTALL_SH_FEATURE_DISPOSITION,
	SETUP_COMMANDS,
} from "../src/model.ts";
import { hashHookBytes } from "../src/hook-provenance.ts";

const repoRoot = resolve(import.meta.dir, "../../..");
const retiredProjector = ["agent", "skills"].join("-");
const retiredInstaller = ["install", "sh"].join(".");
const retiredHookInstaller = ["scripts", "install-git-hooks.sh"].join("/");
const historicalRoutePrefixes = [
	"archive/",
	"context/archive/",
	"docs/brainstorms/",
	"docs/decisions/",
	"docs/ideation/",
	"docs/plans/",
	"docs/prompts/",
	"docs/research/",
	"docs/runbooks/",
	"docs/scratch/",
	"prompts/",
	"research/",
	"runtime/setup/tests/",
	"scratch/",
];
const historicalRouteFiles = new Set(["TASKS.md"]);

describe("setup owner cutover", () => {
	test("pins every retained and dropped legacy capability", () => {
		expect(AGENT_SKILLS_FEATURE_DISPOSITION).toEqual({
			status: "keep",
			check_apply: "keep",
			managed_unlink: "keep",
			command_discovery: "keep",
			catalog_visibility: "keep",
			external_preservation: "keep",
			canonical_safety: "keep",
			ignore_editing: "drop",
			new_since_snapshot: "drop",
			custom_roots_and_catalogs: "drop",
			external_acquisition: "external",
		});
		expect(INSTALL_SH_FEATURE_DISPOSITION).toEqual({
			startup_links: "keep",
			hook_installation: "keep_stronger_safety",
			instruction_health: "keep",
			runbook_artifact: "keep",
			status: "keep",
			unlink: "keep_narrower_proof",
			whole_folder_claude_skills: "replace",
			legacy_codex_skills: "replace",
		});
	});

	test("removes legacy executable owners and workspace records", () => {
		expect(existsSync(join(repoRoot, retiredInstaller))).toBe(false);
		expect(existsSync(join(repoRoot, "runtime", retiredProjector))).toBe(false);
		expect(existsSync(join(repoRoot, retiredHookInstaller))).toBe(false);

		const lock = readFileSync(join(repoRoot, "bun.lock"), "utf8");
		expect(lock).not.toContain(`runtime/${retiredProjector}`);
		expect(lock).not.toContain(`"${retiredProjector}":`);
	});

	test("rejects retired routes across git-tracked operational files", () => {
		const tracked = Bun.spawnSync(["git", "-C", repoRoot, "ls-files", "-z"]);
		expect(tracked.exitCode).toBe(0);
		const files = new TextDecoder()
			.decode(tracked.stdout)
			.split("\0")
			.filter((file) => file !== "")
			.filter((file) => !historicalRouteFiles.has(file))
			.filter((file) => historicalRoutePrefixes.every((prefix) => !file.startsWith(prefix)))
			.filter((file) => !file.includes("/tests/"))
			.filter((file) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file));
		const retiredRoutes = [
			{ id: "root_installer", pattern: /(?:^|[\s`'"])(?:\.\/)?install\.sh(?:$|[\s`'"])/mu },
			{ id: "hook_installer", pattern: /scripts\/install-git-hooks\.sh/u },
			{ id: "projector_command", pattern: /agent-skills\s+(?:status|sync|unlink|list|ignore|commands)\b/u },
			{ id: "projector_import", pattern: /runtime\/agent-skills/u },
			{ id: "projector_snapshot", pattern: /\.agents\/agent-skills-snapshot\.json/u },
			{ id: "projector_config", pattern: /\.agent-skills\.ya?ml/u },
		];
		const findings: string[] = [];
		for (const file of files) {
			const text = readFileSync(join(repoRoot, file), "utf8");
			for (const route of retiredRoutes) {
				if (route.pattern.test(text)) findings.push(`${file}:${route.id}`);
			}
		}
		expect(findings).toEqual([]);

		const startup = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
		expect(startup).toContain("After any first-party skill change");
		expect(startup).toContain("setup sync --check --json");
		expect(startup).toContain("$HOME/code/claude-code-config/");
		expect(startup).not.toMatch(/`(?:\.\/setup|skills\/|context\/|docs\/git\/|scripts\/agent-instructions\.sh)/u);
		expect(startup).toContain("bunx skills add");
	});

	test("keeps every third-party package mutation outside Setup", () => {
		expect(SETUP_COMMANDS).not.toContain("add" as never);
		expect(SETUP_COMMANDS).not.toContain("update" as never);
		expect(SETUP_COMMANDS).not.toContain("restore" as never);
		expect(SETUP_COMMANDS).not.toContain("remove" as never);

		const guidance = [
			readFileSync(join(repoRoot, "runtime/setup/src/ownership.ts"), "utf8"),
			readFileSync(join(repoRoot, "runtime/setup/src/provider-evidence.ts"), "utf8"),
			readFileSync(join(repoRoot, "README.md"), "utf8"),
		].join("\n");
		expect(guidance).toContain("bunx skills");
	});

	test("pins both migration predecessors while the released hook delegates staged health", () => {
		const fixtures = [
			["pre-commit-setup-v1", "462ff0f88ce44e72474d8aea4a0bbf567962d1604d6b43b955e949d59652eede"],
			["pre-commit-legacy-installer", "c58eb459e043374bf66e5da2a65fe4f9e4d8ce3aca1daeb9127087e296fe517f"],
		] as const;
		for (const [name, expectedDigest] of fixtures) {
			const bytes = readFileSync(join(repoRoot, "runtime/setup/tests/fixtures", name));
			expect(hashHookBytes(bytes)).toBe(expectedDigest);
		}

		const hook = readFileSync(join(repoRoot, "scripts/hooks/pre-commit"), "utf8");
		expect(hook).toMatch(/AGENT_INSTRUCTIONS_CHECK_STAGED=1 bash "\$\{CHECK_SCRIPT\}" check/u);
		expect(hook).not.toContain("PROMPT_SYSTEM_PATHS");
		expect(hook).not.toMatch(/git\s+diff\s+--cached/u);
	});
});
