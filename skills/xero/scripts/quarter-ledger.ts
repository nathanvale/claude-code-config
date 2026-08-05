#!/usr/bin/env bun

import { createHash, randomUUID } from "node:crypto"
import type { Stats } from "node:fs"
import {
	chmod,
	lstat,
	mkdir,
	open,
	readFile,
	unlink,
} from "node:fs/promises"
import type { FileHandle } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"

const SCHEMA_VERSION = 1
const CONTRACT_ID = "xero.quarter-ledger"

const evidenceKindsByEvent = {
	reconciled: ["xero_receipt", "manual_confirmation"],
	workpaper_exported: ["local_file"],
	draft_created: ["gmail_draft"],
	sent_to_accountant: ["gmail_sent"],
	lodged: ["accountant_email", "ato_receipt"],
	payment_due: ["ato_notice", "accountant_email"],
	paid: ["bank_receipt", "ato_account"],
	note: ["manual_note"],
} as const

type LedgerEventName = keyof typeof evidenceKindsByEvent
type EvidenceKind = (typeof evidenceKindsByEvent)[LedgerEventName][number]

interface LedgerEventInput {
	quarter: string
	periodStart: string
	periodEnd: string
	event: LedgerEventName
	occurredAt: string
	evidence: {
		kind: EvidenceKind
		ref: string
	}
	note?: string
}

interface StoredLedgerEvent extends LedgerEventInput {
	schemaVersion: number
	eventId: string
	recordedAt: string
}

interface ParsedArguments {
	command: string
	json: boolean
	ledgerPath: string
	quarter?: string
	input?: string
	help: boolean
}

interface OptionState {
	json: boolean
	ledgerPath: string
	quarter?: string
	input?: string
}

class LedgerError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly exitCode: number,
		readonly safeToRetrySameInput: boolean,
		readonly nextSafeAction: string,
	) {
		super(message)
		this.name = "LedgerError"
	}
}

function defaultLedgerPath(): string {
	const configuredDataHome = process.env.XDG_DATA_HOME
	const dataHome =
		configuredDataHome && isAbsolute(configuredDataHome)
			? configuredDataHome
			: join(homedir(), ".local", "share")
	return join(dataHome, "xero-quarter-ledger", "ledger.jsonl")
}

function helpText(): string {
	return `quarter-ledger commands

Usage:
  bun quarter-ledger.ts commands --json
  bun quarter-ledger.ts status [--quarter FY26-Q2] [--ledger ABSOLUTE_PATH] --json
  bun quarter-ledger.ts record --input ABSOLUTE_PATH|- [--ledger ABSOLUTE_PATH] --json

Commands:
  commands  Discover the current command catalog and side effects.
  status    Read redacted lifecycle status from the private ledger.
  record    Append one evidence-backed quarter event idempotently.

The default private ledger is under XDG_DATA_HOME, or ~/.local/share when
XDG_DATA_HOME is unset. Use --ledger only with an absolute path.
`
}

function helpRequested(argumentsList: string[]): boolean {
	return (
		argumentsList.length === 0 ||
		argumentsList.includes("--help") ||
		argumentsList.includes("-h")
	)
}

function requiredOptionValue(
	argumentsList: string[],
	index: number,
	argument: string,
): string {
	const value = argumentsList[index + 1]
	if (value) return value
	throw invalidUsage(`${argument} requires a value`)
}

function applyBooleanOption(argument: string, state: OptionState): boolean {
	if (argument !== "--json") return false
	state.json = true
	return true
}

function parseOptions(argumentsList: string[], state: OptionState): void {
	const valueOptions: Record<string, (value: string) => void> = {
		"--ledger": (value) => {
			state.ledgerPath = value
		},
		"--quarter": (value) => {
			state.quarter = value
		},
		"--input": (value) => {
			state.input = value
		},
	}

	for (let index = 1; index < argumentsList.length; index += 1) {
		const argument = argumentsList[index] as string
		if (applyBooleanOption(argument, state)) continue
		const setValue = valueOptions[argument]
		if (!setValue) throw invalidUsage(`Unknown argument: ${argument}`)
		setValue(requiredOptionValue(argumentsList, index, argument))
		index += 1
	}
}

