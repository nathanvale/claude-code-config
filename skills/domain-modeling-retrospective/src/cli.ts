#!/usr/bin/env bun

import { randomUUID } from "node:crypto"
import { COMMANDS, COMMAND_NAME, HELP_TEXT } from "./command-contract.ts"
import {
	discoverRepositorySessions,
	SessionDiscoveryError,
} from "./session-discovery.ts"
import { extractRepositorySession } from "./session-extraction.ts"

interface ParsedArgs {
	command?: "scan" | "extract"
	help: boolean
	json: boolean
	repo?: string
	terms: string[]
	session?: string
	offset?: number
	limit?: number
	maxMessageChars?: number
}

class UsageError extends Error {}

function positiveInteger(value: string, flag: string, allowZero = false): number {
	const parsed = Number(value)
	const valid = Number.isInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0)
	if (!valid) throw new UsageError(`${flag} requires ${allowZero ? "a non-negative" : "a positive"} integer`)
	return parsed
}

/**
 * Parse the public argv surface without reading session state.
 *
 * @param args - Arguments after the executable name
 * @returns Validated command intent or help request
 * @throws {UsageError} When arguments cannot map to the public contract
 * @internal
 */
export function parseArgs(args: string[]): ParsedArgs {
	if (args.length === 0) return { help: true, json: false, terms: [] }
	const parsed: ParsedArgs = { help: false, json: false, terms: [] }
	const command = args[0]
	if (command === "-h" || command === "--help") {
		return { ...parsed, help: true }
	}
	if (!COMMANDS.includes(command as (typeof COMMANDS)[number])) {
		throw new UsageError(`Unknown command: ${command}`)
	}
	parsed.command = command as ParsedArgs["command"]

	for (let index = 1; index < args.length; index += 1) {
		const arg = args[index]
		if (arg === "-h" || arg === "--help") {
			parsed.help = true
			continue
		}
		if (arg === "--json") {
			parsed.json = true
			continue
		}
		const value = args[index + 1]
		if (!value || value.startsWith("-")) {
			throw new UsageError(`${arg} requires a value`)
		}
		index += 1
		switch (arg) {
			case "--repo":
				parsed.repo = value
				break
			case "--term":
				parsed.terms.push(value)
				break
			case "--session":
				parsed.session = value
				break
			case "--offset":
				parsed.offset = positiveInteger(value, arg, true)
				break
			case "--limit":
				parsed.limit = positiveInteger(value, arg)
				break
			case "--max-message-chars":
				parsed.maxMessageChars = positiveInteger(value, arg)
				break
			default:
				throw new UsageError(`Unknown option: ${arg}`)
		}
	}
	if (!parsed.help && !parsed.repo) throw new UsageError("--repo is required")
	if (!parsed.help && parsed.command === "extract" && !parsed.session) {
		throw new UsageError("--session is required for extract")
	}
	if (!parsed.help && parsed.command === "extract" && parsed.terms.length > 0) {
		throw new UsageError("--term is valid only for scan")
	}
	return parsed
}

interface CliIo {
	stdout: (text: string) => void
	stderr: (text: string) => void
}

function jsonEnvelope(status: "ok" | "error", runId: string, body: unknown): string {
	return `${JSON.stringify({ status, run_id: runId, ...(status === "ok" ? { data: body } : { error: body }) })}\n`
}

/**
 * Execute one command with injectable streams for process-boundary tests.
 *
 * @param args - Arguments after the executable name
 * @param io - Output sinks; defaults to process stdout and stderr
 * @returns Process exit code without terminating the caller
 * @internal
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
			const result = await discoverRepositorySessions({
				repoPath: parsed.repo as string,
				terms: parsed.terms,
				limit: parsed.limit,
			})
			io.stdout(
				parsed.json
					? jsonEnvelope("ok", runId, result)
					: `Scanned ${result.scanned_sessions} sessions; ${result.repository_sessions} belong to this repository; ${result.strong_candidates} contain domain or decision signals.\n${result.next_safe_action}\n`,
			)
			return 0
		}
		const result = await extractRepositorySession({
			repoPath: parsed.repo as string,
			opaqueId: parsed.session as string,
			offset: parsed.offset,
			limit: parsed.limit,
			maxMessageChars: parsed.maxMessageChars,
		})
		io.stdout(
			parsed.json
				? jsonEnvelope("ok", runId, result)
				: result.messages
					.map((message) => `[${message.index}] ${message.role}: ${message.text}`)
					.join("\n\n") + `\n\n${result.next_safe_action}\n`,
		)
		return 0
	} catch (error) {
		const usage = error instanceof UsageError
		const category = usage
			? "invalid_usage"
			: error instanceof SessionDiscoveryError
				? error.category
				: "runtime_failure"
		const message = error instanceof Error ? error.message : String(error)
		const details = {
			category,
			message,
			retry_safe: true,
			next_action: usage
				? `Run ${COMMAND_NAME} --help and correct the arguments.`
				: "Repair the named repository or session source, then retry with the same input.",
		}
		if (parsed?.json || args.includes("--json")) io.stdout(jsonEnvelope("error", runId, details))
		else io.stderr(`${COMMAND_NAME}: ${message}\n`)
		return usage ? 2 : 3
	}
}

if (import.meta.main) {
	process.exitCode = await runCli(process.argv.slice(2))
}
