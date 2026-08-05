import { createHash, createPublicKey, verify } from "node:crypto";
import { isAbsolute } from "node:path";
import type {
	BrowserUseApprovalBoundFacts,
	BrowserUseApprovalPresenceRejection,
	BrowserUseApprovalVerifier,
	BrowserUseOneUseGrant,
	BrowserUseVerifierIdentity,
} from "./browser-use-auth-approval";
import {
	createApprovalVerifier,
	oneUseGrantDigestOf,
	validateOneUseGrantShape,
} from "./browser-use-auth-approval";
import type {
	BrowserUseAuthContext,
	BrowserUseItemBinding,
} from "./browser-use-auth-bindings";
import type { BrowserUseAuthAttestation } from "./browser-use-auth-model";
import type { BrowserUseSharedRun } from "./browser-use-run-model";
import { reviewedActionVerifierIdentityIsValid } from "./browser-use-reviewed-action-approval";

/** Environment key naming the signed ApprovalBroker executable. */
export { BROWSER_USE_APPROVAL_BROKER_ENV } from "./command-contract";

const MAXIMUM_BROKER_OUTPUT_BYTES = 1_048_576;
const BROKER_ATTEST_TIMEOUT_MS = 5 * 60_000;
const BROKER_VERIFIER_TIMEOUT_MS = 30_000;

/** One exact human-attestation request accepted by the isolated broker. */
export type BrowserUseHumanIdentityAttestationBrokerRequest = {
	subject: {
		purpose: "human-identity-attestation";
		run_id: string;
	};
	bound_facts: BrowserUseApprovalBoundFacts;
	display: readonly string[];
};

/** Presence-backed broker surface used only for one-run identity claims. */
export type BrowserUseHumanIdentityAttestationOperatorBroker = {
	readVerifierIdentity(): Promise<
		| { ok: true; identity: BrowserUseVerifierIdentity }
		| { ok: false; code: string; message: string }
	>;
	issueHumanIdentityAttestation(
		input: BrowserUseHumanIdentityAttestationBrokerRequest,
	): Promise<
		| { ok: true; grant: BrowserUseOneUseGrant }
		| { ok: false; rejection: BrowserUseApprovalPresenceRejection }
	>;
};

/** Exact blocked-run facts the attestation driver binds before presence. */
export type BrowserUseHumanIdentityAttestationInput = {
	run: BrowserUseSharedRun;
	binding: BrowserUseItemBinding;
	service_id: string;
	flow_id: string;
	auth_context_ref: BrowserUseAuthContext;
	expected_url: string;
	allowed_origins: readonly string[];
	target_id: string;
	action_policy_hash: string;
	implementation_integrity_key: string;
};

/** Result returned to the auth transaction after broker verification. */
export type BrowserUseHumanIdentityAttestationResult =
	| { ok: true; attestation: BrowserUseAuthAttestation }
	| { ok: false; code: string; message: string };

/** One-run attestation callback injected into the Runbook auth transaction. */
export type BrowserUseHumanIdentityAttestationDriver = (
	input: BrowserUseHumanIdentityAttestationInput,
) => Promise<BrowserUseHumanIdentityAttestationResult>;

type NativeHumanIdentityEnvelope =
	| { ok: true; verifier: BrowserUseVerifierIdentity }
	| { ok: true; grant: BrowserUseOneUseGrant }
	| { ok: false; code: string; message: string };

async function invokeNativeBroker(
	executablePath: string,
	command: "verifier" | "attest",
	input?: unknown,
): Promise<NativeHumanIdentityEnvelope> {
	if (!isAbsolute(executablePath)) {
		return {
			ok: false,
			code: "broker-path-invalid",
			message: "the approval broker path must be absolute.",
		};
	}
	try {
		const child = Bun.spawn([executablePath, command], {
			stdin: input === undefined ? "ignore" : "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
			timeout:
				command === "attest"
					? BROKER_ATTEST_TIMEOUT_MS
					: BROKER_VERIFIER_TIMEOUT_MS,
			maxBuffer: MAXIMUM_BROKER_OUTPUT_BYTES,
		});
		if (input !== undefined) {
			if (child.stdin === undefined) {
				return {
					ok: false,
					code: "broker-failed",
					message: "the native approval broker stdin is unavailable.",
				};
			}
			child.stdin.write(`${JSON.stringify(input)}\n`);
			child.stdin.end();
		}
		const [exitCode, stdout] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		if (
			exitCode !== 0 ||
			Buffer.byteLength(stdout, "utf8") > MAXIMUM_BROKER_OUTPUT_BYTES
		) {
			return {
				ok: false,
				code: "broker-failed",
				message: "the native approval broker failed closed.",
			};
		}
		const parsed: unknown = JSON.parse(stdout);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			typeof (parsed as { ok?: unknown }).ok !== "boolean"
		) {
			return {
				ok: false,
				code: "broker-failed",
				message: "the native approval broker returned a malformed envelope.",
			};
		}
		return parsed as NativeHumanIdentityEnvelope;
	} catch {
		return {
			ok: false,
			code: "broker-failed",
			message: "the native approval broker could not be invoked.",
		};
	}
}

