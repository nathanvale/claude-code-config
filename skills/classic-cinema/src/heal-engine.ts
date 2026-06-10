// heal-engine — pure health checks + the one sanctioned repair for the
// classic-cinema skill. The CLI (heal-skill.ts) stays thin: it parses argv
// against the facade contract and renders envelopes; all diagnosis logic lives
// here so the checks stay testable and the runner stays a transport.

import { dirname, join } from "node:path";
import { bookingLogPath, scanLog } from "./booking-log.ts";

export const SKILL_ROOT = join(dirname(Bun.fileURLToPath(import.meta.url)), "..");

const COMMANDS = [
	"list-movies",
	"check-availability",
	"parse-tickets",
	"pick-seats",
	"fill-ticket",
] as const;

export type Status = "ok" | "finding" | "repaired" | "handoff";

export interface Finding {
	checkId: string;
	status: Status;
	summary: string;
	detail?: string;
	autoRepairable: boolean;
	nextAction: string;
}

export const CHECK_EXPLAIN: Record<string, string> = {
	"scripts-help":
		"Each src/*.ts command must run `--help` and exit 0. A failure means a command is broken or has a parse error. Not auto-repairable — fix the source, then rerun. (human handoff)",
	tests:
		"All test suites (cinema-api, pick-seats, fill-ticket, booking-log) must pass via the test-runner skill. A failure means a command's behaviour drifted. Not auto-repairable — fix the code/test. (human handoff)",
	"template-frozen":
		"references/assets/ticket-template.html must match the committed hash in ticket-template.sha256. A mismatch means the frozen template changed. Not auto-repairable — confirm intentional and update the hash. (human handoff)",
	"booking-log-valid":
		"Every line of bookings.jsonl must be one compact valid JSON object. Pretty-printed or truncated fragments are auto-repairable: heal backs up the file and rewrites it keeping the valid prefix. (auto-repair)",
	"productivity-yml":
		"The email-account must resolve from .productivity.yml (cwd or the my-second-brain fallback). A failure means email send cannot pick an account. Reported only. (report)",
	"owner-paths":
		"Every reference/script linked by SKILL.md must exist on disk. A missing path means a broken owner link. Reported only. (report)",
};

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

const TEST_FILES = [
	"src/cinema-api.test.ts",
	"src/pick-seats.test.ts",
	"src/fill-ticket.test.ts",
	"src/booking-log.test.ts",
] as const;

async function checkTests(): Promise<Finding> {
	// Route through the test-runner skill, never raw `bun test` (code-quality rule).
	// Run the full suite — verifying only one file would let a broken sibling read
	// as healthy.
	const runner = join(SKILL_ROOT, "..", "test-runner", "src", "test-runner.sh");
	if (!(await Bun.file(runner).exists())) {
		return {
			checkId: "tests",
			status: "finding",
			summary: "test-runner skill not found; skipping test verification",
			detail: `expected ${runner}`,
			autoRepairable: false,
			nextAction: "report: test coverage unverified (degraded) — install/locate the test-runner skill",
		};
	}
	const proc = Bun.spawn(
		[runner, "run", "--cwd", SKILL_ROOT, "--quiet", "--", ...TEST_FILES],
		{ stdout: "ignore", stderr: "ignore" },
	);
	const code = await proc.exited;
	return code === 0
		? {
				checkId: "tests",
				status: "ok",
				summary: `all ${TEST_FILES.length} test suites pass`,
				autoRepairable: false,
				nextAction: "none",
			}
		: {
				checkId: "tests",
				status: "handoff",
				summary: "test suite failed",
				detail: `test-runner exit ${code}`,
				autoRepairable: false,
				nextAction:
					"human: run skills/test-runner/src/test-runner.sh run --cwd skills/classic-cinema -- src/*.test.ts and fix",
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
	// This skill's own owner files appear as skills/classic-cinema/<references|src>/<file>
	// — sometimes bare, sometimes embedded in a command line. Pull the concrete
	// file token (one with an extension) wherever it appears, and resolve from the
	// repo root (two levels above SKILL_ROOT, i.e. skills/classic-cinema). Skip
	// glob/placeholder forms (src/*.ts, src/<command>.ts) — they are illustrative.
	const repoRoot = join(SKILL_ROOT, "..", "..");
	const referenced = new Set(
		[
			...md.matchAll(
				/\bskills\/classic-cinema\/(?:references|src)\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+/g,
			),
		]
			.map((m) => m[0])
			.filter((rel) => !/[*<>]/.test(rel)),
	);
	const missing: string[] = [];
	for (const rel of referenced) {
		if (!(await Bun.file(join(repoRoot, rel)).exists())) missing.push(rel);
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
	tests: checkTests,
	"template-frozen": checkTemplateFrozen,
	"booking-log-valid": checkBookingLogValid,
	"productivity-yml": checkProductivityYml,
	"owner-paths": checkOwnerPaths,
};

export function knownCheckIds(): string[] {
	return Object.keys(CHECKS);
}

export async function runChecks(only: string | null): Promise<Finding[]> {
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

export interface RepairResult {
	checkId: string;
	applied: boolean;
	summary: string;
	backupPath?: string;
	previewLines?: string[];
}

export async function repairBookingLog(execute: boolean): Promise<RepairResult> {
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
