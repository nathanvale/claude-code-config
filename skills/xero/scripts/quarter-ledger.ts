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
import { homedir, hostname } from "node:os"
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
	lockDigest?: string
	help: boolean
}

interface OptionState {
	json: boolean
	ledgerPath: string
	quarter?: string
	input?: string
	lockDigest?: string
	seenOptions: Set<OptionName>
}

const optionDefinitions = {
	"--json": {
		kind: "boolean",
		summary: "Emit the machine-readable response envelope.",
	},
	"--ledger": {
		kind: "value",
		valueName: "ABSOLUTE_PATH",
		summary: "Override the private ledger path.",
	},
	"--quarter": {
		kind: "value",
		valueName: "QUARTER",
		summary: "Filter status to one quarter.",
	},
	"--input": {
		kind: "value",
		valueName: "ABSOLUTE_PATH|-",
		summary: "Read one event from a file or stdin.",
	},
	"--lock-digest": {
		kind: "value",
		valueName: "SHA256",
		summary: "Require the exact digest observed by lock-status.",
	},
} as const

type OptionName = keyof typeof optionDefinitions

const commandContracts = {
	commands: {
		usage: "commands [--json]",
		summary: "Discover the current command catalog and side effects.",
		options: ["--json"],
		requiredOptions: [],
		sideEffects: { local: "none", external: "none" },
		retrySafety: "same_input_safe",
	},
	status: {
		usage:
			"status [--quarter FY26-Q2] [--ledger ABSOLUTE_PATH] [--json]",
		summary: "Read redacted quarter lifecycle status.",
		options: ["--json", "--ledger", "--quarter"],
		requiredOptions: [],
		sideEffects: { local: "read", external: "none" },
		retrySafety: "same_input_safe",
	},
	record: {
		usage:
			"record --input ABSOLUTE_PATH|- [--ledger ABSOLUTE_PATH] [--json]",
		summary: "Append one verified evidence event idempotently.",
		options: ["--json", "--ledger", "--input"],
		requiredOptions: ["--input"],
		sideEffects: { local: "write", external: "none" },
		retrySafety: "same_input_safe",
	},
	"lock-status": {
		usage: "lock-status [--ledger ABSOLUTE_PATH] [--json]",
		summary: "Inspect lock ownership without changing it.",
		options: ["--json", "--ledger"],
		requiredOptions: [],
		sideEffects: { local: "read", external: "none" },
		retrySafety: "same_input_safe",
	},
	"lock-repair": {
		usage:
			"lock-repair --lock-digest SHA256 [--ledger ABSOLUTE_PATH] [--json]",
		summary: "Remove a digest-matched lock whose same-host PID is dead.",
		options: ["--json", "--ledger", "--lock-digest"],
		requiredOptions: ["--lock-digest"],
		sideEffects: { local: "write", external: "none" },
		retrySafety: "inspect_before_retry",
	},
} as const satisfies Record<
	string,
	{
		usage: string
		summary: string
		options: readonly OptionName[]
		requiredOptions: readonly OptionName[]
		sideEffects: { local: string; external: string }
		retrySafety: string
	}
>

type CommandName = keyof typeof commandContracts
type ChangeOutcome = boolean | "unknown"

interface MutationOutcome {
	changed: ChangeOutcome
}

interface LedgerLockOwner {
	schemaVersion: number
	lockId: string
	pid: number
	hostname: string
	createdAt: string
}

type LockOwnerState = "active" | "dead" | "unverifiable"

interface LockObservation {
	state: "unlocked" | "locked"
	digest: string | null
	owner: LedgerLockOwner | null
	ownerState: LockOwnerState | "absent"
	repairable: boolean
	reason: string
	nextSafeAction: string
}