/**
 * Create the subprocess adapter for the signed broker's attestation command.
 *
 * @param executablePath - Absolute path to the persisted app executable
 * @returns Narrow operator broker with verifier discovery and attestation only
 *
 * @example
 * ```typescript
 * const broker = createNativeHumanIdentityAttestationOperatorBroker(path)
 * ```
 */
function createNativeHumanIdentityAttestationOperatorBroker(
	executablePath: string,
): BrowserUseHumanIdentityAttestationOperatorBroker {
	return {
		async readVerifierIdentity() {
			const result = await invokeNativeBroker(executablePath, "verifier");
			if (!result.ok) return result;
			if (
				!("verifier" in result) ||
				!reviewedActionVerifierIdentityIsValid(result.verifier)
			) {
				return {
					ok: false,
					code: "broker-verifier-invalid",
					message:
						"the native broker returned an invalid verifier identity.",
				};
			}
			return { ok: true, identity: result.verifier };
		},
		async issueHumanIdentityAttestation(input) {
			const result = await invokeNativeBroker(executablePath, "attest", input);
			if (!result.ok) {
				const code = [
					"presence-cancelled",
					"biometric-capability-missing",
					"headless-environment",
				].includes(result.code)
					? (result.code as BrowserUseApprovalPresenceRejection["code"])
					: "broker-unavailable";
				return {
					ok: false,
					rejection: { code, message: result.message },
				};
			}
			if (
				!("grant" in result) ||
				validateOneUseGrantShape(result.grant).length > 0
			) {
				return {
					ok: false,
					rejection: {
						code: "broker-unavailable",
						message: "the native broker returned an invalid one-run grant.",
					},
				};
			}
			return { ok: true, grant: result.grant };
		},
	};
}

/**
 * Build the presence-free P-256 verifier for one-use broker grants.
 *
 * @param identity - Pinned raw P-256 verifier identity
 * @returns Offline grant verifier with process-local atomic reservation
 *
 * @example
 * ```typescript
 * const verifier = createP256HumanIdentityApprovalVerifier(identity)
 * ```
 */
function createP256HumanIdentityApprovalVerifier(
	identity: BrowserUseVerifierIdentity,
): BrowserUseApprovalVerifier {
	const consumed = new Set<string>();
	let publicKey: ReturnType<typeof createPublicKey> | undefined;
	if (reviewedActionVerifierIdentityIsValid(identity)) {
		const raw = Buffer.from(identity.public_key, "base64");
		try {
			publicKey = createPublicKey({
				key: {
					kty: "EC",
					crv: "P-256",
					x: raw.subarray(1, 33).toString("base64url"),
					y: raw.subarray(33, 65).toString("base64url"),
				},
				format: "jwk",
			});
		} catch {
			publicKey = undefined;
		}
	}
	return createApprovalVerifier({
		verifier: identity,
		verifySignature: ({ digest, signature, key_id }) => {
			if (publicKey === undefined || key_id !== identity.key_id) return false;
			try {
				return verify(
					"sha256",
					Buffer.from(digest, "hex"),
					publicKey,
					Buffer.from(signature, "base64"),
				);
			} catch {
				return false;
			}
		},
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
	});
}

/**
 * Compose the signed native broker with its pinned offline verifier.
 *
 * @param executablePath - Absolute signed broker executable path
 * @param verifierIdentity - Previously pinned broker public identity
 * @returns Production one-run attestation driver
 *
 * @example
 * ```typescript
 * const driver = createNativeHumanIdentityAttestationDriver(path, identity)
 * ```
 */
export function createNativeHumanIdentityAttestationDriver(
	executablePath: string,
	verifierIdentity: BrowserUseVerifierIdentity,
): BrowserUseHumanIdentityAttestationDriver {
	return createHumanIdentityAttestationDriver({
		broker: createNativeHumanIdentityAttestationOperatorBroker(executablePath),
		verifierIdentity,
		verifier: createP256HumanIdentityApprovalVerifier(verifierIdentity),
		now: Date.now,
	});
}

