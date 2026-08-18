import { describe, expect, test } from "bun:test";

import { isResumedLocalCommit } from "../src/doctor.ts";
import type { VaultGitLocalCommitInspection } from "../src/ports.ts";

// Doctor's recovery verdict and Repair's mismatch guard both consult this one
// predicate. These near-miss cases pin the exact boundary so a change to trailer
// or parent checking cannot make one path accept what the other rejects.
const receipt = {
	localMainHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	transactionId: "txn_resume_fixture",
} as const;

const okCommit = (
	overrides: Partial<Extract<VaultGitLocalCommitInspection, { status: "ok" }>>,
): VaultGitLocalCommitInspection => ({
	status: "ok",
	commitId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	parents: [receipt.localMainHead],
	message: `body\n\nVault-Transaction: ${receipt.transactionId}`,
	...overrides,
});

describe("isResumedLocalCommit", () => {
	test("accepts a single-parent commit on the head carrying the trailer", () => {
		expect(isResumedLocalCommit(okCommit({}), receipt)).toBe(true);
	});

	test("rejects a commit whose sole parent is not the receipt head", () => {
		expect(
			isResumedLocalCommit(
				okCommit({ parents: ["cccccccccccccccccccccccccccccccccccccccc"] }),
				receipt,
			),
		).toBe(false);
	});

	test("rejects a merge commit with two parents", () => {
		expect(
			isResumedLocalCommit(
				okCommit({
					parents: [
						receipt.localMainHead,
						"dddddddddddddddddddddddddddddddddddddddd",
					],
				}),
				receipt,
			),
		).toBe(false);
	});

	test("rejects a root commit with zero parents", () => {
		expect(isResumedLocalCommit(okCommit({ parents: [] }), receipt)).toBe(
			false,
		);
	});

	test("rejects a commit missing the transaction trailer", () => {
		expect(
			isResumedLocalCommit(okCommit({ message: "body with no trailer" }), receipt),
		).toBe(false);
	});

	test("rejects a commit carrying a different transaction's trailer", () => {
		expect(
			isResumedLocalCommit(
				okCommit({ message: "body\n\nVault-Transaction: txn_other" }),
				receipt,
			),
		).toBe(false);
	});

	test("rejects a non-ok inspection", () => {
		expect(isResumedLocalCommit({ status: "missing" }, receipt)).toBe(false);
		expect(
			isResumedLocalCommit(
				{ status: "failed", reason: "probe_failed" },
				receipt,
			),
		).toBe(false);
	});
});
