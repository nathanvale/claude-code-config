#!/usr/bin/env bun

import { randomUUID } from "node:crypto"
import type { SessionSource } from "@side-quest/session-corpus"
import {
	COMMANDS,
	COMMAND_NAME,
	EXTRACT_DEFAULT_LIMIT,
	HELP_TEXT,
	MAX_MESSAGE_CHARS,
} from "./command-contract.ts"
import {
	extractRecoverySession,
	scanRecoverySessions,
	SessionRecoveryError,
	validateReviewLedger,
} from "./session-recovery-engine.ts"
import type {
	RecoveryScanResult,
	ReviewLedgerRow,
} from "./session-recovery-model.ts"

interface ParsedArgs {
	command?: "scan" | "extract" | "validate"
	help: boolean
	json: boolean
	from?: string
	to?: string
	sources: SessionSource[]
	repo?: string
	sessions: string[]
	offset?: number
	limit?: number
	maxMessageChars?: number
	inventory?: string
	ledger?: string
}

class UsageError extends Error {}

function integer(value: string, flag: string, allowZero = false): number {
	const parsed = Number(value)
	const valid = Number.isInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0)
	if (!valid) {
		throw new UsageError(`${flag} requires ${allowZero ? "a non-negative" : "a positive"} integer`)
	}
	return parsed
}

function rejectPresentOptions(
	command: ParsedArgs["command"],
	options: Array<[string, boolean]>,
): void {
	for (const [option, present] of options) {
		if (present) throw new UsageError(`${option} is not valid for ${command}`)
	}
}

function validateCommandArgs(parsed: ParsedArgs): ParsedArgs {
	if (parsed.help) return parsed
	if (parsed.command === "scan") {
		if (!parsed.from) throw new UsageError("--from is required for scan")
		if (!parsed.to) throw new UsageError("--to is required for scan")
		rejectPresentOptions(parsed.command, [
			["--offset", parsed.offset !== undefined],
			["--limit", parsed.limit !== undefined],
			["--max-message-chars", parsed.maxMessageChars !== undefined],
			["--inventory", parsed.inventory !== undefined],
			["--ledger", parsed.ledger !== undefined],
		])
		return parsed
	}
	if (parsed.command === "extract") {
		if (parsed.sessions.length !== 1) throw new UsageError("extract requires one --session")
		rejectPresentOptions(parsed.command, [
			["--from", parsed.from !== undefined],
			["--to", parsed.to !== undefined],
			["--source", parsed.sources.length > 0],
			["--repo", parsed.repo !== undefined],
			["--inventory", parsed.inventory !== undefined],
			["--ledger", parsed.ledger !== undefined],
		])
		parsed.offset ??= 0
		parsed.limit ??= EXTRACT_DEFAULT_LIMIT
		parsed.maxMessageChars ??= MAX_MESSAGE_CHARS
		return parsed
	}
	if (!parsed.inventory) throw new UsageError("--inventory is required for validate")
	if (!parsed.ledger) throw new UsageError("--ledger is required for validate")
	rejectPresentOptions(parsed.command, [
		["--from", parsed.from !== undefined],
		["--to", parsed.to !== undefined],
		["--source", parsed.sources.length > 0],
		["--repo", parsed.repo !== undefined],
		["--session", parsed.sessions.length > 0],
		["--offset", parsed.offset !== undefined],
		["--limit", parsed.limit !== undefined],
		["--max-message-chars", parsed.maxMessageChars !== undefined],
	])
	return parsed
}

/**
 * Parse the public command surface without reading private session state.
 *
 * @param args - Arguments after the executable name
 * @returns Validated command intent or help request
 * @throws {UsageError} When arguments do not map to one documented command
 *
 * @example
 * ```ts
 * parseArgs(["scan", "--from", "2026-08-01", "--to", "2026-08-08"])
 * ```
 */
export function parseArgs(args: string[]): ParsedArgs {
	const parsed: ParsedArgs = {
		help: false,
		json: false,
		sources: [],
		sessions: [],
	}
	if (args.length === 0) return { ...parsed, help: true }
	const command = args[0]
	if (command === "-h" || command === "--help") return { ...parsed, help: true }
	if (!COMMANDS.includes(command as (typeof COMMANDS)[number])) {
		throw new UsageError(`Unknown command: ${command}`)
	}
	parsed.command = command as ParsedArgs["command"]

	for (let index = 1; index < args.length; index += 1) {
		const argument = args[index]
		if (argument === "-h" || argument === "--help") {
			parsed.help = true
			continue
		}
		if (argument === "--json") {
			parsed.json = true
			continue
		}
		const value = args[index + 1]
		if (!value || value.startsWith("-")) throw new UsageError(`${argument} requires a value`)
		index += 1
		switch (argument) {
			case "--from":
				parsed.from = value
				break
			case "--to":
				parsed.to = value
				break
			case "--source":
				if (value !== "claude" && value !== "codex") {
					throw new UsageError(`--source requires claude or codex: ${value}`)
				}
				parsed.sources.push(value)
				break
			case "--repo":
				parsed.repo = value
				break
			case "--session":
				parsed.sessions.push(value)
				break
			case "--offset":
				parsed.offset = integer(value, argument, true)
				break
			case "--limit":
				parsed.limit = integer(value, argument)
				break
			case "--max-message-chars":
				parsed.maxMessageChars = integer(value, argument)
				break
			case "--inventory":
				parsed.inventory = value
				break
			case "--ledger":
				parsed.ledger = value
				break
			default:
				throw new UsageError(`Unknown option: ${argument}`)
		}
	}
	return validateCommandArgs(parsed)
}

