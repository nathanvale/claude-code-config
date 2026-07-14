import { installedArtifactPresence } from "../../../runbooks/issue-to-pr-v2/lib/route.ts";

import type { SetupFinding } from "./model.ts";

export interface RunbookHealthResult {
	readonly healthy: boolean;
	readonly missing: readonly string[];
	readonly finding?: SetupFinding;
}

export function checkRunbookHealth(root: string): RunbookHealthResult {
	const presence = installedArtifactPresence(root);
	if (presence.all_present) return { healthy: true, missing: presence.missing };
	return {
		healthy: false,
		missing: presence.missing,
		finding: {
			id: "runbook_artifact_unhealthy",
			owner: "runbooks/issue-to-pr-v2/lib/route.ts",
			path: root,
			summary: `Issue-to-PR runbook artifacts are missing: ${presence.missing.join(", ")}.`,
			repair: "repair_runbook",
		},
	};
}
