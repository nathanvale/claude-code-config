#!/usr/bin/env bun

import { randomUUID } from "node:crypto"
import type { SessionSource } from "@side-quest/session-corpus"
import {
	COMMANDS,
	COMMAND_NAME,
	CONTRACT_ID,
	EXTRACT_DEFAULT_LIMIT,
	EXTRACT_MAX_LIMIT,
	HELP_TEXT,
	MAX_MESSAGE_CHARS,
	SCHEMA_VERSION,
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

function integer(value: string, flag: string, allowZero = false, max?: number): number {
	const parsed = Number(value)
	const valid = Number.isSafeInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0)
	if (!valid) {
		throw new UsageError(`${flag} requires ${allowZero ? "a non-negative" : "a positive"} integer`)
	}
	if (max !== undefined && parsed > max) {
		throw new UsageError(`${flag} must not exceed ${max}`)
	}
	return parsed
}

function unexpectedCommand(command: never): never {
	throw new UsageError(`Unknown command: ${String(command)}`)
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
	if (!parsed.command) throw new UsageError("Command is required")
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
	if (parsed.command === "validate") {
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
	return unexpectedCommand(parsed.command)
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
				parsed.limit = integer(value, argument, false, EXTRACT_MAX_LIMIT)
				break
			case "--max-message-chars":
				parsed.maxMessageChars = integer(value, argument, false, MAX_MESSAGE_CHARS)
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
	return `${JSON.stringify({
		status,
		run_id: runId,
		contract_id: CONTRACT_ID,
		schema_version: SCHEMA_VERSION,
		...(status === "ok" ? { data: body } : { error: body }),
	})}\n`
}

function invalidInput(message: string): never {
	throw new SessionRecoveryError(message, "invalid_input")
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return invalidInput(`${label} must be an object`)
	}
	return value as Record<string, unknown>
}

function stringValue(value: unknown, label: string): string {
	if (typeof value !== "string") return invalidInput(`${label} must be a string`)
	return value
}

function booleanValue(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") return invalidInput(`${label} must be a boolean`)
	return value
}

function integerValue(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		return invalidInput(`${label} must be a non-negative integer`)
	}
	return value as number
}

function nullableString(value: unknown, label: string): string | null {
	if (value === null) return null
	return stringValue(value, label)
}

function stringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		return invalidInput(`${label} must be an array of strings`)
	}
	return value as string[]
}

function literal<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
	if (typeof value !== "string" || !allowed.includes(value as T)) {
		return invalidInput(`${label} has an invalid value`)
	}
	return value as T
}

function decodeInventoryFilters(value: unknown): {
	from: number
	to: number
	sources: SessionSource[]
} {
	const filters = record(value, "inventory.filters")
	const from = Date.parse(stringValue(filters.from, "inventory.filters.from"))
	const to = Date.parse(stringValue(filters.to, "inventory.filters.to"))
	if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
		return invalidInput("inventory filter window is invalid")
	}
	stringValue(filters.timezone, "inventory.filters.timezone")
	if (!Array.isArray(filters.sources)) return invalidInput("inventory.filters.sources must be an array")
	const sources = filters.sources.map((source) =>
		literal(source, ["claude", "codex"] as const, "inventory.filters.sources[]"))
	if (sources.length === 0 || new Set(sources).size !== sources.length) {
		return invalidInput("inventory.filters.sources must contain unique selected sources")
	}
	nullableString(filters.repository, "inventory.filters.repository")
	const sessions = stringArray(filters.sessions, "inventory.filters.sessions")
	if (new Set(sessions).size !== sessions.length) {
		return invalidInput("inventory.filters.sessions contains duplicates")
	}
	return { from, to, sources }
}

function decodeSourceStates(value: unknown, sources: SessionSource[], complete: boolean): number {
	if (!Array.isArray(value)) return invalidInput("inventory.source_states must be an array")
	const keys = new Set<string>()
	let fileCount = 0
	for (const [index, sourceStateValue] of value.entries()) {
		const sourceState = record(sourceStateValue, `inventory.source_states[${index}]`)
		const source = literal(sourceState.source, ["claude", "codex"], `inventory.source_states[${index}].source`)
		const location = literal(
			sourceState.location,
			["active", "archive"],
			`inventory.source_states[${index}].location`,
		)
		const key = `${source}:${location}`
		if (keys.has(key)) return invalidInput(`duplicate inventory source state: ${key}`)
		keys.add(key)
		literal(sourceState.state, ["available", "missing"], `inventory.source_states[${index}].state`)
		fileCount += integerValue(sourceState.files, `inventory.source_states[${index}].files`)
		const unreadable = integerValue(
			sourceState.unreadable_directories,
			`inventory.source_states[${index}].unreadable_directories`,
		)
		if (complete && (sourceState.state !== "available" || unreadable > 0)) {
			return invalidInput("complete inventory contains incomplete source state")
		}
	}
	const expected = sources.flatMap((source) =>
		source === "claude" ? ["claude:active"] : ["codex:active", "codex:archive"])
	if (keys.size !== expected.length || expected.some((key) => !keys.has(key))) {
		return invalidInput("inventory source states do not match selected sources")
	}
	return fileCount
}

