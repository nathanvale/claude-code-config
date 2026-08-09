import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import type { VaultGitReceipt } from "../src/model.ts";
import {
	createReceiptStore,
	launchCapabilityProcess,
	type VaultGitDurabilityOperation,
} from "../src/store.ts";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("private receipt store", () => {
	test("persists immutable history and a separate current pointer with private modes", async () => {
		const root = await fixtureRoot();
		const store = createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" });
		const first = receipt({ revision: 1, phase: "intent_durable" });
		await store.initialize(first, {
			ownerCapability: new Uint8Array([1, 2, 3]),
			joinCapability: new Uint8Array([4, 5, 6]),
		});
		await store.append({ ...first, revision: 2, phase: "writing", leaseGeneration: "a".repeat(40) });

		const loaded = await store.load();
		expect(loaded).toMatchObject({ status: "loaded", receipt: { revision: 2, phase: "writing" } });
		if (loaded.status !== "loaded") throw new Error("fixture receipt missing");
		expect(loaded.history.map((entry) => entry.revision)).toEqual([1, 2]);
		expect((await stat(store.paths.repositoryRoot)).mode & 0o777).toBe(0o700);
		for (const path of [store.paths.current, ...loaded.historyPaths, store.capabilityPath(first.receiptId, "owner")]) {
			expect((await stat(path)).mode & 0o777).toBe(0o600);
		}
		expect(await store.readCapability(first.receiptId, "join")).toEqual(new Uint8Array([4, 5, 6]));
		expect(JSON.stringify(loaded.history)).not.toContain("Capability");
	});

	test("uses temp write, file sync, rename, then parent-directory sync for every durable file", async () => {
		const root = await fixtureRoot();
		const operations: VaultGitDurabilityOperation[] = [];
		const store = createReceiptStore({
			stateRoot: root,
			repositoryIdentity: "vault@example",
			onDurabilityOperation(operation) { operations.push(operation); },
		});
		await store.initialize(receipt(), {
			ownerCapability: new Uint8Array([1]),
			joinCapability: new Uint8Array([2]),
		});
		for (let index = 0; index < operations.length; index += 4) {
			expect(operations.slice(index, index + 4).map((entry) => entry.kind)).toEqual([
				"temp_write", "file_sync", "rename", "directory_sync",
			]);
		}
	});

	test("fails closed when directory sync cannot establish durability", async () => {
		const root = await fixtureRoot();
		const store = createReceiptStore({
			stateRoot: root,
			repositoryIdentity: "vault@example",
			onDurabilityOperation(operation) {
				if (operation.kind === "directory_sync") throw new Error("unsupported");
			},
		});
		await expect(store.initialize(receipt(), {
			ownerCapability: new Uint8Array([1]), joinCapability: new Uint8Array([2]),
		})).rejects.toThrow("receipt durability unavailable");
	});

	for (const crashAt of ["temp_write", "file_sync", "rename", "directory_sync"] as const) {
		test(`keeps readable evidence after interruption at ${crashAt}`, async () => {
			const root = await fixtureRoot();
			let crash = false;
			const store = createReceiptStore({
				stateRoot: root,
				repositoryIdentity: "vault@example",
				onDurabilityOperation(operation) {
					if (crash && operation.kind === crashAt) throw new Error("crash");
				},
			});
			const first = receipt();
			await store.initialize(first, { ownerCapability: new Uint8Array([1]), joinCapability: new Uint8Array([2]) });
			crash = true;
			await expect(store.append({ ...first, revision: 2, phase: "writing", leaseGeneration: "a".repeat(40) })).rejects.toThrow();
			const loaded = await createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" }).load();
			expect(loaded.status).toBe("loaded");
		});
	}

	test("rejects truncated, legacy, and conflicting receipts", async () => {
		for (const candidate of ["{", JSON.stringify({ schemaVersion: 0 }), JSON.stringify({ ...receipt(), capabilityMaterial: "forbidden" })]) {
			const root = await fixtureRoot();
			const store = createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" });
			await store.initialize(receipt(), { ownerCapability: new Uint8Array([1]), joinCapability: new Uint8Array([2]) });
			await writeFile(store.paths.current, candidate, { mode: 0o600 });
			expect((await store.load()).status).toBe("corrupt");
		}

		const root = await fixtureRoot();
		const store = createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" });
		await store.initialize(receipt(), { ownerCapability: new Uint8Array([1]), joinCapability: new Uint8Array([2]) });
		const current = JSON.parse(await readFile(store.paths.current, "utf8"));
		current.actor = "conflicting-actor";
		await writeFile(store.paths.current, `${JSON.stringify(current)}\n`, { mode: 0o600 });
		expect((await store.load()).status).toBe("conflict");
	});

	test("fails closed when a receipt loses owner-only permissions", async () => {
		const root = await fixtureRoot();
		const store = createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" });
		await store.initialize(receipt(), { ownerCapability: new Uint8Array([1]), joinCapability: new Uint8Array([2]) });
		await chmod(store.paths.current, 0o644);
		expect(await store.load()).toMatchObject({ status: "corrupt" });
		await chmod(store.paths.current, 0o600);
		await chmod(store.paths.repositoryRoot, 0o755);
		expect(await store.load()).toMatchObject({ status: "corrupt" });
	});

	test("passes role capability bytes only through an inherited descriptor", async () => {
		const root = await fixtureRoot();
		const script = join(root, "reader.ts");
		await writeFile(script, [
			'import { readFileSync } from "node:fs";',
			'const index = process.argv.indexOf("--capability-fd");',
			'const descriptor = Number(process.argv[index + 1]);',
			'const bytes = readFileSync(descriptor);',
			'process.stdout.write("received:" + bytes.byteLength);',
			'process.stdout.write(" argv:" + process.argv.join("|").includes("secret-owner"));',
			'process.stdout.write(" env:" + JSON.stringify(process.env).includes("secret-owner"));',
		].join("\n"));
		const store = createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" });
		const first = receipt();
		await store.initialize(first, {
			ownerCapability: new TextEncoder().encode("secret-owner"),
			joinCapability: new TextEncoder().encode("secret-join"),
		});
		const launched = await launchCapabilityProcess(store, {
			receiptId: first.receiptId,
			role: "owner",
			command: process.execPath,
			args: [script],
			cwd: root,
			timeoutMs: 5_000,
		});
		expect(launched).toEqual({ exitCode: 0, stdout: "received:12 argv:false env:false", stderr: "", timedOut: false });
		expect(JSON.stringify(launched)).not.toContain("secret-owner");
	});

	test("retains closed history when a new current transaction starts", async () => {
		const root = await fixtureRoot();
		const store = createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" });
		const first = receipt();
		await store.initialize(first, { ownerCapability: new Uint8Array([1]), joinCapability: new Uint8Array([2]) });
		await store.append({ ...first, revision: 2, phase: "closed", transition: "closed", nextSafeAction: "none" });
		const second = receipt({
			receiptId: "receipt_22222222222222222222222222222222",
			diagnosticsReference: "receipt:receipt_22222222222222222222222222222222",
		});
		await store.initialize(second, { ownerCapability: new Uint8Array([3]), joinCapability: new Uint8Array([4]) });
		expect(await store.load()).toMatchObject({
			status: "loaded",
			receipt: { receiptId: second.receiptId, revision: 1 },
		});
		expect((await readdir(store.paths.history)).length).toBe(3);
	});
});

async function fixtureRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vault-git-store-"));
	roots.push(root);
	await chmod(root, 0o700);
	return root;
}

function receipt(overrides: Partial<VaultGitReceipt> = {}): VaultGitReceipt {
	return {
		schemaVersion: 1,
		receiptId: "receipt_11111111111111111111111111111111",
		transactionId: null,
		revision: 1,
		phase: "intent_durable",
		transition: "acquisition_intent",
		recordedAt: "2026-08-09T00:00:00.000Z",
		event: "note_created",
		actor: "agent-a",
		host: "laptop",
		ownedPaths: [{ path: "notes/example.md", baselineHash: null, admittedNewFile: true }],
		localMainHead: "b".repeat(40),
		remoteMainHead: "b".repeat(40),
		expectedLeaseGeneration: null,
		leaseGeneration: null,
		leaseAcquiredAt: null,
		leaseDurationMs: 60_000,
		commitId: null,
		nextSafeAction: "retry_remote",
		diagnosticsReference: "receipt:receipt_11111111111111111111111111111111",
		...overrides,
	};
}
