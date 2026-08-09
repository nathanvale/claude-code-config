/** Agent runtime that owns a native session history. */
export type SessionSource = "claude" | "codex"

/** Whether the runtime identifies a session as direct work or delegated help. */
export type SessionKind = "primary" | "helper"

/** Evidence used to associate a session with one Git repository. */
export type RepositoryMatchKind =
	| "path"
	| "git_common_dir"
	| "repository_url"
	| "repository_name"

/** Filesystem roots searched for private agent-runtime histories. */
export interface SessionRoots {
	/** Claude Code project-session root. */
	claude: string
	/** Active Codex session root. */
	codexActive: string
	/** Archived Codex session root. */
	codexArchived: string
}

/** Minimal private locator and ancestry parsed from one session. */
export interface SessionMetadata {
	/** Agent runtime that owns the source file. */
	source: SessionSource
	/** Source-qualified identifier safe for later CLI selection. */
	opaqueId: string
	/** Runtime-native session identifier. */
	sessionId: string
	/** Private local source path retained only inside runtime code. */
	path: string
	/** Working directory recorded by the runtime. */
	cwd?: string
	/** Git branch recorded when the session started. */
	branch?: string
	/** Best available session start timestamp. */
	startedAt?: string
	/** Repository URL recorded by Codex when available. */
	repositoryUrl?: string
	/** Parent runtime session when delegation ancestry is available. */
	parentSessionId?: string
	/** Direct or delegated session classification. */
	kind: SessionKind
}

/** Internal cross-runtime message shape used by scanning and extraction. */
export interface NormalizedMessage {
	/** Conversation role retained by the safe parser. */
	role: "user" | "assistant"
	/** Original message timestamp when available. */
	timestamp?: string
	/** Text content after tool and reasoning blocks are excluded. */
	text: string
}

/** One discovered private source file and its runtime owner. */
export interface SessionFile {
	/** Runtime format used to parse the file. */
	source: SessionSource
	/** Private path that callers must not emit. */
	path: string
}

/** Availability evidence for one configured source location. */
export interface SourceScanState {
	/** Runtime source selected by the caller. */
	source: SessionSource
	/** Active or archived location without a private filesystem path. */
	location: "active" | "archive"
	/** Whether the configured root exists. */
	state: "available" | "missing"
	/** JSONL files found below the root. */
	files: number
	/** Directories skipped because the process could not read them. */
	unreadable_directories: number
}
