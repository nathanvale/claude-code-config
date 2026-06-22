import {
	type BranchStation,
	type BranchStationEvidence,
	type StationMap,
	findBranchStationCatalogDrift,
	projectCommandDiscoveryTree,
	projectStationMap,
} from "@side-quest/cli-command-facade";
import {
	DOCS_LOOP_COMMANDS_CONTRACT_ID,
	DOCS_LOOP_DOCTOR_CONTRACT_ID,
	DOCS_LOOP_MARK_CONTRACT_ID,
	DOCS_LOOP_PURGE_CONTRACT_ID,
	DOCS_LOOP_RUN_CARD_CONTRACT_ID,
	DOCS_LOOP_STATUS_CONTRACT_ID,
} from "./docs-loop-model.ts";
import {
	type StorybookDocsLoopCommand,
	storybookDocsLoopContracts,
} from "./command-contract.ts";

/** Planning-stage station ids for docs-loop declared branch coverage. */
export const STORYBOOK_DOCS_LOOP_PLANNING_BRANCH_STATION_IDS = [
	"single.component_json",
	"single.story_json",
	"single.missing_target",
	"batch.create_run",
	"batch.invalid_size",
	"resume.current_batch",
	"resume.missing_run",
	"status.summary_json",
	"advance.next_batch",
	"advance.degraded_without_force",
	"advance.degraded_with_force",
	"mark.field_done",
	"mark.field_na",
	"mark.field_blocked",
	"mark.invalid_field",
	"mark.missing_run",
	"doctor.corrupt_state",
	"purge.preview_required",
	"purge.force_run",
	"purge.force_old_state",
	"commands.docs_loop_discovery_json",
	"single.help_top_level",
	"single.version_stdout",
] as const;

/** Branch Station catalog for the docs-loop front door. */
export const storybookDocsLoopBranchStationCatalog = [
	station("single.component_json", "single", "success", 0, "ok", DOCS_LOOP_RUN_CARD_CONTRACT_ID),
	station("single.story_json", "single", "success_story", 0, "ok", DOCS_LOOP_RUN_CARD_CONTRACT_ID),
	station("single.missing_target", "single", "usage_error", 2, "error"),
	station("batch.create_run", "batch", "state_write_success", 0, "ok", DOCS_LOOP_RUN_CARD_CONTRACT_ID, "state"),
	station("batch.invalid_size", "batch", "usage_error", 2, "error"),
	station("resume.current_batch", "resume", "state_read_success", 0, "ok", DOCS_LOOP_RUN_CARD_CONTRACT_ID),
	station("resume.missing_run", "resume", "repairable_missing_state", 1, "error"),
	station("status.summary_json", "status", "state_read_success", 0, "ok", DOCS_LOOP_STATUS_CONTRACT_ID),
	station("advance.next_batch", "advance", "state_write_success", 0, "ok", DOCS_LOOP_RUN_CARD_CONTRACT_ID, "state"),
	station("advance.degraded_without_force", "advance", "usage_error", 2, "error"),
	station("advance.degraded_with_force", "advance", "forced_state_write", 0, "ok", DOCS_LOOP_RUN_CARD_CONTRACT_ID, "state"),
	station("mark.field_done", "mark", "receipt_done", 0, "ok", DOCS_LOOP_MARK_CONTRACT_ID, "state"),
	station("mark.field_na", "mark", "receipt_na", 0, "ok", DOCS_LOOP_MARK_CONTRACT_ID, "state"),
	station("mark.field_blocked", "mark", "receipt_blocked", 0, "ok", DOCS_LOOP_MARK_CONTRACT_ID, "state"),
	station("mark.invalid_field", "mark", "usage_error", 2, "error"),
	station("mark.missing_run", "mark", "repairable_missing_state", 1, "error"),
	station("doctor.corrupt_state", "doctor", "diagnostic_repair", 0, "ok", DOCS_LOOP_DOCTOR_CONTRACT_ID),
	station("purge.preview_required", "purge", "preview_success", 0, "ok", DOCS_LOOP_PURGE_CONTRACT_ID),
	station("purge.force_run", "purge", "destructive_success", 0, "ok", DOCS_LOOP_PURGE_CONTRACT_ID, "destructive"),
	station("purge.force_old_state", "purge", "sweep_success", 0, "ok", DOCS_LOOP_PURGE_CONTRACT_ID, "destructive"),
	station("commands.docs_loop_discovery_json", "commands", "discovery_success", 0, "ok", DOCS_LOOP_COMMANDS_CONTRACT_ID),
	station("single.help_top_level", "single", "help", 0),
	station("single.version_stdout", "single", "version", 0),
] as const satisfies readonly BranchStation[];

const contractEntries = Object.entries(storybookDocsLoopContracts) as Array<
	[
		StorybookDocsLoopCommand,
		(typeof storybookDocsLoopContracts)[StorybookDocsLoopCommand],
	]
>;

/** Project live docs-loop command discovery for station validation. */
export function projectStorybookDocsLoopStationDiscovery() {
	return projectCommandDiscoveryTree(contractEntries);
}

/** Find docs-loop station catalog drift against live discovery and evidence. */
export function findStorybookDocsLoopBranchStationCatalogDrift(
	evidence: readonly BranchStationEvidence[] = [],
) {
	return findBranchStationCatalogDrift({
		discovery: projectStorybookDocsLoopStationDiscovery(),
		catalog: storybookDocsLoopBranchStationCatalog,
		evidence,
		path: "skills/use-storybook/src/front-doors/storybook-docs-loop/branch-station-catalog.ts",
	});
}

/** Project docs-loop declared branch coverage map. */
export function projectStorybookDocsLoopStationMap(
	evidence: readonly BranchStationEvidence[] = [],
): StationMap {
	return projectStationMap({
		discovery: projectStorybookDocsLoopStationDiscovery(),
		catalog: storybookDocsLoopBranchStationCatalog,
		evidence,
		path: "skills/use-storybook/src/front-doors/storybook-docs-loop/branch-station-catalog.ts",
	});
}

function station(
	id: (typeof STORYBOOK_DOCS_LOOP_PLANNING_BRANCH_STATION_IDS)[number],
	command: StorybookDocsLoopCommand,
	intent: string,
	expectedExitCode: number,
	expectedEnvelopeStatus?: "ok" | "error",
	expectedResultContractId?: string,
	mutationExpectation: "none" | "state" | "destructive" = "none",
): BranchStation {
	return {
		id,
		command,
		classification: "required",
		intent,
		trigger: `${id} branch`,
		expectedExitCode,
		...(expectedEnvelopeStatus ? { expectedEnvelopeStatus } : {}),
		...(expectedResultContractId ? { expectedResultContractId } : {}),
		mutationExpectation,
	};
}
