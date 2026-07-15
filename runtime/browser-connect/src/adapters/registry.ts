import {
	BROWSER_CONNECT_SAFE_VERSION_PATTERN,
	type BrowserConnectAuthorizedAttachment,
	type BrowserConnectFailureClass,
	type BrowserConnectIsolatedInstallEvidence,
	type BrowserConnectRouteEvidenceStatus,
	type BrowserConnectRouteId,
	type BrowserConnectVerifiedEndpoint,
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
 * `cwd` is optional and used only by the isolated installer boundary (R28:
 * neutral working directory); adapter probes never set it.
 */
export type AdapterCommandInput = {
	command: string;
	args: readonly string[];
	env?: Record<string, string | undefined>;
	cwd?: string;
	/**
	 * When true, `env` is the child's EXACT environment — never merged over
	 * `process.env` (R28: the isolated installer's allowlist is authoritative).
	 * Default false: probes merge `env` over the inherited environment.
	 */
	exactEnv?: boolean;
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
 *
 * The rejection arm carries STRUCTURED evidence (R11): a typed `cause`
 * (`executable_absent` — unresolvable, unstartable, or unresponsive;
 * `version_mismatch` — a running binary whose version is not the pin) and, when
 * safely extracted, the plain `x.y.z` `observedVersion`. Policy selects repair
 * from these fields, never from the prose `detail`.
 */
export type AdapterProvenanceResult =
	| { installed: true; executablePath: string; version: string }
	| {
			installed: false;
			failureClass: Extract<BrowserConnectFailureClass, "adapter-not-installed">;
			cause: "executable_absent" | "version_mismatch";
			observedVersion?: string;
			detail: string;
	  };

/**
 * The result of the attachment probe: either verified evidence naming which
 * executable performed the handshake (R4/R16), or an attachment-failed
 * rejection with evidence.
 *
 * The rejection arm carries a typed `cause` (R11/R23): a timeout or a probe
 * that never started is `transient_probe_failure` (the gate may spend its one
 * bounded in-invocation re-probe); a clean non-zero exit is `probe_failed`
 * (never retried).
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
			cause: "transient_probe_failure" | "probe_failed";
			detail: string;
	  };

/**
 * One exact, maintainer-authored safe upgrade transition (R21/R22): the ONLY
 * way an observed version may automatically move to the pin. Never derived
 * from semantic-version shape.
 */
export type AdapterSafeUpgradeTransition = {
	from: string;
	to: string;
};

/**
 * Definition-owned installer policy (KTD13): the Adapter Definition owns
 * package identity, approved absolute package-manager resolution, canonical
 * registry, allowed lock-entry origins, user-owned install scope, no-shell
 * install argv, the source-controlled full dependency-integrity reference,
 * lifecycle-script eligibility, the exact safe-upgrade allowlist, and the
 * maintainer-authored operator-choice metadata. Recovery policy and the
 * `repair-adapter` executor only CONSUME this trusted declaration.
 */
export type AdapterPackagePolicy = {
	/** npm package identity installed by the isolated recipe. */
	packageName: string;
	/**
	 * Approved absolute package-manager executable resolution strategy (R28):
	 * the first EXISTING absolute candidate wins; a relative candidate is
	 * ignored and PATH is never consulted (path-shadowing defense).
	 */
	packageManager: { approvedAbsoluteCandidates: readonly string[] };
	/** Canonical registry origin; the only permitted egress target (R34). */
	canonicalRegistry: string;
	/** Exact origins a lock entry's resolved URL may carry (R34). */
	allowedLockOrigins: readonly string[];
	/** Install scope: user-owned only; never system or privileged (R22). */
	installScope: "user";
	/**
	 * No-shell install argv tail after the approved executable (KTD16). The
	 * executor appends only its own isolation arguments (fixed registry).
	 */
	installArgv: readonly string[];
	/**
	 * Source-controlled full dependency integrity reference (KTD17): the
	 * adapter-install manifest and its generated lockfile.
	 */
	integritySource: { manifestPath: string; lockfilePath: string };
	/**
	 * True when the package cannot install correctly with lifecycle scripts
	 * disabled (R29): the adapter stays operator-owned for package automation.
	 */
	lifecycleScriptsRequired: boolean;
	/** Executable name expected under node_modules/.bin after install. */
	expectedBin: string;
	/** Exact observed-version-to-pin allowlist (R21/R22); never inferred. */
	safeUpgradeTransitions: readonly AdapterSafeUpgradeTransition[];
	/** Maintainer-authored operator-choice metadata (KTD18). */
	operatorChoice: { packageOwner: string; docsUrl: string };
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
	/** Definition-owned installer policy (KTD13). */
	installPolicy: AdapterPackagePolicy;
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
			// The isolated installer passes a neutral cwd and an EXACT allowlisted
			// environment (`exactEnv`, R28) — never merged over process.env, so no
			// inherited registry, auth, or proxy value can leak. Probes keep the
			// merge-over-inherited behavior. stdin is never inherited: no prompt.
			...(input.cwd === undefined ? {} : { cwd: input.cwd }),
			env: input.env
				? input.exactEnv === true
					? stripUndefined(input.env)
					: { ...process.env, ...stripUndefined(input.env) }
				: undefined,
			stdin: "ignore",
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

/** Bounded read for an adapter's `--version` probe. Shared by both adapters. */
export const VERSION_READ_TIMEOUT_MS = 8000;

/** Bounded read for an adapter's read-only attachment probe. Shared by both adapters. */
export const PROBE_TIMEOUT_MS = 8000;

/**
 * Extract a semantic version from adapter `--version` output. Reads the first
 * `x.y.z` token from stdout, falling back to stderr; returns `undefined` when
 * no version token is present. Shared so both adapters parse versions
 * identically.
 */
export function extractVersion(
	stdout: string,
	stderr: string,
): string | undefined {
	const match = `${stdout}\n${stderr}`.match(/\b(\d+\.\d+\.\d+)\b/);
	return match?.[1];
}

/** Normalize an unknown thrown value to a message string. Shared by both adapters. */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error ?? "unknown");
}

// ---------------------------------------------------------------------------
// U5 isolated-install mechanics (R28/R29/R34). Pure policy validation lives
// here beside the Adapter Definitions that own the policy; the effectful
// executor (cli.ts `repair-adapter --execute`) consumes these helpers through
// the injectable AdapterInstallEngine seam. Everything below is file-read and
// string-work only — zero network, zero mutation.
// ---------------------------------------------------------------------------

/**
 * Effect seam for the isolated installer boundary (KTD16). Production wires
 * real fs, a redirect-refusing fetch probe, and the no-shell spawner; tests
 * inject recorders, fixture files, and a fake package-manager executable.
 */
export type AdapterInstallEngine = {
	/** Base environment the allowlist filters (never passed through whole). */
	env: Record<string, string | undefined>;
	fileExists: (path: string) => Promise<boolean>;
	readTextFile: (path: string) => Promise<string>;
	writeTextFile: (path: string, contents: string) => Promise<void>;
	/** Recursive directory creation. */
	makeDir: (path: string) => Promise<void>;
	/** `fs.mkdtemp` semantics: `prefix` is a path prefix, returns the new dir. */
	makeTempDir: (prefix: string) => Promise<string>;
	/** Best-effort recursive removal (staging cleanup). */
	removeDir: (path: string) => Promise<void>;
	/** Atomic same-volume rename publish; throws on conflict. */
	publishDir: (fromPath: string, toPath: string) => Promise<void>;
	/**
	 * Egress-gate origin probe (R34): performs ONE request with redirects
	 * disabled and reports the raw status. A 3xx status is returned, never
	 * followed — the executor stops without a redirected request.
	 */
	probeOrigin: (url: string) => Promise<{ status: number }>;
	/** Bounded no-shell spawn (KTD16); `cwd` is the neutral staging dir. */
	runCommand: (input: AdapterCommandInput) => Promise<AdapterCommandResult>;
};

/**
 * Lock-entry violation kinds (R34 + R29): origin-family kinds stop before any
 * network; `missing_integrity` marks an incomplete dependency graph.
 */
export type AdapterLockViolationKind =
	| "link_entry"
	| "git_source"
	| "file_source"
	| "workspace_source"
	| "insecure_http"
	| "alternate_origin"
	| "unparseable_url"
	| "missing_resolved"
	| "missing_integrity"
	| "lock_unsupported";

/**
 * One lock validation violation: the offending packages key plus its kind.
 */
export type AdapterLockViolation = {
	path: string;
	kind: AdapterLockViolationKind;
};

type LockPackagesDocument = {
	packages?: Record<string, Record<string, unknown>> | null;
};

/**
 * Validate every dependency entry of an npm lock document against the
 * Adapter Definition's canonical origins (R34). Accepts only https resolved
 * URLs whose origin exactly matches an allowed lock origin and which carry
 * integrity evidence. Git, file, workspace, plain-HTTP, alternate-origin,
 * unparseable, resolved-less, and link entries are violations; an unparseable
 * document is itself a violation, never a pass.
 *
 * @param policy - Definition-owned installer policy
 * @param lockDocument - Parsed lock JSON (unknown shape until validated)
 * @returns Violations in packages-key order; empty means canonical
 */
export function validateAdapterLockPackages(
	policy: AdapterPackagePolicy,
	lockDocument: unknown,
): AdapterLockViolation[] {
	if (
		lockDocument === null ||
		typeof lockDocument !== "object" ||
		Array.isArray(lockDocument)
	) {
		return [{ path: "", kind: "lock_unsupported" }];
	}
	const packages = (lockDocument as LockPackagesDocument).packages;
	if (packages === null || packages === undefined || typeof packages !== "object") {
		return [{ path: "", kind: "lock_unsupported" }];
	}
	const allowedOrigins = new Set(
		policy.allowedLockOrigins.map((origin) => normalizeOrigin(origin)),
	);
	const violations: AdapterLockViolation[] = [];
	let dependencyEntries = 0;
	for (const [path, entry] of Object.entries(packages)) {
		if (path === "") continue; // the root project entry has no resolved URL
		if (entry === null || typeof entry !== "object") {
			violations.push({ path, kind: "lock_unsupported" });
			continue;
		}
		dependencyEntries += 1;
		const record = entry as Record<string, unknown>;
		if (record.link === true) {
			violations.push({ path, kind: "link_entry" });
			continue;
		}
		const resolved = record.resolved;
		if (typeof resolved !== "string" || resolved.length === 0) {
			violations.push({ path, kind: "missing_resolved" });
		} else {
			const originKind = classifyResolvedSource(resolved, allowedOrigins);
			if (originKind !== undefined) violations.push({ path, kind: originKind });
		}
		const integrity = record.integrity;
		if (typeof integrity !== "string" || !/^sha(256|384|512)-/.test(integrity)) {
			violations.push({ path, kind: "missing_integrity" });
		}
	}
	if (dependencyEntries === 0) {
		violations.push({ path: "", kind: "lock_unsupported" });
	}
	return violations;
}

function classifyResolvedSource(
	resolved: string,
	allowedOrigins: ReadonlySet<string>,
): AdapterLockViolationKind | undefined {
	if (resolved.startsWith("git+") || resolved.startsWith("git:")) {
		return "git_source";
	}
	if (resolved.startsWith("file:")) return "file_source";
	if (resolved.startsWith("workspace:")) return "workspace_source";
	if (resolved.startsWith("http://")) return "insecure_http";
	if (!resolved.startsWith("https://")) return "unparseable_url";
	let url: URL;
	try {
		url = new URL(resolved);
	} catch {
		return "unparseable_url";
	}
	if (!allowedOrigins.has(normalizeOrigin(url.origin))) {
		return "alternate_origin";
	}
	return undefined;
}

function normalizeOrigin(origin: string): string {
	return origin.replace(/\/+$/, "").toLowerCase();
}

/**
 * Stop causes an install-policy assessment can surface (R29/R34). The
 * executor reuses this vocabulary for its own fail-closed stops.
 */
export type AdapterInstallStopCause =
	| "manifest_missing"
	| "manifest_invalid"
	| "manifest_pin_drift"
	| "lock_missing"
	| "lock_invalid"
	| "lock_drift"
	| "lock_origin_violation"
	| "integrity_incomplete"
	| "lifecycle_scripts_required";

/**
 * The typed outcome of assessing a definition's install policy against its
 * source-controlled manifest and lockfile: the four isolated-install evidence
 * gates (model vocabulary, consumed by U1 policy), the stop causes behind any
 * failed gate, and the raw texts for the executor's staging copy.
 */
export type AdapterInstallAssessment = {
	evidence: BrowserConnectIsolatedInstallEvidence;
	stop_causes: readonly AdapterInstallStopCause[];
	violations: readonly AdapterLockViolation[];
	manifestText?: string;
	lockText?: string;
};

/**
 * Assess an Adapter Definition's isolated-install eligibility (R28/R29):
 * source files only — zero network, zero mutation. The four returned gates
 * feed the typed `automatic_install` evidence the recovery policy consumes.
 *
 * @param definition - Adapter Definition owning the policy
 * @param engine - File-read seam (fileExists + readTextFile suffice)
 * @returns Typed evidence, stop causes, and the raw source texts
 */
export async function assessAdapterInstallPolicy(
	definition: AdapterDefinition,
	engine: Pick<AdapterInstallEngine, "fileExists" | "readTextFile">,
): Promise<AdapterInstallAssessment> {
	const policy = definition.installPolicy;
	const stopCauses = new Set<AdapterInstallStopCause>();
	let manifestText: string | undefined;
	let lockText: string | undefined;
	let lockDocument: unknown;

	if (!(await engine.fileExists(policy.integritySource.manifestPath))) {
		stopCauses.add("manifest_missing");
	} else {
		try {
			manifestText = await engine.readTextFile(policy.integritySource.manifestPath);
			const manifest = JSON.parse(manifestText) as {
				dependencies?: Record<string, string>;
			};
			if (manifest.dependencies?.[policy.packageName] !== definition.pinnedVersion) {
				stopCauses.add("manifest_pin_drift");
			}
		} catch {
			stopCauses.add("manifest_invalid");
		}
	}

	let violations: readonly AdapterLockViolation[] = [];
	if (!(await engine.fileExists(policy.integritySource.lockfilePath))) {
		stopCauses.add("lock_missing");
	} else {
		try {
			lockText = await engine.readTextFile(policy.integritySource.lockfilePath);
			lockDocument = JSON.parse(lockText);
		} catch {
			stopCauses.add("lock_invalid");
		}
	}
	if (lockDocument !== undefined) {
		violations = validateAdapterLockPackages(policy, lockDocument);
		// R29 lock drift: the lock must resolve the adapter package at the exact
		// definition pin the manifest declares.
		const packages = (lockDocument as LockPackagesDocument).packages;
		const packageEntry = packages?.[`node_modules/${policy.packageName}`];
		if (
			packageEntry === undefined ||
			packageEntry === null ||
			(packageEntry as Record<string, unknown>).version !== definition.pinnedVersion
		) {
			stopCauses.add("lock_drift");
		}
	}
	for (const violation of violations) {
		if (violation.kind === "missing_integrity") {
			stopCauses.add("integrity_incomplete");
		} else {
			stopCauses.add("lock_origin_violation");
		}
	}

	const lockHasInstallScript =
		lockDocument !== undefined &&
		Object.entries((lockDocument as LockPackagesDocument).packages ?? {}).some(
			([path, entry]) =>
				path !== "" &&
				entry !== null &&
				typeof entry === "object" &&
				(entry as Record<string, unknown>).hasInstallScript === true,
		);
	if (
		policy.lifecycleScriptsRequired ||
		lockHasInstallScript ||
		!policy.installArgv.includes("--ignore-scripts")
	) {
		stopCauses.add("lifecycle_scripts_required");
	}

	const recipeComplete =
		!stopCauses.has("manifest_missing") &&
		!stopCauses.has("manifest_invalid") &&
		!stopCauses.has("manifest_pin_drift") &&
		!stopCauses.has("lock_missing") &&
		!stopCauses.has("lock_invalid") &&
		!stopCauses.has("lock_drift") &&
		policy.installArgv.length > 0 &&
		policy.packageManager.approvedAbsoluteCandidates.length > 0 &&
		policy.expectedBin.length > 0;

	const evidence: BrowserConnectIsolatedInstallEvidence = {
		recipe_complete: recipeComplete,
		lock_origins_canonical:
			lockDocument !== undefined &&
			violations.every((violation) => violation.kind === "missing_integrity"),
		dependency_integrity_complete:
			lockDocument !== undefined &&
			violations.every((violation) => violation.kind !== "missing_integrity") &&
			!stopCauses.has("lock_invalid"),
		lifecycle_scripts_disabled: !stopCauses.has("lifecycle_scripts_required"),
	};

	return {
		evidence,
		stop_causes: [...stopCauses],
		violations,
		...(manifestText === undefined ? {} : { manifestText }),
		...(lockText === undefined ? {} : { lockText }),
	};
}

/**
 * Trusted manual-install inputs are complete (KTD18): package identity, exact
 * pin, user-owned scope, package owner, and the versioned docs anchor all
 * exist on the definition. Required before the manual-install operator choice
 * may be offered.
 */
export function manualAdapterInstallInputsComplete(
	definition: AdapterDefinition,
): boolean {
	const policy = definition.installPolicy;
	return (
		policy.packageName.length > 0 &&
		BROWSER_CONNECT_SAFE_VERSION_PATTERN.test(definition.pinnedVersion) &&
		policy.installScope === "user" &&
		policy.operatorChoice.packageOwner.length > 0 &&
		/^https:\/\//.test(policy.operatorChoice.docsUrl)
	);
}

/**
 * True only for an EXACT maintainer-authored observed-to-pin transition
 * (R21/R22). Never inferred from semantic-version shape; the target must be
 * the current pin.
 */
export function isAllowlistedAdapterUpgrade(
	policy: AdapterPackagePolicy,
	observedVersion: string,
	pinnedVersion: string,
): boolean {
	return policy.safeUpgradeTransitions.some(
		(transition) =>
			transition.from === observedVersion && transition.to === pinnedVersion,
	);
}

/**
 * Resolve the approved package-manager executable (R28): the first EXISTING
 * absolute candidate. Relative candidates are ignored even when present, and
 * PATH is never consulted — a shadowed `npm` earlier on PATH can never win.
 *
 * @param policy - Definition-owned installer policy
 * @param engine - File-existence seam
 * @returns The absolute executable path, or undefined when none exists
 */
export async function resolveApprovedPackageManagerExecutable(
	policy: AdapterPackagePolicy,
	engine: Pick<AdapterInstallEngine, "fileExists">,
): Promise<string | undefined> {
	for (const candidate of policy.packageManager.approvedAbsoluteCandidates) {
		if (!candidate.startsWith("/")) continue;
		if (await engine.fileExists(candidate)) return candidate;
	}
	return undefined;
}

/**
 * Base-environment keys the isolated installer child may inherit (R28).
 * Everything else — registry config, auth tokens, proxies, npm_config_* —
 * is dropped by construction (allowlist, not blocklist).
 */
export const ADAPTER_INSTALL_ENV_ALLOWLIST = [
	"PATH",
	"HOME",
	"TMPDIR",
	"LANG",
	"LC_ALL",
	"USER",
	"LOGNAME",
	"SHELL",
	"TERM",
] as const;

/**
 * Build the isolated installer child environment (R28/KTD16): allowlisted
 * pass-through basics plus executor-owned overrides that pin the canonical
 * registry, point npm's user/global config at empty staging-owned files,
 * isolate the cache, disable lifecycle scripts, and force a non-interactive
 * posture. No inherited registry, auth, or proxy value can survive.
 */
export function buildIsolatedInstallerEnvironment(input: {
	baseEnv: Record<string, string | undefined>;
	canonicalRegistry: string;
	stagingDir: string;
	userConfigPath: string;
	globalConfigPath: string;
	cachePath: string;
}): Record<string, string> {
	const env: Record<string, string> = {};
	for (const key of ADAPTER_INSTALL_ENV_ALLOWLIST) {
		const value = input.baseEnv[key];
		if (value !== undefined) env[key] = value;
	}
	env.npm_config_registry = input.canonicalRegistry;
	env.npm_config_userconfig = input.userConfigPath;
	env.npm_config_globalconfig = input.globalConfigPath;
	env.npm_config_cache = input.cachePath;
	env.npm_config_ignore_scripts = "true";
	env.npm_config_audit = "false";
	env.npm_config_fund = "false";
	env.npm_config_update_notifier = "false";
	env.npm_config_loglevel = "error";
	env.CI = "1";
	env.NO_COLOR = "1";
	return env;
}
