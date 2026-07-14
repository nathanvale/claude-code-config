import type {
	BrowserConnectAuthorizedAttachment,
	BrowserConnectFailureClass,
	BrowserConnectRouteEvidenceStatus,
	BrowserConnectRouteId,
	BrowserConnectVerifiedEndpoint,
} from "../../src/model.ts";

// ---------------------------------------------------------------------------
// KTD8 — package-local no-shell argv transport.
//
// Reimplements the no-shell, positional-argv, bounded-timeout invocation shape
// from `skills/browser-use/src/mcporter-transport.ts` (browser-use exports no
// module surface, so it cannot be imported). Injection produces exact argv
// ARRAYS — never shell strings. This is the ONLY channel through which an
// Adapter Definition reaches its own binary; browser-connect never probes on an
// adapter's behalf (R4).
// ---------------------------------------------------------------------------

/**
 * Bounded, no-shell command invocation. `command` + `args` are passed
 * positionally to the runtime spawner; nothing is ever joined into a shell
 * string, so injected endpoints and arguments are never shell-evaluated.
 */
export type AdapterCommandInput = {
	command: string;
	args: readonly string[];
	env?: Record<string, string | undefined>;
	timeoutMs: number;
};

/**
 * Result of a bounded command invocation. `exitCode` 127 (or a
 * spawn-failure-shaped result) signals the resolved binary was not found.
 */
export type AdapterCommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut?: boolean;
};

/**
 * Executable provenance resolution (R5): resolve an adapter's identity to an
 * ABSOLUTE path (or explicit command vector), with NO implicit PATH/latest
 * fallback — mirroring the mcporter transport stance. `undefined` means the
 * executable is unresolvable, which the definition maps to
 * `adapter-not-installed` (never a probe).
 */
export type AdapterExecutableResolution =
	| { resolved: true; path: string }
	| { resolved: false };

/**
 * Runtime seam every Adapter Definition runs through. Injected so unit tests
 * use fakes exclusively — no real binaries, network, or Chrome. `resolveExecutable`
 * performs provenance resolution; `runCommand` performs the read-only version
 * read and the attachment probe.
 */
export type AdapterRuntime = {
	env: Record<string, string | undefined>;
	resolveExecutable: (
		command: string,
	) => Promise<AdapterExecutableResolution> | AdapterExecutableResolution;
	runCommand: (input: AdapterCommandInput) => Promise<AdapterCommandResult>;
};

/**
 * Endpoint injection outcome (R5): the exact argv ARRAY and/or env additions an
 * Adapter Definition produces from a verified endpoint. `argv` is always a
 * literal array; `env` is optional per-adapter (e.g. agent-browser's
 * `AGENT_BROWSER_CDP`).
 */
export type AdapterInjection = {
	argv: readonly string[];
	env?: Record<string, string>;
};

/**
 * A declared route capability (KTD7): which door the adapter reaches, and the
 * evidence status backing that claim. `explicit-cdp` is `verified-live` for
 * both slice-one adapters; `ui-consent` is `documented` (not implemented) for
 * chrome-devtools-mcp per lesson 0003.
 */
export type AdapterRouteCapability = {
	route: BrowserConnectRouteId;
	evidence: BrowserConnectRouteEvidenceStatus;
	implemented: boolean;
};

/**
 * The result of the provenance step: either an installed+version-matched
 * executable, or a not-installed rejection carrying evidence. Never a probe on
 * a version mismatch or unresolvable path.
 */
export type AdapterProvenanceResult =
	| { installed: true; executablePath: string; version: string }
	| {
			installed: false;
			failureClass: Extract<BrowserConnectFailureClass, "adapter-not-installed">;
			detail: string;
	  };

/**
 * The result of the attachment probe: either verified evidence naming which
 * executable performed the handshake (R4/R16), or an attachment-failed
 * rejection with evidence.
 */
export type AdapterProbeResult =
	| {
			attached: true;
			attachment: BrowserConnectAuthorizedAttachment;
			evidence: string;
	  }
	| {
			attached: false;
			failureClass: Extract<BrowserConnectFailureClass, "attachment-failed">;
			detail: string;
	  };

/**
 * Adapter Definition (R5): one object owns identity, executable provenance,
 * route capabilities, endpoint injection, and attachment proof. Identity is
 * separate from route (R6): `id` never encodes a route; routes are declared
 * capabilities.
 */
export type AdapterDefinition = {
	/** Stable adapter id (identity, R6 — never encodes a route). */
	id: string;
	/** Human-facing display label. */
	displayName: string;
	/** The executable command this adapter resolves and probes through. */
	executable: string;
	/** Version PINNED in the definition; provenance rejects a mismatch. */
	pinnedVersion: string;
	/** Declared route capabilities in preference order (KTD7). */
	routes: readonly AdapterRouteCapability[];
	/**
	 * Resolve identity + executable provenance and read the adapter's version
	 * against the pinned version. Unresolvable path or version mismatch →
	 * `adapter-not-installed`, NEVER a probe.
	 */
	checkProvenance: (
		runtime: AdapterRuntime,
	) => Promise<AdapterProvenanceResult>;
	/**
	 * Produce the exact argv array (and optional env) that injects the verified
	 * endpoint into this adapter's invocation. Pure — no side effects.
	 */
	inject: (endpoint: BrowserConnectVerifiedEndpoint) => AdapterInjection;
	/**
	 * Run the read-only attachment probe THROUGH this adapter's own executable
	 * with the injected endpoint (R4). Names which executable performed the
	 * probe in its evidence.
	 */
	probeAttachment: (
		runtime: AdapterRuntime,
		endpoint: BrowserConnectVerifiedEndpoint,
		route: BrowserConnectRouteId,
	) => Promise<AdapterProbeResult>;
};

