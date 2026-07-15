import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import type { BrowserConnectVerifiedEndpoint } from "../src/model.ts";
import {
	AGENT_BROWSER_CDP_FLAG,
	AGENT_BROWSER_EXECUTABLE,
	AGENT_BROWSER_PINNED_VERSION,
	agentBrowserDefinition,
} from "../src/adapters/agent-browser.ts";
import {
	CHROME_DEVTOOLS_MCP_BROWSER_URL_FLAG,
	CHROME_DEVTOOLS_MCP_EXECUTABLE,
	CHROME_DEVTOOLS_MCP_PINNED_VERSION,
	chromeDevtoolsMcpDefinition,
} from "../src/adapters/chrome-devtools-mcp.ts";
import {
	type AdapterCommandInput,
	type AdapterCommandResult,
	type AdapterExecutableResolution,
	type AdapterPackagePolicy,
	type AdapterRuntime,
	assessAdapterInstallPolicy,
	buildIsolatedInstallerEnvironment,
	findAdapterDefinition,
	isAllowlistedAdapterUpgrade,
	listAdapterDefinitions,
	manualAdapterInstallInputsComplete,
	resolveApprovedPackageManagerExecutable,
	validateAdapterLockPackages,
} from "../src/adapters/registry.ts";

const ENDPOINT: BrowserConnectVerifiedEndpoint = {
	http: "http://127.0.0.1:41337",
	ws: "ws://127.0.0.1:41337/devtools/browser/abc",
};

const RESOLVED_PATH = "/opt/adapters/bin/tool";

type CallLog = {
	commands: AdapterCommandInput[];
};

/**
 * Fake runtime — no real binaries, network, or Chrome (test constraint). The
 * `respond` callback shapes each command result by argv; `resolution` shapes
 * provenance resolution. The call log lets tests assert a probe was NEVER
 * invoked on a not-installed rejection.
 */
function fakeRuntime(options: {
	resolution?: AdapterExecutableResolution;
	respond?: (input: AdapterCommandInput) => AdapterCommandResult;
}): { runtime: AdapterRuntime; log: CallLog } {
	const log: CallLog = { commands: [] };
	const runtime: AdapterRuntime = {
		env: {},
		resolveExecutable: () =>
			options.resolution ?? { resolved: true, path: RESOLVED_PATH },
		runCommand: async (input) => {
			log.commands.push(input);
			return (
				options.respond?.(input) ?? {
					exitCode: 0,
					stdout: "",
					stderr: "",
				}
			);
		},
	};
	return { runtime, log };
}

const versionResponder =
	(version: string) =>
	(input: AdapterCommandInput): AdapterCommandResult => {
		if (input.args.includes("--version")) {
			return { exitCode: 0, stdout: version, stderr: "" };
		}
		return { exitCode: 0, stdout: "ok", stderr: "" };
	};

describe("registry", () => {
	test("ships exactly the two slice-one adapters, chrome-devtools-mcp first", () => {
		expect(listAdapterDefinitions().map((d) => d.id)).toEqual([
			"chrome-devtools-mcp",
			"agent-browser",
		]);
	});

	test("findAdapterDefinition resolves registered ids", () => {
		expect(findAdapterDefinition("chrome-devtools-mcp")?.id).toBe(
			"chrome-devtools-mcp",
		);
		expect(findAdapterDefinition("agent-browser")?.id).toBe("agent-browser");
	});

	test("unknown adapter → undefined (caller maps to adapter-unknown usage rejection)", () => {
		expect(findAdapterDefinition("playwright-mcp")).toBeUndefined();
		expect(findAdapterDefinition("")).toBeUndefined();
	});

	test("identity is separate from route — no adapter id encodes a route (R6)", () => {
		for (const definition of listAdapterDefinitions()) {
			for (const route of definition.routes) {
				expect(definition.id).not.toContain(route.route);
			}
		}
	});
});

