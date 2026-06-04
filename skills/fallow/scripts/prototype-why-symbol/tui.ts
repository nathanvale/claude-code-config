// PROTOTYPE — throwaway TUI shell. Delete when the question is answered.
// Drives trace-client.ts against real exports in browser-use/scripts and shows
// the reachability verdict, so you can feel out whether `why <symbol>` resolves
// false positives. Run: bun run prototype-why-symbol/tui.ts
//
// The interesting moment: point it at createDefaultBrowserUseRuntime (which
// audit flags remove-export on) and watch it come back "false-positive — used
// by the test". That is the whole manual investigation, deterministic.

import { deriveVerdict, explainVerdict, traceExport } from "./trace-client.ts";
import type { TraceExportEvidence } from "./trace-client.ts";

const ROOT = "/Users/nathanvale/.claude/skills/browser-use/scripts";

// Real exports Fallow flags in this folder (from audit remove-export findings).
// Mix of genuine false positives (test-only) and the contract surface.
const SYMBOLS: Array<{ file: string; exportName: string }> = [
	{ file: "browser-use.ts", exportName: "createDefaultBrowserUseRuntime" },
	{ file: "browser-use.ts", exportName: "runBrowserUseCli" },
	{ file: "command-contract.ts", exportName: "browserUseContracts" },
	{ file: "browser-adapter-router.ts", exportName: "createRouterEngine" },
];

const B = "\x1b[1m";
const D = "\x1b[2m";
const R = "\x1b[0m";
const G = "\x1b[32m";
const Y = "\x1b[33m";
const C = "\x1b[36m";

type Row = {
	file: string;
	exportName: string;
	state: "pending" | "tracing" | "done" | "error";
	evidence?: TraceExportEvidence;
	error?: string;
};

const rows: Row[] = SYMBOLS.map((s) => ({ ...s, state: "pending" }));
let cursor = 0;

function verdictColor(v: string): string {
	if (v === "false-positive") return G;
	if (v === "likely-dead") return Y;
	return C;
}

function render(): void {
	process.stdout.write("\x1b[2J\x1b[H");
	console.log(`${B}why <symbol> — fallow-mcp trace_export spike${R}`);
	console.log(`${D}root: ${ROOT}${R}\n`);

	rows.forEach((row, i) => {
		const sel = i === cursor ? `${B}>${R} ` : "  ";
		const id = `${C}${row.file}${R} ${B}${row.exportName}${R}`;
		if (row.state === "pending") {
			console.log(`${sel}${id}  ${D}[pending]${R}`);
			return;
		}
		if (row.state === "tracing") {
			console.log(`${sel}${id}  ${Y}[tracing…]${R}`);
			return;
		}
		if (row.state === "error") {
			console.log(`${sel}${id}  ${Y}error: ${row.error}${R}`);
			return;
		}
		const ev = row.evidence as TraceExportEvidence;
		const verdict = deriveVerdict(ev);
		const col = verdictColor(verdict);
		console.log(`${sel}${id}  ${col}${B}${verdict}${R}`);
		console.log(
			`     ${D}is_used=${ev.is_used}  file_reachable=${ev.file_reachable}  entry_point=${ev.is_entry_point}  refs=${ev.direct_references.length}${R}`,
		);
		if (i === cursor) {
			console.log(`     ${explainVerdict(ev)}`);
			if (ev.direct_references.length > 0) {
				for (const ref of ev.direct_references) {
					console.log(`       ${D}← ${ref.from_file} (${ref.kind})${R}`);
				}
			}
		}
	});

	console.log(
		`\n${D}${B}[t]${R}${D} trace selected  ${B}[a]${R}${D} trace all  ${B}[↑/↓ or j/k]${R}${D} move  ${B}[q]${R}${D} quit${R}`,
	);
}

async function trace(row: Row): Promise<void> {
	row.state = "tracing";
	render();
	try {
		row.evidence = await traceExport({
			root: ROOT,
			file: row.file,
			exportName: row.exportName,
		});
		row.state = "done";
	} catch (err) {
		row.state = "error";
		row.error = err instanceof Error ? err.message : String(err);
	}
	render();
}

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
render();

process.stdin.on("data", async (key: string) => {
	if (key === "q" || key === "\x03") {
		process.stdout.write("\x1b[2J\x1b[H");
		process.exit(0);
	}
	if (key === "j" || key === "\x1b[B") cursor = Math.min(cursor + 1, rows.length - 1);
	if (key === "k" || key === "\x1b[A") cursor = Math.max(cursor - 1, 0);
	if (key === "t") {
		await trace(rows[cursor]);
		return;
	}
	if (key === "a") {
		for (const row of rows) await trace(row);
		return;
	}
	render();
});
