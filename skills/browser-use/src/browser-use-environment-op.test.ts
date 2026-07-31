import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import { createEnvironmentTokenRetrievalPort } from "./browser-use-environment-op";
import { blockOfRetrievalRejection } from "./browser-use-op";

const SENTINEL = "ENV_PORT_SENTINEL_6d8332";
const TARGET_DIGEST = "d".repeat(64);
const DRIFTED_DIGEST = "e".repeat(64);
const ORIGIN = "https://portal.test";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function binding(
	overrides: Partial<BrowserUseItemBinding> = {},
): BrowserUseItemBinding {
	return {
		service_id: "portal",
		auth_context: "interactive-login",
		allowed_origins: [ORIGIN],
		allowed_login_paths: ["/login"],
		vault_id: "vault-1",
		item_id: "item-1",
		allowed_auth_methods: ["password", "otp"],
		binding_revision: 1,
		...overrides,
	};
}

function shellLiteral(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

type SupervisorFixture = {
	root: string;
	supervisorPath: string;
	opPath: string;
	configRoot: string;
	callsPath: string;
	setItemResponse(value: unknown): void;
	setVaultResponse(value: unknown): void;
	setDeliveryResponse(value: unknown): void;
	calls(): string[];
};

function envelope(value: unknown): unknown {
	return { schema_version: 1, ok: true, value };
}

function rejection(code: string): unknown {
	return { schema_version: 1, ok: false, rejection: { code } };
}

function itemValue(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: "item-1",
		vault: { id: "vault-1" },
		category: "LOGIN",
		urls: [{ href: `${ORIGIN}/login` }],
		state: "active",
		...overrides,
	};
}

function fixture(): SupervisorFixture {
	const root = mkdtempSync(join(tmpdir(), "browser-use-environment-op-"));
	temporaryRoots.push(root);
	const callsPath = join(root, "calls.log");
	const vaultResponsePath = join(root, "vault-response.json");
	const itemResponsePath = join(root, "item-response.json");
	const deliveryResponsePath = join(root, "delivery-response.json");
	const supervisorPath = join(root, "fake-supervisor");
	const opPath = join(root, "op");

	writeFileSync(vaultResponsePath, JSON.stringify(envelope([{ id: "vault-1" }])));
	writeFileSync(itemResponsePath, JSON.stringify(envelope(itemValue())));
	writeFileSync(
		deliveryResponsePath,
		JSON.stringify({
			ok: true,
			shape: { kind: "utf8", byte_length: SENTINEL.length },
		}),
	);
	writeFileSync(opPath, "");
	writeFileSync(
		supervisorPath,
		`#!/bin/sh
/usr/bin/printf '%s\n' "$*" >> ${shellLiteral(callsPath)}
case "$*" in
  *"--operation vault-list"*) response=${shellLiteral(vaultResponsePath)} ;;
  *"--operation item-get"*) response=${shellLiteral(itemResponsePath)} ;;
  deliver*) response=${shellLiteral(deliveryResponsePath)} ;;
  *) /usr/bin/printf '%s\n' '{"schema_version":1,"ok":false,"rejection":{"code":"fixture-unexpected-operation"}}'; exit 20 ;;
esac
/bin/cat "$response"
/usr/bin/grep -q '"ok":true' "$response" && exit 0
exit 20
`,
	);
	chmodSync(supervisorPath, 0o700);

	return {
		root,
		supervisorPath,
		opPath,
		configRoot: root,
		callsPath,
		setItemResponse(value) {
			writeFileSync(itemResponsePath, JSON.stringify(value));
		},
		setVaultResponse(value) {
			writeFileSync(vaultResponsePath, JSON.stringify(value));
		},
		setDeliveryResponse(value) {
			writeFileSync(deliveryResponsePath, JSON.stringify(value));
		},
		calls() {
			try {
				return readFileSync(callsPath, "utf8").trim().split("\n");
			} catch {
				return [];
			}
		},
	};
}

function portOf(
	supervisor: SupervisorFixture,
	options: { now?: () => number; handleTtlMs?: number } = {},
) {
	let nextHandle = 0;
	return createEnvironmentTokenRetrievalPort({
		supervisorPath: supervisor.supervisorPath,
		opPath: supervisor.opPath,
		configRoot: supervisor.configRoot,
		now: options.now ?? (() => 1_000),
		handleTtlMs: options.handleTtlMs ?? 30_000,
		mintHandleId: () => `handle-${++nextHandle}`,
	});
}

