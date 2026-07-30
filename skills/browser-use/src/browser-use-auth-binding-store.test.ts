import { afterAll, describe, expect, test } from "bun:test";
import {
	chmod,
	mkdir,
	readFile,
	rename,
	symlink,
} from "node:fs/promises";
import { join } from "node:path";
import type {
	BrowserUseItemBinding,
	BrowserUseResolvedAuthCandidate,
} from "./browser-use-auth-bindings";
import {
	createBrowserUseAuthBindingStore,
	isPrivateBindingFileMetadataAdmitted,
} from "./browser-use-auth-binding-store";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";

const disposables: { dispose(): void }[] = [];

afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

function resolution(
	overrides: Partial<BrowserUseResolvedAuthCandidate> = {},
): BrowserUseResolvedAuthCandidate {
	return {
		generation_id: "generation-a",
		activation_epoch: 4,
		auth_context_ref: "oncore-session",
		route_digest: "a".repeat(64),
		candidate_digest: "b".repeat(64),
		candidate: {
			candidate_id: "candidate-oncore",
			service_id: "oncore",
			auth_context: "interactive-login",
			legacy_context_prose: null,
			hint_item_id: null,
			proposed_origins: ["https://portal.example.com"],
			legacy_vault_name: null,
			provenance: "legacy-auth-pointer",
		},
		...overrides,
	};
}

function binding(
	overrides: Partial<BrowserUseItemBinding> = {},
): BrowserUseItemBinding {
	return {
		service_id: "oncore",
		service_account_id: "service-account-1",
		auth_context: "interactive-login",
		allowed_origins: ["https://portal.example.com"],
		allowed_login_paths: ["/login"],
		vault_id: "vault-1",
		item_id: "item-1",
		item_revision: 7,
		allowed_auth_methods: ["password", "otp"],
		binding_revision: 1,
		...overrides,
	};
}

