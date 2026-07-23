import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import {
	BROWSER_USE_ROOT_KINDS,
	type BrowserUsePlatformFs,
	admitBrowserUseRoot,
	createDefaultPlatformFs,
	openBrowserUsePaths,
	resolveBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
	makeVolatileOverlayFs,
	type VolatileOverlayFs,
} from "./browser-use-platform-test-helpers";

// =========================================================================
// XDG path owner proof (platform plan 2026-07-21-002 U2).
//
// Ledger rows S1-S6 and S19: default/override/relative/unwritable roots,
// symlinked ancestor, loose permissions + version-controlled ancestor, and
// the warned non-secret runtime fallback. Every refusal carries exactly one
// repair_xdg_root continuation (AE4). The closing block smoke-proves the
// volatile-overlay substrate handed to the store/locks/retention tests (the
// S7+ fault-injection seams live here so downstream owners inherit a proven
// fake, not an untested one).
// =========================================================================

const realFs = createDefaultPlatformFs();
const xdg = makeTempXdgEnv();
const overlays: VolatileOverlayFs[] = [];

function makeOverlay(): VolatileOverlayFs {
	const overlay = makeVolatileOverlayFs();
	overlays.push(overlay);
	return overlay;
}

afterAll(() => {
	xdg.dispose();
	for (const overlay of overlays) {
		overlay.dispose();
	}
});

describe("pure XDG resolution (R7/R11; S1-S3)", () => {
	test("S1: unset variables resolve the four XDG 0.8 defaults plus the runtime fallback", () => {
		const resolved = resolveBrowserUsePaths({ HOME: "/home/agent" });
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) throw new Error("unreachable");
		expect(resolved.resolution.roots).toEqual({
			config: "/home/agent/.config/browser-use",
			data: "/home/agent/.local/share/browser-use",
			state: "/home/agent/.local/state/browser-use",
			cache: "/home/agent/.cache/browser-use",
			runtime: "/home/agent/.local/state/browser-use/runtime-fallback",
		});
		expect(resolved.resolution.runtime_fallback).toEqual({
			active: true,
			reason: "runtime_dir_unset",
		});
	});

	test("S1: empty-string XDG values mean unset (XDG 0.8), so defaults apply", () => {
		const resolved = resolveBrowserUsePaths({
			HOME: "/home/agent",
			XDG_CONFIG_HOME: "",
			XDG_STATE_HOME: "",
		});
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) throw new Error("unreachable");
		expect(resolved.resolution.roots.config).toBe(
			"/home/agent/.config/browser-use",
		);
		expect(resolved.resolution.roots.state).toBe(
			"/home/agent/.local/state/browser-use",
		);
	});

	test("S2: absolute overrides win over defaults for all five variables", () => {
		const resolved = resolveBrowserUsePaths({
			HOME: "/home/agent",
			XDG_CONFIG_HOME: "/roots/config",
			XDG_DATA_HOME: "/roots/data",
			XDG_STATE_HOME: "/roots/state",
			XDG_CACHE_HOME: "/roots/cache",
			XDG_RUNTIME_DIR: "/roots/runtime",
		});
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) throw new Error("unreachable");
		expect(resolved.resolution.roots).toEqual({
			config: "/roots/config/browser-use",
			data: "/roots/data/browser-use",
			state: "/roots/state/browser-use",
			cache: "/roots/cache/browser-use",
			runtime: "/roots/runtime/browser-use",
		});
		expect(resolved.resolution.runtime_fallback).toEqual({ active: false });
		for (const kind of BROWSER_USE_ROOT_KINDS) {
			expect(resolved.resolution.roots[kind].startsWith("/")).toBe(true);
		}
	});

	test("S3: a SET-but-relative XDG value is a typed refusal with exactly one repair continuation", () => {
		const resolved = resolveBrowserUsePaths({
			HOME: "/home/agent",
			XDG_STATE_HOME: "./rel",
		});
		expect(resolved.ok).toBe(false);
		if (resolved.ok) throw new Error("unreachable");
		expect(resolved.refusal.code).toBe("xdg_root_relative");
		expect(resolved.refusal.root_kind).toBe("state");
		// Exactly one continuation, naming the env var to fix (AE4).
		expect(resolved.refusal.continuation).toEqual({
			next_action_id: "repair_xdg_root",
			summary: expect.stringContaining("XDG_STATE_HOME"),
		});
		// The refusal never echoes the configured value.
		expect(resolved.refusal.message).not.toContain("./");
	});

	test("a relative XDG_RUNTIME_DIR is not a refusal — it activates the warned fallback (R11)", () => {
		const resolved = resolveBrowserUsePaths({
			HOME: "/home/agent",
			XDG_RUNTIME_DIR: "run/tmp",
		});
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) throw new Error("unreachable");
		expect(resolved.resolution.runtime_fallback).toEqual({
			active: true,
			reason: "runtime_dir_unsafe",
		});
		expect(resolved.resolution.roots.runtime).toBe(
			"/home/agent/.local/state/browser-use/runtime-fallback",
		);
	});

	test("an unset HOME with a defaulted root is a typed refusal, never a guessed path", () => {
		const resolved = resolveBrowserUsePaths({});
		expect(resolved.ok).toBe(false);
		if (resolved.ok) throw new Error("unreachable");
		expect(resolved.refusal.code).toBe("xdg_root_relative");
		expect(resolved.refusal.root_kind).toBe("config");
		expect(resolved.refusal.continuation.next_action_id).toBe("repair_xdg_root");
	});
});

