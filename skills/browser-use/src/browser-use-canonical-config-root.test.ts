import { describe, expect, spyOn, test } from "bun:test";
import {
	chmod,
	mkdtemp,
	mkdir,
	rm,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import type { BrowserUseVerifiedTarget } from "./browser-use-confidential-field-delivery";
import { createProductionBrowserUseRuntime } from "./browser-use-runtime";

const BINDING: BrowserUseItemBinding = {
	service_id: "oncore",
	service_account_id: "service-account-1",
	auth_context: "interactive-login",
	allowed_origins: ["https://oncore.test"],
	allowed_login_paths: ["/login"],
	vault_id: "vault-1",
	item_id: "item-1",
	item_revision: 7,
	allowed_auth_methods: ["password"],
	binding_revision: 1,
};

const TARGET: BrowserUseVerifiedTarget = {
	lane_id: "agent-browser",
	run_id: "run-canonical-config",
	top_level_origin: "https://oncore.test",
	frame_origin: "https://oncore.test",
	target_id: "target-1",
	page_id: "page-1",
	frame_id: "frame-1",
	account_ref: "account-redacted",
	target_proof_digest: "d".repeat(64),
};

function capabilityTarget(target: BrowserUseVerifiedTarget) {
	return {
		lane_id: target.lane_id,
		run_id: target.run_id,
		target_id: target.target_id,
		page_id: target.page_id,
		frame_id: target.frame_id,
		top_level_origin: target.top_level_origin,
		frame_origin: target.frame_origin,
		target_proof_digest: target.target_proof_digest,
	};
}

function textStream(value: string): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(value));
			controller.close();
		},
	});
}

function fakeChild(stdout: unknown, exitCode = 0) {
	return {
		pid: 42_424,
		stdin: {
			write() {},
			end() {},
		},
		stdout: textStream(`${JSON.stringify(stdout)}\n`),
		stderr: textStream(""),
		exited: Promise.resolve(exitCode),
		signalCode: null,
		kill() {},
	};
}

