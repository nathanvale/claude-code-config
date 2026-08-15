import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** One independently runnable public-process workflow group. @internal */
export interface LiveAcceptanceWorkflow {
	readonly file: string;
	readonly expectedTests: number;
	readonly ownedRows: readonly string[];
}

/** Original mixed live-acceptance file count before latency extraction. @internal */
export const ORIGINAL_LIVE_ACCEPTANCE_ROW_COUNT = 22;

/** Correctness rows retained after the Doctor p95 row moves out. @internal */
export const LIVE_ACCEPTANCE_CORRECTNESS_ROW_COUNT = 21;

/** Latency rows owned only by the dedicated performance lane. @internal */
export const LIVE_ACCEPTANCE_LATENCY_ROWS = [
	{
		name: "Completion foreground stays below two seconds",
		origin: "split_from_mixed_correctness_row",
		sourceRow:
			"public complete durably admits one inspectable worker before returning",
	},
	{
		name: "Doctor foreground p95 stays below one second across cold processes",
		origin: "moved_from_live_acceptance",
		sourceRow:
			"Doctor foreground p95 stays below one second across cold processes",
	},
] as const;

/** Exact workflow set required by the public-process acceptance lane. @internal */
export const LIVE_ACCEPTANCE_WORKFLOWS: readonly LiveAcceptanceWorkflow[] = [
	{
		file: "background-doctor.integration.test.ts",
		expectedTests: 2,
		ownedRows: [
			"Doctor returns local evidence while remote diagnosis continues",
			"twenty Doctors join one diagnostic task",
		],
	},
	{
		file: "completion-lifecycle.integration.test.ts",
		expectedTests: 5,
		ownedRows: [
			"full success closes atomically and preserves unrelated bytes",
			"public complete durably admits one inspectable worker before returning",
			"twenty identical public completions join one task and changed input refuses",
			"stale takeover private launch budget exceeds one Git push timeout",
			"malformed worker acknowledgement fails closed without claiming a remote outage",
		],
	},
	{
		file: "concurrency-recovery.integration.test.ts",
		expectedTests: 4,
		ownedRows: [
			"a parent killed after durable claim leaves one task and one worker on retry",
			"a parent killed after acknowledgement returns the same task and never restarts the worker",
			"restarting completion after worker death keeps one task and one worker",
			"two clones admit exactly one writer and fence the stale generation",
		],
	},
	{
		file: "publication-recovery.integration.test.ts",
		expectedTests: 5,
		ownedRows: [
			"remote main movement stops completion with deliberate replay guidance",
			"failed atomic push remains pending without disturbing unrelated state",
			"lost atomic-push acknowledgement closes through doctor and close-verified",
			"a killed checking phase resumes only through doctor and repair",
			"one-ref-only publication is a host contract breach with no retry",
		],
	},
	{
		file: "host-activation.integration.test.ts",
		expectedTests: 5,
		ownedRows: [
			"fresh HOME and XDG profiles expose identical discovery and refusal policy",
			"atomic capability refusal moves no local or remote ref",
			"an unreachable remote refuses without a hidden local commit",
			"hostile repository and path inputs fail closed without mutation",
			"unadmitted activation refuses every write command",
		],
	},
];

/**
 * Refuse a missing, duplicate, unexpected, or zero-count workflow group.
 *
 * @param workflows - Declared workflow files and their expected test counts.
 * @param discoveredFiles - Integration test files present beside the manifest.
 * @returns The validated manifest in declared execution order.
 * @throws {Error} When declaration and discovery differ.
 * @internal
 */
export function validateLiveAcceptanceManifest(
	workflows: readonly LiveAcceptanceWorkflow[],
	discoveredFiles: readonly string[],
): readonly LiveAcceptanceWorkflow[] {
	const declared = workflows.map(({ file }) => file);
	const duplicates = declared.filter(
		(file, index) => declared.indexOf(file) !== index,
	);
	if (duplicates.length > 0) {
		throw new Error(`duplicate live acceptance groups: ${[...new Set(duplicates)].join(", ")}`);
	}
	for (const workflow of workflows) {
		if (!Number.isSafeInteger(workflow.expectedTests) || workflow.expectedTests <= 0) {
			throw new Error(`non-positive expected test count: ${workflow.file}`);
		}
		if (workflow.ownedRows.length !== workflow.expectedTests) {
			throw new Error(
				`owned row count mismatch: ${workflow.file}; expected=${workflow.expectedTests}; owned=${workflow.ownedRows.length}`,
			);
		}
	}
	const ownedRows = workflows.flatMap(({ ownedRows }) => ownedRows);
	const duplicateRows = ownedRows.filter(
		(row, index) => ownedRows.indexOf(row) !== index,
	);
	if (duplicateRows.length > 0) {
		throw new Error(
			`duplicate live acceptance row ownership: ${[...new Set(duplicateRows)].join(", ")}`,
		);
	}
	if (ownedRows.length !== LIVE_ACCEPTANCE_CORRECTNESS_ROW_COUNT) {
		throw new Error(
			`missing live acceptance row ownership: expected=${LIVE_ACCEPTANCE_CORRECTNESS_ROW_COUNT}; owned=${ownedRows.length}`,
		);
	}
	const expected = [...declared].sort();
	const discovered = [...discoveredFiles].sort();
	if (JSON.stringify(expected) !== JSON.stringify(discovered)) {
		const missing = expected.filter((file) => !discovered.includes(file));
		const unexpected = discovered.filter((file) => !expected.includes(file));
		throw new Error(
			`live acceptance manifest mismatch; missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`,
		);
	}
	return workflows;
}

/** Extract literal Bun test names for manifest-to-source ownership checks. @internal */
export function extractLiteralTestNames(source: string): readonly string[] {
	return [...source.matchAll(/\btest\(\s*"([^"]+)"/gu)].map(
		(match) => match[1] as string,
	);
}

/** Extract JUnit testcase names for manifest-to-run ownership checks. @internal */
export function extractJUnitTestNames(receipt: string): readonly string[] {
	return [...receipt.matchAll(/<testcase\b[^>]*\bname="([^"]+)"/gu)].map(
		(match) => match[1] as string,
	);
}

/** Discover and validate every workflow file adjacent to this manifest. @internal */
export async function loadLiveAcceptanceManifest(): Promise<
	readonly LiveAcceptanceWorkflow[]
> {
	const directory = dirname(fileURLToPath(import.meta.url));
	const discovered = (await readdir(directory)).filter((file) =>
		file.endsWith(".integration.test.ts"),
	);
	return validateLiveAcceptanceManifest(LIVE_ACCEPTANCE_WORKFLOWS, discovered);
}

/** Resolve one manifest entry from the package root. @internal */
export function liveAcceptanceWorkflowPath(
	packageRoot: string,
	workflow: LiveAcceptanceWorkflow,
): string {
	return join(packageRoot, "tests", "live-acceptance", workflow.file);
}