function parseArguments(argumentsList: string[]): ParsedArguments {
	if (helpRequested(argumentsList)) {
		return {
			command: "help",
			json: false,
			ledgerPath: defaultLedgerPath(),
			help: true,
		}
	}

	const command = argumentsList[0] ?? ""
	const state: OptionState = {
		json: false,
		ledgerPath: defaultLedgerPath(),
	}
	parseOptions(argumentsList, state)
	assertAbsoluteLedgerPath(state.ledgerPath)

	return { command, ...state, help: false }
}

function invalidUsage(message: string): LedgerError {
	return new LedgerError("INVALID_USAGE", message, 2, false, "run_help")
}

function assertAbsoluteLedgerPath(ledgerPath: string): void {
	if (isAbsolute(ledgerPath)) return
	throw new LedgerError(
		"INVALID_LEDGER_PATH",
		"The ledger path must be absolute",
		2,
		false,
		"provide_absolute_ledger_path",
	)
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex")
}

function canonicalEvent(input: LedgerEventInput): string {
	return JSON.stringify({
		quarter: input.quarter,
		periodStart: input.periodStart,
		periodEnd: input.periodEnd,
		event: input.event,
		occurredAt: input.occurredAt,
		evidence: {
			kind: input.evidence.kind,
			ref: input.evidence.ref,
		},
		note: input.note ?? null,
	})
}

function isDate(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
	const parsed = new Date(`${value}T00:00:00.000Z`)
	return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value)
}

function inputRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw invalidInput("Input must be a JSON object")
	}
	return value as Record<string, unknown>
}

function quarterIdentifier(value: unknown): string {
	if (typeof value !== "string" || !/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(value)) {
		throw invalidInput("quarter must be a short uppercase identifier")
	}
	return value
}

function periodBoundaries(
	periodStart: unknown,
	periodEnd: unknown,
): { periodStart: string; periodEnd: string } {
	if (!isDate(periodStart) || !isDate(periodEnd)) {
		throw invalidInput("periodStart and periodEnd must use YYYY-MM-DD")
	}
	if (periodStart > periodEnd) {
		throw invalidInput("periodStart must not be after periodEnd")
	}
	return { periodStart, periodEnd }
}

function occurredAtTimestamp(value: unknown): string {
	if (typeof value !== "string" || Number.isNaN(new Date(value).valueOf())) {
		throw invalidInput("occurredAt must be an ISO timestamp")
	}
	return new Date(value).toISOString()
}

function eventName(value: unknown): LedgerEventName {
	if (typeof value !== "string" || !(value in evidenceKindsByEvent)) {
		throw invalidInput("event is not supported")
	}
	return value as LedgerEventName
}

function eventEvidence(
	value: unknown,
	event: LedgerEventName,
): LedgerEventInput["evidence"] {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw invalidInput("evidence is required")
	}

	const evidence = value as Record<string, unknown>
	return {
		kind: evidenceKind(evidence.kind, event),
		ref: evidenceReference(evidence.ref),
	}
}

function evidenceKind(value: unknown, event: LedgerEventName): EvidenceKind {
	const allowedEvidence = evidenceKindsByEvent[event] as readonly string[]
	if (typeof value !== "string" || !allowedEvidence.includes(value)) {
		throw new LedgerError(
			"INVALID_EVIDENCE",
			`Evidence kind is not valid for ${event}`,
			2,
			false,
			"provide_event_specific_evidence",
		)
	}
	return value as EvidenceKind
}

function assertEvidenceReferenceShape(value: string): void {
	if (value.length < 1 || value.length > 500) {
		throw invalidInput("evidence.ref must be a bounded single-line reference")
	}
	if (/[\r\n]/.test(value)) {
		throw invalidInput("evidence.ref must be a bounded single-line reference")
	}
}

