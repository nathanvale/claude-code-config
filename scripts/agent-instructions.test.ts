import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const repositoryRoot = resolve(import.meta.dir, "..");
const sourceScript = join(repositoryRoot, "scripts/agent-instructions.sh");
const vaultGitStartupRule =
	"The configured Super-vault in `~/.config/context/vault.md` is the sole exception: route vault writes through the `vault-git` skill; if it reports activation blocked, make scoped vault writes directly on `main` and preserve unrelated state; never create vault worktrees; allow only one canonical writer at a time.";

const registeredOwnerPaths = [
	"skills/productivity-connectors/SKILL.md",
	"context/bun-runner.md",
	"skills/skill-author/SKILL.md",
	"skills/skill-author/CONTEXT.md",
	"skills/skill-author/references/skill-design-decision-runbook.md",
	"context/personal.md",
	"context/vault.md",
	"context/comms-style.md",
	"context/tracker-links.md",
	"docs/git/conventions.md",
	"docs/git/workflows.md",
	"docs/git/worktree.md",
	"docs/agents/issue-tracker.md",
	"docs/agents/triage-labels.md",
	"docs/agents/domain.md",
	"skills/context-advisor/SKILL.md",
	"skills/context-advisor/references/storage-routing.md",
] as const;

interface ProcessResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

interface Fixture {
	root: string;
	repository: string;
	home: string;
	script: string;
}

interface StagedReport {
	status: "ok" | "warn" | "fail";
	staged: {
		requested: boolean;
		applicable: boolean | null;
		decision: "not_requested" | "not_applicable" | "applicable" | "inspection_failed";
		matched_paths: string[];
	};
	passes: string[];
	warnings: string[];
	failures: string[];
}

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): ProcessResult {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		env: options.env,
		encoding: "utf8",
	});
	return {
		exitCode: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function git(repository: string, args: string[]): ProcessResult {
	const result = run("git", ["-C", repository, ...args]);
	if (result.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	}
	return result;
}

function writeRepositoryFile(repository: string, path: string, contents = `${path}\n`): void {
	const target = join(repository, path);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, contents);
}

function createFixture(): Fixture {
	const root = mkdtempSync(join(tmpdir(), "agent-instructions-"));
	const repository = join(root, "repository");
	const home = join(root, "home");
	const script = join(repository, "scripts/agent-instructions.sh");
	mkdirSync(repository, { recursive: true });
	writeRepositoryFile(repository, "AGENTS.md", "# Agent instructions\n");
	writeRepositoryFile(repository, "CLAUDE.md", "# Claude wrapper\n");
	writeRepositoryFile(repository, "agent-instructions.config", "startup_owner=.\n");
	writeRepositoryFile(repository, "scripts/agent-instructions.sh", readFileSync(sourceScript, "utf8"));
	chmodSync(script, 0o755);
	for (const path of registeredOwnerPaths) {
		writeRepositoryFile(repository, path);
	}

	git(repository, ["init", "--quiet"]);
	git(repository, ["config", "user.name", "Agent Instructions Test"]);
	git(repository, ["config", "user.email", "agent-instructions@example.test"]);
	git(repository, ["add", "--all"]);
	git(repository, ["commit", "--quiet", "-m", "test: seed instruction topology"]);

	mkdirSync(join(home, ".codex"), { recursive: true });
	mkdirSync(join(home, ".claude"), { recursive: true });
	symlinkSync(join(repository, "AGENTS.md"), join(home, ".codex/AGENTS.md"));
	symlinkSync(join(repository, "AGENTS.md"), join(home, ".claude/AGENTS.md"));
	symlinkSync(join(repository, "CLAUDE.md"), join(home, ".claude/CLAUDE.md"));

	return { root, repository, home, script };
}

