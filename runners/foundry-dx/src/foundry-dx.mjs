#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VERSION = "0.4.0";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_SWITCHER = path.join(os.homedir(), "code/dotfiles/bin/lll-account-switch");
const CODEX_HANDOFF = ".codex/foundry-dx/handoff.md";
const CLAUDE_HANDOFF = ".claude/foundry-dx/handoff.md";
const EX_USAGE = 64;
const EX_RUNTIME = 1;
const EX_HEALTH = 2;

const HELP = `foundry-dx - repo-agnostic Foundry routing diagnostics and compaction handoff runner

Usage:
  foundry-dx status [--json] [--repo <path>]
  foundry-dx doctor [--json] [--repo <path>]
  foundry-dx explain [--json] [--repo <path>] [--tool <claude|codex|both>]
  foundry-dx compact-handoff [--json] [--hook] [--block-auto] [--dry-run] [--repo <path>] [--output <path>] [--note <text>]
  foundry-dx compact-status [--json] [--hook] [--repo <path>] [--output <path>]
  foundry-dx hooks print [--tool <claude|codex|both>] [--block-auto] [--repo <path>]
  foundry-dx hooks install --force [--dry-run] [--tool <claude|codex|both>] [--block-auto] [--repo <path>] [--claude-settings <path>]
  foundry-dx help
  foundry-dx --version

Commands:
  status            Read routing, health, tool, hook, and handoff state.
  doctor            Same as status, but exits 2 when health is not ok.
  explain           Delegate provider-resolution explanation to lll-account-switch.
  compact-handoff   Write a resume packet before manual or auto compaction.
  compact-status    Read the latest resume packet.
  hooks print        Print hook JSON for Codex, Claude Code, or both.
  hooks install      Write local hook config. Requires --force.

Contracts:
  Primary data goes to stdout.
  Diagnostics and errors go to stderr.
  --json emits a stable envelope.

Smoke:
  foundry-dx status --json --repo ~/code/experience-sdk
  foundry-dx compact-handoff --dry-run --json --repo ~/code/experience-sdk
`;

function main() {
	const argv = process.argv.slice(2);
	const command = argv[0] ?? "help";

	if (command === "--version") {
		console.log(VERSION);
		return 0;
	}

	if (command === "help" || command === "-h" || command === "--help") {
		console.log(HELP.trim());
		return 0;
	}

	try {
		switch (command) {
			case "status":
				return runStatus(argv.slice(1), false);
			case "doctor":
				return runStatus(argv.slice(1), true);
			case "explain":
				return runExplain(argv.slice(1));
			case "compact-handoff":
				return runCompactHandoff(argv.slice(1));
			case "compact-status":
				return runCompactStatus(argv.slice(1));
			case "hooks":
				return runHooks(argv.slice(1));
			default:
				return failUsage(`unknown command: ${command}`);
		}
	} catch (error) {
		return fail(error);
	}
}

function parse(args, valueFlags = []) {
	const flags = new Map();
	const positionals = [];

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "-h" || arg === "--help") {
			flags.set("help", true);
			continue;
		}
		if (!arg.startsWith("-")) {
			positionals.push(arg);
			continue;
		}
		const name = arg.replace(/^-+/, "");
		if (valueFlags.includes(name)) {
			const value = args[index + 1];
			if (!value || value.startsWith("-")) throw usageError(`missing value for --${name}`);
			flags.set(name, value);
			index += 1;
			continue;
		}
		flags.set(name, true);
	}

	return { flags, positionals };
}