interface CliIo {
	stdout: (text: string) => void
	stderr: (text: string) => void
}

function envelope(status: "ok" | "error", runId: string, body: unknown): string {
	return `${JSON.stringify({ status, run_id: runId, ...(status === "ok" ? { data: body } : { error: body }) })}\n`
}

async function readInventory(path: string): Promise<RecoveryScanResult> {
	const parsed = JSON.parse(await Bun.file(path).text()) as unknown
	const record = parsed !== null && typeof parsed === "object"
		? parsed as Record<string, unknown>
		: undefined
	const data = record?.status === "ok" && record.data ? record.data : parsed
	const result = data as Partial<RecoveryScanResult>
	if (result.action !== "scan" || !Array.isArray(result.ledger)) {
		throw new SessionRecoveryError("Inventory file is not a session-recovery scan result", "invalid_input")
	}
	return result as RecoveryScanResult
}

async function readReviewRows(path: string): Promise<ReviewLedgerRow[]> {
	const rows: ReviewLedgerRow[] = []
	for (const [index, line] of (await Bun.file(path).text()).split("\n").entries()) {
		if (!line.trim()) continue
		try {
			rows.push(JSON.parse(line) as ReviewLedgerRow)
		} catch {
			throw new SessionRecoveryError(`Invalid review JSONL at line ${index + 1}`, "invalid_input")
		}
	}
	return rows
}

/**
 * Execute one command with injectable streams for process-boundary tests.
 *
 * @param args - Arguments after the executable name
 * @param io - Output sinks; defaults to process stdout and stderr
 * @returns Process exit code without terminating the caller
 *
 * @example
 * ```ts
 * const exitCode = await runCli(["--help"])
 * ```
 */
export async function runCli(args: string[], io: CliIo = {
	stdout: (text) => process.stdout.write(text),
	stderr: (text) => process.stderr.write(text),
}): Promise<number> {
	const runId = randomUUID()
	let parsed: ParsedArgs | undefined
	try {
		parsed = parseArgs(args)
		if (parsed.help) {
			io.stdout(HELP_TEXT)
			return 0
		}
		if (parsed.command === "scan") {
			const result = await scanRecoverySessions({
				from: parsed.from as string,
				to: parsed.to as string,
				sources: parsed.sources.length > 0 ? parsed.sources : undefined,
				repoPath: parsed.repo,
				sessions: parsed.sessions,
			})
			io.stdout(parsed.json
				? envelope("ok", runId, result)
				: `Accounted for ${result.reconciliation.ledger_rows} sessions. Complete: ${result.complete ? "yes" : "no"}.\n${result.next_safe_action}\n`)
			return 0
		}
		if (parsed.command === "extract") {
			const result = await extractRecoverySession({
				session: parsed.sessions[0] as string,
				offset: parsed.offset,
				limit: parsed.limit,
				maxMessageChars: parsed.maxMessageChars,
			})
			const page = result.messages.length === 0
				? `No messages returned at offset ${result.offset}.`
				: result.messages.map((message) => `[${message.index}] ${message.role}: ${message.text}`).join("\n\n")
			io.stdout(parsed.json ? envelope("ok", runId, result) : `${page}\n\n${result.next_safe_action}\n`)
			return 0
		}
		const inventory = await readInventory(parsed.inventory as string)
		const rows = await readReviewRows(parsed.ledger as string)
		const result = validateReviewLedger(inventory, rows)
		if (!result.valid) {
			const error = {
				category: "ledger_invalid",
				message: "Review ledger does not reconcile with the inventory.",
				retry_safe: true,
				issues: result.issues,
				reconciliation: result.reconciliation,
				next_action: result.next_safe_action,
			}
			if (parsed.json) io.stdout(envelope("error", runId, error))
			else io.stderr(`${COMMAND_NAME}: ${error.message}\n${result.issues.join("\n")}\n`)
			return 4
		}
		io.stdout(parsed.json
			? envelope("ok", runId, result)
			: `Review ledger reconciled.\n${result.next_safe_action}\n`)
		return 0
	} catch (error) {
		const usage = error instanceof UsageError
		const recovery = error instanceof SessionRecoveryError
		const category = usage ? "invalid_usage" : recovery ? error.category : "runtime_failure"
		const message = error instanceof Error ? error.message : String(error)
		const details = {
			category,
			message,
			retry_safe: !usage,
			next_action: usage
				? `Run ${COMMAND_NAME} --help and correct the arguments.`
				: "Repair the named source or input, then retry with the same arguments.",
		}
		if (parsed?.json || args.includes("--json")) io.stdout(envelope("error", runId, details))
		else io.stderr(`${COMMAND_NAME}: ${message}\n`)
		return usage || (recovery && error.category === "invalid_window") ? 2 : 3
	}
}

if (import.meta.main) process.exitCode = await runCli(process.argv.slice(2))