function decodeReconciliation(value: unknown): {
	scannedFiles: number
	nativeSessions: number
	unsupportedFiles: number
	failedFiles: number
	eligible: number
	ledgerRows: number
	unresolvedTimestamps: number
	unresolvedRepositoryMatches: number
} {
	const reconciliation = record(value, "inventory.reconciliation")
	const counts = {
		scannedFiles: integerValue(reconciliation.scanned_files, "inventory.reconciliation.scanned_files"),
		nativeSessions: integerValue(reconciliation.native_sessions, "inventory.reconciliation.native_sessions"),
		unsupportedFiles: integerValue(reconciliation.unsupported_files, "inventory.reconciliation.unsupported_files"),
		failedFiles: integerValue(reconciliation.failed_files, "inventory.reconciliation.failed_files"),
		eligible: integerValue(reconciliation.eligible, "inventory.reconciliation.eligible"),
		ledgerRows: integerValue(reconciliation.ledger_rows, "inventory.reconciliation.ledger_rows"),
		unresolvedTimestamps: integerValue(
			reconciliation.unresolved_timestamps,
			"inventory.reconciliation.unresolved_timestamps",
		),
		unresolvedRepositoryMatches: integerValue(
			reconciliation.unresolved_repository_matches,
			"inventory.reconciliation.unresolved_repository_matches",
		),
	}
	integerValue(reconciliation.excluded, "inventory.reconciliation.excluded")
	return counts
}

function decodeInventoryLedger(value: unknown, from: number, to: number): number {
	if (!Array.isArray(value)) return invalidInput("inventory.ledger must be an array")
	const sessions = new Set<string>()
	for (const [index, rowValue] of value.entries()) {
		const row = record(rowValue, `inventory.ledger[${index}]`)
		const session = stringValue(row.session, `inventory.ledger[${index}].session`)
		if (sessions.has(session)) return invalidInput(`duplicate inventory session: ${session}`)
		sessions.add(session)
		const sessionId = stringValue(row.session_id, `inventory.ledger[${index}].session_id`)
		const source = literal(row.source, ["claude", "codex"], `inventory.ledger[${index}].source`)
		if (session !== `${source}:${sessionId}`) {
			return invalidInput(`inventory.ledger[${index}] session identity is inconsistent`)
		}
		literal(row.kind, ["primary", "helper"], `inventory.ledger[${index}].kind`)
		nullableString(row.parent_session_id, `inventory.ledger[${index}].parent_session_id`)
		const createdAt = Date.parse(stringValue(row.created_at, `inventory.ledger[${index}].created_at`))
		const updatedAt = Date.parse(stringValue(row.updated_at, `inventory.ledger[${index}].updated_at`))
		if (
			!Number.isFinite(createdAt) || !Number.isFinite(updatedAt) ||
			createdAt > updatedAt || createdAt >= to || updatedAt < from
		) {
			return invalidInput(`inventory.ledger[${index}] timestamps are inconsistent`)
		}
		nullableString(row.repository_hint, `inventory.ledger[${index}].repository_hint`)
		nullableString(row.branch, `inventory.ledger[${index}].branch`)
		integerValue(row.message_count, `inventory.ledger[${index}].message_count`)
		stringValue(row.summary, `inventory.ledger[${index}].summary`)
		stringValue(row.outcome_hint, `inventory.ledger[${index}].outcome_hint`)
		const digest = stringValue(row.content_sha256, `inventory.ledger[${index}].content_sha256`)
		if (!/^[a-f0-9]{64}$/.test(digest)) return invalidInput(`inventory.ledger[${index}].content_sha256 is invalid`)
		literal(row.classification, ["unclassified"], `inventory.ledger[${index}].classification`)
		if (row.work_group_id !== null || row.canonical_owner_or_proposal !== null || row.confidence !== null) {
			return invalidInput(`inventory.ledger[${index}] contains review fields`)
		}
		literal(row.reason, ["awaiting evidence review"], `inventory.ledger[${index}].reason`)
		if (row.source_available !== true) return invalidInput(`inventory.ledger[${index}].source_available must be true`)
	}
	return value.length
}

