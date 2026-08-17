import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { BrowserConnectVerifiedEndpoint } from "../model.ts";
import {
	type AdapterCommandResult,
	type AdapterDefinition,
	type AdapterInjection,
	type AdapterPackagePolicy,
	type AdapterProbeResult,
	type AdapterProvenanceResult,
	type AdapterReleaseResult,
	type AdapterRuntime,
	errorMessage,
	extractVersion,
	isMissingAdapterCommandResult,
	PROBE_TIMEOUT_MS,
	RELEASE_TIMEOUT_MS,
	VERSION_READ_TIMEOUT_MS,
} from "./registry.ts";

/**
 * Executable identity for agent-browser. No implicit PATH/latest fallback —
 * provenance resolves this to an absolute path or rejects.
 */
export const AGENT_BROWSER_EXECUTABLE = "agent-browser" as const;

/**
 * Version PINNED in the definition (2026-08-17 verified): agent-browser
 * v0.34.0 exposes `--cdp <port|url>` / `AGENT_BROWSER_CDP`.
 */
export const AGENT_BROWSER_PINNED_VERSION = "0.34.0" as const;

/**
 * Maintainer-authored installer policy for agent-browser (KTD13).
 *
 * agent-browser 0.34.0 declares a `postinstall` lifecycle script that stages
 * its platform-native binary (its genuine lock entry carries
 * `hasInstallScript: true`), so it CANNOT install correctly with lifecycle
 * scripts disabled: `lifecycleScriptsRequired: true` keeps package automation
 * operator-owned (R29; plan: a package that cannot install with lifecycle
 * scripts disabled stays operator-owned). The source manifest and generated
 * lockfile are still committed as the trusted integrity and lifecycle
 * evidence behind that claim.
 *
 * The safe-upgrade allowlist entry (0.31.2 -> 0.34.0, AE5) records the
 * transition proven through agent-browser's official upgrade path; automatic
 * upgrade additionally requires the full isolated-install evidence, which the
 * lifecycle gate withholds.
 */
const AGENT_BROWSER_INSTALL_POLICY: AdapterPackagePolicy = {
	packageName: "agent-browser",
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
			new URL("../../adapter-install/agent-browser/package.json", import.meta.url),
		),
		lockfilePath: fileURLToPath(
			new URL("../../adapter-install/agent-browser/package-lock.json", import.meta.url),
		),
	},
	lifecycleScriptsRequired: true,
	expectedBin: AGENT_BROWSER_EXECUTABLE,
	safeUpgradeTransitions: [{ from: "0.31.2", to: AGENT_BROWSER_PINNED_VERSION }],
	operatorChoice: {
		packageOwner: "agent-browser npm package maintainers",
		docsUrl:
			"https://github.com/nathanvale/claude-code-config/blob/main/runtime/browser-connect/REPAIR.md#v1-install_adapter",
	},
};

/**
 * Injection flag: agent-browser attaches via `--cdp <ws form>`.
 */
export const AGENT_BROWSER_CDP_FLAG = "--cdp" as const;

/**
 * Injection env channel: alternative to `--cdp`, agent-browser reads the CDP
 * endpoint from `AGENT_BROWSER_CDP`.
 */
export const AGENT_BROWSER_CDP_ENV_VAR = "AGENT_BROWSER_CDP" as const;

/** Fixed prefix for agent-browser attachment probe sessions. */
export const AGENT_BROWSER_PROBE_SESSION_PREFIX =
	"browser-connect-agent-browser-probe" as const;

/** Derive a unique, recognizable session name for one attachment probe. */
export function deriveProbeSessionName(): string {
	return `${AGENT_BROWSER_PROBE_SESSION_PREFIX}-${process.pid}-${randomBytes(4).toString("hex")}`;
}

const RELEASE_VERIFY_ATTEMPTS = 6;
const RELEASE_VERIFY_DELAY_MS = 1000;