describe("chrome-devtools-mcp definition", () => {
	test("declares explicit-cdp verified-live and ui-consent documented (lesson 0003)", () => {
		const routes = chromeDevtoolsMcpDefinition.routes;
		expect(routes).toContainEqual({
			route: "explicit-cdp",
			evidence: "verified-live",
			implemented: true,
		});
		expect(routes).toContainEqual({
			route: "ui-consent",
			evidence: "documented",
			implemented: false,
		});
	});

	test("injection produces exact argv array (no shell strings)", () => {
		const injection = chromeDevtoolsMcpDefinition.inject(ENDPOINT);
		expect(injection.argv).toEqual([
			CHROME_DEVTOOLS_MCP_BROWSER_URL_FLAG,
			ENDPOINT.http,
		]);
		expect(Array.isArray(injection.argv)).toBe(true);
		expect(injection.env).toBeUndefined();
	});

	test("installed + version match → provenance installed with pinned version", async () => {
		const { runtime } = fakeRuntime({
			respond: versionResponder(CHROME_DEVTOOLS_MCP_PINNED_VERSION),
		});
		const result = await chromeDevtoolsMcpDefinition.checkProvenance(runtime);
		expect(result).toEqual({
			installed: true,
			executablePath: RESOLVED_PATH,
			version: CHROME_DEVTOOLS_MCP_PINNED_VERSION,
		});
	});

	test("unresolvable path → adapter-not-installed, NEVER a probe", async () => {
		const { runtime, log } = fakeRuntime({
			resolution: { resolved: false },
		});
		const result = await chromeDevtoolsMcpDefinition.checkProvenance(runtime);
		expect(result.installed).toBe(false);
		if (!result.installed) {
			expect(result.failureClass).toBe("adapter-not-installed");
		}
		// No command ran at all — not even a version read, never a probe.
		expect(log.commands.length).toBe(0);
	});

	test("version mismatch → adapter-not-installed, never a probe or handoff", async () => {
		const { runtime, log } = fakeRuntime({
			respond: versionResponder("1.4.0"),
		});
		const result = await chromeDevtoolsMcpDefinition.checkProvenance(runtime);
		expect(result.installed).toBe(false);
		if (!result.installed) {
			expect(result.failureClass).toBe("adapter-not-installed");
			expect(result.detail).toContain("does not match pinned");
		}
		// Only the version read ran — the probe (--browser-url / --list-tabs) never did.
		const probed = log.commands.some((c) =>
			c.args.includes(CHROME_DEVTOOLS_MCP_BROWSER_URL_FLAG),
		);
		expect(probed).toBe(false);
	});

	test("missing binary (exit 127) on version read → adapter-not-installed, never a probe", async () => {
		const { runtime, log } = fakeRuntime({
			respond: () => ({
				exitCode: 127,
				stdout: "",
				stderr: "chrome-devtools-mcp: command not found",
			}),
		});
		const result = await chromeDevtoolsMcpDefinition.checkProvenance(runtime);
		expect(result.installed).toBe(false);
		const probed = log.commands.some((c) =>
			c.args.includes(CHROME_DEVTOOLS_MCP_BROWSER_URL_FLAG),
		);
		expect(probed).toBe(false);
	});

	test("probe success → attached with evidence naming the probe executable (R4)", async () => {
		const { runtime, log } = fakeRuntime({
			respond: () => ({ exitCode: 0, stdout: "tabs", stderr: "" }),
		});
		const result = await chromeDevtoolsMcpDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(result.attached).toBe(true);
		if (result.attached) {
			expect(result.attachment).toEqual({
				adapter_id: "chrome-devtools-mcp",
				route: "explicit-cdp",
				probe_executable: RESOLVED_PATH,
			});
		}
		// The probe ran through the adapter's own executable with the injected endpoint.
		const probeCall = log.commands.at(-1);
		expect(probeCall?.command).toBe(RESOLVED_PATH);
		expect(probeCall?.args).toContain(ENDPOINT.http);
	});

	test("probe non-zero exit → attachment-failed with evidence", async () => {
		const { runtime } = fakeRuntime({
			respond: () => ({ exitCode: 3, stdout: "", stderr: "cannot reach cdp" }),
		});
		const result = await chromeDevtoolsMcpDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(result.attached).toBe(false);
		if (!result.attached) {
			expect(result.failureClass).toBe("attachment-failed");
			expect(result.detail).toContain("exited 3");
		}
	});

	test("probe timeout → attachment-failed", async () => {
		const { runtime } = fakeRuntime({
			respond: () => ({ exitCode: 1, stdout: "", stderr: "", timedOut: true }),
		});
		const result = await chromeDevtoolsMcpDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(result.attached).toBe(false);
		if (!result.attached) {
			expect(result.failureClass).toBe("attachment-failed");
			expect(result.detail).toContain("timed out");
		}
	});

	test("executable + pinned version constants stay stable", () => {
		expect(chromeDevtoolsMcpDefinition.executable).toBe(
			CHROME_DEVTOOLS_MCP_EXECUTABLE,
		);
		expect(chromeDevtoolsMcpDefinition.pinnedVersion).toBe(
			CHROME_DEVTOOLS_MCP_PINNED_VERSION,
		);
	});
});

