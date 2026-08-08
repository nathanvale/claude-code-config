import { describe, expect, test } from "bun:test"
import { COMMANDS, HELP_TEXT } from "./command-contract.ts"
import { parseArgs, runCli } from "./cli.ts"

describe("session recovery CLI", () => {
	test("help and parser stay aligned", () => {
		for (const command of COMMANDS) expect(HELP_TEXT).toContain(`  ${command}`)
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
})
