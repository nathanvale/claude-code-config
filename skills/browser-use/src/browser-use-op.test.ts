import { describe, expect, test } from "bun:test";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import { BROWSER_USE_VAULT_ITEM_EVIDENCE_KEYS } from "./browser-use-auth-bindings";
import { BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE } from "./browser-use-auth-model";
import {
	type BrowserUseOpCommandSpec,
	type BrowserUseOpCredentialField,
	type BrowserUseOpExecute,
	type BrowserUseOpExecutionOutcome,
	type BrowserUseTokenRetrievalRejectionCode,
	BROWSER_USE_OP_CAPTURE_MODES,
	BROWSER_USE_OP_CREDENTIAL_FIELDS,
	BROWSER_USE_OP_FAILURE_CODES,
	BROWSER_USE_OP_FORBIDDEN_ENV_KEYS,
	BROWSER_USE_OP_TOKEN_ENV_KEY,
	blockOfRetrievalRejection,
	buildCredentialFieldCommand,
	buildLoginItemGetCommand,
	buildLoginItemListCommand,
	buildVaultListCommand,
	createOpTokenRetrievalPort,
	projectLoginItemGetOutput,
	projectLoginItemListOutput,
	projectVaultListOutput,
	proveVaultScope,
	screenOpEnvironmentProposal,
} from "./browser-use-op";

// ---------------------------------------------------------------------------
// browser-use-op seam proof (auth plan U3a PR1; R7, R8, R11-R13, R16;
// ADR 0028, ADR 0029; KTD7, spec D9).
//
// Proves the pure op CLI model: environment screening rejects principal
// override and ambient token exposure; command specs are data with an
// opaque token handle and never a secret; vault-scope proof blocks 0/2+
// vaults before any item discovery; projections fail closed on secret-shaped
// or malformed output and strip identity metadata; the TokenRetrievalPort
// never throws and never lets op output escape unredacted — a JSON payload
// on the secret-handle path is discarded unexamined; every retrieval
// rejection maps to an existing blocked cause with the cause table's own
// continuation (missing native capability is a legal typed state).
// ---------------------------------------------------------------------------

const TOKEN_HANDLE = "token-handle-1";

function baseBinding(
	overrides: Partial<BrowserUseItemBinding> = {},
): BrowserUseItemBinding {
	return {
		service_id: "oncore",
		auth_context: "interactive-login",
		allowed_origins: ["https://portal.example.com"],
		allowed_login_paths: ["/login"],
		vault_id: "vault-1",
		item_id: "item-1",
		allowed_auth_methods: ["password", "otp"],
		binding_revision: 1,
		...overrides,
	};
}

function baseItemRow(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: "item-1",
		vault: { id: "vault-1" },
		category: "LOGIN",
		urls: [{ href: "https://Portal.Example.com/login", primary: true }],
		state: "active",
		...overrides,
	};
}

function executorOf(outcome: BrowserUseOpExecutionOutcome): {
	calls: BrowserUseOpCommandSpec[];
	execute: BrowserUseOpExecute;
} {
	const calls: BrowserUseOpCommandSpec[] = [];
	const execute: BrowserUseOpExecute = async (spec) => {
		calls.push(spec);
		return outcome;
	};
	return { calls, execute };
}

const EXPECTED_ENV = {
	token_env_key: "OP_SERVICE_ACCOUNT_TOKEN",
	token_handle_id: TOKEN_HANDLE,
	inherit: false,
} as const;

