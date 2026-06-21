// PROTOTYPE - portable Station Help renderer logic. Delete or absorb after review.

import type {
	BranchStation,
	BranchStationEvidence,
	StationMap,
	StationMapStation,
} from "@side-quest/cli-command-facade";
import {
	projectStorybookDocsLoopStationMap,
	storybookDocsLoopBranchStationCatalog,
} from "../src/front-doors/storybook-docs-loop/branch-station-catalog.ts";
import {
	projectStorybookDoctorStationMap,
	storybookDoctorBranchStationCatalog,
} from "../src/front-doors/storybook-doctor/branch-station-catalog.ts";

/** Prototype evidence scenarios used to feel out Station Help output. */
export type PrototypeScenario = "catalog-only" | "covered" | "mixed" | "drift";

/** Prototype surface selection. */
export type PrototypeSurfaceMode = "docs-loop" | "doctor" | "both";

/** Prototype view selection. */
export type PrototypeViewMode = "overview" | "findings" | "station";

/** User actions accepted by the terminal prototype. */
export type PrototypeAction =
	| "cycle-scenario"
	| "cycle-surface"
	| "cycle-view"
	| "next-command"
	| "previous-command"
	| "next-station"
	| "previous-station";

/** In-memory prototype UI state. */
export interface PrototypeState {
	/** Active evidence scenario. */
	scenario: PrototypeScenario;
	/** Active surface filter. */
	surfaceMode: PrototypeSurfaceMode;
	/** Active rendered view. */
	viewMode: PrototypeViewMode;
	/** Command filter index within the current surface set. */
	commandIndex: number;
	/** Station selection index within the filtered station set. */
	stationIndex: number;
}

/** One rendered Station Help source. */
export interface PrototypeSurface {
	/** Human label for the CLI surface. */
	title: string;
	/** Public command name. */
	command: string;
	/** Source catalog path. */
	source: string;
	/** Projected Station Map for the selected scenario. */
	stationMap: StationMap;
}

/** Derived frame data shown by the TUI after every action. */
export interface PrototypeFrame {
	/** Current user state. */
	state: PrototypeState;
	/** Active surface data. */
	surfaces: readonly PrototypeSurface[];
	/** Active command filter or all commands. */
	commandFilter: string;
	/** Visible promised behavior list after filters. */
	stations: readonly StationMapStation[];
	/** Markdown preview for the selected view. */
	preview: string;
	/** Summary counts across active surfaces. */
	counts: PrototypeCounts;
}

/** Aggregate Station Help counts for the current frame. */
export interface PrototypeCounts {
	/** Number of active surfaces. */
	surfaces: number;
	/** Total projected promised behaviors. */
	stations: number;
	/** Total required stations. */
	required: number;
	/** Required stations without evidence. */
	missingRequired: number;
	/** Stations projected as drifted. */
	drifted: number;
	/** Stations with skipped evidence. */
	skipped: number;
	/** Stations declared unreachable. */
	unreachable: number;
	/** Catalog drift records. */
	catalogDrift: number;
}

const SCENARIOS: readonly PrototypeScenario[] = [
	"catalog-only",
	"covered",
	"mixed",
	"drift",
] as const;
const SURFACE_MODES: readonly PrototypeSurfaceMode[] = [
	"docs-loop",
	"doctor",
	"both",
] as const;
const VIEW_MODES: readonly PrototypeViewMode[] = [
	"overview",
	"findings",
	"station",
] as const;

/** Create the first in-memory state for the Station Help prototype. */
export function createInitialPrototypeState(): PrototypeState {
	return {
		scenario: "catalog-only",
		surfaceMode: "docs-loop",
		viewMode: "overview",
		commandIndex: 0,
		stationIndex: 0,
	};
}

