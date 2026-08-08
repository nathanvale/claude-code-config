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

async function runValidate(inventoryValue: unknown): Promise<{
	exitCode: number
	payload: Record<string, unknown>
}> {
	const root = await mkdtemp(resolve(tmpdir(), "session-recovery-cli-test-"))
	try {
		const inventory = resolve(root, "inventory.json")
		const ledger = resolve(root, "review.jsonl")
		await Bun.write(inventory, JSON.stringify(inventoryValue))
		await Bun.write(ledger, "")
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
			error: { category: "invalid_usage", retry_safe: false },
		})
	})

	test("returns exit code 4 for a non-reconciling review ledger", async () => {
		const result = await runValidate({
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
			source_states: [],
			reconciliation: {
				scanned_files: 1,
				native_sessions: 1,
				unsupported_files: 0,
				failed_files: 0,
				eligible: 1,
				ledger_rows: 1,
				excluded: 0,
				unresolved_timestamps: 0,
			},
			ledger: [{ session: "codex:one" }],
			next_safe_action: "Review the ledger.",
			contract_id: CONTRACT_ID,
			schema_version: SCHEMA_VERSION,
		})

		expect(result.exitCode).toBe(4)
		expect(result.payload).toMatchObject({
			status: "error",
			error: { category: "ledger_invalid" },
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
