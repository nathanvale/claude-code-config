#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { randomUUID } from "node:crypto"
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, resolve } from "node:path"

interface SessionRow {
	id: string
	updated_at_ms: number
	archived_value: number
	thread_source: string | null
	cwd: string
	title: string
	preview: string
	pinned_value: number
}

interface SessionMetadata {
	id: string
	updated_at_ms: number
	archived: boolean
	source: "codex"
	thread_source: string | null
	cwd: string
	title: string
	summary: string
	pinned: boolean
}

interface SessionSnapshot {
	schema_version: 1
	generated_at: string
	sessions: SessionMetadata[]
}

const HELP = `session-picker local session index

Usage:
  archived-sessions.ts archived --json [--limit <count>] [--database <path>]
  archived-sessions.ts snapshot --json [--limit <count>] [--database <path>] [--state <path>]
  archived-sessions.ts search --query <text> --json [--limit <count>] [--state <path>]

Options:
  --query <text>    Case-insensitive snapshot search. Empty means newest rows.
  --limit <count>   Maximum results. Default: 30; maximum: 200.
  --database <path> Explicit Codex state database. Normal runs discover it.
  --state <path>    Explicit private snapshot file. Normal runs use XDG state.
  --json            Emit structured JSON for the skill driver.
  -h, --help        Show this help.

Side effects:
  archived, search  Read-only.
  snapshot          Writes sanitized metadata to a private local state file.
`

function valueAfter(arguments_: string[], flag: string): string | undefined {
	const index = arguments_.indexOf(flag)
	return index >= 0 ? arguments_[index + 1] : undefined
}

function defaultDatabasePath(): string | undefined {
	const candidates = [
		process.env.SESSION_PICKER_CODEX_STATE_DB,
		resolve(homedir(), ".codex", "state_5.sqlite"),
		resolve(homedir(), ".codex", "sqlite", "state_5.sqlite"),
	]
	return candidates.find((candidate) => candidate && existsSync(candidate))
}

function defaultStatePath(): string {
	const stateRoot =
		process.env.XDG_STATE_HOME ?? resolve(homedir(), ".local", "state")
	return resolve(stateRoot, "session-picker", "session-index.json")
}

function displayText(value: string, maximumLength: number): string {
	const normalized = value.replace(/\s+/g, " ").trim()
	if (normalized.length <= maximumLength) return normalized
	return `${normalized.slice(0, maximumLength - 1)}…`
}

function argumentsAreValid(arguments_: string[]): boolean {
	const command = arguments_[0]
	if (!command || !["archived", "snapshot", "search"].includes(command)) {
		return false
	}
	const allowedValues = new Set(["--limit", "--database", "--state", "--query"])
	const seen = new Set<string>()
	for (let index = 1; index < arguments_.length; index += 1) {
		const argument = arguments_[index]
		if (!argument || seen.has(argument)) return false
		if (argument === "--json") {
			seen.add(argument)
			continue
		}
		if (allowedValues.has(argument)) {
			const value = arguments_[index + 1]
			if (
				value === undefined ||
				value.startsWith("--") ||
				(argument !== "--query" && value.length === 0)
			) {
				return false
			}
			seen.add(argument)
			index += 1
			continue
		}
		return false
	}
	if (!seen.has("--json")) return false
	if (command === "archived" && (seen.has("--state") || seen.has("--query"))) {
		return false
	}
	if (command === "snapshot" && seen.has("--query")) return false
	if (command === "search" && (!seen.has("--query") || seen.has("--database"))) {
		return false
	}
	return true
}

function envelopeError(
	action: string,
	category: string,
	nextAction: string,
	exitCode: number,
	retrySafe: boolean,
): void {
	process.stdout.write(
		`${JSON.stringify({
			status: "error",
			run_id: randomUUID(),
			action,
			side_effects: "none",
			error: {
				category,
				changed_state: "none",
				retry_safe: retrySafe,
				next_action: nextAction,
			},
		})}\n`,
	)
	process.exitCode = exitCode
}

function openDatabase(databasePath: string | undefined): Database | undefined {
	try {
		if (!databasePath) throw new Error("Codex state database unavailable")
		return new Database(databasePath, { readonly: true })
	} catch {
		return undefined
	}
}

function readSessions(
	database: Database,
	limit: number,
	archivedOnly: boolean,
): SessionMetadata[] {
	const columns = new Set(
		database
			.query<{ name: string }, []>("PRAGMA table_info(threads)")
			.all()
			.map((column) => column.name),
	)
	const updatedExpression = columns.has("recency_at_ms")
		? "recency_at_ms"
		: columns.has("updated_at_ms")
			? "updated_at_ms"
			: "updated_at * 1000"
	const pinnedExpression = columns.has("is_pinned") ? "is_pinned" : "0"
	const archivePredicate = archivedOnly ? "AND archived = 1" : ""
	const rows = database
		.query<SessionRow, [number]>(`
		SELECT
			id,
			${updatedExpression} AS updated_at_ms,
			archived AS archived_value,
			thread_source,
			cwd,
			title,
			preview,
			${pinnedExpression} AS pinned_value
		FROM threads
		WHERE source IN ('vscode', 'cli')
			AND preview <> ''
			${archivePredicate}
		ORDER BY updated_at_ms DESC, id DESC
		LIMIT ?
	`)
		.all(limit)
	return rows.map((row) => ({
		id: row.id,
		updated_at_ms: row.updated_at_ms,
		archived: row.archived_value === 1,
		source: "codex",
		thread_source: row.thread_source,
		cwd: row.cwd,
		title: displayText(row.title, 120),
		summary: displayText(row.preview, 500),
		pinned: row.pinned_value === 1,
	}))
}