/** Advance prototype state through one terminal action. */
export function reducePrototypeState(
	state: PrototypeState,
	action: PrototypeAction,
): PrototypeState {
	const next = { ...state };
	if (action === "cycle-scenario") {
		next.scenario = nextValue(SCENARIOS, state.scenario);
		next.stationIndex = 0;
	}
	if (action === "cycle-surface") {
		next.surfaceMode = nextValue(SURFACE_MODES, state.surfaceMode);
		next.commandIndex = 0;
		next.stationIndex = 0;
	}
	if (action === "cycle-view") {
		next.viewMode = nextValue(VIEW_MODES, state.viewMode);
	}
	if (action === "next-command") next.commandIndex += 1;
	if (action === "previous-command") next.commandIndex -= 1;
	if (action === "next-station") next.stationIndex += 1;
	if (action === "previous-station") next.stationIndex -= 1;
	return next;
}

/** Render the current state into stable frame data. */
export function projectPrototypeFrame(state: PrototypeState): PrototypeFrame {
	const surfaces = buildSurfaces(state.scenario).filter((surface) =>
		state.surfaceMode === "both"
			? true
			: state.surfaceMode === "docs-loop"
				? surface.command === "storybook-docs-loop"
				: surface.command === "storybook-doctor",
	);
	const commandIds = [
		"all",
		...new Set(
			surfaces.flatMap((surface) => Object.keys(surface.stationMap.commands)),
		),
	].sort((left, right) =>
		left === "all" ? -1 : right === "all" ? 1 : left.localeCompare(right),
	);
	const commandFilter = commandIds[wrapIndex(state.commandIndex, commandIds.length)];
	const stations = surfaces.flatMap((surface) =>
		surface.stationMap.stations.filter((station) =>
			commandFilter === "all" ? true : station.command === commandFilter,
		),
	);
	const normalizedState = {
		...state,
		commandIndex: wrapIndex(state.commandIndex, commandIds.length),
		stationIndex: wrapIndex(state.stationIndex, Math.max(1, stations.length)),
	};
	const frame = {
		state: normalizedState,
		surfaces,
		commandFilter,
		stations,
		counts: countSurfaces(surfaces),
		preview: "",
	};
	return {
		...frame,
		preview: renderPreview({
			...frame,
			state: normalizedState,
		}),
	};
}

