import { homedir } from "node:os"
import {
	createRepositoryMatcher,
	defaultSessionRoots as sharedDefaultSessionRoots,
	listSessionFiles,
	type RepositoryMatcher,
} from "@side-quest/session-corpus"
import {
	CONTRACT_ID,
	SCAN_DEFAULT_LIMIT,
	SCHEMA_VERSION,
} from "./command-contract.ts"
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

/**
 * Resolve default private session roots without requiring ambient shell state.
 *
 * @param home - User home used for standard runtime locations
 * @returns Claude Code, active Codex, and archived Codex roots
 * @internal
 */
export function defaultSessionRoots(home = homedir()): SessionRoots {
	const shared = sharedDefaultSessionRoots(home)
	return {
		claude: process.env.DOMAIN_RETRO_CLAUDE_ROOT ?? shared.claude,
		codexActive:
			process.env.DOMAIN_RETRO_CODEX_ROOT ?? shared.codexActive,
		codexArchived:
			process.env.DOMAIN_RETRO_CODEX_ARCHIVE_ROOT ??
			shared.codexArchived,
	}
}

function repositoryIdentity(repoPath: string): RepositoryMatcher {
	try {
		return createRepositoryMatcher(repoPath)
	} catch (error) {
		throw new SessionDiscoveryError(
			error instanceof Error ? error.message : String(error),
			"invalid_repo",
		)
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
	repo: RepositoryMatcher,
): RepositoryMatchKind | undefined {
	return repo.match(metadata)
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
	const result = await listSessionFiles(roots)
	return {
		files: result.files,
		states: result.states.map((state) => ({
			source: state.source,
			root: state.source === "claude"
				? roots.claude
				: state.location === "active"
					? roots.codexActive
					: roots.codexArchived,
			state: state.state,
			files: state.files,
		})),
	}
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
	const matches: Array<{
		metadata: SessionMetadata
		matchKind: RepositoryMatchKind
	}> = []

	for (const file of files) {
		const metadata = await readMetadata(file.path, file.source)
		if (!metadata) continue
		const matchKind = matchRepository(metadata, repo)
		if (matchKind) matches.push({ metadata, matchKind })
	}

	const candidates: SessionCandidate[] = []
	for (let index = 0; index < matches.length; index += 8) {
		const batch = matches.slice(index, index + 8)
		candidates.push(
			...await Promise.all(
				batch.map((match) =>
					scoreSession(match.metadata, match.matchKind, options.terms ?? []),
				),
			),
		)
	}
	candidates.sort((left, right) => {
		if (left.score !== right.score) return right.score - left.score
		return String(right.started_at ?? "").localeCompare(String(left.started_at ?? ""))
	})
	const limit = options.limit ?? SCAN_DEFAULT_LIMIT
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
 * @returns Private session metadata and the already-resolved repository root
 * @throws {SessionDiscoveryError} When the selector is absent or belongs elsewhere
 * @internal
 */
export async function resolveRepositorySession(options: {
	repoPath: string
	opaqueId: string
	roots?: SessionRoots
}): Promise<{ metadata: SessionMetadata; repoRoot: string }> {
	const repo = repositoryIdentity(options.repoPath)
	const roots = options.roots ?? defaultSessionRoots()
	const { files } = await sourceFiles(roots)
	for (const file of files) {
		const metadata = await readMetadata(file.path, file.source)
		if (!metadata || metadata.opaqueId !== options.opaqueId) continue
		if (matchRepository(metadata, repo)) {
			return { metadata, repoRoot: repo.root }
		}
		break
	}
	throw new SessionDiscoveryError(
		`Session is missing or does not belong to this repository: ${options.opaqueId}`,
		"session_not_found",
	)
}
