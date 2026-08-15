import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	extractJUnitTestNames,
	liveAcceptanceWorkflowPath,
	loadLiveAcceptanceManifest,
} from "./manifest.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const receiptRoot = await mkdtemp(join(tmpdir(), "vault-git-live-acceptance-"));
const results: {
	file: string;
	expected_tests: number;
	observed_tests: number;
	duration_ms: number;
}[] = [];

try {
	for (const workflow of await loadLiveAcceptanceManifest()) {
		const receiptPath = join(receiptRoot, `${workflow.file}.xml`);
		const startedAt = performance.now();
		const child = Bun.spawnSync(
			[
				process.execPath,
				"test",
				liveAcceptanceWorkflowPath(packageRoot, workflow),
				"--reporter=junit",
				`--reporter-outfile=${receiptPath}`,
			],
			{ cwd: packageRoot, stdout: "pipe", stderr: "pipe" },
		);
		const durationMs = performance.now() - startedAt;
		const receipt = await readFile(receiptPath, "utf8").catch(() => "");
		const reportedTests = Number(
			receipt.match(/\btests="(\d+)"/u)?.[1] ?? "-1",
		);
		const observedRows = extractJUnitTestNames(receipt);
		const observedTests = observedRows.length;
		const ownershipMatches =
			JSON.stringify([...observedRows].sort()) ===
			JSON.stringify([...workflow.ownedRows].sort());
		if (
			child.exitCode !== 0 ||
			reportedTests !== workflow.expectedTests ||
			observedTests !== workflow.expectedTests ||
			!ownershipMatches
		) {
			process.stderr.write(child.stdout.toString());
			process.stderr.write(child.stderr.toString());
			throw new Error(
				`${workflow.file}: exit=${child.exitCode}; expected=${workflow.expectedTests}; reported=${reportedTests}; observed=${observedTests}; ownership=${ownershipMatches}`,
			);
		}
		results.push({
			file: workflow.file,
			expected_tests: workflow.expectedTests,
			observed_tests: observedTests,
			duration_ms: Math.round(durationMs),
		});
	}
	console.info(
		JSON.stringify({
			status: "ok",
			lane: "live-acceptance",
			files: results,
			total_tests: results.reduce(
				(total, result) => total + result.observed_tests,
				0,
			),
			duration_ms: results.reduce(
				(total, result) => total + result.duration_ms,
				0,
			),
		}),
	);
} catch (error) {
	console.error(
		JSON.stringify({
			status: "error",
			lane: "live-acceptance",
			completed: results,
			error: error instanceof Error ? error.message : String(error),
		}),
	);
	process.exitCode = 1;
} finally {
	await rm(receiptRoot, { recursive: true, force: true });
}