describe("root admission (R12; S4-S6)", () => {
	test("a missing root is created private (0700) and admission is idempotent", async () => {
		const root = join(xdg.base, "created", "browser-use");
		const first = await admitBrowserUseRoot(realFs, { kind: "state", path: root });
		expect(first).toEqual({ ok: true });
		const second = await admitBrowserUseRoot(realFs, { kind: "state", path: root });
		expect(second).toEqual({ ok: true });
		const stat = await realFs.lstat(root);
		expect(stat?.kind).toBe("directory");
		expect(stat?.mode).toBe(0o700);
		// The writability probe never leaves residue behind.
		expect(await realFs.readDirectory(root)).toEqual([]);
	});

	test("S4: an unwritable root fails the admission probe with xdg_root_unwritable", async () => {
		const root = join(xdg.base, "unwritable-root");
		mkdirSync(root, { recursive: true });
		chmodSync(root, 0o500);
		const admitted = await admitBrowserUseRoot(realFs, {
			kind: "state",
			path: root,
		});
		expect(admitted.ok).toBe(false);
		if (admitted.ok) throw new Error("unreachable");
		expect(admitted.refusal.code).toBe("xdg_root_unwritable");
		expect(admitted.refusal.continuation.next_action_id).toBe("repair_xdg_root");
		chmodSync(root, 0o700);
	});

	test("S5: a symlinked path component refuses with xdg_root_symlink_ancestor", async () => {
		const target = join(xdg.base, "symlink-target");
		mkdirSync(target, { recursive: true, mode: 0o700 });
		const link = join(xdg.base, "symlinked-parent");
		symlinkSync(target, link);
		const admitted = await admitBrowserUseRoot(realFs, {
			kind: "data",
			path: join(link, "browser-use"),
		});
		expect(admitted.ok).toBe(false);
		if (admitted.ok) throw new Error("unreachable");
		expect(admitted.refusal.code).toBe("xdg_root_symlink_ancestor");
		expect(admitted.refusal.root_kind).toBe("data");
	});

	test("S6: an existing root with group/other bits refuses with xdg_root_permissions_loose", async () => {
		const root = join(xdg.base, "loose-root");
		mkdirSync(root, { recursive: true });
		chmodSync(root, 0o755);
		const admitted = await admitBrowserUseRoot(realFs, {
			kind: "config",
			path: root,
		});
		expect(admitted.ok).toBe(false);
		if (admitted.ok) throw new Error("unreachable");
		expect(admitted.refusal.code).toBe("xdg_root_permissions_loose");
		// Admission never auto-chmods an existing root; repair is explicit.
		expect((await realFs.lstat(root))?.mode).toBe(0o755);
	});

	test("S6: a version-controlled ancestor fails closed; the check-ignored seam admits", async () => {
		const repo = join(xdg.base, "repo");
		mkdirSync(join(repo, ".git"), { recursive: true });
		const root = join(repo, "state", "browser-use");
		const refused = await admitBrowserUseRoot(realFs, {
			kind: "state",
			path: root,
		});
		expect(refused.ok).toBe(false);
		if (refused.ok) throw new Error("unreachable");
		expect(refused.refusal.code).toBe("xdg_root_version_controlled");
		const admitted = await admitBrowserUseRoot(realFs, {
			kind: "state",
			path: root,
			checkIgnored: async () => true,
		});
		expect(admitted).toEqual({ ok: true });
	});

	test("a throwing check-ignored seam fails closed on a version-controlled ancestor", async () => {
		const root = join(xdg.base, "repo", "state", "browser-use");
		const admitted = await admitBrowserUseRoot(realFs, {
			kind: "state",
			path: root,
			checkIgnored: async () => {
				throw new Error("git unavailable");
			},
		});
		expect(admitted.ok).toBe(false);
		if (admitted.ok) throw new Error("unreachable");
		expect(admitted.refusal.code).toBe("xdg_root_version_controlled");
	});

	test("an existing root owned by another uid refuses with xdg_root_wrong_owner", async () => {
		const root = join(xdg.base, "foreign-root");
		const foreignUid = (process.getuid?.() ?? 0) + 1;
		const stub: BrowserUsePlatformFs = {
			...realFs,
			lstat: async (path) =>
				path === root
					? { kind: "directory", mode: 0o700, uid: foreignUid, dev: 1 }
					: realFs.lstat(path),
		};
		const admitted = await admitBrowserUseRoot(stub, {
			kind: "cache",
			path: root,
		});
		expect(admitted.ok).toBe(false);
		if (admitted.ok) throw new Error("unreachable");
		expect(admitted.refusal.code).toBe("xdg_root_wrong_owner");
	});
});

