#!/usr/bin/env bun

import { createHash, randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { BITBUCKET_OPENAPI_URL, buildOpenApiBaseline } from "./openapi-drift";

const defaultOutputPath = fileURLToPath(new URL("../openapi-baseline.json", import.meta.url));

/** Atomically replace a generated baseline while preserving the prior file on failure. */
export async function writeBaselineAtomically(
	outputPath: string,
	content: string,
	overrides: { renameFile?: typeof rename; unlinkFile?: typeof unlink; temporaryPath?: string } = {},
): Promise<void> {
	const temporaryPath = overrides.temporaryPath ?? `${outputPath}.tmp-${randomUUID()}`;
	try {
		const handle = await open(temporaryPath, "wx", 0o600);
		try {
			await handle.writeFile(content, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		JSON.parse(await Bun.file(temporaryPath).text());
		await (overrides.renameFile ?? rename)(temporaryPath, outputPath);
	} catch (error) {
		await (overrides.unlinkFile ?? unlink)(temporaryPath).catch(() => undefined);
		throw error;
	}
}

/** Fetch, normalize, and atomically persist the canonical Bitbucket baseline. */
export async function generateOpenApiBaseline(fetcher: typeof fetch = fetch, outputPath = defaultOutputPath): Promise<Record<string, unknown>> {
	const response = await fetcher(BITBUCKET_OPENAPI_URL, { signal: AbortSignal.timeout(30_000) });
	if (!response.ok) throw new Error(`Bitbucket OpenAPI request failed with HTTP ${response.status}.`);
	const baseline = buildOpenApiBaseline(await response.json());
	const content = `${JSON.stringify(baseline, null, 2)}\n`;
	await writeBaselineAtomically(outputPath, content);
	return {
		status: "ok",
		changed_state: "complete",
		output: outputPath,
		operations: Object.keys(baseline.operations).length,
		digest: createHash("sha256").update(content).digest("hex"),
		next_safe_action: "Review the generated semantic baseline, then run bb-pr doctor openapi.",
	};
}

if (import.meta.main) console.log(JSON.stringify(await generateOpenApiBaseline()));
