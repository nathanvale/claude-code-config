#!/usr/bin/env bun
// ci-repro: reproduce a CI failure locally by matching the four CI-vs-local
// differences, then run the target tests with a failure-NAMING reporter so the
// failing test is found in one local run instead of many hosted-runner cycles.
//
// What it does (SKILL.md invariants, made mechanical):
//   1. fresh git worktree off the CI base ref (not your warm checkout)
//   2. real `bun install --frozen-lockfile` (catches missing-deps + stale manifest)
//   3. CI=true (surfaces skipIf / hard-throw-on-missing-machine-dep behavior)
//   4. raw `bun test` (its reporter names every (fail) with file:line)
//
// Usage:
//   bun run skills/ci-testbed/scripts/ci-repro.ts --ref origin/main --test "skills/browser-use/src/"
//   bun run skills/ci-testbed/scripts/ci-repro.ts --ref origin/main --test "<path>" --keep
//
// Flags:
//   --ref <git-ref>    CI base ref to check out fresh (default: origin/main)
//   --test <path/glob> test path passed to `bun test` (required)
//   --no-ci            do NOT set CI=true (compare with/without the CI env)
//   --keep             leave the repro worktree in place (default: remove it)
//   --json             emit a machine-readable summary line

import { $ } from "bun";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function arg(name: string, fallback?: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	if (i === -1) return fallback;
	const v = process.argv[i + 1];
	return v && !v.startsWith("--") ? v : fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const ref = arg("ref", "origin/main")!;
const testPath = arg("test");
const setCI = !has("no-ci");
const keep = has("keep");
const json = has("json");

if (!testPath) {
	console.error("ci-repro: --test <path/glob> is required (what `bun test` runs).");
	console.error('  e.g. --test "skills/browser-use/src/"');
	process.exit(2);
}

const repoRoot = (await $`git rev-parse --show-toplevel`.text()).trim();
await $`git -C ${repoRoot} fetch --quiet origin`.quiet().catch(() => {});

// A worktree UNDER the repo tree so Bun's workspace resolution works after install;
// a bare /tmp worktree cannot resolve workspace packages.
const wtBase = join(repoRoot, ".claude", "worktrees");
await $`mkdir -p ${wtBase}`.quiet();
const wt = mkdtempSync(join(wtBase, "ci-repro-"));

const cleanup = async () => {
	if (keep) {
		console.error(`\n[ci-repro] worktree kept: ${wt}`);
		console.error(`[ci-repro] remove with: git worktree remove --force ${wt}`);
		return;
	}
	await $`git -C ${repoRoot} worktree remove --force ${wt}`.quiet().catch(() => {});
};

let installOk = false;
let installErr = "";
let testExit = 1;
try {
	console.error(`[ci-repro] fresh worktree off ${ref} -> ${wt}`);
	// -B: reuse a throwaway branch name; --detach would also work.
	await $`git -C ${repoRoot} worktree add --quiet --detach ${wt} ${ref}`;

	console.error(`[ci-repro] bun install --frozen-lockfile (real CI install)`);
	const install = await $`cd ${wt} && bun install --frozen-lockfile`.nothrow();
	installOk = install.exitCode === 0;
	if (!installOk) {
		installErr = install.stderr.toString().split("\n").slice(0, 4).join("\n");
		console.error(`[ci-repro] INSTALL FAILED — this is the CI failure (stale manifest / missing dep):`);
		console.error(installErr);
		testExit = install.exitCode;
	} else {
		console.error(`[ci-repro] running: ${setCI ? "CI=true " : ""}bun test ${testPath}  (raw reporter names failures)`);
		const env = setCI ? { ...process.env, CI: "true" } : process.env;
		// Raw `bun test` (not the compact runner) so every (fail) is named with file:line.
		const test = await $`cd ${wt} && bun test ${testPath}`.env(env).nothrow();
		testExit = test.exitCode;
		// Surface the failure lines up front (the whole point).
		const out = test.stdout.toString() + test.stderr.toString();
		const fails = out.split("\n").filter((l) => /\(fail\)|error:|Expected:|Received:|Workspace not found|Cannot find module|is missing at|not on PATH/.test(l));
		if (fails.length) {
			console.error(`\n[ci-repro] ===== named failures =====`);
			for (const l of fails.slice(0, 40)) console.error(l);
		}
		const summary = out.split("\n").filter((l) => /\d+ (pass|fail|skip)|Ran \d+ tests/.test(l)).slice(-4);
		console.error(`\n[ci-repro] ===== summary =====`);
		for (const l of summary) console.error(l);
	}
} finally {
	await cleanup();
}

if (json) {
	console.log(JSON.stringify({ ref, testPath, ci: setCI, installOk, testExit, kept: keep, worktree: keep ? wt : null }));
}
process.exit(testExit);
