import { afterEach, describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProductionBrowserUseRuntime } from "./browser-use-runtime";
import { reviewedActionApprovalFactsDigest } from "./browser-use-reviewed-action-approval";

const cleanup = new Set<string>();
afterEach(async () => {
	for (const path of cleanup) await rm(path, { recursive: true, force: true });
	cleanup.clear();
});

async function verifierFixture() {
	const root = await mkdtemp(join(tmpdir(), "reviewed-action-runtime-"));
	cleanup.add(root);
	const configRoot = join(root, "config", "browser-use");
	await mkdir(configRoot, { recursive: true, mode: 0o700 });
	await chmod(join(root, "config"), 0o700);
	const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
	const jwk = publicKey.export({ format: "jwk" });
	if (jwk.x === undefined || jwk.y === undefined) throw new Error("P-256 fixture key is incomplete");
	const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
	const identity = {
		contract: "browser-use.reviewed-action-verifier",
		schema_version: "1",
		key_id: createHash("sha256").update(raw).digest("hex"),
		public_key: raw.toString("base64"),
	};
	const verifierPath = join(configRoot, "reviewed-action-verifier.json");
	await writeFile(verifierPath, `${JSON.stringify(identity)}\n`, { mode: 0o600 });
	return {
		env: {
			HOME: root,
			XDG_CONFIG_HOME: join(root, "config"),
			XDG_DATA_HOME: join(root, "data"),
			XDG_STATE_HOME: join(root, "state"),
			XDG_CACHE_HOME: join(root, "cache"),
			XDG_RUNTIME_DIR: join(root, "runtime"),
		},
		identity,
		privateKey,
		verifierPath,
	};
}

describe("production Reviewed Action verifier wiring", () => {
	test("loads one owner-only XDG verifier pin and verifies a real P-256 receipt offline", async () => {
		const fixture = await verifierFixture();
		const runtime = await createProductionBrowserUseRuntime({ env: fixture.env });
		expect(runtime.reviewedActionApprovalVerifier).toBeDefined();
		const unsigned = {
			source_commit: "1".repeat(40),
			action_id: "count-rows",
			approved_digest: "2".repeat(64),
			approved_origin: "https://portal.example.test",
			approved_effect: "read" as const,
			audited_capabilities: ["dom-query", "dom-read"],
			containment: "read-only-observation" as const,
			input_schema_digest: "3".repeat(64),
			result_schema_digest: "4".repeat(64),
			postcondition_digest: null,
			receipt_id: "receipt-runtime",
			approval_reference: "review-1",
			issued_at_epoch_ms: 1_000,
			verifier_key_id: fixture.identity.key_id,
		};
		const receipt = {
			contract: "browser-use.reviewed-action-promotion" as const,
			schema_version: "1" as const,
			disposition: "approved" as const,
			presence_backed: true as const,
			...unsigned,
			signature: sign("sha256", Buffer.from(reviewedActionApprovalFactsDigest(unsigned), "hex"), fixture.privateKey).toString("base64"),
		};
		expect(runtime.reviewedActionApprovalVerifier?.verify(receipt)).toEqual({ ok: true });
		expect(runtime.reviewedActionApprovalVerifier?.verify({ ...receipt, signature: "Zm9yZ2Vk" })).toEqual({ ok: false, code: "action_promotion_signature_invalid" });
	});

	test("refuses loose or malformed verifier pins and preserves an explicit test verifier", async () => {
		const fixture = await verifierFixture();
		await chmod(fixture.verifierPath, 0o644);
		expect((await createProductionBrowserUseRuntime({ env: fixture.env })).reviewedActionApprovalVerifier).toBeUndefined();
		const explicit = { verify: () => ({ ok: true as const }) };
		expect((await createProductionBrowserUseRuntime({ env: fixture.env, reviewedActionApprovalVerifier: explicit })).reviewedActionApprovalVerifier).toBe(explicit);
	});

	test("wires the pinned broker only as the human attestation source and ignores the removed development switch", async () => {
		const fixture = await verifierFixture();
		const removedSwitch = ["BROWSER_USE_DEV", "BYPASS_PROMOTION"].join("_");
		const runtime = await createProductionBrowserUseRuntime({
			env: {
				...fixture.env,
				BROWSER_USE_REVIEWED_ACTION_APPROVAL_BROKER: "/fixture/ApprovalBroker",
				[removedSwitch]: "1",
			},
		});
		expect(runtime.runbookHumanIdentityAttestation).toBeDefined();
		expect(runtime.runbookAuthenticatedStateProof).toBeUndefined();

		await chmod(fixture.verifierPath, 0o644);
		const unpinned = await createProductionBrowserUseRuntime({
			env: {
				...fixture.env,
				BROWSER_USE_REVIEWED_ACTION_APPROVAL_BROKER: "/fixture/ApprovalBroker",
			},
		});
		expect(unpinned.runbookHumanIdentityAttestation).toBeUndefined();
	});
});
