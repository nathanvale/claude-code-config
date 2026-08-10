import type {
	TransportCommandInput,
	TransportCommandResult,
} from "@side-quest/mcporter-transport";

const AGENT_BROWSER_SESSION_RELEASE_TIMEOUT_MS = 30_000;

/**
 * Minimal no-shell runtime needed to release one Agent Browser session.
 */
export type AgentBrowserSessionRuntime = {
	runCommand(input: TransportCommandInput): Promise<TransportCommandResult>;
};

/**
 * Typed result for one adapter-native Agent Browser session release.
 */
export type AgentBrowserSessionReleaseResult =
	| { released: true }
	| {
			released: false;
			reason: "command-failed" | "invalid-response";
	  };

/**
 * Release one named Agent Browser daemon without closing its external CDP browser.
 *
 * Agent Browser 0.31.2 owns this mechanic. Its session-scoped `close` disconnects
 * an external `--cdp` browser safely, but the release invocation must omit
 * `--cdp` so it cannot create a replacement attachment while shutting down.
 *
 * @param runtime - Bounded no-shell command runner
 * @param input - Pinned executable path and caller-owned exact session name
 * @returns Typed release truth with no adapter output
 */
export async function releaseAgentBrowserSession(
	runtime: AgentBrowserSessionRuntime,
	input: Readonly<{ executablePath: string; sessionName: string }>,
): Promise<AgentBrowserSessionReleaseResult> {
	let result: TransportCommandResult;
	try {
		result = await runtime.runCommand({
			command: input.executablePath,
			args: ["--session", input.sessionName, "close", "--json"],
			timeoutMs: AGENT_BROWSER_SESSION_RELEASE_TIMEOUT_MS,
		});
	} catch {
		return { released: false, reason: "command-failed" };
	}
	if (result.exitCode !== 0 || result.timedOut === true) {
		return { released: false, reason: "command-failed" };
	}
	try {
		const envelope = JSON.parse(result.stdout) as { success?: unknown };
		return envelope.success === true
			? { released: true }
			: { released: false, reason: "invalid-response" };
	} catch {
		return { released: false, reason: "invalid-response" };
	}
}
