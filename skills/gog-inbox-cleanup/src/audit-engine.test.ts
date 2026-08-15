import { describe, expect, test } from "bun:test";

import { auditThreads } from "./audit-engine";
import type { GogSearchResponse } from "./model";

const FIXTURE: GogSearchResponse = {
	threads: [
		{
			id: "thread-github",
			from: "GitHub <notifications@github.com>",
			subject: "[owner/repo] Review requested",
			date: "2026-08-15T02:00:00Z",
			labels: ["INBOX", "CATEGORY_UPDATES"],
			messageCount: 1,
		},
		{
			id: "thread-newsletter",
			from: "Useful Weekly <hello@weekly.example>",
			subject: "Weekly newsletter",
			date: "2026-08-14T02:00:00Z",
			labels: ["INBOX", "CATEGORY_PROMOTIONS"],
			messageCount: 1,
		},
		{
			id: "thread-receipt",
			from: "Shop <orders@shop.example>",
			subject: "Receipt for order 123",
			date: "2026-08-13T02:00:00Z",
			labels: ["INBOX", "CATEGORY_UPDATES"],
			messageCount: 1,
		},
		{
			id: "thread-security",
			from: "GitHub <notifications@github.com>",
			subject: "Security alert for your account",
			date: "2026-08-12T02:00:00Z",
			labels: ["INBOX", "CATEGORY_UPDATES"],
			messageCount: 1,
		},
		{
			id: "thread-ambiguous",
			from: "Mixed Service <mail@mixed.example>",
			subject: "Your subscription invoice and monthly offers",
			date: "2026-08-11T02:00:00Z",
			labels: ["INBOX", "CATEGORY_PROMOTIONS"],
			messageCount: 1,
		},
	],
	nextPageToken: "more-private-results",
	externalContent: { warning: "synthetic untrusted content" },
};