describe("agent-browser definition (non-MCP seam)", () => {
	test("declares explicit-cdp verified-live only", () => {
		expect(agentBrowserDefinition.routes).toEqual([
			{ route: "explicit-cdp", evidence: "verified-live", implemented: true },
		]);
	});

	test("injection produces exact --cdp <ws> argv array (no shell strings)", () => {
		const injection = agentBrowserDefinition.inject(ENDPOINT);
		expect(injection.argv).toEqual([AGENT_BROWSER_CDP_FLAG, ENDPOINT.ws]);
		expect(Array.isArray(injection.argv)).toBe(true);
	});

	test("installed + version match → provenance installed", async () => {
		const { runtime } = fakeRuntime({
			respond: versionResponder(AGENT_BROWSER_PINNED_VERSION),
		});
		const result = await agentBrowserDefinition.checkProvenance(runtime);
		expect(result).toEqual({
			installed: true,
			executablePath: RESOLVED_PATH,
			version: AGENT_BROWSER_PINNED_VERSION,
		});
	});

	test("unresolvable path → adapter-not-installed, NEVER a probe", async () => {
		const { runtime, log } = fakeRuntime({ resolution: { resolved: false } });
		const result = await agentBrowserDefinition.checkProvenance(runtime);
		expect(result.installed).toBe(false);
		if (!result.installed) {
			expect(result.failureClass).toBe("adapter-not-installed");
		}
		expect(log.commands.length).toBe(0);
	});

	test("version mismatch → adapter-not-installed, never a probe", async () => {
		const { runtime, log } = fakeRuntime({
			respond: versionResponder("0.30.0"),
		});
		const result = await agentBrowserDefinition.checkProvenance(runtime);
		expect(result.installed).toBe(false);
		const probed = log.commands.some((c) =>
			c.args.includes(AGENT_BROWSER_CDP_FLAG),
		);
		expect(probed).toBe(false);
	});

	test("probe success → attached naming the probe executable", async () => {
		const { runtime, log } = fakeRuntime({
			respond: () => ({ exitCode: 0, stdout: "snapshot", stderr: "" }),
		});
		const result = await agentBrowserDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(result.attached).toBe(true);
		if (result.attached) {
			expect(result.attachment.adapter_id).toBe("agent-browser");
			expect(result.attachment.probe_executable).toBe(RESOLVED_PATH);
		}
		const probeCall = log.commands.at(-1);
		expect(probeCall?.command).toBe(RESOLVED_PATH);
		expect(probeCall?.args).toContain(ENDPOINT.ws);
	});

	test("probe non-zero exit → attachment-failed", async () => {
		const { runtime } = fakeRuntime({
			respond: () => ({ exitCode: 2, stdout: "", stderr: "no cdp" }),
		});
		const result = await agentBrowserDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(result.attached).toBe(false);
		if (!result.attached) {
			expect(result.failureClass).toBe("attachment-failed");
		}
	});

	test("executable + pinned version constants stay stable", () => {
		expect(agentBrowserDefinition.executable).toBe(AGENT_BROWSER_EXECUTABLE);
		expect(agentBrowserDefinition.pinnedVersion).toBe(
			AGENT_BROWSER_PINNED_VERSION,
		);
	});
});

