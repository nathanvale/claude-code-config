import { afterAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createNativeBindingSelectionCeremony } from "./browser-use-binding-approval-native";
import type {
	BrowserUseBindingSelectionGrant,
	BrowserUseBindingSelectionRequest,
} from "./browser-use-binding-selection";

const roots: string[] = [];
afterAll(async () => {
	await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

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

function grant(): BrowserUseBindingSelectionGrant {
	return {
		grant_id: "selection-grant-1",
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
		issued_at_epoch_ms: 1_000,
		expires_at_epoch_ms: 91_000,
		verifier_key_id: "verifier-1",
		signature: "signed-selection",
	};
}

async function executable(
	body: string,
	options: { capture?: string; exitCode?: number } = {},
): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "binding-selection-native-"));
	roots.push(root);
	const path = join(root, "broker");
	const capture = options.capture
		? `IFS= read -r request\nprintf '%s' "$request" > '${options.capture}'\n`
		: "";
	await writeFile(
		path,
		`#!/bin/sh\n${capture}printf '%s\\n' '${body}'\nexit ${options.exitCode ?? 0}\n`,
		{ mode: 0o700 },
	);
	await chmod(path, 0o700);
	return path;
}

describe("native binding selection ceremony adapter", () => {
	test("sends only public facts plus private-owner paths and returns one opaque grant", async () => {
		const root = await mkdtemp(join(tmpdir(), "binding-selection-capture-"));
		roots.push(root);
		const capture = join(root, "request.json");
		const broker = await executable(
			JSON.stringify({ ok: true, grant: grant() }),
			{ capture },
		);
		const ceremony = createNativeBindingSelectionCeremony(broker, {
			supervisorPath: "/private/native/supervisor",
			opPath: "/private/native/op",
			configRoot: "/private/native/config",
		});

		expect(await ceremony.requestBindingSelection(request)).toMatchObject({
			ok: true,
			grant: { grant_id: "selection-grant-1", binding: { item_id: "item-6" } },
		});
		const sent = JSON.parse(await readFile(capture, "utf8")) as Record<
			string,
			unknown
		>;
		expect(Object.keys(sent).sort()).toEqual([
			"candidate_count",
			"facts",
			"private_owner",
			"resolution_key",
		]);
		expect(JSON.stringify(sent)).not.toContain("title");
		expect(JSON.stringify(sent)).not.toContain("username");
	});

	test("maps cancel and no response to typed fail-closed rejections", async () => {
		const cancelledBroker = await executable(
			JSON.stringify({
				ok: false,
				code: "presence-cancelled",
				message: "selection cancelled",
			}),
			{ exitCode: 20 },
		);
		const noResponseBroker = await executable("", { exitCode: 20 });
		for (const [broker, code] of [
			[cancelledBroker, "presence-cancelled"],
			[noResponseBroker, "broker-unavailable"],
		] as const) {
			const ceremony = createNativeBindingSelectionCeremony(broker, {
				supervisorPath: "/private/native/supervisor",
				opPath: "/private/native/op",
				configRoot: "/private/native/config",
			});
			expect(await ceremony.requestBindingSelection(request)).toMatchObject({
				ok: false,
				rejection: { code },
			});
		}
	});

	test("rejects each relative private-owner path before invoking the broker", async () => {
		const broker = await executable(
			JSON.stringify({ ok: true, grant: grant() }),
		);
		const owner = {
			supervisorPath: "/private/native/supervisor",
			opPath: "/private/native/op",
			configRoot: "/private/native/config",
		};
		for (const field of Object.keys(owner) as (keyof typeof owner)[]) {
			const ceremony = createNativeBindingSelectionCeremony(broker, {
				...owner,
				[field]: "relative/path",
			});
			expect(await ceremony.requestBindingSelection(request)).toEqual({
				ok: false,
				rejection: {
					code: "broker-unavailable",
					message: "the native selection owner paths must be absolute.",
				},
			});
		}
	});

	test("rejects an ok envelope carrying an invalid grant", async () => {
		const broker = await executable(
			JSON.stringify({ ok: true, grant: { grant_id: "incomplete" } }),
		);
		const ceremony = createNativeBindingSelectionCeremony(broker, {
			supervisorPath: "/private/native/supervisor",
			opPath: "/private/native/op",
			configRoot: "/private/native/config",
		});
		expect(await ceremony.requestBindingSelection(request)).toEqual({
			ok: false,
			rejection: {
				code: "broker-unavailable",
				message: "the native selection owner returned an invalid grant.",
			},
		});
	});

	test("bounds native failure messages and falls back for unsafe text", async () => {
		for (const message of ["x".repeat(1_025), "read op://vault/item/password"]) {
			const broker = await executable(
				JSON.stringify({ ok: false, code: "presence-cancelled", message }),
				{ exitCode: 20 },
			);
			const ceremony = createNativeBindingSelectionCeremony(broker, {
				supervisorPath: "/private/native/supervisor",
				opPath: "/private/native/op",
				configRoot: "/private/native/config",
			});
			expect(await ceremony.requestBindingSelection(request)).toEqual({
				ok: false,
				rejection: {
					code: "presence-cancelled",
					message: "the native binding selection failed closed.",
				},
			});
		}
	});
});
