import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, mkdir, rm } from "node:fs/promises"
import { devNull, tmpdir } from "node:os"
import { resolve } from "node:path"
import { discoverRepositorySessions } from "./session-discovery.ts"
import {
	extractRepositorySession,
	redactSessionText,
} from "./session-extraction.ts"
import type { SessionRoots } from "./session-model.ts"

const cleanup: string[] = []
const gitConfigKeys = [
	"GIT_CONFIG_GLOBAL",
	"GIT_CONFIG_SYSTEM",
	"GIT_CONFIG_NOSYSTEM",
] as const
const priorGitConfig = new Map<string, string | undefined>()

beforeAll(() => {
	for (const key of gitConfigKeys) priorGitConfig.set(key, process.env[key])
	Object.assign(process.env, {
		GIT_CONFIG_GLOBAL: devNull,
		GIT_CONFIG_SYSTEM: devNull,
		GIT_CONFIG_NOSYSTEM: "1",
	})
})

afterAll(() => {
	for (const key of gitConfigKeys) {
		const value = priorGitConfig.get(key)
		if (value === undefined) delete process.env[key]
		else process.env[key] = value
	}
})

afterEach(async () => {
	for (const path of cleanup.splice(0)) {
		await rm(path, { recursive: true, force: true })
	}
})

async function fixture(): Promise<{
	repo: string
	roots: SessionRoots
}> {
	const root = await mkdtemp(resolve(tmpdir(), "domain-retrospective-test-"))
	cleanup.push(root)
	const repo = resolve(root, "agent-plugin-template")
	const roots = {
		claude: resolve(root, "claude"),
		codexActive: resolve(root, "codex", "sessions"),
		codexArchived: resolve(root, "codex", "archived"),
	}
	await mkdir(repo, { recursive: true })
	await mkdir(resolve(roots.claude, "agent-plugin-template"), { recursive: true })
	await mkdir(roots.codexActive, { recursive: true })
	await mkdir(roots.codexArchived, { recursive: true })
	const init = Bun.spawnSync(["git", "init", "-q", repo])
	expect(init.exitCode).toBe(0)
	const remote = Bun.spawnSync([
		"git",
		"-C",
		repo,
		"remote",
		"add",
		"origin",
		"git@github.com:myagentdojo/agent-plugin-template.git",
	])
	expect(remote.exitCode).toBe(0)

	await Bun.write(
		resolve(roots.claude, "agent-plugin-template", "claude-session.jsonl"),
		[
			"",
			"{malformed fixture line",
			{
				type: "user",
				sessionId: "claude-one",
				cwd: repo,
				gitBranch: "main",
				timestamp: "2026-08-01T00:00:00Z",
				message: {
					role: "user",
					content:
						"We decided Plugin Payload is the canonical term. Token ghp_abcdefghijklmnopqrstuvwxyz must stay private.",
				},
			},
			{
				type: "assistant",
				timestamp: "2026-08-01T00:01:00Z",
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", name: "ignored-secret-tool" },
						{ type: "text", text: "Recorded the domain decision." },
					],
				},
			},
		]
			.map((line) => typeof line === "string" ? line : JSON.stringify(line))
			.join("\n"),
	)

	await Bun.write(
		resolve(roots.codexActive, "codex-session.jsonl"),
		[
			{
				type: "session_meta",
				timestamp: "2026-08-02T00:00:00Z",
				payload: {
					id: "codex-one",
					cwd: "/deleted/worktree/agent-plugin-template",
					timestamp: "2026-08-02T00:00:00Z",
					git: {
						branch: "codex/domain-work",
						repository_url:
							"https://github.com/myagentdojo/agent-plugin-template.git",
					},
				},
			},
			{
				type: "response_item",
				timestamp: "2026-08-02T00:01:00Z",
				payload: {
					type: "message",
					role: "user",
					content: [
						{
							type: "input_text",
							text: "Let's call Claude Code and Codex Harnesses.",
						},
					],
				},
			},
		]
			.map((line) => JSON.stringify(line))
			.join("\n"),
	)

	await Bun.write(
		resolve(roots.codexArchived, "unrelated.jsonl"),
		JSON.stringify({
			type: "session_meta",
			payload: {
				id: "codex-unrelated",
				cwd: "/tmp/other-repo",
				git: { repository_url: "https://github.com/example/other.git" },
			},
		}),
	)

	return { repo, roots }
}