/** Render full markdown for the current state, suitable for stdout inspection. */
export function renderPrototypeMarkdown(state: PrototypeState): string {
	const frame = projectPrototypeFrame(state);
	const lines = [
		"# Storybook Station Proof Guide",
		"",
		"PROTOTYPE - in-memory DX guide. Edit catalogs, command contracts, and evidence sources; do not edit generated output.",
		"",
		`Fake proof state: \`${frame.state.scenario}\``,
		`CLI surface: \`${frame.state.surfaceMode}\``,
		`Command filter: \`${frame.commandFilter}\``,
		"",
		...frame.surfaces.flatMap((surface) => renderSurfaceMarkdown(surface)),
	];
	return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function buildSurfaces(scenario: PrototypeScenario): readonly PrototypeSurface[] {
	return [
		{
			title: "Storybook Docs Loop",
			command: "storybook-docs-loop",
			source:
				"skills/storybook/src/front-doors/storybook-docs-loop/branch-station-catalog.ts",
			stationMap: projectStorybookDocsLoopStationMap(
				buildScenarioEvidence(storybookDocsLoopBranchStationCatalog, scenario),
			),
		},
		{
			title: "Storybook Doctor",
			command: "storybook-doctor",
			source:
				"skills/storybook/src/front-doors/storybook-doctor/branch-station-catalog.ts",
			stationMap: projectStorybookDoctorStationMap(
				buildScenarioEvidence(storybookDoctorBranchStationCatalog, scenario),
			),
		},
	];
}

function buildScenarioEvidence(
	catalog: readonly BranchStation[],
	scenario: PrototypeScenario,
): BranchStationEvidence[] {
	if (scenario === "catalog-only") return [];
	if (scenario === "covered") return catalog.map(coveredEvidence);
	if (scenario === "drift") {
		return catalog.map((station, index) =>
			index === 0 ? driftEvidence(station) : coveredEvidence(station),
		);
	}
	return catalog.flatMap((station, index) => {
		if (index === 0) return [];
		if (index === 1) return [driftEvidence(station)];
		if (index === 2) {
			return [
				{
					stationId: station.id,
					status: "skipped",
					rationale: "prototype scenario: deterministic setup not chosen yet",
				},
			];
		}
		if (index === 3) {
			return [
				{
					stationId: station.id,
					status: "declared-unreachable",
					rationale: "prototype scenario: host state cannot be forced safely",
				},
			];
		}
		return [coveredEvidence(station)];
	});
}

function coveredEvidence(station: BranchStation): BranchStationEvidence {
	return {
		stationId: station.id,
		status: "covered",
		...(station.expectedExitCode === undefined
			? {}
			: { observedExitCode: station.expectedExitCode }),
		...(station.expectedEnvelopeStatus
			? { observedEnvelopeStatus: station.expectedEnvelopeStatus }
			: {}),
		...(station.expectedResultContractId
			? { observedResultContractId: station.expectedResultContractId }
			: {}),
		...(station.expectedErrorCode
			? { observedErrorCode: station.expectedErrorCode }
			: {}),
	};
}

function driftEvidence(station: BranchStation): BranchStationEvidence {
	const evidence = coveredEvidence(station);
	return {
		...evidence,
		observedExitCode:
			station.expectedExitCode === 0 || station.expectedExitCode === undefined
				? 1
				: 0,
	};
}

function countSurfaces(surfaces: readonly PrototypeSurface[]): PrototypeCounts {
	const stations = surfaces.flatMap((surface) => surface.stationMap.stations);
	return {
		surfaces: surfaces.length,
		stations: stations.length,
		required: stations.filter((station) => station.classification === "required")
			.length,
		missingRequired: stations.filter(
			(station) =>
				station.classification === "required" &&
				station.evidence.status === "missing",
		).length,
		drifted: stations.filter((station) => station.evidence.status === "drifted")
			.length,
		skipped: stations.filter((station) => station.evidence.status === "skipped")
			.length,
		unreachable: stations.filter(
			(station) => station.evidence.status === "declared-unreachable",
		).length,
		catalogDrift: surfaces.reduce(
			(total, surface) => total + surface.stationMap.drift.length,
			0,
		),
	};
}

function renderPreview(frame: Omit<PrototypeFrame, "preview">): string {
	if (frame.state.viewMode === "findings") return renderFindingsPreview(frame);
	if (frame.state.viewMode === "station") return renderStationPreview(frame);
	return renderOverviewPreview(frame);
}

function renderOverviewPreview(frame: Omit<PrototypeFrame, "preview">): string {
	const lines = [
		"## Overview",
		"",
		`- CLI surfaces: ${frame.counts.surfaces}`,
		`- Promised behaviors: ${frame.counts.stations}`,
		`- Required behaviors missing proof: ${frame.counts.missingRequired}`,
		`- Behaviors with drifted proof: ${frame.counts.drifted}`,
		`- Behaviors intentionally skipped: ${frame.counts.skipped}`,
		`- Behaviors declared unreachable: ${frame.counts.unreachable}`,
		`- Catalog drift records: ${frame.counts.catalogDrift}`,
		"",
		"### Commands",
		"",
		"| CLI surface | Command | Promised behaviors | Next actions |",
		"| --- | --- | ---: | ---: |",
	];
	for (const surface of frame.surfaces) {
		for (const [command, metadata] of Object.entries(
			surface.stationMap.commands,
		).sort(([left], [right]) => left.localeCompare(right))) {
			const findingCount = surface.stationMap.findings.filter(
				(finding) => finding.command === command,
			).length;
			lines.push(
				`| ${surface.title} | \`${escapeMarkdownCell(command)}\` | ${metadata.station_ids.length} | ${findingCount} |`,
			);
		}
	}
	return lines.join("\n");
}

function renderFindingsPreview(frame: Omit<PrototypeFrame, "preview">): string {
	const findings = frame.surfaces.flatMap((surface) =>
		surface.stationMap.stations
			.filter((station) => station.evidence.status !== "covered")
			.filter((station) =>
				frame.commandFilter === "all"
					? true
					: station.command === frame.commandFilter,
			)
			.map((station) => ({
				surface: surface.title,
				station,
			})),
	);
	if (findings.length === 0) {
		return "## Next Actions\n\nNo proof work for this filter.";
	}
	return [
		"## Next Actions",
		"",
		"| CLI surface | Promised behavior | Proof state | Do next |",
		"| --- | --- | --- | --- |",
		...findings.slice(0, 14).map(
			(finding) =>
				`| ${finding.surface} | \`${escapeMarkdownCell(finding.station.station_id)}\` | \`${finding.station.evidence.status}\` | ${escapeMarkdownCell(repairHint(finding.station))} |`,
		),
		findings.length > 14
			? `\nShowing 14 of ${findings.length}; filter by command or cycle scenario.`
			: "",
	]
		.filter(Boolean)
		.join("\n");
}

function renderStationPreview(frame: Omit<PrototypeFrame, "preview">): string {
	const station =
		frame.stations[wrapIndex(frame.state.stationIndex, frame.stations.length)];
	if (!station) return "## Behavior Detail\n\nNo promised behaviors for this filter.";
	return renderStationCard(station).join("\n");
}

function renderSurfaceMarkdown(surface: PrototypeSurface): string[] {
	return [
		`## ${surface.title}`,
		"",
		`- Command: \`${surface.command}\``,
		`- Source: \`${surface.source}\``,
		`- Completeness claim: \`${surface.stationMap.completeness_claim}\``,
		`- Promised behaviors: ${surface.stationMap.stations.length}`,
		`- Catalog drift records: ${surface.stationMap.drift.length}`,
		"",
		"### Promised Behavior Cards",
		"",
		...surface.stationMap.stations.flatMap((station) => [
			...renderStationCard(station),
			"",
		]),
		"",
	];
}

function renderStationCard(station: StationMapStation): string[] {
	return [
		`### \`${station.station_id}\``,
		"",
		`- Command: \`${station.command}\``,
		`- Intent: \`${station.intent}\``,
		`- Classification: \`${station.classification}\``,
		`- Trigger: ${station.trigger}`,
		`- Mutation: \`${station.mutation_expectation}\``,
		`- Expected: ${renderExpected(station)}`,
		`- Proof state: \`${station.evidence.status}\``,
		`- Do next: ${repairHint(station)}`,
	];
}

function renderExpected(station: StationMapStation): string {
	const fields = [
		station.expected.exit_code === undefined
			? null
			: `exit ${station.expected.exit_code}`,
		station.expected.envelope_status
			? `envelope ${station.expected.envelope_status}`
			: null,
		station.expected.result_contract_id
			? `result ${station.expected.result_contract_id}`
			: null,
		station.expected.error_code ? `error ${station.expected.error_code}` : null,
		station.expected.action_id ? `action ${station.expected.action_id}` : null,
		station.expected.continuation_id
			? `continuation ${station.expected.continuation_id}`
			: null,
	].filter((field): field is string => Boolean(field));
	return fields.length ? fields.map((field) => `\`${field}\``).join(", ") : "`none`";
}

function repairHint(station: StationMapStation): string {
	if (station.evidence.status === "covered") return "No repair needed.";
	if (station.evidence.status === "drifted") {
		return "Re-run the process-boundary scenario and reconcile expected vs observed result fields.";
	}
	if (station.evidence.status === "skipped") {
		return "Review the skip rationale and either add deterministic evidence or keep the rationale current.";
	}
	if (station.evidence.status === "declared-unreachable") {
		return "Review the unreachable rationale before changing the station contract.";
	}
	return "Add or refresh the process-boundary scenario keyed by this station id.";
}

function nextValue<T extends string>(values: readonly T[], current: T): T {
	return values[(values.indexOf(current) + 1) % values.length] ?? values[0];
}

function wrapIndex(index: number, length: number): number {
	if (length <= 0) return 0;
	return ((index % length) + length) % length;
}

function escapeMarkdownCell(value: string): string {
	return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
