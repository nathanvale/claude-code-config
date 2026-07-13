import { chmod, lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
	HOOK_PROVENANCE_SCHEMA_VERSION,
	classifyHookOwnership,
	hashHookBytes,
	hookProvenanceIdentity,
	isRecognizedPreProvenanceHook,
	readHookProvenance,
	writeHookProvenance,
	type HookProvenanceIdentity,
	type HookProvenanceReceipt,
} from "../src/hook-provenance.ts";

const SETUP_V1_DIGEST = "462ff0f88ce44e72474d8aea4a0bbf567962d1604d6b43b955e949d59652eede";
const LEGACY_INSTALLER_DIGEST = "c58eb459e043374bf66e5da2a65fe4f9e4d8ce3aca1daeb9127087e296fe517f";
const DESIRED_DIGEST = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PRIOR_DIGEST = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("hook provenance", () => {
	test("keys one stable receipt path from the canonical existing hook directory and basename", async () => {
		const fixture = await provenanceFixture();
		const throughLink = join(fixture.root, "linked-hooks");
		await symlink(fixture.hookDirectory, throughLink);
		const before = await hookProvenanceIdentity({
			stateRoot: fixture.stateRoot,
			hookDirectory: throughLink,
			hookName: "pre-commit",
		});
		await writeFile(before.destination, "hook\n");
		const after = await hookProvenanceIdentity({
			stateRoot: fixture.stateRoot,
			hookDirectory: fixture.hookDirectory,
			hookName: "pre-commit",
		});
		expect(after).toEqual(before);
		expect(before.destination).toBe(join(before.canonical_hook_directory, "pre-commit"));
		expect(before.receipt_path).toStartWith(join(fixture.stateRoot, "hook-provenance"));
	});

	test("round-trips stable evidence while missing inspection remains read-only", async () => {
		const fixture = await provenanceFixture();
		const identity = await identityFor(fixture);
		expect(await readHookProvenance(identity)).toEqual({ status: "missing", path: identity.receipt_path });
		expect(await exists(dirname(identity.receipt_path))).toBe(false);

		const receipt = stableReceipt(identity, DESIRED_DIGEST);
		await writeHookProvenance(identity, receipt, { expected: { status: "missing", path: identity.receipt_path } });
		expect(await readHookProvenance(identity)).toEqual({ status: "valid", path: identity.receipt_path, receipt });
		expect((await lstat(identity.receipt_path)).mode & 0o777).toBe(0o600);
	});

	test("malformed, mismatched, invalid, and linked receipts grant no ownership", async () => {
		const fixture = await provenanceFixture();
		const identity = await identityFor(fixture);
		const cases: unknown[] = [
			"not json",
			{ ...stableReceipt(identity, DESIRED_DIGEST), schema_version: 2 },
			{ ...stableReceipt(identity, DESIRED_DIGEST), destination: join(fixture.root, "other") },
			{ ...stableReceipt(identity, DESIRED_DIGEST), hook: "commit-msg" },
			{ ...stableReceipt(identity, DESIRED_DIGEST), installed_digest: "not-a-digest" },
			{ ...stableReceipt(identity, DESIRED_DIGEST), source_digest: "ABCDEF".padEnd(64, "0") },
		];
		await mkdir(dirname(identity.receipt_path), { recursive: true });
		for (const value of cases) {
			await writeFile(identity.receipt_path, typeof value === "string" ? value : `${JSON.stringify(value)}\n`, { mode: 0o600 });
			await chmod(identity.receipt_path, 0o600);
			expect((await readHookProvenance(identity)).status).toBe("invalid");
		}
		await writeFile(identity.receipt_path, `${JSON.stringify(stableReceipt(identity, DESIRED_DIGEST))}\n`, { mode: 0o644 });
		await chmod(identity.receipt_path, 0o644);
		expect(await readHookProvenance(identity)).toMatchObject({
			status: "invalid",
			reason: "receipt permissions are not restrictive",
		});

		const target = join(fixture.root, "receipt-target.json");
		await writeFile(target, `${JSON.stringify(stableReceipt(identity, DESIRED_DIGEST))}\n`, { mode: 0o600 });
		await import("node:fs/promises").then(({ rm }) => rm(identity.receipt_path));
		await symlink(target, identity.receipt_path);
		expect((await readHookProvenance(identity)).status).toBe("invalid");
	});

	test("accepts only applicable missing, prior, or desired pending destination states", async () => {
		const fixture = await provenanceFixture();
		const identity = await identityFor(fixture);
		const missingPrior = pendingReceipt(identity, { state: "missing" });
		const digestPrior = pendingReceipt(identity, { state: "digest", digest: PRIOR_DIGEST });
		expect(classifyHookOwnership(missingPrior, undefined)).toBe("pending_prior");
		expect(classifyHookOwnership(missingPrior, DESIRED_DIGEST)).toBe("pending_desired");
		expect(classifyHookOwnership(missingPrior, PRIOR_DIGEST)).toBe("unproven");
		expect(classifyHookOwnership(digestPrior, PRIOR_DIGEST)).toBe("pending_prior");
		expect(classifyHookOwnership(digestPrior, DESIRED_DIGEST)).toBe("pending_desired");
		expect(classifyHookOwnership(digestPrior, undefined)).toBe("unproven");
		expect(classifyHookOwnership(digestPrior, SETUP_V1_DIGEST)).toBe("unproven");
	});

	test("atomic write failure preserves the prior complete receipt", async () => {
		const fixture = await provenanceFixture();
		const identity = await identityFor(fixture);
		const stable = stableReceipt(identity, PRIOR_DIGEST);
		await writeHookProvenance(identity, stable, { expected: { status: "missing", path: identity.receipt_path } });
		const prior = await readHookProvenance(identity);
		await expect(writeHookProvenance(identity, pendingReceipt(identity, { state: "digest", digest: PRIOR_DIGEST }), {
			expected: prior.status === "valid" ? prior : { status: "missing", path: identity.receipt_path },
			beforeRename: async () => { throw new Error("interrupted"); },
		})).rejects.toThrow("interrupted");
		expect(JSON.parse(await readFile(identity.receipt_path, "utf8"))).toEqual(stable);
	});

	test("pins the two byte-exact pre-provenance payloads to pre-commit only", async () => {
		const setupV1 = await Bun.file(join(import.meta.dir, "fixtures/pre-commit-setup-v1")).bytes();
		const legacyInstaller = await Bun.file(join(import.meta.dir, "fixtures/pre-commit-legacy-installer")).bytes();
		expect(hashHookBytes(setupV1)).toBe(SETUP_V1_DIGEST);
		expect(hashHookBytes(legacyInstaller)).toBe(LEGACY_INSTALLER_DIGEST);
		expect(isRecognizedPreProvenanceHook("pre-commit", SETUP_V1_DIGEST)).toBe(true);
		expect(isRecognizedPreProvenanceHook("pre-commit", LEGACY_INSTALLER_DIGEST)).toBe(true);
		expect(isRecognizedPreProvenanceHook("commit-msg", SETUP_V1_DIGEST)).toBe(false);
		expect(isRecognizedPreProvenanceHook("pre-commit", hashHookBytes(new Uint8Array([...setupV1, 0])))).toBe(false);
		expect(isRecognizedPreProvenanceHook("pre-commit", hashHookBytes(new Uint8Array([...legacyInstaller, 0])))).toBe(false);
	});
});

