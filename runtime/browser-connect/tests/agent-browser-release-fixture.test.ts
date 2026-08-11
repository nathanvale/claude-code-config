import { describe, expect, test } from "bun:test";
import type { AdapterCommandInput } from "../src/adapters/registry.ts";
import { agentBrowserReleaseResult } from "./agent-browser-release-fixture.ts";

const EXPECTED_COMMAND = "/opt/adapters/bin/agent-browser";

function input(
	args: string[],
	command = EXPECTED_COMMAND,
): AdapterCommandInput {
	return { command, args, timeoutMs: 1_000 };
}

describe("agentBrowserReleaseResult", () => {
	test("returns release responses only for exact close and inventory shapes", () => {
		expect(
			agentBrowserReleaseResult(
				EXPECTED_COMMAND,
				input(["--session", "owned-session", "close", "--json"]),
			),
		).toBeDefined();
		expect(
			agentBrowserReleaseResult(
				EXPECTED_COMMAND,
				input(["session", "list", "--json"]),
			),
		).toBeDefined();
	});

	test("falls through for unrelated and near-miss command shapes", () => {
		const nearMisses = [
			["close"],
			["version", "close"],
			["--session", "", "close", "--json"],
			["--session", "owned-session", "close", "--json", "extra"],
			["list"],
			["page", "list"],
			["session", "list", "--json", "extra"],
		];

		for (const args of nearMisses) {
			expect(
				agentBrowserReleaseResult(EXPECTED_COMMAND, input(args)),
			).toBeUndefined();
		}
		expect(
			agentBrowserReleaseResult(
				EXPECTED_COMMAND,
				input(
					["--session", "owned-session", "close", "--json"],
					"/other/agent-browser",
				),
			),
		).toBeUndefined();
	});
});
