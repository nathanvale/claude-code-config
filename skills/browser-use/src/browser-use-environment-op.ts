import { randomUUID } from "node:crypto";
import { normalizeOrigin } from "./browser-use-auth-bindings";
import type { BrowserUseDeliveredFieldShape } from "./browser-use-secret-scan";
import type {
	BrowserUseOpCommandSpec,
	BrowserUseOpCredentialField,
	BrowserUseOpExecute,
	BrowserUseOpExecutionOutcome,
	BrowserUseOpFailureCode,
	BrowserUseSecretHandle,
	BrowserUseTokenRetrievalPort,
	BrowserUseTokenRetrievalRejection,
} from "./browser-use-op";
import {
	buildCredentialFieldCommand,
	createOpTokenRetrievalPort,
} from "./browser-use-op";

const OUTPUT_LIMIT_BYTES = 1_048_576;
const DEFAULT_HANDLE_TTL_MS = 30_000;

type EnvironmentMetadataOperation =
	| { kind: "vault-list" }
	| { kind: "item-list"; vaultId: string }
	| { kind: "item-get"; vaultId: string; itemId: string };

type EnvironmentDeliveryOperation = {
	kind: "deliver";
	vaultId: string;
	itemId: string;
	field: BrowserUseOpCredentialField;
};

type EnvironmentOperation =
	| EnvironmentMetadataOperation
	| EnvironmentDeliveryOperation;

type EnvironmentOpDeps = {
	supervisorPath: string;
	opPath: string;
	configRoot: string;
	now?: () => number;
	mintHandleId?: () => string;
	handleTtlMs?: number;
};

type EnvironmentDeliveryDescriptor = {
	ws_url: string;
	target_url: string;
	target_origin: string;
	field: {
		role: string;
		accessible_name: string;
	};
	activation?: {
		role: string;
		accessible_name: string;
	};
	timeout_ms?: number;
};

export type BrowserUseEnvironmentCredentialRedemption = {
	handle: BrowserUseSecretHandle;
	target_digest: string;
} & EnvironmentDeliveryDescriptor;

export type BrowserUseEnvironmentDeliveryRejectionCode =
	| "handle-consumed"
	| "handle-expired"
	| "handle-binding-mismatch"
	| "target-digest-mismatch"
	| "missing-token"
	| "revoked-binding"
	| "unsupported-method"
	| "origin-mismatch"
	| "target-proof-invalid"
	| "capability-loss";

export type BrowserUseEnvironmentDeliveryResult =
	| { ok: true; shape: BrowserUseDeliveredFieldShape }
	| {
			ok: false;
			rejection: {
				code: BrowserUseEnvironmentDeliveryRejectionCode;
				message: string;
			};
			external_effect_possible: boolean;
			field_cleared: boolean;
	  };

export type BrowserUseEnvironmentCredentialFetchResult =
	| { ok: true; handle: BrowserUseSecretHandle }
	| {
			ok: false;
			rejection: BrowserUseTokenRetrievalRejection;
			blocked_cause?: "origin-mismatch" | "target-proof-invalid";
	  };

export type BrowserUseEnvironmentTokenRetrievalPort =
	Omit<BrowserUseTokenRetrievalPort, "fetchCredentialField"> & {
		fetchCredentialField(input: {
			binding: Parameters<
				BrowserUseTokenRetrievalPort["fetchCredentialField"]
			>[0]["binding"];
			field: BrowserUseOpCredentialField;
			target_digest?: string;
			observed_origin?: string;
		}): Promise<BrowserUseEnvironmentCredentialFetchResult>;
		redeemCredentialField(
			input: BrowserUseEnvironmentCredentialRedemption,
		): Promise<BrowserUseEnvironmentDeliveryResult>;
	};

type Reservation = {
	handle_id: string;
	binding: {
		vault_id: string;
		item_id: string;
	};
	field: BrowserUseOpCredentialField;
	target_digest: string;
	observed_origin: string;
	expires_at: number;
};

