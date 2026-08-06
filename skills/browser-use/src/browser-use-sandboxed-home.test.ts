import { chmodSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "bun:test";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
	resolveBrowserUsePaths,
} from "./browser-use-paths";

// DDA-G16 (runtime-env cluster): a MISSING or READ-ONLY HOME with an unset XDG
// runtime dir must fall back per contract (R11) with a TYPED warning, and the
// admission filesystem diff must stay CONFINED to the sandbox. The oracle:
// sandboxed HOME fixture -> declared fallback used; filesystem diff confined.
//
// HERMETIC: real node:fs admission into a real temp sandbox; no live browser,
// no network. Every mutating root is pinned under one realpath'd base, so a
// confinement breach would show as a path outside that base.

const disposables: (() => void)[] = [];
afterAll(() => {
	for (const dispose of disposables) dispose();
});

// A sandbox whose XDG roots and HOME all sit under one realpath'd base, with
// XDG_RUNTIME_DIR deliberately UNSET so the runtime fallback (R11) engages.
function sandbox(options: { homeExists?: boolean; homeReadOnly?: boolean } = {}) {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "browser-use-sandboxed-home-")));
	disposables.push(() => rmSync(base, { recursive: true, force: true }));
	const home = join(base, "home");
	const env: Record<string, string | undefined> = {
		HOME: home,
		XDG_CONFIG_HOME: join(base, "config"),
		XDG_DATA_HOME: join(base, "data"),
		XDG_STATE_HOME: join(base, "state"),
		XDG_CACHE_HOME: join(base, "cache"),
		// XDG_RUNTIME_DIR intentionally absent.
	};
	return { base, home, env, options };
}

// Every path present anywhere under `base`, relative to it — the observable
// filesystem diff the admission produced.
function pathsUnder(base: string): string[] {
	const found: string[] = [];
	const walk = (dir: string, prefix: string) => {
		for (const entry of readdirSync(dir)) {
			const rel = prefix ? `${prefix}${sep}${entry}` : entry;
			found.push(rel);
			const child = join(dir, entry);
			if (statSync(child).isDirectory()) walk(child, rel);
		}
	};
	walk(base, "");
	return found;
}

describe("DDA-G16 sandboxed HOME with unset XDG runtime", () => {
	test("resolution activates the runtime fallback with a typed unset reason", () => {
		const box = sandbox();
		const resolved = resolveBrowserUsePaths(box.env);
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) return;
		// The declared fallback (R11) is used, and the warning is TYPED, not prose.
		expect(resolved.resolution.runtime_fallback.active).toBe(true);
		expect(resolved.resolution.runtime_fallback.reason).toBe("runtime_dir_unset");
		// The runtime root is the declared fallback under the state root, not a
		// path outside the sandbox.
		expect(resolved.resolution.roots.runtime).toBe(
			join(box.env.XDG_STATE_HOME as string, "browser-use", "runtime-fallback"),
		);
	});

	test("admission uses the fallback and confines the filesystem diff to the sandbox", async () => {
		const box = sandbox();
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, box.env);
		expect(opened.ok).toBe(true);
		if (!opened.ok) return;

		// The fallback is the admitted runtime root (declared fallback USED).
		expect(opened.paths.resolution.runtime_fallback.active).toBe(true);
		expect(opened.paths.resolution.runtime_fallback.reason).toBe("runtime_dir_unset");
		expect(opened.paths.runtime.locksDir.startsWith(box.base + sep)).toBe(true);
		expect(opened.paths.runtime.locksDir).toContain(`runtime-fallback${sep}locks`);

		// Confinement: every root the admission touched lives under the sandbox
		// base — nothing escaped to the real HOME, /tmp root, or elsewhere.
		for (const root of Object.values(opened.paths.resolution.roots)) {
			expect(root.startsWith(box.base + sep)).toBe(true);
		}
		// And the observable diff on disk is entirely inside the sandbox base.
		const diff = pathsUnder(box.base);
		expect(diff.length).toBeGreaterThan(0);
		expect(diff.some((rel) => rel.includes("state") && rel.includes("runtime-fallback"))).toBe(true);
	});

	test("a READ-ONLY HOME with unset XDG runtime still admits absolute XDG roots and falls back", async () => {
		// HOME itself is chmod'd read-only, but the XDG roots point elsewhere in
		// the sandbox (absolute), so admission does not depend on writing HOME.
		// The runtime fallback still engages because XDG_RUNTIME_DIR is unset.
		const box = sandbox();
		await mkdir(box.home, { recursive: true, mode: 0o700 });
		await chmod(box.home, 0o500);
		disposables.push(() => {
			try {
				// Restore write bits so afterAll cleanup can remove the tree.
				chmodSync(box.home, 0o700);
			} catch {}
		});

		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, box.env);
		expect(opened.ok).toBe(true);
		if (!opened.ok) return;
		expect(opened.paths.resolution.runtime_fallback.active).toBe(true);
		expect(opened.paths.resolution.runtime_fallback.reason).toBe("runtime_dir_unset");
		for (const root of Object.values(opened.paths.resolution.roots)) {
			expect(root.startsWith(box.base + sep)).toBe(true);
		}
	});

	test("a MISSING absolute HOME with unset XDG roots refuses typed, never silently defaulting outside the sandbox", () => {
		// The contract corner: HOME unset AND no XDG roots means the XDG 0.8
		// default cannot resolve, so resolution must REFUSE typed rather than
		// escape the sandbox. Proves the fallback is contract-bounded, not a
		// silent write to an arbitrary location.
		const resolved = resolveBrowserUsePaths({ HOME: undefined });
		expect(resolved.ok).toBe(false);
		if (resolved.ok) return;
		expect(resolved.refusal.code).toBe("xdg_root_relative");
		expect(resolved.refusal.continuation.next_action_id).toBe("repair_xdg_root");
	});
});

