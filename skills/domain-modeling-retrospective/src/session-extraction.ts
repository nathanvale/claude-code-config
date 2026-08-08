import { extractSessionPage } from "@side-quest/session-corpus"
import {
	CONTRACT_ID,
	EXTRACT_DEFAULT_LIMIT,
	SCHEMA_VERSION,
} from "./command-contract.ts"
import { resolveRepositorySession } from "./session-discovery.ts"
import type { ExtractResult, SessionRoots } from "./session-model.ts"

export { redactSessionText } from "@side-quest/session-corpus"

/**
 * Return one redacted page from a repository-owned session.
 *
 * @param options - Repository selector, pagination, text budget, and optional test roots
 * @returns Bounded message page plus continuation metadata
 * @throws {SessionDiscoveryError} When the session is missing or belongs elsewhere
 * @internal
 */
export async function extractRepositorySession(options: {
	repoPath: string
	opaqueId: string
	offset?: number
	limit?: number
	maxMessageChars?: number
	roots?: SessionRoots
}): Promise<ExtractResult> {
	const { metadata, repoRoot } = await resolveRepositorySession({
		repoPath: options.repoPath,
		opaqueId: options.opaqueId,
		roots: options.roots,
	})
	const offset = options.offset ?? 0
	const limit = options.limit ?? EXTRACT_DEFAULT_LIMIT
	const maxMessageChars = options.maxMessageChars ?? 2000
	const page = await extractSessionPage(metadata, { offset, limit, maxMessageChars })
	return {
		action: "extract",
		repo_root: repoRoot,
		side_effect: "none",
		session: metadata.opaqueId,
		source: metadata.source,
		offset,
		limit,
		total_messages: page.totalMessages,
		next_offset: page.nextOffset,
		redactions: page.redactions,
		messages: page.messages,
		next_safe_action:
			page.nextOffset === null
				? "Reconcile explicit domain evidence against the current repository."
				: `Continue with --offset ${page.nextOffset} only when more evidence is needed.`,
		contract_id: CONTRACT_ID,
		schema_version: SCHEMA_VERSION,
	}
}