// ===========================================================================
// U5: registry-owned install policy (KTD13/R21/R28/R29/R34). Definitions OWN
// package identity, canonical registry, isolated recipe, integrity source,
// lifecycle eligibility, and the exact safe-upgrade allowlist; recovery policy
// and the repair-adapter executor only consume them.
// ===========================================================================

const CANONICAL_REGISTRY = "https://registry.npmjs.org";

function policyOf(definitionId: string): AdapterPackagePolicy {
	const definition = findAdapterDefinition(definitionId);
	if (!definition) throw new Error(`unknown adapter ${definitionId}`);
	return definition.installPolicy;
}

describe("Adapter Definitions own installer policy (U5 KTD13)", () => {
	test("both definitions declare complete package identity and isolation policy", () => {
		for (const definition of listAdapterDefinitions()) {
			const policy = definition.installPolicy;
			expect(policy.packageName.length).toBeGreaterThan(0);
			expect(policy.canonicalRegistry).toBe(CANONICAL_REGISTRY);
			expect(policy.allowedLockOrigins).toEqual([CANONICAL_REGISTRY]);
			expect(policy.installScope).toBe("user");
			// Approved absolute package-manager resolution strategy: absolute
			// candidates only, never a PATH lookup (R28, path-shadowing defense).
			expect(policy.packageManager.approvedAbsoluteCandidates.length).toBeGreaterThan(0);
			for (const candidate of policy.packageManager.approvedAbsoluteCandidates) {
				expect(candidate.startsWith("/")).toBe(true);
			}
			// No-shell install argv with lifecycle scripts disabled (KTD16/KTD17).
			expect(policy.installArgv[0]).toBe("ci");
			expect(policy.installArgv).toContain("--ignore-scripts");
			// Source-controlled full dependency integrity reference.
			expect(policy.integritySource.manifestPath).toContain(
				`adapter-install/${definition.id}/package.json`,
			);
			expect(policy.integritySource.lockfilePath).toContain(
				`adapter-install/${definition.id}/package-lock.json`,
			);
			expect(policy.expectedBin).toBe(definition.executable);
			// Maintainer-authored operator-choice metadata (KTD18).
			expect(policy.operatorChoice.packageOwner.length).toBeGreaterThan(0);
			expect(policy.operatorChoice.docsUrl).toBe(
				"https://github.com/nathanvale/claude-code-config/blob/main/runtime/browser-connect/REPAIR.md#v1-install_adapter",
			);
			expect(manualAdapterInstallInputsComplete(definition)).toBe(true);
		}
	});

	test("chrome-devtools-mcp is lifecycle-script free; agent-browser requires lifecycle scripts (R29)", () => {
		expect(policyOf("chrome-devtools-mcp").lifecycleScriptsRequired).toBe(false);
		// agent-browser 0.31.2 ships a postinstall native-binary step
		// (hasInstallScript in its genuine lock entry): operator-owned.
		expect(policyOf("agent-browser").lifecycleScriptsRequired).toBe(true);
	});

	test("safe upgrade transitions are an exact allowlist, never semver inference (R21/R22)", () => {
		const chrome = policyOf("chrome-devtools-mcp");
		expect(chrome.safeUpgradeTransitions).toEqual([
			{ from: "1.4.0", to: CHROME_DEVTOOLS_MCP_PINNED_VERSION },
		]);
		expect(policyOf("agent-browser").safeUpgradeTransitions).toEqual([
			{ from: "0.26.0", to: AGENT_BROWSER_PINNED_VERSION },
		]);
		// Exact matches only.
		expect(
			isAllowlistedAdapterUpgrade(chrome, "1.4.0", CHROME_DEVTOOLS_MCP_PINNED_VERSION),
		).toBe(true);
		// A downgrade-shaped observed version is never allowlisted.
		expect(isAllowlistedAdapterUpgrade(chrome, "1.6.0", CHROME_DEVTOOLS_MCP_PINNED_VERSION)).toBe(false);
		// A semver-adjacent but unlisted transition is never inferred safe.
		expect(isAllowlistedAdapterUpgrade(chrome, "1.4.1", CHROME_DEVTOOLS_MCP_PINNED_VERSION)).toBe(false);
		expect(isAllowlistedAdapterUpgrade(chrome, "1.3.0", CHROME_DEVTOOLS_MCP_PINNED_VERSION)).toBe(false);
		// The allowlist target must be the current pin.
		expect(isAllowlistedAdapterUpgrade(chrome, "1.4.0", "1.5.1")).toBe(false);
	});
});

