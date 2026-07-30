import { afterAll, describe, expect, test } from "bun:test";
import {
	mkdir,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import {
	createBrowserUseAdminAuthorityReceiptStore,
	type BrowserUseAdminAuthorityCoordinates,
} from "./browser-use-admin-authority-receipt";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";

const disposables: { dispose(): void }[] = [];

afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

const COORDINATES: BrowserUseAdminAuthorityCoordinates = {
	lane_digest: "1".repeat(64),
	principal_digest: "2".repeat(64),
	vault_digest: "3".repeat(64),
};

async function fixture() {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error("paths refused");
	return {
		fs,
		paths: opened.paths,
		store: createBrowserUseAdminAuthorityReceiptStore({
			fs,
			paths: opened.paths,
			clock: () => 1_000,
		}),
	};
}

describe("admin read-authority receipt", () => {
	test("missing receipt remains a typed missing state", async () => {
		const { store } = await fixture();

		expect(await store.inspect(COORDINATES)).toEqual({ state: "missing" });
	});

	test("records only bounded digests and proves the exact standing authority", async () => {
		const { fs, paths, store } = await fixture();

		const recorded = await store.record(COORDINATES);
		expect(recorded).toEqual({
			ok: true,
			receipt_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
		expect(await store.inspect(COORDINATES)).toEqual({
			state: "proven",
			receipt_digest:
				recorded.ok ? recorded.receipt_digest : "unreachable",
		});

		const raw = await fs.readTextFile(paths.state.authAuthorityReceiptFile);
		expect(raw).toContain('"authority":"read-item-only"');
		expect(raw).not.toContain("service-account-1");
		expect(raw).not.toContain("vault-1");
		expect(raw).not.toContain("OP_SERVICE_ACCOUNT_TOKEN");
		expect(await fs.lstat(paths.state.authAuthorityReceiptFile)).toMatchObject({
			kind: "file",
			mode: 0o600,
			uid: process.getuid?.(),
		});
	});

	test("principal, vault, or lane drift invalidates the receipt", async () => {
		const { store } = await fixture();
		expect((await store.record(COORDINATES)).ok).toBe(true);

		for (const field of [
			"lane_digest",
			"principal_digest",
			"vault_digest",
		] as const) {
			expect(
				await store.inspect({
					...COORDINATES,
					[field]: "f".repeat(64),
				}),
			).toEqual({ state: "invalid" });
		}
	});

	test("rejects corrupt, extra-field, loose-mode, and symlink receipts whole", async () => {
		const { fs, paths, store } = await fixture();
		const path = paths.state.authAuthorityReceiptFile;
		const outside = `${path}.outside`;

		await fs.writeFileDurable(path, "{", 0o600);
		expect(await store.inspect(COORDINATES)).toEqual({ state: "invalid" });

		await fs.writeFileDurable(
			path,
			`${JSON.stringify({
				contract: "browser-use.admin-authority-receipt",
				schema_version: "1",
				authority: "read-item-only",
				...COORDINATES,
				recorded_at_epoch_ms: 1_000,
				operator_email: "operator@example.test",
			})}\n`,
			0o600,
		);
		expect(await store.inspect(COORDINATES)).toEqual({ state: "invalid" });

		await fs.chmod(path, 0o644);
		expect(await store.inspect(COORDINATES)).toEqual({ state: "invalid" });
		await fs.chmod(path, 0o700);
		expect(await store.inspect(COORDINATES)).toEqual({ state: "invalid" });

		await fs.unlink(path);
		await fs.writeFileDurable(outside, "outside\n", 0o600);
		await symlink(outside, path);
		expect(await store.inspect(COORDINATES)).toEqual({ state: "invalid" });
	});

	test("a challenged record repairs corrupt or symlinked receipt state without touching the link target", async () => {
		const { fs, paths, store } = await fixture();
		const path = paths.state.authAuthorityReceiptFile;
		const outside = `${path}.outside`;

		await fs.writeFileDurable(path, "{", 0o600);
		expect((await store.record(COORDINATES)).ok).toBe(true);
		expect((await store.inspect(COORDINATES)).state).toBe("proven");

		await fs.unlink(path);
		await fs.writeFileDurable(outside, "outside\n", 0o600);
		await symlink(outside, path);
		expect((await store.record(COORDINATES)).ok).toBe(true);
		expect(await fs.readTextFile(outside)).toBe("outside\n");
		expect((await store.inspect(COORDINATES)).state).toBe("proven");
	});

	test("a FIFO receipt is refused without blocking", async () => {
		const { paths, store } = await fixture();
		const fifo = Bun.spawn([
			"mkfifo",
			paths.state.authAuthorityReceiptFile,
		]);
		expect(await fifo.exited).toBe(0);

		expect(await store.inspect(COORDINATES)).toEqual({ state: "invalid" });
	});

	test("an ancestor swap cannot redirect receipt inspection or publication", async () => {
		const { paths } = await fixture();
		const stateRoot = paths.resolution.roots.state;
		const originalRoot = `${stateRoot}.original`;
		const attackerRoot = `${stateRoot}.attacker`;
		await mkdir(attackerRoot, { mode: 0o700 });
		const attackerReceipt = `${attackerRoot}/admin-authority-receipt.json`;
		await writeFile(attackerReceipt, "attacker\n", { mode: 0o600 });

		let inspectSwapped = false;
		const inspectStore = createBrowserUseAdminAuthorityReceiptStore({
			fs: createDefaultPlatformFs(),
			paths,
			clock: () => 1_000,
			afterDirectoryOpenedForTest: async () => {
				if (inspectSwapped) return;
				inspectSwapped = true;
				await rename(stateRoot, originalRoot);
				await symlink(attackerRoot, stateRoot);
			},
		});
		try {
			expect(await inspectStore.inspect(COORDINATES)).not.toMatchObject({
				state: "proven",
			});
			expect(await readFile(attackerReceipt, "utf8")).toBe("attacker\n");
		} finally {
			await rm(stateRoot);
			await rename(originalRoot, stateRoot);
		}

		let writeOpenCount = 0;
		const recordStore = createBrowserUseAdminAuthorityReceiptStore({
			fs: createDefaultPlatformFs(),
			paths,
			clock: () => 1_000,
			afterDirectoryOpenedForTest: async () => {
				writeOpenCount += 1;
				if (writeOpenCount !== 2) return;
				await rename(stateRoot, originalRoot);
				await symlink(attackerRoot, stateRoot);
			},
		});
		try {
			expect((await recordStore.record(COORDINATES)).ok).toBe(true);
			expect(await readFile(attackerReceipt, "utf8")).toBe("attacker\n");
		} finally {
			await rm(stateRoot);
			await rename(originalRoot, stateRoot);
			await rm(attackerRoot, { recursive: true });
		}
	});
});