class LedgerError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly exitCode: number,
		readonly safeToRetrySameInput: boolean,
		readonly nextSafeAction: string,
		readonly changed: ChangeOutcome = false,
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
	const usage = Object.values(commandContracts)
		.map((contract) => `  bun quarter-ledger.ts ${contract.usage}`)
		.join("\n")
	const commands = Object.entries(commandContracts)
		.map(([id, contract]) => `  ${id.padEnd(12)} ${contract.summary}`)
		.join("\n")
	return `quarter-ledger commands

Usage:
${usage}

Commands:
${commands}

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

function parseOptions(argumentsList: string[], state: OptionState): void {
	for (let index = 1; index < argumentsList.length; index += 1) {
		const argument = argumentsList[index] as string
		if (!(argument in optionDefinitions)) {
			throw invalidUsage(`Unknown argument: ${argument}`)
		}
		const option = argument as OptionName
		state.seenOptions.add(option)
		if (option === "--json") {
			state.json = true
			continue
		}
		const value = requiredOptionValue(argumentsList, index, argument)
		if (option === "--ledger") state.ledgerPath = value
		if (option === "--quarter") state.quarter = value
		if (option === "--input") state.input = value
		if (option === "--lock-digest") state.lockDigest = value
		index += 1
	}
}

function validateCommandOptions(command: string, state: OptionState): void {
	if (!(command in commandContracts)) return
	const contract = commandContracts[command as CommandName]
	for (const option of state.seenOptions) {
		if (!contract.options.includes(option as never)) {
			throw invalidUsage(`${command} does not accept ${option}`)
		}
	}
	for (const option of contract.requiredOptions) {
		if (!state.seenOptions.has(option)) {
			throw invalidUsage(`${command} requires ${option}`)
		}
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
		seenOptions: new Set(),
	}
	parseOptions(argumentsList, state)
	validateCommandOptions(command, state)
	assertAbsoluteLedgerPath(state.ledgerPath)

	const { seenOptions: _seenOptions, ...parsedOptions } = state
	return { command, ...parsedOptions, help: false }
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

function isOperationallyComplete(
	quarter: ReturnType<typeof deriveQuarterStatus>,
): boolean {
	return (
		quarter.reconciled &&
		quarter.workpaperExported &&
		quarter.sentToAccountant &&
		quarter.lodged
	)
}

function statusNextSafeAction(
	quarters: ReturnType<typeof deriveQuarterStatus>[],
): string {
	if (quarters.length === 0) return "record_verified_evidence"
	if (quarters.some((quarter) => !isOperationallyComplete(quarter))) {
		return "inspect_oldest_incomplete_quarter"
	}
	return "monitor_payment_and_next_quarter"
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
		nextSafeAction: statusNextSafeAction(quarters),
	}
}

function commandCatalog() {
	return {
		contractId: CONTRACT_ID,
		schemaVersion: SCHEMA_VERSION,
		actions: (["status", "record", "lock-status", "lock-repair"] as const).map((id) => {
			const contract = commandContracts[id]
			return {
				id,
				summary: contract.summary,
				options: contract.options.map((option) => ({
					id: option,
					required: contract.requiredOptions.includes(option as never),
					...optionDefinitions[option],
				})),
				sideEffects: contract.sideEffects,
				retrySafety: contract.retrySafety,
			}
		}),
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
			changed: error.changed,
			safeToRetrySameInput: error.safeToRetrySameInput,
			nextSafeAction: error.nextSafeAction,
		},
	}
	if (json) process.stdout.write(`${JSON.stringify(output)}\n`)
	else process.stderr.write(`${error.message}\nNext: ${error.nextSafeAction}\n`)
	process.exit(error.exitCode)
}

function runtimeFailure(changed: ChangeOutcome): LedgerError {
	if (changed === "unknown") {
		return new LedgerError(
			"RUNTIME_FAILURE",
			"Quarter ledger write outcome is uncertain",
			1,
			false,
			"inspect_ledger_before_retrying",
			changed,
		)
	}
	if (changed) {
		return new LedgerError(
			"RUNTIME_FAILURE",
			"Quarter ledger failed after persisting the event",
			1,
			false,
			"inspect_recorded_event_before_retrying",
			changed,
		)
	}
	return new LedgerError(
		"RUNTIME_FAILURE",
		"Quarter ledger failed without changing verified state",
		1,
		false,
		"inspect_diagnostics_and_retry_after_repair",
	)
}

function injectTestFault(
	point: "before_chmod" | "append_started" | "append_synced",
): void {
	if (
		process.env.NODE_ENV === "test" &&
		process.env.XERO_QUARTER_LEDGER_TEST_FAULT === point
	) {
		throw new Error(`Injected ${point} fault`)
	}
}

async function validatedInputFromPath(inputPath: string): Promise<LedgerEventInput> {
	try {
		return validateInput(await readInput(inputPath))
	} catch (error) {
		if (error instanceof LedgerError) throw error
		throw invalidInput("Input is not valid JSON")
	}
}

function lockPathFor(ledgerPath: string): string {
	return `${ledgerPath}.lock`
}

function parseLockOwner(contents: string): LedgerLockOwner | null {
	try {
		const candidate = JSON.parse(contents) as Partial<LedgerLockOwner>
		if (
			candidate.schemaVersion !== SCHEMA_VERSION ||
			typeof candidate.lockId !== "string" ||
			candidate.lockId.length === 0 ||
			!Number.isSafeInteger(candidate.pid) ||
			(candidate.pid ?? 0) <= 0 ||
			typeof candidate.hostname !== "string" ||
			candidate.hostname.length === 0 ||
			typeof candidate.createdAt !== "string" ||
			Number.isNaN(new Date(candidate.createdAt).valueOf())
		) {
			return null
		}
		return candidate as LedgerLockOwner
	} catch {
		return null
	}
}

function localOwnerState(owner: LedgerLockOwner): LockOwnerState {
	if (owner.hostname !== hostname()) return "unverifiable"
	try {
		process.kill(owner.pid, 0)
		return "active"
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code === "ESRCH") return "dead"
		if (code === "EPERM") return "active"
		return "unverifiable"
	}
}

async function inspectLedgerLock(ledgerPath: string): Promise<LockObservation> {
	const lockPath = lockPathFor(ledgerPath)
	let metadata: Stats
	try {
		metadata = await lstat(lockPath)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return {
				state: "unlocked",
				digest: null,
				owner: null,
				ownerState: "absent",
				repairable: false,
				reason: "lock_absent",
				nextSafeAction: "continue_or_record_verified_evidence",
			}
		}
		throw error
	}

	if (metadata.isSymbolicLink() || !metadata.isFile()) {
		return {
			state: "locked",
			digest: null,
			owner: null,
			ownerState: "unverifiable",
			repairable: false,
			reason: "lock_not_regular_file",
			nextSafeAction: "inspect_lock_manually",
		}
	}

	let contents: string
	try {
		contents = await readFile(lockPath, "utf8")
	} catch {
		return {
			state: "locked",
			digest: null,
			owner: null,
			ownerState: "unverifiable",
			repairable: false,
			reason: "lock_unreadable",
			nextSafeAction: "inspect_lock_manually",
		}
	}

	const lockDigest = digest(contents)
	const owner = parseLockOwner(contents)
	if (!owner) {
		return {
			state: "locked",
			digest: lockDigest,
			owner: null,
			ownerState: "unverifiable",
			repairable: false,
			reason: "owner_metadata_invalid",
			nextSafeAction: "inspect_lock_manually",
		}
	}

	const ownerState = localOwnerState(owner)
	return {
		state: "locked",
		digest: lockDigest,
		owner,
		ownerState,
		repairable: ownerState === "dead",
		reason:
			ownerState === "dead"
				? "same_host_owner_pid_dead"
				: ownerState === "active"
					? "owner_pid_active"
					: "owner_host_or_pid_unverifiable",
		nextSafeAction:
			ownerState === "dead"
				? "run_lock_repair_with_observed_digest"
				: ownerState === "active"
					? "wait_for_owner_to_finish"
					: "inspect_lock_owner_manually",
	}
}

function lockRepairRefusal(observation: LockObservation): LedgerError {
	if (observation.ownerState === "active") {
		return new LedgerError(
			"LOCK_OWNER_ACTIVE",
			"Refusing to remove a lock whose owner PID is active",
			8,
			false,
			"wait_for_owner_to_finish",
		)
	}
	return new LedgerError(
		"LOCK_OWNER_UNVERIFIABLE",
		"Refusing to remove a lock whose owner cannot be verified dead on this host",
		8,
		false,
		"inspect_lock_owner_manually",
	)
}

async function repairLedgerLock(ledgerPath: string, observedDigest: string) {
	const observation = await inspectLedgerLock(ledgerPath)
	if (observation.state === "unlocked") {
		throw new LedgerError(
			"LOCK_NOT_FOUND",
			"No ledger lock exists",
			2,
			false,
			"continue_without_lock_repair",
		)
	}
	if (observation.digest !== observedDigest) {
		throw new LedgerError(
			"LOCK_IDENTITY_CHANGED",
			"Ledger lock does not match the observed digest",
			8,
			false,
			"run_lock_status_again",
		)
	}
	if (!observation.repairable) throw lockRepairRefusal(observation)

	const rechecked = await inspectLedgerLock(ledgerPath)
	if (
		rechecked.digest !== observedDigest ||
		rechecked.ownerState !== "dead" ||
		!rechecked.repairable
	) {
		throw new LedgerError(
			"LOCK_IDENTITY_CHANGED",
			"Ledger lock identity or owner state changed during repair",
			8,
			false,
			"run_lock_status_again",
		)
	}

	await unlink(lockPathFor(ledgerPath))
	return {
		changed: true,
		removedDigest: observedDigest,
		nextSafeAction: "retry_blocked_record_once",
	}
}

async function acquireLedgerLock(lockPath: string): Promise<FileHandle> {
	let lockHandle: FileHandle
	try {
		lockHandle = await open(lockPath, "wx", 0o600)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
		throw new LedgerError(
			"LEDGER_BUSY",
			"Another ledger writer holds the lock",
			8,
			false,
			"run_lock_status",
		)
	}

	const owner: LedgerLockOwner = {
		schemaVersion: SCHEMA_VERSION,
		lockId: randomUUID(),
		pid: process.pid,
		hostname: hostname(),
		createdAt: new Date().toISOString(),
	}
	try {
		await lockHandle.writeFile(`${JSON.stringify(owner)}\n`)
		await lockHandle.sync()
		return lockHandle
	} catch (error) {
		await lockHandle.close().catch(() => undefined)
		await unlink(lockPath).catch(() => undefined)
		throw error
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
	mutation: MutationOutcome,
): Promise<void> {
	const ledgerHandle = await open(ledgerPath, "a", 0o600)
	try {
		injectTestFault("before_chmod")
		await ledgerHandle.chmod(0o600)
		mutation.changed = "unknown"
		injectTestFault("append_started")
		await ledgerHandle.writeFile(`${JSON.stringify(event)}\n`)
		await ledgerHandle.sync()
		mutation.changed = true
		injectTestFault("append_synced")
	} finally {
		await ledgerHandle.close()
	}
}

async function recordEvent(
	ledgerPath: string,
	inputPath: string,
): Promise<{ duplicate: boolean; eventId: string; quarter: ReturnType<typeof deriveQuarterStatus> }> {
	const mutation: MutationOutcome = { changed: false }
	try {
		const input = await validatedInputFromPath(inputPath)
		const eventId = digest(canonicalEvent(input))
		const lockPath = lockPathFor(ledgerPath)
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
				await appendEvent(ledgerPath, stored, mutation)
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
	} catch (error) {
		if (error instanceof LedgerError && mutation.changed === false) throw error
		throw runtimeFailure(mutation.changed)
	}
}

function requiredRecordInput(parsed: ParsedArguments): string {
	if (parsed.input) return parsed.input
	throw invalidUsage("record requires --input")
}

function requiredLockDigest(parsed: ParsedArguments): string {
	if (parsed.lockDigest && /^[a-f0-9]{64}$/.test(parsed.lockDigest)) {
		return parsed.lockDigest
	}
	throw invalidUsage("lock-repair requires a lowercase SHA-256 --lock-digest")
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
		"lock-status": async () =>
			emitData(
				"lock-status",
				await inspectLedgerLock(parsed.ledgerPath),
				parsed.json,
			),
		"lock-repair": async () =>
			emitData(
				"lock-repair",
				await repairLedgerLock(
					parsed.ledgerPath,
					requiredLockDigest(parsed),
				),
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
	const wrapped = runtimeFailure(false)
	emitError(wrapped, Bun.argv.includes("--json"))
}