function waitForReleaseRetry(
	runtime: AdapterRuntime,
	delayMs: number,
): Promise<void> {
	if (runtime.wait) return runtime.wait(delayMs);
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function releaseDeadlineExceeded(
	inventoryReads: number,
	sessionName: string,
): AdapterReleaseResult {
	if (inventoryReads === 0) {
		return {
			released: false,
			cause: "command-failed",
			detail: `${AGENT_BROWSER_EXECUTABLE} release deadline expired before session inventory verification.`,
		};
	}
	return {
		released: false,
		cause: "still-present",
		detail: `${AGENT_BROWSER_EXECUTABLE} session ${sessionName} remains present after ${inventoryReads} inventory reads; the ${RELEASE_TIMEOUT_MS}ms release deadline is exhausted.`,
	};
}

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
	installPolicy: AGENT_BROWSER_INSTALL_POLICY,

	async checkProvenance(runtime: AdapterRuntime): Promise<AdapterProvenanceResult> {
		const resolution = await runtime.resolveExecutable(AGENT_BROWSER_EXECUTABLE);
		if (!resolution.resolved) {
			return {
				installed: false,
				failureClass: "adapter-not-installed",
				cause: "executable_absent",
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
				cause: "executable_absent",
				detail: `${AGENT_BROWSER_EXECUTABLE} could not be started to read its version.`,
			};
		}
		if (result.timedOut || isMissingAdapterCommandResult(result)) {
			return {
				installed: false,
				failureClass: "adapter-not-installed",
				cause: "executable_absent",
				detail: `${AGENT_BROWSER_EXECUTABLE} version read failed (binary missing or unresponsive).`,
			};
		}

		const version = extractVersion(result.stdout, result.stderr);
		if (version !== AGENT_BROWSER_PINNED_VERSION) {
			return {
				installed: false,
				failureClass: "adapter-not-installed",
				cause: "version_mismatch",
				...(version === undefined ? {} : { observedVersion: version }),
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
				cause: "probe_failed",
				detail: `${AGENT_BROWSER_EXECUTABLE} could not be resolved for the attachment probe.`,
			};
		}
		const injection = this.inject(endpoint);
		const sessionName = deriveProbeSessionName();
		let probeResult: AdapterProbeResult;
		try {
			const result = await runtime.runCommand({
				command: resolution.path,
				// Connection-only invocation: prove the injected CDP endpoint through
				// the adapter's own binary without binding or creating a page target.
				args: [
					...injection.argv,
					"--session",
					sessionName,
					"get",
					"cdp-url",
				],
				timeoutMs: PROBE_TIMEOUT_MS,
			});
			if (result.timedOut) {
				probeResult = {
					attached: false,
					failureClass: "attachment-failed",
					cause: "transient_probe_failure",
					detail: `${AGENT_BROWSER_EXECUTABLE} attachment probe timed out.`,
				};
			} else if (result.exitCode !== 0) {
				probeResult = {
					attached: false,
					failureClass: "attachment-failed",
					cause: "probe_failed",
					detail: `${AGENT_BROWSER_EXECUTABLE} attachment probe exited ${result.exitCode}.`,
				};
			} else {
				probeResult = {
					attached: true,
					attachment: {
						adapter_id: "agent-browser",
						route,
						probe_executable: resolution.path,
					},
					evidence: `${AGENT_BROWSER_EXECUTABLE} attached and returned its CDP endpoint without binding a page target.`,
				};
			}
		} catch (error) {
			probeResult = {
				attached: false,
				failureClass: "attachment-failed",
				cause: "transient_probe_failure",
				detail: `${AGENT_BROWSER_EXECUTABLE} attachment probe did not start: ${errorMessage(error)}.`,
			};
		}

		const releaseSession = this.releaseSession;
		if (!releaseSession) {
			return {
				attached: false,
				failureClass: "attachment-failed",
				cause: "probe_failed",
				detail: `${AGENT_BROWSER_EXECUTABLE} attachment probe session release mechanic is unavailable.`,
			};
		}
		const release = await releaseSession(runtime, { sessionName });
		if (probeResult.attached && !release.released) {
			return {
				attached: false,
				failureClass: "attachment-failed",
				cause: "probe_failed",
				detail: `${AGENT_BROWSER_EXECUTABLE} attachment probe session release failed: ${release.detail}`,
			};
		}
		return probeResult;
	},

	async releaseSession(
		runtime: AdapterRuntime,
		input: Readonly<{ sessionName: string }>,
	): Promise<AdapterReleaseResult> {
		const resolution = await runtime.resolveExecutable(AGENT_BROWSER_EXECUTABLE);
		if (!resolution.resolved) {
			return {
				released: false,
				cause: "command-failed",
				detail: `${AGENT_BROWSER_EXECUTABLE} could not be resolved for session release.`,
			};
		}
		const now = runtime.now ?? Date.now;
		const releaseDeadlineMs = now() + RELEASE_TIMEOUT_MS;
		const remainingReleaseTimeMs = (): number =>
			Math.max(
				0,
				Math.min(RELEASE_TIMEOUT_MS, releaseDeadlineMs - now()),
			);

		let close: AdapterCommandResult;
		try {
			close = await runtime.runCommand({
				command: resolution.path,
				args: ["--session", input.sessionName, "close", "--json"],
				env: { MCPORTER_NO_KEEPALIVE: "*" },
				timeoutMs: RELEASE_TIMEOUT_MS,
			});
		} catch (error) {
			return {
				released: false,
				cause: "command-failed",
				detail: `${AGENT_BROWSER_EXECUTABLE} session close did not start: ${errorMessage(error)}.`,
			};
		}
		if (close.timedOut) {
			return {
				released: false,
				cause: "command-failed",
				detail: `${AGENT_BROWSER_EXECUTABLE} session close timed out.`,
			};
		}
		if (close.exitCode !== 0) {
			return {
				released: false,
				cause: "command-failed",
				detail: `${AGENT_BROWSER_EXECUTABLE} session close exited ${close.exitCode}.`,
			};
		}
		try {
			const envelope = JSON.parse(close.stdout) as { success?: unknown };
			if (envelope.success !== true) {
				return {
					released: false,
					cause: "invalid-response",
					detail: `${AGENT_BROWSER_EXECUTABLE} session close returned an invalid success envelope.`,
				};
			}
		} catch {
			return {
				released: false,
				cause: "invalid-response",
				detail: `${AGENT_BROWSER_EXECUTABLE} session close returned unparseable output.`,
			};
		}

		let inventoryReads = 0;
		for (let attempt = 0; attempt < RELEASE_VERIFY_ATTEMPTS; attempt += 1) {
			const inventoryTimeoutMs = remainingReleaseTimeMs();
			if (inventoryTimeoutMs <= 0) {
				return releaseDeadlineExceeded(inventoryReads, input.sessionName);
			}
			let inventory: AdapterCommandResult;
			try {
				inventory = await runtime.runCommand({
					command: resolution.path,
					args: ["session", "list", "--json"],
					env: { MCPORTER_NO_KEEPALIVE: "*" },
					timeoutMs: inventoryTimeoutMs,
				});
			} catch (error) {
				return {
					released: false,
					cause: "command-failed",
					detail: `${AGENT_BROWSER_EXECUTABLE} session inventory did not start: ${errorMessage(error)}.`,
				};
			}
			if (inventory.timedOut || inventory.exitCode !== 0) {
				return {
					released: false,
					cause: "command-failed",
					detail: inventory.timedOut
						? `${AGENT_BROWSER_EXECUTABLE} session inventory timed out.`
						: `${AGENT_BROWSER_EXECUTABLE} session inventory exited ${inventory.exitCode}.`,
				};
			}
			inventoryReads += 1;
			try {
				const envelope = JSON.parse(inventory.stdout) as {
					success?: unknown;
					data?: { sessions?: unknown };
				};
				if (
					envelope.success !== true ||
					!Array.isArray(envelope.data?.sessions) ||
					!envelope.data.sessions.every((name) => typeof name === "string")
				) {
					return {
						released: false,
						cause: "invalid-response",
						detail: `${AGENT_BROWSER_EXECUTABLE} session inventory returned an invalid response.`,
					};
				}
				if (!envelope.data.sessions.includes(input.sessionName)) {
					return { released: true };
				}
			} catch {
				return {
					released: false,
					cause: "invalid-response",
					detail: `${AGENT_BROWSER_EXECUTABLE} session inventory returned unparseable output.`,
				};
			}
			if (attempt + 1 < RELEASE_VERIFY_ATTEMPTS) {
				const remainingTimeMs = remainingReleaseTimeMs();
				if (remainingTimeMs <= 0) {
					return releaseDeadlineExceeded(inventoryReads, input.sessionName);
				}
				await waitForReleaseRetry(
					runtime,
					Math.min(RELEASE_VERIFY_DELAY_MS, remainingTimeMs),
				);
			}
		}
		return {
			released: false,
			cause: "still-present",
			detail: `${AGENT_BROWSER_EXECUTABLE} session ${input.sessionName} remains present after ${RELEASE_VERIFY_ATTEMPTS} inventory reads.`,
		};
	},
} as const satisfies AdapterDefinition;
