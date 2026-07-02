#!/usr/bin/env bun

import { readFileSync } from "node:fs";

type Diagnostic = {
	severity: "error";
	code: string;
	message: string;
	file?: string;
};

type Result = {
	status: "ok" | "error";
	files: string[];
	diagnostics: Diagnostic[];
};

const OUTCOMES = [
	"none found",
	"added inline gotcha",
	"reused existing guidance",
	"escalated to safety gate",
];

const EVIDENCE_CLASSES = [
	"observed failure",
	"review finding",
	"adversarial probe",
	"research",
];

function printHelp(): void {
	console.log(`Usage: check-gotcha-decision.ts [--json] [--stdin] [file ...]

Validates Gotcha decision lines in review, handoff, or final-response artifacts.

Rules:
  - Include exactly one line starting with "Gotcha decision:".
  - Use one allowed outcome.
  - For outcomes other than "none found", include evidence class and one short reason.

Options:
  --json     Emit JSON.
  --stdin    Read artifact text from stdin.
  -h, --help Show help.`);
}

function parseArgs(argv: string[]): { json: boolean; stdin: boolean; files: string[] } {
	const options = { json: false, stdin: false, files: [] as string[] };
	for (const arg of argv) {
		if (arg === "--json") options.json = true;
		else if (arg === "--stdin") options.stdin = true;
		else if (arg === "-h" || arg === "--help") {
			printHelp();
			process.exit(0);
		} else if (arg.startsWith("-")) {
			throw new Error(`Unknown argument: ${arg}`);
		} else {
			options.files.push(arg);
		}
	}
	return options;
}

function validateText(text: string, file?: string): Diagnostic[] {
	const lines = text.split(/\r?\n/).filter((line) => line.startsWith("Gotcha decision:"));
	if (lines.length !== 1) {
		return [{
			severity: "error",
			code: "gotcha_decision_count",
			file,
			message: `expected exactly one Gotcha decision line, found ${lines.length}`,
		}];
	}

	const value = lines[0].replace(/^Gotcha decision:\s*/, "").trim();
	const outcome = OUTCOMES.find((candidate) => value === candidate || value.startsWith(`${candidate},`));
	if (!outcome) {
		return [{
			severity: "error",
			code: "gotcha_decision_outcome",
			file,
			message: "Gotcha decision line must use an allowed outcome",
		}];
	}

	if (outcome === "none found") return [];

	const detail = value.slice(outcome.length).replace(/^,\s*/, "");
	const evidenceClass = EVIDENCE_CLASSES.find((candidate) => detail.startsWith(`${candidate}:`));
	if (!evidenceClass) {
		return [{
			severity: "error",
			code: "gotcha_decision_evidence_class",
			file,
			message: "non-none Gotcha decision outcomes must include evidence class",
		}];
	}

	const reason = detail.slice(evidenceClass.length + 1).trim();
	if (!reason) {
		return [{
			severity: "error",
			code: "gotcha_decision_reason",
			file,
			message: "non-none Gotcha decision outcomes must include one short reason",
		}];
	}

	return [];
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	if (!options.stdin && options.files.length === 0) {
		throw new Error("provide --stdin or at least one artifact file");
	}

	const diagnostics: Diagnostic[] = [];
	const files: string[] = [];
	if (options.stdin) {
		const text = await new Response(Bun.stdin.stream()).text();
		diagnostics.push(...validateText(text, "stdin"));
		files.push("stdin");
	}

	for (const file of options.files) {
		files.push(file);
		diagnostics.push(...validateText(readFileSync(file, "utf8"), file));
	}

	const result: Result = {
		status: diagnostics.length > 0 ? "error" : "ok",
		files,
		diagnostics,
	};

	if (options.json) {
		console.log(JSON.stringify(result, null, 2));
	} else if (result.status === "ok") {
		console.log("Gotcha decision check passed.");
	} else {
		for (const diagnostic of diagnostics) {
			console.error(`${diagnostic.file ?? "artifact"}: ${diagnostic.code}: ${diagnostic.message}`);
		}
	}

	process.exit(result.status === "ok" ? 0 : 1);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