// ===========================================================================
// U5: lock-entry origin validation (R34). Registry-relative or exact
// canonical-origin resolved URLs only; git/file/workspace/HTTP/alternate-
// origin/unparseable entries are violations that stop before network.
// ===========================================================================

function lockWith(entry: Record<string, unknown>): unknown {
	return {
		lockfileVersion: 3,
		packages: {
			"": { name: "fixture", dependencies: { pkg: "1.0.0" } },
			"node_modules/pkg": entry,
		},
	};
}

describe("validateAdapterLockPackages (U5 R34)", () => {
	const policy = policyOf("chrome-devtools-mcp");

	test("the committed chrome-devtools-mcp lockfile has zero violations", async () => {
		const lock = JSON.parse(
			await readFile(policy.integritySource.lockfilePath, "utf8"),
		) as unknown;
		expect(validateAdapterLockPackages(policy, lock)).toEqual([]);
	});

	test("the committed agent-browser lockfile has canonical origins and full integrity", async () => {
		const agentPolicy = policyOf("agent-browser");
		const lock = JSON.parse(
			await readFile(agentPolicy.integritySource.lockfilePath, "utf8"),
		) as unknown;
		expect(validateAdapterLockPackages(agentPolicy, lock)).toEqual([]);
	});

	const violationRows: ReadonlyArray<{
		label: string;
		entry: Record<string, unknown>;
		kind: string;
	}> = [
		{
			label: "git source",
			entry: { version: "1.0.0", resolved: "git+ssh://git@github.com/x/pkg.git#abc", integrity: "sha512-a" },
			kind: "git_source",
		},
		{
			label: "file source",
			entry: { version: "1.0.0", resolved: "file:../pkg", integrity: "sha512-a" },
			kind: "file_source",
		},
		{
			label: "workspace source",
			entry: { version: "1.0.0", resolved: "workspace:*", integrity: "sha512-a" },
			kind: "workspace_source",
		},
		{
			label: "insecure http",
			entry: { version: "1.0.0", resolved: "http://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz", integrity: "sha512-a" },
			kind: "insecure_http",
		},
		{
			label: "alternate origin",
			entry: { version: "1.0.0", resolved: "https://mirror.example.com/pkg/-/pkg-1.0.0.tgz", integrity: "sha512-a" },
			kind: "alternate_origin",
		},
		{
			label: "unparseable url",
			entry: { version: "1.0.0", resolved: "::::not-a-url", integrity: "sha512-a" },
			kind: "unparseable_url",
		},
		{
			label: "missing resolved",
			entry: { version: "1.0.0", integrity: "sha512-a" },
			kind: "missing_resolved",
		},
		{
			label: "link entry",
			entry: { link: true, resolved: "../elsewhere" },
			kind: "link_entry",
		},
	];

	for (const row of violationRows) {
		test(`${row.label} → ${row.kind} violation`, () => {
			const violations = validateAdapterLockPackages(policy, lockWith(row.entry));
			expect(violations.map((violation) => violation.kind)).toContain(row.kind);
		});
	}

	test("missing integrity on a canonical entry → missing_integrity (R29)", () => {
		const violations = validateAdapterLockPackages(
			policy,
			lockWith({
				version: "1.0.0",
				resolved: "https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz",
			}),
		);
		expect(violations.map((violation) => violation.kind)).toEqual(["missing_integrity"]);
	});

	test("an unparseable lock document is a violation, never a pass", () => {
		expect(validateAdapterLockPackages(policy, null).length).toBeGreaterThan(0);
		expect(validateAdapterLockPackages(policy, { packages: null }).length).toBeGreaterThan(0);
		expect(validateAdapterLockPackages(policy, {}).length).toBeGreaterThan(0);
	});
});

// ===========================================================================
// U5: install-policy assessment (typed evidence for U1 policy). File reads
// only — zero network, zero mutation.
// ===========================================================================

type FakeFs = {
	fileExists: (path: string) => Promise<boolean>;
	readTextFile: (path: string) => Promise<string>;
};

