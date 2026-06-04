// PROTOTYPE — mcporter-backed variant of the why-symbol client.
//
// Question this variant answers: can the house transport (mcporter, the same
// runner browser-use/scripts/mcporter-transport.ts already uses) replace the
// hand-rolled stdio JSON-RPC client in trace-client.ts?
//
// Answer (see NOTES.md): yes, and it is simpler. mcporter does the handshake,
// unwraps the two-layer content JSON, and separates tool-level errors from
// transport-level (offline) errors. This client is ~40% the size of the
// hand-rolled one and owns no MCP protocol code.
//
// Invocation shape (confirmed live):
//   mcporter call --stdio fallow-mcp --tool trace_export \
//     --cwd <root> --output json --args '{"file":...,"export_name":...}'
// Run via bunx/npx per the house override contract; no global mcporter needed.

import { spawn } from "node:child_process";
import type { TraceExportEvidence } from "./trace-client.ts";
import { SymbolNotFoundError } from "./trace-client.ts";

export class TraceTransportError extends Error {}

// mcporter wraps transport failures (missing server binary, connection drop) as
// { error: string, issue: { kind: "offline" | ... } }, and surfaces tool-level
// failures as the tool's own payload — here Fallow's { error: true, message }.
type McporterEnvelope =
	| TraceExportEvidence
	| { error: true; message: string; exit_code?: number }
	| { error: string; issue?: { kind?: string; rawMessage?: string } };

export async function traceExportViaMcporter(args: {
	root: string;
	file: string;
	exportName: string;
	// Command vector that runs mcporter — mirrors MCPORTER_DEFAULT_COMMAND /
	// the BROWSER_USE_MCPORTER_COMMAND_JSON override contract.
	mcporterCommand?: readonly [string, ...string[]];
	timeoutMs?: number;
}): Promise<TraceExportEvidence> {
	const cmd = args.mcporterCommand ?? ["bunx", "mcporter"];
	const argv = [
		...cmd.slice(1),
		"call",
		"--stdio",
		"fallow-mcp",
		"--tool",
		"trace_export",
		"--cwd",
		args.root,
		"--output",
		"json",
		"--args",
		JSON.stringify({ file: args.file, export_name: args.exportName }),
	];

	const stdout = await run(cmd[0], argv, args.timeoutMs ?? 90_000);
	const parsed = JSON.parse(extractJson(stdout)) as McporterEnvelope;

	// Transport-level failure (mcporter could not reach the server).
	if (
		typeof (parsed as { error?: unknown }).error === "string" &&
		"issue" in parsed
	) {
		throw new TraceTransportError(String((parsed as { error: string }).error));
	}
	// Tool-level failure (Fallow could not find the symbol).
	if ((parsed as { error?: unknown }).error === true) {
		throw new SymbolNotFoundError(
			(parsed as { message?: string }).message ?? "export not found",
		);
	}
	return parsed as TraceExportEvidence;
}

function run(command: string, argv: string[], timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn(command, argv, { stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		let err = "";
		const timer = setTimeout(() => {
			proc.kill();
			reject(new TraceTransportError(`mcporter timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		proc.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
		proc.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
		proc.on("exit", (code) => {
			clearTimeout(timer);
			if (out.trim() === "" && code !== 0) {
				reject(new TraceTransportError(err.trim() || `mcporter exited ${code}`));
				return;
			}
			resolve(out);
		});
	});
}

// bunx prints "Resolving dependencies / Saved lockfile" lines before the JSON
// body. Take from the first `{` to the end — the call payload is the last JSON.
function extractJson(stdout: string): string {
	const start = stdout.indexOf("{");
	if (start === -1) throw new TraceTransportError("mcporter produced no JSON");
	return stdout.slice(start);
}