function operationOf(spec: BrowserUseOpCommandSpec): EnvironmentOperation | undefined {
	const argv = spec.argv;
	if (spec.capture === "json-evidence") {
		if (
			argv.length === 4 &&
			argv[0] === "op" &&
			argv[1] === "vault" &&
			argv[2] === "list" &&
			argv[3] === "--format=json"
		) {
			return { kind: "vault-list" };
		}
		if (
			argv.length === 8 &&
			argv[0] === "op" &&
			argv[1] === "item" &&
			argv[2] === "list" &&
			argv[3] === "--vault" &&
			argv[4] !== undefined &&
			argv[5] === "--categories" &&
			argv[6] === "Login" &&
			argv[7] === "--format=json"
		) {
			return { kind: "item-list", vaultId: argv[4] };
		}
		if (
			argv.length === 7 &&
			argv[0] === "op" &&
			argv[1] === "item" &&
			argv[2] === "get" &&
			argv[3] !== undefined &&
			argv[4] === "--vault" &&
			argv[5] !== undefined &&
			argv[6] === "--format=json"
		) {
			return { kind: "item-get", itemId: argv[3], vaultId: argv[5] };
		}
		return undefined;
	}

	if (
		spec.capture !== "secret-handle" ||
		argv[0] !== "op" ||
		argv[1] !== "item" ||
		argv[2] !== "get" ||
		argv[3] === undefined ||
		argv[4] !== "--vault" ||
		argv[5] === undefined
	) {
		return undefined;
	}
	let field: BrowserUseOpCredentialField | undefined;
	if (
		argv.length === 8 &&
		argv[6] === "--fields" &&
		argv[7] === "label=username"
	) {
		field = "username";
	} else if (
		argv.length === 9 &&
		argv[6] === "--fields" &&
		argv[7] === "label=password" &&
		argv[8] === "--reveal"
	) {
		field = "password";
	} else if (argv.length === 7 && argv[6] === "--otp") {
		field = "otp-current";
	}
	return field === undefined
		? undefined
		: {
				kind: "deliver",
				itemId: argv[3],
				vaultId: argv[5],
				field,
			};
}

function metadataInvocationFor(
	deps: EnvironmentOpDeps,
	operation: EnvironmentMetadataOperation,
): string[] {
	const argv = [
		deps.supervisorPath,
		"metadata",
		"--config-root",
		deps.configRoot,
		"--op-path",
		deps.opPath,
		"--operation",
		operation.kind,
	];
	if ("vaultId" in operation) argv.push("--vault-id", operation.vaultId);
	if ("itemId" in operation) argv.push("--item-id", operation.itemId);
	return argv;
}

function deliveryInvocationFor(
	deps: EnvironmentOpDeps,
	operation: EnvironmentDeliveryOperation,
	delivery: EnvironmentDeliveryDescriptor,
): string[] {
	const argv = [
		deps.supervisorPath,
		"deliver",
		"--config-root",
		deps.configRoot,
		"--op-path",
		deps.opPath,
		"--vault-id",
		operation.vaultId,
		"--item-id",
		operation.itemId,
		"--field",
		operation.field,
		"--ws-url",
		delivery.ws_url,
		"--target-url",
		delivery.target_url,
		"--target-origin",
		delivery.target_origin,
		"--field-role",
		delivery.field.role,
		"--field-name",
		delivery.field.accessible_name,
		"--timeout-ms",
		String(delivery.timeout_ms ?? 10_000),
	];
	if (delivery.activation !== undefined) {
		argv.push(
			"--activate-role",
			delivery.activation.role,
			"--activate-name",
			delivery.activation.accessible_name,
		);
	}
	return argv;
}

async function readBounded(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		total += next.value.byteLength;
		if (total > OUTPUT_LIMIT_BYTES) {
			await reader.cancel();
			throw new Error("native OP output exceeded its bound");
		}
		chunks.push(next.value);
	}
	return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function failure(code: BrowserUseOpFailureCode): BrowserUseOpExecutionOutcome {
	return {
		kind: "op-failure",
		failure: {
			code,
			message: "native environment-token execution was refused.",
		},
	};
}

function failureCodeOf(code: unknown): BrowserUseOpFailureCode {
	switch (code) {
		case "token-invalid":
			return "token-invalid";
		case "item-missing":
			return "item-missing";
		case "timeout":
			return "timeout";
		case "op-executable-unavailable":
		case "op-path-unavailable":
			return "capability-missing";
		default:
			return "io-failure";
	}
}