function runStatus(args, failOnHealth) {
	const { flags, positionals } = parse(args, ["repo"]);
	if (flags.get("help")) {
		console.log("Usage: foundry-dx status|doctor [--json] [--repo <path>]");
		return 0;
	}
	if (positionals.length > 0) throw usageError("status takes no positional args");

	const repo = resolveRepo(flags.get("repo"));
	const switcher = readSwitcherStatus();
	const currentRepo = findRepo(switcher, repo);
	const codexHandoffPath = resolveTargetPath(repo, CODEX_HANDOFF);
	const claudeHandoffPath = resolveTargetPath(repo, CLAUDE_HANDOFF);
	const codexHooksPath = resolveTargetPath(repo, ".codex/hooks.json");
	const claudeSettingsPath = resolveTargetPath(repo, ".claude/settings.local.json");
	const autoCompact = checkClaudeAutoCompact();
	const health = Array.isArray(switcher.health) ? [...switcher.health] : [];
	if (autoCompact.enabled === false) {
		health.push({
			code: "claude-autocompact-disabled",
			message: `autoCompactEnabled is false in ${shortPath(autoCompact.path)}`,
			repair_hint: `Set "autoCompactEnabled": true in ${shortPath(autoCompact.path)} or via Claude Code settings`,
		});
	}
	const ok = Boolean(switcher.ok) && Boolean(currentRepo);
	const envelope = {
		ok,
		command: failOnHealth ? "doctor" : "status",
		run_id: runId(),
		side_effects: "read",
		retry_safe: true,
		data: {
			repo,
			routing_owner: switcherPath(),
			switcher,
			current_repo: currentRepo,
			tools: collectTools(),
			hooks: {
				codex: {
					path: codexHooksPath,
					installed: hasFoundryHook(codexHooksPath),
				},
				claude: {
					path: claudeSettingsPath,
					installed: hasFoundryHook(claudeSettingsPath),
				},
			},
			handoffs: {
				codex: {
					path: codexHandoffPath,
					exists: fs.existsSync(codexHandoffPath),
				},
				claude: {
					path: claudeHandoffPath,
					exists: fs.existsSync(claudeHandoffPath),
				},
			},
			claude_autocompact: {
				path: autoCompact.path,
				enabled: autoCompact.enabled,
			},
		},
		health,
		next_action: nextAction({ health, currentRepo, repo, codexHooksPath, claudeSettingsPath, codexHandoffPath, claudeHandoffPath }),
	};

	if (flags.get("json")) console.log(JSON.stringify(envelope, null, 2));
	else renderStatus(envelope);

	if (failOnHealth && (!ok || health.length > 0)) return EX_HEALTH;
	return 0;
}

function runExplain(args) {
	const { flags, positionals } = parse(args, ["repo", "tool"]);
	if (flags.get("help")) {
		console.log("Usage: foundry-dx explain [--json] [--repo <path>] [--tool <claude|codex|both>]");
		return 0;
	}
	if (positionals.length > 0) throw usageError("explain takes no positional args");

	const repo = resolveRepo(flags.get("repo"));
	const tool = flags.get("tool") ?? "both";
	if (!["claude", "codex", "both"].includes(tool)) throw usageError("--tool must be claude, codex, or both");

	const result = spawnJson(switcherPath(), ["explain", "--repo", repo, "--tool", tool, "--json"]);
	const envelope = {
		ok: result.ok && Boolean(result.data?.ok),
		command: "explain",
		run_id: runId(),
		side_effects: "read",
		retry_safe: true,
		data: result.data,
		next_action: result.data?.next_action ?? `${switcherPath()} status --json`,
	};
	if (flags.get("json")) console.log(JSON.stringify(envelope, null, 2));
	else console.log(JSON.stringify(envelope.data, null, 2));
	return envelope.ok ? 0 : EX_RUNTIME;
}