async function mintPassword(
	port: ReturnType<typeof portOf>,
	overrides: { target_digest?: string; observed_origin?: string } = {},
) {
	return port.fetchCredentialField({
		binding: binding(),
		field: "password",
		target_digest: overrides.target_digest ?? TARGET_DIGEST,
		observed_origin: overrides.observed_origin ?? ORIGIN,
	});
}

function redemptionInput(
	handle: Extract<
		Awaited<ReturnType<typeof mintPassword>>,
		{ ok: true }
	>["handle"],
	overrides: Partial<{
		target_digest: string;
		target_url: string;
		target_origin: string;
	}> = {},
) {
	return {
		handle,
		target_digest: overrides.target_digest ?? TARGET_DIGEST,
		ws_url: "ws://127.0.0.1:9222/devtools/browser/fixture",
		target_url: overrides.target_url ?? `${ORIGIN}/login`,
		target_origin: overrides.target_origin ?? ORIGIN,
		field: { role: "textbox", accessible_name: "Password" },
		timeout_ms: 5_000,
	};
}

type Assert<T extends true> = T;
type HasNoValueSlot<T> = "value" extends keyof T ? false : true;
type FetchSuccess = Extract<
	Awaited<ReturnType<ReturnType<typeof portOf>["fetchCredentialField"]>>,
	{ ok: true }
>;
type RedeemSuccess = Extract<
	Awaited<ReturnType<ReturnType<typeof portOf>["redeemCredentialField"]>>,
	{ ok: true }
>;
const TYPE_LEVEL_NO_FETCH_VALUE: Assert<HasNoValueSlot<FetchSuccess>> = true;
const TYPE_LEVEL_NO_REDEEM_VALUE: Assert<HasNoValueSlot<RedeemSuccess>> = true;

describe("environment OP secret-handle registry", () => {
	test("mints then redeems once with non-secret supervisor argv and outputs", async () => {
		const supervisor = fixture();
		const port = portOf(supervisor);

		const fetched = await mintPassword(port);
		expect(fetched.ok).toBe(true);
		if (!fetched.ok) return;
		expect(fetched.handle).toEqual({
			handle_id: "handle-1",
			field: "password",
			expires_at_epoch_ms: 31_000,
		});
		expect("value" in fetched).toBe(false);

		const delivered = await port.redeemCredentialField(
			redemptionInput(fetched.handle),
		);
		expect(delivered).toEqual({
			ok: true,
			shape: { field: "password", byte_length: SENTINEL.length },
		});
		expect("value" in delivered).toBe(false);

		const calls = supervisor.calls();
		expect(calls).toHaveLength(2);
		expect(calls[0]).toContain("metadata");
		expect(calls[1]).toContain("deliver");
		expect(calls[1]).toContain("--vault-id vault-1");
		expect(calls[1]).toContain("--item-id item-1");
		expect(calls[1]).toContain("--field password");
		expect(calls[1]).toContain("--target-url https://portal.test/login");
		expect(calls[1]).not.toContain("handle-1");
		expect(JSON.stringify({ fetched, delivered, calls })).not.toContain(SENTINEL);
		expect(TYPE_LEVEL_NO_FETCH_VALUE).toBe(true);
		expect(TYPE_LEVEL_NO_REDEEM_VALUE).toBe(true);
	});

	test("second redemption rejects typed without another supervisor call", async () => {
		const supervisor = fixture();
		const port = portOf(supervisor);
		const fetched = await mintPassword(port);
		if (!fetched.ok) throw new Error("fixture mint failed");

		expect(
			(await port.redeemCredentialField(redemptionInput(fetched.handle))).ok,
		).toBe(true);
		const callsAfterFirst = supervisor.calls();
		const replay = await port.redeemCredentialField(
			redemptionInput(fetched.handle),
		);

		expect(replay.ok).toBe(false);
		if (!replay.ok) expect(replay.rejection.code).toBe("handle-consumed");
		expect(supervisor.calls()).toEqual(callsAfterFirst);
	});

	test("expired handle rejects typed before supervisor delivery", async () => {
		const supervisor = fixture();
		let now = 1_000;
		const port = portOf(supervisor, { now: () => now, handleTtlMs: 50 });
		const fetched = await mintPassword(port);
		if (!fetched.ok) throw new Error("fixture mint failed");
		now = 1_051;

		const expired = await port.redeemCredentialField(
			redemptionInput(fetched.handle),
		);

		expect(expired.ok).toBe(false);
		if (!expired.ok) expect(expired.rejection.code).toBe("handle-expired");
		expect(supervisor.calls()).toHaveLength(1);
	});

	test("target digest drift consumes and rejects before any delivery spawn", async () => {
		const supervisor = fixture();
		const port = portOf(supervisor);
		const fetched = await mintPassword(port);
		if (!fetched.ok) throw new Error("fixture mint failed");

		const drifted = await port.redeemCredentialField(
			redemptionInput(fetched.handle, { target_digest: DRIFTED_DIGEST }),
		);

		expect(drifted.ok).toBe(false);
		if (!drifted.ok) {
			expect(drifted.rejection.code).toBe("target-digest-mismatch");
		}
		expect(supervisor.calls()).toHaveLength(1);
	});

	test("possibly-landed write reports external effect and cannot retry", async () => {
		const supervisor = fixture();
		supervisor.setDeliveryResponse({
			ok: false,
			reason: "write-failed",
			field_cleared: true,
		});
		const port = portOf(supervisor);
		const fetched = await mintPassword(port);
		if (!fetched.ok) throw new Error("fixture mint failed");

		const interrupted = await port.redeemCredentialField(
			redemptionInput(fetched.handle),
		);
		expect(interrupted).toEqual({
			ok: false,
			rejection: {
				code: "capability-loss",
				message: "environment credential delivery was refused.",
			},
			external_effect_possible: true,
			field_cleared: true,
		});
		const callsAfterInterruption = supervisor.calls();

		const replay = await port.redeemCredentialField(
			redemptionInput(fetched.handle),
		);
		expect(replay.ok).toBe(false);
		if (!replay.ok) expect(replay.rejection.code).toBe("handle-consumed");
		expect(supervisor.calls()).toEqual(callsAfterInterruption);
	});
});