describe("repository session discovery", () => {
	test("scans all sources and ranks only repository-associated sessions", async () => {
		const { repo, roots } = await fixture()
		const privateSessionPath = resolve(
			roots.claude,
			"agent-plugin-template",
			"claude-session.jsonl",
		)
		const result = await discoverRepositorySessions({
			repoPath: repo,
			roots,
			terms: ["Plugin Payload", "Harness"],
		})

		expect(result.scanned_sessions).toBe(3)
		expect(result.repository_sessions).toBe(2)
		expect(result.strong_candidates).toBe(2)
		expect(result.candidates.map((item) => item.session).sort()).toEqual([
			"claude:claude-one",
			"codex:codex-one",
		])
		expect(result.candidates.every((item) => item.signal_message_indexes.length > 0)).toBe(true)
		expect(result.candidates.flatMap((item) => item.matched_terms).sort()).toEqual([
			"Harness",
			"Plugin Payload",
		])
		expect(JSON.stringify(result)).not.toContain(privateSessionPath)
	})

	test("extracts only normalized messages and redacts credentials", async () => {
		const { repo, roots } = await fixture()
		const privateSessionPath = resolve(
			roots.claude,
			"agent-plugin-template",
			"claude-session.jsonl",
		)
		const result = await extractRepositorySession({
			repoPath: repo,
			opaqueId: "claude:claude-one",
			roots,
			limit: 10,
		})

		expect(result.total_messages).toBe(2)
		expect(result.redactions).toBe(1)
		expect(result.messages[0]?.text).toContain("[REDACTED]")
		expect(result.messages[0]?.text).not.toContain("ghp_")
		expect(result.messages[1]?.text).toBe("Recorded the domain decision.")
		expect(JSON.stringify(result)).not.toContain("ignored-secret-tool")
		expect(JSON.stringify(result)).not.toContain(privateSessionPath)
		expect(JSON.stringify(result)).not.toContain(roots.claude)
	})

	test("redacts compact JWTs and PEM private keys without removing surrounding text", () => {
		const jwt =
			"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature"
		const privateKey = [
			"-----BEGIN PRIVATE KEY-----",
			"cHJpdmF0ZSBrZXkgbWF0ZXJpYWw=",
			"-----END PRIVATE KEY-----",
		].join("\n")
		const result = redactSessionText(
			`JWT before ${jwt} after.\nKey before\n${privateKey}\nKey after.`,
		)

		expect(result.redactions).toBe(2)
		expect(result.text).toBe(
			"JWT before [REDACTED] after.\nKey before\n[REDACTED]\nKey after.",
		)
		expect(result.text).not.toContain("eyJ")
		expect(result.text).not.toContain("PRIVATE KEY")
	})

	test("skips unreadable directories while scanning remaining session files", async () => {
		const { repo, roots } = await fixture()
		const unreadable = resolve(roots.codexActive, "unreadable")
		await mkdir(unreadable)
		await Bun.write(
			resolve(unreadable, "private.jsonl"),
			JSON.stringify({
				type: "session_meta",
				payload: { id: "private", cwd: repo },
			}),
		)
		await chmod(unreadable, 0)

		try {
			const result = await discoverRepositorySessions({ repoPath: repo, roots })
			expect(result.scanned_sessions).toBe(3)
			expect(result.candidates.map((candidate) => candidate.session)).not.toContain(
				"codex:private",
			)
		} finally {
			await chmod(unreadable, 0o700)
		}
	})

	test("propagates non-permission directory errors", async () => {
		const { repo, roots } = await fixture()
		await rm(roots.codexArchived, { recursive: true })
		await Bun.write(roots.codexArchived, "not a directory")

		await expect(
			discoverRepositorySessions({ repoPath: repo, roots }),
		).rejects.toMatchObject({ code: "ENOTDIR" })
	})

	test("rejects a session from another repository", async () => {
		const { repo, roots } = await fixture()
		await expect(
			extractRepositorySession({
				repoPath: repo,
				opaqueId: "codex:codex-unrelated",
				roots,
			}),
		).rejects.toMatchObject({ category: "session_not_found" })
	})

	test("preserves remote authority across supported repository URL forms", async () => {
		const { repo, roots } = await fixture()
		const repositoryUrls = [
			["scp", "git@GITHUB.com:myagentdojo/agent-plugin-template.git"],
			["ssh", "ssh://git@github.com:22/myagentdojo/agent-plugin-template.git"],
			["http", "http://github.com/myagentdojo/agent-plugin-template"],
			["https", "https://github.com/myagentdojo/agent-plugin-template.git/"],
			["cross-host", "https://git.example.com/myagentdojo/agent-plugin-template.git"],
		] as const

		for (const [id, repositoryUrl] of repositoryUrls) {
			await Bun.write(
				resolve(roots.codexArchived, `${id}.jsonl`),
				JSON.stringify({
					type: "session_meta",
					payload: {
						id: `url-${id}`,
						cwd: `/deleted/${id}`,
						git: { repository_url: repositoryUrl },
					},
				}),
			)
		}

		const result = await discoverRepositorySessions({ repoPath: repo, roots })
		const urlSessions = result.candidates
			.map((candidate) => candidate.session)
			.filter((session) => session.startsWith("codex:url-"))
			.sort()

		expect(urlSessions).toEqual([
			"codex:url-http",
			"codex:url-https",
			"codex:url-scp",
			"codex:url-ssh",
		])
	})

	test("rejects an existing same-name repository with a different remote", async () => {
		const { repo, roots } = await fixture()
		const otherRepo = resolve(
			resolve(repo, ".."),
			"other-owner",
			"agent-plugin-template",
		)
		await mkdir(otherRepo, { recursive: true })
		const init = Bun.spawnSync(["git", "init", "-q", otherRepo])
		expect(init.exitCode).toBe(0)
		const remote = Bun.spawnSync([
			"git",
			"-C",
			otherRepo,
			"remote",
			"add",
			"origin",
			"git@github.com:other-owner/agent-plugin-template.git",
		])
		expect(remote.exitCode).toBe(0)
		await Bun.write(
			resolve(roots.claude, "agent-plugin-template", "same-name-session.jsonl"),
			JSON.stringify({
				type: "user",
				sessionId: "claude-same-name-other-remote",
				cwd: otherRepo,
				message: { role: "user", content: "We decided on a different model." },
			}),
		)

		await expect(
			extractRepositorySession({
				repoPath: repo,
				opaqueId: "claude:claude-same-name-other-remote",
				roots,
			}),
		).rejects.toMatchObject({ category: "session_not_found" })
	})

	test("rejects an existing same-name repository without a remote", async () => {
		const { repo, roots } = await fixture()
		const otherRepo = resolve(
			resolve(repo, ".."),
			"no-remote-owner",
			"agent-plugin-template",
		)
		await mkdir(otherRepo, { recursive: true })
		const init = Bun.spawnSync(["git", "init", "-q", otherRepo])
		expect(init.exitCode).toBe(0)
		await Bun.write(
			resolve(roots.claude, "agent-plugin-template", "no-remote-session.jsonl"),
			JSON.stringify({
				type: "user",
				sessionId: "claude-same-name-no-remote",
				cwd: otherRepo,
				message: { role: "user", content: "We decided on a separate model." },
			}),
		)

		await expect(
			extractRepositorySession({
				repoPath: repo,
				opaqueId: "claude:claude-same-name-no-remote",
				roots,
			}),
		).rejects.toMatchObject({ category: "session_not_found" })
	})

	test("rejects a missing working directory whose ancestor matches the repository name", async () => {
		const { repo, roots } = await fixture()
		await Bun.write(
			resolve(roots.codexArchived, "ancestor-name-session.jsonl"),
			JSON.stringify({
				type: "session_meta",
				payload: {
					id: "codex-ancestor-name",
					cwd: "/deleted/agent-plugin-template/unrelated-repository",
				},
			}),
		)

		await expect(
			extractRepositorySession({
				repoPath: repo,
				opaqueId: "codex:codex-ancestor-name",
				roots,
			}),
		).rejects.toMatchObject({ category: "session_not_found" })
	})
})
