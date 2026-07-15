import { fileURLToPath } from "node:url";
import type { BrowserConnectVerifiedEndpoint } from "../model.ts";
import {
	type AdapterCommandResult,
	type AdapterDefinition,
	type AdapterInjection,
	type AdapterPackagePolicy,
	type AdapterProbeResult,
	type AdapterProvenanceResult,
	type AdapterRuntime,
	errorMessage,
	extractVersion,
	isMissingAdapterCommandResult,
	PROBE_TIMEOUT_MS,
	VERSION_READ_TIMEOUT_MS,
} from "./registry.ts";

/**
 * Executable identity for Chrome DevTools MCP. No implicit PATH/latest
 * fallback — provenance resolves this to an absolute path or rejects
 * (`adapter-not-installed`).
 */
export const CHROME_DEVTOOLS_MCP_EXECUTABLE = "chrome-devtools-mcp" as const;

/**
 * Version PINNED in the definition (plan Sources, 2026-07 verified):
 * chrome-devtools-mcp v1.5.0 exposes `--browser-url`/`--ws-endpoint`. A read
 * version that does not match is a not-installed rejection, never a probe.
 */
export const CHROME_DEVTOOLS_MCP_PINNED_VERSION = "1.5.0" as const;

/**
 * Injection flag: chrome-devtools-mcp attaches to a running browser via
 * `--browser-url <http form>` (the mcporter argv pattern).
 */
export const CHROME_DEVTOOLS_MCP_BROWSER_URL_FLAG = "--browser-url" as const;

/**
 * Maintainer-authored installer policy for Chrome DevTools MCP (KTD13).
 *
 * chrome-devtools-mcp 1.5.0 declares NO install-time lifecycle scripts (its
 * genuine lock entry carries no `hasInstallScript`), so it installs correctly
 * with `--ignore-scripts` and is automatically eligible (R29). Its adapter
 * repair installs the adapter executable ONLY — never an adapter-owned
 * browser installer, never Chrome for Testing.
 */
const CHROME_DEVTOOLS_MCP_INSTALL_POLICY: AdapterPackagePolicy = {
	packageName: "chrome-devtools-mcp",
	packageManager: {
		approvedAbsoluteCandidates: [
			"/opt/homebrew/bin/npm",
			"/usr/local/bin/npm",
			"/usr/bin/npm",
		],
	},
	canonicalRegistry: "https://registry.npmjs.org",
	allowedLockOrigins: ["https://registry.npmjs.org"],
	installScope: "user",
	installArgv: ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"],
	integritySource: {
		manifestPath: fileURLToPath(
			new URL("../../adapter-install/chrome-devtools-mcp/package.json", import.meta.url),
		),
		lockfilePath: fileURLToPath(
			new URL(
				"../../adapter-install/chrome-devtools-mcp/package-lock.json",
				import.meta.url,
			),
		),
	},
	lifecycleScriptsRequired: false,
	expectedBin: CHROME_DEVTOOLS_MCP_EXECUTABLE,
	safeUpgradeTransitions: [{ from: "1.4.0", to: CHROME_DEVTOOLS_MCP_PINNED_VERSION }],
	operatorChoice: {
		packageOwner: "chrome-devtools-mcp npm package maintainers",
		docsUrl:
			"https://github.com/nathanvale/claude-code-config/blob/main/runtime/browser-connect/REPAIR.md#v1-install_adapter",
	},
};

/**
 * Adapter Definition for Chrome DevTools MCP (KTD8 — MCP adapter riding the
 * no-shell argv transport). Implemented FIRST; it proved the definition
 * interface before agent-browser validated the seam.
 *
 * - Route: `explicit-cdp` verified-live; `ui-consent` documented (not
 *   implemented) per lesson 0003.
 * - Injection: `--browser-url <http>` argv array.
 * - Probe: read-only invocation through its own executable with the injected
 *   endpoint; browser-connect never probes on its behalf (R4).
 */
