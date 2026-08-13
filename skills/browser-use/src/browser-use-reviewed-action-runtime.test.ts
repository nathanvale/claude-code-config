import { afterEach, describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	realpath,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runForTest } from "./browser-use";
import { createProductionBrowserUseRuntime } from "./browser-use-runtime";
import {
	type BrowserUseBindingSelectionGrant,
	type BrowserUseBindingSelectionRequest,
	bindingSelectionGrantDigestOf,
} from "./browser-use-binding-selection";
import { reviewedActionApprovalFactsDigest } from "./browser-use-reviewed-action-approval";
import { parseJson } from "./browser-use-test-helpers";

const cleanup = new Set<string>();
afterEach(async () => {
	for (const path of cleanup) await rm(path, { recursive: true, force: true });
	cleanup.clear();
});

async function verifierFixture() {
	const root = await mkdtemp(join(await realpath(tmpdir()), "reviewed-action-runtime-"));
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
	test("verifies and durably reserves one signed binding selection grant", async () => {
		const fixture = await verifierFixture();
		const runtime = await createProductionBrowserUseRuntime({ env: fixture.env });
		const request: BrowserUseBindingSelectionRequest = {
			resolution_key: {
				binding_ref: "github",
				service_id: "github",
				auth_context: "interactive-login",
				environment: "agent-chrome",
				profile: "default",
			},
			facts: {
				run_id: "run-selection",
				service_id: "github",
				origin: "https://github.com",
				vault_id: "vault-1",
				candidate_set_digest: "0123456789abcdef".repeat(4),
			},
			candidate_count: 7,
		};
		const issuedAt = runtime.now() - 1_000;
		const unsigned: Omit<BrowserUseBindingSelectionGrant, "signature"> = {
			grant_id: "selection-runtime-1",
			resolution_key: request.resolution_key,
			binding: {
				service_id: "github",
				auth_context: "interactive-login",
				allowed_origins: ["https://github.com"],
				allowed_login_paths: [],
				vault_id: "vault-1",
				item_id: "item-6",
				allowed_auth_methods: ["password", "otp"],
				binding_revision: 1,
			},
			facts: request.facts,
			issued_at_epoch_ms: issuedAt,
			expires_at_epoch_ms: issuedAt + 90_000,
			verifier_key_id: fixture.identity.key_id,
		};
		const grant: BrowserUseBindingSelectionGrant = {
			...unsigned,
			signature: sign(
				"sha256",
				Buffer.from(bindingSelectionGrantDigestOf(unsigned), "hex"),
				fixture.privateKey,
			).toString("base64"),
		};
		const verifier = runtime.bindingSelectionGrantVerifier;
		expect(verifier).toBeDefined();
		if (verifier === undefined) throw new Error("selection verifier was absent");
		expect(
			await verifier.verifyAndReserve({
				grant,
				expected: request,
				at_epoch_ms: runtime.now(),
			}),
		).toMatchObject({ ok: true });
		expect(
			await verifier.verifyAndReserve({
				grant,
				expected: request,
				at_epoch_ms: runtime.now(),
			}),
		).toEqual({ ok: false, code: "grant_consumed" });
		const reservation = await lstat(
			join(
				fixture.env.XDG_STATE_HOME,
				"browser-use",
				"binding-selection-grants",
				"selection-runtime-1",
			),
		);
		expect(reservation.mode & 0o777).toBe(0o600);
	});

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
		const loose = await createProductionBrowserUseRuntime({ env: fixture.env });
		expect(loose.reviewedActionApprovalVerifier).toBeUndefined();
		expect(loose.reviewedActionApprovalVerifierIssue).toMatchObject({
			code: "action_promotion_verifier_store_unsafe",
		});
		const command = await runForTest(["action", "schema", "--json"], loose);
		expect(command.exitCode).toBe(20);
		expect(parseJson(command.stdout)).toMatchObject({
			error: { code: "action_promotion_verifier_store_unsafe" },
		});
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
		expect(runtime.bindingSelectionCeremony).toBeUndefined();

		await chmod(fixture.verifierPath, 0o644);
		const unpinned = await createProductionBrowserUseRuntime({
			env: {
				...fixture.env,
				BROWSER_USE_REVIEWED_ACTION_APPROVAL_BROKER: "/fixture/ApprovalBroker",
			},
		});
		expect(unpinned.runbookHumanIdentityAttestation).toBeUndefined();
	});

	test("distinguishes an absent pin from a malformed identity", async () => {
		const fixture = await verifierFixture();
		await rm(fixture.verifierPath);
		const absent = await createProductionBrowserUseRuntime({ env: fixture.env });
		expect(absent.reviewedActionApprovalVerifier).toBeUndefined();
		expect(absent.reviewedActionApprovalVerifierIssue).toBeUndefined();
		await writeFile(fixture.verifierPath, "{}\n", { mode: 0o600 });
		const malformed = await createProductionBrowserUseRuntime({ env: fixture.env });
		expect(malformed.reviewedActionApprovalVerifier).toBeUndefined();
		expect(malformed.reviewedActionApprovalVerifierIssue).toMatchObject({
			code: "action_promotion_verifier_identity_invalid",
		});
	});

	test("canonicalizes an owner-controlled config symlink before loading the pin", async () => {
		const fixture = await verifierFixture();
		const configRoot = fixture.env.XDG_CONFIG_HOME;
		if (configRoot === undefined) throw new Error("config fixture missing");
		const canonicalRoot = `${configRoot}-canonical`;
		await rename(configRoot, canonicalRoot);
		await symlink(canonicalRoot, configRoot, "dir");
		const runtime = await createProductionBrowserUseRuntime({ env: fixture.env });
		expect(runtime.reviewedActionApprovalVerifier).toBeDefined();
		expect(runtime.reviewedActionApprovalVerifierIssue).toBeUndefined();
	});

	test("rejects a loose canonical config root before reading the pin", async () => {
		const fixture = await verifierFixture();
		const configRoot = fixture.env.XDG_CONFIG_HOME;
		if (configRoot === undefined) throw new Error("config fixture missing");
		await chmod(join(configRoot, "browser-use"), 0o755);
		const runtime = await createProductionBrowserUseRuntime({ env: fixture.env });
		expect(runtime.reviewedActionApprovalVerifier).toBeUndefined();
		expect(runtime.reviewedActionApprovalVerifierIssue).toMatchObject({
			code: "action_promotion_verifier_store_unsafe",
		});
	});
});
