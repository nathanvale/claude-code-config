import type {
	AuditCategory,
	AuditExclusion,
	AuditOverlap,
	AuditProposal,
	AuditResult,
	DomainConcentration,
	GogSearchResponse,
	ReviewDecision,
	ReviewProposal,
} from "./model";

const CATEGORY_RANK: Record<AuditCategory, number> = {
	ambiguous: 0,
	family: 1,
	finance: 2,
	github: 3,
	government: 4,
	health: 5,
	legal: 6,
	marketing: 7,
	receipt: 8,
	security: 9,
	subscription: 10,
};

const PROTECTED_CATEGORIES = new Set<AuditCategory>([
	"ambiguous",
	"family",
	"finance",
	"government",
	"health",
	"legal",
	"receipt",
	"security",
	"subscription",
]);

const CATEGORY_MATCHERS: Array<{ category: AuditCategory; pattern: RegExp }> = [
	{ category: "github", pattern: /github/ },
	{ category: "family", pattern: /\bfamily\b|childcare|school notice|parent portal/ },
	{ category: "marketing", pattern: /category_promotions|newsletter|digest|monthly offers|marketing/ },
	{ category: "receipt", pattern: /receipt|order\b|warranty|return\b|purchase/ },
	{ category: "security", pattern: /security|account recovery|password|sign[ -]?in|login|verification code|two-factor|2fa/ },
	{ category: "finance", pattern: /invoice|billing|payment|bank|tax\b|financial/ },
	{ category: "subscription", pattern: /subscription|renewal|membership|trial expires/ },
	{ category: "health", pattern: /health|medical|clinic|doctor|pharmacy/ },
	{ category: "government", pattern: /government|gov\.au|ato\b|mygov/ },
	{ category: "legal", pattern: /legal|solicitor|court|contract notice/ },
];

/** Inputs supplied by the CLI boundary for deterministic audit evidence. */
export interface AuditOptions {
	/** Exact bounded Gmail query. */
	query: string;
	/** Requested Gmail result cap. */
	max: number;
	/** Run correlation id. */
	runId: string;
	/** ISO timestamp fixed at the command boundary. */
	now: string;
}

interface ClassifiedThread {
	sender: string;
	categories: AuditCategory[];
	protected: boolean;
	labels: string[];
}

interface CandidateGroup {
	sender: string;
	label: "GitHub" | "Read later";
	count: number;
	protectedExclusions: number;
}

interface DomainAccumulator {
	senders: Set<string>;
	threadCount: number;
	candidateCount: number;
	exclusionCount: number;
}

/**
 * Classify one bounded Gmail search response without mutating or fetching mail.
 *
 * @param response - Narrow metadata-only result from `gog gmail search`
 * @param options - Query boundary and deterministic receipt values
 * @returns Exact private proposals plus a value-free receipt
 *
 * @example
 * ```typescript
 * const result = auditThreads({ threads: [] }, {
 *   query: "newer_than:7d",
 *   max: 20,
 *   runId: "run-1",
 *   now: new Date().toISOString(),
 * })
 * ```
 */
export function auditThreads(response: GogSearchResponse, options: AuditOptions): AuditResult {
	const classified = response.threads.map(classifyThread);
	const overlaps = aggregateOverlaps(classified);
	const { exclusions, candidateGroups } = partitionThreads(classified);
	const proposals = buildProposals(candidateGroups, exclusions);
	const reviewProposals = buildReviewProposals(classified, exclusions);
	const { domainConcentration, unknownSenderCount } = aggregateDomains(classified);

	const candidateCount = proposals.reduce((total, proposal) => total + proposal.candidateCount, 0);
	return {
		status: "completed",
		query: options.query,
		cap: {
			max: options.max,
			returned: response.threads.length,
			reached: response.threads.length >= options.max,
			moreAvailable: Boolean(response.nextPageToken),
		},
		proposals,
		reviewProposals,
		exclusions,
		overlaps,
		domainConcentration,
		unknownSenderCount,
		receipt: {
			runId: options.runId,
			timestamp: options.now,
			cap: options.max,
			returnedCount: response.threads.length,
			candidateCount,
			exclusionCount: exclusions.length,
			overlapCount: overlaps.length,
			outcome: "completed",
			changedState: "none",
			nextSafeAction: "Review exact private proposals; make no Gmail change from this receipt",
		},
	};
}

