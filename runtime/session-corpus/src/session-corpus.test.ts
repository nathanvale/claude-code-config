import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import {
	createRepositoryMatcher,
	extractSessionPage,
	listSessionFiles,
	parseNormalizedMessage,
	parseSessionMetadata,
	redactSessionText,
} from "./index.ts"

describe("shared session corpus", () => {
	test("parses native identifiers and helper ancestry without exposing source paths", () => {
		const metadata = parseSessionMetadata({
			type: "session_meta",
			payload: {
				id: "codex-one",
				cwd: "/private/repo",
				parent_thread_id: "parent-one",
				thread_source: "subagent",
			},
		}, "codex", "/private/session.jsonl")

		expect(metadata).toMatchObject({
			opaqueId: "codex:codex-one",
			parentSessionId: "parent-one",
			kind: "helper",
		})
		expect(JSON.stringify({ ...metadata, path: undefined })).not.toContain("session.jsonl")
	})

	test("normalizes prose and redacts common credential shapes", () => {
		const message = parseNormalizedMessage({
			type: "response_item",
			payload: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "Use ghp_abcdefghijklmnopqrstuvwxyz123456." }],
			},
		}, "codex")
		const redacted = redactSessionText(message?.text ?? "")

		expect(redacted.text).toBe("Use [REDACTED].")
		expect(redacted.redactions).toBe(1)
	})

	test("rejects pagination that cannot make progress", async () => {
		const root = await mkdtemp(resolve(tmpdir(), "session-corpus-test-"))
		try {
			const path = resolve(root, "session.jsonl")
			await Bun.write(path, `${JSON.stringify({
				type: "response_item",
				payload: { type: "message", role: "user", content: "hello" },
			})}\n`)
			const metadata = {
				source: "codex" as const,
				opaqueId: "codex:one",
				sessionId: "one",
				path,
				kind: "primary" as const,
			}

			await expect(extractSessionPage(metadata, {
				offset: 0,
				limit: 0,
				maxMessageChars: 2000,
			})).rejects.toThrow("limit must be a positive integer")
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	test("redacts private filesystem paths from extracted evidence", async () => {
		const root = await mkdtemp(resolve(tmpdir(), "session-corpus-test-"))
		try {
			const path = resolve(root, "session.jsonl")
			await Bun.write(path, `${JSON.stringify({
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: "Read /Users/alice/private.txt, /home/bob/key and C:\\Users\\carol\\secret.txt",
				},
			})}\n`)
			const result = await extractSessionPage({
				source: "codex",
				opaqueId: "codex:one",
				sessionId: "one",
				path,
				kind: "primary",
			}, { offset: 0, limit: 1, maxMessageChars: 2000 })

			expect(result.messages[0]?.text).toBe("Read [REDACTED], [REDACTED] and [REDACTED]")
			expect(result.redactions).toBe(3)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	test("lets matching Git common-directory evidence override stale recorded remotes", async () => {
		const root = await mkdtemp(resolve(tmpdir(), "session-corpus-test-"))
		const repo = resolve(root, "repo")
		const worktree = resolve(root, "worktree")
		try {
			await mkdir(repo)
			expect(Bun.spawnSync(["git", "init", "-q", repo]).exitCode).toBe(0)
			expect(Bun.spawnSync(["git", "-C", repo, "config", "user.email", "test@example.com"]).exitCode).toBe(0)
			expect(Bun.spawnSync(["git", "-C", repo, "config", "user.name", "Test"]).exitCode).toBe(0)
			await Bun.write(resolve(repo, "README.md"), "test\n")
			expect(Bun.spawnSync(["git", "-C", repo, "add", "README.md"]).exitCode).toBe(0)
			expect(Bun.spawnSync(["git", "-C", repo, "commit", "-qm", "test"]).exitCode).toBe(0)
			expect(Bun.spawnSync(["git", "-C", repo, "worktree", "add", "-q", worktree]).exitCode).toBe(0)
			const matcher = createRepositoryMatcher(repo)

			expect(matcher.match({
				source: "codex",
				opaqueId: "codex:one",
				sessionId: "one",
				path: "/private/session.jsonl",
				cwd: worktree,
				repositoryUrl: "https://github.com/example/stale.git",
				kind: "primary",
			})).toBe("git_common_dir")
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	test("reports every configured root and preserves missing-source evidence", async () => {
		const root = await mkdtemp(resolve(tmpdir(), "session-corpus-test-"))
		try {
			const claude = resolve(root, "claude")
			const codex = resolve(root, "codex")
			const archive = resolve(root, "missing-archive")
			await Promise.all([mkdir(claude), mkdir(codex)])
			await Bun.write(resolve(claude, "one.jsonl"), "{}\n")

			const result = await listSessionFiles({ claude, codexActive: codex, codexArchived: archive })

			expect(result.files).toHaveLength(1)
			expect(result.states).toEqual([
				{ source: "claude", location: "active", state: "available", files: 1 },
				{ source: "codex", location: "active", state: "available", files: 0 },
				{ source: "codex", location: "archive", state: "missing", files: 0 },
			])
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})
})
