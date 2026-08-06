import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(packageRoot, "src/foundry-dx.mjs");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-dx-test-"));
const targetRepo = path.join(tmpRoot, "target-repo");
const fakeSwitcher = path.join(tmpRoot, "fake-switcher.mjs");

fs.mkdirSync(path.join(targetRepo, ".git"), { recursive: true });
fs.writeFileSync(
	fakeSwitcher,
	`#!/usr/bin/env node
const targetRepo = ${JSON.stringify(targetRepo)}
const payload = {
  ok: false,
  command: process.argv[2],
  run_id: 'switcher-test',
  global_account: 'personal',
  global_accounts: { claude: 'personal', codex: 'personal' },
  profile_dirs: { claude_config_dir: '/tmp/claude', codex_home: '/tmp/codex' },
  azure_session: { available: true, valid: true, account_name: 'test-foundry', message: 'logged in' },
  op_available: true,
  secrets_loaded: true,
  repos: [{
    path: targetRepo,
    exists: true,
    envrc_exists: true,
    sources_shared: true,
    override: 'none',
    provider: 'foundry',
    claude_override: 'none',
    codex_override: 'none',
    claude_provider: 'foundry',
    codex_provider: 'foundry'
  }],
  health: [{ code: 'STALE_SNAPSHOTS', message: 'test stale snapshot', repair_hint: 'rm test-snapshot', count: 1 }],
  next_action: 'rm test-snapshot'
}
if (process.argv[2] === 'explain') {
  payload.ok = true
  payload.effective = { claude: { provider: 'foundry' }, codex: { provider: 'foundry' } }
}
console.log(JSON.stringify(payload))
`,
);
fs.chmodSync(fakeSwitcher, 0o755);

const env = {
	...process.env,
	FOUNDRY_DX_ACCOUNT_SWITCHER: fakeSwitcher,
	FOUNDRY_DX_NOW: "2026-06-17T06:00:00.000Z",
	FOUNDRY_DX_RUN_ID: "test-run",
};

function run(args, options = {}) {
	return spawnSync(process.execPath, [cli, ...args], {
		cwd: packageRoot,
		env: { ...env, ...options.env },
		encoding: "utf8",
		input: options.input,
	});
}

function stdoutJson(result) {
	return JSON.parse(result.stdout);
}

{
	const result = run(["--help"]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /hooks install/);
	assert.match(result.stdout, /claude\|codex\|both/);
}

{
	const result = run(["doctor", "--json", "--repo", targetRepo]);
	assert.equal(result.status, 2);
	const payload = stdoutJson(result);
	assert.equal(payload.command, "doctor");
	assert.equal(payload.health[0].code, "STALE_SNAPSHOTS");
}

{
	const result = run(["status", "--json", "--repo", targetRepo]);
	assert.equal(result.status, 0);
	const payload = stdoutJson(result);
	assert.equal(payload.data.current_repo.codex_provider, "foundry");
}

{
	const result = run(["explain", "--json", "--repo", targetRepo]);
	assert.equal(result.status, 0);
	assert.equal(stdoutJson(result).data.effective.claude.provider, "foundry");
}

{
	const result = run(["doctor", "--repo"]);
	assert.equal(result.status, 64);
	assert.match(result.stderr, /missing value/);
}

{
	const output = path.join(tmpRoot, "handoff.md");
	const result = run(["compact-handoff", "--json", "--repo", targetRepo, "--output", output]);
	assert.equal(result.status, 0);
	assert.equal(stdoutJson(result).data.path, output);
	assert.match(fs.readFileSync(output, "utf8"), /Foundry DX Compaction Handoff/);
}

{
	const output = path.join(tmpRoot, "hook-handoff.md");
	const result = run(["compact-handoff", "--hook", "--repo", targetRepo, "--output", output], {
		input: JSON.stringify({ session_id: "session-test", trigger: "auto" }),
	});
	assert.equal(result.status, 0);
	assert.equal(stdoutJson(result).continue, true);
}

{
	const output = path.join(tmpRoot, "blocked-auto-handoff.md");
	const result = run(["compact-handoff", "--hook", "--block-auto", "--repo", targetRepo, "--output", output], {
		input: JSON.stringify({ session_id: "session-test", hook_event_name: "PreCompact", trigger: "auto" }),
	});
	assert.equal(result.status, 0);
	const payload = stdoutJson(result);
	assert.equal(payload.decision, "block");
	assert.match(payload.reason, /blocked auto-compaction/);
	assert.match(fs.readFileSync(output, "utf8"), /Hook event: PreCompact/);
}

{
	const output = path.join(tmpRoot, "hook-handoff.md");
	const result = run(["compact-status", "--json", "--repo", targetRepo, "--output", output]);
	assert.equal(result.status, 0);
	assert.equal(stdoutJson(result).data.exists, true);
}

{
	const result = run(["hooks", "print", "--repo", targetRepo]);
	assert.equal(result.status, 0);
	assert.match(stdoutJson(result).hooks.PreCompact[0].hooks[0].command, /foundry-dx\.mjs/);
	assert.match(stdoutJson(result).hooks.PreCompact[0].hooks[0].command, new RegExp(targetRepo));
}

{
	const result = run(["hooks", "print", "--tool", "claude", "--block-auto", "--repo", targetRepo]);
	assert.equal(result.status, 0);
	const payload = stdoutJson(result);
	assert.match(payload.hooks.PreCompact[0].hooks[0].command, /--block-auto/);
	assert.equal(payload.hooks.PreCompact[0].hooks[0].timeout, 10);
	assert.match(payload.hooks.PreCompact[0].hooks[0].command, /\.claude\/foundry-dx\/handoff\.md/);
}

{
	const result = run(["hooks", "print", "--tool", "both", "--repo", targetRepo]);
	assert.equal(result.status, 0);
	const payload = stdoutJson(result);
	assert.ok(payload.codex.hooks.PreCompact);
	assert.ok(payload.claude.hooks.PreCompact);
}

{
	const result = run(["hooks", "install", "--repo", targetRepo]);
	assert.equal(result.status, 64);
	assert.match(result.stderr, /--force/);
}

{
	const settingsPath = path.join(targetRepo, ".claude/settings.local.json");
	fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
	fs.writeFileSync(
		settingsPath,
		`${JSON.stringify(
			{
				env: { KEEP: "1" },
				hooks: {
					Stop: [{ matcher: "*", hooks: [{ type: "command", command: "echo keep" }] }],
					PreCompact: [{ matcher: "manual|auto", hooks: [{ type: "command", command: "node /old/foundry-dx.mjs compact-handoff" }] }],
				},
			},
			null,
			2,
		)}\n`,
	);
	const result = run(["hooks", "install", "--force", "--tool", "claude", "--block-auto", "--repo", targetRepo]);
	assert.equal(result.status, 0);
	const payload = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
	assert.equal(payload.env.KEEP, "1");
	assert.equal(payload.hooks.Stop[0].hooks[0].command, "echo keep");
	assert.equal(payload.hooks.PreCompact.length, 1);
	assert.match(payload.hooks.PreCompact[0].hooks[0].command, /--block-auto/);
	assert.ok(payload.hooks.PostCompact);
}

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log("foundry-dx tests passed.");