function runCompactHandoff(args) {
	const { flags, positionals } = parse(args, ["repo", "output", "note"]);
	if (flags.get("help")) {
		console.log("Usage: foundry-dx compact-handoff [--json] [--hook] [--block-auto] [--dry-run] [--repo <path>] [--output <path>] [--note <text>]");
		return 0;
	}
	if (positionals.length > 0) throw usageError("compact-handoff takes no positional args");

	const repo = resolveRepo(flags.get("repo"));
	const outputPath = resolveTargetPath(repo, flags.get("output") ?? CODEX_HANDOFF);
	const hookInput = readStdinJson();
	const markdown = buildHandoff({ repo, outputPath, note: flags.get("note"), hookInput });
	const dryRun = Boolean(flags.get("dry-run"));
	const blockAuto = Boolean(flags.get("block-auto"));

	if (!dryRun) {
		fs.mkdirSync(path.dirname(outputPath), { recursive: true });
		fs.writeFileSync(outputPath, markdown);
	}

	const envelope = {
		ok: true,
		command: "compact-handoff",
		run_id: runId(),
		side_effects: dryRun ? "preview" : "write",
		retry_safe: true,
		data: {
			repo,
			path: outputPath,
			dry_run: dryRun,
			bytes: Buffer.byteLength(markdown),
			trigger: hookInput?.trigger ?? "manual",
		},
		next_action: `After compaction, read ${shortPath(outputPath)} before continuing.`,
	};

	if (flags.get("hook")) {
		if (blockAuto && hookInput?.trigger === "auto") {
			console.log(
				JSON.stringify({
					decision: "block",
					reason: `Foundry DX wrote ${shortPath(outputPath)} and blocked auto-compaction because Claude Code Foundry can hang at 0%. Start a fresh/resumed session from the handoff, or run manual /compact earlier.`,
				}),
			);
			return 0;
		}
		console.log(JSON.stringify({ continue: true, systemMessage: `Foundry DX wrote ${shortPath(outputPath)}` }));
		return 0;
	}
	if (flags.get("json")) console.log(JSON.stringify(envelope, null, 2));
	else renderCompact(envelope);
	return 0;
}

function runCompactStatus(args) {
	const { flags, positionals } = parse(args, ["repo", "output"]);
	if (flags.get("help")) {
		console.log("Usage: foundry-dx compact-status [--json] [--hook] [--repo <path>] [--output <path>]");
		return 0;
	}
	if (positionals.length > 0) throw usageError("compact-status takes no positional args");

	const repo = resolveRepo(flags.get("repo"));
	const outputPath = resolveTargetPath(repo, flags.get("output") ?? CODEX_HANDOFF);
	const exists = fs.existsSync(outputPath);
	const preview = exists ? fs.readFileSync(outputPath, "utf8").split("\n").slice(0, 80).join("\n") : "";
	const envelope = {
		ok: exists,
		command: "compact-status",
		run_id: runId(),
		side_effects: "read",
		retry_safe: true,
		data: { repo, path: outputPath, exists, preview },
		next_action: exists ? `Read ${shortPath(outputPath)} before continuing.` : "Run compact-handoff before compaction.",
	};

	if (flags.get("hook")) {
		console.log(JSON.stringify({ continue: true, systemMessage: exists ? `Foundry DX handoff available: ${shortPath(outputPath)}` : `Foundry DX handoff missing: ${shortPath(outputPath)}` }));
		return 0;
	}
	if (flags.get("json")) console.log(JSON.stringify(envelope, null, 2));
	else renderCompactStatus(envelope);
	return exists ? 0 : EX_RUNTIME;
}

function runHooks(args) {
	const subcommand = args[0] ?? "help";
	const rest = args.slice(1);
	if (subcommand === "help" || subcommand === "-h" || subcommand === "--help") {
		console.log("Usage: foundry-dx hooks print [--tool <claude|codex|both>] [--block-auto] [--repo <path>]\n       foundry-dx hooks install --force [--dry-run] [--tool <claude|codex|both>] [--block-auto] [--repo <path>] [--claude-settings <path>]");
		return 0;
	}
	if (subcommand === "print") {
		const { flags, positionals } = parse(rest, ["repo", "tool", "claude-settings"]);
		if (positionals.length > 0) throw usageError("hooks print takes no positional args");
		const repo = resolveRepo(flags.get("repo"));
		const tool = resolveTool(flags.get("tool"));
		console.log(JSON.stringify(hookPrintConfig(repo, tool, { blockAuto: Boolean(flags.get("block-auto")), claudeSettings: flags.get("claude-settings") }), null, 2));
		return 0;
	}
	if (subcommand === "install") {
		const { flags, positionals } = parse(rest, ["repo", "tool", "claude-settings"]);
		if (positionals.length > 0) throw usageError("hooks install takes no positional args");
		if (!flags.get("force")) throw usageError("hooks install writes local hook config; rerun with --force");
		const repo = resolveRepo(flags.get("repo"));
		const tool = resolveTool(flags.get("tool"));
		const dryRun = Boolean(flags.get("dry-run"));
		const installs = buildHookInstalls(repo, tool, { blockAuto: Boolean(flags.get("block-auto")), claudeSettings: flags.get("claude-settings") });
		for (const install of installs) {
			if (!dryRun) install.write();
			console.log(`Foundry DX ${install.tool} hooks ${dryRun ? "preview" : "installed"}: ${shortPath(install.target)}`);
		}
		console.log("Next: open /hooks in the target tool and trust the local hook definitions.");
		return 0;
	}
	throw usageError(`unknown hooks command: ${subcommand}`);
}

