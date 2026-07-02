#!/usr/bin/env bun
// PROTOTYPE — throwaway UX proof for the setup CLI. Delete or absorb when done.

import { existsSync, lstatSync, readlinkSync, realpathSync } from "fs";
import { basename, resolve, join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

// ── Agent envelope (lightweight — mirrors facade shape without the dep) ─

function emitEnvelope(data: Record<string, unknown>, startMs: number): void {
  const envelope = {
    status: "ok",
    run_id: randomUUID(),
    data,
    duration_ms: Math.round(performance.now() - startMs),
  };
  console.log(JSON.stringify(envelope, null, 2));
}

// ── Colors (respects NO_COLOR) ──────────────────────────────────────────

const nc = !!process.env.NO_COLOR || process.env.TERM === "dumb";
const c = {
  reset: nc ? "" : "\x1b[0m",
  bold: nc ? "" : "\x1b[1m",
  dim: nc ? "" : "\x1b[2m",
  green: nc ? "" : "\x1b[32m",
  yellow: nc ? "" : "\x1b[33m",
  red: nc ? "" : "\x1b[31m",
  cyan: nc ? "" : "\x1b[36m",
  gray: nc ? "" : "\x1b[90m",
  white: nc ? "" : "\x1b[37m",
  bgGreen: nc ? "" : "\x1b[42m",
  bgYellow: nc ? "" : "\x1b[43m",
  bgRed: nc ? "" : "\x1b[41m",
};

// ── Topology ────────────────────────────────────────────────────────────

const HOME = homedir();
const REPO = resolve(import.meta.dir, "../../..");

interface LinkSpec {
  link: string;
  target: string;
  label: string;
  group: "claude" | "codex" | "config";
}

const TOPOLOGY: LinkSpec[] = [
  // Claude user scope
  { link: `${HOME}/.claude/CLAUDE.md`, target: `${REPO}/CLAUDE.md`, label: "CLAUDE.md", group: "claude" },
  { link: `${HOME}/.claude/AGENTS.md`, target: `${REPO}/AGENTS.md`, label: "AGENTS.md", group: "claude" },
  { link: `${HOME}/.claude/context`, target: `${REPO}/context`, label: "context/", group: "claude" },
  { link: `${HOME}/.claude/rules`, target: `${REPO}/rules`, label: "rules/", group: "claude" },
  { link: `${HOME}/.claude/commands`, target: `${REPO}/commands`, label: "commands/", group: "claude" },
  { link: `${HOME}/.claude/agents`, target: `${REPO}/agents`, label: "agents/", group: "claude" },
  { link: `${HOME}/.claude/runbooks`, target: `${REPO}/runbooks`, label: "runbooks/", group: "claude" },
  { link: `${HOME}/.claude/hooks`, target: `${REPO}/hooks`, label: "hooks/", group: "claude" },
  { link: `${HOME}/.claude/hooks.json`, target: `${REPO}/hooks.json`, label: "hooks.json", group: "claude" },
  { link: `${HOME}/.claude/settings.json`, target: `${REPO}/settings.json`, label: "settings.json", group: "claude" },
  { link: `${HOME}/.claude/.mcp.json`, target: `${REPO}/.mcp.json`, label: ".mcp.json", group: "claude" },
  // Codex user scope
  { link: `${HOME}/.codex/AGENTS.md`, target: `${REPO}/AGENTS.md`, label: "AGENTS.md", group: "codex" },
  // Config
  { link: `${HOME}/.config/memory`, target: `${REPO}/memory`, label: "memory/", group: "config" },
];

// Skills excluded — managed by `npx skills`

// ── Inspect ─────────────────────────────────────────────────────────────

type LinkHealth = "ok" | "wrong" | "missing" | "conflict" | "broken";

interface LinkStatus {
  spec: LinkSpec;
  health: LinkHealth;
  actual?: string;
  detail?: string;
}

function inspect(spec: LinkSpec): LinkStatus {
  const { link, target } = spec;

  if (!existsSync(link) && !isSymlink(link)) {
    return { spec, health: "missing" };
  }

  if (isSymlink(link)) {
    const actual = readlinkSync(link);
    const resolved = resolve(join(link, ".."), actual);

    if (resolved === target || actual === target) {
      if (!existsSync(target)) {
        return { spec, health: "broken", actual, detail: "symlink exists but target is missing" };
      }
      return { spec, health: "ok", actual };
    }

    return { spec, health: "wrong", actual, detail: `points to ${shortPath(resolved)} instead of ${shortPath(target)}` };
  }

  return { spec, health: "conflict", detail: "real file/directory exists (not a symlink)" };
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function inspectAll(): LinkStatus[] {
  return TOPOLOGY.map(inspect);
}

// ── Formatting helpers ──────────────────────────────────────────────────

function shortPath(p: string): string {
  if (p.startsWith(HOME)) return "~" + p.slice(HOME.length);
  if (p.startsWith(REPO)) return "$REPO" + p.slice(REPO.length);
  return p;
}

function healthIcon(h: LinkHealth): string {
  switch (h) {
    case "ok": return `${c.green}✓${c.reset}`;
    case "wrong": return `${c.yellow}⚠${c.reset}`;
    case "missing": return `${c.red}✗${c.reset}`;
    case "conflict": return `${c.red}◆${c.reset}`;
    case "broken": return `${c.red}⚡${c.reset}`;
  }
}

function healthLabel(h: LinkHealth): string {
  switch (h) {
    case "ok": return `${c.green}OK${c.reset}`;
    case "wrong": return `${c.yellow}WRONG${c.reset}`;
    case "missing": return `${c.red}MISSING${c.reset}`;
    case "conflict": return `${c.red}CONFLICT${c.reset}`;
    case "broken": return `${c.red}BROKEN${c.reset}`;
  }
}

function groupLabel(g: "claude" | "codex" | "config"): string {
  switch (g) {
    case "claude": return `${c.cyan}~/.claude${c.reset}`;
    case "codex": return `${c.cyan}~/.codex${c.reset}`;
    case "config": return `${c.cyan}~/.config${c.reset}`;
  }
}

// ── Commands ────────────────────────────────────────────────────────────

function cmdStatus(json: boolean, startMs: number) {
  const results = inspectAll();
  const ok = results.filter(r => r.health === "ok").length;
  const problems = results.filter(r => r.health !== "ok");

  if (json) {
    emitEnvelope({
      healthy: ok,
      total: results.length,
      problems: problems.map(p => ({
        link: shortPath(p.spec.link),
        target: shortPath(p.spec.target),
        health: p.health,
        detail: p.detail,
        repair: repairCommand(p),
      })),
      next_safe_action: problems.length > 0 ? "setup sync" : null,
      changed_state: null,
    }, startMs);
    process.exit(problems.length > 0 ? 1 : 0);
    return;
  }

  // Human dashboard
  console.log();
  console.log(`${c.bold}  Claude Code Config${c.reset}  ${c.dim}${shortPath(REPO)}${c.reset}`);
  console.log();

  // Health bar
  const barWidth = 20;
  const filledWidth = Math.round((ok / results.length) * barWidth);
  const barColor = ok === results.length ? c.bgGreen : problems.some(p => p.health === "conflict" || p.health === "broken") ? c.bgRed : c.bgYellow;
  const bar = `${barColor}${" ".repeat(filledWidth)}${c.reset}${c.dim}${"░".repeat(barWidth - filledWidth)}${c.reset}`;
  console.log(`  ${bar}  ${c.bold}${ok}${c.reset}${c.dim}/${results.length} healthy${c.reset}`);
  console.log();

  // Group display
  const groups: Array<"claude" | "codex" | "config"> = ["claude", "codex", "config"];
  for (const group of groups) {
    const groupResults = results.filter(r => r.spec.group === group);
    if (groupResults.length === 0) continue;

    const allOk = groupResults.every(r => r.health === "ok");
    if (allOk) {
      console.log(`  ${groupLabel(group)}  ${c.green}${groupResults.length} links healthy${c.reset}`);
    } else {
      console.log(`  ${groupLabel(group)}`);
      for (const r of groupResults) {
        if (r.health === "ok") continue;
        console.log(`    ${healthIcon(r.health)} ${r.spec.label}  ${c.dim}${r.health}${c.reset}`);
      }
    }
  }

  console.log();

  // Next action
  if (problems.length === 0) {
    console.log(`  ${c.green}${c.bold}All good.${c.reset} ${c.dim}Nothing to do.${c.reset}`);
  } else if (problems.every(p => p.health === "missing")) {
    console.log(`  ${c.yellow}${c.bold}${problems.length} missing.${c.reset} Run ${c.cyan}setup sync${c.reset} to create them.`);
  } else if (problems.some(p => p.health === "conflict")) {
    console.log(`  ${c.red}${c.bold}Conflicts found.${c.reset} Run ${c.cyan}setup doctor${c.reset} to see what's blocking.`);
  } else {
    console.log(`  ${c.yellow}${c.bold}${problems.length} issue${problems.length > 1 ? "s" : ""}.${c.reset} Run ${c.cyan}setup doctor${c.reset} for details.`);
  }
  console.log();

  process.exit(problems.length > 0 ? 1 : 0);
}

function cmdDoctor(json: boolean, startMs: number) {
  const results = inspectAll();
  const problems = results.filter(r => r.health !== "ok");

  if (json) {
    emitEnvelope({
      findings: problems.map(p => ({
        link: shortPath(p.spec.link),
        target: shortPath(p.spec.target),
        health: p.health,
        detail: p.detail,
        why: whyItMatters(p),
        repair: repairCommand(p),
      })),
      summary: problems.length === 0 ? "healthy" : `${problems.length} issue${problems.length > 1 ? "s" : ""} found`,
      next_safe_action: problems.length > 0
        ? problems.some(p => p.health === "conflict") ? "resolve conflicts manually, then run setup sync" : "setup sync"
        : null,
      changed_state: null,
    }, startMs);
    process.exit(problems.length > 0 ? 1 : 0);
    return;
  }

  console.log();
  console.log(`${c.bold}  Setup Doctor${c.reset}`);
  console.log();

  if (problems.length === 0) {
    console.log(`  ${c.green}✓ No issues found.${c.reset} All ${results.length} links are healthy.`);
    console.log();
    process.exit(0);
    return;
  }

  for (const p of problems) {
    console.log(`  ${healthIcon(p.health)} ${c.bold}${shortPath(p.spec.link)}${c.reset}`);
    console.log(`    ${c.dim}Expected:${c.reset} → ${shortPath(p.spec.target)}`);
    if (p.detail) {
      console.log(`    ${c.dim}Problem:${c.reset}  ${p.detail}`);
    }
    console.log(`    ${c.dim}Why:${c.reset}      ${whyItMatters(p)}`);
    console.log(`    ${c.dim}Fix:${c.reset}      ${c.cyan}${repairCommand(p)}${c.reset}`);
    console.log();
  }

  // Summary next action
  const hasConflicts = problems.some(p => p.health === "conflict");
  if (hasConflicts) {
    console.log(`  ${c.yellow}${c.bold}Manual step needed:${c.reset} back up or remove the conflicting files above,`);
    console.log(`  then run ${c.cyan}setup sync${c.reset} to create the correct links.`);
  } else {
    console.log(`  ${c.bold}Quick fix:${c.reset} run ${c.cyan}setup sync${c.reset} to fix all ${problems.length} issue${problems.length > 1 ? "s" : ""} at once.`);
  }
  console.log();

  process.exit(1);
}

function cmdSyncCheck(json: boolean, startMs: number) {
  const results = inspectAll();
  const changes = results.filter(r => r.health !== "ok");

  if (json) {
    emitEnvelope({
      sync_status: changes.length === 0 ? "clean" : "needs_sync",
      changes: changes.map(ch => ({
        action: ch.health === "missing" ? "create" : ch.health === "broken" ? "recreate" : ch.health === "wrong" ? "relink" : "blocked",
        link: shortPath(ch.spec.link),
        target: shortPath(ch.spec.target),
        health: ch.health,
        blocked: ch.health === "conflict",
        detail: ch.detail,
      })),
      blocked: changes.some(ch => ch.health === "conflict"),
      next_safe_action: changes.length === 0 ? null
        : changes.some(ch => ch.health === "conflict") ? "resolve conflicts, then setup sync"
        : "setup sync",
      changed_state: null,
    }, startMs);
    process.exit(changes.length > 0 ? 1 : 0);
    return;
  }

  console.log();
  console.log(`${c.bold}  Sync Preview${c.reset}  ${c.dim}(dry run — no changes made)${c.reset}`);
  console.log();

  if (changes.length === 0) {
    console.log(`  ${c.green}✓ Already in sync.${c.reset} Nothing to do.`);
    console.log();
    process.exit(0);
    return;
  }

  const blocked = changes.filter(ch => ch.health === "conflict");
  const actionable = changes.filter(ch => ch.health !== "conflict");

  if (actionable.length > 0) {
    console.log(`  ${c.bold}Would create/fix:${c.reset}`);
    for (const ch of actionable) {
      const action = ch.health === "missing" ? "create" : ch.health === "broken" ? "recreate" : "relink";
      console.log(`    ${c.green}+${c.reset} ${shortPath(ch.spec.link)} → ${shortPath(ch.spec.target)}  ${c.dim}(${action})${c.reset}`);
    }
    console.log();
  }

  if (blocked.length > 0) {
    console.log(`  ${c.red}${c.bold}Blocked:${c.reset}`);
    for (const ch of blocked) {
      console.log(`    ${c.red}◆${c.reset} ${shortPath(ch.spec.link)}  ${c.dim}${ch.detail}${c.reset}`);
    }
    console.log();
    console.log(`  ${c.yellow}Remove the blocking files first, then re-run.${c.reset}`);
  } else {
    console.log(`  Run ${c.cyan}setup sync${c.reset} to apply these changes.`);
  }

  console.log();
  process.exit(1);
}

function cmdHelp() {
  console.log();
  console.log(`${c.bold}  setup${c.reset} — manage your Claude Code Config install topology`);
  console.log();
  console.log(`  ${c.dim}This tool keeps your ~/.claude/ and ~/.codex/ symlinks pointed at`);
  console.log(`  this repo. Think of it as "is my config wired up correctly?"${c.reset}`);
  console.log();
  console.log(`  ${c.bold}Commands${c.reset}`);
  console.log();
  console.log(`    ${c.cyan}setup${c.reset}              ${c.dim}Quick health dashboard — are my links OK?${c.reset}`);
  console.log(`    ${c.cyan}setup doctor${c.reset}        ${c.dim}Diagnose problems with fix instructions${c.reset}`);
  console.log(`    ${c.cyan}setup sync${c.reset}          ${c.dim}Create or fix all symlinks${c.reset}`);
  console.log(`    ${c.cyan}setup sync --check${c.reset}  ${c.dim}Preview what sync would do (no changes)${c.reset}`);
  console.log(`    ${c.cyan}setup unlink${c.reset}        ${c.dim}Remove all managed symlinks${c.reset}`);
  console.log(`    ${c.cyan}setup help${c.reset}          ${c.dim}You're looking at it${c.reset}`);
  console.log();
  console.log(`  ${c.bold}Flags${c.reset}`);
  console.log();
  console.log(`    ${c.cyan}--json${c.reset}             ${c.dim}Structured output for scripts and agents${c.reset}`);
  console.log(`    ${c.cyan}--verbose${c.reset}          ${c.dim}Show additional detail${c.reset}`);
  console.log(`    ${c.cyan}--no-color${c.reset}         ${c.dim}Plain text (also: NO_COLOR=1)${c.reset}`);
  console.log();
  console.log(`  ${c.bold}What this manages${c.reset}`);
  console.log();
  console.log(`    ${c.dim}Claude:${c.reset}  CLAUDE.md, AGENTS.md, context/, rules/, commands/,`);
  console.log(`             agents/, runbooks/, hooks/, hooks.json, settings.json, .mcp.json`);
  console.log(`    ${c.dim}Codex:${c.reset}   AGENTS.md`);
  console.log(`    ${c.dim}Config:${c.reset}  memory/`);
  console.log();
  console.log(`  ${c.bold}What this does NOT manage${c.reset}`);
  console.log();
  console.log(`    ${c.dim}Skills are managed by ${c.cyan}npx skills${c.reset}${c.dim} — this tool won't touch them.${c.reset}`);
  console.log(`    ${c.dim}settings.local.json is machine-specific and stays gitignored.${c.reset}`);
  console.log();
  console.log(`  ${c.bold}Typical workflow${c.reset}`);
  console.log();
  console.log(`    ${c.dim}1.${c.reset} Clone this repo`);
  console.log(`    ${c.dim}2.${c.reset} Run ${c.cyan}setup sync${c.reset}`);
  console.log(`    ${c.dim}3.${c.reset} Run ${c.cyan}setup${c.reset} any time to check health`);
  console.log(`    ${c.dim}4.${c.reset} Something broken? ${c.cyan}setup doctor${c.reset} tells you exactly what to do`);
  console.log();
}

// ── Repair helpers ──────────────────────────────────────────────────────

function repairCommand(s: LinkStatus): string {
  switch (s.health) {
    case "missing":
      return `ln -s ${s.spec.target} ${s.spec.link}`;
    case "wrong":
    case "broken":
      return `rm ${s.spec.link} && ln -s ${s.spec.target} ${s.spec.link}`;
    case "conflict":
      return `mv ${s.spec.link} ${s.spec.link}.bak && ln -s ${s.spec.target} ${s.spec.link}`;
    default:
      return "# no action needed";
  }
}

function whyItMatters(s: LinkStatus): string {
  const name = s.spec.label;
  const group = s.spec.group;

  if (group === "claude") {
    if (name === "CLAUDE.md" || name === "AGENTS.md") return "Claude Code reads this at session start for instructions";
    if (name === "context/") return "On-demand context docs loaded by @-references";
    if (name === "rules/") return "Auto-applied rules that shape Claude's behavior";
    if (name === "commands/") return "Slash commands available in Claude Code sessions";
    if (name === "agents/") return "Agent definitions for subagent dispatch";
    if (name === "runbooks/") return "Multi-step runbook workflows (e.g. issue-to-pr)";
    if (name === "hooks/" || name === "hooks.json") return "Event hooks that run on tool calls and session events";
    if (name === "settings.json") return "Permissions, model config, and feature flags";
    if (name === ".mcp.json") return "MCP server configuration for external tools";
  }
  if (group === "codex") return "Codex reads this at startup for shared instructions";
  if (group === "config") return "Persistent memory system across conversations";

  return "Part of the install topology";
}

// ── Main ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonFlag = args.includes("--json");
const verboseFlag = args.includes("--verbose");
const filteredArgs = args.filter(a => a !== "--json" && a !== "--no-color" && a !== "--verbose");
const command = filteredArgs[0] ?? "";
const startMs = performance.now();

if (args.includes("--no-color")) {
  for (const k of Object.keys(c)) {
    (c as any)[k] = "";
  }
}

switch (command) {
  case "":
    cmdStatus(jsonFlag, startMs);
    break;
  case "doctor":
    cmdDoctor(jsonFlag, startMs);
    break;
  case "sync":
    if (filteredArgs.includes("--check")) {
      cmdSyncCheck(jsonFlag, startMs);
    } else {
      // sync write path — not implemented in prototype
      console.log(`${c.yellow}sync write not implemented in prototype — use sync --check to preview${c.reset}`);
      process.exit(2);
    }
    break;
  case "unlink":
    console.log(`${c.yellow}unlink not implemented in prototype${c.reset}`);
    process.exit(2);
    break;
  case "help":
  case "--help":
  case "-h":
    cmdHelp();
    break;
  default:
    console.error(`${c.red}Unknown command: ${command}${c.reset}`);
    console.error(`Run ${c.cyan}setup help${c.reset} for usage.`);
    process.exit(2);
}
