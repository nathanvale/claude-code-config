import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	acquireSourceLock,
	withSourceLock,
	writeSourceFileAtomically,
} from "./browser-use-source-lock";

const cleanup = new Set<string>();

afterEach(async () => {
	for (const path of cleanup) await rm(path, { recursive: true, force: true });
	cleanup.clear();
});

async function lockFixture(): Promise<{ root: string; lockPath: string }> {
	const root = await mkdtemp(join(tmpdir(), "browser-use-source-lock-"));
	cleanup.add(root);
	return { root, lockPath: join(root, ".authoring.lock") };
}

describe("source authoring lock", () => {
	test("records owner identity and refuses current-process contention", async () => {
		const { lockPath } = await lockFixture();
		const first = await acquireSourceLock({ lockPath, subject: "fixture" });
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		const owner = JSON.parse(await readFile(lockPath, "utf8"));
		expect(owner).toMatchObject({ token: first.owner.token, pid: process.pid });
		expect(owner.acquired_at_epoch_ms).toBeNumber();

		const second = await acquireSourceLock({ lockPath, subject: "fixture" });
		expect(second).toMatchObject({ ok: false, reason: "contended" });
		if (!second.ok) expect(second.message).toContain(`remove ${lockPath}`);
		expect(JSON.parse(await readFile(lockPath, "utf8")).token).toBe(
			first.owner.token,
		);

		await first.release();
		expect(await readFile(lockPath, "utf8").catch(() => undefined)).toBeUndefined();
	});

	test("reclaims dead and expired owners", async () => {
		for (const owner of [
			{
				token: "dead-owner",
				pid: 2_147_483_647,
				acquired_at_epoch_ms: Date.now(),
			},
			{
				token: "expired-owner",
				pid: process.pid,
				acquired_at_epoch_ms: 0,
			},
		]) {
			const { lockPath } = await lockFixture();
			await writeFile(lockPath, `${JSON.stringify(owner)}\n`);
			const acquired = await acquireSourceLock({ lockPath, subject: "fixture" });
			expect(acquired.ok).toBe(true);
			if (!acquired.ok) continue;
			expect(acquired.owner.token).not.toBe(owner.token);
			await acquired.release();
		}
	});

	test("gives one deterministic manual repair path for malformed ownership", async () => {
		const { lockPath } = await lockFixture();
		await writeFile(lockPath, "incomplete-owner");
		const acquired = await acquireSourceLock({ lockPath, subject: "fixture" });
		expect(acquired).toEqual({
			ok: false,
			reason: "repair-required",
			message: `another fixture source mutation holds the catalog lock. Dead owners and locks older than 5 minutes are reclaimed automatically. If the lock persists, verify no source mutation is running, then remove ${lockPath} and ${lockPath}.reclaim.`,
		});
	});

	test("removes its owner lock when a transition claim blocks direct acquisition", async () => {
		const { lockPath } = await lockFixture();
		await writeFile(
			`${lockPath}.reclaim`,
			`${JSON.stringify({ token: "stuck-transition", pid: process.pid, acquired_at_epoch_ms: Date.now() })}\n`,
		);
		const acquired = await acquireSourceLock({ lockPath, subject: "fixture" });
		expect(acquired).toMatchObject({ ok: false, reason: "repair-required" });
		expect(await readFile(lockPath, "utf8").catch(() => undefined)).toBeUndefined();
	});

	test("serializes simultaneous reclaim and preserves the winner's ownership", async () => {
		const { lockPath } = await lockFixture();
		await writeFile(
			lockPath,
			`${JSON.stringify({ token: "expired-owner", pid: process.pid, acquired_at_epoch_ms: 0 })}\n`,
		);
		const attempts = await Promise.all([
			acquireSourceLock({ lockPath, subject: "fixture" }),
			acquireSourceLock({ lockPath, subject: "fixture" }),
		]);
		const winners = attempts.filter((attempt) => attempt.ok);
		expect(winners).toHaveLength(1);
		const winner = winners[0];
		if (winner === undefined || !winner.ok) return;
		expect(JSON.parse(await readFile(lockPath, "utf8")).token).toBe(
			winner.owner.token,
		);
		await winner.release();
	});

	test("release leaves a replacement owner's lock intact", async () => {
		const { lockPath } = await lockFixture();
		const acquired = await acquireSourceLock({ lockPath, subject: "fixture" });
		if (!acquired.ok) throw new Error(acquired.message);
		const successor = {
			token: "successor-owner",
			pid: process.pid,
			acquired_at_epoch_ms: Date.now(),
		};
		await writeFile(lockPath, `${JSON.stringify(successor)}\n`);
		await acquired.release();
		expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(successor);
	});

	test("reports release failure when transition acquisition is exhausted", async () => {
		const { lockPath } = await lockFixture();
		const operation = await withSourceLock(
			{ lockPath, subject: "fixture" },
			async () => {
				await writeFile(
					`${lockPath}.reclaim`,
					`${JSON.stringify({ token: "stuck-transition", pid: process.pid, acquired_at_epoch_ms: Date.now() })}\n`,
				);
				return "mutated";
			},
		);
		expect(operation).toMatchObject({
			acquired: true,
			released: false,
			value: "mutated",
			release_failure: { ok: false, reason: "transition-unavailable" },
		});
		expect(await readFile(lockPath, "utf8")).toContain('"token"');
	});

	test("removes an owned temporary file after a failed atomic replacement", async () => {
		const { root } = await lockFixture();
		const destination = join(root, "registry.json");
		await mkdir(destination);
		await expect(
			writeSourceFileAtomically({ path: destination, bytes: '{"actions":[]}\n' }),
		).rejects.toBeDefined();
		expect((await readdir(root)).filter((entry) => entry.includes(".tmp"))).toEqual(
			[],
		);
	});
});
