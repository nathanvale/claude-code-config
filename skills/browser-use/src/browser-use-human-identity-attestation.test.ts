import { afterEach, describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type BrowserUseApprovalVerifierDeps,
	type BrowserUseOneUseGrant,
	createApprovalVerifier,
	oneUseGrantDigestOf,
} from "./browser-use-auth-approval";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import type { BrowserUseSharedRun } from "./browser-use-run-model";
import {
	createHumanIdentityAttestationDriver,
	createNativeHumanIdentityAttestationDriver,
	type BrowserUseHumanIdentityAttestationOperatorBroker,
} from "./browser-use-human-identity-attestation";

const cleanup = new Set<string>();
afterEach(async () => {
	for (const path of cleanup) await rm(path, { recursive: true, force: true });
	cleanup.clear();
});

const VERIFIER = { key_id: "verifier-fixture", public_key: "public-fixture" };

const binding: BrowserUseItemBinding = {
	service_id: "fixture",
	auth_context: "interactive-login",
	allowed_origins: ["https://fixture.test"],
	allowed_login_paths: ["/login"],
	vault_id: "vault-fixture",
	item_id: "item-fixture",
	allowed_auth_methods: ["password"],
	binding_revision: 1,
};

const run: BrowserUseSharedRun = {
	run_id: "run-fixture",
	revision: 7,
	state: "awaiting-user-presence",
	task_intent: "runbook-execution",
	environment_profile: { environment: "agent-chrome", profile: "default" },
	adapter_id: "agent-browser",
	handoff_evidence_id: "handoff-fixture",
	runbook_target_binding: {
		schema_version: "1",
		mode: "exact",
		binding_id: "target-fixture",
	},
	runbook_progress: {
		schema_version: "1",
		service_id: "fixture",
		flow_id: "fill-week",
		runbook_version: "1",
		next_step: 0,
		total_steps: 4,
	},
	mutation_dispatched: false,
	artifacts: [],
	continuation: {
		next_action_id: "complete-human-identity-attestation",
		summary: "Complete one-run attestation.",
	},
};

function approvalVerifier() {
	const consumed = new Set<string>();
	const deps: BrowserUseApprovalVerifierDeps = {
		verifier: VERIFIER,
		verifySignature: ({ digest, signature }) => signature === `sig:${digest}`,
		ledger: {
			isPolicyInvalidated: () => false,
			isGrantConsumed: (grantId) => consumed.has(grantId),
		},
		reserveGrant: (grantId) => {
			if (consumed.has(grantId)) return false;
			consumed.add(grantId);
			return true;
		},
		invalidatePolicy: () => {},
	};
	return createApprovalVerifier(deps);
}

function brokerHarness(
	overrides: { verifierKeyId?: string; runId?: string } = {},
): {
	broker: BrowserUseHumanIdentityAttestationOperatorBroker;
	requests: unknown[];
} {
	const requests: unknown[] = [];
	return {
		requests,
		broker: {
			async readVerifierIdentity() {
				return {
					ok: true,
					identity: {
						...VERIFIER,
						key_id: overrides.verifierKeyId ?? VERIFIER.key_id,
					},
				};
			},
			async issueHumanIdentityAttestation(input) {
				requests.push(input);
				const unsigned: Omit<BrowserUseOneUseGrant, "signature"> = {
					grant_id: "grant-fixture",
					subject: {
						purpose: "human-identity-attestation",
						run_id: overrides.runId ?? input.subject.run_id,
					},
					bound_facts: input.bound_facts,
					issued_at_epoch_ms: 10_000,
					expires_at_epoch_ms: 40_000,
					verifier_key_id: VERIFIER.key_id,
				};
				return {
					ok: true,
					grant: {
						...unsigned,
						signature: `sig:${oneUseGrantDigestOf(unsigned)}`,
					},
				};
			},
		},
	};
}

