#!/usr/bin/env bun

import { randomUUID } from "node:crypto";

import { auditThreads } from "./audit-engine";
import { AuditUsageError, readGmailIdentity } from "./config";
import { GogAuditError, runGogSearch } from "./gog-runner";
import type { AuditResult } from "./model";

const HELP = `gog-inbox-cleanup audit

Read-only Gmail metadata audit. Produces label-only proposals and changes nothing.

Usage:
  gog-inbox-cleanup audit --config <.productivity.yml> --query <bounded-query> --max <1-100> [--json]

Example:
  gog-inbox-cleanup audit --config .productivity.yml --query "in:inbox newer_than:7d" --max 20 --json
`;

interface AuditInvocation {
	configPath: string;
	query: string;
	max: number;
	json: boolean;
}

const VALUE_FLAGS = {
	"--config": "configPath",
	"--query": "query",
	"--max": "maxValue",
} as const;

type ValueFlag = keyof typeof VALUE_FLAGS;
type InvocationValues = Partial<Record<(typeof VALUE_FLAGS)[ValueFlag], string>>;

/**
 * Run the public read-only audit command.
 *
 * @param argv - Arguments after the executable name
 * @returns Process exit code
 *
 * @example
 * ```typescript
 * const exitCode = await main(["--help"])
 * ```
 */
export async function main(argv: string[]): Promise<number> {
	if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(HELP);
		return 0;
	}
	try {
		const invocation = parseInvocation(argv);
		const identity = await readGmailIdentity(invocation.configPath);
		const response = await runGogSearch(identity, invocation.query, invocation.max);
		const result = auditThreads(response, {
			query: invocation.query,
			max: invocation.max,
			runId: randomUUID(),
			now: new Date().toISOString(),
		});
		process.stdout.write(invocation.json ? `${JSON.stringify(result)}\n` : renderHuman(result));
		return 0;
	} catch (error) {
		if (error instanceof AuditUsageError) {
			process.stderr.write(`gog-inbox-cleanup: ${error.message}\n`);
			return 2;
		}
		const message = error instanceof GogAuditError ? error.message : "unexpected read-only audit failure";
		process.stderr.write(`gog-inbox-cleanup: ${message}\n`);
		return 1;
	}
}

function parseInvocation(argv: string[]): AuditInvocation {
	if (argv[0] !== "audit") throw new AuditUsageError("expected the audit command; run --help");
	const values: InvocationValues = {};
	let json = false;
	for (let index = 1; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--json") {
			json = true;
			continue;
		}
		if (isValueFlag(argument)) {
			assignValueFlag(values, argument, argv[index + 1]);
			index += 1;
			continue;
		}
		throw new AuditUsageError(`unknown argument ${argument}; run --help`);
	}
	const { configPath, query, maxValue } = values;
	if (!configPath) throw new AuditUsageError("audit needs --config pointing to .productivity.yml");
	if (!query) throw new AuditUsageError("audit needs --query with a bounded date or age window");
	if (!isBoundedQuery(query)) throw new AuditUsageError("--query must be bounded with newer_than, older_than, after, or before");
	const max = Number(maxValue);
	if (!Number.isInteger(max) || max < 1 || max > 100) throw new AuditUsageError("--max must be an integer between 1 and 100");
	return { configPath, query, max, json };
}

function assignValueFlag(values: InvocationValues, argument: ValueFlag, value: string | undefined): void {
	if (!value || value.startsWith("--")) throw new AuditUsageError(`${argument} needs one value`);
	const key = VALUE_FLAGS[argument];
	if (values[key] !== undefined) throw new AuditUsageError(`${argument} must appear once`);
	values[key] = value;
}

function isValueFlag(value: string): value is ValueFlag {
	return value in VALUE_FLAGS;
}

function isBoundedQuery(query: string): boolean {
	return /(?:^|\s)(?:newer_than|older_than):\d+[dmy](?:\s|$)/.test(query) ||
		/(?:^|\s)(?:after|before):\d{4}[/-]\d{1,2}[/-]\d{1,2}(?:\s|$)/.test(query);
}

function renderHuman(result: AuditResult): string {
	const lines = [
		`Completed read-only audit: ${result.cap.returned}/${result.cap.max} rows`,
		`Label candidates: ${result.receipt.candidateCount}`,
		`Protected or uncertain: ${result.receipt.exclusionCount}`,
	];
	for (const proposal of result.proposals) {
		lines.push(`${proposal.intendedLabel}: ${proposal.scope.value} (${proposal.candidateCount})`);
	}
	lines.push(result.receipt.nextSafeAction);
	return `${lines.join("\n")}\n`;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