import { agentBrowserDefinition } from "./agent-browser.ts";
import { chromeDevtoolsMcpDefinition } from "./chrome-devtools-mcp.ts";

/**
 * Registered adapter ids in registry order (KTD3): exactly the two slice-one
 * adapters, chrome-devtools-mcp first. Declared as string literals so the
 * registry's shape is known without touching the imported definition values —
 * this avoids the module-init cycle (adapter files import helpers from this
 * module) while keeping the list a single source of truth.
 */
export const BROWSER_CONNECT_ADAPTER_IDS = [
	"chrome-devtools-mcp",
	"agent-browser",
] as const;

/**
 * Registered adapter id union.
 */
export type BrowserConnectAdapterId =
	(typeof BROWSER_CONNECT_ADAPTER_IDS)[number];

/**
 * Definitions by id, evaluated lazily on first access. The adapter modules
 * import helpers back from this module, so reading their exported definition
 * values at this module's top level would observe them mid-initialization
 * (ESM circular import). Deferring the read to first call breaks the cycle:
 * by the time any consumer calls the registry, both modules have finished.
 */
function adapterDefinitionsById(): Record<
	BrowserConnectAdapterId,
	AdapterDefinition
> {
	return {
		"chrome-devtools-mcp": chromeDevtoolsMcpDefinition,
		"agent-browser": agentBrowserDefinition,
	};
}

/**
 * The static registry (KTD3): exactly the two slice-one Adapter Definitions,
 * no router engine, no definition-free candidate rows. chrome-devtools-mcp is
 * listed first — it proved the definition interface; agent-browser validated
 * the seam against a genuinely different (non-MCP) invocation model.
 *
 * @returns The registered Adapter Definitions in registry order
 */
export function listAdapterDefinitions(): readonly AdapterDefinition[] {
	const byId = adapterDefinitionsById();
	return BROWSER_CONNECT_ADAPTER_IDS.map((id) => byId[id]);
}

/**
 * Look up an Adapter Definition by id. `undefined` means the adapter is not in
 * the registry — the caller maps that to `adapter-unknown` (usage-class
 * rejection), never a probe.
 *
 * @param id - Adapter id from caller input
 * @returns The Adapter Definition, or `undefined` when unregistered
 */
export function findAdapterDefinition(
	id: string,
): AdapterDefinition | undefined {
	if ((BROWSER_CONNECT_ADAPTER_IDS as readonly string[]).includes(id)) {
		return adapterDefinitionsById()[id as BrowserConnectAdapterId];
	}
	return undefined;
}

/**
 * Default no-shell command spawner (KTD8), mirroring
 * `spawnMcporterCommand`: bounded timeout, piped output, argv passed
 * positionally (never shell-evaluated). Missing binary surfaces as an
 * exit-127 result rather than a throw. Not used in unit tests — those inject a
 * fake `runCommand`.
 */
export async function spawnAdapterCommand(
	input: AdapterCommandInput,
): Promise<AdapterCommandResult> {
	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn([input.command, ...input.args], {
			stdout: "pipe",
			stderr: "pipe",
			env: input.env
				? { ...process.env, ...stripUndefined(input.env) }
				: undefined,
		});
	} catch {
		return {
			exitCode: 127,
			stdout: "",
			stderr: `${input.command}: command not found`,
		};
	}
	const completion = Promise.all([
		new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
		new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
		proc.exited,
	]).then(([stdout, stderr, exitCode]) => ({ exitCode, stdout, stderr }));
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const timeoutResult = new Promise<AdapterCommandResult>((resolve) => {
		timeout = setTimeout(() => {
			try {
				proc.kill("SIGKILL");
			} catch {
				// Best effort. Timeout result still preserves bounded CLI behavior.
			}
			resolve({ exitCode: 1, stdout: "", stderr: "", timedOut: true });
		}, input.timeoutMs);
	});
	try {
		return await Promise.race([completion, timeoutResult]);
	} finally {
		if (timeout) clearTimeout(timeout);
		completion.catch(() => undefined);
	}
}

function stripUndefined(
	env: Record<string, string | undefined>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) out[key] = value;
	}
	return out;
}

/**
 * True when a command result signals the resolved binary was not found, rather
 * than a clean non-zero exit. Shared so both adapters route a missing binary
 * identically.
 */
export function isMissingAdapterCommandResult(
	result: AdapterCommandResult,
): boolean {
	const text = `${result.stderr}\n${result.stdout}`;
	return (
		result.exitCode === 127 ||
		/(command not found|not found|ENOENT|No such file or directory)/i.test(text)
	);
}