describe("environment OP metadata and fail-closed causes", () => {
	test("vault-list and item-get metadata operations remain unchanged", async () => {
		const supervisor = fixture();
		const port = portOf(supervisor);

		expect(await port.listVaults()).toEqual({
			ok: true,
			vaults: [{ vault_id: "vault-1" }],
		});
		const item = await port.getLoginItem({
			vault_id: "vault-1",
			item_id: "item-1",
		});
		expect(item.ok).toBe(true);
		if (item.ok) {
			expect(item.item.item_id).toBe("item-1");
			expect(item.item.vault_id).toBe("vault-1");
		}
		expect(supervisor.calls()[0]).toContain("--operation vault-list");
		expect(supervisor.calls()[1]).toContain("--operation item-get");
	});

	test("bogus token maps to missing-token during prevalidation", async () => {
		const supervisor = fixture();
		supervisor.setItemResponse(rejection("token-invalid"));
		const result = await mintPassword(portOf(supervisor));

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(blockOfRetrievalRejection(result.rejection).blocked_cause).toBe(
			"missing-token",
		);
		expect(supervisor.calls()).toHaveLength(1);
	});

	test("non-existent item maps to revoked-binding during prevalidation", async () => {
		const supervisor = fixture();
		supervisor.setItemResponse(rejection("item-missing"));
		const result = await mintPassword(portOf(supervisor));

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(blockOfRetrievalRejection(result.rejection).blocked_cause).toBe(
			"revoked-binding",
		);
		expect(supervisor.calls()).toHaveLength(1);
	});

	test("missing requested field maps to unsupported-method at redemption", async () => {
		const supervisor = fixture();
		supervisor.setDeliveryResponse(rejection("process-failed"));
		const port = portOf(supervisor);
		const fetched = await mintPassword(port);
		if (!fetched.ok) throw new Error("fixture mint failed");

		const result = await port.redeemCredentialField(
			redemptionInput(fetched.handle),
		);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.rejection.code).toBe("unsupported-method");
		expect(supervisor.calls()).toHaveLength(2);
	});

	test("origin outside the binding refuses before metadata or secret read", async () => {
		const supervisor = fixture();
		const result = await mintPassword(portOf(supervisor), {
			observed_origin: "https://outside.test",
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.rejection.code).toBe("binding-shape-invalid");
		expect(result.blocked_cause).toBe("origin-mismatch");
		expect(supervisor.calls()).toHaveLength(0);
	});
});
