import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { REQUIRED_PROTOTYPE_SOURCES } from "./prerequisites";
import {
	FACADE_PACKAGE,
	type PackageResolution,
	type PreflightOptions,
	REQUIRED_REPLAY_PACKAGES,
	checkFacadePackage,
	checkReplayDependencies,
	parseArgv,
	runPreflight,
} from "./preflight-prerequisites";

const cleanupPaths: string[] = [];

afterEach(async () => {
	await Promise.all(
		cleanupPaths
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function makeCompletePrototypeTree(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "bdm-preflight-"));
	cleanupPaths.push(root);
	for (const source of REQUIRED_PROTOTYPE_SOURCES) {
		await mkdir(join(root, source.path), { recursive: true });
	}
	return root;
}

/** Resolver stub: every named package resolves to a fixed version. */
function resolveAll(version = "9.9.9"): PackageResolution {
	return { resolved: true, version };
}

/** Resolver stub that resolves everything except the named misses. */
function resolverExcept(...missing: string[]) {
	return (name: string): PackageResolution =>
		missing.includes(name) ? { resolved: false, version: null } : resolveAll();
}

async function readyOptions(): Promise<PreflightOptions> {
	const repoRoot = await makeCompletePrototypeTree();
	return {
		repoRoot,
		scriptDir: repoRoot,
		resolvePackage: () => resolveAll(),
	};
}

describe("preflight happy path", () => {
	test("all prerequisites present returns ready and lists checked surfaces", async () => {
		const result = await runPreflight(await readyOptions());

		expect(result.ok).toBe(true);
		expect(result.contract).toBe("browser-domain-memory.prerequisites");
		expect(result.surfaces).toEqual([
			"prototype_evidence",
			"replay_dependencies",
			"facade_package",
		]);
		expect(result.repair_actions).toEqual([]);
	});
});

describe("preflight failure shapes (characterization-first)", () => {
	test("missing prototype: not ready, names the missing source path", async () => {
		const repoRoot = await makeCompletePrototypeTree();
		await rm(join(repoRoot, "prototypes/browser-use-uplift/recorder-json"), {
			recursive: true,
			force: true,
		});

		const result = await runPreflight({
			repoRoot,
			scriptDir: repoRoot,
			resolvePackage: () => resolveAll(),
		});

		expect(result.ok).toBe(false);
		expect(result.repair_actions.join("\n")).toContain(
			"prototypes/browser-use-uplift/recorder-json",
		);
	});

	test("missing root replay dependency: names @puppeteer/replay", async () => {
		const repoRoot = await makeCompletePrototypeTree();
		const result = await runPreflight({
			repoRoot,
			scriptDir: repoRoot,
			resolvePackage: resolverExcept("@puppeteer/replay"),
		});

		expect(result.ok).toBe(false);
		expect(result.repair_actions.join("\n")).toContain("@puppeteer/replay");
	});

	test("missing puppeteer-core: explains it is the driver, not the optional peer", async () => {
		const checks = await checkReplayDependencies({
			repoRoot: "/tmp/whatever",
			resolvePackage: resolverExcept("puppeteer-core"),
		});

		const failure = checks.find((c) => c.id === "puppeteer-core");
		expect(failure?.ok).toBe(false);
		expect(failure?.detail).toContain("optional peer");
	});

	test("missing facade: names the package and the script-local path", async () => {
		const checks = await checkFacadePackage({
			scriptDir: "/tmp/whatever",
			resolvePackage: () => ({ resolved: false, version: null }),
		});

		expect(checks[0]?.ok).toBe(false);
		expect(checks[0]?.detail).toContain(FACADE_PACKAGE);
		expect(checks[0]?.detail).toContain(
			"skills/browser-domain-memory/scripts/",
		);
		// No TypeScript stack leaks: the detail is a setup diagnostic.
		expect(checks[0]?.detail).not.toContain("Cannot find module");
	});
});

describe("preflight scope guard", () => {
	test("exposes only prototype, replay, and facade surfaces", async () => {
		const result = await runPreflight(await readyOptions());
		// No capture, replay, config, storage, auth, or promotion command surfaces.
		expect(new Set(result.surfaces)).toEqual(
			new Set(["prototype_evidence", "replay_dependencies", "facade_package"]),
		);
	});

	test("replay package list is exactly the two approved deps", () => {
		expect(REQUIRED_REPLAY_PACKAGES.map((p) => p.name)).toEqual([
			"@puppeteer/replay",
			"puppeteer-core",
		]);
	});
});

describe("replay dependency readiness (real resolution)", () => {
	test("both deps resolve from repo root and report their versions", async () => {
		// No resolver stub: exercise the real createRequire surface from the
		// repo root, proving the declared root deps resolve where deterministic
		// replay code will load them (R5) -- not from a sibling skill's link.
		const checks = await checkReplayDependencies();

		const replay = checks.find((c) => c.id === "@puppeteer/replay");
		const core = checks.find((c) => c.id === "puppeteer-core");
		expect(replay?.ok).toBe(true);
		expect(replay?.detail).toContain("@puppeteer/replay@");
		expect(core?.ok).toBe(true);
		expect(core?.detail).toContain("puppeteer-core@");
	});
});

describe("argv parsing", () => {
	test("--json runs in json mode", () => {
		expect(parseArgv(["--json"])).toEqual({ kind: "run", json: true });
	});

	test("no args runs in plain mode", () => {
		expect(parseArgv([])).toEqual({ kind: "run", json: false });
	});

	test("--help and --version are recognized", () => {
		expect(parseArgv(["--help"]).kind).toBe("help");
		expect(parseArgv(["--version"]).kind).toBe("version");
	});

	test("unknown argument is a usage error", () => {
		const parsed = parseArgv(["--capture"]);
		expect(parsed.kind).toBe("usage_error");
	});
});