describe("openBrowserUsePaths + runtime fallback (R11; S19, AE4)", () => {
	test("S19: no XDG_RUNTIME_DIR puts locks under <state>/runtime-fallback created 0700 with the warned flag", async () => {
		const scoped = makeTempXdgEnv();
		try {
			const opened = await openBrowserUsePaths(realFs, scoped.env);
			expect(opened.ok).toBe(true);
			if (!opened.ok) throw new Error("unreachable");
			const fallbackRoot = join(
				scoped.env.XDG_STATE_HOME as string,
				"browser-use",
				"runtime-fallback",
			);
			expect(opened.paths.resolution.runtime_fallback).toEqual({
				active: true,
				reason: "runtime_dir_unset",
			});
			expect(opened.paths.resolution.roots.runtime).toBe(fallbackRoot);
			expect(opened.paths.runtime.locksDir).toBe(join(fallbackRoot, "locks"));
			expect(opened.paths.runtime.socketsDir).toBe(join(fallbackRoot, "sockets"));
			const stat = await realFs.lstat(fallbackRoot);
			expect(stat?.kind).toBe("directory");
			expect(stat?.mode).toBe(0o700);
		} finally {
			scoped.dispose();
		}
	});

	test("an absolute admitted XDG_RUNTIME_DIR keeps the runtime root live (no fallback)", async () => {
		const scoped = makeTempXdgEnv();
		try {
			const runtimeDir = join(scoped.base, "runtime");
			const opened = await openBrowserUsePaths(realFs, {
				...scoped.env,
				XDG_RUNTIME_DIR: runtimeDir,
			});
			expect(opened.ok).toBe(true);
			if (!opened.ok) throw new Error("unreachable");
			expect(opened.paths.resolution.runtime_fallback).toEqual({ active: false });
			expect(opened.paths.resolution.roots.runtime).toBe(
				join(runtimeDir, "browser-use"),
			);
			expect((await realFs.lstat(join(runtimeDir, "browser-use")))?.mode).toBe(
				0o700,
			);
		} finally {
			scoped.dispose();
		}
	});

	test("a runtime root failing admission falls back warned instead of refusing (R11)", async () => {
		const scoped = makeTempXdgEnv();
		try {
			const target = join(scoped.base, "runtime-target");
			mkdirSync(target, { recursive: true, mode: 0o700 });
			const link = join(scoped.base, "runtime-link");
			symlinkSync(target, link);
			const opened = await openBrowserUsePaths(realFs, {
				...scoped.env,
				XDG_RUNTIME_DIR: link,
			});
			expect(opened.ok).toBe(true);
			if (!opened.ok) throw new Error("unreachable");
			expect(opened.paths.resolution.runtime_fallback).toEqual({
				active: true,
				reason: "runtime_dir_unsafe",
			});
			expect(opened.paths.resolution.roots.runtime).toBe(
				join(scoped.env.XDG_STATE_HOME as string, "browser-use", "runtime-fallback"),
			);
		} finally {
			scoped.dispose();
		}
	});

	test("a refusal from any root surfaces unchanged through openBrowserUsePaths (AE4)", async () => {
		const scoped = makeTempXdgEnv();
		try {
			const opened = await openBrowserUsePaths(realFs, {
				...scoped.env,
				XDG_CACHE_HOME: "relative-cache",
			});
			expect(opened.ok).toBe(false);
			if (opened.ok) throw new Error("unreachable");
			expect(opened.refusal.code).toBe("xdg_root_relative");
			expect(opened.refusal.root_kind).toBe("cache");
			expect(opened.refusal.continuation.next_action_id).toBe("repair_xdg_root");
		} finally {
			scoped.dispose();
		}
	});

	test("the Target XDG Shape derives every state/cache/runtime path in one place", async () => {
		const scoped = makeTempXdgEnv();
		try {
			const opened = await openBrowserUsePaths(realFs, scoped.env);
			expect(opened.ok).toBe(true);
			if (!opened.ok) throw new Error("unreachable");
			const stateRoot = opened.paths.resolution.roots.state;
			expect(opened.paths.state.runsDir).toBe(join(stateRoot, "runs"));
			expect(opened.paths.state.runFile("run-1")).toBe(
				join(stateRoot, "runs", "run-1", "run.json"),
			);
			expect(opened.paths.state.outcomesDir).toBe(join(stateRoot, "outcomes"));
			expect(opened.paths.state.artifactsDir).toBe(join(stateRoot, "artifacts"));
			expect(opened.paths.state.artifactDir("run-1")).toBe(
				join(stateRoot, "artifacts", "run-1"),
			);
			expect(opened.paths.state.migrationsDir).toBe(join(stateRoot, "migrations"));
			expect(opened.paths.state.generationsDir).toBe(
				join(stateRoot, "generations"),
			);
			expect(opened.paths.state.leasesDir).toBe(join(stateRoot, "leases"));
			expect(opened.paths.state.epochFile).toBe(
				join(stateRoot, "activation-epoch.json"),
			);
			const cacheRoot = opened.paths.resolution.roots.cache;
			expect(opened.paths.cache).toEqual({
				indexesDir: join(cacheRoot, "indexes"),
				compiledDir: join(cacheRoot, "compiled"),
				probesDir: join(cacheRoot, "probes"),
			});
			expect(opened.paths.config.root).toBe(opened.paths.resolution.roots.config);
			expect(opened.paths.data.root).toBe(opened.paths.resolution.roots.data);
		} finally {
			scoped.dispose();
		}
	});

	test("run-scoped path derivation refuses ids that are not a single path segment", async () => {
		const scoped = makeTempXdgEnv();
		try {
			const opened = await openBrowserUsePaths(realFs, scoped.env);
			expect(opened.ok).toBe(true);
			if (!opened.ok) throw new Error("unreachable");
			expect(() => opened.paths.state.runFile("../escape")).toThrow(TypeError);
			expect(() => opened.paths.state.artifactDir("a/b")).toThrow(TypeError);
			expect(() => opened.paths.state.runFile("")).toThrow(TypeError);
		} finally {
			scoped.dispose();
		}
	});
});

