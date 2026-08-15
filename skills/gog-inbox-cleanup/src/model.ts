/** Metadata fields returned by the bounded `gog gmail search` command. */
export interface GogSearchThread {
	/** Stable Gmail thread identifier. Kept out of receipts. */
	id: string;
	/** Display sender supplied by Gmail search. */
	from: string;
	/** Subject supplied by Gmail search. */
	subject: string;
	/** Search-result date representation. */
	date: string;
	/** Gmail system and user label names. */
	labels: string[];
	/** Number of messages represented by the thread row. */
	messageCount: number;
}

/** Narrow response shape accepted from `gog gmail search`. */
export interface GogSearchResponse {
	/** Bounded thread rows. */
	threads: GogSearchThread[];
	/** Opaque evidence that more results exist. Never emitted in a receipt. */
	nextPageToken?: string;
	/** Untrusted-content wrapper metadata ignored by classification. */
	externalContent?: unknown;
}

/** Categories used to explain protected exclusions and overlap. */
export type AuditCategory =
	| "ambiguous"
	| "family"
	| "finance"
	| "github"
	| "government"
	| "health"
	| "legal"
	| "marketing"
	| "receipt"
	| "security"
	| "subscription";

/** Exact private scope for one review proposal or exclusion. */
export interface AuditScope {
	/** Scope granularity supported by the prototype. */
	type: "sender" | "domain";
	/** Exact private sender or domain value. */
	value: string;
}

/** Label-only proposal returned for a lower-risk sender cohort. */
export interface AuditProposal {
	/** Prototype decision. Only label candidates have a concrete label. */
	decision: "label-candidate";
	/** Exact private cohort boundary. */
	scope: AuditScope;
	/** Threads in the proposed cohort after protected exclusions. */
	candidateCount: number;
	/** Gmail label proposed for a future separately approved phase. */
	intendedLabel: "GitHub" | "Read later";
	/** Metadata-only reason for the proposal. */
	rationale: string;
	/** Same-sender threads removed by protected-first classification. */
	protectedExclusions: number;
	/** Human approval still required before any Gmail change. */
	nextApproval: string;
}

/** Non-executable review decisions returned beside primary label-only proposals. */
export type ReviewDecision =
	| "archive-candidate"
	| "block-candidate"
	| "keep"
	| "needs-review"
	| "unsubscribe-candidate";

/** Exact private review proposal with no command continuation. */
export interface ReviewProposal {
	/** Decision class inferred from bounded metadata. */
	decision: ReviewDecision;
	/** Exact private cohort boundary. */
	scope: AuditScope;
	/** Bounded rows supporting this review decision. */
	candidateCount: number;
	/** Label that keeps review intent visible without executing a change. */
	intendedLabel: "GitHub" | "Keep" | "Needs review" | "Read later" | "Receipts" | "Spam review";
	/** Metadata-only reason for the decision. */
	rationale: string;
	/** Same-sender rows protected from lower-risk action. */
	protectedExclusions: number;
	/** Separate approval required before any Gmail action. */
	nextApproval: string;
}

/** Protected or uncertain thread preserved from lower-risk proposals. */
export interface AuditExclusion {
	/** Exact private sender scope. */
	scope: AuditScope;
	/** Categories that caused preservation or review. */
	categories: AuditCategory[];
	/** Why this thread cannot enter an automatic cohort. */
	rationale: string;
}

/** Aggregate evidence that one thread matched multiple categories. */
export interface AuditOverlap {
	/** Stable sorted category combination. */
	categories: AuditCategory[];
	/** Number of bounded rows with this combination. */
	count: number;
}

/** Sender-domain concentration inside the bounded private result. */
export interface DomainConcentration {
	/** Exact private sender domain. */
	domain: string;
	/** Distinct exact senders observed for this domain. */
	senderCount: number;
	/** Bounded thread rows observed for this domain. */
	threadCount: number;
	/** Rows eligible for a label-only proposal. */
	candidateCount: number;
	/** Rows preserved as protected or uncertain. */
	exclusionCount: number;
}

/** Value-free run evidence safe to persist outside the vault. */
export interface AuditReceipt {
	/** Correlates this result without exposing mailbox values. */
	runId: string;
	/** ISO timestamp supplied by the command boundary. */
	timestamp: string;
	/** Requested maximum result count. */
	cap: number;
	/** Rows returned by the bounded search. */
	returnedCount: number;
	/** Rows included in label-only proposals. */
	candidateCount: number;
	/** Rows protected from lower-risk classification. */
	exclusionCount: number;
	/** Distinct multi-category combinations observed. */
	overlapCount: number;
	/** Completed audit outcome. */
	outcome: "completed";
	/** Mailbox state guarantee for this prototype. */
	changedState: "none";
	/** Only safe continuation from the receipt. */
	nextSafeAction: string;
}

/** Complete private result from one bounded audit. */
export interface AuditResult {
	/** Public completion state for scripts and agents. */
	status: "completed";
	/** Exact private Gmail query used for this run. */
	query: string;
	/** Result-bound evidence and pagination uncertainty. */
	cap: {
		max: number;
		returned: number;
		reached: boolean;
		moreAvailable: boolean;
	};
	/** Exact lower-risk label-only proposals. */
	proposals: AuditProposal[];
	/** Exact non-executable decisions for later human review. */
	reviewProposals: ReviewProposal[];
	/** Protected or uncertain private rows. */
	exclusions: AuditExclusion[];
	/** Aggregate category overlap evidence. */
	overlaps: AuditOverlap[];
	/** Exact private sender-domain concentration. */
	domainConcentration: DomainConcentration[];
	/** Rows whose sender address could not be parsed safely. */
	unknownSenderCount: number;
	/** Value-free receipt. */
	receipt: AuditReceipt;
}
