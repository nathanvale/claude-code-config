import { describe, expect, test } from "bun:test";
import {
	browserUseTargetDiscoveryFailureActions,
	browserUseTargetSelectionFailureActions,
} from "./command-contract";

// =========================================================================
// Shared substrate (core leaf)
// =========================================================================
//
// Direct coverage for assertions the U-block suites only made incidentally.
// The action-id drift guard tests the command-contract action arrays — pure
// substrate, no CLI driver — so it lives here rather than in the driver test
// (plan U14).

describe("core substrate", () => {
	test("a runtime action id shared across discovery and selection has one summary", () => {
		// rerun_route_bound_target_discovery is declared in both action arrays. The
		// two surfaces build separate Maps, so nothing fails at runtime if they
		// drift — guard here that one continuation id never documents two different
		// recovery strings.
		const discovery = new Map<string, string>(
			browserUseTargetDiscoveryFailureActions.map((a) => [a.id, a.summary]),
		);
		for (const action of browserUseTargetSelectionFailureActions) {
			const shared = discovery.get(action.id);
			if (shared !== undefined) {
				expect(action.summary as string).toBe(shared);
			}
		}
	});
});