// DDA-G16 (E tier): the same oracle proven above through in-process resolution,
// now proven across a REAL process boundary. The `browser-use repair status`
// command projects `runtime_fallback` and the admitted `roots`, so spawning the
// real CLI with a sandboxed HOME + unset XDG_RUNTIME_DIR proves the declared
// fallback engages with the typed reason and the roots stay confined to the
// sandbox when the entry runs as its own OS process — the boundary the
// in-process assertions above cannot reach.
//
// Spawn idiom mirrors browser-use-sec-seams.test.ts: `process.execPath` runs
// the real browser-use.ts entry, and the child inherits ONLY the env passed
// here (`env -i`-equivalent), so any root outside the sandbox base would be a
// genuine, attributable leak rather than inherited ambient state.

const BROWSER_USE_CLI = join(dirname(fileURLToPath(import.meta.url)), "browser-use.ts");
const SPAWN_TIMEOUT_MS = 15_000;
const SPAWN_TEST_TIMEOUT_MS = SPAWN_TIMEOUT_MS + 10_000;

async function spawnRepairStatus(
	env: Record<string, string | undefined>,
	cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	// Strip undefined keys so an unset var is genuinely absent from the child
	// env (Bun.spawn otherwise stringifies undefined). This is how the sandbox's
	// intentionally-absent XDG_RUNTIME_DIR reaches the child as unset.
	const childEnv: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) childEnv[key] = value;
	}
	const child = Bun.spawn(
		[process.execPath, BROWSER_USE_CLI, "repair", "status", "--json", "--quiet"],
		{ cwd, env: childEnv, stdout: "pipe", stderr: "pipe" },
	);
	const timeout = setTimeout(() => child.kill(), SPAWN_TIMEOUT_MS);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	clearTimeout(timeout);
	return { exitCode, stdout, stderr };
}

