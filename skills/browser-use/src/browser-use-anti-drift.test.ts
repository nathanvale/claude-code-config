import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	BROWSER_USE_GUIDE_TOPICS,
	type BrowserUseGuideTopic,
} from "./command-contract";
import { renderGuide } from "./browser-use-guide";
import { parseBrowserUseArgv } from "./browser-use-parser";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

// Process (E) tier harness: spawn the real browser-use.ts entry as a
// subprocess and capture exit code + stdout, so an oracle proven in-process via
// runForTest is re-proven across a real process boundary (the same idiom the
// DDA-F25 spawn tests in browser-use-sec-seams.test.ts and the DDA-H22 journeys
// in browser-use-process-hygiene.test.ts use). Only HOME is set so the child
// inherits no repo state and a hermetic temp dir owns its XDG bases.
const BROWSER_USE_CLI = join(
	dirname(fileURLToPath(import.meta.url)),
	"browser-use.ts",
);
const SPAWN_TIMEOUT_MS = 15_000;
const SPAWN_TEST_TIMEOUT_MS = SPAWN_TIMEOUT_MS + 10_000;

const neutralCwd = mkdtempSync(join(tmpdir(), "browser-use-anti-drift-"));
afterAll(() => rmSync(neutralCwd, { recursive: true, force: true }));

async function spawnBrowserUse(
	args: readonly string[],
	extraEnv: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const child = Bun.spawn([process.execPath, BROWSER_USE_CLI, ...args], {
		cwd: neutralCwd,
		env: { HOME: neutralCwd, ...extraEnv },
		stdout: "pipe",
		stderr: "pipe",
	});
	const timeout = setTimeout(() => child.kill(), SPAWN_TIMEOUT_MS);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	clearTimeout(timeout);
	return { exitCode, stdout, stderr };
}

// ---------------------------------------------------------------------------
// Anti-drift acceptance guards (Daily Driver Acceptance Ledger DDA-A19,
// DDA-A20; docs/plans/2026-07-27-daily-driver-acceptance-ledger.md).
//
// Cheap, deterministic guards that pin two drift classes:
//   A19 — an unknown flag on a valid leaf is a typed usage error naming it.
//   A20 — every command string the guide prints is accepted by the parser.
// Contract (C) + entrypoint (E) tiers only: no live browser, no network. C
// tiers feed the pure parser / guide content module; E tiers drive the full
// browser-use CLI through runForTest. DDA-G17 lives in its own file
// (browser-use-anti-drift-g17.test.ts): its oracle contradicts the current
// exit-code contract, so it fails deliberately rather than being weakened.
// ---------------------------------------------------------------------------

// ===========================================================================
// DDA-A19 — Unknown flag on a valid leaf fails with a typed usage error naming
// the flag. Oracle: `browser-use task list --bogus` exits 2 and the error
// names `--bogus`. The existing parser suite covers the targets/operate
// leaves; the oracle names a PLATFORM-family leaf (`task list`), so it is
// pinned here explicitly at both tiers.
// ===========================================================================

