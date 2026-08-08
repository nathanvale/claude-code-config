import type {
	SessionKind,
	SessionSource,
	SourceScanState,
} from "@side-quest/session-corpus"

/** Review classification assigned after source inventory. */
export type ReviewClassification =
	| "project_candidate"
	| "completed_standalone"
	| "supporting_or_duplicate"
	| "test_noise_or_unclear"

/** Confidence attached to one evidence-backed review decision. */
export type ReviewConfidence = "high" | "medium" | "low"

/** One source-accounting row emitted before model review. */
export interface InventoryLedgerRow {
	/** Source-qualified native session identifier. */
	session: string
	/** Runtime-native identifier without the source prefix. */
	session_id: string
	/** Runtime that owns the session. */
	source: SessionSource
	/** Direct or delegated session shape. */
	kind: SessionKind
	/** Parent session identifier when runtime ancestry is available. */
	parent_session_id: string | null
	/** Earliest observed session timestamp. */
	created_at: string
	/** Latest observed session timestamp. */
	updated_at: string
	/** Repository basename only; private paths stay inside the runtime. */
	repository_hint: string | null
	/** Recorded branch when available. */
	branch: string | null
	/** Normalized user and assistant message count. */
	message_count: number
	/** Redacted bounded first meaningful user request. */
	summary: string
	/** Redacted bounded final assistant outcome hint. */
	outcome_hint: string
	/** Hash of source bytes used for repeat-scan identity. */
	content_sha256: string
	/** Initial review state; scan never invents a classification. */
	classification: "unclassified"
	/** Initial work grouping; supplied only by later review. */
	work_group_id: null
	/** Initial owner; supplied only by later review. */
	canonical_owner_or_proposal: null
	/** Initial confidence; supplied only by later review. */
	confidence: null
	/** Why classification remains open. */
	reason: "awaiting evidence review"
	/** True because the native source was opened for this row. */
	source_available: true
}

/** Explicit filters recorded with one inventory. */
export interface RecoveryFilters {
	/** Inclusive resolved window start. */
	from: string
	/** Exclusive resolved window end. */
	to: string
	/** Local timezone used when a bound was date-only. */
	timezone: string
	/** Selected runtime sources. */
	sources: SessionSource[]
	/** Path-free repository filter name. */
	repository: string | null
	/** Exact source-qualified session selectors. */
	sessions: string[]
}

/** Exact corpus-count reconciliation for one scan. */
export interface ScanReconciliation {
	/** JSONL files inspected for selected sources. */
	scanned_files: number
	/** Unique supported native session identifiers discovered. */
	native_sessions: number
	/** JSONL files that contained no supported native session header. */
	unsupported_files: number
	/** Session files that could not be read completely. */
	failed_files: number
	/** Sessions overlapping the requested window after optional filters. */
	eligible: number
	/** Rows emitted to the accounting ledger. */
	ledger_rows: number
	/** Supported sessions outside the requested window or filters. */
	excluded: number
	/** Supported sessions whose timestamps could not be resolved. */
	unresolved_timestamps: number
}

/** Read-only inventory returned by the scan command. */
export interface RecoveryScanResult {
	/** Completed command. */
	action: "scan"
	/** Explicit no-side-effect stance. */
	side_effect: "none"
	/** Whether every selected source and timestamp was available. */
	complete: boolean
	/** Always false because scan is proposal-only. */
	vault_write_allowed: false
	/** Source or filter gaps that make the report incomplete. */
	incomplete_reasons: string[]
	/** Explicit resolved filters. */
	filters: RecoveryFilters
	/** Path-free source availability evidence. */
	source_states: SourceScanState[]
	/** Exact count proof. */
	reconciliation: ScanReconciliation
	/** One row per eligible native session identifier. */
	ledger: InventoryLedgerRow[]
	/** Current safe continuation. */
	next_safe_action: string
	/** Stable result contract identifier. */
	contract_id: string
	/** Stable result schema version. */
	schema_version: string
}

/** One agent-authored classification row supplied to ledger validation. */
export interface ReviewLedgerRow {
	/** Source-qualified native session identifier from the inventory. */
	session: string
	/** Evidence-backed classification. */
	classification: ReviewClassification
	/** Shared result grouping, or null for standalone/noise work. */
	work_group_id: string | null
	/** Existing canonical owner or proposed owner path. */
	canonical_owner_or_proposal: string | null
	/** Reviewer confidence. */
	confidence: ReviewConfidence
	/** Short evidence-backed reason. */
	reason: string
	/** Whether the reviewer could open the selected native source. */
	source_available: boolean
}

/** Exact count proof for an agent-authored review ledger. */
export interface ReviewReconciliation {
	/** Inventory rows requiring review. */
	inventory_rows: number
	/** Supplied review rows. */
	review_rows: number
	/** Unique rows matching inventory identifiers. */
	matched_rows: number
}

/** Validation result that can advance to foreground proposal review. */
export interface ReviewValidationResult {
	/** Completed command. */
	action: "validate"
	/** Whether every row and required field passed. */
	valid: boolean
	/** Whether proposals may be grilled for foreground approval. */
	approval_ready: boolean
	/** Always false until the human accepts one exact proposal. */
	vault_write_allowed: false
	/** Repairable validation findings. */
	issues: string[]
	/** Exact count proof. */
	reconciliation: ReviewReconciliation
	/** Current safe continuation. */
	next_safe_action: string
	/** Stable result contract identifier. */
	contract_id: string
	/** Stable result schema version. */
	schema_version: string
}

/** One redacted historical message returned for bounded evidence review. */
export interface RecoveryMessage {
	/** Zero-based normalized message index. */
	index: number
	/** Conversation role retained by the parser. */
	role: "user" | "assistant"
	/** Original message timestamp when available. */
	timestamp?: string
	/** Redacted bounded text. */
	text: string
	/** Whether the text budget clipped the message. */
	truncated: boolean
}

/** Read-only bounded evidence page returned by extract. */
export interface RecoveryExtractResult {
	/** Completed command. */
	action: "extract"
	/** Explicit no-side-effect stance. */
	side_effect: "none"
	/** Source-qualified native session selector. */
	session: string
	/** Runtime source. */
	source: SessionSource
	/** First normalized message index requested. */
	offset: number
	/** Requested page size. */
	limit: number
	/** Total normalized messages. */
	total_messages: number
	/** Next page offset, or null at the end. */
	next_offset: number | null
	/** Redaction substitutions applied. */
	redactions: number
	/** Redacted message page. */
	messages: RecoveryMessage[]
	/** Current safe continuation. */
	next_safe_action: string
	/** Stable result contract identifier. */
	contract_id: string
	/** Stable result schema version. */
	schema_version: string
}