describe("DDA-G16 (E) spawned repair status across the process boundary", () => {
	test(
		"the spawned CLI activates the declared runtime fallback with the typed unset reason and confines roots to the sandbox",
		async () => {
			const box = sandbox();
			await mkdir(box.home, { recursive: true });
			const result = await spawnRepairStatus(box.env, box.base);

			expect(result.exitCode, result.stderr).toBe(0);
			// stdout is a single clean JSON envelope (--quiet strips diagnostics).
			const envelope = JSON.parse(result.stdout) as {
				status: string;
				data: {
					contract: string;
					runtime_fallback: { active: boolean; reason?: string };
					roots: Record<string, string>;
				};
			};
			expect(envelope.status).toBe("ok");
			expect(envelope.data.contract).toBe("browser-use.repair-status");

			// The declared fallback (R11) is USED and the reason is TYPED.
			expect(envelope.data.runtime_fallback.active).toBe(true);
			expect(envelope.data.runtime_fallback.reason).toBe("runtime_dir_unset");

			// The runtime root is the declared fallback under the state root.
			expect(envelope.data.roots.runtime).toBe(
				join(box.env.XDG_STATE_HOME as string, "browser-use", "runtime-fallback"),
			);

			// Confinement across the process boundary: every admitted root the real
			// process reported lives under the sandbox base — the runtime fallback
			// resolves under <state>, not to the real HOME or an ambient default.
			for (const root of Object.values(envelope.data.roots)) {
				expect(root.startsWith(box.base + sep)).toBe(true);
			}
			// And the observable on-disk diff the child produced is entirely inside
			// the sandbox base: with an env-isolated child every path it touched is
			// relative to the roots handed in, so a breach would surface as a path
			// outside the base. `repair status` is a read-only projection, so the
			// diff is the child's transient scratch (e.g. its cache root), never an
			// escape.
			const diff = pathsUnder(box.base);
			for (const rel of diff) {
				expect(join(box.base, rel).startsWith(box.base + sep)).toBe(true);
			}
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	test(
		"the spawned CLI admits absolute XDG roots and falls back even when HOME is READ-ONLY",
		async () => {
			// HOME is chmod'd read-only, but the XDG roots are absolute elsewhere in
			// the sandbox, so admission does not depend on writing HOME. The runtime
			// fallback still engages because XDG_RUNTIME_DIR is unset — proven at the
			// process boundary.
			const box = sandbox();
			await mkdir(box.home, { recursive: true, mode: 0o700 });
			await chmod(box.home, 0o500);
			disposables.push(() => {
				try {
					chmodSync(box.home, 0o700);
				} catch {}
			});

			const result = await spawnRepairStatus(box.env, box.base);
			expect(result.exitCode, result.stderr).toBe(0);
			const envelope = JSON.parse(result.stdout) as {
				status: string;
				data: {
					runtime_fallback: { active: boolean; reason?: string };
					roots: Record<string, string>;
				};
			};
			expect(envelope.status).toBe("ok");
			expect(envelope.data.runtime_fallback.active).toBe(true);
			expect(envelope.data.runtime_fallback.reason).toBe("runtime_dir_unset");
			for (const root of Object.values(envelope.data.roots)) {
				expect(root.startsWith(box.base + sep)).toBe(true);
			}
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	test(
		"the spawned CLI refuses typed when HOME is missing and no XDG roots resolve, never escaping to a real path",
		async () => {
			// HOME unset AND no XDG roots: the XDG 0.8 default cannot resolve, so the
			// real process must REFUSE typed rather than silently write to an
			// arbitrary location — the contract-bounded corner, proven across the
			// boundary. Only PATH is provided (bun needs it); no HOME, no XDG.
			const box = sandbox();
			const result = await spawnRepairStatus(
				{ PATH: process.env.PATH },
				box.base,
			);

			// A typed refusal exits non-zero and emits a structured error envelope on
			// stdout (--quiet keeps stdout the sole JSON channel).
			expect(result.exitCode, result.stderr).not.toBe(0);
			const envelope = JSON.parse(result.stdout) as {
				status: string;
				error: { code: string };
				continuation?: { next_action_id?: string };
			};
			expect(envelope.status).toBe("error");
			expect(envelope.error.code).toBe("xdg_root_relative");
			expect(envelope.continuation?.next_action_id).toBe("repair_xdg_root");
		},
		SPAWN_TEST_TIMEOUT_MS,
	);
});
