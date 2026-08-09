#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"

interface ArchivedThreadRow {
	id: string
	updated_at_ms: number
	thread_source: string | null
	cwd: string
	title: string
	preview: string
	pinned_value: number
}

const HELP = `session-picker archived sessions

Usage:
  archived-sessions.ts archived --json [--limit <count>] [--database <path>]

Options:
  --limit <count>    Maximum archived sessions to return. Default: 30.
  --database <path> Explicit Codex state database. Normal runs discover it.
  --json             Emit structured JSON for the skill driver.
  -h, --help         Show this help.

Read-only. Never changes Codex sessions or local state.
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

function displayText(value: string, maximumLength: number): string {
	const normalized = value.replace(/\s+/g, " ").trim()
	if (normalized.length <= maximumLength) return normalized
	return `${normalized.slice(0, maximumLength - 1)}…`
}

function argumentsAreValid(arguments_: string[]): boolean {
	if (arguments_[0] !== "archived") return false
	const seen = new Set<string>()
	for (let index = 1; index < arguments_.length; index += 1) {
		const argument = arguments_[index]
		if (!argument || seen.has(argument)) return false
		if (argument === "--json") {
			seen.add(argument)
			continue
		}
		if (argument === "--limit" || argument === "--database") {
			const value = arguments_[index + 1]
			if (!value || value.startsWith("--")) return false
			seen.add(argument)
			index += 1
			continue
		}
		return false
	}
	return seen.has("--json")
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

	const command = arguments_[0]
	const databasePath =
		valueAfter(arguments_, "--database") ?? defaultDatabasePath()
	const limit = Number(valueAfter(arguments_, "--limit") ?? "30")
	if (
		!argumentsAreValid(arguments_) ||
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > 200
	) {
		process.stdout.write(
			`${JSON.stringify({
				status: "error",
				run_id: randomUUID(),
				action: command ?? "unknown",
				side_effects: "none",
				error: {
					category: "invalid_usage",
					changed_state: "none",
					retry_safe: true,
					next_action:
						"Run archived --json with an integer --limit between 1 and 200.",
				},
			})}\n`,
		)
		process.exitCode = 2
		return
	}

	let database: Database
	try {
		if (!databasePath) throw new Error("Codex state database unavailable")
		database = new Database(databasePath, { readonly: true })
	} catch {
		process.stdout.write(
			`${JSON.stringify({
				status: "error",
				run_id: randomUUID(),
				action: "archived",
				side_effects: "none",
				error: {
					category: "source_unavailable",
					changed_state: "none",
					retry_safe: true,
					next_action:
						"Start Codex Desktop once so its local session index exists, then retry.",
				},
			})}\n`,
		)
		process.exitCode = 3
		return
	}
	let rows: ArchivedThreadRow[]
	try {
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
		rows = database
			.query<ArchivedThreadRow, [number]>(`
			SELECT
				id,
				${updatedExpression} AS updated_at_ms,
				thread_source,
				cwd,
				title,
				preview,
				${pinnedExpression} AS pinned_value
			FROM threads
			WHERE archived = 1
				AND source IN ('vscode', 'cli')
				AND preview <> ''
			ORDER BY updated_at_ms DESC, id DESC
			LIMIT ?
		`)
			.all(limit)
	} catch {
		database.close()
		process.stdout.write(
			`${JSON.stringify({
				status: "error",
				run_id: randomUUID(),
				action: "archived",
				side_effects: "none",
				error: {
					category: "source_incompatible",
					changed_state: "none",
					retry_safe: false,
					next_action:
						"Update Codex Desktop or the session-picker archived adapter, then retry.",
				},
			})}\n`,
		)
		process.exitCode = 4
		return
	}
	database.close()

	process.stdout.write(
		`${JSON.stringify({
			status: "ok",
			run_id: randomUUID(),
			action: "archived",
			side_effects: "none",
			data: {
				source_availability: "ready",
				sessions: rows.map((row) => ({
					id: row.id,
					updated_at_ms: row.updated_at_ms,
					archived: true,
					source: "codex",
					thread_source: row.thread_source,
					cwd: row.cwd,
					title: displayText(row.title, 120),
					summary: displayText(row.preview, 500),
					pinned: row.pinned_value === 1,
				})),
			},
		})}\n`,
	)
}

main(process.argv.slice(2))
