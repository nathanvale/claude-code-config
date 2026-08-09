import { execFileSync } from "node:child_process";
import { closeSync, constants, openSync } from "node:fs";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { readInheritedCapability } from "../src/clock.ts";
import type { VaultGitReceipt } from "../src/model.ts";
import {
	createNodeVaultGitDurabilityPort,
	createReceiptStore,
	launchCapabilityProcess,
	type VaultGitDurabilityOperation,
	type VaultGitDurabilityPort,
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

	test("drives every load-bearing operation through the durability port in publish order", async () => {
		const root = await fixtureRoot();
		const calls: PortCall[] = [];
		const store = createReceiptStore({
			stateRoot: root,
			repositoryIdentity: "vault@example",
			durability: recordingPort(calls),
		});
		const first = receipt();
		await store.initialize(first, { ownerCapability: new Uint8Array([1]), joinCapability: new Uint8Array([2]) });
		expect(calls).toEqual([
			...linkedFile("history"),
			...renamedFile("capability"),
			...renamedFile("capability"),
			...linkedFile("current"),
		]);
		calls.length = 0;
		await store.append({ ...first, revision: 2, phase: "writing", leaseGeneration: "a".repeat(40) });
		expect(calls).toEqual([...linkedFile("history"), ...renamedFile("current")]);
	});

	test("initialize interrupted before any durability phase leaves absent or readable state", async () => {
		const complete: PortCall[] = [];
		const baselineRoot = await fixtureRoot();
		await createReceiptStore({
			stateRoot: baselineRoot,
			repositoryIdentity: "vault@example",
			durability: recordingPort(complete),
		}).initialize(receipt(), { ownerCapability: new Uint8Array([1]), joinCapability: new Uint8Array([2]) });
		expect(complete.length).toBeGreaterThan(0);
		for (let crashAt = 0; crashAt < complete.length; crashAt++) {
			const root = await fixtureRoot();
			const store = createReceiptStore({
				stateRoot: root,
				repositoryIdentity: "vault@example",
				durability: recordingPort([], crashAt),
			});
			await expect(store.initialize(receipt(), {
				ownerCapability: new Uint8Array([1]), joinCapability: new Uint8Array([2]),
			})).rejects.toThrow("receipt durability unavailable");
			const probe = await createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" }).load();
			expect(["absent", "loaded"]).toContain(probe.status);
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

	test("persists exact atomic-close recovery evidence and refuses legacy v1 receipts", async () => {
		const root = await fixtureRoot();
		const store = createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" });
		const first = receipt();
		await store.initialize(first, {
			ownerCapability: new Uint8Array([1]),
			joinCapability: new Uint8Array([2]),
		});
		const expectedMainCommit = "c".repeat(40);
		const ledgerReleaseId = "d".repeat(40);
		await store.append({
			...first,
			revision: 2,
			phase: "push_pending",
			transition: "push_outcome_unknown",
			commitId: expectedMainCommit,
			expectedMainCommit,
			ledgerReleaseId,
			pushOutcome: "unknown",
			nextSafeAction: "retry_push",
		});
		expect(await store.load()).toMatchObject({
			status: "loaded",
			receipt: {
				expectedMainCommit,
				ledgerReleaseId,
				pushOutcome: "unknown",
			},
		});

		const legacyRoot = await fixtureRoot();
		const legacyStore = createReceiptStore({ stateRoot: legacyRoot, repositoryIdentity: "vault@example" });
		await expect(
			legacyStore.initialize({ ...receipt(), schemaVersion: 1 } as never, {
				ownerCapability: new Uint8Array([1]),
				joinCapability: new Uint8Array([2]),
			}),
		).rejects.toThrow("receipt schema invalid");
	});

	test("validateCapability accepts only exact same-length role bytes", async () => {
		const root = await fixtureRoot();
		const store = createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" });
		const first = receipt();
		await store.initialize(first, {
			ownerCapability: new Uint8Array([7, 8, 9]),
			joinCapability: new Uint8Array([1, 2, 3]),
		});
		expect(await store.validateCapability(first.receiptId, "owner", new Uint8Array([7, 8, 9]))).toBe(true);
		expect(await store.validateCapability(first.receiptId, "owner", new Uint8Array([7, 8, 0]))).toBe(false);
		expect(await store.validateCapability(first.receiptId, "owner", new Uint8Array([7, 8]))).toBe(false);
		expect(await store.validateCapability(first.receiptId, "join", new Uint8Array([1, 2, 3]))).toBe(true);
	});

	test("issues and atomically consumes one private doctor token without recording its bytes", async () => {
		const root = await fixtureRoot();
		const store = createReceiptStore({
			stateRoot: root,
			repositoryIdentity: "vault@example",
		});
		const proof = {
			transactionId: `txn_${"1".repeat(32)}`,
			ledgerGeneration: "a".repeat(40),
			receiptId: `receipt_${"2".repeat(32)}`,
			receiptRevision: 3,
			proofFingerprint: "f".repeat(64),
			issuedAt: "2026-08-09T00:00:00.000Z",
		} as const;
		const token = await store.issueDoctorToken(proof);
		expect(await store.readDoctorToken(proof.transactionId, proof.ledgerGeneration)).toEqual(token);
		const issuedName = (await readdir(store.paths.doctorTokens)).find((name) =>
			name.endsWith(".issued.json"),
		);
		if (!issuedName) throw new Error("doctor issuance record missing");
		const issued = await readFile(join(store.paths.doctorTokens, issuedName), "utf8");
		expect(issued).not.toContain(Buffer.from(token).toString("hex"));
		expect(
			await store.consumeDoctorToken(
				proof,
				token,
				"2026-08-09T00:00:01.000Z",
			),
		).toBe(true);
		expect(
			await store.consumeDoctorToken(
				proof,
				token,
				"2026-08-09T00:00:02.000Z",
			),
		).toBe(false);
	});

	test("consumes a doctor token at exactly the five-minute boundary and refuses past it", async () => {
		const root = await fixtureRoot();
		const store = createReceiptStore({
			stateRoot: root,
			repositoryIdentity: "vault@example",
		});
		const boundaryProof = {
			transactionId: `txn_${"1".repeat(32)}`,
			ledgerGeneration: "a".repeat(40),
			receiptId: `receipt_${"2".repeat(32)}`,
			receiptRevision: 3,
			proofFingerprint: "f".repeat(64),
			issuedAt: "2026-08-09T00:00:00.000Z",
		} as const;
		const boundaryToken = await store.issueDoctorToken(boundaryProof);
		// The implemented window is inclusive: elapsed strictly greater than
		// five minutes refuses, so exactly five minutes still consumes.
		expect(
			await store.consumeDoctorToken(
				boundaryProof,
				boundaryToken,
				"2026-08-09T00:05:00.000Z",
			),
		).toBe(true);

		const lateProof = {
			...boundaryProof,
			issuedAt: "2026-08-09T01:00:00.000Z",
		} as const;
		const lateToken = await store.issueDoctorToken(lateProof);
		expect(
			await store.consumeDoctorToken(
				lateProof,
				lateToken,
				"2026-08-09T01:05:00.001Z",
			),
		).toBe(false);
		expect(
			await store.consumeDoctorToken(
				lateProof,
				lateToken,
				"2026-08-09T01:06:00.000Z",
			),
		).toBe(false);
	});

	test("rejects duplicate history revisions instead of silently proceeding", async () => {
		const root = await fixtureRoot();
		const store = createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" });
		const first = receipt();
		await store.initialize(first, { ownerCapability: new Uint8Array([1]), joinCapability: new Uint8Array([2]) });
		const second = { ...first, revision: 2, phase: "writing", leaseGeneration: "a".repeat(40) } as const;
		await store.append(second);
		await writeFile(
			join(store.paths.history, `${first.receiptId}-00000002-duplicate.json`),
			`${JSON.stringify(second)}\n`,
			{ mode: 0o600 },
		);
		expect(await store.load()).toMatchObject({ status: "conflict" });
	});

	test("rejects a history chain whose entry carries a foreign receipt id", async () => {
		const root = await fixtureRoot();
		const store = createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" });
		const first = receipt();
		await store.initialize(first, { ownerCapability: new Uint8Array([1]), joinCapability: new Uint8Array([2]) });
		await store.append({ ...first, revision: 2, phase: "writing", leaseGeneration: "a".repeat(40) });
		const foreign = {
			...first,
			receiptId: "receipt_33333333333333333333333333333333",
			diagnosticsReference: "receipt:receipt_33333333333333333333333333333333",
		};
		await writeFile(
			join(store.paths.history, `${first.receiptId}-00000001.json`),
			`${JSON.stringify(foreign)}\n`,
			{ mode: 0o600 },
		);
		expect(await store.load()).toMatchObject({ status: "conflict" });
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

	test("exactly one of two racing initializers wins the current pointer", async () => {
		const root = await fixtureRoot();
		const storeA = createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" });
		const storeB = createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" });
		const first = receipt();
		const second = receipt({
			receiptId: "receipt_22222222222222222222222222222222",
			diagnosticsReference: "receipt:receipt_22222222222222222222222222222222",
		});
		const outcomes = await Promise.allSettled([
			storeA.initialize(first, { ownerCapability: new Uint8Array([1]), joinCapability: new Uint8Array([2]) }),
			storeB.initialize(second, { ownerCapability: new Uint8Array([3]), joinCapability: new Uint8Array([4]) }),
		]);
		const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
		expect(rejected.length).toBe(1);
		expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "receipt_exists" });
		const loaded = await storeA.load();
		expect(loaded).toMatchObject({ status: "loaded", receipt: { revision: 1 } });
		if (loaded.status !== "loaded") throw new Error("winner receipt missing");
		expect([first.receiptId, second.receiptId]).toContain(loaded.receipt.receiptId);
	});

	test("capability write failure before pointer publish leaves state absent", async () => {
		const root = await fixtureRoot();
		const store = createReceiptStore({
			stateRoot: root,
			repositoryIdentity: "vault@example",
			onDurabilityOperation(operation) {
				if (operation.target === "capability" && operation.kind === "temp_write") {
					throw new Error("capability write failed");
				}
			},
		});
		await expect(store.initialize(receipt(), {
			ownerCapability: new Uint8Array([1]), joinCapability: new Uint8Array([2]),
		})).rejects.toThrow("receipt durability unavailable");
		expect(await createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" }).load()).toEqual({ status: "absent" });
	});

	test("refuses owned paths whose first segment is .git", async () => {
		const root = await fixtureRoot();
		const store = createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" });
		await expect(store.initialize(receipt({
			ownedPaths: [{ path: ".git/hooks/pre-push", baselineHash: null, admittedNewFile: true }],
		}), {
			ownerCapability: new Uint8Array([1]), joinCapability: new Uint8Array([2]),
		})).rejects.toThrow("receipt schema invalid");
	});

	test("settles without crashing when the child exits without reading the descriptor", async () => {
		const root = await fixtureRoot();
		const script = join(root, "exit-early.ts");
		await writeFile(script, "process.exit(0);\n");
		const store = createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" });
		const first = receipt();
		await store.initialize(first, {
			ownerCapability: new Uint8Array([1]), joinCapability: new Uint8Array([2]),
		});
		const outcome = await launchCapabilityProcess(store, {
			receiptId: first.receiptId,
			role: "owner",
			command: process.execPath,
			args: [script],
			cwd: root,
			timeoutMs: 5_000,
		}).then(
			(result) => ({ ok: true as const, result }),
			(error: unknown) => ({ ok: false as const, error }),
		);
		if (outcome.ok) {
			expect(outcome.result.timedOut).toBe(false);
		} else {
			expect(String(outcome.error)).toContain("capability delivery failed");
		}
	});

	test("readInheritedCapability times out on a descriptor that never delivers", async () => {
		const root = await fixtureRoot();
		const fifo = join(root, "capability.fifo");
		execFileSync("mkfifo", [fifo]);
		const descriptor = openSync(fifo, constants.O_RDWR);
		try {
			await expect(readInheritedCapability(descriptor, 100)).rejects.toThrow("capability descriptor read timed out");
		} finally {
			closeSync(descriptor);
		}
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

	test("persists admitted checker hashes privately and prunes only closed or stale material", async () => {
		const root = await fixtureRoot();
		const store = createReceiptStore({ stateRoot: root, repositoryIdentity: "vault@example" });
		await store.admitChecker({
			schemaVersion: 1,
			entrypointHash: "a".repeat(64),
			dependencyBundleHash: "b".repeat(64),
			admittedAt: "2026-08-09T00:00:00.000Z",
		});
		expect(await store.readCheckerAdmission()).toMatchObject({
			entrypointHash: "a".repeat(64),
			dependencyBundleHash: "b".repeat(64),
		});
		expect((await stat(store.paths.checkerAdmission)).mode & 0o777).toBe(0o600);
		await store.recordJanitorReport(
			JSON.stringify({ status: "preview", skipped_repairs: ["semantic"] }),
			"2026-08-09T00:00:00.000Z",
		);
		const reportNames = await readdir(store.paths.janitorReports);
		expect(reportNames).toHaveLength(1);
		expect(
			(await stat(join(store.paths.janitorReports, reportNames[0] ?? "missing"))).mode &
				0o777,
		).toBe(0o600);

		const closed = receipt();
		await store.initialize(closed, {
			ownerCapability: new Uint8Array([1]),
			joinCapability: new Uint8Array([2]),
		});
		await store.append({ ...closed, revision: 2, phase: "closed", transition: "closed", nextSafeAction: "none" });
		const open = receipt({
			receiptId: "receipt_22222222222222222222222222222222",
			diagnosticsReference: "receipt:receipt_22222222222222222222222222222222",
		});
		await store.initialize(open, {
			ownerCapability: new Uint8Array([3]),
			joinCapability: new Uint8Array([4]),
		});
		const proof = {
			transactionId: `txn_${"1".repeat(32)}`,
			ledgerGeneration: "c".repeat(40),
			receiptId: open.receiptId,
			receiptRevision: 1,
			proofFingerprint: "d".repeat(64),
			issuedAt: "2026-08-09T00:00:00.000Z",
		};
		await store.issueDoctorToken(proof);

		expect(
			await store.prunePrivateHygiene("2026-08-09T00:10:00.000Z"),
		).toEqual({ capabilityFiles: 2, doctorTokenRecords: 1 });
		expect(await store.readCapability(open.receiptId, "owner")).toEqual(
			new Uint8Array([3]),
		);
		await expect(store.readCapability(closed.receiptId, "owner")).rejects.toThrow();
	});
});

interface PortCall {
	readonly method: keyof VaultGitDurabilityPort;
	readonly target: string;
}

/** Expected port sequence for one rename-published durable file. */
function renamedFile(target: string): PortCall[] {
	return [
		{ method: "writeTemp", target },
		{ method: "syncFile", target },
		{ method: "rename", target },
		{ method: "syncDirectory", target },
	];
}

/** Expected port sequence for one exclusively link-published durable file. */
function linkedFile(target: string): PortCall[] {
	return [
		{ method: "writeTemp", target },
		{ method: "syncFile", target },
		{ method: "linkExclusive", target },
		{ method: "syncDirectory", target },
	];
}

/**
 * Durability port that performs real operations while recording the call
 * sequence; `crashAt` aborts BEFORE the numbered operation runs, so the
 * simulated crash leaves that operation genuinely unperformed.
 */
function recordingPort(calls: PortCall[], crashAt = -1): VaultGitDurabilityPort {
	const real = createNodeVaultGitDurabilityPort();
	let index = 0;
	const admit = (method: keyof VaultGitDurabilityPort, target: string): void => {
		if (index === crashAt) {
			index += 1;
			throw new Error(`crash before ${method}`);
		}
		index += 1;
		calls.push({ method, target });
	};
	return {
		async writeTemp(handle, bytes, target) {
			admit("writeTemp", target);
			await real.writeTemp(handle, bytes, target);
		},
		async syncFile(handle, target) {
			admit("syncFile", target);
			await real.syncFile(handle, target);
		},
		async rename(from, to, target) {
			admit("rename", target);
			await real.rename(from, to, target);
		},
		async linkExclusive(from, to, target) {
			admit("linkExclusive", target);
			await real.linkExclusive(from, to, target);
		},
		async syncDirectory(path, target) {
			admit("syncDirectory", target);
			await real.syncDirectory(path, target);
		},
	};
}

async function fixtureRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vault-git-store-"));
	roots.push(root);
	await chmod(root, 0o700);
	return root;
}

function receipt(overrides: Partial<VaultGitReceipt> = {}): VaultGitReceipt {
	return {
		schemaVersion: 2,
		receiptId: "receipt_11111111111111111111111111111111",
		transactionId: null,
		revision: 1,
		phase: "intent_durable",
		transition: "acquisition_intent",
		recordedAt: "2026-08-09T00:00:00.000Z",
		event: "note_created",
		actor: "agent-a",
		host: "laptop",
		remote: "origin",
		ownedPaths: [{ path: "notes/example.md", baselineHash: null, admittedNewFile: true }],
		unrelatedState: { statusHex: "", indexHex: "" },
		localMainHead: "b".repeat(40),
		remoteMainHead: "b".repeat(40),
		expectedLeaseGeneration: null,
		leaseGeneration: null,
		leaseAcquiredAt: null,
		leaseDurationMs: 60_000,
		commitId: null,
		expectedMainCommit: null,
		ledgerReleaseId: null,
		pushOutcome: "not_attempted",
		nextSafeAction: "retry_remote",
		diagnosticsReference: "receipt:receipt_11111111111111111111111111111111",
		...overrides,
	};
}