describe("DDA-A19 unknown flag on a valid leaf is a typed usage error", () => {
	// C tier: the pure parser rejects the undeclared flag by name.
	test("C: the parser throws a usage error naming --bogus for task list", () => {
		expect(() => parseBrowserUseArgv(["task", "list", "--bogus"])).toThrow(
			"unknown option: --bogus",
		);
	});

	// E tier: the full CLI resolves the valid leaf, then exits 2 with a typed
	// usage_error envelope naming the flag — the oracle's exact command.
	test("E: `task list --bogus` exits 2 with a usage_error naming the flag", async () => {
		const result = await runForTest(
			["task", "list", "--bogus", "--json"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(2);
		const envelope = parseJson(result.stdout) as {
			status: string;
			error: { code: string; message: string };
		};
		expect(envelope.status).toBe("error");
		expect(envelope.error.code).toBe("usage_error");
		expect(envelope.error.message).toContain("--bogus");
	});

	// E tier (process boundary): the SAME oracle re-proven by spawning the real
	// browser-use.ts as a subprocess with a hermetic HOME. runForTest above
	// proves the semantics in-process; this crosses the real process boundary
	// the in-process test cannot reach — exit 2, typed usage_error envelope on
	// stdout naming --bogus.
	test(
		"E (spawned): `task list --bogus` exits 2 with a usage_error naming the flag",
		async () => {
			const result = await spawnBrowserUse(["task", "list", "--bogus", "--json"]);
			expect(result.exitCode, result.stdout || result.stderr).toBe(2);
			const envelope = parseJson(result.stdout) as {
				status: string;
				error: { code: string; message: string };
			};
			expect(envelope.status).toBe("error");
			expect(envelope.error.code).toBe("usage_error");
			expect(envelope.error.message).toContain("--bogus");
		},
		SPAWN_TEST_TIMEOUT_MS,
	);
});

// ===========================================================================
// DDA-A20 — Every command string printed by the guide is accepted by the
// parser. Oracle: a contract test extracts guide command lines, feeds the
// parser, and expects ZERO rejects. This pins the bundled guide text to parser
// reality: a family rename, a dropped subcommand, or a removed flag would make
// a printed copy-paste command un-runnable, and this test fails loudly instead
// of shipping guidance an agent cannot execute.
// ===========================================================================

// Placeholder tokens the guide prints for values an agent supplies. Each maps
// to a CONTRACT-VALID sample so the parser sees the same shape an agent would
// type — enum flags get a registered value so an enum drift is still caught,
// free-form flags get a neutral literal.
const PLACEHOLDER_SUBSTITUTIONS: Readonly<Record<string, string>> = {
	// Enum-typed flag values (drift-sensitive): a registered value each.
	"--topic": "core",
	"--adapter": "agent-browser",
	"--intent": "scrape",
	// Free-form value placeholders.
	"--run": "sample-run",
	"--service": "sample-service",
	"--flow": "sample-flow",
	"--handoff": "sample-handoff.json",
	"--allowed-origin": "https://example.test",
	"--candidate": "1",
};

// Split `snapshot|screenshot|emulate`-style alternations into one command per
// alternative so each printed alternative is parsed on its own.
function expandAlternations(tokens: readonly string[]): string[][] {
	const index = tokens.findIndex((token) => token.includes("|"));
	if (index === -1) return [[...tokens]];
	const [before, alternation, after] = [
		tokens.slice(0, index),
		tokens[index] as string,
		tokens.slice(index + 1),
	];
	return alternation
		.split("|")
		.flatMap((alt) =>
			expandAlternations([...before, alt, ...after]),
		);
}

// Normalize one printed guide command line into argv token vectors:
// - drop the leading `browser-use` bin token,
// - stop at an inline `#` comment,
// - drop the discovery line's literal `...` continuation marker,
// - substitute `<placeholder>` value tokens with contract-valid samples,
// - expand `a|b|c` subcommand alternations into one vector each.
function toArgvVectors(commandLine: string): string[][] {
	const raw = commandLine.trim().split(/\s+/);
	const tokens: string[] = [];
	for (let i = 1; i < raw.length; i += 1) {
		const token = raw[i] as string;
		if (token.startsWith("#")) break; // inline comment: stop.
		if (token === "...") continue; // discovery-line continuation marker.
		if (token.startsWith("<") && token.endsWith(">")) {
			// A bare `<placeholder>` value follows the flag token just pushed.
			const flag = tokens[tokens.length - 1];
			const sample = flag ? PLACEHOLDER_SUBSTITUTIONS[flag] : undefined;
			tokens.push(sample ?? "sample-value");
			continue;
		}
		tokens.push(token);
	}
	return expandAlternations(tokens);
}

// Extract copy-paste command lines from rendered guide text. A copy-paste line
// is one whose trimmed form starts with `browser-use ` and is not a topic
// TITLE line (titles carry an em-dash separator, never a runnable command).
// Prose-embedded mentions of `browser-use ...` inside a sentence are not
// copy-paste lines and are excluded — the guide's style contract reserves
// indented standalone lines for runnable commands.
function extractGuideCommandLines(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(
			(line) => line.startsWith("browser-use ") && !line.includes("—"),
		)
		// A printed line can chain two commands with a shell pipe (` | `): the
		// discovery line pipes `targets list` into `targets select`. Split on the
		// spaced pipe into standalone command strings so each is parsed on its own.
		// (The tight `snapshot|screenshot|emulate` alternation carries no spaces
		// and is expanded per-token later, not split here.)
		.flatMap((line) => line.split(/\s\|\s/))
		.map((command) => command.trim())
		.filter((command) => command.startsWith("browser-use "));
}

function allGuideText(): string {
	const topics: BrowserUseGuideTopic[] = [...BROWSER_USE_GUIDE_TOPICS];
	const rendered = topics.map((topic) => renderGuide(topic, false));
	// The full core appendix prints the advanced platform command lines too.
	rendered.push(renderGuide("core", true));
	return rendered.join("\n");
}

describe("DDA-A20 every guide command string is accepted by the parser", () => {
	// C tier: extract every copy-paste command line from every guide topic
	// (plus the --full appendix), feed each to the parser, and require ZERO
	// rejects. A reject is any parse throw OR a resolved kind that is not a
	// runnable command/help/version/launcher.
	test("C: guide command lines parse with zero rejects", () => {
		const text = allGuideText();
		const commandLines = extractGuideCommandLines(text);
		// Guard the extractor itself: if it stops finding commands, the pin is
		// silently dead. The core loop alone prints five, so require a floor.
		expect(commandLines.length).toBeGreaterThanOrEqual(10);

		const rejects: Array<{ line: string; reason: string }> = [];
		for (const line of commandLines) {
			for (const argv of toArgvVectors(line)) {
				try {
					const kind: string = parseBrowserUseArgv(argv).kind;
					if (
						kind !== "command" &&
						kind !== "help" &&
						kind !== "version" &&
						kind !== "launcher"
					) {
						rejects.push({
							line,
							reason: `unexpected parse kind ${kind}`,
						});
					}
				} catch (error) {
					rejects.push({
						line,
						reason: (error as Error).message,
					});
				}
			}
		}
		expect(rejects).toEqual([]);
	});

	// The everyday-loop core commands are the ones an agent copies first; pin
	// their exact printed forms resolve to a real command so a rename of the
	// task/run/artifact families cannot pass the broader zero-reject sweep by
	// accident.
	test("C: the core everyday-loop commands each resolve to a command", () => {
		const core = renderGuide("core", false);
		const coreLines = extractGuideCommandLines(core);
		for (const marker of [
			"browser-use task list",
			"browser-use task run",
			"browser-use run status",
			"browser-use run resume",
			"browser-use artifact list",
		]) {
			const line = coreLines.find((candidate) =>
				candidate.startsWith(marker),
			);
			expect(line).toBeDefined();
			const [argv] = toArgvVectors(line as string);
			const parsed = parseBrowserUseArgv(argv as string[]);
			expect(parsed.kind).toBe("command");
		}
	});
});
