import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** One bounded public-process group owned by the hosted pull-request gate. @internal */
export interface VaultGitPrAcceptanceWorkflow {
	readonly id: string;
	readonly files: readonly string[];
	readonly rows: readonly string[];
}

/** Exact public canaries retained on every hosted pull request. @internal */
export const VAULT_GIT_PR_ACCEPTANCE_WORKFLOWS = [
	{
		id: "unique-public-refusals-and-repair",
		files: [
			"tests/smoke/main-ahead.integration.test.ts",
			"tests/smoke/stale-writer.integration.test.ts",
			"tests/smoke/crash-resume.integration.test.ts",
		],
		rows: [
			"public begin changes no private transaction or remote state",
			"an already-running stale writer is quarantined before commit or push",
			"a transaction left writing is diagnosed as writes_in_progress",
		],
	},
	{
		id: "bounded-repair-reentry",
		files: ["tests/pr-acceptance/repair-reentry.integration.test.ts"],
		rows: ["two repaired callers re-enter one task and publish once"],
	},
	{
		id: "atomic-success",
		files: ["tests/live-acceptance/completion-lifecycle.integration.test.ts"],
		rows: ["full success closes atomically and preserves unrelated bytes"],
	},
] as const satisfies readonly VaultGitPrAcceptanceWorkflow[];

/** Exact bounded public-process count expected from the hosted pull-request gate. */
export const VAULT_GIT_PR_ACCEPTANCE_ROW_COUNT = 5;

/** Reject missing, duplicate, empty, or ambiguous pull-request ownership. @internal */
export function validateVaultGitPrAcceptanceManifest(
	workflows: readonly VaultGitPrAcceptanceWorkflow[],
): readonly VaultGitPrAcceptanceWorkflow[] {
	if (workflows.length === 0) throw new Error("empty PR acceptance manifest");
	const ids = workflows.map(({ id }) => id);
	const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
	if (duplicateIds.length > 0) {
		throw new Error(`duplicate PR acceptance workflow: ${duplicateIds[0]}`);
	}
	for (const workflow of workflows) {
		if (workflow.files.length === 0 || workflow.rows.length === 0) {
			throw new Error(`empty PR acceptance workflow: ${workflow.id}`);
		}
	}
	const rows = workflows.flatMap(({ rows: ownedRows }) => ownedRows);
	const duplicateRows = rows.filter((row, index) => rows.indexOf(row) !== index);
	if (duplicateRows.length > 0) {
		throw new Error(`duplicate PR acceptance row: ${duplicateRows[0]}`);
	}
	if (rows.length !== VAULT_GIT_PR_ACCEPTANCE_ROW_COUNT) {
		throw new Error(
			`PR acceptance row count mismatch: expected=${VAULT_GIT_PR_ACCEPTANCE_ROW_COUNT}; actual=${rows.length}`,
		);
	}
	return workflows;
}

/** Build a Bun test-name pattern that is later checked against exact JUnit rows. @internal */
export function vaultGitPrAcceptancePattern(
	workflow: VaultGitPrAcceptanceWorkflow,
): string {
	return workflow.rows.map(escapeRegularExpression).join("|");
}

/** Extract literal Bun test names for manifest-to-source ownership checks. @internal */
export function extractLiteralTestNames(source: string): readonly string[] {
	return [...source.matchAll(/\btest\(\s*"([^"]+)"/gu)].map(
		(match) => match[1] as string,
	);
}

/** Extract exact executed row names while excluding Bun's filtered JUnit cases. @internal */
export function extractJUnitTestNames(receipt: string): readonly string[] {
	const names: string[] = [];
	for (const match of receipt.matchAll(
		/<testcase\b([^>]*)\/>|<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/gu,
	)) {
		if (match[3]?.includes("<skipped")) continue;
		const attributes = match[1] ?? match[2] ?? "";
		const name = attributes.match(/\bname="([^"]+)"/u)?.[1];
		if (name) names.push(name);
	}
	return names;
}

/** Prove every declared row exists literally in one and only one owned source file. @internal */
export async function validateVaultGitPrAcceptanceSources(
	packageRoot: string,
	workflows: readonly VaultGitPrAcceptanceWorkflow[],
): Promise<void> {
	for (const workflow of workflows) {
		const sourceRows = (
			await Promise.all(
				workflow.files.map(async (file) => {
					const source = await readFile(resolve(packageRoot, file), "utf8");
					return extractLiteralTestNames(source);
				}),
			)
		).flat();
		for (const row of workflow.rows) {
			if (sourceRows.filter((candidate) => candidate === row).length !== 1) {
				throw new Error(`PR acceptance row owner mismatch: ${row}`);
			}
		}
	}
}

function escapeRegularExpression(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