function hookPrintConfig(repo, tool, options) {
	if (tool === "codex") return codexHookConfig(repo);
	if (tool === "claude") return claudeHookConfig(repo, options);
	return {
		codex: codexHookConfig(repo),
		claude: claudeHookConfig(repo, options),
	};
}

function buildHookInstalls(repo, tool, options) {
	const installs = [];
	if (tool === "codex" || tool === "both") installs.push(buildCodexHookInstall(repo));
	if (tool === "claude" || tool === "both") installs.push(buildClaudeHookInstall(repo, options));
	return installs;
}

function buildCodexHookInstall(repo) {
	const target = resolveTargetPath(repo, ".codex/hooks.json");
	const content = `${JSON.stringify(codexHookConfig(repo), null, 2)}\n`;
	return {
		tool: "codex",
		target,
		write() {
			fs.mkdirSync(path.dirname(target), { recursive: true });
			if (fs.existsSync(target)) {
				const existing = fs.readFileSync(target, "utf8");
				if (existing !== content && !existing.includes("foundry-dx.mjs")) {
					throw runtimeError(`${shortPath(target)} exists and is not foundry-dx-owned`);
				}
			}
			fs.writeFileSync(target, content);
		},
	};
}

function buildClaudeHookInstall(repo, options) {
	const target = resolveTargetPath(repo, options.claudeSettings ?? ".claude/settings.local.json");
	const content = `${JSON.stringify(mergeClaudeSettings(target, claudeHookConfig(repo, options)), null, 2)}\n`;
	return {
		tool: "claude",
		target,
		write() {
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.writeFileSync(target, content);
		},
	};
}

function codexHookConfig(repo) {
	const commandBase = `node ${shellQuote(SCRIPT_PATH)}`;
	const repoFlag = `--repo ${shellQuote(repo)}`;
	return {
		hooks: {
			PreCompact: [
				{
					matcher: "manual|auto",
					hooks: [
						{
							type: "command",
							command: `${commandBase} compact-handoff --hook ${repoFlag}`,
							statusMessage: "Writing Foundry DX compaction handoff",
						},
					],
				},
			],
			PostCompact: [
				{
					matcher: "manual|auto",
					hooks: [
						{
							type: "command",
							command: `${commandBase} compact-status --hook ${repoFlag}`,
							statusMessage: "Checking Foundry DX compaction handoff",
						},
					],
				},
			],
		},
	};
}

function claudeHookConfig(repo, options) {
	const commandBase = `node ${shellQuote(SCRIPT_PATH)}`;
	const repoFlag = `--repo ${shellQuote(repo)}`;
	const handoffFlag = `--output ${shellQuote(CLAUDE_HANDOFF)}`;
	const blockFlag = options.blockAuto ? " --block-auto" : "";
	return {
		hooks: {
			PreCompact: [
				{
					matcher: "manual|auto",
					hooks: [
						{
							type: "command",
							command: `${commandBase} compact-handoff --hook${blockFlag} ${repoFlag} ${handoffFlag}`,
							timeout: 10,
						},
					],
				},
			],
			PostCompact: [
				{
					matcher: "manual|auto",
					hooks: [
						{
							type: "command",
							command: `${commandBase} compact-status --hook ${repoFlag} ${handoffFlag}`,
							timeout: 10,
						},
					],
				},
			],
		},
	};
}

