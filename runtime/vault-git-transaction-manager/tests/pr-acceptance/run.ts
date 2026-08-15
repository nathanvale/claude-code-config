import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	VAULT_GIT_PR_ACCEPTANCE_WORKFLOWS,
	extractJUnitTestNames,
	validateVaultGitPrAcceptanceManifest,
	validateVaultGitPrAcceptanceSources,
	vaultGitPrAcceptancePattern,
} from "./manifest.ts";

const packageRoot = resolve(import.meta.dir, "../..");
const receiptRoot = await mkdtemp(join(tmpdir(), "vault-git-pr-acceptance-"));
const results: {
	readonly id: string;
	readonly expectedTests: number;
	readonly observedTests: number;
	readonly durationMs: number;
}[] = [];

try {
	const workflows = validateVaultGitPrAcceptanceManifest(
		VAULT_GIT_PR_ACCEPTANCE_WORKFLOWS,
	);
	await validateVaultGitPrAcceptanceSources(packageRoot, workflows);
	for (const workflow of workflows) {
		const receiptPath = join(receiptRoot, `${workflow.id}.xml`);
		const startedAt = performance.now();
		const child = Bun.spawnSync(
			[
				process.execPath,
				"test",
				...workflow.files.map((file) => resolve(packageRoot, file)),
				"-t",
				vaultGitPrAcceptancePattern(workflow),
				"--reporter=junit",
				`--reporter-outfile=${receiptPath}`,
			],
			{ cwd: packageRoot, stdout: "pipe", stderr: "pipe" },
		);
		const durationMs = Math.round(performance.now() - startedAt);
		const receipt = await readFile(receiptPath, "utf8").catch(() => "");
		const observedRows = extractJUnitTestNames(receipt);
		const expectedRows = [...workflow.rows].sort();
		const observedSorted = [...observedRows].sort();
		if (
			child.exitCode !== 0 ||
			JSON.stringify(observedSorted) !== JSON.stringify(expectedRows)
		) {
			process.stderr.write(child.stdout.toString());
			process.stderr.write(child.stderr.toString());
			throw new Error(
				`${workflow.id}: exit=${child.exitCode}; expected=${expectedRows.length}; observed=${observedRows.length}`,
			);
		}
		results.push({
			id: workflow.id,
			expectedTests: expectedRows.length,
			observedTests: observedRows.length,
			durationMs,
		});
	}
	console.info(
		JSON.stringify({
			status: "ok",
			lane: "vault-git-pr-public",
			workflows: results,
			totalTests: results.reduce(
				(total, result) => total + result.observedTests,
				0,
			),
			durationMs: results.reduce(
				(total, result) => total + result.durationMs,
				0,
			),
		}),
	);
} catch (error) {
	console.error(
		JSON.stringify({
			status: "error",
			lane: "vault-git-pr-public",
			completed: results,
			error: error instanceof Error ? error.message : String(error),
		}),
	);
	process.exitCode = 1;
} finally {
	await rm(receiptRoot, { recursive: true, force: true });
}
