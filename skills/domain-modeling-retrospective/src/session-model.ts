/** Agent-runtime source that owns one session format. */
export type SessionSource = "claude" | "codex"

/** Filesystem roots searched for private agent-runtime histories. */
export interface SessionRoots {
	/** Claude Code project-session root. */
	claude: string
	/** Active Codex session root. */
	codexActive: string
	/** Archived Codex session root. */
	codexArchived: string
}

/** Minimal private locator and repository evidence parsed from one session. */
export interface SessionMetadata {
	/** Agent runtime that owns the source file. */
	source: SessionSource
	/** Source-qualified identifier safe for later CLI selection. */
	opaqueId: string
	/** Runtime-native session identifier. */
	sessionId: string
	/** Private local source path; never emitted by public results. */
	path: string
	/** Working directory recorded by the runtime. */
	cwd?: string
	/** Git branch recorded when the session started. */
	branch?: string
	/** Best available session start timestamp. */
	startedAt?: string
	/** Repository URL recorded by Codex when available. */
	repositoryUrl?: string
}

/** Evidence used to associate a session with the requested repository. */
export type RepositoryMatchKind =
	| "path"
	| "git_common_dir"
	| "repository_url"
	| "repository_name"

/** Ranked, text-free session candidate returned by discovery. */
export interface SessionCandidate {
	/** Source-qualified session selector. */
	session: string
	/** Agent runtime that owns the session. */
	source: SessionSource
	/** Best available start timestamp. */
	started_at?: string
	/** Recorded Git branch when available. */
	branch?: string
	/** Repository-association evidence. */
	match_kind: RepositoryMatchKind
	/** Deterministic relevance score. */
	score: number
	/** Normalized user and assistant message count. */
	message_count: number
	/** Explicit decision-language matches found in user messages. */
	decision_signal_count: number
	/** Requested domain terms found in the session. */
	matched_terms: string[]
	/** Message indexes around which extraction should begin. */
	signal_message_indexes: number[]
}

/** Availability and file count for one configured session source. */
export interface SourceScanState {
	/** Agent runtime that owns the source. */
	source: SessionSource
	/** Local source root inspected by discovery. */
	root: string
	/** Whether the source root exists. */
	state: "available" | "missing"
	/** JSONL files found under the source root. */
	files: number
}

/** Machine-readable result of a complete repository session scan. */
export interface ScanResult {
	/** Completed command. */
	action: "scan"
	/** Canonical Git repository root. */
	repo_root: string
	/** Explicit read-only stance. */
	side_effect: "none"
	/** All Claude Code and Codex session files considered. */
	scanned_sessions: number
	/** Sessions associated with the requested repository. */
	repository_sessions: number
	/** Repository sessions meeting the strong-signal threshold. */
	strong_candidates: number
	/** Candidates included after the output limit. */
	returned_candidates: number
	/** Per-source availability evidence. */
	sources: SourceScanState[]
	/** Ranked text-free candidate metadata. */
	candidates: SessionCandidate[]
	/** Current safe workflow continuation. */
	next_safe_action: string
	/** Stable result contract identifier. */
	contract_id: string
	/** Stable result schema version. */
	schema_version: string
}

/** One redacted user or assistant message returned for review. */
export interface ExtractedMessage {
	/** Zero-based normalized message index. */
	index: number
	/** Conversation role retained by the safe parser. */
	role: "user" | "assistant"
	/** Original message timestamp when available. */
	timestamp?: string
	/** Redacted and bounded message text. */
	text: string
	/** Whether the per-message character budget clipped the text. */
	truncated: boolean
}

/** Machine-readable result for one paginated session slice. */
export interface ExtractResult {
	/** Completed command. */
	action: "extract"
	/** Canonical Git repository root. */
	repo_root: string
	/** Explicit read-only stance. */
	side_effect: "none"
	/** Source-qualified session selector. */
	session: string
	/** Agent runtime that owns the session. */
	source: SessionSource
	/** First normalized message index returned. */
	offset: number
	/** Requested message-page size. */
	limit: number
	/** Total normalized messages in the session. */
	total_messages: number
	/** Offset for the next page, or null at the end. */
	next_offset: number | null
	/** Sensitive-value substitutions applied to returned text. */
	redactions: number
	/** Redacted normalized message page. */
	messages: ExtractedMessage[]
	/** Current safe workflow continuation. */
	next_safe_action: string
	/** Stable result contract identifier. */
	contract_id: string
	/** Stable result schema version. */
	schema_version: string
}

/** Internal cross-runtime message shape used by scanning and extraction. */
export interface NormalizedMessage {
	/** Conversation role retained by the safe parser. */
	role: "user" | "assistant"
	/** Original timestamp when available. */
	timestamp?: string
	/** Text content after tool and reasoning blocks are excluded. */
	text: string
}
