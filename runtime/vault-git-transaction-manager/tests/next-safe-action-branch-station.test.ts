import { describe, expect, test } from "bun:test";
import type { BranchStation } from "@side-quest/cli-command-facade";

import {
	findVaultGitBranchStationCatalogDrift,
	vaultGitBranchStationCatalog,
} from "../src/branch-station-catalog.ts";
import {
	projectVaultGitNextSafeAction,
	type VaultGitContinuationContext,
	type VaultGitContinuationSelectors,
} from "../src/next-safe-action.ts";

/**
 * ADR-0002 U1 point 9: every Branch Station expectedActionId projects the complete
 * Next Safe Action continuation (kind, and for its kind the owner/effects/selectors)
 * through the single authoritative catalog, and Branch Station catalog drift against
 * live command discovery stays empty. This binds Branch Station (the branch
 * expectation owner) to the union catalog so the two cannot drift. Independent
 * oracle: each expected id is driven with its real station context/selectors, and
 * the projected continuation is asserted complete, not merely present.
 */

const TXN = "txn_11111111111111111111111111111111";
const TASK = "task_11111111111111111111111111111111";
const EVIDENCE = `vault-git:prepared:v2:${"0".repeat(64)}`;

const SELECTORS: VaultGitContinuationSelectors = {
	transaction_id: TXN,
	task_id: TASK,
	evidence_reference: EVIDENCE,
};

// Real per-station context for the legacy contextual ids a fully projected station
// declares. A completed Completion Task station declares the legacy inspect_status,
// split by Task kind to inspect_completion_task. (A generic usage-failure change_input
// station carries no context and is proved fail-closed separately.)
const STATION_CONTEXT: Readonly<Record<string, VaultGitContinuationContext>> = {
	inspect_status: { result_kind: "completion_task" },
};

function isComplete(
	continuation: ReturnType<typeof projectVaultGitNextSafeAction>["continuation"],
): boolean {
	switch (continuation.kind) {
		case "invoke":
			return (
				(continuation.executable === "vault-git" ||
					continuation.executable === "setup") &&
				continuation.argv.length > 0 &&
				continuation.action_id.length > 0
			);
		case "needs_input":
			return (
				continuation.input_contract_id.length > 0 &&
				continuation.fields.length > 0
			);
		case "needs_human":
			return continuation.handoff_kind === "command"
				? continuation.executable.length > 0 && continuation.argv.length > 0
				: continuation.owner.length > 0 && continuation.condition.length > 0;
		case "none":
			// A terminal none is complete when it carries its own action id (an
			// explicit terminal continuation such as continue_outer_transaction), not
			// only the fail-closed "none".
			return continuation.action_id.length > 0;
	}
}

describe("vault-git U1 Branch Station ↔ Next Safe Action alignment", () => {
	const withAction = (vaultGitBranchStationCatalog as readonly BranchStation[]).filter(
		(station) => station.expectedActionId !== undefined,
	);

	// The three-way continuation contract. A station with an expectedContinuationId is
	// fully projected (runnable). A station with an action id but NO
	// expectedContinuationId is a terminal none, split by its action_id: a LEGITIMATE
	// terminal keeps its own action_id (e.g. continue_outer_transaction), while a
	// FAIL-CLOSED station's action cannot resolve without context/selector and projects
	// action_id "none" (e.g. a generic usage change_input).
	const fullyProjected = withAction.filter(
		(station) => station.expectedContinuationId !== undefined,
	);
	const terminalNone = withAction.filter(
		(station) => station.expectedContinuationId === undefined,
	);
	// A station whose action id is itself a terminal-none catalog continuation is a
	// legitimate terminal; everything else in this set is a fail-closed usage failure.
	const legitimateTerminal = terminalNone.filter((station) => {
		const projection = projectVaultGitNextSafeAction({
			action_id: station.expectedActionId as string,
		});
		return (
			projection.availability === "available" &&
			projection.continuation.kind === "none"
		);
	});
	const failClosed = terminalNone.filter(
		(station) => !legitimateTerminal.includes(station),
	);

	test("every fully projected station resolves its action id to a complete union", () => {
		expect(fullyProjected.length).toBeGreaterThan(0);
		for (const station of fullyProjected) {
			const actionId = station.expectedActionId as string;
			const context = STATION_CONTEXT[actionId];
			const projection = projectVaultGitNextSafeAction({
				action_id: actionId,
				selectors: SELECTORS,
				...(context ? { context } : {}),
			});
			// Complete kind/owner/effects/selectors — never unavailable, never a
			// summary-only stub.
			expect({ station: station.id, availability: projection.availability }).toEqual({
				station: station.id,
				availability: "available",
			});
			expect({ station: station.id, complete: isComplete(projection.continuation) }).toEqual(
				{ station: station.id, complete: true },
			);
		}
	});

	test("every legitimate-terminal station projects an available terminal none with its own action id", () => {
		expect(legitimateTerminal.length).toBeGreaterThan(0);
		for (const station of legitimateTerminal) {
			const actionId = station.expectedActionId as string;
			const projection = projectVaultGitNextSafeAction({ action_id: actionId });
			expect({ station: station.id, availability: projection.availability }).toEqual({
				station: station.id,
				availability: "available",
			});
			expect(projection.continuation.kind).toBe("none");
			// A legitimate terminal keeps its own action id (never the fail-closed "none").
			expect({
				station: station.id,
				action_id: projection.continuation.action_id,
			}).toEqual({ station: station.id, action_id: actionId });
		}
	});

	test("every fail-closed station's action projects unavailable without task context", () => {
		expect(failClosed.length).toBeGreaterThan(0);
		for (const station of failClosed) {
			const actionId = station.expectedActionId as string;
			// Driven with no task context/selector: the action must fail closed, never
			// resolve to a runnable continuation.
			const projection = projectVaultGitNextSafeAction({
				action_id: actionId,
			});
			expect({ station: station.id, availability: projection.availability }).toEqual({
				station: station.id,
				availability: "unavailable",
			});
			expect(projection.continuation.kind).toBe("none");
			// A fail-closed projection carries the sentinel "none" action id.
			expect(projection.continuation.action_id).toBe("none");
		}
	});

	test("a completed Completion Task station splits inspect_status to inspect_completion_task", () => {
		const completed = withAction.find(
			(station) => station.expectedActionId === "inspect_status",
		);
		expect(completed).toBeDefined();
		const projection = projectVaultGitNextSafeAction({
			action_id: "inspect_status",
			context: { result_kind: "completion_task" },
			selectors: { task_id: TASK },
		});
		expect(projection.continuation).toMatchObject({
			kind: "invoke",
			action_id: "inspect_completion_task",
			executable: "vault-git",
			argv: ["status", "--task-id", TASK, "--json"],
		});
	});

	test("Branch Station catalog drift against live command discovery stays empty", () => {
		expect(findVaultGitBranchStationCatalogDrift()).toEqual([]);
	});
});
