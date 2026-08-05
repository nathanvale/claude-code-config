import { existsSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, isAbsolute, relative, resolve, sep } from "node:path"
import { CONTRACT_ID, SCHEMA_VERSION } from "./command-contract.ts"
import { parseNormalizedMessage, readJsonLines, readMetadata } from "./session-parser.ts"
import type {
	RepositoryMatchKind,
	ScanResult,
	SessionCandidate,
	SessionMetadata,
	SessionRoots,
	SessionSource,
} from "./session-model.ts"

const DECISION_SIGNALS = [
	/\b(?:we|i)\s+(?:have\s+)?(?:decided|chose|agreed)\b/gi,
	/\b(?:let'?s|we should|we will)\s+(?:call|name|define|use|keep)\b/gi,
	/\b(?:canonical term|use\s+[^.\n]{1,60}\s+instead of|avoid\s+[^.\n]{1,60}\s+in favor of)\b/gi,
	/\b(?:adr candidate|architectural decision|hard to reverse|real trade[- ]?off)\b/gi,
]

/** Failure with a stable category suitable for CLI repair output. */
export class SessionDiscoveryError extends Error {
	constructor(
		message: string,
		readonly category: "invalid_repo" | "session_not_found" | "runtime_failure",
	) {
		super(message)
	}
}

function git(path: string, args: string[]): string | undefined {
	const result = Bun.spawnSync(["git", "-C", path, ...args], {
		stdout: "pipe",
		stderr: "ignore",
	})
	if (result.exitCode !== 0) return undefined
	return new TextDecoder().decode(result.stdout).trim() || undefined
}

function repositorySlug(url: string | undefined): string | undefined {
	if (!url) return undefined
	const normalized = url
		.trim()
		.replace(/^git@[^:]+:/, "")
		.replace(/^ssh:\/\/git@[^/]+\//, "")
		.replace(/^https?:\/\/[^/]+\//, "")
		.replace(/\.git$/, "")
		.replace(/\/$/, "")
	const parts = normalized.split("/").filter(Boolean)
	return parts.length >= 2
		? parts.slice(-2).join("/").toLowerCase()
		: undefined
}

function pathInside(candidate: string, parent: string): boolean {
	const rel = relative(parent, candidate)
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
}

async function listJsonl(root: string): Promise<string[]> {
	if (!existsSync(root)) return []
	const results: string[] = []
	const pending = [root]
	while (pending.length > 0) {
		const current = pending.pop()
		if (!current) continue
		const entries = await readdir(current, { withFileTypes: true })
		for (const entry of entries) {
			const path = resolve(current, entry.name)
			if (entry.isDirectory()) pending.push(path)
			else if (entry.isFile() && entry.name.endsWith(".jsonl")) results.push(path)
		}
	}
	return results.sort()
}

/**
 * Resolve default private session roots without requiring ambient shell state.
 *
 * @param home - User home used for standard runtime locations
 * @returns Claude Code, active Codex, and archived Codex roots
 * @internal
 */
export function defaultSessionRoots(home = homedir()): SessionRoots {
	return {
		claude: process.env.DOMAIN_RETRO_CLAUDE_ROOT ?? resolve(home, ".claude", "projects"),
		codexActive:
			process.env.DOMAIN_RETRO_CODEX_ROOT ?? resolve(home, ".codex", "sessions"),
		codexArchived:
			process.env.DOMAIN_RETRO_CODEX_ARCHIVE_ROOT ??
			resolve(home, ".codex", "archived_sessions"),
	}
}

interface RepositoryIdentity {
	root: string
	name: string
	commonDir?: string
	remoteSlug?: string
}

function repositoryIdentity(repoPath: string): RepositoryIdentity {
	const rootText = git(repoPath, ["rev-parse", "--show-toplevel"])
	if (!rootText) {
		throw new SessionDiscoveryError(
			`Not a Git repository: ${repoPath}`,
			"invalid_repo",
		)
	}
	const root = resolve(rootText)
	const common = git(root, ["rev-parse", "--git-common-dir"])
	return {
		root,
		name: basename(root).toLowerCase(),
		commonDir: common ? resolve(root, common) : undefined,
		remoteSlug: repositorySlug(git(root, ["remote", "get-url", "origin"])),
	}
}

/**
 * Resolve the canonical root for a Git checkout or linked worktree.
 *
 * @param repoPath - Repository path supplied by the caller
 * @returns Canonical Git worktree root
 * @throws {SessionDiscoveryError} When the path is not a Git repository
 * @internal
 */
export function resolveRepositoryRoot(repoPath: string): string {
	return repositoryIdentity(repoPath).root
}

function matchRepository(
	metadata: SessionMetadata,
	repo: RepositoryIdentity,
	gitIdentityCache: Map<string, { commonDir?: string; remoteSlug?: string }>,
): RepositoryMatchKind | undefined {
	if (metadata.cwd && pathInside(resolve(metadata.cwd), repo.root)) return "path"

	const metadataSlug = repositorySlug(metadata.repositoryUrl)
	if (metadataSlug) {
		return metadataSlug === repo.remoteSlug ? "repository_url" : undefined
	}

	if (metadata.cwd) {
		const components = resolve(metadata.cwd)
			.split(sep)
			.map((part) => part.toLowerCase())
		if (components.includes(repo.name)) return "repository_name"
	}

	if (metadata.cwd && existsSync(metadata.cwd)) {
		let identity = gitIdentityCache.get(metadata.cwd)
		if (!identity) {
			const common = git(metadata.cwd, ["rev-parse", "--git-common-dir"])
			const candidateRoot = git(metadata.cwd, ["rev-parse", "--show-toplevel"])
			identity = {
				commonDir:
					common && candidateRoot ? resolve(candidateRoot, common) : undefined,
				remoteSlug: repositorySlug(
					git(metadata.cwd, ["remote", "get-url", "origin"]),
				),
			}
			gitIdentityCache.set(metadata.cwd, identity)
		}
		if (identity.commonDir && repo.commonDir) {
			if (identity.commonDir === repo.commonDir) {
				return "git_common_dir"
			}
		}
		if (
			identity.remoteSlug &&
			repo.remoteSlug &&
			identity.remoteSlug === repo.remoteSlug
		) {
			return "repository_url"
		}
	}

	return undefined
}

function countMatches(text: string, pattern: RegExp): number {
	pattern.lastIndex = 0
	let count = 0
	while (pattern.exec(text) !== null) count += 1
	return count
}

async function scoreSession(
	metadata: SessionMetadata,
	matchKind: RepositoryMatchKind,
	terms: string[],
): Promise<SessionCandidate> {
	let messageCount = 0
	let decisionSignalCount = 0
	const signalMessageIndexes: number[] = []
	const matchedTerms = new Set<string>()
	const userMatchedTerms = new Set<string>()

	for await (const line of readJsonLines(metadata.path)) {
		const message = parseNormalizedMessage(line, metadata.source)
		if (!message) continue
		const index = messageCount
		messageCount += 1
		const lower = message.text.toLowerCase()
		let explicitDecisionSignals = 0
		let relevant = false
		if (message.role === "user") {
			for (const pattern of DECISION_SIGNALS) {
				explicitDecisionSignals += countMatches(lower, pattern)
			}
			relevant = explicitDecisionSignals > 0
		}
		for (const term of terms) {
			if (lower.includes(term.toLowerCase())) {
				matchedTerms.add(term)
				if (message.role === "user") userMatchedTerms.add(term)
				relevant = true
			}
		}
		if (relevant && signalMessageIndexes.length < 16) {
			signalMessageIndexes.push(index)
		}
		decisionSignalCount += explicitDecisionSignals
	}

	const assistantOnlyTerms = matchedTerms.size - userMatchedTerms.size
	const score =
		Math.min(decisionSignalCount * 5, 50) +
		userMatchedTerms.size * 10 +
		assistantOnlyTerms * 2
	return {
		session: metadata.opaqueId,
		source: metadata.source,
		started_at: metadata.startedAt,
		branch: metadata.branch,
		match_kind: matchKind,
		score,
		message_count: messageCount,
		decision_signal_count: decisionSignalCount,
		matched_terms: [...matchedTerms].sort(),
		signal_message_indexes: signalMessageIndexes,
	}
}

async function sourceFiles(roots: SessionRoots): Promise<{
	states: ScanResult["sources"]
	files: Array<{ source: SessionSource; path: string }>
}> {
	const groups: Array<{ source: SessionSource; root: string }> = [
		{ source: "claude", root: roots.claude },
		{ source: "codex", root: roots.codexActive },
		{ source: "codex", root: roots.codexArchived },
	]
	const states: ScanResult["sources"] = []
	const files: Array<{ source: SessionSource; path: string }> = []
	for (const group of groups) {
		const found = await listJsonl(group.root)
		states.push({
			source: group.source,
			root: group.root,
			state: existsSync(group.root) ? "available" : "missing",
			files: found.length,
		})
		for (const path of found) files.push({ source: group.source, path })
	}
	return { states, files }
}

/**
 * Scan all configured histories, then rank only sessions associated with one repository.
 *
 * @param options - Repository, glossary terms, output budget, and optional test roots
 * @returns Text-free candidate metadata and source coverage evidence
 * @throws {SessionDiscoveryError} When the repository cannot be resolved
 * @internal
 */
export async function discoverRepositorySessions(options: {
	repoPath: string
	terms?: string[]
	limit?: number
	roots?: SessionRoots
}): Promise<ScanResult> {
	const repo = repositoryIdentity(options.repoPath)
	const roots = options.roots ?? defaultSessionRoots()
	const { states, files } = await sourceFiles(roots)
	const gitIdentityCache = new Map<
		string,
		{ commonDir?: string; remoteSlug?: string }
	>()
	const matches: Array<{
		metadata: SessionMetadata
		matchKind: RepositoryMatchKind
	}> = []

	for (const file of files) {
		const metadata = await readMetadata(file.path, file.source)
		if (!metadata) continue
		const matchKind = matchRepository(metadata, repo, gitIdentityCache)
		if (matchKind) matches.push({ metadata, matchKind })
	}

	const candidates: SessionCandidate[] = []
	for (const match of matches) {
		candidates.push(
			await scoreSession(match.metadata, match.matchKind, options.terms ?? []),
		)
	}
	candidates.sort((left, right) => {
		if (left.score !== right.score) return right.score - left.score
		return String(right.started_at ?? "").localeCompare(String(left.started_at ?? ""))
	})
	const limit = options.limit ?? 100
	const returned = candidates.slice(0, limit)

	return {
		action: "scan",
		repo_root: repo.root,
		side_effect: "none",
		scanned_sessions: states.reduce((count, state) => count + state.files, 0),
		repository_sessions: candidates.length,
		strong_candidates: candidates.filter((candidate) => candidate.score >= 5).length,
		returned_candidates: returned.length,
		sources: states,
		candidates: returned,
		next_safe_action:
			"Extract one strong candidate around a reported signal_message_index, then reconcile evidence through domain-modeling.",
		contract_id: CONTRACT_ID,
		schema_version: SCHEMA_VERSION,
	}
}

/**
 * Resolve one opaque selector only when it belongs to the requested repository.
 *
 * @param options - Repository, opaque session selector, and optional test roots
 * @returns Private session metadata for bounded extraction
 * @throws {SessionDiscoveryError} When the selector is absent or belongs elsewhere
 * @internal
 */
export async function resolveRepositorySession(options: {
	repoPath: string
	opaqueId: string
	roots?: SessionRoots
}): Promise<SessionMetadata> {
	const repo = repositoryIdentity(options.repoPath)
	const roots = options.roots ?? defaultSessionRoots()
	const { files } = await sourceFiles(roots)
	const gitIdentityCache = new Map<
		string,
		{ commonDir?: string; remoteSlug?: string }
	>()
	for (const file of files) {
		const metadata = await readMetadata(file.path, file.source)
		if (!metadata || metadata.opaqueId !== options.opaqueId) continue
		if (matchRepository(metadata, repo, gitIdentityCache)) return metadata
		break
	}
	throw new SessionDiscoveryError(
		`Session is missing or does not belong to this repository: ${options.opaqueId}`,
		"session_not_found",
	)
}