function readSnapshot(statePath: string): SessionSnapshot | undefined {
	try {
		const snapshot = JSON.parse(readFileSync(statePath, "utf8"))
		if (
			snapshot.schema_version !== 1 ||
			typeof snapshot.generated_at !== "string" ||
			!Number.isFinite(new Date(snapshot.generated_at).getTime()) ||
			!Array.isArray(snapshot.sessions)
		) {
			return undefined
		}
		return snapshot as SessionSnapshot
	} catch {
		return undefined
	}
}

function writeSnapshot(statePath: string, snapshot: SessionSnapshot): void {
	const stateDirectory = dirname(statePath)
	mkdirSync(stateDirectory, { recursive: true, mode: 0o700 })
	chmodSync(stateDirectory, 0o700)
	const temporaryPath = `${statePath}.${process.pid}.tmp`
	writeFileSync(temporaryPath, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 })
	renameSync(temporaryPath, statePath)
	chmodSync(statePath, 0o600)
}

function main(arguments_: string[]): void {
	if (
		arguments_.length === 0 ||
		arguments_.includes("--help") ||
		arguments_.includes("-h")
	) {
		process.stdout.write(HELP)
		return
	}

	const command = arguments_[0] ?? "unknown"
	const limit = Number(valueAfter(arguments_, "--limit") ?? "30")
	if (
		!argumentsAreValid(arguments_) ||
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > 200
	) {
		envelopeError(
			command,
			"invalid_usage",
			command === "archived"
				? "Run archived --json with an integer --limit between 1 and 200."
				: "Run --help, then use the documented command with --json and a limit between 1 and 200.",
			2,
			true,
		)
		return
	}

	const statePath = valueAfter(arguments_, "--state") ?? defaultStatePath()
	if (command === "search") {
		const snapshot = readSnapshot(statePath)
		if (!snapshot) {
			envelopeError(
				command,
				"snapshot_unavailable",
				"Run snapshot --json to create a private local index, then retry the search.",
				3,
				true,
			)
			return
		}
		const query = valueAfter(arguments_, "--query") ?? ""
		const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
		const sessions = snapshot.sessions
			.filter((session) => {
				const haystack = [
					session.id,
					session.title,
					session.summary,
					session.cwd,
					session.thread_source ?? "",
				]
					.join(" ")
					.toLocaleLowerCase()
				return terms.every((term) => haystack.includes(term))
			})
			.slice(0, limit)
			.map((session) => ({
				...session,
				summary: displayText(session.summary, 140),
			}))
		const snapshotAgeMs = Math.max(
			0,
			Date.now() - new Date(snapshot.generated_at).getTime(),
		)
		process.stdout.write(
			`${JSON.stringify({
				status: "ok",
				run_id: randomUUID(),
				action: command,
				side_effects: "none",
				data: {
					query,
					snapshot_generated_at: snapshot.generated_at,
					snapshot_age_ms: snapshotAgeMs,
					stale: snapshotAgeMs > 24 * 60 * 60 * 1000,
					sessions,
				},
			})}\n`,
		)
		return
	}

	const databasePath = valueAfter(arguments_, "--database") ?? defaultDatabasePath()
	const database = openDatabase(databasePath)
	if (!database) {
		envelopeError(
			command,
			"source_unavailable",
			"Start Codex Desktop once so its local session index exists, then retry.",
			3,
			true,
		)
		return
	}

	let sessions: SessionMetadata[]
	try {
		sessions = readSessions(database, limit, command === "archived")
	} catch {
		database.close()
		envelopeError(
			command,
			"source_incompatible",
			"Update Codex Desktop or the session-picker adapter, then retry.",
			4,
			false,
		)
		return
	}
	database.close()

	if (command === "snapshot") {
		const existed = existsSync(statePath)
		const snapshot: SessionSnapshot = {
			schema_version: 1,
			generated_at: new Date().toISOString(),
			sessions,
		}
		try {
			writeSnapshot(statePath, snapshot)
		} catch {
			envelopeError(
				command,
				"snapshot_write_failed",
				"Check that the private state directory is writable, then retry.",
				5,
				true,
			)
			return
		}
		process.stdout.write(
			`${JSON.stringify({
				status: "ok",
				run_id: randomUUID(),
				action: command,
				side_effects: "local_private_state",
				data: {
					changed_state: existed ? "updated" : "created",
					state_path: statePath,
					generated_at: snapshot.generated_at,
					session_count: sessions.length,
				},
			})}\n`,
		)
		return
	}

	process.stdout.write(
		`${JSON.stringify({
			status: "ok",
			run_id: randomUUID(),
			action: command,
			side_effects: "none",
			data: { source_availability: "ready", sessions },
		})}\n`,
	)
}

main(process.argv.slice(2))
