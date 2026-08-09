import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { appendFile, chmod, mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import type { SessionRoots } from "@side-quest/session-corpus"
import {
	extractRecoverySession,
	scanRecoverySessions,
	SessionRecoveryError,
	validateReviewLedger,
} from "./session-recovery-engine.ts"

async function fixture(): Promise<{ root: string; repo: string; roots: SessionRoots }> {
	const root = await mkdtemp(resolve(tmpdir(), "session-recovery-test-"))
	const repo = resolve(root, "target-repo")
	const roots = {
		claude: resolve(root, "claude"),
		codexActive: resolve(root, "codex"),
		codexArchived: resolve(root, "archive"),
	}
	await Promise.all([
		mkdir(repo),
		mkdir(roots.claude),
		mkdir(roots.codexActive),
		mkdir(roots.codexArchived),
	])
	expect(Bun.spawnSync(["git", "init", "-q", repo]).exitCode).toBe(0)

	await Bun.write(resolve(roots.codexActive, "codex.jsonl"), [
		{
			timestamp: "2026-08-02T00:00:00.000Z",
			type: "session_meta",
			payload: {
				id: "codex-one",
				cwd: repo,
				timestamp: "2026-08-02T00:00:00.000Z",
				parent_thread_id: "parent-one",
				thread_source: "subagent",
			},
		},
		{
			timestamp: "2026-08-02T00:01:00.000Z",
			type: "response_item",
			payload: {
				type: "message",
				role: "user",
				content: [{
					type: "input_text",
					text: "Build the recovery project with ghp_abcdefghijklmnopqrstuvwxyz123456. <permissions_instructions>private boilerplate</permissions_instructions>",
				}],
			},
		},
		{
			timestamp: "2026-08-02T00:02:00.000Z",
			type: "response_item",
			payload: {
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "Created the proposal." }],
			},
		},
	].map((value) => JSON.stringify(value)).join("\n"))

	await Bun.write(resolve(roots.claude, "claude.jsonl"), [
		{
			type: "user",
			sessionId: "claude-one",
			cwd: repo,
			timestamp: "2026-08-03T00:00:00.000Z",
			message: { role: "user", content: "Review unfinished ideas." },
		},
		{
			type: "assistant",
			sessionId: "claude-one",
			cwd: repo,
			timestamp: "2026-08-03T00:05:00.000Z",
			message: { role: "assistant", content: "Found one candidate." },
		},
	].map((value) => JSON.stringify(value)).join("\n"))

	return { root, repo, roots }
}