function evidenceReference(value: unknown): string {
	if (typeof value !== "string") {
		throw invalidInput("evidence.ref must be a bounded single-line reference")
	}
	assertEvidenceReferenceShape(value)
	return value
}

function eventNote(value: unknown): string | undefined {
	if (value !== undefined && (typeof value !== "string" || value.length > 500)) {
		throw invalidInput("note must be at most 500 characters")
	}
	return value as string | undefined
}

function validateInput(value: unknown): LedgerEventInput {
	const candidate = inputRecord(value)
	const quarter = quarterIdentifier(candidate.quarter)
	const period = periodBoundaries(candidate.periodStart, candidate.periodEnd)
	const event = eventName(candidate.event)
	const occurredAt = occurredAtTimestamp(candidate.occurredAt)
	const evidence = eventEvidence(candidate.evidence, event)
	const note = eventNote(candidate.note)

	return {
		quarter,
		...period,
		event,
		occurredAt,
		evidence,
		...(note === undefined ? {} : { note }),
	}
}

function invalidInput(message: string): LedgerError {
	return new LedgerError(
		"INVALID_INPUT",
		message,
		2,
		false,
		"repair_input_and_retry",
	)
}

function assertRegularLedger(metadata: Stats): void {
	if (metadata.isSymbolicLink()) {
		throw new LedgerError(
			"SYMLINK_REFUSED",
			"Refusing a symlinked ledger file",
			5,
			false,
			"move_ledger_to_regular_private_file",
		)
	}
	if (!metadata.isFile()) {
		throw new LedgerError(
			"INVALID_LEDGER",
			"Ledger path is not a regular file",
			5,
			false,
			"provide_regular_ledger_file",
		)
	}
}

async function ledgerFileExists(ledgerPath: string): Promise<boolean> {
	try {
		assertRegularLedger(await lstat(ledgerPath))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
		throw error
	}
	return true
}

function parseStoredEvent(line: string, recordNumber: number): StoredLedgerEvent {
	try {
		const event = JSON.parse(line) as StoredLedgerEvent
		if (event.schemaVersion !== SCHEMA_VERSION || typeof event.eventId !== "string") {
			throw new Error("unsupported record")
		}
		return event
	} catch {
		throw new LedgerError(
			"INVALID_LEDGER",
			`Ledger record ${recordNumber} is invalid`,
			5,
			false,
			"repair_private_ledger",
		)
	}
}

async function readEvents(ledgerPath: string): Promise<StoredLedgerEvent[]> {
	if (!(await ledgerFileExists(ledgerPath))) return []

	const contents = await readFile(ledgerPath, "utf8")
	const events: StoredLedgerEvent[] = []
	for (const [index, line] of contents.split("\n").entries()) {
		if (!line.trim()) continue
		events.push(parseStoredEvent(line, index + 1))
	}
	return events
}

async function readInput(inputPath: string): Promise<unknown> {
	if (inputPath === "-") return JSON.parse(await Bun.stdin.text())
	if (!isAbsolute(inputPath)) {
		throw new LedgerError(
			"INVALID_INPUT_PATH",
			"The input path must be absolute or -",
			2,
			false,
			"provide_absolute_input_path",
		)
	}
	return JSON.parse(await readFile(inputPath, "utf8"))
}

function lifecycleFor(eventNames: ReadonlySet<LedgerEventName>): string {
	const priority = [
		"lodged",
		"sent_to_accountant",
		"draft_created",
		"workpaper_exported",
		"reconciled",
	] as const
	return priority.find((event) => eventNames.has(event)) ?? "registered"
}

function paymentFor(eventNames: ReadonlySet<LedgerEventName>): string {
	if (eventNames.has("paid")) return "paid"
	if (eventNames.has("payment_due")) return "due"
	return "unknown"
}