function mergeClaudeSettings(target, patch) {
	const settings = readJsonFile(target) ?? {};
	if (!isPlainObject(settings)) throw runtimeError(`${shortPath(target)} must contain a JSON object`);
	settings.hooks = isPlainObject(settings.hooks) ? settings.hooks : {};
	for (const [event, groups] of Object.entries(patch.hooks)) {
		const existingGroups = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
		const keptGroups = existingGroups
			.map((group) => {
				if (!isPlainObject(group)) return group;
				const hooks = Array.isArray(group.hooks) ? group.hooks.filter((hook) => !isFoundryHook(hook)) : group.hooks;
				return { ...group, hooks };
			})
			.filter((group) => !isPlainObject(group) || !Array.isArray(group.hooks) || group.hooks.length > 0);
		settings.hooks[event] = [...keptGroups, ...groups];
	}
	return settings;
}

function buildHandoff({ repo, outputPath, note, hookInput }) {
	const git = collectGit(repo);
	const switcher = safeReadSwitcherStatus();
	const currentRepo = switcher ? findRepo(switcher, repo) : null;
	const health = switcher?.health ?? [];
	const trigger = hookInput?.trigger ?? "manual";
	const sessionId = hookInput?.session_id ?? process.env.CODEX_SESSION_ID ?? process.env.CLAUDE_SESSION_ID ?? "<unknown>";
	const hookEvent = hookInput?.hook_event_name ?? "<unknown>";
	const lines = [
		"# Foundry DX Compaction Handoff",
		"",
		`Generated: ${timestamp()}`,
		`Session: ${sessionId}`,
		`Hook event: ${hookEvent}`,
		`Trigger: ${trigger}`,
		`Repo: ${repo}`,
		`Branch: ${git.branch}`,
		`Git clean: ${git.clean ? "yes" : "no"}`,
		`Routing: Claude ${currentRepo?.claude_provider ?? "unknown"}, Codex ${currentRepo?.codex_provider ?? "unknown"}`,
		`Owner: ${switcherPath()}`,
		`Handoff path: ${outputPath}`,
		"",
		"## Next Safe Action",
		"",
		"1. Read this handoff before continuing.",
		"2. Run `foundry-dx doctor --repo <repo>` if Foundry behavior looks wrong.",
		"3. Continue from the newest user instruction, not stale context.",
		"",
		"## Health",
		"",
	];

	if (health.length === 0) lines.push("- ok");
	else {
		for (const item of health) {
			lines.push(`- ${item.code}: ${item.message}`);
			lines.push(`  - repair: ${item.repair_hint}`);
		}
	}

	lines.push("", "## Git Status", "");
	if (git.status.length === 0) lines.push("- clean");
	else lines.push(...git.status.map((item) => `- ${item}`));

	if (note) lines.push("", "## Operator Note", "", note);
	if (hookInput?.custom_instructions) lines.push("", "## Compact Instructions", "", hookInput.custom_instructions);
	if (hookInput?.compact_summary) lines.push("", "## Compact Summary", "", hookInput.compact_summary);
	lines.push("", "## Commands", "", `- \`node ${SCRIPT_PATH} status --repo ${repo}\``, `- \`node ${SCRIPT_PATH} compact-status --repo ${repo}\``, "- `/compact` at workflow boundaries", "");
	return `${lines.join("\n")}\n`;
}

