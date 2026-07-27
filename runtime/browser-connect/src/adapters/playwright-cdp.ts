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
	type AdapterRuntime,
	errorMessage,
	extractVersion,
	isMissingAdapterCommandResult,
	PROBE_TIMEOUT_MS,
	VERSION_READ_TIMEOUT_MS,
} from "./registry.ts";

/**
 * Executable identity for the official Playwright CLI package.
 *
 * @defaultValue "playwright-cli"
 */
export const PLAYWRIGHT_CDP_EXECUTABLE = "playwright-cli" as const;

/**
 * Exact Playwright CLI release proven for explicit CDP attachment.
 *
 * @defaultValue "0.1.17"
 */
export const PLAYWRIGHT_CDP_PINNED_VERSION = "0.1.17" as const;

/**
 * Official signed release provenance for the pinned Playwright CLI.
 */
export const PLAYWRIGHT_CDP_RELEASE_URL =
	"https://github.com/microsoft/playwright-cli/releases/tag/v0.1.17" as const;

/**
 * npm registry integrity published for `@playwright/cli@0.1.17`.
 */
export const PLAYWRIGHT_CDP_DIST_INTEGRITY =
	"sha512-VBw6y3p8eqOqmjKg07IkWSPGKJkpIhMRNDFI6DOYsDD6fAfcI1XYEWMLWyhSZQ0B/Oc2KN49eq4XqE64PUPHBg==" as const;

/**
 * Fixed prefix for the inspectable session used only by the Browser Connect
 * attachment probe, and for the default operational session injected into the
 * Verified Handoff Envelope.
 *
 * The probe derives a UNIQUE session name per invocation from this prefix (see
 * {@link deriveProbeSessionName}) so two concurrent `connect playwright-cdp`
 * runs never collide in Playwright CLI's named-session registry — one probe's
 * detach can never tear down another probe's attached session. The probe
 * detaches its derived session before returning; downstream consumers create
 * their own operation session from the Verified Handoff Envelope.
 */
export const PLAYWRIGHT_CDP_SESSION_PREFIX =
	"browser-connect-playwright-cdp-probe" as const;

/**
 * Derive a probe session name unique to one probe invocation.
 *
 * Combines {@link PLAYWRIGHT_CDP_SESSION_PREFIX} with the current process id and
 * a short random token so concurrent probes in separate processes AND repeated
 * probes in one process never share a named session. The prefix stays intact so
 * the name is still recognizable and greppable.
 */
export function deriveProbeSessionName(): string {
	return `${PLAYWRIGHT_CDP_SESSION_PREFIX}-${process.pid}-${randomBytes(4).toString("hex")}`;
}

/** Build the named-session CDP attach argv for a given endpoint and session. */
function buildAttachArgv(
	endpoint: BrowserConnectVerifiedEndpoint,
	sessionName: string,
): readonly string[] {
	return ["attach", `--cdp=${endpoint.http}`, `--session=${sessionName}`];
}

/**
 * Exact attach-help lines required before Browser Connect invokes attach.
 *
 * These lines pin the endpoint and named-session flags that make the
 * connection-only contract possible. Any drift fails closed before attachment.
 */
export const PLAYWRIGHT_CDP_ATTACH_HELP_LINES = [
	"playwright-cli attach [name]",
	"  --cdp                       connect to an existing browser via cdp endpoint url.",
	'  --session                   session name (defaults to bound browser name or "default")',
] as const;

/**
 * Exact detach-help line required before Browser Connect creates a session.
 */
export const PLAYWRIGHT_CDP_DETACH_HELP_LINE =
	"Detach from an attached browser" as const;

const PLAYWRIGHT_CDP_INSTALL_POLICY: AdapterPackagePolicy = {
	packageName: "@playwright/cli",
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
			new URL("../../adapter-install/playwright-cdp/package.json", import.meta.url),
		),
		lockfilePath: fileURLToPath(
			new URL(
				"../../adapter-install/playwright-cdp/package-lock.json",
				import.meta.url,
			),
		),
	},
	// The exact lock includes optional fsevents with an install script. Browser
	// Connect therefore keeps package repair operator-owned instead of claiming
	// that the full dependency graph installs with scripts disabled.
	lifecycleScriptsRequired: true,
	expectedBin: PLAYWRIGHT_CDP_EXECUTABLE,
	safeUpgradeTransitions: [],
	operatorChoice: {
		packageOwner: "Microsoft Playwright CLI maintainers",
		docsUrl:
			"https://github.com/nathanvale/claude-code-config/blob/main/runtime/browser-connect/REPAIR.md#v1-install_adapter",
	},
};

