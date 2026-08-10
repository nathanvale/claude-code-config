import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	chmod,
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	type BrowserUseNativeAdmissionCommand,
	inspectBindingSelectionNativeCapability,
} from "../src/binding-selection-capability.ts";

const cleanup = new Set<string>();

afterEach(async () => {
	for (const path of cleanup) await rm(path, { recursive: true, force: true });
	cleanup.clear();
});

async function fixture() {
	const home = await mkdtemp(
		join(await realpath(tmpdir()), "browser-use-native-selection-"),
	);
	cleanup.add(home);
	const productRoot = join(home, ".local", "browser-use-security");
	const app = join(productRoot, "ApprovalBroker.app");
	const broker = join(app, "Contents", "MacOS", "ApprovalBroker");
	const supervisor = join(
		app,
		"Contents",
		"Helpers",
		"browser-use-op-supervisor",
	);
	const profile = join(app, "Contents", "embedded.provisionprofile");
	const info = join(app, "Contents", "Info.plist");
	const configRoot = join(home, ".config", "browser-use");
	const verifierPath = join(configRoot, "reviewed-action-verifier.json");
	const publicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]);
	const verifier = {
		contract: "browser-use.reviewed-action-verifier",
		schema_version: "1",
		key_id: createHash("sha256").update(publicKey).digest("hex"),
		public_key: publicKey.toString("base64"),
	};
	await mkdir(join(app, "Contents", "MacOS"), { recursive: true, mode: 0o755 });
	await mkdir(join(app, "Contents", "Helpers"), {
		recursive: true,
		mode: 0o755,
	});
	await mkdir(configRoot, { recursive: true, mode: 0o700 });
	await chmod(join(home, ".config"), 0o700);
	await writeFile(broker, "broker", { mode: 0o755 });
	await writeFile(supervisor, "supervisor", { mode: 0o755 });
	await writeFile(profile, "profile", { mode: 0o644 });
	await writeFile(info, "plist", { mode: 0o644 });
	await writeFile(verifierPath, `${JSON.stringify(verifier)}\n`, {
		mode: 0o600,
	});
	return {
		home,
		productRoot,
		app,
		broker,
		supervisor,
		configRoot,
		verifierPath,
		verifier,
	};
}

function admittedRunner(
	fixtureValue: Awaited<ReturnType<typeof fixture>>,
	seen: BrowserUseNativeAdmissionCommand[],
) {
	return async (command: BrowserUseNativeAdmissionCommand) => {
		seen.push(command);
		if (command.kind === "verify-broker-entitlements") {
			return {
				exitCode: 0,
				stdout: `<?xml version="1.0"?><plist><dict><key>com.apple.application-identifier</key><string>6428AK7884.com.nathanvow.browser-use-security.approval-broker</string><key>com.apple.developer.team-identifier</key><string>6428AK7884</string><key>keychain-access-groups</key><array><string>6428AK7884.com.nathanvow.browser-use-security.approval-broker</string></array></dict></plist>`,
				stderr: "",
			};
		}
		if (command.kind === "broker-verifier") {
			return {
				exitCode: 0,
				stdout: JSON.stringify({
					ok: true,
					verifier: {
						key_id: fixtureValue.verifier.key_id,
						public_key: fixtureValue.verifier.public_key,
					},
				}),
				stderr: "",
			};
		}
		if (command.kind === "verify-product-version") {
			return { exitCode: 0, stdout: "0.1.1\n", stderr: "" };
		}
		return { exitCode: 0, stdout: "", stderr: "" };
	};
}