describe("volatile overlay substrate (S7+ fault-injection seam handoff)", () => {
	test("admission runs against the overlay with fictitious roots (second port adapter)", async () => {
		const overlay = makeOverlay();
		const opened = await openBrowserUsePaths(overlay.fs, { HOME: "/home/agent" });
		expect(opened.ok).toBe(true);
		if (!opened.ok) throw new Error("unreachable");
		expect(opened.paths.resolution.runtime_fallback.active).toBe(true);
		expect(
			(await overlay.fs.lstat("/home/agent/.local/state/browser-use"))?.mode,
		).toBe(0o700);
	});

	test("durable writes survive crash(); plain writes are discarded", async () => {
		const overlay = makeOverlay();
		await overlay.fs.mkdir("/store", { recursive: true, mode: 0o700 });
		await overlay.fs.writeFileDurable("/store/durable.json", "durable", 0o600);
		await overlay.fs.writeFile("/store/volatile.json", "volatile", 0o600);
		overlay.crash();
		expect(await overlay.fs.readTextFile("/store/durable.json")).toBe("durable");
		await expect(
			overlay.fs.readTextFile("/store/volatile.json"),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("a rename stays volatile until syncDirectory promotes it (old, never torn)", async () => {
		const overlay = makeOverlay();
		await overlay.fs.mkdir("/store", { recursive: true, mode: 0o700 });
		await overlay.fs.writeFileDurable("/store/rec.json", "old", 0o600);
		await overlay.fs.writeFileDurable("/store/rec.json.tmp", "new", 0o600);
		await overlay.fs.rename("/store/rec.json.tmp", "/store/rec.json");
		expect(await overlay.fs.readTextFile("/store/rec.json")).toBe("new");
		overlay.crash();
		// Crash before the dir flush: the OLD record survives intact and the
		// durable temp file remains as an orphan (crash-after-file-flush).
		expect(await overlay.fs.readTextFile("/store/rec.json")).toBe("old");
		expect(await overlay.fs.readTextFile("/store/rec.json.tmp")).toBe("new");
		// Rename again, this time flushing the directory: NEW survives.
		await overlay.fs.rename("/store/rec.json.tmp", "/store/rec.json");
		await overlay.fs.syncDirectory("/store");
		overlay.crash();
		expect(await overlay.fs.readTextFile("/store/rec.json")).toBe("new");
		await expect(
			overlay.fs.readTextFile("/store/rec.json.tmp"),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("crash() inside onBeforeFsync aborts the in-flight durable write (crash-before-flush)", async () => {
		const overlay = makeOverlay();
		await overlay.fs.mkdir("/store", { recursive: true, mode: 0o700 });
		overlay.hooks.onBeforeFsync = () => {
			overlay.crash();
		};
		await expect(
			overlay.fs.writeFileDurable("/store/never.json", "x", 0o600),
		).rejects.toMatchObject({ code: "ESIMCRASH" });
		overlay.hooks.onBeforeFsync = undefined;
		await expect(
			overlay.fs.readTextFile("/store/never.json"),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("failRenameExdev arms a { code: EXDEV } rename and leaves the target untouched", async () => {
		const overlay = makeOverlay();
		await overlay.fs.mkdir("/store", { recursive: true, mode: 0o700 });
		await overlay.fs.writeFileDurable("/store/target.json", "kept", 0o600);
		await overlay.fs.writeFileDurable("/store/incoming.json", "next", 0o600);
		overlay.failRenameExdev = true;
		await expect(
			overlay.fs.rename("/store/incoming.json", "/store/target.json"),
		).rejects.toMatchObject({ code: "EXDEV" });
		overlay.failRenameExdev = false;
		expect(await overlay.fs.readTextFile("/store/target.json")).toBe("kept");
	});

	test("pauseAfterRead() forces the two-writer lost-update interleaving", async () => {
		const overlay = makeOverlay();
		await overlay.fs.mkdir("/store", { recursive: true, mode: 0o700 });
		await overlay.fs.writeFileDurable("/store/shared.json", "v1", 0o600);
		const pause = overlay.pauseAfterRead();
		const order: string[] = [];
		const paused = overlay.fs.readTextFile("/store/shared.json").then((value) => {
			order.push(`stale-read:${value}`);
			return value;
		});
		await pause.reached;
		// The second writer lands while the first still holds its stale read.
		await overlay.fs.writeFileDurable("/store/shared.json", "v2", 0o600);
		order.push("second-writer:v2");
		pause.release();
		expect(await paused).toBe("v1");
		expect(order).toEqual(["second-writer:v2", "stale-read:v1"]);
	});

	test("fixedClock advances only by hand (the injectable clock's second adapter)", () => {
		const clock = fixedClock();
		expect(clock.now()).toBe(1_000);
		clock.advance(500);
		expect(clock.now()).toBe(1_500);
		clock.set(9_000);
		expect(clock.now()).toBe(9_000);
	});
});