async function provenanceFixture() {
	const root = await mkdtemp(join(tmpdir(), "setup-hook-provenance-"));
	const hookDirectory = join(root, "hooks");
	await mkdir(hookDirectory);
	return { root, hookDirectory, stateRoot: join(root, "state") };
}

async function identityFor(fixture: Awaited<ReturnType<typeof provenanceFixture>>) {
	return hookProvenanceIdentity({
		stateRoot: fixture.stateRoot,
		hookDirectory: fixture.hookDirectory,
		hookName: "pre-commit",
	});
}

function stableReceipt(identity: HookProvenanceIdentity, digest: string): HookProvenanceReceipt {
	return {
		schema_version: HOOK_PROVENANCE_SCHEMA_VERSION,
		state: "stable",
		hook: identity.hook,
		destination: identity.destination,
		installed_digest: digest,
		source_digest: digest,
	};
}

function pendingReceipt(
	identity: HookProvenanceIdentity,
	prior: { readonly state: "missing" } | { readonly state: "digest"; readonly digest: string },
): HookProvenanceReceipt {
	return {
		schema_version: HOOK_PROVENANCE_SCHEMA_VERSION,
		state: "pending",
		hook: identity.hook,
		destination: identity.destination,
		prior,
		desired_digest: DESIRED_DIGEST,
		source_digest: DESIRED_DIGEST,
	};
}

async function exists(path: string): Promise<boolean> {
	return lstat(path).then(() => true, () => false);
}