function buildReviewProposals(threads: ClassifiedThread[], exclusions: AuditExclusion[]): ReviewProposal[] {
	const proposals = new Map<string, ReviewProposal>();
	for (const exclusion of exclusions) {
		const decision = reviewDecisionForExclusion(exclusion.categories);
		addReviewProposal(proposals, {
			decision,
			scope: exclusion.scope,
			candidateCount: 1,
			intendedLabel: intendedLabelForExclusion(decision, exclusion.categories),
			rationale:
				decision === "keep"
					? "Protected mail should remain preserved"
					: "Mixed or ambiguous metadata prevents a lower-risk decision",
			protectedExclusions: 1,
			nextApproval: "Separate exact review required before any future Gmail change",
		});
	}
	for (const [sender, senderThreads] of groupBySender(threads)) {
		if (senderThreads.some((thread) => thread.protected)) continue;
		const secondary = secondaryReviewProposal(sender, senderThreads);
		if (secondary) addReviewProposal(proposals, secondary);
	}
	return [...proposals.values()];
}

function reviewDecisionForExclusion(categories: AuditCategory[]): "keep" | "needs-review" {
	return categories.includes("ambiguous") || hasCandidateCategory(categories) ? "needs-review" : "keep";
}

function intendedLabelForExclusion(
	decision: "keep" | "needs-review",
	categories: AuditCategory[],
): ReviewProposal["intendedLabel"] {
	if (decision === "needs-review") return "Needs review";
	return categories.includes("receipt") ? "Receipts" : "Keep";
}

function secondaryReviewProposal(sender: string, threads: ClassifiedThread[]): ReviewProposal | undefined {
	const decision = secondaryReviewDecision(threads);
	if (!decision) return undefined;
	const candidateThreads = reviewCandidateThreads(decision, threads);
	return {
		decision,
		scope: { type: "sender", value: sender },
		candidateCount: candidateThreads.length,
		intendedLabel:
			decision === "block-candidate"
				? "Spam review"
				: candidateThreads.some((thread) => thread.categories.includes("github"))
					? "GitHub"
					: "Read later",
		rationale: reviewRationale(decision),
		protectedExclusions: 0,
		nextApproval: "Separate exact review required before any future Gmail change",
	};
}

function secondaryReviewDecision(threads: ClassifiedThread[]): Exclude<ReviewDecision, "keep" | "needs-review"> | undefined {
	if (threads.some((thread) => thread.labels.includes("SPAM"))) return "block-candidate";
	if (threads.some((thread) => thread.labels.includes("INBOX") && hasLowAttentionLabel(thread.labels))) {
		return "archive-candidate";
	}
	const marketingCount = threads.filter((thread) => thread.categories.includes("marketing")).length;
	return marketingCount >= 2 ? "unsubscribe-candidate" : undefined;
}

function reviewCandidateThreads(decision: ReviewDecision, threads: ClassifiedThread[]): ClassifiedThread[] {
	if (decision === "block-candidate") return threads.filter((thread) => thread.labels.includes("SPAM"));
	if (decision === "archive-candidate") {
		return threads.filter((thread) => thread.labels.includes("INBOX") && hasLowAttentionLabel(thread.labels));
	}
	if (decision === "unsubscribe-candidate") return threads.filter((thread) => thread.categories.includes("marketing"));
	return threads;
}

function hasLowAttentionLabel(labels: string[]): boolean {
	return labels.includes("Read later") || labels.includes("GitHub");
}

function reviewRationale(decision: ReviewDecision): string {
	if (decision === "archive-candidate") return "An existing low-attention label makes archive reviewable, not automatic";
	if (decision === "unsubscribe-candidate") return "Repeated lower-risk marketing rows warrant exact sender review";
	return "Gmail already placed this bounded row in Spam; blocking still requires review";
}

function addReviewProposal(proposals: Map<string, ReviewProposal>, proposal: ReviewProposal): void {
	const key = `${proposal.decision}|${proposal.scope.type}|${proposal.scope.value}|${proposal.intendedLabel}`;
	const existing = proposals.get(key);
	if (existing) {
		existing.candidateCount += proposal.candidateCount;
		existing.protectedExclusions += proposal.protectedExclusions;
	} else proposals.set(key, proposal);
}

function groupBySender(threads: ClassifiedThread[]): Map<string, ClassifiedThread[]> {
	const groups = new Map<string, ClassifiedThread[]>();
	for (const thread of threads) groups.set(thread.sender, [...(groups.get(thread.sender) ?? []), thread]);
	return groups;
}