function renderStatus(envelope) {
	const repo = envelope.data.current_repo;
	console.log("Foundry DX");
	console.log(`Run:      ${envelope.run_id}`);
	console.log(`Repo:     ${shortPath(envelope.data.repo)}`);
	console.log(`Owner:    ${shortPath(envelope.data.routing_owner)}`);
	console.log("");
	console.log("Routing");
	if (repo) {
		console.log(`  Claude: ${repo.claude_provider} (override: ${repo.claude_override})`);
		console.log(`  Codex:  ${repo.codex_provider} (override: ${repo.codex_override})`);
	} else {
		console.log("  repo not listed by lll-account-switch");
	}
	console.log("");
	console.log("Health");
	if (envelope.health.length === 0) console.log("  ok");
	else {
		for (const item of envelope.health) {
			console.log(`  ${item.code}: ${item.message}`);
			console.log(`    repair: ${item.repair_hint}`);
		}
	}
	console.log("");
	console.log("Compaction");
	console.log(`  codex hooks:      ${envelope.data.hooks.codex.installed ? `installed at ${shortPath(envelope.data.hooks.codex.path)}` : "not installed"}`);
	console.log(`  claude hooks:     ${envelope.data.hooks.claude.installed ? `installed at ${shortPath(envelope.data.hooks.claude.path)}` : "not installed"}`);
	console.log(`  claude autocompact: ${envelope.data.claude_autocompact.enabled === true ? "enabled" : envelope.data.claude_autocompact.enabled === false ? `disabled (${shortPath(envelope.data.claude_autocompact.path)})` : "not set"}`);
	console.log(`  codex handoff:    ${envelope.data.handoffs.codex.exists ? shortPath(envelope.data.handoffs.codex.path) : "missing"}`);
	console.log(`  claude handoff:   ${envelope.data.handoffs.claude.exists ? shortPath(envelope.data.handoffs.claude.path) : "missing"}`);
	console.log("");
	console.log(`Next: ${envelope.next_action}`);
}

function renderCompact(envelope) {
	console.log("Foundry DX compact handoff");
	console.log(`Repo: ${shortPath(envelope.data.repo)}`);
	console.log(`Path: ${shortPath(envelope.data.path)}`);
	console.log(`Mode: ${envelope.side_effects}`);
	console.log(`Next: ${envelope.next_action}`);
}

function renderCompactStatus(envelope) {
	console.log("Foundry DX compact status");
	console.log(`Repo: ${shortPath(envelope.data.repo)}`);
	console.log(`Path: ${shortPath(envelope.data.path)}`);
	console.log(`Exists: ${envelope.data.exists ? "yes" : "no"}`);
	if (envelope.data.preview) {
		console.log("");
		console.log(envelope.data.preview);
	}
	console.log("");
	console.log(`Next: ${envelope.next_action}`);
}

function nextAction({ health, currentRepo, repo, codexHooksPath, claudeSettingsPath, codexHandoffPath, claudeHandoffPath }) {
	if (health.length > 0) return health[0].repair_hint;
	if (!currentRepo) return `${switcherPath()} repo init --repo ${shellQuote(repo)}`;
	if (!hasFoundryHook(codexHooksPath) || !hasFoundryHook(claudeSettingsPath)) return `node ${SCRIPT_PATH} hooks install --force --tool both --block-auto --repo ${shellQuote(repo)}`;
	if (!fs.existsSync(codexHandoffPath) && !fs.existsSync(claudeHandoffPath)) return `node ${SCRIPT_PATH} compact-handoff --repo ${shellQuote(repo)}`;
	return "All healthy. Compact at workflow boundaries, then read the handoff.";
}

function resolveTool(value) {
	const tool = value ?? "codex";
	if (!["claude", "codex", "both"].includes(tool)) throw usageError("--tool must be claude, codex, or both");
	return tool;
}

function readJsonFile(target) {
	if (!fs.existsSync(target)) return null;
	try {
		return JSON.parse(fs.readFileSync(target, "utf8"));
	} catch (error) {
		throw runtimeError(`${shortPath(target)} is not valid JSON: ${error.message}`);
	}
}

function isPlainObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasFoundryHook(target) {
	return fs.existsSync(target) && fs.readFileSync(target, "utf8").includes("foundry-dx.mjs");
}

function checkClaudeAutoCompact() {
	const candidates = [
		path.join(os.homedir(), ".claude", "settings.json"),
		path.join(os.homedir(), ".claude", "settings.local.json"),
	];
	for (const candidate of candidates) {
		let data = null;
		try {
			data = readJsonFile(candidate);
		} catch {
			continue;
		}
		if (data && typeof data.autoCompactEnabled === "boolean") {
			return { path: candidate, enabled: data.autoCompactEnabled };
		}
	}
	return { path: null, enabled: null };
}

