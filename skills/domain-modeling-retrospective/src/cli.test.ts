import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { COMMANDS, HELP_TEXT } from "./command-contract.ts"
import { parseArgs, runCli } from "./cli.ts"

const cleanup: string[] = []
const rootEnvironment = {
	claude: process.env.DOMAIN_RETRO_CLAUDE_ROOT,
	codex: process.env.DOMAIN_RETRO_CODEX_ROOT,
	archive: process.env.DOMAIN_RETRO_CODEX_ARCHIVE_ROOT,
}

afterEach(async () => {
	for (const path of cleanup.splice(0)) {
		await rm(path, { recursive: true, force: true })
	}
	for (const [name, value] of [
		["DOMAIN_RETRO_CLAUDE_ROOT", rootEnvironment.claude],
		["DOMAIN_RETRO_CODEX_ROOT", rootEnvironment.codex],
		["DOMAIN_RETRO_CODEX_ARCHIVE_ROOT", rootEnvironment.archive],
	] as const) {
		if (value === undefined) delete process.env[name]
		else process.env[name] = value
	}
})

async function cliFixture(): Promise<{ repo: string }> {
	const root = await mkdtemp(resolve(tmpdir(), "domain-retrospective-cli-test-"))
	cleanup.push(root)
	const repo = resolve(root, "plugin-repo")
	const claude = resolve(root, "claude")
	const codex = resolve(root, "codex")
	const archive = resolve(root, "archive")
	await Promise.all([
		mkdir(repo, { recursive: true }),
		mkdir(claude, { recursive: true }),
		mkdir(codex, { recursive: true }),
		mkdir(archive, { recursive: true }),
	])
	expect(Bun.spawnSync(["git", "init", "-q", repo]).exitCode).toBe(0)
	process.env.DOMAIN_RETRO_CLAUDE_ROOT = claude
	process.env.DOMAIN_RETRO_CODEX_ROOT = codex
	process.env.DOMAIN_RETRO_CODEX_ARCHIVE_ROOT = archive
	await Bun.write(
		resolve(codex, "session.jsonl"),
		[
			{
				type: "session_meta",
				payload: { id: "cli-session", cwd: repo },
			},
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "We decided Plugin is the domain term." }],
				},
			},
		]
			.map((line) => JSON.stringify(line))
			.join("\n"),
	)
	return { repo }
}

describe("domain retrospective CLI contract", () => {
	test("no arguments and help render the public command surface", () => {
		expect(parseArgs([])).toMatchObject({ help: true })
		for (const command of COMMANDS) expect(HELP_TEXT).toContain(`  ${command}`)
		expect(HELP_TEXT).toContain("--json")
		expect(HELP_TEXT).toContain("Exit codes:")
	})

	test("parser accepts every documented command", () => {
		expect(
			parseArgs([
				"scan",
				"--repo",
				"/repo",
				"--term",
				"Plugin Payload",
				"--term",
				"Harness",
				"--limit",
				"20",
				"--json",
			]),
		).toMatchObject({
			command: "scan",
			repo: "/repo",
			terms: ["Plugin Payload", "Harness"],
			limit: 20,
			json: true,
		})
		expect(
			parseArgs([
				"extract",
				"--repo",
				"/repo",
				"--session",
				"codex:session",
				"--offset",
				"5",
			]),
		).toMatchObject({
			command: "extract",
			session: "codex:session",
			offset: 5,
		})
	})

	test("parser rejects invalid command combinations and numeric values", () => {
		for (const args of [
			["scan"],
			["scan", "--repo", "/repo", "--limit", "0"],
			["scan", "--repo", "/repo", "--unknown", "value"],
			["extract", "--repo", "/repo"],
			["extract", "--repo", "/repo", "--session", "codex:id", "--term", "Plugin"],
		]) {
			expect(() => parseArgs(args)).toThrow()
		}
		expect(parseArgs(["scan", "--help"])).toMatchObject({ help: true })
		expect(
			parseArgs([
				"extract",
				"--repo",
				"/repo",
				"--session",
				"codex:id",
				"--max-message-chars",
				"500",
			]),
		).toMatchObject({ maxMessageChars: 500 })
	})

	test("scan and extract succeed through the public CLI runtime", async () => {
		const { repo } = await cliFixture()
		let scanOutput = ""
		const scanExit = await runCli(
			["scan", "--repo", repo, "--term", "Plugin", "--json"],
			{
				stdout: (text) => { scanOutput += text },
				stderr: () => {},
			},
		)
		const scan = JSON.parse(scanOutput)
		expect(scanExit).toBe(0)
		expect(scan).toMatchObject({
			status: "ok",
			data: { action: "scan", strong_candidates: 1 },
		})

		let extractOutput = ""
		const extractExit = await runCli(
			["extract", "--repo", repo, "--session", "codex:cli-session"],
			{
				stdout: (text) => { extractOutput += text },
				stderr: () => {},
			},
		)
		expect(extractExit).toBe(0)
		expect(extractOutput).toContain("[0] user: We decided Plugin")
	})

	test("usage failures are structured and repairable", async () => {
		let stdout = ""
		let stderr = ""
		const exitCode = await runCli(["unknown", "--json"], {
			stdout: (text) => {
				stdout += text
			},
			stderr: (text) => {
				stderr += text
			},
		})
		const result = JSON.parse(stdout)

		expect(exitCode).toBe(2)
		expect(stderr).toBe("")
		expect(result.status).toBe("error")
		expect(result.error.category).toBe("invalid_usage")
		expect(result.error.retry_safe).toBe(true)
		expect(result.error.next_action).toContain("--help")
	})

	test("runtime failures use the stable discovery category", async () => {
		let stdout = ""
		const exitCode = await runCli(["scan", "--repo", "/not-a-repository", "--json"], {
			stdout: (text) => { stdout += text },
			stderr: () => {},
		})
		const result = JSON.parse(stdout)
		expect(exitCode).toBe(3)
		expect(result.error.category).toBe("invalid_repo")
		expect(result.error.next_action).toContain("Repair")
	})

	test("direct entrypoint preserves machine-readable stdout", () => {
		const result = Bun.spawnSync([
			process.execPath,
			"run",
			resolve(import.meta.dir, "cli.ts"),
			"unknown",
			"--json",
		])
		const stdout = new TextDecoder().decode(result.stdout)
		const stderr = new TextDecoder().decode(result.stderr)

		expect(result.exitCode).toBe(2)
		expect(stderr).toBe("")
		expect(JSON.parse(stdout)).toMatchObject({
			status: "error",
			error: { category: "invalid_usage" },
		})
	})
})