describe("auditThreads", () => {
	test("classifies protected mail before label candidates and reports overlap", () => {
		const result = auditThreads(FIXTURE, {
			query: "in:inbox newer_than:30d",
			max: 5,
			runId: "run-test",
			now: "2026-08-15T03:00:00.000Z",
		});

		expect(result.cap).toEqual({ max: 5, returned: 5, reached: true, moreAvailable: true });
		expect(result.proposals).toEqual([
			{
				decision: "label-candidate",
				scope: { type: "sender", value: "notifications@github.com" },
				candidateCount: 1,
				intendedLabel: "GitHub",
				rationale: "GitHub notification sender with no protected indicator",
				protectedExclusions: 1,
				nextApproval: "Review this exact sender cohort before any Gmail label or filter change",
			},
			{
				decision: "label-candidate",
				scope: { type: "sender", value: "hello@weekly.example" },
				candidateCount: 1,
				intendedLabel: "Read later",
				rationale: "Promotions or newsletter metadata with no protected indicator",
				protectedExclusions: 0,
				nextApproval: "Review this exact sender cohort before any Gmail label or filter change",
			},
		]);
		expect(result.reviewProposals).toEqual([
			{
				decision: "keep",
				scope: { type: "sender", value: "orders@shop.example" },
				candidateCount: 1,
				intendedLabel: "Receipts",
				rationale: "Protected mail should remain preserved",
				protectedExclusions: 1,
				nextApproval: "Separate exact review required before any future Gmail change",
			},
			{
				decision: "needs-review",
				scope: { type: "sender", value: "notifications@github.com" },
				candidateCount: 1,
				intendedLabel: "Needs review",
				rationale: "Mixed or ambiguous metadata prevents a lower-risk decision",
				protectedExclusions: 1,
				nextApproval: "Separate exact review required before any future Gmail change",
			},
			{
				decision: "needs-review",
				scope: { type: "sender", value: "mail@mixed.example" },
				candidateCount: 1,
				intendedLabel: "Needs review",
				rationale: "Mixed or ambiguous metadata prevents a lower-risk decision",
				protectedExclusions: 1,
				nextApproval: "Separate exact review required before any future Gmail change",
			},
		]);
		expect(result.exclusions.map((entry) => entry.categories)).toEqual([
			["receipt"],
			["github", "security"],
			["finance", "marketing", "subscription"],
		]);
		expect(result.overlaps).toEqual([
			{ categories: ["github", "security"], count: 1 },
			{ categories: ["finance", "marketing", "subscription"], count: 1 },
		]);
		expect(result.domainConcentration).toEqual([
			{
				domain: "github.com",
				senderCount: 1,
				threadCount: 2,
				candidateCount: 1,
				exclusionCount: 1,
			},
			{
				domain: "mixed.example",
				senderCount: 1,
				threadCount: 1,
				candidateCount: 0,
				exclusionCount: 1,
			},
			{
				domain: "shop.example",
				senderCount: 1,
				threadCount: 1,
				candidateCount: 0,
				exclusionCount: 1,
			},
			{
				domain: "weekly.example",
				senderCount: 1,
				threadCount: 1,
				candidateCount: 1,
				exclusionCount: 0,
			},
		]);
		expect(result.unknownSenderCount).toBe(0);
	});

	test("keeps the receipt value-free", () => {
		const result = auditThreads(FIXTURE, {
			query: "in:inbox newer_than:30d",
			max: 5,
			runId: "run-test",
			now: "2026-08-15T03:00:00.000Z",
		});
		const receipt = JSON.stringify(result.receipt);

		expect(result.receipt).toEqual({
			runId: "run-test",
			timestamp: "2026-08-15T03:00:00.000Z",
			cap: 5,
			returnedCount: 5,
			candidateCount: 2,
			exclusionCount: 3,
			overlapCount: 2,
			outcome: "completed",
			changedState: "none",
			nextSafeAction: "Review exact private proposals; make no Gmail change from this receipt",
		});
		for (const forbidden of [
			"in:inbox",
			"notifications@github.com",
			"weekly.example",
			"thread-",
			"Security alert",
			"more-private-results",
			"synthetic untrusted content",
		]) {
			expect(receipt).not.toContain(forbidden);
		}
	});

	test("returns an empty bounded result without leaking wrapper content", () => {
		const result = auditThreads(
			{ threads: [], externalContent: { warning: "private wrapper value" } },
			{
				query: "newer_than:7d",
				max: 20,
				runId: "run-empty",
				now: "2026-08-15T03:00:00.000Z",
			},
		);

		expect(result.cap).toEqual({ max: 20, returned: 0, reached: false, moreAvailable: false });
		expect(result.proposals).toEqual([]);
		expect(result.reviewProposals).toEqual([]);
		expect(result.receipt).toMatchObject({
			returnedCount: 0,
			candidateCount: 0,
			exclusionCount: 0,
			overlapCount: 0,
		});
		expect(JSON.stringify(result)).not.toContain("private wrapper value");
	});

	test("uses GitHub label precedence for mixed candidate rows from one sender", () => {
		const result = auditThreads(
			{
				threads: [
					{
						id: "marketing-first",
						from: "Mixed Sender <updates@mixed.example>",
						subject: "Monthly newsletter",
						date: "2026-08-14T02:00:00Z",
						labels: ["INBOX", "CATEGORY_PROMOTIONS"],
						messageCount: 1,
					},
					{
						id: "github-second",
						from: "Mixed Sender <updates@mixed.example>",
						subject: "GitHub review requested",
						date: "2026-08-15T02:00:00Z",
						labels: ["INBOX", "CATEGORY_UPDATES"],
						messageCount: 1,
					},
				],
			},
			{
				query: "newer_than:7d",
				max: 2,
				runId: "run-mixed-label",
				now: "2026-08-15T03:00:00.000Z",
			},
		);

		expect(result.proposals).toHaveLength(1);
		expect(result.proposals[0]).toMatchObject({
			scope: { type: "sender", value: "updates@mixed.example" },
			candidateCount: 2,
			intendedLabel: "GitHub",
		});
	});

	test("preserves unparseable sender metadata as ambiguous", () => {
		const result = auditThreads(
			{
				threads: [
					{
						id: "thread-ambiguous-sender",
						from: "Sender without an address",
						subject: "General update",
						date: "2026-08-15T02:00:00Z",
						labels: ["INBOX"],
						messageCount: 1,
					},
				],
			},
			{
				query: "newer_than:7d",
				max: 1,
				runId: "run-ambiguous",
				now: "2026-08-15T03:00:00.000Z",
			},
		);

		expect(result.proposals).toEqual([]);
		expect(result.exclusions).toEqual([
			{
				scope: { type: "sender", value: "unknown-sender" },
				categories: ["ambiguous"],
				rationale: "Protected category matched before lower-risk classification",
			},
		]);
		expect(result.domainConcentration).toEqual([]);
		expect(result.unknownSenderCount).toBe(1);
	});

	test("returns non-executable archive, unsubscribe, and block review candidates only with bounded metadata evidence", () => {
		const result = auditThreads(
			{
				threads: [
					{
						id: "newsletter-1",
						from: "Newsletter <news@letters.example>",
						subject: "Weekly newsletter",
						date: "2026-08-15T02:00:00Z",
						labels: ["INBOX", "CATEGORY_PROMOTIONS"],
						messageCount: 1,
					},
					{
						id: "newsletter-2",
						from: "Newsletter <news@letters.example>",
						subject: "Friday digest",
						date: "2026-08-14T02:00:00Z",
						labels: ["INBOX", "CATEGORY_PROMOTIONS"],
						messageCount: 1,
					},
					{
						id: "already-labeled",
						from: "Reading <read@queue.example>",
						subject: "Monthly digest",
						date: "2026-08-13T02:00:00Z",
						labels: ["INBOX", "Read later", "CATEGORY_PROMOTIONS"],
						messageCount: 1,
					},
					{
						id: "spam-row",
						from: "Bulk Sender <bulk@spam.example>",
						subject: "Marketing offer",
						date: "2026-08-12T02:00:00Z",
						labels: ["SPAM", "CATEGORY_PROMOTIONS"],
						messageCount: 1,
					},
				],
			},
			{
				query: "newer_than:7d",
				max: 4,
				runId: "run-review-candidates",
				now: "2026-08-15T03:00:00.000Z",
			},
		);

		expect(result.reviewProposals.map((proposal) => ({
			decision: proposal.decision,
			scope: proposal.scope,
			candidateCount: proposal.candidateCount,
			intendedLabel: proposal.intendedLabel,
		}))).toEqual([
			{
				decision: "unsubscribe-candidate",
				scope: { type: "sender", value: "news@letters.example" },
				candidateCount: 2,
				intendedLabel: "Read later",
			},
			{
				decision: "archive-candidate",
				scope: { type: "sender", value: "read@queue.example" },
				candidateCount: 1,
				intendedLabel: "Read later",
			},
			{
				decision: "block-candidate",
				scope: { type: "sender", value: "bulk@spam.example" },
				candidateCount: 1,
				intendedLabel: "Spam review",
			},
		]);
	});
});