describe("session recovery engine", () => {
	test("accounts for every in-range native session without emitting private paths", async () => {
		const value = await fixture()
		try {
			const result = await scanRecoverySessions({
				from: "2026-08-01T00:00:00.000Z",
				to: "2026-08-04T00:00:00.000Z",
				roots: value.roots,
			})

			expect(result.complete).toBe(true)
			expect(result.vault_write_allowed).toBe(false)
			expect(result.reconciliation).toMatchObject({ eligible: 2, ledger_rows: 2 })
			expect(result.ledger.map((row) => row.session).sort()).toEqual([
				"claude:claude-one",
				"codex:codex-one",
			])
			expect(result.ledger.find((row) => row.source === "codex")).toMatchObject({
				kind: "helper",
				parent_session_id: "parent-one",
				classification: "unclassified",
			})
			const serialized = JSON.stringify(result)
			expect(serialized).not.toContain(value.root)
			expect(serialized).not.toContain("ghp_")
			expect(serialized).not.toContain("private boilerplate")
		} finally {
			await rm(value.root, { recursive: true, force: true })
		}
	})

	test("records unreadable session files as incomplete without exposing paths", async () => {
		const value = await fixture()
		const unreadable = resolve(value.roots.codexActive, "unreadable.jsonl")
		try {
			await Bun.write(unreadable, "{}\n")
			await chmod(unreadable, 0)
			const result = await scanRecoverySessions({
				from: "2026-08-01",
				to: "2026-08-04",
				roots: value.roots,
			})

			expect(result.complete).toBe(false)
			expect(result.reconciliation.failed_files).toBe(1)
			expect(result.incomplete_reasons).toContain("1 codex session file could not be read")
			expect(JSON.stringify(result)).not.toContain(unreadable)
		} finally {
			await chmod(unreadable, 0o600).catch(() => {})
			await rm(value.root, { recursive: true, force: true })
		}
	})

	test("marks malformed selected JSONL incomplete instead of silently omitting evidence", async () => {
		const value = await fixture()
		try {
			await Bun.write(resolve(value.roots.codexActive, "malformed.jsonl"), [
				JSON.stringify({
					type: "session_meta",
					payload: { id: "codex-malformed", cwd: value.repo, timestamp: "2026-08-02T00:00:00Z" },
				}),
				"{not-json}",
			].join("\n"))

			const result = await scanRecoverySessions({
				from: "2026-08-01",
				to: "2026-08-04",
				roots: value.roots,
			})

			expect(result.complete).toBe(false)
			expect(result.reconciliation.failed_files).toBe(1)
			expect(result.ledger.map((row) => row.session)).not.toContain("codex:codex-malformed")
			expect(JSON.stringify(result)).not.toContain("malformed.jsonl")
		} finally {
			await rm(value.root, { recursive: true, force: true })
		}
	})

	test("binds parsed evidence and content hash to one streamed snapshot", async () => {
		const value = await fixture()
		try {
			const path = resolve(value.roots.codexActive, "stable.jsonl")
			const header = `${JSON.stringify({
				type: "session_meta",
				payload: { id: "codex-stable", cwd: value.repo, timestamp: "2026-08-02T00:00:00Z" },
			})}\n`
			const message = `${JSON.stringify({
				timestamp: "2026-08-02T00:01:00Z",
				type: "response_item",
				payload: { type: "message", role: "user", content: "Stable evidence." },
			})}\n`
			const appendedMessage = `${JSON.stringify({
				timestamp: "2026-08-02T00:02:00Z",
				type: "response_item",
				payload: { type: "message", role: "assistant", content: "Appended outcome." },
			})}\n`
			const before = `${header}${message.repeat(20_000)}`
			const after = `${before}${appendedMessage}`
			await Bun.write(path, before)
			const digest = (text: string) => createHash("sha256").update(text).digest("hex")
			let finishAppend: (() => void) | undefined
			const appended = new Promise<void>((resolveAppend) => { finishAppend = resolveAppend })
			setTimeout(async () => {
				await appendFile(path, appendedMessage)
				finishAppend?.()
			}, 0)

			const result = await scanRecoverySessions({
				from: "2026-08-01",
				to: "2026-08-04",
				roots: value.roots,
			})
			await appended

			const row = result.ledger.find((candidate) => candidate.session === "codex:codex-stable")
			if (!row) throw new Error("stable session row missing")
			expect([digest(before), digest(after)]).toContain(row.content_sha256)
			expect([20_000, 20_001]).toContain(row.message_count)
			expect(row.message_count === 20_001).toBe(row.content_sha256 === digest(after))
		} finally {
			await rm(value.root, { recursive: true, force: true })
		}
	})

	test("uses the earliest dated fragment for a combined session summary", async () => {
		const value = await fixture()
		try {
			await Bun.write(resolve(value.roots.codexArchived, "undated.jsonl"), [
				{
					type: "session_meta",
					payload: { id: "codex-one", cwd: value.repo },
				},
				{
					type: "response_item",
					payload: {
						type: "message",
						role: "user",
						content: "Undated prompt must not win.",
					},
				},
			].map((item) => JSON.stringify(item)).join("\n"))
			const result = await scanRecoverySessions({
				from: "2026-08-01",
				to: "2026-08-04",
				roots: value.roots,
			})

			const row = result.ledger.find((candidate) => candidate.session === "codex:codex-one")
			expect(row?.summary).toContain("Build the recovery project")
			expect(row?.summary).not.toContain("Undated prompt")
		} finally {
			await rm(value.root, { recursive: true, force: true })
		}
	})

	test("coalesces repository metadata across combined fragments", async () => {
		const value = await fixture()
		try {
			await Bun.write(resolve(value.roots.codexArchived, "earlier.jsonl"), [
				{
					timestamp: "2026-08-01T00:00:00.000Z",
					type: "session_meta",
					payload: { id: "codex-one", timestamp: "2026-08-01T00:00:00.000Z" },
				},
				{
					timestamp: "2026-08-01T00:01:00.000Z",
					type: "response_item",
					payload: { type: "message", role: "user", content: "Earlier prompt." },
				},
			].map((item) => JSON.stringify(item)).join("\n"))

			const result = await scanRecoverySessions({
				from: "2026-08-01",
				to: "2026-08-04",
				roots: value.roots,
			})

			expect(result.ledger.find((row) => row.session === "codex:codex-one")).toMatchObject({
				repository_hint: "target-repo",
			})
		} finally {
			await rm(value.root, { recursive: true, force: true })
		}
	})

	test("rejects non-increasing time windows", async () => {
		const value = await fixture()
		try {
			const error = await scanRecoverySessions({
				from: "2026-08-04",
				to: "2026-08-04",
				roots: value.roots,
			}).catch((failure: unknown) => failure)

			expect(error).toBeInstanceOf(SessionRecoveryError)
			expect((error as SessionRecoveryError).category).toBe("invalid_window")
		} finally {
			await rm(value.root, { recursive: true, force: true })
		}
	})

	test("marks a selected missing source incomplete and blocks vault writes", async () => {
		const value = await fixture()
		try {
			await rm(value.roots.codexArchived, { recursive: true })
			const result = await scanRecoverySessions({
				from: "2026-08-01",
				to: "2026-08-04",
				sources: ["codex"],
				roots: value.roots,
			})

			expect(result.complete).toBe(false)
			expect(result.vault_write_allowed).toBe(false)
			expect(result.incomplete_reasons).toContain("codex archive source is missing")
		} finally {
			await rm(value.root, { recursive: true, force: true })
		}
	})

	test("supports repository, source, and exact-session filters", async () => {
		const value = await fixture()
		try {
			const result = await scanRecoverySessions({
				from: "2026-08-01",
				to: "2026-08-04",
				sources: ["codex"],
				repoPath: value.repo,
				sessions: ["codex:codex-one"],
				roots: value.roots,
			})

			expect(result.ledger.map((row) => row.session)).toEqual(["codex:codex-one"])
			expect(result.filters.repository).toBe("target-repo")
		} finally {
			await rm(value.root, { recursive: true, force: true })
		}
	})

	test("blocks completeness when removed worktree ownership is unresolved", async () => {
		const value = await fixture()
		const removedWorktree = resolve(value.root, "removed-worktree")
		try {
			await Bun.write(resolve(value.roots.claude, "removed.jsonl"), [
				{
					type: "user",
					sessionId: "claude-removed",
					cwd: removedWorktree,
					timestamp: "2026-08-02T00:00:00Z",
					message: { role: "user", content: "Recover removed worktree evidence." },
				},
			].map((item) => JSON.stringify(item)).join("\n"))

			const result = await scanRecoverySessions({
				from: "2026-08-01",
				to: "2026-08-04",
				repoPath: value.repo,
				roots: value.roots,
			})

			expect(result.complete).toBe(false)
			expect(result.reconciliation.unresolved_repository_matches).toBe(1)
			expect(result.incomplete_reasons).toContain(
				"1 selected session had unresolved repository ownership",
			)
			expect(result.ledger.map((row) => row.session)).not.toContain("claude:claude-removed")
			expect(JSON.stringify(result)).not.toContain(removedWorktree)
		} finally {
			await rm(value.root, { recursive: true, force: true })
		}
	})

	test("exact-session filtering avoids fully parsing unrelated histories", async () => {
		const value = await fixture()
		try {
			await Bun.write(resolve(value.roots.codexActive, "unrelated.jsonl"), `${JSON.stringify({
				type: "session_meta",
				payload: { id: "codex-unrelated", cwd: value.repo, timestamp: "2026-08-02T00:00:00Z" },
			})}\n${" ".repeat(300_000)}{not-json}\n`)

			const result = await scanRecoverySessions({
				from: "2026-08-01",
				to: "2026-08-04",
				sessions: ["codex:codex-one"],
				roots: value.roots,
			})

			expect(result.complete).toBe(true)
			expect(result.ledger.map((row) => row.session)).toEqual(["codex:codex-one"])
		} finally {
			await rm(value.root, { recursive: true, force: true })
		}
	})

	test("extracts a bounded redacted page by opaque session id", async () => {
		const value = await fixture()
		try {
			const result = await extractRecoverySession({
				session: "codex:codex-one",
				roots: value.roots,
				limit: 1,
			})

			expect(result.messages).toHaveLength(1)
			expect(result.messages[0]?.text).toContain("[REDACTED]")
			expect(result.next_offset).toBe(1)
		} finally {
			await rm(value.root, { recursive: true, force: true })
		}
	})

	test("extracts every active and archived fragment as one page sequence", async () => {
		const value = await fixture()
		try {
			await Bun.write(resolve(value.roots.codexArchived, "codex-archive.jsonl"), [
				{
					type: "session_meta",
					payload: { id: "codex-one", cwd: value.repo, timestamp: "2026-08-01T00:00:00Z" },
				},
				{
					type: "response_item",
					payload: { type: "message", role: "user", content: "Archived first." },
				},
			].map((item) => JSON.stringify(item)).join("\n"))

			const result = await extractRecoverySession({
				session: "codex:codex-one",
				offset: 1,
				limit: 2,
				roots: value.roots,
			})

			expect(result.total_messages).toBe(3)
			expect(result.messages.map((message) => message.index)).toEqual([1, 2])
		} finally {
			await rm(value.root, { recursive: true, force: true })
		}
	})

	test("validates exact ledger reconciliation and project ownership fields", async () => {
		const value = await fixture()
		try {
			const inventory = await scanRecoverySessions({
				from: "2026-08-01",
				to: "2026-08-04",
				roots: value.roots,
			})
			const rows = inventory.ledger.map((row, index) => ({
				session: row.session,
				classification: index === 0 ? "project_candidate" as const : "supporting_or_duplicate" as const,
				work_group_id: "recovery-project",
				canonical_owner_or_proposal: index === 0 ? "projects/recovery" : null,
				confidence: "high" as const,
				reason: index === 0 ? "Owns the bounded result." : "Supports the same result.",
				source_available: true,
			}))

			expect(validateReviewLedger(inventory, rows)).toMatchObject({
				valid: true,
				approval_ready: true,
				vault_write_allowed: false,
				reconciliation: { inventory_rows: 2, review_rows: 2, matched_rows: 2 },
			})
			const truncated = validateReviewLedger(inventory, rows.slice(0, 1))
			expect(truncated).toMatchObject({
				valid: false,
				vault_write_allowed: false,
			})
			expect(truncated.issues).toContain(`missing review row: ${rows[1]?.session}`)
			const duplicated = validateReviewLedger(inventory, [...rows, rows[0] as typeof rows[number]])
			expect(duplicated.reconciliation).toMatchObject({
				inventory_rows: 2,
				review_rows: 3,
				matched_rows: 2,
			})
		} finally {
			await rm(value.root, { recursive: true, force: true })
		}
	})

	test("lets completed standalone work anchor supporting evidence", async () => {
		const value = await fixture()
		try {
			const inventory = await scanRecoverySessions({
				from: "2026-08-01",
				to: "2026-08-04",
				roots: value.roots,
			})
			const rows = inventory.ledger.map((row, index) => ({
				session: row.session,
				classification: index === 0 ? "completed_standalone" as const : "supporting_or_duplicate" as const,
				work_group_id: "finished-result",
				canonical_owner_or_proposal: index === 0 ? "docs/solutions/finished-result.md" : null,
				confidence: "high" as const,
				reason: index === 0 ? "The result is already durable." : "Duplicates the finished result.",
				source_available: true,
			}))

			expect(validateReviewLedger(inventory, rows)).toMatchObject({
				valid: true,
				approval_ready: true,
			})
		} finally {
			await rm(value.root, { recursive: true, force: true })
		}
	})
})
