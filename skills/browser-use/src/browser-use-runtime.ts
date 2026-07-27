// ---------------------------------------------------------------------------
// Browser Use runtime port (the I/O seam).
//
// Every side effect the CLI performs — command execution, file reads/writes,
// directory creation, stdin — flows through this port so the discovery,
// selection, and operation assemblers stay pure and the driver owns all I/O
// (mirrors AdapterProofRuntime / prepare's read-then-assemble split). The
// default implementation binds the port to the real process; tests pass a
// capturing runtime.
// ---------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { BrowserUseTokenRetrievalPort } from "./browser-use-op";
import {
	type BrowserUsePlatformFs,
	createDefaultPlatformFs,
} from "./browser-use-paths";
import {
	type McporterCommandInput,
	type McporterCommandResult,
	spawnMcporterCommand,
} from "./mcporter-transport";

export type BrowserUseRuntime = {
	env: Record<string, string | undefined>;
	now: () => number;
	// Structured, shell-free command runner the shared mcporter transport drives
	// (plan U4). Same shape Browser Adapter Proof uses, so both surfaces run the
	// command vector identically.
	runCommand: (input: McporterCommandInput) => Promise<McporterCommandResult>;
	// Read a supplied evidence file (--route, --adapter-proof) or selected-target
	// state (--state). Kept on the runtime so the discovery/selection assembler
	// stays pure and the CLI driver owns all I/O (mirrors AdapterProofRuntime /
	// prepare's read-then-assemble split).
	readTextFile: (path: string) => Promise<string>;
	// Write run-scoped selected-target state (U6). Owner-only and atomic: the
	// default writes a temp sibling with 0600 perms then renames it over the
	// target so a partial write is never observed and the file is never group/
	// world readable. Kept on the runtime so the selection assembler stays pure
	// and the CLI driver owns the single write.
	writeTextFile: (path: string, contents: string) => Promise<void>;
	// Create local artifact directories before browser operations that write files.
	// This keeps filesystem failures before live browser focus/operation side
	// effects.
	ensureDirectory: (path: string) => Promise<void>;
	// Read the piped stdin envelope `targets select` resolves against (U6),
	// mirroring the Router envelope seam. Returns "" when nothing is piped; the
	// inline env var is the fallback the CLI driver applies when this is empty.
	readStdin: () => Promise<string>;
	/** Platform store filesystem (U2). Default binds node:fs/promises; tests
	 *  inject temp-rooted real fs or the volatile-overlay fake. */
	platformFs: BrowserUsePlatformFs;
	/**
	 * Prompt-free token retrieval custody (auth plan U3a, R7). ABSENT by
	 * default: production custody belongs to the signed Token Retrieval
	 * Launcher (ADR 0028 U3b), which does not exist on an unenrolled machine —
	 * a legal typed state the auth commands report, never a crash. Tests and
	 * the future U3b wiring inject a port.
	 */
	authTokenRetrieval?: BrowserUseTokenRetrievalPort;
	/**
	 * Internal Verified Handoff Envelope mint (design brief D4): prove the
	 * connection and mint the envelope in-process through browser-connect's
	 * exported `main` — the everyday `task run --intent` path needs no caller-
	 * managed `--handoff`. Returns browser-connect's exact stdout/stderr and
	 * exit code so a connect failure (exit 20, one Repair Path) surfaces
	 * verbatim. Envelope contract ownership stays with browser-connect; this
	 * seam only carries bytes. Tests inject a fixture-backed fake.
	 */
	mintHandoff: (input: {
		adapterId: string;
		runId?: string;
	}) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
};

export function createDefaultBrowserUseRuntime(
	overrides: Partial<BrowserUseRuntime> = {},
): BrowserUseRuntime {
	return {
		env: { ...process.env },
		now: () => Date.now(),
		runCommand: (input: McporterCommandInput) => spawnMcporterCommand(input),
		readTextFile: (path: string) => readFile(path, "utf-8"),
		writeTextFile: (path: string, contents: string) =>
			writeStateFileAtomically(path, contents),
		ensureDirectory: async (path: string) => {
			await mkdir(path, { recursive: true, mode: 0o700 });
		},
		readStdin: () => readAllStdin(),
		platformFs: createDefaultPlatformFs(),
		mintHandoff: (input) => mintHandoffInProcess(input),
		...overrides,
	};
}

// In-process envelope mint (D4). Imports browser-connect's CLI lazily so the
// module cost lands only on the mint path, captures its writers, and returns
// the raw envelope bytes: browser-use never re-implements connect semantics
// and never re-declares the envelope schema. A missing browser-connect module
// (published-package edge) degrades to a typed failure shape the task-run
// driver maps to `supply_matching_handoff` — never a crash.
async function mintHandoffInProcess(input: {
	adapterId: string;
	runId?: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	let cli: typeof import("@side-quest/browser-connect/cli");
	try {
		cli = await import("@side-quest/browser-connect/cli");
	} catch {
		return {
			exitCode: 1,
			stdout: "",
			stderr:
				"browser-connect is not importable in this installation; pass --handoff <path> with a pre-minted Verified Handoff Envelope.",
		};
	}
	const capture = () => {
		const chunks: string[] = [];
		return {
			writer: {
				write: (text: string) => {
					chunks.push(text);
					return true;
				},
			},
			text: () => chunks.join(""),
		};
	};
	const stdout = capture();
	const stderr = capture();
	const deps = await cli.createProductionDeps();
	const exitCode = await cli.main(
		[
			"connect",
			input.adapterId,
			"--json",
			...(input.runId === undefined ? [] : ["--run-id", input.runId]),
		],
		{ ...deps, stdout: stdout.writer, stderr: stderr.writer },
	);
	return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
}

// Read all of stdin as UTF-8. An interactive terminal has no piped envelope, so
// return "" rather than blocking on a TTY; the CLI driver then falls back to the
// inline env var. Mirrors the Router stdin seam: collect raw chunks and decode
// ONCE over the joined bytes. Decoding per chunk (`data += toString` per chunk)
// corrupts any multi-byte UTF-8 codepoint split across a chunk boundary (finding
// #5); Buffer.concat then a single decode keeps codepoints intact.
async function readAllStdin(): Promise<string> {
	if (process.stdin.isTTY) return "";
	const chunks: Uint8Array[] = [];
	for await (const chunk of Bun.stdin.stream()) {
		chunks.push(chunk);
	}
	return decodeStdinChunks(chunks);
}

// Concatenate raw stdin byte chunks and decode ONCE as UTF-8. Decoding each
// chunk independently corrupts a multi-byte codepoint that straddles a chunk
// boundary; joining the bytes first then decoding keeps codepoints intact
// (finding #5). Exported so the boundary-decode behavior is unit-testable
// without a live stdin pipe.
export function decodeStdinChunks(chunks: readonly Uint8Array[]): string {
	return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
		"utf-8",
	);
}

// Atomic, owner-only state write. Write a temp sibling in the same directory
// (so rename stays on one filesystem and is atomic), force 0600 via the open
// mode, then rename over the target. A crash mid-write leaves the temp file, not
// a half-written state file. The temp suffix carries the pid so two processes
// writing the same run state do not clobber each other's temp file before the
// rename. No randomness or clock reads here: the suffix need only be unique per
// concurrent writer, not unpredictable, and the state contents own freshness.
async function writeStateFileAtomically(
	path: string,
	contents: string,
): Promise<void> {
	const tempPath = `${path}.tmp-${process.pid}`;
	await writeFile(tempPath, contents, { mode: 0o600 });
	await rename(tempPath, path);
}