function deriveQuarterStatus(events: StoredLedgerEvent[]) {
	const sorted = [...events].sort((left, right) =>
		left.occurredAt.localeCompare(right.occurredAt),
	)
	const eventNames = new Set(sorted.map((event) => event.event))
	const first = sorted[0] as StoredLedgerEvent
	const last = sorted[sorted.length - 1] as StoredLedgerEvent

	return {
		quarter: first.quarter,
		periodStart: first.periodStart,
		periodEnd: first.periodEnd,
		lifecycle: lifecycleFor(eventNames),
		reconciled: eventNames.has("reconciled"),
		workpaperExported: eventNames.has("workpaper_exported"),
		draftCreated: eventNames.has("draft_created"),
		sentToAccountant: eventNames.has("sent_to_accountant"),
		lodged: eventNames.has("lodged"),
		payment: paymentFor(eventNames),
		lastEventAt: last.occurredAt,
		evidence: sorted.map((event) => ({
			event: event.event,
			occurredAt: event.occurredAt,
			kind: event.evidence.kind,
			refDigest: digest(event.evidence.ref),
		})),
	}
}

function eventsForQuarter(
	events: StoredLedgerEvent[],
	quarter?: string,
): StoredLedgerEvent[] {
	if (!quarter) return events
	return events.filter((event) => event.quarter === quarter)
}

function statusNextSafeAction(quarterCount: number): string {
	return quarterCount === 0
		? "record_verified_evidence"
		: "inspect_oldest_incomplete_quarter"
}

function statusData(events: StoredLedgerEvent[], quarter?: string) {
	const grouped = new Map<string, StoredLedgerEvent[]>()
	for (const event of eventsForQuarter(events, quarter)) {
		const current = grouped.get(event.quarter) ?? []
		current.push(event)
		grouped.set(event.quarter, current)
	}

	const quarters = [...grouped.values()]
		.map(deriveQuarterStatus)
		.sort((left, right) =>
			String(left.periodStart).localeCompare(String(right.periodStart)),
		)

	return {
		quarters,
		nextSafeAction: statusNextSafeAction(quarters.length),
	}
}

function commandCatalog() {
	return {
		contractId: CONTRACT_ID,
		schemaVersion: SCHEMA_VERSION,
		actions: [
			{
				id: "status",
				summary: "Read redacted quarter lifecycle status.",
				sideEffects: { local: "read", external: "none" },
				retrySafety: "same_input_safe",
			},
			{
				id: "record",
				summary: "Append one verified evidence event idempotently.",
				sideEffects: { local: "write", external: "none" },
				retrySafety: "same_input_safe",
			},
		],
	}
}

function emitData(command: string, data: unknown, json: boolean): void {
	const output = {
		status: "data",
		contractId: CONTRACT_ID,
		schemaVersion: SCHEMA_VERSION,
		runId: randomUUID(),
		command,
		data,
	}
	if (json) {
		process.stdout.write(`${JSON.stringify(output)}\n`)
		return
	}
	if (command === "commands") {
		process.stdout.write(helpText())
		return
	}
	process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
}

function emitError(error: LedgerError, json: boolean): never {
	const output = {
		status: "error",
		contractId: CONTRACT_ID,
		schemaVersion: SCHEMA_VERSION,
		runId: randomUUID(),
		error: {
			code: error.code,
			message: error.message,
			changed: false,
			safeToRetrySameInput: error.safeToRetrySameInput,
			nextSafeAction: error.nextSafeAction,
		},
	}
	if (json) process.stdout.write(`${JSON.stringify(output)}\n`)
	else process.stderr.write(`${error.message}\nNext: ${error.nextSafeAction}\n`)
	process.exit(error.exitCode)
}

async function validatedInputFromPath(inputPath: string): Promise<LedgerEventInput> {
	try {
		return validateInput(await readInput(inputPath))
	} catch (error) {
		if (error instanceof LedgerError) throw error
		throw invalidInput("Input is not valid JSON")
	}
}