type ProbeCommandOutcome =
	| { ok: true; result: AdapterCommandResult }
	| {
			ok: false;
			cause: "transient_probe_failure" | "probe_failed";
			detail: string;
	  };

/** Run one bounded Playwright CLI probe step and classify its process outcome. */
async function runProbeCommand(
	runtime: AdapterRuntime,
	executablePath: string,
	args: readonly string[],
	step: string,
): Promise<ProbeCommandOutcome> {
	let result: AdapterCommandResult;
	try {
		result = await runtime.runCommand({
			command: executablePath,
			args,
			timeoutMs: PROBE_TIMEOUT_MS,
		});
	} catch (error) {
		return {
			ok: false,
			cause: "transient_probe_failure",
			detail: `${PLAYWRIGHT_CDP_EXECUTABLE} ${step} did not start: ${errorMessage(error)}.`,
		};
	}
	if (result.timedOut) {
		return {
			ok: false,
			cause: "transient_probe_failure",
			detail: `${PLAYWRIGHT_CDP_EXECUTABLE} ${step} timed out.`,
		};
	}
	if (result.exitCode !== 0) {
		return {
			ok: false,
			cause: "probe_failed",
			detail: `${PLAYWRIGHT_CDP_EXECUTABLE} ${step} exited ${result.exitCode}.`,
		};
	}
	return { ok: true, result };
}

/** Best-effort named-session detach used after any attach attempt. */
async function detachProbeSession(
	runtime: AdapterRuntime,
	executablePath: string,
	sessionName: string,
): Promise<ProbeCommandOutcome> {
	return runProbeCommand(
		runtime,
		executablePath,
		[`--session=${sessionName}`, "detach"],
		"named detach",
	);
}

/**
 * Playwright CLI adapter for the explicit-CDP Browser Connect lane.
 *
 * The probe validates the pinned attach/detach help, attaches only to the
 * verified HTTP endpoint, snapshots without navigation, and detaches its named
 * session. It never invokes `open`, a browser installer, or a channel-name
 * attachment that could discover or launch another browser.
 */
