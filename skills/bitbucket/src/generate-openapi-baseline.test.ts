import { describe, expect, test } from "bun:test";

import { runGeneratorCli } from "./generate-openapi-baseline";

describe("OpenAPI baseline generator CLI", () => {
	test("emits a structured failure envelope and exits nonzero", async () => {
		const output: string[] = [];
		const exitCode = await runGeneratorCli(
			async () => {
				throw new Error("network unavailable");
			},
			(text) => output.push(text),
		);

		expect(exitCode).toBe(1);
		expect(JSON.parse(output[0])).toEqual({
			status: "error",
			changed_state: "none",
			message: "network unavailable",
			next_safe_action: "Check network access to the Bitbucket OpenAPI URL, then rerun the generator.",
		});
	});
});
