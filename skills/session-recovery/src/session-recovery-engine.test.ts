import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import type { SessionRoots } from "@side-quest/session-corpus"
import {
	extractRecoverySession,
	scanRecoverySessions,
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
				content: [{ type: "input_text", text: "Build the recovery project with ghp_abcdefghijklmnopqrstuvwxyz123456." }],
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
			expect(validateReviewLedger(inventory, rows.slice(0, 1))).toMatchObject({
				valid: false,
				vault_write_allowed: false,
			})
		} finally {
			await rm(value.root, { recursive: true, force: true })
		}
	})
})
