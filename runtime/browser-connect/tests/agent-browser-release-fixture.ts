import type {
	AdapterCommandInput,
	AdapterCommandResult,
} from "../src/adapters/registry.ts";

/**
 * Return fake agent-browser release responses only for the expected resolved
 * adapter executable. Other commands remain available to the caller's fake.
 *
 * @param expectedCommand - Exact resolved agent-browser executable for the test.
 * @param input - Command offered to the shared release fixture.
 * @returns A release response for the expected adapter, otherwise `undefined`.
 * @internal
 */
export function agentBrowserReleaseResult(
	expectedCommand: string,
	input: AdapterCommandInput,
): AdapterCommandResult | undefined {
	if (input.command !== expectedCommand) return undefined;
	if (input.args.includes("close")) {
		return {
			exitCode: 0,
			stdout: JSON.stringify({ success: true }),
			stderr: "",
		};
	}
	if (input.args.includes("list")) {
		return {
			exitCode: 0,
			stdout: JSON.stringify({ success: true, data: { sessions: [] } }),
			stderr: "",
		};
	}
	return undefined;
}