async function acquireLedgerLock(lockPath: string): Promise<FileHandle> {
	try {
		return await open(lockPath, "wx", 0o600)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
		throw new LedgerError(
			"LEDGER_BUSY",
			"Another ledger writer holds the lock",
			8,
			true,
			"retry_after_current_writer_finishes",
		)
	}
}

function assertStablePeriod(
	events: StoredLedgerEvent[],
	input: LedgerEventInput,
): void {
	const drifted = events
		.filter((event) => event.quarter === input.quarter)
		.some(
			(event) =>
				event.periodStart !== input.periodStart || event.periodEnd !== input.periodEnd,
		)
	if (!drifted) return
	throw new LedgerError(
		"PERIOD_DRIFT",
		`Quarter ${input.quarter} already has different period boundaries`,
		5,
		false,
		"inspect_existing_quarter_before_recording",
	)
}

async function appendEvent(
	ledgerPath: string,
	event: StoredLedgerEvent,
): Promise<void> {
	const ledgerHandle = await open(ledgerPath, "a", 0o600)
	try {
		await ledgerHandle.writeFile(`${JSON.stringify(event)}\n`)
		await ledgerHandle.sync()
	} finally {
		await ledgerHandle.close()
	}
	await chmod(ledgerPath, 0o600)
}

async function recordEvent(
	ledgerPath: string,
	inputPath: string,
): Promise<{ duplicate: boolean; eventId: string; quarter: ReturnType<typeof deriveQuarterStatus> }> {
	const input = await validatedInputFromPath(inputPath)
	const eventId = digest(canonicalEvent(input))
	const lockPath = `${ledgerPath}.lock`
	await mkdir(dirname(ledgerPath), { recursive: true, mode: 0o700 })
	await chmod(dirname(ledgerPath), 0o700)

	const lockHandle = await acquireLedgerLock(lockPath)

	try {
		const events = await readEvents(ledgerPath)
		assertStablePeriod(events, input)
		const duplicate = events.some((event) => event.eventId === eventId)
		if (!duplicate) {
			const stored: StoredLedgerEvent = {
				...input,
				schemaVersion: SCHEMA_VERSION,
				eventId,
				recordedAt: new Date().toISOString(),
			}
			await appendEvent(ledgerPath, stored)
			events.push(stored)
		}
		return {
			duplicate,
			eventId,
			quarter: deriveQuarterStatus(
				events.filter((event) => event.quarter === input.quarter),
			),
		}
	} finally {
		await lockHandle.close()
		await unlink(lockPath).catch(() => undefined)
	}
}

function requiredRecordInput(parsed: ParsedArguments): string {
	if (parsed.input) return parsed.input
	throw invalidUsage("record requires --input")
}

async function executeCommand(parsed: ParsedArguments): Promise<void> {
	const handlers: Record<string, () => Promise<void> | void> = {
		help: () => {
			process.stdout.write(helpText())
		},
		commands: () => emitData("commands", commandCatalog(), parsed.json),
		status: async () =>
			emitData(
				"status",
				statusData(await readEvents(parsed.ledgerPath), parsed.quarter),
				parsed.json,
			),
		record: async () =>
			emitData(
				"record",
				await recordEvent(parsed.ledgerPath, requiredRecordInput(parsed)),
				parsed.json,
			),
	}
	const handler = handlers[parsed.command]
	if (!handler) throw invalidUsage(`Unknown command: ${parsed.command}`)
	await handler()
}

async function main(): Promise<void> {
	try {
		await executeCommand(parseArguments(Bun.argv.slice(2)))
	} catch (error) {
		if (error instanceof LedgerError) emitError(error, Bun.argv.includes("--json"))
		throw error
	}
}

try {
	await main()
} catch (error) {
	if (error instanceof LedgerError) emitError(error, Bun.argv.includes("--json"))
	const wrapped = new LedgerError(
		"RUNTIME_FAILURE",
		"Quarter ledger failed without changing verified state",
		1,
		false,
		"inspect_diagnostics_and_retry_after_repair",
	)
	emitError(wrapped, Bun.argv.includes("--json"))
}