describe("environment screening (R7/R16)", () => {
	test("Connect variables are rejected as a principal override", () => {
		const issues = screenOpEnvironmentProposal([
			{ key: "OP_CONNECT_HOST", value_present: true },
			{ key: "OP_CONNECT_TOKEN", value_present: false },
		]);
		expect(issues).toHaveLength(2);
		for (const issue of issues) {
			expect(issue.code).toBe("op_connect_principal_override");
		}
		expect(issues.map((issue) => issue.path)).toEqual([
			"env.OP_CONNECT_HOST",
			"env.OP_CONNECT_TOKEN",
		]);
	});

	test("a caller-supplied token value is rejected as exposure", () => {
		const issues = screenOpEnvironmentProposal([
			{ key: "OP_SERVICE_ACCOUNT_TOKEN", value_present: true },
		]);
		expect(issues).toHaveLength(1);
		expect(issues[0]?.code).toBe("op_env_token_exposure");
		expect(issues[0]?.path).toBe("env.OP_SERVICE_ACCOUNT_TOKEN");
	});

	test("the token key without a caller value and benign keys pass", () => {
		expect(
			screenOpEnvironmentProposal([
				{ key: "OP_SERVICE_ACCOUNT_TOKEN", value_present: false },
				{ key: "LC_ALL", value_present: true },
			]),
		).toEqual([]);
	});

	test("every built spec carries exactly the handle-only env and no stdin", () => {
		const credential = buildCredentialFieldCommand({
			token_handle_id: TOKEN_HANDLE,
			binding: baseBinding(),
			field: "password",
		});
		expect(credential.ok).toBe(true);
		if (!credential.ok) return;
		const specs: BrowserUseOpCommandSpec[] = [
			buildVaultListCommand({ token_handle_id: TOKEN_HANDLE }),
			buildLoginItemListCommand({
				token_handle_id: TOKEN_HANDLE,
				vault_id: "vault-1",
			}),
			buildLoginItemGetCommand({
				token_handle_id: TOKEN_HANDLE,
				vault_id: "vault-1",
				item_id: "item-1",
			}),
			credential.spec,
		];
		for (const spec of specs) {
			expect(spec.env).toEqual(EXPECTED_ENV);
			expect(spec.stdin).toBeNull();
			expect(spec.timeout_ms).toBeGreaterThan(0);
		}
	});
});

describe("command specs as data", () => {
	test("evidence commands capture json-evidence and name their targets", () => {
		const vaultList = buildVaultListCommand({ token_handle_id: TOKEN_HANDLE });
		expect(vaultList.capture).toBe("json-evidence");
		expect(vaultList.argv).toContain("vault");

		const itemList = buildLoginItemListCommand({
			token_handle_id: TOKEN_HANDLE,
			vault_id: "vault-1",
		});
		expect(itemList.capture).toBe("json-evidence");
		expect(itemList.argv).toContain("vault-1");

		const itemGet = buildLoginItemGetCommand({
			token_handle_id: TOKEN_HANDLE,
			vault_id: "vault-1",
			item_id: "item-1",
			timeout_ms: 5_000,
		});
		expect(itemGet.capture).toBe("json-evidence");
		expect(itemGet.argv).toContain("item-1");
		expect(itemGet.argv).toContain("vault-1");
		expect(itemGet.timeout_ms).toBe(5_000);
	});

	test("a credential command pins argv to the exact binding (R11)", () => {
		const built = buildCredentialFieldCommand({
			token_handle_id: TOKEN_HANDLE,
			binding: baseBinding({ vault_id: "vault-1", item_id: "item-1" }),
			field: "otp-current",
		});
		expect(built.ok).toBe(true);
		if (!built.ok) return;
		expect(built.spec.capture).toBe("secret-handle");
		expect(built.spec.argv).toContain("item-1");
		expect(built.spec.argv).toContain("vault-1");
	});

	test("a field the binding does not permit is refused", () => {
		const otp = buildCredentialFieldCommand({
			token_handle_id: TOKEN_HANDLE,
			binding: baseBinding({ allowed_auth_methods: ["password"] }),
			field: "otp-current",
		});
		expect(otp.ok).toBe(false);
		if (otp.ok) return;
		expect(otp.rejection.code).toBe("field-not-permitted");

		const username = buildCredentialFieldCommand({
			token_handle_id: TOKEN_HANDLE,
			binding: baseBinding({ allowed_auth_methods: [] }),
			field: "username",
		});
		expect(username.ok).toBe(false);
		if (username.ok) return;
		expect(username.rejection.code).toBe("field-not-permitted");
	});

	test("otp-seed and passkey are unrepresentable credential fields (R12/R13)", () => {
		// @ts-expect-error — a seed request path does not exist (R12).
		const seed: BrowserUseOpCredentialField = "otp-seed";
		// @ts-expect-error — passkey material is never CLI-retrievable (R13).
		const passkey: BrowserUseOpCredentialField = "passkey";
		expect(seed).toBe("otp-seed" as never);
		expect(passkey).toBe("passkey" as never);
		expect([...BROWSER_USE_OP_CREDENTIAL_FIELDS]).toEqual([
			"username",
			"password",
			"otp-current",
		]);
	});
});

