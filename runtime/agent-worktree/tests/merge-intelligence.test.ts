import { describe, expect, test } from "bun:test";

import {
	MERGE_EVIDENCE_CASCADE_STEPS,
	classifyBranchSafety,
	createGitEvidencePort,
	type MergeEvidence,
} from "../src/merge-intelligence.ts";

const cleanMergedEvidence = {
	merged: true,
	method: "ancestor",
	commitsAhead: 0,
	commitsBehind: 1,
	issues: [],
} as const satisfies MergeEvidence;

describe("merge intelligence architecture scaffold", () => {
	test("names the fixed evidence cascade without a handler registry", () => {
		expect(MERGE_EVIDENCE_CASCADE_STEPS.map((step) => step.id)).toEqual([
			"ancestor",
			"ahead_behind",
			"squash",
		]);
	});

	test("allows lifecycle action when clean branch is proven merged", () => {
		expect(
			classifyBranchSafety({
				branch: "feat/done",
				protectedBranch: false,
				dirty: false,
				checkedOutElsewhere: false,
				evidence: cleanMergedEvidence,
			}),
		).toEqual({
			disposition: "allow",
			reason: "merged",
			retrySafe: true,
			method: "ancestor",
		});
	});

	test("blocks protected and dirty branches before merge evidence matters", () => {
		expect(
			classifyBranchSafety({
				branch: "main",
				protectedBranch: true,
				dirty: false,
				checkedOutElsewhere: false,
				evidence: cleanMergedEvidence,
			}).reason,
		).toBe("protected_branch");

		expect(
			classifyBranchSafety({
				branch: "feat/dirty",
				protectedBranch: false,
				dirty: true,
				checkedOutElsewhere: false,
				evidence: cleanMergedEvidence,
			}).reason,
		).toBe("dirty");
	});

	test("routes unreliable evidence to handoff instead of guessing", () => {
		const evidence = {
			merged: false,
			commitsAhead: -1,
			commitsBehind: -1,
			issues: [
				{
					code: "shallow_clone",
					severity: "error",
					source: "shallow_guard",
					message: "Shallow clone prevents reliable detection.",
					countsReliable: false,
				},
			],
		} as const satisfies MergeEvidence;

		expect(
			classifyBranchSafety({
				branch: "feat/unknown",
				protectedBranch: false,
				dirty: false,
				checkedOutElsewhere: false,
				evidence,
			}),
		).toEqual({
			disposition: "handoff",
			reason: "evidence_unreliable",
			retrySafe: false,
		});
	});

	test("warns on clean unmerged evidence", () => {
		expect(
			classifyBranchSafety({
				branch: "feat/open",
				protectedBranch: false,
				dirty: false,
				checkedOutElsewhere: false,
				evidence: {
					merged: false,
					commitsAhead: 2,
					commitsBehind: 0,
					issues: [],
				},
			}),
		).toEqual({
			disposition: "warn",
			reason: "unmerged",
			retrySafe: false,
		});
	});

	test("ancestor proof is not poisoned by ahead-behind count failure", async () => {
		const evidence = await createGitEvidencePort(
			fakeGitRunner({
				["git rev-parse --is-shallow-repository"]: "false\n",
				["git merge-base --is-ancestor feat/done main"]: "",
			}),
			"/repo",
		).detectMergeEvidence({ branch: "feat/done", targetBranch: "main" });

		expect(evidence).toMatchObject({
			merged: true,
			method: "ancestor",
			issues: [],
		});
		expect(
			classifyBranchSafety({
				branch: "feat/done",
				protectedBranch: false,
				dirty: false,
				checkedOutElsewhere: false,
				evidence,
			}).reason,
		).toBe("merged");
	});

	test("merge-base errors become unreliable evidence instead of squash guesses", async () => {
		const evidence = await createGitEvidencePort(
			async (args) => {
				const key = args.join(" ");
				if (key === "git rev-parse --is-shallow-repository") {
					return { ok: true, stdout: "false\n", stderr: "", code: 0 };
				}
				if (key === "git merge-base --is-ancestor feat/x main") {
					return { ok: false, stdout: "", stderr: "bad ref", code: 128 };
				}
				return { ok: false, stdout: "", stderr: "missing", code: 1 };
			},
			"/repo",
		).detectMergeEvidence({ branch: "feat/x", targetBranch: "main" });

		expect(evidence.merged).toBe(false);
		expect(evidence.issues.map((issue) => issue.code)).toContain(
			"merge_base_failed",
		);
		expect(
			classifyBranchSafety({
				branch: "feat/x",
				protectedBranch: false,
				dirty: false,
				checkedOutElsewhere: false,
				evidence,
			}).reason,
		).toBe("evidence_unreliable");
	});
});

function fakeGitRunner(outputs: Record<string, string>) {
	return async (args: readonly string[]) => {
		const stdout = outputs[args.join(" ")];
		return stdout === undefined
			? { ok: false, stdout: "", stderr: "missing fake output", code: 1 }
			: { ok: true, stdout, stderr: "", code: 0 };
	};
}