function aggregateDomains(threads: ClassifiedThread[]): {
	domainConcentration: DomainConcentration[];
	unknownSenderCount: number;
} {
	const domains = new Map<string, DomainAccumulator>();
	let unknownSenderCount = 0;
	for (const thread of threads) {
		const domain = senderDomain(thread.sender);
		if (!domain) {
			unknownSenderCount += 1;
			continue;
		}
		const accumulator = domains.get(domain) ?? {
			senders: new Set<string>(),
			threadCount: 0,
			candidateCount: 0,
			exclusionCount: 0,
		};
		accumulator.senders.add(thread.sender);
		accumulator.threadCount += 1;
		if (!thread.protected && hasCandidateCategory(thread.categories)) accumulator.candidateCount += 1;
		else accumulator.exclusionCount += 1;
		domains.set(domain, accumulator);
	}
	const domainConcentration = [...domains.entries()]
		.map(([domain, accumulator]) => ({
			domain,
			senderCount: accumulator.senders.size,
			threadCount: accumulator.threadCount,
			candidateCount: accumulator.candidateCount,
			exclusionCount: accumulator.exclusionCount,
		}))
		.sort((left, right) => right.threadCount - left.threadCount || left.domain.localeCompare(right.domain));
	return { domainConcentration, unknownSenderCount };
}

function senderDomain(sender: string): string | undefined {
	if (sender === "unknown-sender") return undefined;
	return sender.split("@").at(-1);
}

function partitionThreads(threads: ClassifiedThread[]): {
	exclusions: AuditExclusion[];
	candidateGroups: Map<string, CandidateGroup>;
} {
	const exclusions: AuditExclusion[] = [];
	const candidateGroups = new Map<string, CandidateGroup>();
	for (const thread of threads) {
		if (thread.protected || !hasCandidateCategory(thread.categories)) {
			exclusions.push(toExclusion(thread));
			continue;
		}
		const existing = candidateGroups.get(thread.sender);
		if (existing) {
			existing.count += 1;
			if (thread.categories.includes("github")) existing.label = "GitHub";
		}
		else candidateGroups.set(thread.sender, toCandidateGroup(thread));
	}
	return { exclusions, candidateGroups };
}

function buildProposals(groups: Map<string, CandidateGroup>, exclusions: AuditExclusion[]): AuditProposal[] {
	for (const exclusion of exclusions) {
		const group = groups.get(exclusion.scope.value);
		if (group) group.protectedExclusions += 1;
	}
	return [...groups.values()].map((group) => ({
		decision: "label-candidate",
		scope: { type: "sender", value: group.sender },
		candidateCount: group.count,
		intendedLabel: group.label,
		rationale:
			group.label === "GitHub"
				? "GitHub notification sender with no protected indicator"
				: "Promotions or newsletter metadata with no protected indicator",
		protectedExclusions: group.protectedExclusions,
		nextApproval: "Review this exact sender cohort before any Gmail label or filter change",
	}));
}

function hasCandidateCategory(categories: AuditCategory[]): boolean {
	return categories.includes("github") || categories.includes("marketing");
}

function toExclusion(thread: ClassifiedThread): AuditExclusion {
	return {
		scope: { type: "sender", value: thread.sender },
		categories: thread.categories.length > 0 ? thread.categories : ["ambiguous"],
		rationale: thread.protected
			? "Protected category matched before lower-risk classification"
			: "No lower-risk category was proven from bounded metadata",
	};
}

function toCandidateGroup(thread: ClassifiedThread): CandidateGroup {
	return {
		sender: thread.sender,
		label: thread.categories.includes("github") ? "GitHub" : "Read later",
		count: 1,
		protectedExclusions: 0,
	};
}

function classifyThread(thread: GogSearchResponse["threads"][number]): ClassifiedThread {
	const sender = extractSender(thread.from);
	const haystack = `${thread.from}\n${thread.subject}\n${thread.labels.join(" ")}`.toLowerCase();
	const categories = new Set(
		CATEGORY_MATCHERS.filter((matcher) => matcher.pattern.test(haystack)).map((matcher) => matcher.category),
	);
	if (sender === "unknown-sender") categories.add("ambiguous");
	const sorted = [...categories].sort(categoryComparator);
	return {
		sender,
		categories: sorted,
		protected: sorted.some((category) => PROTECTED_CATEGORIES.has(category)),
		labels: thread.labels,
	};
}

function extractSender(value: string): string {
	const bracketed = value.match(/<([^<>\s]+@[^<>\s]+)>/);
	const plain = value.trim().match(/^[^\s<>]+@[^\s<>]+$/);
	return (bracketed?.[1] ?? plain?.[0] ?? "unknown-sender").toLowerCase();
}

function categoryComparator(left: AuditCategory, right: AuditCategory): number {
	return CATEGORY_RANK[left] - CATEGORY_RANK[right];
}

function aggregateOverlaps(threads: ClassifiedThread[]): AuditOverlap[] {
	const combinations = new Map<string, AuditOverlap>();
	for (const thread of threads) {
		if (thread.categories.length < 2) continue;
		const key = thread.categories.join("|");
		const existing = combinations.get(key);
		if (existing) existing.count += 1;
		else combinations.set(key, { categories: thread.categories, count: 1 });
	}
	return [...combinations.values()];
}