describe("host-lifetime auth binding cache", () => {
	test("refuses a traversal-shaped candidate id through the typed store seam", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error("paths refused");
		const store = createBrowserUseAuthBindingStore({
			paths: opened.paths,
		});

		const unsafeResolution = resolution({
			candidate: {
				...resolution().candidate,
				candidate_id: "../escape",
			},
		});
		expect(await store.load(unsafeResolution)).toEqual({
			ok: false,
			failure: {
				code: "auth_binding_cache_invalid",
				message: "the auth binding cache coordinate is invalid.",
			},
		});
		expect(await store.save({
			resolution: unsafeResolution,
			binding: binding(),
		})).toMatchObject({
			ok: false,
			failure: { code: "auth_binding_cache_invalid" },
		});
	});

	test("refuses a symlinked auth-bindings directory without writing its target", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error("paths refused");
		const outside = join(xdg.base, "outside");
		await mkdir(outside, { mode: 0o700 });
		await symlink(outside, opened.paths.state.authBindingsDir);
		const store = createBrowserUseAuthBindingStore({
			paths: opened.paths,
		});

		expect(await store.save({
			resolution: resolution(),
			binding: binding(),
		})).toEqual({
			ok: false,
			failure: {
				code: "auth_binding_cache_unavailable",
				message: "the host binding cache path failed private-directory admission.",
			},
		});
		await expect(
			readFile(join(outside, "candidate-oncore.json"), "utf8"),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("refuses a state root replaced by a symlink after path admission", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error("paths refused");
		const stateRoot = opened.paths.resolution.roots.state;
		const movedState = join(xdg.base, "moved-state");
		await rename(stateRoot, movedState);
		await symlink(movedState, stateRoot);
		const store = createBrowserUseAuthBindingStore({
			paths: opened.paths,
		});

		expect(await store.save({
			resolution: resolution(),
			binding: binding(),
		})).toEqual({
			ok: false,
			failure: {
				code: "auth_binding_cache_unavailable",
				message: "the host binding cache path failed private-directory admission.",
			},
		});
	});

	test("refuses a symlinked binding file instead of following valid external bytes", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error("paths refused");
		const store = createBrowserUseAuthBindingStore({
			paths: opened.paths,
		});
		expect(await store.save({
			resolution: resolution(),
			binding: binding(),
		})).toEqual({ ok: true });
		const bindingPath = opened.paths.state.authBindingFile("candidate-oncore");
		const outsidePath = join(xdg.base, "outside-binding.json");
		await rename(bindingPath, outsidePath);
		await symlink(outsidePath, bindingPath);

		expect(await store.load(resolution())).toEqual({
			ok: false,
			failure: {
				code: "auth_binding_cache_unavailable",
				message: "the host binding cache file failed private-file admission.",
			},
		});
		expect(await store.save({
			resolution: resolution(),
			binding: binding(),
		})).toMatchObject({
			ok: false,
			failure: { code: "auth_binding_cache_unavailable" },
		});
		expect(await store.invalidate(resolution())).toEqual({
			ok: false,
			failure: {
				code: "auth_binding_cache_unavailable",
				message: "the host binding cache file failed private-file admission.",
			},
		});
		expect(await readFile(outsidePath, "utf8")).toContain(
			"browser-use.auth-binding-cache",
		);
	});

	test("refuses cache state whose owner does not match the admitted process owner", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error("paths refused");
		const writer = createBrowserUseAuthBindingStore({
			paths: opened.paths,
		});
		expect(await writer.save({
			resolution: resolution(),
			binding: binding(),
		})).toEqual({ ok: true });
		const wrongOwnerStore = createBrowserUseAuthBindingStore({
			paths: opened.paths,
			expectedOwnerUid: (process.getuid?.() ?? 0) + 1,
		});

		expect(await wrongOwnerStore.load(resolution())).toEqual({
			ok: false,
			failure: {
				code: "auth_binding_cache_unavailable",
				message: "the host binding cache path failed private-directory admission.",
			},
		});
	});

	test("refuses unsafe binding descriptor metadata independently of directory admission", () => {
		const ownerUid = process.getuid?.() ?? 0;
		const admitted = {
			is_file: true,
			uid: ownerUid,
			mode: 0o100600,
			nlink: 1,
			size: 1_024,
		};
		expect(isPrivateBindingFileMetadataAdmitted(admitted, ownerUid)).toBe(true);
		expect(
			isPrivateBindingFileMetadataAdmitted(
				{ ...admitted, uid: ownerUid + 1 },
				ownerUid,
			),
		).toBe(false);
		expect(
			isPrivateBindingFileMetadataAdmitted(
				{ ...admitted, nlink: 2 },
				ownerUid,
			),
		).toBe(false);
		expect(
			isPrivateBindingFileMetadataAdmitted(
				{ ...admitted, size: 64 * 1_024 + 1 },
				ownerUid,
			),
		).toBe(false);
	});

	test("refuses loose directory and file modes instead of repairing them in place", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error("paths refused");
		const store = createBrowserUseAuthBindingStore({
			paths: opened.paths,
		});
		expect(await store.save({
			resolution: resolution(),
			binding: binding(),
		})).toEqual({ ok: true });

		await chmod(opened.paths.state.authBindingsDir, 0o755);
		expect(await store.load(resolution())).toMatchObject({
			ok: false,
			failure: { code: "auth_binding_cache_unavailable" },
		});
		expect(await store.save({
			resolution: resolution(),
			binding: binding(),
		})).toMatchObject({
			ok: false,
			failure: { code: "auth_binding_cache_unavailable" },
		});

		await chmod(opened.paths.state.authBindingsDir, 0o700);
		await chmod(
			opened.paths.state.authBindingFile("candidate-oncore"),
			0o644,
		);
		expect(await store.load(resolution())).toEqual({
			ok: false,
			failure: {
				code: "auth_binding_cache_unavailable",
				message: "the host binding cache file failed private-file admission.",
			},
		});
		expect(await store.save({
			resolution: resolution(),
			binding: binding(),
		})).toMatchObject({
			ok: false,
			failure: { code: "auth_binding_cache_unavailable" },
		});
	});

	test("an ancestor swap after directory admission cannot redirect publication", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error("paths refused");
		const outside = join(xdg.base, "outside");
		const movedBindings = join(xdg.base, "moved-bindings");
		await mkdir(outside, { mode: 0o700 });
		let swapped = false;
		const store = createBrowserUseAuthBindingStore({
			paths: opened.paths,
			async afterDirectoryOpenedForTest() {
				if (swapped) return;
				swapped = true;
				await rename(opened.paths.state.authBindingsDir, movedBindings);
				await symlink(outside, opened.paths.state.authBindingsDir);
			},
		});

		expect(await store.save({
			resolution: resolution(),
			binding: binding(),
		})).toEqual({ ok: true });
		await expect(
			readFile(join(outside, "candidate-oncore.json"), "utf8"),
		).rejects.toMatchObject({ code: "ENOENT" });
		expect(
			await readFile(join(movedBindings, "candidate-oncore.json"), "utf8"),
		).toContain("browser-use.auth-binding-cache");
	});

	test("persists only secret-free provenance and invalidates a new generation", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error("paths refused");
		const store = createBrowserUseAuthBindingStore({
			paths: opened.paths,
		});

		expect(
			await store.save({
				resolution: resolution(),
				binding: binding(),
			}),
		).toEqual({ ok: true });
		expect(await store.load(resolution())).toEqual({
			ok: true,
			binding: binding(),
		});

		const stale = await store.load(
			resolution({
				generation_id: "generation-b",
				activation_epoch: 5,
			}),
		);
		expect(stale).toEqual({
			ok: false,
			failure: {
				code: "auth_binding_cache_stale",
				message:
					"the host binding cache does not match the captured auth generation.",
			},
		});

		const raw = await fs.readTextFile(
			opened.paths.state.authBindingFile("candidate-oncore"),
		);
		expect(raw).not.toContain("ops_");
	});

	test("invalidates one admitted binding and remains idempotent when absent", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error("paths refused");
		const store = createBrowserUseAuthBindingStore({
			paths: opened.paths,
		});

		expect(await store.save({
			resolution: resolution(),
			binding: binding(),
		})).toEqual({ ok: true });
		expect(await store.load(resolution())).toEqual({
			ok: true,
			binding: binding(),
		});

		expect(await store.invalidate(resolution())).toEqual({ ok: true });
		expect(await store.load(resolution())).toEqual({
			ok: true,
			binding: null,
		});
		expect(await store.invalidate(resolution())).toEqual({ ok: true });
	});
});
