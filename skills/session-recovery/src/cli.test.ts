import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import {
	COMMANDS,
	CONTRACT_ID,
	EXTRACT_MAX_LIMIT,
	HELP_TEXT,
	LONG_OPTIONS,
	MAX_MESSAGE_CHARS,
	SCHEMA_VERSION,
} from "./command-contract.ts"
import { parseArgs, runCli } from "./cli.ts"

async function runValidate(inventoryValue: unknown, reviewRows: unknown[] = []): Promise<{
	exitCode: number
	payload: Record<string, unknown>
}> {
	const root = await mkdtemp(resolve(tmpdir(), "session-recovery-cli-test-"))
	try {
		const inventory = resolve(root, "inventory.json")
		const ledger = resolve(root, "review.jsonl")
		await Bun.write(inventory, JSON.stringify(inventoryValue))
		await Bun.write(ledger, reviewRows.map((row) => JSON.stringify(row)).join("\n"))
		let stdout = ""
		const exitCode = await runCli([
			"validate",
			"--inventory",
			inventory,
			"--ledger",
			ledger,
			"--json",
		], {
			stdout: (text) => { stdout += text },
			stderr: () => {},
		})
		return { exitCode, payload: JSON.parse(stdout) as Record<string, unknown> }
	} finally {
		await rm(root, { recursive: true, force: true })
	}
}

function validInventory(): Record<string, unknown> {
	return {
		action: "scan",
		side_effect: "none",
		complete: true,
		vault_write_allowed: false,
		incomplete_reasons: [],
		filters: {
			from: "2026-08-01T00:00:00.000Z",
			to: "2026-08-08T00:00:00.000Z",
			timezone: "Australia/Melbourne",
			sources: ["codex"],
			repository: null,
			sessions: [],
		},
		source_states: [
			{
				source: "codex",
				location: "active",
				state: "available",
				files: 1,
				unreadable_directories: 0,
			},
			{
				source: "codex",
				location: "archive",
				state: "available",
				files: 0,
				unreadable_directories: 0,
			},
		],
		reconciliation: {
			scanned_files: 1,
			native_sessions: 1,
			unsupported_files: 0,
			failed_files: 0,
			eligible: 1,
			ledger_rows: 1,
			excluded: 0,
			unresolved_timestamps: 0,
			unresolved_repository_matches: 0,
		},
		ledger: [{
			session: "codex:one",
			session_id: "one",
			source: "codex",
			kind: "primary",
			parent_session_id: null,
			created_at: "2026-08-02T00:00:00.000Z",
			updated_at: "2026-08-02T00:01:00.000Z",
			repository_hint: null,
			branch: null,
			message_count: 1,
			summary: "Recover work.",
			outcome_hint: "No outcome.",
			content_sha256: "a".repeat(64),
			classification: "unclassified",
			work_group_id: null,
			canonical_owner_or_proposal: null,
			confidence: null,
			reason: "awaiting evidence review",
			source_available: true,
		}],
		next_safe_action: "Review the ledger.",
		contract_id: CONTRACT_ID,
		schema_version: SCHEMA_VERSION,
	}
}

