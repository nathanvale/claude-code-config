#!/usr/bin/env bun
// heal-skill — diagnose the classic-cinema skill's health and apply safe repairs.
//
// Subcommands:
//   check    [--json] [--quiet]                  read-only diagnosis (default)
//   repair   [--json] [--execute] [--only ID] [--no-input]
//                                                preview (default) or apply safe repairs
//   explain  <check-id> [--json]                 what a finding means + safe fix
//
// Read-only `check` is always safe. `repair` previews by default; only
// booking-log corruption is auto-repairable (with a timestamped backup). Script,
// template, and test failures are reported as human handoff — heal never edits
// skill source or the frozen template.
//
// Exit codes:
//   0 healthy / repair fully succeeded
//   1 findings exist, none repaired
//   2 repair attempted but incomplete / needs handoff
//   64 invalid usage

import { dirname, join } from "node:path";
import { bookingLogPath, scanLog } from "./booking-log.ts";

const SKILL_ROOT = join(dirname(Bun.fileURLToPath(import.meta.url)), "..");
const COMMANDS = [
	"list-movies",
	"check-availability",
	"parse-tickets",
	"pick-seats",
	"fill-ticket",
] as const;

type Status = "ok" | "finding" | "repaired" | "handoff";

interface Finding {
	checkId: string;
	status: Status;
	summary: string;
	detail?: string;
	autoRepairable: boolean;
	nextAction: string;
}

const CHECK_EXPLAIN: Record<string, string> = {
	"scripts-help":
		"Each src/*.ts command must run `--help` and exit 0. A failure means a command is broken or has a parse error. Not auto-repairable — fix the source, then rerun. (human handoff)",
	"fill-ticket-test":
		"The fill-ticket + helpers test suite must pass. A failure means the email template fill drifted. Not auto-repairable — fix the code/test. (human handoff)",
	"template-frozen":
		"references/assets/ticket-template.html must match the committed hash in ticket-template.sha256. A mismatch means the frozen template changed. Not auto-repairable — confirm intentional and update the hash. (human handoff)",
	"booking-log-valid":
		"Every line of bookings.jsonl must be one compact valid JSON object. Pretty-printed or truncated fragments are auto-repairable: heal backs up the file and rewrites it keeping the valid prefix. (auto-repair)",
	"productivity-yml":
		"The email-account must resolve from .productivity.yml (cwd or the my-second-brain fallback). A failure means email send cannot pick an account. Reported only. (report)",
	"owner-paths":
		"Every reference/script linked by SKILL.md must exist on disk. A missing path means a broken owner link. Reported only. (report)",
};

// --- args ---

interface Args {
	subcommand: "check" | "repair" | "explain";
	json: boolean;
	quiet: boolean;
	execute: boolean;
	noInput: boolean;
	only: string | null;
	explainId: string | null;
}

const HELP = `classic-cinema heal-skill — diagnose + repair the classic-cinema skill

Usage:
  bun run src/heal-skill.ts check   [--json] [--quiet]
  bun run src/heal-skill.ts repair  [--json] [--execute] [--only ID] [--no-input]
  bun run src/heal-skill.ts explain <check-id> [--json]

Checks: ${Object.keys(CHECK_EXPLAIN).join(", ")}
Exit: 0 healthy, 1 findings, 2 repair incomplete/handoff, 64 invalid usage.`;

function parseArgs(argv: string[]): Args {
	const a: Args = {
		subcommand: "check",
		json: false,
		quiet: false,
		execute: false,
		noInput: false,
		only: null,
		explainId: null,
	};
	if (argv.length === 0) return a;

	let rest = argv;
	const first = argv[0];
	if (first === "-h" || first === "--help") {
		console.log(HELP);
		process.exit(0);
	}
	if (first === "check" || first === "repair" || first === "explain") {
		a.subcommand = first;
		rest = argv.slice(1);
	}

	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (arg === "-h" || arg === "--help") {
			console.log(HELP);
			process.exit(0);
		} else if (arg === "--json") a.json = true;
		else if (arg === "--quiet") a.quiet = true;
		else if (arg === "--execute") a.execute = true;
		else if (arg === "--no-input") a.noInput = true;
		else if (arg === "--only") a.only = rest[++i] ?? null;
		else if (arg.startsWith("--only=")) a.only = arg.slice("--only=".length);
		else if (a.subcommand === "explain" && !arg.startsWith("-") && a.explainId === null) {
			a.explainId = arg;
		} else {
			console.error(`Unknown argument: ${arg}`);
			console.error(HELP);
			process.exit(64);
		}
	}
	return a;
}