function isFoundryHook(hook) {
	return isPlainObject(hook) && typeof hook.command === "string" && hook.command.includes("foundry-dx.mjs");
}

function readSwitcherStatus() {
	const result = spawnJson(switcherPath(), ["status", "--json"]);
	if (!result.ok) throw runtimeError(`lll-account-switch status failed: ${result.error}`);
	return result.data;
}

function safeReadSwitcherStatus() {
	try {
		return readSwitcherStatus();
	} catch {
		return null;
	}
}

function spawnJson(command, args) {
	const result = spawnSync(command, args, { encoding: "utf8", timeout: 10_000 });
	if (result.error) return { ok: false, error: result.error.message, data: null };
	if (result.status !== 0 && !result.stdout.trim()) return { ok: false, error: result.stderr.trim(), data: null };
	try {
		return { ok: true, error: null, data: JSON.parse(result.stdout) };
	} catch (error) {
		return { ok: false, error: `invalid JSON from ${command}: ${error.message}`, data: null };
	}
}

function findRepo(switcher, repo) {
	const repos = Array.isArray(switcher.repos) ? switcher.repos : [];
	const normalized = path.resolve(repo);
	return repos.find((item) => path.resolve(item.path) === normalized) ?? null;
}

function collectTools() {
	return ["lll-account-switch", "codex", "az", "op", "direnv"].map((name) => {
		const command = name === "lll-account-switch" ? switcherPath() : name;
		const result = path.isAbsolute(command) ? { stdout: fs.existsSync(command) ? command : "" } : spawnSync("which", [command], { encoding: "utf8" });
		const foundPath = result.stdout.trim().split("\n")[0];
		return { name, available: Boolean(foundPath), path: foundPath };
	});
}

function collectGit(repo) {
	const branch = spawnSync("git", ["branch", "--show-current"], { cwd: repo, encoding: "utf8" });
	const statusResult = spawnSync("git", ["status", "--short"], { cwd: repo, encoding: "utf8" });
	const status = statusResult.status === 0 ? statusResult.stdout.trim().split("\n").filter(Boolean) : [];
	return {
		branch: branch.status === 0 ? branch.stdout.trim() || "<detached>" : "<unknown>",
		clean: status.length === 0,
		status,
	};
}

function resolveRepo(input) {
	if (input) return path.resolve(expandHome(input));
	const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
	if (result.status === 0) return result.stdout.trim();
	return process.cwd();
}

function resolveTargetPath(repo, input) {
	const expanded = expandHome(input);
	if (path.isAbsolute(expanded)) return expanded;
	return path.join(repo, expanded);
}

function readStdinJson() {
	if (process.stdin.isTTY) return null;
	try {
		const input = fs.readFileSync(0, "utf8").trim();
		return input ? JSON.parse(input) : null;
	} catch {
		return null;
	}
}

function switcherPath() {
	return process.env.FOUNDRY_DX_ACCOUNT_SWITCHER || DEFAULT_SWITCHER;
}

function runId() {
	if (process.env.FOUNDRY_DX_RUN_ID) return process.env.FOUNDRY_DX_RUN_ID;
	return `${timestamp().replace(/[-:]/g, "").replace(/\..+$/, "Z")}-${process.pid}`;
}

function timestamp() {
	return process.env.FOUNDRY_DX_NOW || new Date().toISOString();
}

function expandHome(value) {
	if (value === "~") return os.homedir();
	if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
	return value;
}

function shortPath(value) {
	return value.replace(os.homedir(), "~");
}

function shellQuote(value) {
	if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function usageError(message) {
	const error = new Error(message);
	error.kind = "usage";
	return error;
}

function runtimeError(message) {
	const error = new Error(message);
	error.kind = "runtime";
	return error;
}

function failUsage(message) {
	console.error(`foundry-dx: ${message}`);
	console.error("Try: foundry-dx --help");
	return EX_USAGE;
}

function fail(error) {
	if (error.kind === "usage") return failUsage(error.message);
	console.error(`foundry-dx: ${error.message}`);
	return EX_RUNTIME;
}

process.exitCode = main();
