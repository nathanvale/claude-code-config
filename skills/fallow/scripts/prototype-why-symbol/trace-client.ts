// PROTOTYPE — portable bit. This is the module worth keeping (item 2 in
// docs/plans/2026-06-05-001-feat-fallow-agent-actionability-plan.md). It is a
// thin, pure-ish client over the `fallow-mcp` stdio MCP server's trace_export
// tool. No terminal code, no control-flow logging — the TUI shell drives it.
//
// Question being answered: can a Bun/TS script do the fallow-mcp JSON-RPC
// handshake and call trace_export, and is the returned reachability evidence
// genuinely useful for resolving a flagged-but-actually-used export?

import { spawn } from "node:child_process";

export type TraceExportEvidence = {
	file: string;
	export_name: string;
	file_reachable: boolean;
	is_entry_point: boolean;
	is_used: boolean;
	direct_references: Array<{ from_file: string; kind: string }>;
	re_export_chains: unknown[];
};

export type WhyVerdict = {
	symbol: string;
	file: string;
	// The agent-facing conclusion derived from raw evidence.
	verdict: "false-positive" | "likely-dead" | "entry-point" | "unknown";
	reason: string;
	evidence: TraceExportEvidence;
};

type JsonRpcResponse = {
	id?: number;
	result?: { content?: Array<{ type: string; text: string }> };
	error?: { code: number; message: string };
};

// One-shot session: spawn fallow-mcp, handshake, call trace_export, close.
// Kept one-shot on purpose for the spike; a real runner would pool the session.
export async function traceExport(args: {
	root: string;
	file: string;
	exportName: string;
	timeoutMs?: number;
}): Promise<TraceExportEvidence> {
	const proc = spawn("fallow-mcp", [], { stdio: ["pipe", "pipe", "ignore"] });
	const timeoutMs = args.timeoutMs ?? 30_000;

	const send = (obj: unknown) => proc.stdin.write(`${JSON.stringify(obj)}\n`);

	send({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "why-symbol-spike", version: "0" },
		},
	});
	send({ jsonrpc: "2.0", method: "notifications/initialized" });
	send({
		jsonrpc: "2.0",
		id: 2,
		method: "tools/call",
		params: {
			name: "trace_export",
			arguments: {
				root: args.root,
				file: args.file,
				export_name: args.exportName,
			},
		},
	});
	proc.stdin.end();

	const raw = await collectResponse(proc, 2, timeoutMs);
	const text = raw.result?.content?.[0]?.text;
	if (raw.error) throw new Error(`fallow-mcp error: ${raw.error.message}`);
	if (!text) throw new Error("fallow-mcp returned no trace_export content");
	const parsed = JSON.parse(text);
	// GOTCHA (confirmed in spike): a missing symbol comes back as a tool-level
	// error object INSIDE the content text, not as a JSON-RPC error. The runner
	// must detect this shape, not assume trace evidence is always present.
	if (parsed && typeof parsed === "object" && parsed.error === true) {
		throw new SymbolNotFoundError(parsed.message ?? "export not found");
	}
	return parsed as TraceExportEvidence;
}

export class SymbolNotFoundError extends Error {}

// Read newline-delimited JSON-RPC frames until the response with `wantId` lands.
function collectResponse(
	proc: ReturnType<typeof spawn>,
	wantId: number,
	timeoutMs: number,
): Promise<JsonRpcResponse> {
	return new Promise((resolve, reject) => {
		let buffer = "";
		const timer = setTimeout(() => {
			proc.kill();
			reject(new Error(`fallow-mcp timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		proc.stdout?.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			let nl: number;
			// biome-ignore lint/suspicious/noAssignInExpressions: frame loop
			while ((nl = buffer.indexOf("\n")) !== -1) {
				const line = buffer.slice(0, nl).trim();
				buffer = buffer.slice(nl + 1);
				if (!line) continue;
				let frame: JsonRpcResponse;
				try {
					frame = JSON.parse(line);
				} catch {
					continue;
				}
				if (frame.id === wantId) {
					clearTimeout(timer);
					resolve(frame);
					return;
				}
			}
		});
		proc.on("exit", () => {
			clearTimeout(timer);
			reject(new Error("fallow-mcp exited before responding"));
		});
	});
}

// The derived agent conclusion — this is what a runner would expose as the
// `why` verdict. Pure: evidence in, verdict out.
export function deriveVerdict(evidence: TraceExportEvidence): WhyVerdict["verdict"] {
	if (evidence.is_entry_point) return "entry-point";
	if (evidence.is_used) return "false-positive"; // flagged but referenced
	if (!evidence.file_reachable && !evidence.is_used) return "likely-dead";
	return "unknown";
}

export function explainVerdict(evidence: TraceExportEvidence): string {
	const refs = evidence.direct_references;
	if (evidence.is_entry_point) return "Export lives in an entry point; keep.";
	if (evidence.is_used) {
		const where = refs.map((r) => `${r.from_file} (${r.kind})`).join(", ");
		return `Flagged because the file is unreachable from any entry point, but the export IS imported by: ${where}. Do not remove — suppress or model the entry instead.`;
	}
	if (!evidence.file_reachable) {
		return "File is unreachable from any entry point and the export has no references. Likely safe to remove.";
	}
	return "No clear signal; inspect manually.";
}
