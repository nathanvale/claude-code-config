import { isAbsolute } from "node:path";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import {
	type BrowserUseOpCredentialField,
	type BrowserUseSecretHandle,
	type BrowserUseTokenRetrievalPort,
	mintDeferredCredentialCapability,
	projectLoginItemGetOutput,
	projectLoginItemListOutput,
	projectPrincipalBoundBindingEvidenceOutput,
	projectServiceAccountIdentityOutput,
	projectVaultListOutput,
} from "./browser-use-op";

const MINIMUM_OP_VERSION = [2, 18, 0] as const;
const SAFE_COORDINATE = /^[A-Za-z0-9._:-]{1,256}$/;

export type BrowserUseEnvironmentOpAdmission =
	| {
			ok: true;
			executable_path: string;
			version: string;
	  }
	| {
			ok: false;
			cause:
				| "op-path-not-absolute"
				| "op-version-invalid"
				| "op-version-unsupported";
	  };

function parseVersion(value: string): readonly [number, number, number] | undefined {
	const match = /^(\d+)\.(\d+)\.(\d+)\r?\n?$/.exec(value);
	if (match === null) return undefined;
	const parts = match.slice(1).map((part) => Number(part));
	if (parts.some((part) => !Number.isSafeInteger(part))) return undefined;
	return parts as unknown as readonly [number, number, number];
}

function versionAtLeast(
	observed: readonly [number, number, number],
	minimum: readonly [number, number, number],
): boolean {
	for (let index = 0; index < observed.length; index += 1) {
		const left = observed[index] ?? 0;
		const right = minimum[index] ?? 0;
		if (left !== right) return left > right;
	}
	return true;
}

/** Admit one absolute official OP executable using its exact version output. */
export function admitEnvironmentOpExecutable(input: {
	executable_path: string;
	version_stdout: string;
}): BrowserUseEnvironmentOpAdmission {
	if (!isAbsolute(input.executable_path)) {
		return { ok: false, cause: "op-path-not-absolute" };
	}
	const version = parseVersion(input.version_stdout);
	if (version === undefined) return { ok: false, cause: "op-version-invalid" };
	if (!versionAtLeast(version, MINIMUM_OP_VERSION)) {
		return { ok: false, cause: "op-version-unsupported" };
	}
	return {
		ok: true,
		executable_path: input.executable_path,
		version: version.join("."),
	};
}

export type BrowserUseEnvironmentOpMetadataOperation =
	| { kind: "user-get" }
	| { kind: "vault-list" }
	| { kind: "item-list"; vault_id: string }
	| { kind: "item-get"; vault_id: string; item_id: string }
	| {
			kind: "binding-evidence";
			expected_vault_id: string | null;
			item_id: string | null;
	  };

export type BrowserUseEnvironmentOpMetadataInvocation = {
	executable_path: string;
	argv: readonly string[];
	env: Readonly<Record<string, never>>;
	inherited_fds: readonly number[];
};

export type BrowserUseEnvironmentOpValidatorInvocation = {
	executable_path: string;
	argv: readonly string[];
	env: Readonly<Record<string, never>>;
	inherited_fds: readonly [number];
};

function assertAbsolute(path: string, label: string): void {
	if (!isAbsolute(path)) throw new TypeError(`${label} must be absolute`);
}

function assertCoordinate(value: string, label: string): void {
	if (!SAFE_COORDINATE.test(value)) {
		throw new TypeError(`${label} must be a bounded safe identifier`);
	}
}