describe("one-run Human Identity Attestation driver", () => {
	test("an off-curve verifier identity does not throw during driver construction", () => {
		const raw = Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]);
		const verifierIdentity = {
			key_id: createHash("sha256").update(raw).digest("hex"),
			public_key: raw.toString("base64"),
		};

		expect(() =>
			createNativeHumanIdentityAttestationDriver(
				"/Applications/ApprovalBroker.app/Contents/MacOS/ApprovalBroker",
				verifierIdentity,
			),
		).not.toThrow();
	});

	test("drives an executable broker and verifies its P-256 grant without browser or biometric access", async () => {
		const root = await mkdtemp(join(tmpdir(), "human-attestation-broker-"));
		cleanup.add(root);
		const executable = join(root, "ApprovalBroker");
		const { privateKey, publicKey } = generateKeyPairSync("ec", {
			namedCurve: "prime256v1",
		});
		const jwk = publicKey.export({ format: "jwk" });
		if (jwk.x === undefined || jwk.y === undefined) throw new Error("P-256 fixture key is incomplete");
		const raw = Buffer.concat([
			Buffer.from([4]),
			Buffer.from(jwk.x, "base64url"),
			Buffer.from(jwk.y, "base64url"),
		]);
		const verifierIdentity = {
			key_id: createHash("sha256").update(raw).digest("hex"),
			public_key: raw.toString("base64"),
		};
		const reference = (label: string) =>
			`${label}:sha256:${createHash("sha256")
				.update(
					JSON.stringify([
						label,
						binding.service_id,
						binding.auth_context,
						binding.vault_id,
						binding.item_id,
						binding.binding_revision,
					]),
				)
				.digest("hex")}`;
		const issuedAt = Date.now();
		const unsigned: Omit<BrowserUseOneUseGrant, "signature"> = {
			grant_id: "grant-native-fixture",
			subject: { purpose: "human-identity-attestation", run_id: run.run_id },
			bound_facts: {
				service_id: "fixture",
				auth_context: "interactive-login",
				environment: "agent-chrome",
				profile: "default",
				origin: "https://fixture.test",
				runbook_id: "fixture/fill-week",
				action: "runbook-run",
				mutation_class: "runbook-execution",
				handoff_evidence_id: "handoff-fixture",
				lane_id: "agent-browser",
				target_id: "target-fixture",
				subject_reference: reference("subject"),
				account_reference: reference("account"),
				tenant_reference: reference("tenant"),
				mutation_target: "fixture/fill-week",
				mutation_scope: "https://fixture.test",
				action_policy_hash: "a".repeat(64),
			},
			issued_at_epoch_ms: issuedAt,
			expires_at_epoch_ms: issuedAt + 30_000,
			verifier_key_id: verifierIdentity.key_id,
		};
		const grant: BrowserUseOneUseGrant = {
			...unsigned,
			signature: sign(
				"sha256",
				Buffer.from(oneUseGrantDigestOf(unsigned), "hex"),
				privateKey,
			).toString("base64"),
		};
		const verifierEnvelope = JSON.stringify({ ok: true, verifier: verifierIdentity });
		const grantEnvelope = JSON.stringify({ ok: true, grant });
		await writeFile(
			executable,
			`#!/bin/sh\ncase "$1" in\n  verifier) printf '%s\\n' '${verifierEnvelope}' ;;\n  attest) read -r request; printf '%s\\n' '${grantEnvelope}' ;;\n  *) exit 20 ;;\nesac\n`,
		);
		await chmod(executable, 0o700);

		const result = await createNativeHumanIdentityAttestationDriver(
			executable,
			verifierIdentity,
		)({
			run,
			binding,
			service_id: "fixture",
			flow_id: "fill-week",
			auth_context_ref: "interactive-login",
			expected_url: "https://fixture.test/timesheet",
			allowed_origins: ["https://fixture.test"],
			target_id: "target-fixture",
			action_policy_hash: "a".repeat(64),
			implementation_integrity_key: "agent-browser:verified-handoff-v2",
		});
		expect(result).toMatchObject({
			ok: true,
			attestation: { identity_basis: "human-identity-attestation" },
		});
	});

	test("binds the broker grant to the exact blocked run and produces the auth-owned record", async () => {
		const harness = brokerHarness();
		const driver = createHumanIdentityAttestationDriver({
			broker: harness.broker,
			verifierIdentity: VERIFIER,
			verifier: approvalVerifier(),
			now: () => 20_000,
		});
		const result = await driver({
			run,
			binding,
			service_id: "fixture",
			flow_id: "fill-week",
			auth_context_ref: "interactive-login",
			expected_url: "https://fixture.test/timesheet",
			allowed_origins: ["https://fixture.test"],
			target_id: "target-fixture",
			action_policy_hash: "a".repeat(64),
			implementation_integrity_key: "agent-browser:verified-handoff-v2",
		});

		expect(result).toMatchObject({
			ok: true,
			attestation: {
				run_id: "run-fixture",
				handoff_evidence_id: "handoff-fixture",
				lane_id: "agent-browser",
				target_id: "target-fixture",
				service_id: "fixture",
				auth_context: "interactive-login",
				identity_basis: "human-identity-attestation",
				observed_at_epoch_ms: 10_000,
				fresh_until_epoch_ms: 40_000,
			},
		});
		expect(harness.requests).toHaveLength(1);
		expect(harness.requests[0]).toMatchObject({
			subject: {
				purpose: "human-identity-attestation",
				run_id: "run-fixture",
			},
			bound_facts: {
				handoff_evidence_id: "handoff-fixture",
				lane_id: "agent-browser",
				target_id: "target-fixture",
				mutation_target: "fixture/fill-week",
				mutation_scope: "https://fixture.test",
				action_policy_hash: "a".repeat(64),
			},
		});
	});

	test("refuses a rotated verifier or a grant for another run", async () => {
		for (const harness of [
			brokerHarness({ verifierKeyId: "rotated" }),
			brokerHarness({ runId: "other-run" }),
		]) {
			const driver = createHumanIdentityAttestationDriver({
				broker: harness.broker,
				verifierIdentity: VERIFIER,
				verifier: approvalVerifier(),
				now: () => 20_000,
			});
			const result = await driver({
				run,
				binding,
				service_id: "fixture",
				flow_id: "fill-week",
				auth_context_ref: "interactive-login",
				expected_url: "https://fixture.test/timesheet",
				allowed_origins: ["https://fixture.test"],
				target_id: "target-fixture",
				action_policy_hash: "a".repeat(64),
				implementation_integrity_key:
					"agent-browser:verified-handoff-v2",
			});
			expect(result.ok).toBe(false);
		}
	});
});
