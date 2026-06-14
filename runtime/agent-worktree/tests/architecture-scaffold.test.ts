import { describe, expect, test } from "bun:test";

import { aggregateDoctorMap, type DoctorCheck } from "../src/doctor.ts";
import {
	parseAgentWorktreeRef,
	resolveInspectableRef,
} from "../src/inspect.ts";
import { AGENT_WORKTREE_SCAFFOLD_SEAMS } from "../src/model.ts";
import { normalizeProjectionOptions } from "../src/projection.ts";
import { summarizeOperationChangedState } from "../src/store.ts";
import { buildRecoveryPlan } from "../src/worktrees.ts";

describe("agent-worktree architecture scaffolds", () => {
	test("aggregates doctor blockers and unknowns into mutation readiness", () => {
		const checks = [
			doctorCheck("repo", "ok"),
			doctorCheck("worktrees", "blocked", ["delete"], ["inspect_failure"]),
		] satisfies readonly DoctorCheck[];

		expect(aggregateDoctorMap(checks)).toMatchObject({
			status: "blocked",
			mutationReadiness: "blocked",
			nextActions: ["inspect_failure"],
		});

		expect(aggregateDoctorMap([doctorCheck("store", "unknown")])).toMatchObject({
			status: "unknown",
			mutationReadiness: "unknown",
		});
	});

	test("parses typed refs and resolves store-local paths", () => {
		const failureRef = parseAgentWorktreeRef("failure:run-1/delete_branch");

		expect(failureRef).toEqual({
			kind: "failure",
			id: "run-1/delete_branch",
		});
		expect(failureRef && resolveInspectableRef(failureRef)).toMatchObject({
			storeDir: "failures",
			relativePath: "failures/run-1/delete_branch.json",
		});
		expect(parseAgentWorktreeRef("handoff:missing")).toBeNull();
		expect(parseAgentWorktreeRef("failure:../escape")).toBeNull();
	});

	test("summarizes operation changed-state for recovery", () => {
		expect(summarizeOperationChangedState([])).toBe("none");
		expect(
			summarizeOperationChangedState([
				{
					id: "remove_worktree",
					action: "remove worktree",
					status: "completed",
					changedState: "complete",
				},
				{
					id: "delete_branch",
					action: "delete branch",
					status: "failed",
					changedState: "partial",
				},
			]),
		).toBe("partial");
		expect(
			summarizeOperationChangedState([
				{
					id: "remove_worktree",
					action: "remove worktree",
					status: "completed",
					changedState: "complete",
				},
				{
					id: "delete_branch",
					action: "delete branch",
					status: "pending",
					changedState: "none",
				},
			]),
		).toBe("complete");
	});

	test("builds recovery plans from changed-state", () => {
		expect(buildRecoveryPlan({ changedState: "none" })).toMatchObject({
			nextActionId: "retry_same_input",
			choices: [{ retrySafety: "same_input_safe" }],
		});
		expect(
			buildRecoveryPlan({
				changedState: "partial",
				failureRef: { kind: "failure", id: "run-1/delete_branch" },
			}),
		).toMatchObject({
			nextActionId: "inspect_failure_ref",
			choices: [
				{
					retrySafety: "inspect_first",
					handoffReason: "partial_mutation",
				},
			],
		});
	});

	test("normalizes bounded projection options", () => {
		expect(normalizeProjectionOptions()).toEqual({
			mode: "summary",
			limit: 20,
			fields: ["default"],
		});
		expect(
			normalizeProjectionOptions({
				mode: "detail",
				limit: 500,
				fields: ["refs", "refs", "evidence"],
			}),
		).toEqual({
			mode: "detail",
			limit: 100,
			fields: ["refs", "evidence"],
		});
		expect(normalizeProjectionOptions({ limit: 25 })).toMatchObject({
			mode: "detail",
			limit: 25,
		});
	});

	test("registers projection as an earned scaffold seam", () => {
		expect(
			AGENT_WORKTREE_SCAFFOLD_SEAMS.map((seam) => seam.ownerPath),
		).toContain("runtime/agent-worktree/src/projection.ts");
	});
});

function doctorCheck(
	id: DoctorCheck["id"],
	status: DoctorCheck["status"],
	blockers: readonly string[] = [],
	nextActions: readonly string[] = [],
): DoctorCheck {
	return {
		id,
		owner: `test.${id}`,
		status,
		summary: `${id} ${status}`,
		blockers,
		nextActions,
	};
}