describe("vault-scope proof (R8/AE2)", () => {
	test("zero visible vaults block before any item discovery", () => {
		const proof = proveVaultScope([]);
		expect(proof.ok).toBe(false);
		if (proof.ok) return;
		expect(proof.blocked_cause).toBe("invalid-vault-scope");
		expect(proof.visible_count).toBe(0);
		expect(proof.continuation).toEqual(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["invalid-vault-scope"].continuation,
		);
	});

	test("two visible vaults block with the observed count", () => {
		const proof = proveVaultScope([
			{ vault_id: "vault-1" },
			{ vault_id: "vault-2" },
		]);
		expect(proof.ok).toBe(false);
		if (proof.ok) return;
		expect(proof.blocked_cause).toBe("invalid-vault-scope");
		expect(proof.visible_count).toBe(2);
		expect(proof.continuation.next_action_id).toBe("repair-vault-grant");
	});

	test("exactly one vault proves scope with no second approval", () => {
		const proof = proveVaultScope([{ vault_id: "vault-1" }]);
		expect(proof).toEqual({ ok: true, vault_id: "vault-1" });
	});

	test("a blocked continuation is a clone; mutating it never corrupts the table", () => {
		const proof = proveVaultScope([]);
		if (proof.ok) return;
		proof.continuation.next_action_id = "mutated";
		expect(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["invalid-vault-scope"].continuation
				.next_action_id,
		).toBe("repair-vault-grant");
	});
});

describe("fail-closed output projection (KTD7)", () => {
	test("a vault list projects ids only; names never escape", () => {
		const projection = projectVaultListOutput([
			{ id: "vault-1", name: "Personal Vault" },
		]);
		expect(projection).toEqual({ ok: true, value: [{ vault_id: "vault-1" }] });
		expect(JSON.stringify(projection)).not.toContain("Personal Vault");
	});

	test("a non-array vault payload fails closed", () => {
		const projection = projectVaultListOutput({ id: "vault-1" });
		expect(projection.ok).toBe(false);
		if (projection.ok) return;
		expect(projection.issues[0]?.code).toBe("op_output_shape_invalid");
	});

	test("an item list projects normalized origins, login paths, and state", () => {
		const projection = projectLoginItemListOutput([baseItemRow()]);
		expect(projection.ok).toBe(true);
		if (!projection.ok) return;
		expect(projection.value).toEqual([
			{
				item_id: "item-1",
				vault_id: "vault-1",
				origins: ["https://portal.example.com"],
				login_paths: ["/login"],
				supported_methods: ["password", "otp"],
				state: "active",
			},
		]);
	});

	test("a missing state projects as active; a stale state is honored", () => {
		const absent = projectLoginItemGetOutput(baseItemRow({ state: undefined }));
		expect(absent.ok).toBe(true);
		if (absent.ok) expect(absent.value.state).toBe("active");

		const archived = projectLoginItemGetOutput(
			baseItemRow({ state: "archived" }),
		);
		expect(archived.ok).toBe(true);
		if (archived.ok) expect(archived.value.state).toBe("archived");

		const unknown = projectLoginItemGetOutput(baseItemRow({ state: "paused" }));
		expect(unknown.ok).toBe(false);
		if (!unknown.ok) {
			expect(unknown.issues[0]?.code).toBe("op_output_shape_invalid");
		}
	});

	test("a secret-shaped url fails the whole projection; no partial evidence", () => {
		const projection = projectLoginItemListOutput([
			baseItemRow({ id: "item-clean" }),
			baseItemRow({ id: "item-2", urls: [{ href: "op://vault/item" }] }),
		]);
		expect(projection.ok).toBe(false);
		if (projection.ok) return;
		expect(
			projection.issues.some(
				(issue) => issue.code === "op_output_secret_shaped",
			),
		).toBe(true);
		expect(JSON.stringify(projection)).not.toContain("item-clean");
	});

	test("titles and usernames are stripped; exactly the evidence key set escapes", () => {
		const projection = projectLoginItemListOutput([
			baseItemRow({
				title: "Nathan's Login",
				additional_information: "user@example.com",
			}),
		]);
		expect(projection.ok).toBe(true);
		if (!projection.ok) return;
		const row = projection.value[0];
		expect(row).toBeDefined();
		if (row === undefined) return;
		expect(Object.keys(row).sort()).toEqual(
			[...BROWSER_USE_VAULT_ITEM_EVIDENCE_KEYS].sort(),
		);
		const serialized = JSON.stringify(projection);
		expect(serialized).not.toContain("Nathan's Login");
		expect(serialized).not.toContain("user@example.com");
	});
});