function decodeInventory(value: unknown): RecoveryScanResult {
	const result = record(value, "inventory")
	if (result.contract_id !== CONTRACT_ID || result.schema_version !== SCHEMA_VERSION) {
		return invalidInput(`Inventory contract mismatch; rerun scan with ${COMMAND_NAME}`)
	}
	literal(result.action, ["scan"], "inventory.action")
	literal(result.side_effect, ["none"], "inventory.side_effect")
	const complete = booleanValue(result.complete, "inventory.complete")
	if (result.vault_write_allowed !== false) {
		return invalidInput("inventory.vault_write_allowed must be false")
	}
	const incompleteReasons = stringArray(result.incomplete_reasons, "inventory.incomplete_reasons")
	if (complete === (incompleteReasons.length > 0)) {
		return invalidInput("inventory completeness does not match incomplete reasons")
	}
	const filters = decodeInventoryFilters(result.filters)
	const sourceFileCount = decodeSourceStates(result.source_states, filters.sources, complete)
	const counts = decodeReconciliation(result.reconciliation)
	const ledgerRows = decodeInventoryLedger(result.ledger, filters.from, filters.to)
	if (counts.eligible !== ledgerRows || counts.ledgerRows !== ledgerRows) {
		return invalidInput("inventory reconciliation does not match ledger rows")
	}
	if (counts.scannedFiles !== sourceFileCount) {
		return invalidInput("inventory scanned file count does not match source states")
	}
	if (counts.nativeSessions < counts.eligible || counts.scannedFiles < counts.failedFiles + counts.unsupportedFiles) {
		return invalidInput("inventory reconciliation counts are inconsistent")
	}
	if (
		complete &&
		(counts.failedFiles > 0 || counts.unresolvedTimestamps > 0 || counts.unresolvedRepositoryMatches > 0)
	) {
		return invalidInput("complete inventory contains failed or unresolved evidence")
	}
	stringValue(result.next_safe_action, "inventory.next_safe_action")
	return result as unknown as RecoveryScanResult
}

function decodeReviewRow(value: unknown, index: number): ReviewLedgerRow {
	const row = record(value, `review row ${index}`)
	const decoded = {
		session: stringValue(row.session, `review row ${index}.session`),
		classification: literal(
			row.classification,
			["project_candidate", "completed_standalone", "supporting_or_duplicate", "test_noise_or_unclear"],
			`review row ${index}.classification`,
		),
		work_group_id: nullableString(row.work_group_id, `review row ${index}.work_group_id`),
		canonical_owner_or_proposal: nullableString(
			row.canonical_owner_or_proposal,
			`review row ${index}.canonical_owner_or_proposal`,
		),
		confidence: literal(row.confidence, ["high", "medium", "low"], `review row ${index}.confidence`),
		reason: stringValue(row.reason, `review row ${index}.reason`),
		source_available: booleanValue(row.source_available, `review row ${index}.source_available`),
	}
	if (!decoded.source_available) return invalidInput(`review row ${index}.source_available must be true`)
	return decoded
}

async function readInventory(path: string): Promise<RecoveryScanResult> {
	const parsed = JSON.parse(await Bun.file(path).text()) as unknown
	const record = parsed !== null && typeof parsed === "object"
		? parsed as Record<string, unknown>
		: undefined
	if (record?.status === "ok") {
		if (record.contract_id !== CONTRACT_ID || record.schema_version !== SCHEMA_VERSION) {
			return invalidInput(`Inventory envelope contract mismatch; rerun scan with ${COMMAND_NAME}`)
		}
		return decodeInventory(record.data)
	}
	return decodeInventory(parsed)
}

async function readReviewRows(path: string): Promise<ReviewLedgerRow[]> {
	const rows: ReviewLedgerRow[] = []
	for (const [index, line] of (await Bun.file(path).text()).split("\n").entries()) {
		if (!line.trim()) continue
		try {
			rows.push(decodeReviewRow(JSON.parse(line), index + 1))
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
		if (!parsed.command) throw new UsageError("Command is required")
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
		if (parsed.command === "validate") {
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
		}
		return unexpectedCommand(parsed.command)
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