const realFs: FakeFs = {
	fileExists: async (path) => {
		try {
			await readFile(path, "utf8");
			return true;
		} catch {
			return false;
		}
	},
	readTextFile: (path) => readFile(path, "utf8"),
};

function overlayFs(overrides: Record<string, string | undefined>): FakeFs {
	return {
		fileExists: async (path) => {
			if (path in overrides) return overrides[path] !== undefined;
			return realFs.fileExists(path);
		},
		readTextFile: async (path) => {
			if (path in overrides) {
				const contents = overrides[path];
				if (contents === undefined) throw new Error(`ENOENT: ${path}`);
				return contents;
			}
			return realFs.readTextFile(path);
		},
	};
}

describe("assessAdapterInstallPolicy (U5 R28/R29 evidence)", () => {
	test("chrome-devtools-mcp with the committed source files → all four gates hold", async () => {
		const assessment = await assessAdapterInstallPolicy(
			chromeDevtoolsMcpDefinition,
			realFs,
		);
		expect(assessment.evidence).toEqual({
			recipe_complete: true,
			lock_origins_canonical: true,
			dependency_integrity_complete: true,
			lifecycle_scripts_disabled: true,
		});
		expect(assessment.stop_causes).toEqual([]);
	});

	test("agent-browser fails only the lifecycle gate with the committed files (R29)", async () => {
		const assessment = await assessAdapterInstallPolicy(agentBrowserDefinition, realFs);
		expect(assessment.evidence.recipe_complete).toBe(true);
		expect(assessment.evidence.lock_origins_canonical).toBe(true);
		expect(assessment.evidence.dependency_integrity_complete).toBe(true);
		expect(assessment.evidence.lifecycle_scripts_disabled).toBe(false);
		expect(assessment.stop_causes).toContain("lifecycle_scripts_required");
	});

	test("missing manifest → recipe incomplete", async () => {
		const policy = chromeDevtoolsMcpDefinition.installPolicy;
		const assessment = await assessAdapterInstallPolicy(
			chromeDevtoolsMcpDefinition,
			overlayFs({ [policy.integritySource.manifestPath]: undefined }),
		);
		expect(assessment.evidence.recipe_complete).toBe(false);
		expect(assessment.stop_causes).toContain("manifest_missing");
	});

	test("manifest pin drift (manifest declares another version) → recipe incomplete", async () => {
		const policy = chromeDevtoolsMcpDefinition.installPolicy;
		const assessment = await assessAdapterInstallPolicy(
			chromeDevtoolsMcpDefinition,
			overlayFs({
				[policy.integritySource.manifestPath]: JSON.stringify({
					name: "fixture",
					dependencies: { [policy.packageName]: "9.9.9" },
				}),
			}),
		);
		expect(assessment.evidence.recipe_complete).toBe(false);
		expect(assessment.stop_causes).toContain("manifest_pin_drift");
	});

	test("lock drift (lock resolves another version than the pin) → recipe incomplete (R29)", async () => {
		const policy = chromeDevtoolsMcpDefinition.installPolicy;
		const assessment = await assessAdapterInstallPolicy(
			chromeDevtoolsMcpDefinition,
			overlayFs({
				[policy.integritySource.lockfilePath]: JSON.stringify({
					lockfileVersion: 3,
					packages: {
						"": { name: "fixture", dependencies: { [policy.packageName]: policy.packageName } },
						[`node_modules/${policy.packageName}`]: {
							version: "1.4.9",
							resolved: `https://registry.npmjs.org/${policy.packageName}/-/${policy.packageName}-1.4.9.tgz`,
							integrity: "sha512-fixture",
						},
					},
				}),
			}),
		);
		expect(assessment.evidence.recipe_complete).toBe(false);
		expect(assessment.stop_causes).toContain("lock_drift");
	});

	test("missing transitive integrity → integrity gate fails (R29/AE18)", async () => {
		const policy = chromeDevtoolsMcpDefinition.installPolicy;
		const assessment = await assessAdapterInstallPolicy(
			chromeDevtoolsMcpDefinition,
			overlayFs({
				[policy.integritySource.lockfilePath]: JSON.stringify({
					lockfileVersion: 3,
					packages: {
						"": { name: "fixture", dependencies: { [policy.packageName]: policy.packageName } },
						[`node_modules/${policy.packageName}`]: {
							version: chromeDevtoolsMcpDefinition.pinnedVersion,
							resolved: `https://registry.npmjs.org/${policy.packageName}/-/${policy.packageName}-${chromeDevtoolsMcpDefinition.pinnedVersion}.tgz`,
						},
					},
				}),
			}),
		);
		expect(assessment.evidence.dependency_integrity_complete).toBe(false);
		expect(assessment.stop_causes).toContain("integrity_incomplete");
	});

	test("off-registry lock URL → canonical-origin gate fails with zero network (R34/AE23)", async () => {
		const policy = chromeDevtoolsMcpDefinition.installPolicy;
		const assessment = await assessAdapterInstallPolicy(
			chromeDevtoolsMcpDefinition,
			overlayFs({
				[policy.integritySource.lockfilePath]: JSON.stringify({
					lockfileVersion: 3,
					packages: {
						"": { name: "fixture", dependencies: { [policy.packageName]: policy.packageName } },
						[`node_modules/${policy.packageName}`]: {
							version: chromeDevtoolsMcpDefinition.pinnedVersion,
							resolved: `https://evil.example.com/${policy.packageName}.tgz`,
							integrity: "sha512-fixture",
						},
					},
				}),
			}),
		);
		expect(assessment.evidence.lock_origins_canonical).toBe(false);
		expect(assessment.stop_causes).toContain("lock_origin_violation");
	});
});

