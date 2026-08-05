import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { discoverRepositorySessions } from "./session-discovery.ts"
import { extractRepositorySession } from "./session-extraction.ts"
import type { SessionRoots } from "./session-model.ts"

const cleanup: string[] = []

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
	})

	test("extracts only normalized messages and redacts credentials", async () => {
		const { repo, roots } = await fixture()
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
})