/** Build the exact secret-free supervisor invocation for one metadata operation. */
export function buildEnvironmentOpMetadataInvocation(input: {
	supervisor_path: string;
	op_path: string;
	config_root: string;
	operation: BrowserUseEnvironmentOpMetadataOperation;
}): BrowserUseEnvironmentOpMetadataInvocation {
	assertAbsolute(input.supervisor_path, "OP supervisor path");
	assertAbsolute(input.op_path, "OP executable path");
	assertAbsolute(input.config_root, "Browser Use config root");
	const argv = [
		"metadata",
		"--config-root",
		input.config_root,
		"--op-path",
		input.op_path,
		"--operation",
		input.operation.kind,
	];
	if ("vault_id" in input.operation) {
		assertCoordinate(input.operation.vault_id, "vault id");
		argv.push("--vault-id", input.operation.vault_id);
	}
	if ("item_id" in input.operation) {
		if (input.operation.item_id !== null) {
			assertCoordinate(input.operation.item_id, "item id");
			argv.push("--item-id", input.operation.item_id);
		}
	}
	if (
		"expected_vault_id" in input.operation &&
		input.operation.expected_vault_id !== null
	) {
		assertCoordinate(input.operation.expected_vault_id, "expected vault id");
		argv.push("--expected-vault-id", input.operation.expected_vault_id);
	}
	return {
		executable_path: input.supervisor_path,
		argv,
		env: {},
		inherited_fds: [],
	};
}

/** Build the exact native validator service invocation for one SCM_RIGHTS socket. */
export function buildEnvironmentOpValidatorInvocation(input: {
	supervisor_path: string;
	op_path: string;
	validator_fd: number;
}): BrowserUseEnvironmentOpValidatorInvocation {
	assertAbsolute(input.supervisor_path, "OP supervisor path");
	assertAbsolute(input.op_path, "OP executable path");
	if (!Number.isSafeInteger(input.validator_fd) || input.validator_fd < 3) {
		throw new TypeError("validator fd must be an inherited non-standard fd");
	}
	return {
		executable_path: input.supervisor_path,
		argv: [
			"validate",
			"--validator-fd",
			String(input.validator_fd),
			"--op-path",
			input.op_path,
		],
		env: {},
		inherited_fds: [input.validator_fd],
	};
}

export type BrowserUseEnvironmentOpMetadataResult =
	| { ok: true; value: unknown }
	| {
			ok: false;
			rejection: {
				code:
					| "capability-missing"
					| "token-invalid"
					| "token-revoked"
					| "item-missing"
					| "timeout"
					| "io-failure"
					| "output-shape-invalid";
				message: string;
			};
	  };

const NATIVE_REJECTION_MAP = {
	"token-invalid": "token-invalid",
	"item-missing": "item-missing",
	timeout: "timeout",
	"io-failure": "io-failure",
	"output-shape-invalid": "output-shape-invalid",
	"op-executable-unavailable": "capability-missing",
	"op-path-not-absolute": "capability-missing",
	"op-path-unapproved": "capability-missing",
	"op-path-unavailable": "capability-missing",
	"op-path-unsafe": "capability-missing",
	"op-path-not-executable": "capability-missing",
	"op-binary-untrusted": "capability-missing",
	"op-staging-failed": "capability-missing",
	"op-version-invalid": "capability-missing",
	"op-version-unsupported": "capability-missing",
	"output-too-large": "io-failure",
	"process-failed": "io-failure",
	"process-signalled": "io-failure",
	"validator-protocol-invalid": "io-failure",
} as const;

/** Parse the versioned native envelope without relaying native messages. */
export function parseEnvironmentOpMetadataResult(
	value: unknown,
): BrowserUseEnvironmentOpMetadataResult {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return {
			ok: false,
			rejection: {
				code: "output-shape-invalid",
				message: "native OP envelope was invalid.",
			},
		};
	}
	const candidate = value as Record<string, unknown>;
	if (candidate.schema_version !== 1 || typeof candidate.ok !== "boolean") {
		return {
			ok: false,
			rejection: {
				code: "output-shape-invalid",
				message: "native OP envelope version was invalid.",
			},
		};
	}
	if (candidate.ok) {
		if (!Object.hasOwn(candidate, "value")) {
			return {
				ok: false,
				rejection: {
					code: "output-shape-invalid",
					message: "native OP envelope omitted its projected value.",
				},
			};
		}
		return { ok: true, value: candidate.value };
	}
	const rejection = candidate.rejection;
	if (
		typeof rejection !== "object" ||
		rejection === null ||
		Array.isArray(rejection)
	) {
		return {
			ok: false,
			rejection: {
				code: "output-shape-invalid",
				message: "native OP rejection was invalid.",
			},
		};
	}
	const nativeCode = (rejection as Record<string, unknown>).code;
	const code =
		typeof nativeCode === "string" &&
		Object.hasOwn(NATIVE_REJECTION_MAP, nativeCode)
			? NATIVE_REJECTION_MAP[nativeCode as keyof typeof NATIVE_REJECTION_MAP]
			: "io-failure";
	return {
		ok: false,
		rejection: {
			code,
			message: "native OP execution was refused; inspect the typed code.",
		},
	};
}