describe("resolveApprovedPackageManagerExecutable (U5 R28)", () => {
	const policy = policyOf("chrome-devtools-mcp");

	test("returns the first existing approved absolute candidate", async () => {
		const candidates = policy.packageManager.approvedAbsoluteCandidates;
		const resolved = await resolveApprovedPackageManagerExecutable(policy, {
			fileExists: async (path) => path === candidates[1],
		});
		expect(resolved).toBe(candidates[1]);
	});

	test("returns undefined when no approved candidate exists (never a PATH fallback)", async () => {
		const resolved = await resolveApprovedPackageManagerExecutable(policy, {
			fileExists: async () => false,
		});
		expect(resolved).toBeUndefined();
	});

	test("ignores relative candidates even when they exist (path-shadowing defense)", async () => {
		const shadowed: AdapterPackagePolicy = {
			...policy,
			packageManager: { approvedAbsoluteCandidates: ["npm", "./npm", policy.packageManager.approvedAbsoluteCandidates[0] ?? "/usr/bin/npm"] },
		};
		const resolved = await resolveApprovedPackageManagerExecutable(shadowed, {
			fileExists: async () => true,
		});
		expect(resolved?.startsWith("/")).toBe(true);
	});
});

describe("buildIsolatedInstallerEnvironment (U5 R28/AE17)", () => {
	const staging = "/neutral/staging-root";
	const input = {
		baseEnv: {
			PATH: "/usr/bin:/bin",
			HOME: "/Users/someone",
			TMPDIR: "/tmp",
			// Hostile inherited configuration that must never reach the child:
			NPM_CONFIG_REGISTRY: "https://evil.example.com",
			npm_config_registry: "https://evil.example.com",
			NPM_TOKEN: "secret-token",
			NODE_AUTH_TOKEN: "secret-token",
			NPM_CONFIG__AUTH: "secret",
			npm_config_userconfig: "/attacker/.npmrc",
			HTTPS_PROXY: "http://attacker:8080",
			HTTP_PROXY: "http://attacker:8080",
			ALL_PROXY: "http://attacker:8080",
		},
		canonicalRegistry: CANONICAL_REGISTRY,
		stagingDir: staging,
		userConfigPath: `${staging}/.npmrc`,
		globalConfigPath: `${staging}/.npmrc-global`,
		cachePath: `${staging}/.npm-cache`,
	};

	test("drops every inherited registry, auth, and proxy variable (allowlist, not blocklist)", () => {
		const env = buildIsolatedInstallerEnvironment(input);
		for (const key of Object.keys(env)) {
			expect(key.toLowerCase()).not.toContain("token");
			expect(key.toLowerCase()).not.toContain("auth");
			expect(key.toLowerCase()).not.toContain("proxy");
		}
		expect(env.NPM_CONFIG_REGISTRY).toBeUndefined();
		expect(env.npm_config_registry).toBe(CANONICAL_REGISTRY);
		expect(JSON.stringify(env)).not.toContain("evil.example.com");
		expect(JSON.stringify(env)).not.toContain("secret-token");
		expect(JSON.stringify(env)).not.toContain("attacker");
	});

	test("pins registry, isolated config files, cache, and non-interactive posture", () => {
		const env = buildIsolatedInstallerEnvironment(input);
		expect(env.npm_config_registry).toBe(CANONICAL_REGISTRY);
		expect(env.npm_config_userconfig).toBe(`${staging}/.npmrc`);
		expect(env.npm_config_globalconfig).toBe(`${staging}/.npmrc-global`);
		expect(env.npm_config_cache).toBe(`${staging}/.npm-cache`);
		expect(env.npm_config_ignore_scripts).toBe("true");
		expect(env.CI).toBe("1");
		// The child still gets the pass-through basics it needs to run node.
		expect(env.PATH).toBe("/usr/bin:/bin");
		expect(env.HOME).toBe("/Users/someone");
	});
});