function referenceOf(label: string, binding: BrowserUseItemBinding): string {
	const canonical = JSON.stringify([
		label,
		binding.service_id,
		binding.auth_context,
		binding.vault_id,
		binding.item_id,
		binding.binding_revision,
	]);
	return `${label}:sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function exactOriginOf(
	expectedUrl: string,
	allowedOrigins: readonly string[],
): string | undefined {
	try {
		const origin = new URL(expectedUrl).origin;
		return allowedOrigins.includes(origin) ? origin : undefined;
	} catch {
		return undefined;
	}
}

function verifierIdentityMatches(
	left: BrowserUseVerifierIdentity,
	right: BrowserUseVerifierIdentity,
): boolean {
	return left.key_id === right.key_id && left.public_key === right.public_key;
}

/**
 * Build the one-run broker driver that verifies and consumes a signed grant.
 *
 * The broker sees only redacted references and exact run/target/policy facts.
 * The returned auth record binds those verified facts to the Shared Run; it
 * carries no reusable signing or broker capability.
 *
 * @param deps - Pinned verifier, offline verifier, and isolated broker adapter
 * @returns Driver invoked only after the run persists its user-presence gate
 * @throws Never. Broker and verification failures become typed refusals.
 *
 * @example
 * ```typescript
 * const attest = createHumanIdentityAttestationDriver({
 *   broker,
 *   verifierIdentity,
 *   verifier,
 * })
 * ```
 */
export function createHumanIdentityAttestationDriver(deps: {
	broker: BrowserUseHumanIdentityAttestationOperatorBroker;
	verifierIdentity: BrowserUseVerifierIdentity;
	verifier: BrowserUseApprovalVerifier;
	now: () => number;
}): BrowserUseHumanIdentityAttestationDriver {
	return async (input) => {
		const run = input.run;
		if (
			run.state !== "awaiting-user-presence" ||
			run.continuation?.next_action_id !==
				"complete-human-identity-attestation" ||
			run.adapter_id !== "agent-browser" ||
			run.handoff_evidence_id === undefined
		) {
			return {
				ok: false,
				code: "human_identity_attestation_run_invalid",
				message:
					"the Shared Run is not at the exact one-run identity-attestation gate.",
			};
		}
		const origin = exactOriginOf(input.expected_url, input.allowed_origins);
		if (origin === undefined) {
			return {
				ok: false,
				code: "human_identity_attestation_origin_invalid",
				message: "the current target origin is outside the Runbook policy.",
			};
		}
		const subjectReference = referenceOf("subject", input.binding);
		const accountReference = referenceOf("account", input.binding);
		const tenantReference = referenceOf("tenant", input.binding);
		const boundFacts: BrowserUseApprovalBoundFacts = {
			service_id: input.service_id,
			auth_context: input.auth_context_ref,
			environment: run.environment_profile.environment,
			profile: run.environment_profile.profile,
			origin,
			runbook_id: `${input.service_id}/${input.flow_id}`,
			action: "runbook-run",
			mutation_class: "runbook-execution",
			handoff_evidence_id: run.handoff_evidence_id,
			lane_id: run.adapter_id,
			target_id: input.target_id,
			subject_reference: subjectReference,
			account_reference: accountReference,
			tenant_reference: tenantReference,
			mutation_target: `${input.service_id}/${input.flow_id}`,
			mutation_scope: origin,
			action_policy_hash: input.action_policy_hash,
		};
		try {
			const observedVerifier = await deps.broker.readVerifierIdentity();
			if (
				!observedVerifier.ok ||
				!verifierIdentityMatches(
					observedVerifier.identity,
					deps.verifierIdentity,
				)
			) {
				return {
					ok: false,
					code: "human_identity_attestation_verifier_mismatch",
					message:
						"the approval broker verifier differs from the pinned identity.",
				};
			}
			const subject = {
				purpose: "human-identity-attestation" as const,
				run_id: run.run_id,
			};
			const issued = await deps.broker.issueHumanIdentityAttestation({
				subject,
				bound_facts: boundFacts,
				display: [
					`run=${run.run_id}`,
					`target=${input.service_id}/${input.flow_id}`,
					`origin=${origin}`,
					`profile=${run.environment_profile.environment}/${run.environment_profile.profile}`,
				],
			});
			if (!issued.ok) {
				return {
					ok: false,
					code: issued.rejection.code,
					message: issued.rejection.message,
				};
			}
			const consumed = deps.verifier.consumeOneUseGrant({
				grant: issued.grant,
				expected: subject,
				facts: boundFacts,
				at_epoch_ms: deps.now(),
			});
			if (!consumed.ok) {
				return {
					ok: false,
					code: consumed.refusal.code,
					message: consumed.refusal.message,
				};
			}
			const { signature: _signature, ...unsignedGrant } = issued.grant;
			const identityBasisDigest = oneUseGrantDigestOf(unsignedGrant);
			return {
				ok: true,
				attestation: {
					run_id: run.run_id,
					handoff_evidence_id: run.handoff_evidence_id,
					lane_id: "agent-browser",
					implementation_integrity_key:
						input.implementation_integrity_key,
					environment: run.environment_profile.environment,
					profile: run.environment_profile.profile,
					target_id: input.target_id,
					page_id: input.target_id,
					frame_id: input.target_id,
					service_id: input.service_id,
					auth_context: input.auth_context_ref,
					subject_reference: subjectReference,
					account_reference: accountReference,
					tenant_reference: tenantReference,
					identity_basis: "human-identity-attestation",
					identity_basis_digest: identityBasisDigest,
					observed_at_epoch_ms: issued.grant.issued_at_epoch_ms,
					fresh_until_epoch_ms: issued.grant.expires_at_epoch_ms,
				},
			};
		} catch {
			return {
				ok: false,
				code: "human_identity_attestation_broker_failed",
				message: "the approval broker failed closed.",
			};
		}
	};
}