// --- run correlation (no Date.now in deterministic tests; fine here) ---

function makeRunId(): string {
	return `heal-${Math.floor(Date.now() / 1000)}-${process.pid}`;
}

// --- checks (all read-only) ---

async function checkScriptsHelp(): Promise<Finding> {
	const failures: string[] = [];
	for (const cmd of COMMANDS) {
		const path = join(SKILL_ROOT, "src", `${cmd}.ts`);
		const proc = Bun.spawn(["bun", "run", path, "--help"], {
			stdout: "ignore",
			stderr: "ignore",
		});
		const code = await proc.exited;
		if (code !== 0) failures.push(`${cmd} (exit ${code})`);
	}
	if (failures.length === 0) {
		return {
			checkId: "scripts-help",
			status: "ok",
			summary: `all ${COMMANDS.length} commands respond to --help`,
			autoRepairable: false,
			nextAction: "none",
		};
	}
	return {
		checkId: "scripts-help",
		status: "handoff",
		summary: `${failures.length} command(s) failed --help`,
		detail: failures.join(", "),
		autoRepairable: false,
		nextAction: "human: fix the failing command source, then rerun heal check",
	};
}

async function checkFillTicketTest(): Promise<Finding> {
	const proc = Bun.spawn(["bun", "test", join(SKILL_ROOT, "src", "fill-ticket.test.ts")], {
		cwd: SKILL_ROOT,
		stdout: "ignore",
		stderr: "ignore",
	});
	const code = await proc.exited;
	return code === 0
		? {
				checkId: "fill-ticket-test",
				status: "ok",
				summary: "fill-ticket test suite passes",
				autoRepairable: false,
				nextAction: "none",
			}
		: {
				checkId: "fill-ticket-test",
				status: "handoff",
				summary: "fill-ticket test suite failed",
				detail: `bun test exit ${code}`,
				autoRepairable: false,
				nextAction: "human: run bun test src/fill-ticket.test.ts and fix",
			};
}

async function checkTemplateFrozen(): Promise<Finding> {
	const tplPath = join(SKILL_ROOT, "references", "assets", "ticket-template.html");
	const hashPath = join(SKILL_ROOT, "references", "assets", "ticket-template.sha256");
	const tplFile = Bun.file(tplPath);
	const hashFile = Bun.file(hashPath);
	if (!(await tplFile.exists()) || !(await hashFile.exists())) {
		return {
			checkId: "template-frozen",
			status: "finding",
			summary: "template or its sha256 sidecar is missing",
			autoRepairable: false,
			nextAction: "human: restore references/assets/ticket-template.html(.sha256)",
		};
	}
	const bytes = await tplFile.arrayBuffer();
	const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
	const expected = (await hashFile.text()).trim();
	return actual === expected
		? {
				checkId: "template-frozen",
				status: "ok",
				summary: "frozen template matches committed hash",
				autoRepairable: false,
				nextAction: "none",
			}
		: {
				checkId: "template-frozen",
				status: "handoff",
				summary: "frozen template changed (hash mismatch)",
				detail: `expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…`,
				autoRepairable: false,
				nextAction:
					"human: confirm the template change was intended, then update ticket-template.sha256",
			};
}

async function checkBookingLogValid(): Promise<Finding> {
	const path = bookingLogPath();
	const file = Bun.file(path);
	if (!(await file.exists())) {
		return {
			checkId: "booking-log-valid",
			status: "ok",
			summary: "no booking log yet (created on first send)",
			autoRepairable: false,
			nextAction: "none",
		};
	}
	const scan = scanLog(await file.text());
	if (scan.badLines.length === 0) {
		return {
			checkId: "booking-log-valid",
			status: "ok",
			summary: `booking log clean (${scan.validLines} entries)`,
			autoRepairable: false,
			nextAction: "none",
		};
	}
	return {
		checkId: "booking-log-valid",
		status: "finding",
		summary: `${scan.badLines.length} malformed line(s); last valid line is ${scan.lastValidLineNo}`,
		detail: scan.badLines
			.slice(0, 5)
			.map((b) => `line ${b.lineNo}: ${b.reason}`)
			.join("; "),
		autoRepairable: true,
		nextAction: "heal-skill repair --only booking-log-valid --execute",
	};
}

