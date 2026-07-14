import type { BrowserConnectVerifiedEndpoint } from "../../src/model.ts";
import {
	type AdapterCommandResult,
	type AdapterDefinition,
	type AdapterInjection,
	type AdapterProbeResult,
	type AdapterProvenanceResult,
	type AdapterRuntime,
	isMissingAdapterCommandResult,
} from "./registry.ts";

/**
 * Executable identity for agent-browser. No implicit PATH/latest fallback —
 * provenance resolves this to an absolute path or rejects.
 */
export const AGENT_BROWSER_EXECUTABLE = "agent-browser" as const;

/**
 * Version PINNED in the definition (plan Sources, 2026-07 verified):
 * agent-browser v0.31.2 exposes `--cdp <port|url>` / `AGENT_BROWSER_CDP`.
 */
export const AGENT_BROWSER_PINNED_VERSION = "0.31.2" as const;

/**
 * Injection flag: agent-browser attaches via `--cdp <ws form>`.
 */
export const AGENT_BROWSER_CDP_FLAG = "--cdp" as const;

/**
 * Injection env channel: alternative to `--cdp`, agent-browser reads the CDP
 * endpoint from `AGENT_BROWSER_CDP`.
 */
export const AGENT_BROWSER_CDP_ENV_VAR = "AGENT_BROWSER_CDP" as const;

const VERSION_READ_TIMEOUT_MS = 8000;
const PROBE_TIMEOUT_MS = 8000;

/**
 * Adapter Definition for agent-browser (KTD9 — a plain binary invocation, a
 * non-MCP shape that forces the Adapter Definition interface to be honest
 * across two genuinely different invocation models). Validated the seam AFTER
 * chrome-devtools-mcp proved the interface.
 *
 * - Route: `explicit-cdp` verified-live only.
 * - Injection: `--cdp <ws>` argv array. (`AGENT_BROWSER_CDP` is the documented
 *   env alternative; slice one injects the explicit flag for determinism.)
 * - Probe: read-only invocation through its own binary with the injected
 *   endpoint (R4).
 */
export const agentBrowserDefinition = {
	id: "agent-browser",
	displayName: "agent-browser",
	executable: AGENT_BROWSER_EXECUTABLE,
	pinnedVersion: AGENT_BROWSER_PINNED_VERSION,
	routes: [
		{ route: "explicit-cdp", evidence: "verified-live", implemented: true },
	],

	async checkProvenance(runtime: AdapterRuntime): Promise<AdapterProvenanceResult> {
		const resolution = await runtime.resolveExecutable(AGENT_BROWSER_EXECUTABLE);
		if (!resolution.resolved) {
			return {
				installed: false,
				failureClass: "adapter-not-installed",
				detail: `${AGENT_BROWSER_EXECUTABLE} could not be resolved to an absolute path (no PATH/latest fallback).`,
			};
		}

		let result: AdapterCommandResult;
		try {
			result = await runtime.runCommand({
				command: resolution.path,
				args: ["--version"],
				timeoutMs: VERSION_READ_TIMEOUT_MS,
			});
		} catch {
			return {
				installed: false,
				failureClass: "adapter-not-installed",
				detail: `${AGENT_BROWSER_EXECUTABLE} could not be started to read its version.`,
			};
		}
		if (result.timedOut || isMissingAdapterCommandResult(result)) {
			return {
				installed: false,
				failureClass: "adapter-not-installed",
				detail: `${AGENT_BROWSER_EXECUTABLE} version read failed (binary missing or unresponsive).`,
			};
		}

		const version = extractVersion(result.stdout, result.stderr);
		if (version !== AGENT_BROWSER_PINNED_VERSION) {
			return {
				installed: false,
				failureClass: "adapter-not-installed",
				detail: `${AGENT_BROWSER_EXECUTABLE} version ${version ?? "unreadable"} does not match pinned ${AGENT_BROWSER_PINNED_VERSION}.`,
			};
		}
		return { installed: true, executablePath: resolution.path, version };
	},

	inject(endpoint: BrowserConnectVerifiedEndpoint): AdapterInjection {
		return {
			argv: [AGENT_BROWSER_CDP_FLAG, endpoint.ws],
		};
	},

	async probeAttachment(
		runtime: AdapterRuntime,
		endpoint: BrowserConnectVerifiedEndpoint,
		route,
	): Promise<AdapterProbeResult> {
		const resolution = await runtime.resolveExecutable(AGENT_BROWSER_EXECUTABLE);
		if (!resolution.resolved) {
			return {
				attached: false,
				failureClass: "attachment-failed",
				detail: `${AGENT_BROWSER_EXECUTABLE} could not be resolved for the attachment probe.`,
			};
		}
		const injection = this.inject(endpoint);
		let result: AdapterCommandResult;
		try {
			result = await runtime.runCommand({
				command: resolution.path,
				// Read-only invocation: attach via injected endpoint and snapshot
				// (no navigation, no mutation) through the adapter's own binary.
				args: [...injection.argv, "snapshot"],
				timeoutMs: PROBE_TIMEOUT_MS,
			});
		} catch (error) {
			return {
				attached: false,
				failureClass: "attachment-failed",
				detail: `${AGENT_BROWSER_EXECUTABLE} attachment probe did not start: ${errorMessage(error)}.`,
			};
		}
		if (result.timedOut) {
			return {
				attached: false,
				failureClass: "attachment-failed",
				detail: `${AGENT_BROWSER_EXECUTABLE} attachment probe timed out.`,
			};
		}
		if (result.exitCode !== 0) {
			return {
				attached: false,
				failureClass: "attachment-failed",
				detail: `${AGENT_BROWSER_EXECUTABLE} attachment probe exited ${result.exitCode}.`,
			};
		}
		return {
			attached: true,
			attachment: {
				adapter_id: "agent-browser",
				route,
				probe_executable: resolution.path,
			},
			evidence: `${AGENT_BROWSER_EXECUTABLE} attached and snapshotted read-only.`,
		};
	},
} as const satisfies AdapterDefinition;

/**
 * Extract a semantic version from adapter `--version` output.
 */
function extractVersion(stdout: string, stderr: string): string | undefined {
	const match = `${stdout}\n${stderr}`.match(/\b(\d+\.\d+\.\d+)\b/);
	return match?.[1];
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error ?? "unknown");
}