describe("installed binding-selection native capability", () => {
	test("reports typed absence without launching a child when no product is installed", async () => {
		const home = await mkdtemp(
			join(await realpath(tmpdir()), "browser-use-native-selection-absent-"),
		);
		cleanup.add(home);
		const seen: BrowserUseNativeAdmissionCommand[] = [];
		expect(
			await inspectBindingSelectionNativeCapability(
				{ home, configRoot: join(home, ".config", "browser-use") },
				{
					run: async (command) => {
						seen.push(command);
						return { exitCode: 1, stdout: "", stderr: "" };
					},
				},
			),
		).toEqual({ status: "native-capability-absent" });
		expect(seen).toEqual([]);
	});

	test("admits only the fixed bundle, nested supervisor, and matching pinned verifier", async () => {
		const value = await fixture();
		const seen: BrowserUseNativeAdmissionCommand[] = [];
		const result = await inspectBindingSelectionNativeCapability(
			{ home: value.home, configRoot: value.configRoot },
			{ run: admittedRunner(value, seen) },
		);
		expect(result).toEqual({
			status: "admitted",
			brokerPath: value.broker,
			supervisorPath: value.supervisor,
			verifier: {
				key_id: value.verifier.key_id,
				public_key: value.verifier.public_key,
			},
		});
		expect(seen.map((command) => command.kind)).toEqual([
			"verify-broker-signature",
			"verify-broker-entitlements",
			"verify-supervisor-signature",
			"verify-product-version",
			"broker-verifier",
		]);
		expect(seen[0]).toMatchObject({ path: value.app });
		expect(seen[2]).toMatchObject({ path: value.supervisor });
	});

	test("rejects a sandboxed broker before launching its private helper", async () => {
		const value = await fixture();
		const result = await inspectBindingSelectionNativeCapability(
			{ home: value.home, configRoot: value.configRoot },
			{
				run: async (command) =>
					command.kind === "verify-broker-entitlements"
						? {
								exitCode: 0,
								stdout:
									"<plist><dict><key>com.apple.security.app-sandbox</key><true/></dict></plist>",
								stderr: "",
							}
						: admittedRunner(value, [])(command),
			},
		);
		expect(result).toEqual({
			status: "not-admitted",
			code: "broker-entitlements-invalid",
		});
	});

	test("rejects a supervisor that does not satisfy the code-owned signing requirement", async () => {
		const value = await fixture();
		const result = await inspectBindingSelectionNativeCapability(
			{ home: value.home, configRoot: value.configRoot },
			{
				run: async (command) =>
					command.kind === "verify-supervisor-signature"
						? { exitCode: 1, stdout: "", stderr: "invalid" }
						: admittedRunner(value, [])(command),
			},
		);
		expect(result).toEqual({
			status: "not-admitted",
			code: "supervisor-signature-invalid",
		});
	});

	test("rejects an incompatible installed product version", async () => {
		const value = await fixture();
		expect(
			await inspectBindingSelectionNativeCapability(
				{ home: value.home, configRoot: value.configRoot },
				{
					run: async (command) =>
						command.kind === "verify-product-version"
							? { exitCode: 0, stdout: "0.1.0\n", stderr: "" }
							: admittedRunner(value, [])(command),
				},
			),
		).toEqual({
			status: "not-admitted",
			code: "product-version-incompatible",
		});
	});

	test("rejects a malformed owner-only verifier pin", async () => {
		const value = await fixture();
		await writeFile(value.verifierPath, "{}\n", { mode: 0o600 });
		expect(
			await inspectBindingSelectionNativeCapability(
				{ home: value.home, configRoot: value.configRoot },
				{ run: admittedRunner(value, []) },
			),
		).toEqual({ status: "not-admitted", code: "verifier-pin-invalid" });
	});

	test("rejects a malformed verifier response from the installed broker", async () => {
		const value = await fixture();
		expect(
			await inspectBindingSelectionNativeCapability(
				{ home: value.home, configRoot: value.configRoot },
				{
					run: async (command) =>
						command.kind === "broker-verifier"
							? { exitCode: 0, stdout: '{"ok":true}', stderr: "" }
							: admittedRunner(value, [])(command),
				},
			),
		).toEqual({ status: "not-admitted", code: "broker-verifier-invalid" });
	});

	test("rejects a broker verifier that differs from the owner-only pin", async () => {
		const value = await fixture();
		const differentPublicKey = Buffer.concat([
			Buffer.from([4]),
			Buffer.alloc(64, 8),
		]);
		await writeFile(
			value.verifierPath,
			`${JSON.stringify({
				...value.verifier,
				key_id: createHash("sha256").update(differentPublicKey).digest("hex"),
				public_key: differentPublicKey.toString("base64"),
			})}\n`,
			{ mode: 0o600 },
		);
		expect(
			await inspectBindingSelectionNativeCapability(
				{ home: value.home, configRoot: value.configRoot },
				{ run: admittedRunner(value, []) },
			),
		).toEqual({ status: "not-admitted", code: "verifier-pin-mismatch" });
	});

	test("rejects symlink substitution before any signature or broker launch", async () => {
		const value = await fixture();
		const replacement = `${value.supervisor}.replacement`;
		await writeFile(replacement, "replacement", { mode: 0o755 });
		await rm(value.supervisor);
		await symlink(replacement, value.supervisor);
		const seen: BrowserUseNativeAdmissionCommand[] = [];
		expect(
			await inspectBindingSelectionNativeCapability(
				{ home: value.home, configRoot: value.configRoot },
				{ run: admittedRunner(value, seen) },
			),
		).toEqual({ status: "not-admitted", code: "installed-layout-unsafe" });
		expect(seen).toEqual([]);
	});

	test("rejects a writable installed-product ancestor before any native command", async () => {
		const value = await fixture();
		await chmod(value.productRoot, 0o777);
		const seen: BrowserUseNativeAdmissionCommand[] = [];
		expect(
			await inspectBindingSelectionNativeCapability(
				{ home: value.home, configRoot: value.configRoot },
				{ run: admittedRunner(value, seen) },
			),
		).toEqual({ status: "not-admitted", code: "installed-layout-unsafe" });
		expect(seen).toEqual([]);
	});
});