function parseMetadataResult(value: unknown): BrowserUseOpExecutionOutcome {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		(value as { schema_version?: unknown }).schema_version !== 1
	) {
		return failure("io-failure");
	}
	const envelope = value as {
		ok?: unknown;
		value?: unknown;
		rejection?: { code?: unknown };
	};
	if (envelope.ok === true && Object.hasOwn(envelope, "value")) {
		return { kind: "json-evidence", value: envelope.value };
	}
	return failure(failureCodeOf(envelope.rejection?.code));
}

type SupervisorRun =
	| { ok: true; exitCode: number; value: unknown }
	| { ok: false; failure: "timeout" | "io-failure" };

async function runSupervisor(
	deps: EnvironmentOpDeps,
	argv: string[],
	timeoutMs: number,
): Promise<SupervisorRun> {
	try {
		const child = Bun.spawn(argv, {
			env: { TMPDIR: deps.configRoot },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const stdout = readBounded(child.stdout);
		const stderr = readBounded(child.stderr);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timedOut = await Promise.race([
			child.exited.then(() => false),
			new Promise<true>((resolve) => {
				timer = setTimeout(() => resolve(true), timeoutMs);
			}),
		]);
		if (timer !== undefined) clearTimeout(timer);
		if (timedOut) {
			child.kill("SIGKILL");
			await child.exited;
			void Promise.allSettled([stdout, stderr]);
			return { ok: false, failure: "timeout" };
		}
		const exitCode = await child.exited;
		const [stdoutText] = await Promise.all([stdout, stderr]);
		if (child.signalCode != null) return { ok: false, failure: "io-failure" };
		return { ok: true, exitCode, value: JSON.parse(stdoutText) };
	} catch {
		return { ok: false, failure: "io-failure" };
	}
}

function createEnvironmentOpExecute(deps: EnvironmentOpDeps): BrowserUseOpExecute {
	return async (spec) => {
		const operation = operationOf(spec);
		if (operation === undefined || operation.kind === "deliver") {
			return failure("capability-missing");
		}
		const run = await runSupervisor(
			deps,
			metadataInvocationFor(deps, operation),
			spec.timeout_ms,
		);
		if (!run.ok) return failure(run.failure);
		const result = parseMetadataResult(run.value);
		const expectedExit = result.kind === "json-evidence" ? 0 : 20;
		return run.exitCode === expectedExit ? result : failure("io-failure");
	};
}

function retrievalRejection(
	code: BrowserUseTokenRetrievalRejection["code"],
	message: string,
): { ok: false; rejection: BrowserUseTokenRetrievalRejection } {
	return { ok: false, rejection: { code, message } };
}

function preconditionRejection(
	blockedCause: "origin-mismatch" | "target-proof-invalid",
	message: string,
): BrowserUseEnvironmentCredentialFetchResult {
	return {
		ok: false,
		rejection: {
			code: "binding-shape-invalid",
			message,
		},
		blocked_cause: blockedCause,
	};
}

function redemptionRejection(
	code: BrowserUseEnvironmentDeliveryRejectionCode,
	options: {
		externalEffectPossible?: boolean;
		fieldCleared?: boolean;
	} = {},
): BrowserUseEnvironmentDeliveryResult {
	return {
		ok: false,
		rejection: {
			code,
			message: "environment credential delivery was refused.",
		},
		external_effect_possible: options.externalEffectPossible ?? false,
		field_cleared: options.fieldCleared ?? false,
	};
}

function supervisorRejectionCode(
	code: unknown,
): BrowserUseEnvironmentDeliveryRejectionCode {
	switch (code) {
		case "token-invalid":
		case "token-custody-unavailable":
		case "token-file-missing":
			return "missing-token";
		case "item-missing":
			return "revoked-binding";
		case "process-failed":
			// The exact item was prevalidated before mint. A private-field
			// command failure now means that field is absent or unsupported.
			return "unsupported-method";
		default:
			return "capability-loss";
	}
}

function parseDeliveryResult(
	value: unknown,
	exitCode: number,
	field: BrowserUseOpCredentialField,
): BrowserUseEnvironmentDeliveryResult {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return redemptionRejection("capability-loss", {
			externalEffectPossible: true,
		});
	}
	const envelope = value as {
		ok?: unknown;
		shape?: { kind?: unknown; byte_length?: unknown };
		reason?: unknown;
		field_cleared?: unknown;
		rejection?: { code?: unknown };
	};
	if (
		exitCode === 0 &&
		envelope.ok === true &&
		envelope.shape?.kind === "utf8" &&
		Number.isSafeInteger(envelope.shape.byte_length) &&
		(envelope.shape.byte_length as number) >= 0 &&
		(envelope.shape.byte_length as number) <= 4_096
	) {
		return {
			ok: true,
			shape: {
				field,
				byte_length: envelope.shape.byte_length as number,
			},
		};
	}
	if (
		exitCode === 20 &&
		envelope.ok === false &&
		typeof envelope.reason === "string" &&
		typeof envelope.field_cleared === "boolean"
	) {
		const targetFailure = [
			"target-not-found",
			"target-ambiguous",
			"target-reproof-failed",
			"field-not-found",
			"field-ambiguous",
		].includes(envelope.reason);
		return redemptionRejection(
			targetFailure ? "target-proof-invalid" : "capability-loss",
			{
				externalEffectPossible: true,
				fieldCleared: envelope.field_cleared,
			},
		);
	}
	if (exitCode === 20 && envelope.rejection !== undefined) {
		const code = supervisorRejectionCode(envelope.rejection.code);
		return redemptionRejection(code, {
			externalEffectPossible: [
				"timeout",
				"process-signalled",
				"io-failure",
			].includes(String(envelope.rejection.code)),
		});
	}
	return redemptionRejection("capability-loss", {
		externalEffectPossible: true,
	});
}

function validDigest(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 256 &&
		!value.includes("\0") &&
		!value.includes("\n") &&
		!value.includes("\r")
	);
}