export const chromeDevtoolsMcpDefinition = {
	id: "chrome-devtools-mcp",
	displayName: "Chrome DevTools MCP",
	executable: CHROME_DEVTOOLS_MCP_EXECUTABLE,
	pinnedVersion: CHROME_DEVTOOLS_MCP_PINNED_VERSION,
	routes: [
		{ route: "explicit-cdp", evidence: "verified-live", implemented: true },
		{ route: "ui-consent", evidence: "documented", implemented: false },
	],
	installPolicy: CHROME_DEVTOOLS_MCP_INSTALL_POLICY,

	async checkProvenance(runtime: AdapterRuntime): Promise<AdapterProvenanceResult> {
		const resolution = await runtime.resolveExecutable(
			CHROME_DEVTOOLS_MCP_EXECUTABLE,
		);
		if (!resolution.resolved) {
			return {
				installed: false,
				failureClass: "adapter-not-installed",
				cause: "executable_absent",
				detail: `${CHROME_DEVTOOLS_MCP_EXECUTABLE} could not be resolved to an absolute path (no PATH/latest fallback).`,
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
				cause: "executable_absent",
				detail: `${CHROME_DEVTOOLS_MCP_EXECUTABLE} could not be started to read its version.`,
			};
		}
		if (result.timedOut || isMissingAdapterCommandResult(result)) {
			return {
				installed: false,
				failureClass: "adapter-not-installed",
				cause: "executable_absent",
				detail: `${CHROME_DEVTOOLS_MCP_EXECUTABLE} version read failed (binary missing or unresponsive).`,
			};
		}

		const version = extractVersion(result.stdout, result.stderr);
		if (version !== CHROME_DEVTOOLS_MCP_PINNED_VERSION) {
			return {
				installed: false,
				failureClass: "adapter-not-installed",
				cause: "version_mismatch",
				...(version === undefined ? {} : { observedVersion: version }),
				detail: `${CHROME_DEVTOOLS_MCP_EXECUTABLE} version ${version ?? "unreadable"} does not match pinned ${CHROME_DEVTOOLS_MCP_PINNED_VERSION}.`,
			};
		}
		return { installed: true, executablePath: resolution.path, version };
	},

	inject(endpoint: BrowserConnectVerifiedEndpoint): AdapterInjection {
		return {
			argv: [CHROME_DEVTOOLS_MCP_BROWSER_URL_FLAG, endpoint.http],
		};
	},

	async probeAttachment(
		runtime: AdapterRuntime,
		endpoint: BrowserConnectVerifiedEndpoint,
		route,
	): Promise<AdapterProbeResult> {
		const resolution = await runtime.resolveExecutable(
			CHROME_DEVTOOLS_MCP_EXECUTABLE,
		);
		if (!resolution.resolved) {
			return {
				attached: false,
				failureClass: "attachment-failed",
				cause: "probe_failed",
				detail: `${CHROME_DEVTOOLS_MCP_EXECUTABLE} could not be resolved for the attachment probe.`,
			};
		}
		const injection = this.inject(endpoint);
		let result: AdapterCommandResult;
		try {
			result = await runtime.runCommand({
				command: resolution.path,
				// Read-only invocation: attach via injected endpoint and list tabs
				// (no navigation, no mutation) through the adapter's own entrypoint.
				args: [...injection.argv, "--list-tabs"],
				timeoutMs: PROBE_TIMEOUT_MS,
			});
		} catch (error) {
			return {
				attached: false,
				failureClass: "attachment-failed",
				cause: "transient_probe_failure",
				detail: `${CHROME_DEVTOOLS_MCP_EXECUTABLE} attachment probe did not start: ${errorMessage(error)}.`,
			};
		}
		if (result.timedOut) {
			return {
				attached: false,
				failureClass: "attachment-failed",
				cause: "transient_probe_failure",
				detail: `${CHROME_DEVTOOLS_MCP_EXECUTABLE} attachment probe timed out.`,
			};
		}
		if (result.exitCode !== 0) {
			return {
				attached: false,
				failureClass: "attachment-failed",
				cause: "probe_failed",
				detail: `${CHROME_DEVTOOLS_MCP_EXECUTABLE} attachment probe exited ${result.exitCode}.`,
			};
		}
		return {
			attached: true,
			attachment: {
				adapter_id: "chrome-devtools-mcp",
				route,
				probe_executable: resolution.path,
			},
			evidence: `${CHROME_DEVTOOLS_MCP_EXECUTABLE} attached and read tab list read-only.`,
		};
	},
} as const satisfies AdapterDefinition;