async function initializeConfigRepository(input: {
	root: string;
	ignored: boolean;
}): Promise<{
	env: Record<string, string>;
	configLink: string;
	literalConfigRoot: string;
	canonicalConfigRoot: string;
}> {
	const home = join(input.root, "home");
	const configTarget = join(input.root, "config-target");
	const configLink = join(input.root, "config-link");
	const data = join(input.root, "data");
	const state = join(input.root, "state");
	const cache = join(input.root, "cache");
	const runtime = join(input.root, "runtime");
	for (const path of [home, configTarget, data, state, cache, runtime]) {
		await mkdir(path, { recursive: true, mode: 0o700 });
		await chmod(path, 0o700);
	}
	const initialized = Bun.spawn(
		["/usr/bin/git", "init", "--quiet"],
		{
			cwd: configTarget,
			env: { HOME: home, PATH: "/usr/bin:/bin", LANG: "C" },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	expect(await initialized.exited).toBe(0);
	if (input.ignored) {
		await writeFile(join(configTarget, ".gitignore"), "browser-use/\n");
	}
	await symlink(configTarget, configLink);
	return {
		env: {
			HOME: home,
			PATH: "/opt/homebrew/bin:/usr/bin:/bin",
			LANG: "C",
			XDG_CONFIG_HOME: configLink,
			XDG_DATA_HOME: data,
			XDG_STATE_HOME: state,
			XDG_CACHE_HOME: cache,
			XDG_RUNTIME_DIR: runtime,
		},
		configLink,
		literalConfigRoot: join(configLink, "browser-use"),
		canonicalConfigRoot: join(configTarget, "browser-use"),
	};
}

describe("canonical environment-auth config root", () => {
	test("one ignored owned-symlink root serves lifecycle, metadata, and delivery", async () => {
		const root = await mkdtemp(join(homedir(), ".browser-use-config-root-"));
		const realSpawn = Bun.spawn.bind(Bun);
		const nativeCommands: string[][] = [];
		const fixture = await initializeConfigRepository({
			root,
			ignored: true,
		});
		const spawn = spyOn(Bun, "spawn").mockImplementation(
			((command: string[], options: object) => {
				if (command[0] === "/usr/bin/git") {
					return realSpawn(command as never, options as never);
				}
				nativeCommands.push([...command]);
				if (command[0]?.endsWith("browser-use-token-custody")) {
					return fakeChild({
						state: "ready",
						next_action: "validate-service-account",
					}) as never;
				}
				if (command[1] === "metadata") {
					return fakeChild({
						schema_version: 1,
						ok: true,
						value: [{ id: "vault-1" }],
					}) as never;
				}
				if (command[0]?.endsWith("browser-use-confidential-delivery")) {
					return fakeChild({
						schema_version: 1,
						ok: true,
						write_state: "delivered",
					}) as never;
				}
				throw new Error(`unexpected native command: ${command.join(" ")}`);
			}) as never,
		);
		try {
			const runtime = await createProductionBrowserUseRuntime({
				env: fixture.env,
				now: () => 1_000,
			});
			expect(runtime.authAdmission?.kind).toBe("environment-admitted");
			await unlink(fixture.configLink);
			await symlink(join(root, "retargeted-after-admission"), fixture.configLink);
			const vaults = await runtime.authTokenRetrieval?.listVaults();
			expect(vaults).toEqual({
				ok: true,
				vaults: [{ vault_id: "vault-1" }],
			});
			const fetched = await runtime.authTokenRetrieval?.fetchCredentialField({
				binding: BINDING,
				field: "password",
				target: capabilityTarget(TARGET),
			});
			expect(fetched?.ok).toBe(true);
			if (fetched === undefined || !fetched.ok) return;
			const delivered = await runtime.authConfidentialDelivery
				?.forBrowser({
					browser_ws_endpoint:
						"ws://127.0.0.1:9243/devtools/browser/browser-id",
					browser_pid: 4242,
				})
				.consumePrivatePipeAndDeliver({
					schema_version: 1,
					capability: fetched.handle,
					target: capabilityTarget(TARGET),
					locator: {
						role: "textbox",
						accessible_name: "Password",
						input_kind: "password",
					},
				});
			expect(delivered).toMatchObject({
				ok: true,
				write_state: "delivered",
			});

			const configRoots = nativeCommands.flatMap((command) => {
				const index = command.indexOf("--config-root");
				return index === -1 ? [] : [command[index + 1]];
			});
			expect(configRoots).toEqual([
				fixture.canonicalConfigRoot,
				fixture.canonicalConfigRoot,
				fixture.canonicalConfigRoot,
			]);
			expect(configRoots).not.toContain(fixture.literalConfigRoot);
		} finally {
			spawn.mockRestore();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an unignored canonical root blocks before any native auth process", async () => {
		const root = await mkdtemp(join(homedir(), ".browser-use-config-root-"));
		const realSpawn = Bun.spawn.bind(Bun);
		let nativeProcessStarted = false;
		const fixture = await initializeConfigRepository({
			root,
			ignored: false,
		});
		const spawn = spyOn(Bun, "spawn").mockImplementation(
			((command: string[], options: object) => {
				if (command[0] === "/usr/bin/git") {
					return realSpawn(command as never, options as never);
				}
				nativeProcessStarted = true;
				return fakeChild({}) as never;
			}) as never,
		);
		try {
			const runtime = await createProductionBrowserUseRuntime({
				env: fixture.env,
			});
			expect(runtime.authAdmission).toMatchObject({
				kind: "blocked",
				cause: { code: "environment-probe-failed" },
			});
			expect(nativeProcessStarted).toBe(false);
		} finally {
			spawn.mockRestore();
			await rm(root, { recursive: true, force: true });
		}
	});
});