async function checkProductivityYml(): Promise<Finding> {
	const candidates = [
		join(process.cwd(), ".productivity.yml"),
		join(SKILL_ROOT, "..", "..", "..", "my-second-brain", ".productivity.yml"),
		join(process.env.HOME ?? "", "code", "my-second-brain", ".productivity.yml"),
	];
	for (const c of candidates) {
		const file = Bun.file(c);
		if (await file.exists()) {
			const text = await file.text();
			const match = text.match(/email-account:\s*(\S+)/);
			if (match) {
				return {
					checkId: "productivity-yml",
					status: "ok",
					summary: `email-account resolves to ${match[1]}`,
					autoRepairable: false,
					nextAction: "none",
				};
			}
		}
	}
	return {
		checkId: "productivity-yml",
		status: "finding",
		summary: "no .productivity.yml with email-account found",
		detail: "checked cwd and the my-second-brain fallback",
		autoRepairable: false,
		nextAction: "report: confirm which Google account to send from before booking",
	};
}

async function checkOwnerPaths(): Promise<Finding> {
	const skillMd = Bun.file(join(SKILL_ROOT, "SKILL.md"));
	if (!(await skillMd.exists())) {
		return {
			checkId: "owner-paths",
			status: "finding",
			summary: "SKILL.md missing",
			autoRepairable: false,
			nextAction: "human: restore SKILL.md",
		};
	}
	const md = await skillMd.text();
	// Backticked repo-local paths under references/ or src/ or scripts/.
	// Skip glob/placeholder patterns (e.g. `src/*.ts`, `scripts/<name>.py`) — they
	// are illustrative, not concrete owner paths.
	const referenced = new Set(
		[...md.matchAll(/`((?:references|src|scripts)\/[^`]+)`/g)]
			.map((m) => m[1])
			.filter((rel) => !/[*<>]/.test(rel)),
	);
	const missing: string[] = [];
	for (const rel of referenced) {
		if (!(await Bun.file(join(SKILL_ROOT, rel)).exists())) missing.push(rel);
	}
	return missing.length === 0
		? {
				checkId: "owner-paths",
				status: "ok",
				summary: `${referenced.size} owner path(s) resolve`,
				autoRepairable: false,
				nextAction: "none",
			}
		: {
				checkId: "owner-paths",
				status: "finding",
				summary: `${missing.length} owner path(s) missing`,
				detail: missing.join(", "),
				autoRepairable: false,
				nextAction: "human: fix the broken owner links in SKILL.md",
			};
}

const CHECKS: Record<string, () => Promise<Finding>> = {
	"scripts-help": checkScriptsHelp,
	"fill-ticket-test": checkFillTicketTest,
	"template-frozen": checkTemplateFrozen,
	"booking-log-valid": checkBookingLogValid,
	"productivity-yml": checkProductivityYml,
	"owner-paths": checkOwnerPaths,
};

async function runChecks(only: string | null): Promise<Finding[]> {
	const ids = only ? [only] : Object.keys(CHECKS);
	const findings: Finding[] = [];
	for (const id of ids) {
		const fn = CHECKS[id];
		if (!fn) {
			findings.push({
				checkId: id,
				status: "finding",
				summary: `unknown check '${id}'`,
				autoRepairable: false,
				nextAction: `valid checks: ${Object.keys(CHECKS).join(", ")}`,
			});
			continue;
		}
		findings.push(await fn());
	}
	return findings;
}

// --- booking-log repair (the one sanctioned write) ---

interface RepairResult {
	checkId: string;
	applied: boolean;
	summary: string;
	backupPath?: string;
	previewLines?: string[];
}

async function repairBookingLog(execute: boolean): Promise<RepairResult> {
	const path = bookingLogPath();
	const file = Bun.file(path);
	if (!(await file.exists())) {
		return { checkId: "booking-log-valid", applied: false, summary: "no booking log to repair" };
	}
	const content = await file.text();
	const scan = scanLog(content);
	if (scan.badLines.length === 0) {
		return { checkId: "booking-log-valid", applied: false, summary: "already clean" };
	}

	const lines = content.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	const kept = lines.slice(0, scan.lastValidLineNo);
	const dropped = lines.length - kept.length;
	const rebuilt = `${kept.join("\n")}\n`;

	if (!execute) {
		return {
			checkId: "booking-log-valid",
			applied: false,
			summary: `preview: would keep ${kept.length} valid lines, drop ${dropped} malformed`,
			previewLines: scan.badLines.map((b) => `drop line ${b.lineNo}: ${b.reason}`),
		};
	}

	const backupPath = `${path}.bak-${Math.floor(Date.now() / 1000)}`;
	await Bun.write(backupPath, content);
	await Bun.write(path, rebuilt);
	return {
		checkId: "booking-log-valid",
		applied: true,
		summary: `repaired: kept ${kept.length} valid lines, dropped ${dropped}; backup written`,
		backupPath,
	};
}

// --- output ---

function statusEmoji(s: Status): string {
	return { ok: "✅", finding: "⚠️", repaired: "🔧", handoff: "🚑" }[s];
}

function printHuman(findings: Finding[], quiet: boolean): void {
	const findingsOnly = findings.filter((f) => f.status !== "ok");
	if (findingsOnly.length === 0) {
		if (!quiet) console.log("✅ classic-cinema healthy — all checks pass");
		return;
	}
	for (const f of findings) {
		if (quiet && f.status === "ok") continue;
		console.log(`${statusEmoji(f.status)} ${f.checkId}: ${f.summary}`);
		if (f.detail) console.log(`   ${f.detail}`);
		if (f.status !== "ok") console.log(`   → ${f.nextAction}`);
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const runId = makeRunId();

	if (args.subcommand === "explain") {
		const id = args.explainId;
		if (!id || !(id in CHECK_EXPLAIN)) {
			console.error(`explain needs a known check id: ${Object.keys(CHECK_EXPLAIN).join(", ")}`);
			process.exit(64);
		}
		if (args.json) {
			console.log(JSON.stringify({ checkId: id, explanation: CHECK_EXPLAIN[id], runId }));
		} else {
			console.log(`${id}\n\n${CHECK_EXPLAIN[id]}`);
		}
		process.exit(0);
	}

	if (args.subcommand === "repair") {
		// Run the targeted (or full) checks first so we only repair what's broken.
		const findings = await runChecks(args.only);
		const repairs: RepairResult[] = [];
		let handoffNeeded = false;
		for (const f of findings) {
			if (f.status === "ok") continue;
			if (f.checkId === "booking-log-valid" && f.autoRepairable) {
				repairs.push(await repairBookingLog(args.execute));
			} else if (f.status === "handoff" || !f.autoRepairable) {
				handoffNeeded = true;
			}
		}
		const applied = repairs.some((r) => r.applied);
		if (args.json) {
			console.log(JSON.stringify({ runId, mode: args.execute ? "execute" : "preview", findings, repairs, handoffNeeded }));
		} else {
			printHuman(findings, args.quiet);
			for (const r of repairs) {
				console.log(`${r.applied ? "🔧" : "👁"} ${r.checkId}: ${r.summary}`);
				if (r.backupPath) console.log(`   backup: ${r.backupPath}`);
				for (const p of r.previewLines ?? []) console.log(`   ${p}`);
			}
			if (!args.execute && repairs.length > 0) {
				console.log("\nPreview only. Re-run with --execute to apply.");
			}
		}
		// 0 if repaired and no handoff; 2 if handoff still needed; 1 if findings but nothing applied.
		if (handoffNeeded) process.exit(2);
		if (applied) process.exit(0);
		process.exit(findings.some((f) => f.status !== "ok") ? 1 : 0);
	}

	// check (default, read-only)
	const findings = await runChecks(args.only);
	if (args.json) {
		console.log(JSON.stringify({ runId, findings }));
	} else {
		printHuman(findings, args.quiet);
	}
	process.exit(findings.some((f) => f.status !== "ok") ? 1 : 0);
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}