describe("token retrieval port (R7 — typed results, never a throw)", () => {
	test("listVaults projects executor json into vault refs", async () => {
		const { calls, execute } = executorOf({
			kind: "json-evidence",
			value: [{ id: "vault-1" }],
		});
		const port = createOpTokenRetrievalPort({
			execute,
			token_handle_id: TOKEN_HANDLE,
		});
		const result = await port.listVaults();
		expect(result).toEqual({ ok: true, vaults: [{ vault_id: "vault-1" }] });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.capture).toBe("json-evidence");
		expect(calls[0]?.env).toEqual(EXPECTED_ENV);
	});

	test("getLoginItem projects a single exact-binding read (R11)", async () => {
		const { calls, execute } = executorOf({
			kind: "json-evidence",
			value: baseItemRow({ state: "archived" }),
		});
		const port = createOpTokenRetrievalPort({
			execute,
			token_handle_id: TOKEN_HANDLE,
		});
		const result = await port.getLoginItem({
			vault_id: "vault-1",
			item_id: "item-1",
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.item.state).toBe("archived");
		expect(calls[0]?.argv).toContain("item-1");
	});

	test("a secret handle on the json-evidence path is refused, not surfaced", async () => {
		const { execute } = executorOf({
			kind: "secret-handle",
			handle: {
				handle_id: "handle-sentinel",
				field: "password",
				expires_at_epoch_ms: 1,
			},
		});
		const port = createOpTokenRetrievalPort({
			execute,
			token_handle_id: TOKEN_HANDLE,
		});
		const result = await port.listVaults();
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.rejection.code).toBe("output-shape-invalid");
		expect(JSON.stringify(result)).not.toContain("handle-sentinel");
	});

	test("json on the secret-handle path is discarded unexamined (D9)", async () => {
		const { execute } = executorOf({
			kind: "json-evidence",
			value: { password: "sentinel-xyz" },
		});
		const port = createOpTokenRetrievalPort({
			execute,
			token_handle_id: TOKEN_HANDLE,
		});
		const result = await port.fetchCredentialField({
			binding: baseBinding(),
			field: "password",
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.rejection.code).toBe("secret-egress-refused");
		expect(JSON.stringify(result)).not.toContain("sentinel-xyz");
	});

	test("fetchCredentialField returns the opaque handle on the secret path", async () => {
		const { calls, execute } = executorOf({
			kind: "secret-handle",
			handle: {
				handle_id: "handle-1",
				field: "password",
				expires_at_epoch_ms: 99,
			},
		});
		const port = createOpTokenRetrievalPort({
			execute,
			token_handle_id: TOKEN_HANDLE,
		});
		const result = await port.fetchCredentialField({
			binding: baseBinding(),
			field: "password",
		});
		expect(result).toEqual({
			ok: true,
			handle: { handle_id: "handle-1", field: "password", expires_at_epoch_ms: 99 },
		});
		expect(calls[0]?.capture).toBe("secret-handle");
	});

	test("a non-permitted field is refused with zero executor calls", async () => {
		const { calls, execute } = executorOf({
			kind: "secret-handle",
			handle: { handle_id: "handle-1", field: "otp-current", expires_at_epoch_ms: 1 },
		});
		const port = createOpTokenRetrievalPort({
			execute,
			token_handle_id: TOKEN_HANDLE,
		});
		const result = await port.fetchCredentialField({
			binding: baseBinding({ allowed_auth_methods: ["password"] }),
			field: "otp-current",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.rejection.code).toBe("field-not-permitted");
		expect(calls).toHaveLength(0);
	});

	test("an op failure passes through typed; secret-shaped detail is withheld", async () => {
		const { execute } = executorOf({
			kind: "op-failure",
			failure: {
				code: "token-invalid",
				message: "token op://vault/item was rejected.",
			},
		});
		const port = createOpTokenRetrievalPort({
			execute,
			token_handle_id: TOKEN_HANDLE,
		});
		const result = await port.listVaults();
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.rejection.code).toBe("token-invalid");
		expect(JSON.stringify(result)).not.toContain("op://");
	});

	test("malformed json evidence rejects as output-shape-invalid", async () => {
		const { execute } = executorOf({
			kind: "json-evidence",
			value: { not: "an item row" },
		});
		const port = createOpTokenRetrievalPort({
			execute,
			token_handle_id: TOKEN_HANDLE,
		});
		const result = await port.getLoginItem({
			vault_id: "vault-1",
			item_id: "item-1",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("output-shape-invalid");
		}
	});

	test("a throwing or rejecting executor resolves io-failure on every method", async () => {
		const throwing: BrowserUseOpExecute = () => {
			throw new Error("boom");
		};
		const rejecting: BrowserUseOpExecute = async () => {
			throw new Error("boom");
		};
		for (const execute of [throwing, rejecting]) {
			const port = createOpTokenRetrievalPort({
				execute,
				token_handle_id: TOKEN_HANDLE,
			});
			const results = [
				await port.listVaults(),
				await port.listLoginItems({ vault_id: "vault-1" }),
				await port.getLoginItem({ vault_id: "vault-1", item_id: "item-1" }),
				await port.fetchCredentialField({
					binding: baseBinding(),
					field: "password",
				}),
			];
			for (const result of results) {
				expect(result.ok).toBe(false);
				if (!result.ok) expect(result.rejection.code).toBe("io-failure");
			}
		}
	});
});

describe("blocked-cause mapping (existing causes only; ADR 0028)", () => {
	test("every token-lifecycle failure maps to the legal missing-token state", () => {
		const lifecycleCodes = [
			"capability-missing",
			"pre-first-unlock",
			"entitlement-drift",
			"signing-drift",
			"token-invalid",
			"token-revoked",
		] as const;
		for (const code of lifecycleCodes) {
			const block = blockOfRetrievalRejection({ code, message: "refused." });
			expect(block.blocked_cause).toBe("missing-token");
			expect(block.continuation).toEqual(
				BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["missing-token"].continuation,
			);
			expect(block.continuation.next_action_id).toBe(
				"enroll-browser-automation-token",
			);
		}
	});

	test("item-missing repairs the binding; it never triggers a rescan", () => {
		const block = blockOfRetrievalRejection({
			code: "item-missing",
			message: "refused.",
		});
		expect(block.blocked_cause).toBe("revoked-binding");
		expect(block.continuation.next_action_id).toBe("repair-item-binding");
	});

	test("field-not-permitted maps to unsupported-method", () => {
		const block = blockOfRetrievalRejection({
			code: "field-not-permitted",
			message: "refused.",
		});
		expect(block.blocked_cause).toBe("unsupported-method");
		expect(block.continuation.next_action_id).toBe(
			"choose-supported-auth-method",
		);
	});

	test("infrastructure failures map to capability-loss", () => {
		const infraCodes: readonly BrowserUseTokenRetrievalRejectionCode[] = [
			"timeout",
			"io-failure",
			"secret-egress-refused",
			"output-shape-invalid",
			"binding-shape-invalid",
		];
		for (const code of infraCodes) {
			const block = blockOfRetrievalRejection({ code, message: "refused." });
			expect(block.blocked_cause).toBe("capability-loss");
			expect(block.continuation.next_action_id).toBe(
				"inspect-capability-loss",
			);
		}
	});

	test("mapped continuations are clones; the cause table never mutates", () => {
		const block = blockOfRetrievalRejection({
			code: "item-missing",
			message: "refused.",
		});
		block.continuation.summary = "mutated";
		expect(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["revoked-binding"].continuation
				.summary,
		).toBe("Repair the revoked or moved item binding; never rescan silently.");
	});
});

describe("vocabulary immutability", () => {
	test("module vocabularies survive a full exercise unchanged", () => {
		const fieldsBefore = structuredClone([...BROWSER_USE_OP_CREDENTIAL_FIELDS]);
		const failuresBefore = structuredClone([...BROWSER_USE_OP_FAILURE_CODES]);
		const capturesBefore = structuredClone([...BROWSER_USE_OP_CAPTURE_MODES]);
		const forbiddenBefore = structuredClone([
			...BROWSER_USE_OP_FORBIDDEN_ENV_KEYS,
		]);

		proveVaultScope([]);
		blockOfRetrievalRejection({ code: "timeout", message: "refused." });
		projectVaultListOutput([{ id: "vault-1" }]);
		buildCredentialFieldCommand({
			token_handle_id: TOKEN_HANDLE,
			binding: baseBinding(),
			field: "username",
		});

		expect([...BROWSER_USE_OP_CREDENTIAL_FIELDS]).toEqual(fieldsBefore);
		expect([...BROWSER_USE_OP_FAILURE_CODES]).toEqual(failuresBefore);
		expect([...BROWSER_USE_OP_CAPTURE_MODES]).toEqual(capturesBefore);
		expect([...BROWSER_USE_OP_FORBIDDEN_ENV_KEYS]).toEqual(forbiddenBefore);
		expect(BROWSER_USE_OP_TOKEN_ENV_KEY).toBe("OP_SERVICE_ACCOUNT_TOKEN");
	});
});