describe("session recovery CLI", () => {
	test("help and parser stay aligned", () => {
		for (const command of COMMANDS) expect(HELP_TEXT).toContain(`  ${command}`)
		const documented = [...new Set(HELP_TEXT.match(/--[a-z-]+/g) ?? [])].sort()
		expect(documented).toEqual([...LONG_OPTIONS].sort())
		const probes: Record<(typeof LONG_OPTIONS)[number], string[]> = {
			"--from": ["scan", "--from", "2026-08-01", "--to", "2026-08-08"],
			"--to": ["scan", "--from", "2026-08-01", "--to", "2026-08-08"],
			"--source": ["scan", "--from", "2026-08-01", "--to", "2026-08-08", "--source", "codex"],
			"--repo": ["scan", "--from", "2026-08-01", "--to", "2026-08-08", "--repo", "/repo"],
			"--session": ["extract", "--session", "codex:id"],
			"--offset": ["extract", "--session", "codex:id", "--offset", "0"],
			"--limit": ["extract", "--session", "codex:id", "--limit", "1"],
			"--max-message-chars": ["extract", "--session", "codex:id", "--max-message-chars", "1"],
			"--inventory": ["validate", "--inventory", "inventory.json", "--ledger", "review.jsonl"],
			"--ledger": ["validate", "--inventory", "inventory.json", "--ledger", "review.jsonl"],
			"--json": ["scan", "--from", "2026-08-01", "--to", "2026-08-08", "--json"],
			"--help": ["scan", "--help"],
		}
		for (const option of LONG_OPTIONS) expect(() => parseArgs(probes[option])).not.toThrow()
		expect(parseArgs([])).toMatchObject({ help: true })
		expect(parseArgs([
			"scan",
			"--from",
			"2026-08-01",
			"--to",
			"2026-08-08",
			"--source",
			"codex",
			"--repo",
			"/repo",
			"--session",
			"codex:id",
			"--json",
		])).toMatchObject({
			command: "scan",
			from: "2026-08-01",
			to: "2026-08-08",
			sources: ["codex"],
			sessions: ["codex:id"],
			json: true,
		})
	})

	test("rejects extract cardinality, incompatible options, and oversized budgets", () => {
		expect(() => parseArgs(["extract"])).toThrow("extract requires one --session")
		expect(() => parseArgs([
			"scan",
			"--from",
			"2026-08-01",
			"--to",
			"2026-08-08",
			"--offset",
			"0",
		])).toThrow("--offset is not valid for scan")
		expect(() => parseArgs([
			"extract",
			"--session",
			"codex:id",
			"--limit",
			String(EXTRACT_MAX_LIMIT + 1),
		])).toThrow(`--limit must not exceed ${EXTRACT_MAX_LIMIT}`)
		expect(() => parseArgs([
			"extract",
			"--session",
			"codex:id",
			"--max-message-chars",
			String(MAX_MESSAGE_CHARS + 1),
		])).toThrow(`--max-message-chars must not exceed ${MAX_MESSAGE_CHARS}`)
	})

	test("rejects missing date bounds and command-specific options", async () => {
		let stdout = ""
		const exitCode = await runCli(["scan", "--from", "2026-08-01", "--json"], {
			stdout: (text) => { stdout += text },
			stderr: () => {},
		})

		expect(exitCode).toBe(2)
		expect(JSON.parse(stdout)).toMatchObject({
			status: "error",
			contract_id: CONTRACT_ID,
			schema_version: SCHEMA_VERSION,
			error: { category: "invalid_usage", retry_safe: false },
		})
	})

	test("returns exit code 4 for a non-reconciling review ledger", async () => {
		const result = await runValidate(validInventory())

		expect(result.exitCode).toBe(4)
		expect(result.payload).toMatchObject({
			status: "error",
			error: { category: "ledger_invalid" },
		})
	})

	test("rejects malformed completeness and reconciliation claims", async () => {
		const incomplete = validInventory()
		incomplete.complete = "true"
		const wrongCount = validInventory()
		;(wrongCount.reconciliation as Record<string, unknown>).ledger_rows = 2

		for (const value of [incomplete, wrongCount]) {
			const result = await runValidate(value)
			expect(result.exitCode).toBe(3)
			expect(result.payload).toMatchObject({
				status: "error",
				error: { category: "invalid_input" },
			})
		}
	})

	test("rejects duplicate inventory session identifiers", async () => {
		const inventory = validInventory()
		const ledger = inventory.ledger as unknown[]
		ledger.push({ ...(ledger[0] as Record<string, unknown>) })
		;(inventory.reconciliation as Record<string, unknown>).eligible = 2
		;(inventory.reconciliation as Record<string, unknown>).ledger_rows = 2
		;(inventory.reconciliation as Record<string, unknown>).native_sessions = 2
		;(inventory.reconciliation as Record<string, unknown>).scanned_files = 2

		const result = await runValidate(inventory)

		expect(result.exitCode).toBe(3)
		expect(result.payload).toMatchObject({ error: { category: "invalid_input" } })
	})

	test("runtime-validates every review row field", async () => {
		const result = await runValidate(validInventory(), [{
			session: "codex:one",
			classification: "project_candidate",
			work_group_id: "recovery",
			canonical_owner_or_proposal: "projects/recovery",
			confidence: "high",
			reason: "Owns the result.",
			source_available: "true",
		}])

		expect(result.exitCode).toBe(3)
		expect(result.payload).toMatchObject({ error: { category: "invalid_input" } })
	})

	test("rejects inconsistent source, identity, digest, and completeness evidence", async () => {
		const mutations: Array<(inventory: Record<string, unknown>) => void> = [
			(inventory) => {
				;(inventory.filters as Record<string, unknown>).sources = []
			},
			(inventory) => {
				const states = inventory.source_states as Array<Record<string, unknown>>
				;(states[0] as Record<string, unknown>).unreadable_directories = 1
			},
			(inventory) => {
				const ledger = inventory.ledger as Array<Record<string, unknown>>
				;(ledger[0] as Record<string, unknown>).session_id = "other"
			},
			(inventory) => {
				const ledger = inventory.ledger as Array<Record<string, unknown>>
				;(ledger[0] as Record<string, unknown>).content_sha256 = "not-a-digest"
			},
			(inventory) => {
				const ledger = inventory.ledger as Array<Record<string, unknown>>
				;(ledger[0] as Record<string, unknown>).source_available = false
			},
			(inventory) => {
				;(inventory.reconciliation as Record<string, unknown>).failed_files = 1
			},
		]

		for (const mutate of mutations) {
			const inventory = validInventory()
			mutate(inventory)
			const result = await runValidate(inventory)
			expect(result.exitCode).toBe(3)
			expect(result.payload).toMatchObject({ error: { category: "invalid_input" } })
		}
	})

	test("accepts a fully decoded inventory and review row", async () => {
		const result = await runValidate(validInventory(), [{
			session: "codex:one",
			classification: "project_candidate",
			work_group_id: "recovery",
			canonical_owner_or_proposal: "projects/recovery",
			confidence: "high",
			reason: "Owns the result.",
			source_available: true,
		}])

		expect(result.exitCode).toBe(0)
		expect(result.payload).toMatchObject({
			status: "ok",
			contract_id: CONTRACT_ID,
			schema_version: SCHEMA_VERSION,
			data: { action: "validate", approval_ready: true },
		})
	})

	test("rejects inventories from another contract version", async () => {
		const result = await runValidate({
			action: "scan",
			ledger: [],
			contract_id: CONTRACT_ID,
			schema_version: "stale",
		})

		expect(result.exitCode).toBe(3)
		expect(result.payload).toMatchObject({
			status: "error",
			error: { category: "invalid_input" },
		})
	})
})