function withFixture(body: (fixture: Fixture) => void): void {
	const fixture = createFixture();
	try {
		body(fixture);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
}

function runScript(fixture: Fixture, args: string[]): ProcessResult {
	return run("bash", [fixture.script, ...args], {
		cwd: fixture.repository,
		env: { ...process.env, HOME: fixture.home },
	});
}

function parseReport(result: ProcessResult): StagedReport {
	try {
		return JSON.parse(result.stdout) as StagedReport;
	} catch (error) {
		throw new Error(
			`invalid JSON report (exit=${result.exitCode})\nstdout=${JSON.stringify(result.stdout)}\nstderr=${JSON.stringify(result.stderr)}`,
			{ cause: error },
		);
	}
}

function findContrastingSortLocale(): string | undefined {
	const locales = run("locale", ["-a"]);
	if (locales.exitCode !== 0) return undefined;

	return locales.stdout
		.split("\n")
		.find((locale) => {
			if (locale.length === 0) return false;
			const comparison = run("bash", ["-c", "[[ Z.md > a.md ]]"], {
				env: { ...process.env, LC_ALL: locale },
			});
			return comparison.exitCode === 0;
		});
}

describe("agent instruction staged health", () => {
	test("delivers the vault-git write route through both startup surfaces", () => {
		const agents = readFileSync(join(repositoryRoot, "AGENTS.md"), "utf8");
		expect(agents).toContain(vaultGitStartupRule);

		withFixture((fixture) => {
			writeFileSync(join(fixture.repository, "AGENTS.md"), agents);

			expect(readFileSync(join(fixture.home, ".codex/AGENTS.md"), "utf8")).toContain(
				vaultGitStartupRule,
			);
			expect(readFileSync(join(fixture.home, ".claude/AGENTS.md"), "utf8")).toContain(
				vaultGitStartupRule,
			);
			expect(runScript(fixture, ["check"]).exitCode).toBe(0);
		});
	});

	test("mirrors REGISTERED_OWNER_PATHS from the bash source exactly", () => {
		const source = readFileSync(sourceScript, "utf8");
		const block = source.match(/declare -a REGISTERED_OWNER_PATHS=\(\n(?<entries>[\s\S]*?)\n\)/u);
		if (!block?.groups?.entries) throw new Error("REGISTERED_OWNER_PATHS block not found in agent-instructions.sh");
		const parsed = [...block.groups.entries.matchAll(/"(?<path>[^"]+)"/gu)].map((entry) => entry.groups?.path);
		expect(parsed).toEqual([...registeredOwnerPaths]);
	});

	test("skips an empty index and unrelated broad siblings while unconditional check still runs", () => {
		withFixture((fixture) => {
			rmSync(join(fixture.repository, registeredOwnerPaths[0]));

			const empty = runScript(fixture, ["check", "--staged", "--json"]);
			expect(empty.exitCode).toBe(0);
			expect(parseReport(empty).staged).toEqual({
				requested: true,
				applicable: false,
				decision: "not_applicable",
				matched_paths: [],
			});

			const unrelatedPaths = [
				"skills/unregistered/SKILL.md",
				"context/unregistered.md",
				"rules/unregistered.md",
				"docs/adr/unregistered.md",
				"context/- leading [*]\tline\nname.md",
			];
			for (const path of unrelatedPaths) {
				writeRepositoryFile(fixture.repository, path);
			}
			git(fixture.repository, ["add", "--", ...unrelatedPaths]);
			const unrelated = runScript(fixture, ["check", "--staged", "--json"]);
			expect(unrelated.exitCode).toBe(0);
			expect(parseReport(unrelated).staged.matched_paths).toEqual([]);
			expect(runScript(fixture, ["check", "--json"]).exitCode).toBe(1);
		});
	});

	test("matches every exact health input and keeps metacharacter appendix paths intact", () => {
		withFixture((fixture) => {
			const appendixPath = "instruction-appendices/- odd [*]\tline\nname.md";
			const exactInputs = [
				"AGENTS.md",
				"CLAUDE.md",
				"agent-instructions.config",
				"scripts/agent-instructions.sh",
				...registeredOwnerPaths,
				appendixPath,
			];
			writeRepositoryFile(fixture.repository, "AGENTS.md", "# Changed agent instructions\n");
			writeRepositoryFile(fixture.repository, "CLAUDE.md", "# Changed Claude wrapper\n");
			writeRepositoryFile(fixture.repository, "agent-instructions.config", "startup_owner=./\n");
			writeFileSync(fixture.script, `${readFileSync(fixture.script, "utf8")}\n# staged fixture change\n`);
			for (const path of registeredOwnerPaths) {
				writeRepositoryFile(fixture.repository, path, `changed ${path}\n`);
			}
			writeRepositoryFile(fixture.repository, appendixPath, "# Appendix\n");
			git(fixture.repository, ["add", "--", ...exactInputs]);

			const result = runScript(fixture, ["check", "--staged", "--json"]);
			const report = parseReport(result);
			expect(result.exitCode).toBe(0);
			expect(report.staged.requested).toBe(true);
			expect(report.staged.applicable).toBe(true);
			expect(report.staged.decision).toBe("applicable");
			expect(new Set(report.staged.matched_paths)).toEqual(new Set(exactInputs));
			expect(report.passes.some((item) => item.startsWith("owner exists:"))).toBe(true);
			expect(report.failures).toEqual([]);
		});
	});

	test("escapes every JSON control byte in matched staged paths", () => {
		withFixture((fixture) => {
			const appendixPath = `instruction-appendices/control-${String.fromCharCode(1)}.md`;
			writeRepositoryFile(fixture.repository, appendixPath, "# Appendix\n");
			git(fixture.repository, ["add", "--", appendixPath]);

			const result = runScript(fixture, ["check", "--staged", "--json"]);
			expect(result.exitCode).toBe(0);
			expect(parseReport(result).staged.matched_paths).toEqual([appendixPath]);
		});
	});

	test("sorts appendix reports in byte order regardless of the caller locale", () => {
		const contrastingLocale = findContrastingSortLocale();
		if (!contrastingLocale) {
			expect(readFileSync(sourceScript, "utf8")).toContain("check_appendices() {\n\tlocal LC_ALL=C\n");
		}

		withFixture((fixture) => {
			writeRepositoryFile(fixture.repository, "instruction-appendices/a.md", "# Lowercase\n");
			writeRepositoryFile(fixture.repository, "instruction-appendices/Z.md", "# Uppercase\n");

			const result = run("bash", [fixture.script, "check", "--json"], {
				cwd: fixture.repository,
				env: { ...process.env, HOME: fixture.home, LC_ALL: contrastingLocale ?? "C" },
			});
			const appendixPasses = parseReport(result).passes.filter((item) => item.startsWith("appendix line budget:"));

			expect(result.exitCode).toBe(0);
			expect(appendixPasses).toEqual([
				"appendix line budget: instruction-appendices/Z.md 1 <= 25",
				"appendix line budget: instruction-appendices/a.md 1 <= 25",
			]);
		});
	});

	test.each([
		{ name: "bad index and healthy worktree", staged: "staged\n".repeat(121), worktree: "healthy\n" },
		{ name: "healthy index and bad worktree", staged: "staged healthy\n", worktree: "worktree\n".repeat(121) },
	])("fails closed for $name instruction content", ({ staged, worktree }) => {
		withFixture((fixture) => {
			writeRepositoryFile(fixture.repository, "AGENTS.md", staged);
			git(fixture.repository, ["add", "--", "AGENTS.md"]);
			writeRepositoryFile(fixture.repository, "AGENTS.md", worktree);

			const result = runScript(fixture, ["check", "--staged", "--json"]);
			expect(result.exitCode).toBe(1);
			expect(parseReport(result).failures).toContain(
				"staged instruction input differs from working tree: AGENTS.md",
			);
		});
	});

	test.each([
		{ name: "deleted startup owner", path: "AGENTS.md", moved: undefined },
		{ name: "renamed registered owner", path: "context/personal.md", moved: "context/personal-renamed.md" },
	])("rejects an untracked replacement for a staged $name", ({ path, moved }) => {
		withFixture((fixture) => {
			if (moved) git(fixture.repository, ["mv", "--", path, moved]);
			else git(fixture.repository, ["rm", "--quiet", "--", path]);
			writeRepositoryFile(fixture.repository, path, "untracked replacement\n");

			const result = runScript(fixture, ["check", "--staged", "--json"]);
			expect(result.exitCode).toBe(1);
			expect(parseReport(result).failures).toContain(
				`staged instruction input differs from working tree: ${path}`,
			);
		});
	});

	for (const operation of ["add", "modify", "delete", "type", "rename-away", "rename-into"] as const) {
		test(`recognizes an exact owner ${operation}`, () => {
			withFixture((fixture) => {
				const owner = "context/personal.md";
				const ownerTarget = join(fixture.repository, owner);
				const sibling = "context/personal-renamed.md";
				switch (operation) {
					case "add":
						git(fixture.repository, ["rm", "--quiet", "--", owner]);
						git(fixture.repository, ["commit", "--quiet", "-m", "test: remove owner"]);
						writeRepositoryFile(fixture.repository, owner, "added\n");
						git(fixture.repository, ["add", "--", owner]);
						break;
					case "modify":
						writeRepositoryFile(fixture.repository, owner, "modified\n");
						git(fixture.repository, ["add", "--", owner]);
						break;
					case "delete":
						git(fixture.repository, ["rm", "--quiet", "--", owner]);
						break;
					case "type":
						unlinkSync(ownerTarget);
						symlinkSync("../personal-target.md", ownerTarget);
						git(fixture.repository, ["add", "--", owner]);
						break;
					case "rename-away":
						git(fixture.repository, ["mv", "--", owner, sibling]);
						break;
					case "rename-into":
						renameSync(ownerTarget, join(fixture.repository, sibling));
						git(fixture.repository, ["add", "--all", "--", "context"]);
						git(fixture.repository, ["commit", "--quiet", "-m", "test: move owner away"]);
						git(fixture.repository, ["mv", "--", sibling, owner]);
						break;
				}

				const result = runScript(fixture, ["check", "--staged", "--json"]);
				const report = parseReport(result);
				expect(report.staged.decision).toBe("applicable");
				expect(report.staged.matched_paths).toContain(owner);
			});
		});
	}

	test("aligns help, parser, plain output, JSON, and exit semantics", () => {
		withFixture((fixture) => {
			const help = runScript(fixture, ["--help"]);
			expect(help.exitCode).toBe(0);
			expect(help.stdout).toContain("scripts/agent-instructions.sh check [--staged] [--json]");
			expect(help.stdout).toContain("--staged");

			const invalid = runScript(fixture, ["status", "--staged"]);
			expect(invalid.exitCode).toBe(2);
			expect(invalid.stdout).toBe("");
			expect(invalid.stderr).toContain("--staged is only valid with check");

			const plain = runScript(fixture, ["check", "--staged"]);
			expect(plain.exitCode).toBe(0);
			expect(plain.stdout).toContain("Staged instruction health: not applicable");
			expect(plain.stdout).toContain("Agent instruction health: ok");
			const marked = run("bash", [fixture.script, "check", "--json"], {
				cwd: fixture.repository,
				env: { ...process.env, HOME: fixture.home, AGENT_INSTRUCTIONS_CHECK_STAGED: "1" },
			});
			expect(parseReport(marked).staged.requested).toBe(true);

			const unconditional = parseReport(runScript(fixture, ["check", "--json"]));
			expect(unconditional.staged).toEqual({
				requested: false,
				applicable: null,
				decision: "not_requested",
				matched_paths: [],
			});
			expect(unconditional.passes.length).toBeGreaterThan(0);
		});
	});

	test("fails closed with valid JSON when Git index inspection fails", () => {
		const root = mkdtempSync(join(tmpdir(), "agent-instructions-no-git-"));
		try {
			const script = join(root, "scripts/agent-instructions.sh");
			mkdirSync(dirname(script), { recursive: true });
			writeFileSync(script, readFileSync(sourceScript));
			chmodSync(script, 0o755);
			const result = run("bash", [script, "check", "--staged", "--json"], {
				cwd: root,
				env: { ...process.env, HOME: join(root, "home") },
			});
			const report = parseReport(result);
			expect(result.exitCode).toBe(1);
			expect(report.status).toBe("fail");
			expect(report.staged.decision).toBe("inspection_failed");
			expect(report.staged.applicable).toBeNull();
			expect(report.failures).toContain("staged Git index inspection failed");
			expect(result.stderr).not.toBe("");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
