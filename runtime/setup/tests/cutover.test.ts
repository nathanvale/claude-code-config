import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import {
	AGENT_SKILLS_FEATURE_DISPOSITION,
	INSTALL_SH_FEATURE_DISPOSITION,
	SETUP_COMMANDS,
} from "../src/model.ts";

const repoRoot = resolve(import.meta.dir, "../../..");
const retiredProjector = ["agent", "skills"].join("-");
const retiredInstaller = ["install", "sh"].join(".");
const retiredHookInstaller = ["scripts", "install-git-hooks.sh"].join("/");

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

	test("routes active setup guidance to Setup plus bunx skills", () => {
		const activeFiles = [
			"AGENTS.md",
			"README.md",
			"docs/git/worktree.md",
			"agents/prompt-contract-auditor.md",
			"scripts/hooks/pre-commit",
			"runbooks/issue-to-pr-v2/README.md",
			"runbooks/issue-to-pr-v2/references/host-adapters.md",
		];
		for (const file of activeFiles) {
			const text = readFileSync(join(repoRoot, file), "utf8");
			expect(text, file).not.toContain(retiredInstaller);
			expect(text, file).not.toContain(retiredHookInstaller);
			expect(text, file).not.toMatch(new RegExp(`${retiredProjector}\\s+(status|sync|unlink|list|ignore|commands)`, "u"));
		}

		const startup = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
		expect(startup).toContain("./setup sync --check --json");
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
});