export const playwrightCdpDefinition = {
	id: "playwright-cdp",
	displayName: "Playwright CLI over CDP",
	executable: PLAYWRIGHT_CDP_EXECUTABLE,
	pinnedVersion: PLAYWRIGHT_CDP_PINNED_VERSION,
	routes: [
		{ route: "explicit-cdp", evidence: "verified-live", implemented: true },
	],
	installPolicy: PLAYWRIGHT_CDP_INSTALL_POLICY,

	async checkProvenance(runtime: AdapterRuntime): Promise<AdapterProvenanceResult> {
		const resolution = await runtime.resolveExecutable(PLAYWRIGHT_CDP_EXECUTABLE);
		if (!resolution.resolved) {
			return {
				installed: false,
				failureClass: "adapter-not-installed",
				cause: "executable_absent",
				detail: `${PLAYWRIGHT_CDP_EXECUTABLE} could not be resolved to an absolute path (no PATH/latest fallback).`,
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
				detail: `${PLAYWRIGHT_CDP_EXECUTABLE} could not be started to read its version.`,
			};
		}
		if (result.timedOut || isMissingAdapterCommandResult(result)) {
			return {
				installed: false,
				failureClass: "adapter-not-installed",
				cause: "executable_absent",
				detail: `${PLAYWRIGHT_CDP_EXECUTABLE} version read failed (binary missing or unresponsive).`,
			};
		}

		const version = extractVersion(result.stdout, result.stderr);
		if (version !== PLAYWRIGHT_CDP_PINNED_VERSION) {
			return {
				installed: false,
				failureClass: "adapter-not-installed",
				cause: "version_mismatch",
				...(version === undefined ? {} : { observedVersion: version }),
				detail: `${PLAYWRIGHT_CDP_EXECUTABLE} version ${version ?? "unreadable"} does not match pinned ${PLAYWRIGHT_CDP_PINNED_VERSION}.`,
			};
		}
		return { installed: true, executablePath: resolution.path, version };
	},

	inject(endpoint: BrowserConnectVerifiedEndpoint): AdapterInjection {
		return { argv: buildAttachArgv(endpoint, PLAYWRIGHT_CDP_SESSION_PREFIX) };
	},

	async probeAttachment(
		runtime: AdapterRuntime,
		endpoint: BrowserConnectVerifiedEndpoint,
		route,
	): Promise<AdapterProbeResult> {
		const resolution = await runtime.resolveExecutable(PLAYWRIGHT_CDP_EXECUTABLE);
		if (!resolution.resolved) {
			return {
				attached: false,
				failureClass: "attachment-failed",
				cause: "probe_failed",
				detail: `${PLAYWRIGHT_CDP_EXECUTABLE} could not be resolved for the attachment probe.`,
			};
		}

		// One session name for this whole probe invocation, unique across
		// concurrent probes, reused by attach → snapshot → detach so they agree.
		const sessionName = deriveProbeSessionName();

		const attachHelp = await runProbeCommand(
			runtime,
			resolution.path,
			["attach", "--help"],
			"attach help probe",
		);
		if (!attachHelp.ok) {
			return {
				attached: false,
				failureClass: "attachment-failed",
				cause: attachHelp.cause,
				detail: attachHelp.detail,
			};
		}
		const attachHelpText = `${attachHelp.result.stdout}\n${attachHelp.result.stderr}`;
		if (
			PLAYWRIGHT_CDP_ATTACH_HELP_LINES.some(
				(line) => !attachHelpText.includes(line),
			)
		) {
			return {
				attached: false,
				failureClass: "attachment-failed",
				cause: "probe_failed",
				detail: `${PLAYWRIGHT_CDP_EXECUTABLE} attach help contract drifted from the pinned release.`,
			};
		}

		const detachHelp = await runProbeCommand(
			runtime,
			resolution.path,
			["detach", "--help"],
			"detach help probe",
		);
		if (!detachHelp.ok) {
			return {
				attached: false,
				failureClass: "attachment-failed",
				cause: detachHelp.cause,
				detail: detachHelp.detail,
			};
		}
		const detachHelpText = `${detachHelp.result.stdout}\n${detachHelp.result.stderr}`;
		if (!detachHelpText.includes(PLAYWRIGHT_CDP_DETACH_HELP_LINE)) {
			return {
				attached: false,
				failureClass: "attachment-failed",
				cause: "probe_failed",
				detail: `${PLAYWRIGHT_CDP_EXECUTABLE} detach help contract drifted from the pinned release.`,
			};
		}

		const attach = await runProbeCommand(
			runtime,
			resolution.path,
			buildAttachArgv(endpoint, sessionName),
			"named CDP attach",
		);
		if (!attach.ok) {
			await detachProbeSession(runtime, resolution.path, sessionName);
			return {
				attached: false,
				failureClass: "attachment-failed",
				cause: attach.cause,
				detail: attach.detail,
			};
		}

		const snapshot = await runProbeCommand(
			runtime,
			resolution.path,
			[`--session=${sessionName}`, "snapshot"],
			"read-only snapshot",
		);
		const detach = await detachProbeSession(runtime, resolution.path, sessionName);
		if (!snapshot.ok) {
			return {
				attached: false,
				failureClass: "attachment-failed",
				cause: snapshot.cause,
				detail: snapshot.detail,
			};
		}
		if (!detach.ok) {
			return {
				attached: false,
				failureClass: "attachment-failed",
				cause: detach.cause,
				detail: detach.detail,
			};
		}

		return {
			attached: true,
			attachment: {
				adapter_id: "playwright-cdp",
				route,
				probe_executable: resolution.path,
			},
			evidence:
				"playwright-cli attached to the verified CDP endpoint, snapshotted read-only, and detached without closing the browser.",
		};
	},
} as const satisfies AdapterDefinition;