export type BrowserUseEnvironmentOpTokenRetrievalDeps = {
	executeMetadata: (
		operation: BrowserUseEnvironmentOpMetadataOperation,
	) => Promise<BrowserUseEnvironmentOpMetadataResult>;
	mintCapability: (input: {
		binding: BrowserUseItemBinding;
		field: BrowserUseOpCredentialField;
	}) => BrowserUseSecretHandle;
};

/**
 * Adapt the native metadata protocol to the existing provider port.
 *
 * Credential fetch is capability minting only. U7 consumes the handle and owns
 * the direct native OP-to-delivery pipe.
 */
export function createEnvironmentOpTokenRetrievalPort(
	deps: BrowserUseEnvironmentOpTokenRetrievalDeps,
): BrowserUseTokenRetrievalPort {
	return {
		async getBindingEvidence(input) {
			const result = await deps.executeMetadata({
				kind: "binding-evidence",
				expected_vault_id: input.expected_vault_id,
				item_id: input.item_id,
			});
			if (!result.ok) return result;
			const projected = projectPrincipalBoundBindingEvidenceOutput(result.value);
			return projected.ok
				? { ok: true, evidence: projected.value }
				: {
						ok: false,
						rejection: {
							code: "output-shape-invalid",
							message: "native principal-bound binding evidence was invalid.",
						},
					};
		},
		async getServiceAccountIdentity() {
			const result = await deps.executeMetadata({ kind: "user-get" });
			if (!result.ok) return result;
			const projected = projectServiceAccountIdentityOutput(result.value);
			return projected.ok
				? { ok: true, identity: projected.value }
				: {
						ok: false,
						rejection: {
							code: "output-shape-invalid",
							message: "native OP identity projection was invalid.",
						},
					};
		},

		async listVaults() {
			const result = await deps.executeMetadata({ kind: "vault-list" });
			if (!result.ok) return result;
			const projected = projectVaultListOutput(result.value);
			return projected.ok
				? { ok: true, vaults: projected.value }
				: {
						ok: false,
						rejection: {
							code: "output-shape-invalid",
							message: "native OP vault projection was invalid.",
						},
					};
		},
		async listLoginItems(input) {
			const result = await deps.executeMetadata({
				kind: "item-list",
				vault_id: input.vault_id,
			});
			if (!result.ok) return result;
			const projected = projectLoginItemListOutput(result.value);
			return projected.ok
				? { ok: true, items: projected.value }
				: {
						ok: false,
						rejection: {
							code: "output-shape-invalid",
							message: "native OP item projection was invalid.",
						},
					};
		},
		async getLoginItem(input) {
			const result = await deps.executeMetadata({
				kind: "item-get",
				vault_id: input.vault_id,
				item_id: input.item_id,
			});
			if (!result.ok) return result;
			const projected = projectLoginItemGetOutput(result.value);
			return projected.ok
				? { ok: true, item: projected.value }
				: {
						ok: false,
						rejection: {
							code: "output-shape-invalid",
							message: "native OP item projection was invalid.",
						},
					};
		},
		async fetchCredentialField(input) {
			return mintDeferredCredentialCapability({
				binding: input.binding,
				field: input.field,
				mint: deps.mintCapability,
			});
		},
	};
}