/**
 * Bind metadata retrieval and single-use confidential delivery to the native
 * owner-only environment token. Fetch performs only secret-free prevalidation;
 * redemption consumes its reservation synchronously before the supervisor can
 * spawn either disposable secret-bearing child.
 */
export function createEnvironmentTokenRetrievalPort(
	deps: EnvironmentOpDeps,
): BrowserUseEnvironmentTokenRetrievalPort {
	const metadataPort = createOpTokenRetrievalPort({
		execute: createEnvironmentOpExecute(deps),
		token_handle_id: "environment-token-custody",
	});
	const reservations = new Map<string, Reservation>();
	const now = deps.now ?? Date.now;
	const mintHandleId = deps.mintHandleId ?? randomUUID;
	const handleTtlMs = deps.handleTtlMs ?? DEFAULT_HANDLE_TTL_MS;

	return {
		...metadataPort,

		async fetchCredentialField(input) {
			if (!validDigest(input.target_digest)) {
				return preconditionRejection(
					"target-proof-invalid",
					"a fresh target digest is required before credential reservation.",
				);
			}
			if (typeof input.observed_origin !== "string") {
				return preconditionRejection(
					"origin-mismatch",
					"a freshly observed origin is required before credential reservation.",
				);
			}
			const observed = normalizeOrigin(input.observed_origin);
			if (
				!observed.ok ||
				observed.origin !== input.observed_origin ||
				!input.binding.allowed_origins.includes(observed.origin)
			) {
				return preconditionRejection(
					"origin-mismatch",
					"the observed origin is outside the item binding.",
				);
			}

			const built = buildCredentialFieldCommand({
				token_handle_id: "environment-token-custody",
				binding: input.binding,
				field: input.field,
			});
			if (!built.ok) {
				return retrievalRejection(
					"field-not-permitted",
					built.rejection.message,
				);
			}
			const operation = operationOf(built.spec);
			if (operation === undefined || operation.kind !== "deliver") {
				return retrievalRejection(
					"capability-missing",
					"the environment lane cannot map the requested private field.",
				);
			}

			const exactItem = await metadataPort.getLoginItem({
				vault_id: input.binding.vault_id,
				item_id: input.binding.item_id,
			});
			if (!exactItem.ok) return exactItem;
			if (
				exactItem.item.vault_id !== input.binding.vault_id ||
				exactItem.item.item_id !== input.binding.item_id
			) {
				return retrievalRejection(
					"item-missing",
					"the exact item binding was not reproduced.",
				);
			}
			if (
				!exactItem.item.origins.includes(observed.origin) ||
				exactItem.item.state !== "active"
			) {
				return exactItem.item.state === "active"
					? preconditionRejection(
							"origin-mismatch",
							"the exact item no longer satisfies the approved origin.",
						)
					: retrievalRejection(
							"item-missing",
							"the exact item no longer satisfies the approved binding.",
						);
			}

			try {
				const mintedAt = now();
				if (
					!Number.isSafeInteger(mintedAt) ||
					!Number.isSafeInteger(handleTtlMs) ||
					handleTtlMs <= 0
				) {
					return retrievalRejection(
						"io-failure",
						"the reservation clock or lifetime is invalid.",
					);
				}
				const handleId = mintHandleId();
				if (
					typeof handleId !== "string" ||
					handleId.length === 0 ||
					handleId.length > 256 ||
					reservations.has(handleId)
				) {
					return retrievalRejection(
						"io-failure",
						"the reservation identifier could not be minted uniquely.",
					);
				}
				const expiresAt = mintedAt + handleTtlMs;
				if (!Number.isSafeInteger(expiresAt)) {
					return retrievalRejection(
						"io-failure",
						"the reservation expiry is outside the safe clock range.",
					);
				}
				reservations.set(handleId, {
					handle_id: handleId,
					binding: {
						vault_id: operation.vaultId,
						item_id: operation.itemId,
					},
					field: operation.field,
					target_digest: input.target_digest,
					observed_origin: observed.origin,
					expires_at: expiresAt,
				});
				return {
					ok: true,
					handle: {
						handle_id: handleId,
						field: operation.field,
						expires_at_epoch_ms: expiresAt,
					},
				};
			} catch {
				return retrievalRejection(
					"io-failure",
					"the reservation identifier could not be minted.",
				);
			}
		},

		async redeemCredentialField(input) {
			const reservation = reservations.get(input.handle.handle_id);
			if (reservation === undefined) {
				return redemptionRejection("handle-consumed");
			}
			// Atomic consume: no await or process spawn occurs before deletion.
			reservations.delete(input.handle.handle_id);

			if (
				input.handle.field !== reservation.field ||
				input.handle.expires_at_epoch_ms !== reservation.expires_at
			) {
				return redemptionRejection("handle-binding-mismatch");
			}
			let currentTime: number;
			try {
				currentTime = now();
			} catch {
				return redemptionRejection("capability-loss");
			}
			if (!Number.isSafeInteger(currentTime) || currentTime >= reservation.expires_at) {
				return redemptionRejection("handle-expired");
			}
			if (
				!validDigest(input.target_digest) ||
				input.target_digest !== reservation.target_digest
			) {
				return redemptionRejection("target-digest-mismatch");
			}
			const targetOrigin = normalizeOrigin(input.target_origin);
			const targetUrlOrigin = normalizeOrigin(input.target_url);
			if (
				!targetOrigin.ok ||
				!targetUrlOrigin.ok ||
				targetOrigin.origin !== input.target_origin ||
				targetUrlOrigin.origin !== reservation.observed_origin ||
				targetOrigin.origin !== reservation.observed_origin
			) {
				return redemptionRejection("origin-mismatch");
			}

			const operation: EnvironmentDeliveryOperation = {
				kind: "deliver",
				vaultId: reservation.binding.vault_id,
				itemId: reservation.binding.item_id,
				field: reservation.field,
			};
			const timeoutMs = input.timeout_ms ?? 10_000;
			const run = await runSupervisor(
				deps,
				deliveryInvocationFor(deps, operation, input),
				timeoutMs,
			);
			if (!run.ok) {
				return redemptionRejection("capability-loss", {
					// The supervisor invocation began. A transport, parse, signal,
					// or timeout failure cannot prove the bounded write did not land.
					externalEffectPossible: true,
				});
			}
			return parseDeliveryResult(run.value, run.exitCode, reservation.field);
		},
	};
}