// ===========================================================================
// U5: structured provenance and probe causes (R11) — policy selects repair
// from these typed fields, never from detail strings.
// ===========================================================================

describe("structured adapter evidence (U5 R11)", () => {
	test("unresolvable executable → cause executable_absent", async () => {
		const { runtime } = fakeRuntime({ resolution: { resolved: false } });
		const result = await chromeDevtoolsMcpDefinition.checkProvenance(runtime);
		expect(result.installed).toBe(false);
		if (!result.installed) {
			expect(result.cause).toBe("executable_absent");
			expect(result.observedVersion).toBeUndefined();
		}
	});

	test("version mismatch → cause version_mismatch with the safe observed version", async () => {
		const { runtime } = fakeRuntime({ respond: versionResponder("1.4.0") });
		const result = await chromeDevtoolsMcpDefinition.checkProvenance(runtime);
		expect(result.installed).toBe(false);
		if (!result.installed) {
			expect(result.cause).toBe("version_mismatch");
			expect(result.observedVersion).toBe("1.4.0");
		}
	});

	test("unreadable version output → version_mismatch with no observed version projected", async () => {
		const { runtime } = fakeRuntime({
			respond: () => ({ exitCode: 0, stdout: "no version here", stderr: "" }),
		});
		const result = await agentBrowserDefinition.checkProvenance(runtime);
		expect(result.installed).toBe(false);
		if (!result.installed) {
			expect(result.cause).toBe("version_mismatch");
			expect(result.observedVersion).toBeUndefined();
		}
	});

	test("missing binary on the version read → cause executable_absent", async () => {
		const { runtime } = fakeRuntime({
			respond: () => ({ exitCode: 127, stdout: "", stderr: "command not found" }),
		});
		const result = await agentBrowserDefinition.checkProvenance(runtime);
		expect(result.installed).toBe(false);
		if (!result.installed) {
			expect(result.cause).toBe("executable_absent");
		}
	});

	test("probe timeout → transient_probe_failure; nonzero exit → probe_failed (R23)", async () => {
		const timedOut = fakeRuntime({
			respond: () => ({ exitCode: 1, stdout: "", stderr: "", timedOut: true }),
		});
		const timeoutResult = await chromeDevtoolsMcpDefinition.probeAttachment(
			timedOut.runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(timeoutResult.attached).toBe(false);
		if (!timeoutResult.attached) {
			expect(timeoutResult.cause).toBe("transient_probe_failure");
		}

		const refused = fakeRuntime({
			respond: () => ({ exitCode: 3, stdout: "", stderr: "cannot reach cdp" }),
		});
		const refusedResult = await chromeDevtoolsMcpDefinition.probeAttachment(
			refused.runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(refusedResult.attached).toBe(false);
		if (!refusedResult.attached) {
			expect(refusedResult.cause).toBe("probe_failed");
		}
	});
});
