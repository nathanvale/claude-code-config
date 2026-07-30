import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const temporaryRoots: string[] = [];
const skillRoot = join(import.meta.dir, "..");
const releaseNativeRoot = join(
	skillRoot,
	"..",
	"..",
	"runtime",
	"browser-use-environment-auth",
	".build",
	"release",
);

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

async function runProcess(input: {
	argv: string[];
	cwd: string;
	env?: Record<string, string | undefined>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const child = Bun.spawn(input.argv, {
		cwd: input.cwd,
		env: input.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { exitCode, stdout, stderr };
}

function privateDirectory(path: string): string {
	mkdirSync(path, { recursive: true });
	chmodSync(path, 0o700);
	return path;
}

describe("U9 packaged public interface", () => {
	test(
		"installs the real tarball and runs from a neutral CWD with a clean home",
		async () => {
			const root = realpathSync(
				mkdtempSync(
					join(realpathSync(homedir()), ".browser-use-u9-package-"),
				),
			);
			temporaryRoots.push(root);
			const packageRoot = join(root, "package-output");
			const consumerRoot = join(root, "consumer");
			const neutralCwd = join(root, "neutral-cwd");
			mkdirSync(packageRoot);
			mkdirSync(consumerRoot);
			mkdirSync(neutralCwd);

			const packed = await runProcess({
				argv: [
					process.execPath,
					"pm",
					"pack",
					"--destination",
					packageRoot,
					"--quiet",
				],
				cwd: skillRoot,
				env: process.env,
			});
			if (packed.exitCode !== 0) {
				throw new Error(
					`pack failed: stdout=${JSON.stringify(packed.stdout)} stderr=${JSON.stringify(packed.stderr)}`,
				);
			}
			const emittedTarball = packed.stdout.trim().split("\n").at(-1);
			if (emittedTarball === undefined || emittedTarball === "") {
				throw new Error("pack did not report its tarball");
			}
			const tarball = isAbsolute(emittedTarball)
				? emittedTarball
				: resolve(packageRoot, emittedTarball);
			expect(existsSync(tarball)).toBe(true);

			const installed = await runProcess({
				argv: [
					process.execPath,
					"add",
					"--no-progress",
					"--no-save",
					tarball,
				],
				cwd: consumerRoot,
				env: process.env,
			});
			if (installed.exitCode !== 0) {
				throw new Error(
					`tarball install failed: stdout=${JSON.stringify(installed.stdout)} stderr=${JSON.stringify(installed.stderr)}`,
				);
			}

			const installedPackage = join(
				consumerRoot,
				"node_modules",
				"browser-use-scripts",
			);
			const packageJson = JSON.parse(
				readFileSync(join(installedPackage, "package.json"), "utf8"),
			) as { bin?: Record<string, string> };
			expect(packageJson.bin).toEqual({
				"browser-use": "dist/browser-use.js",
			});
			for (const executable of [
				"browser-use-token-custody",
				"browser-use-op-supervisor",
				"browser-use-confidential-delivery",
			]) {
				const path = join(installedPackage, "dist", "bin", executable);
				expect(existsSync(path)).toBe(true);
				expect(statSync(path).mode & 0o111).not.toBe(0);
				expect(sha256(path)).toBe(
					sha256(join(releaseNativeRoot, executable)),
				);
			}

			const cleanHome = privateDirectory(join(root, "home"));
			const configTarget = privateDirectory(join(root, "xdg-config-target"));
			const initializedConfigRepository = await runProcess({
				argv: ["/usr/bin/git", "init", "--quiet"],
				cwd: configTarget,
				env: {
					HOME: cleanHome,
					PATH: "/usr/bin:/bin",
					LANG: "C",
				},
			});
			expect(initializedConfigRepository).toMatchObject({
				exitCode: 0,
				stdout: "",
				stderr: "",
			});
			const configLink = join(root, "xdg-config-link");
			symlinkSync(configTarget, configLink);
			const cleanEnv = {
				HOME: cleanHome,
				PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
				LANG: "C",
				XDG_CONFIG_HOME: configLink,
				XDG_DATA_HOME: privateDirectory(join(root, "xdg-data")),
				XDG_STATE_HOME: privateDirectory(join(root, "xdg-state")),
				XDG_CACHE_HOME: privateDirectory(join(root, "xdg-cache")),
				XDG_RUNTIME_DIR: privateDirectory(join(root, "xdg-runtime")),
			};
			expect("OP_SERVICE_ACCOUNT_TOKEN" in cleanEnv).toBe(false);
			const installedBin = join(
				consumerRoot,
				"node_modules",
				".bin",
				"browser-use",
			);

			const unignoredStatus = await runProcess({
				argv: [installedBin, "auth", "status", "--json"],
				cwd: neutralCwd,
				env: cleanEnv,
			});
			expect(unignoredStatus.exitCode).toBe(20);
			expect(JSON.parse(unignoredStatus.stdout)).toMatchObject({
				status: "error",
				data: { blocked_cause: "environment-probe-failed" },
				continuation: { next_action_id: "inspect-capability-loss" },
			});

			writeFileSync(join(configTarget, ".gitignore"), "browser-use/\n");

			const help = await runProcess({
				argv: [installedBin, "--help"],
				cwd: neutralCwd,
				env: cleanEnv,
			});
			expect(help.exitCode).toBe(0);
			expect(help.stderr).toBe("");
			expect(help.stdout).toContain("browser-use guide");
			expect(help.stdout).toContain("browser-use runbook list --json");

			const catalog = await runProcess({
				argv: [installedBin, "runbook", "list", "--json"],
				cwd: neutralCwd,
				env: cleanEnv,
			});
			if (catalog.exitCode !== 0) {
				throw new Error(
					`installed catalog failed: stdout=${JSON.stringify(catalog.stdout)} stderr=${JSON.stringify(catalog.stderr)}`,
				);
			}
			expect(catalog.stderr).toBe("");
			const catalogEnvelope = JSON.parse(catalog.stdout) as {
				status: string;
				data: { runbook_count: number };
			};
			expect(catalogEnvelope).toMatchObject({
				status: "ok",
				data: { runbook_count: 2 },
			});

			const status = await runProcess({
				argv: [installedBin, "auth", "status", "--json"],
				cwd: neutralCwd,
				env: cleanEnv,
			});
			expect(status.exitCode).toBe(20);
			expect(status.stderr).toBe("");
			const statusEnvelope = JSON.parse(status.stdout) as {
				status: string;
				data: {
					assurance: string;
					blocked_cause: string;
					checks: { token_file: { state: string } };
				};
				continuation: { next_action_id: string };
			};
			expect(statusEnvelope).toMatchObject({
				status: "error",
				data: {
					assurance: "lower-assurance",
					blocked_cause: "missing-token",
					checks: { token_file: { state: "missing" } },
				},
				continuation: { next_action_id: "install-local-token" },
			});

			// Programmatic composition proves the packed bundle retains the public
			// parser/runtime contract with an earned hermetic environment seam. It
			// does not stand in for native custody: the spawned installed status
			// above crosses the real packed custody boundary, helper bytes are
			// release-identical, and the native harness owns fake-OP/delivery proof.
			const installedModule = (await import(
				pathToFileURL(
					join(installedPackage, "dist", "browser-use.js"),
				).href
			)) as {
				createProductionBrowserUseRuntime(
					overrides: Record<string, unknown>,
					seam: Record<string, unknown>,
				): Promise<Record<string, unknown>>;
				runForTest(
					argv: string[],
					runtime: Record<string, unknown>,
				): Promise<{ exitCode: number; stdout: string }>;
			};
			const calls = { metadata: 0, field: 0 };
			const tokenPort = {
				async getBindingEvidence() {
					calls.metadata += 1;
					return {
						ok: true,
						evidence: {
							identity: {
								service_account_id: "service-account-1",
								state: "ACTIVE",
								type: "SERVICE_ACCOUNT",
							},
							vaults: [{ vault_id: "vault-1" }],
							item_evidence: null,
						},
					};
				},
				async getServiceAccountIdentity() {
					throw new Error("unexpected identity call");
				},
				async listVaults() {
					throw new Error("unexpected vault-list call");
				},
				async listLoginItems() {
					throw new Error("unexpected item-list call");
				},
				async getLoginItem() {
					throw new Error("unexpected item call");
				},
				async fetchCredentialField() {
					calls.field += 1;
					return {
						ok: false,
						rejection: {
							code: "capability-missing",
							message: "credential retrieval was not admitted.",
						},
					};
				},
			};
			const runtime =
				await installedModule.createProductionBrowserUseRuntime(
					{
						env: cleanEnv,
						now: () => 1_000,
						environmentTokenLifecycle: {
							inputIsTTY: () => false,
							execute: async () => ({
								state: "ready",
								next_action: "validate-service-account",
							}),
						},
						authStatusSupport: async () => ({
							contract: "browser-use.auth-status-support",
							schema_version: "1",
							executables: {
								op: "ready",
								wrapper: "ready",
								helper: "ready",
							},
							admin_authority: "proven",
							profile: "live-clean",
							binding: "ready",
							proof: {
								lane_digest:
									"10a326413857cc1a7acb1d1cc7d623476aa02b7283085b27b75dff918b265c7d",
								principal_digest:
									"5d7c7fff1e59dc18d0d951b5a30859827506e9417c98defe13528623651356c5",
								vault_digest:
									"fb3cff3652702c773d0740dc34c2378822ea1be4164eb2d5516c7962125a24af",
								profile_digest:
									"897e7115d9aca68c616685a1b387987afeebe245c6aa822345f7049fbba977ac",
								profile_posture_receipt_digest: "9".repeat(64),
								binding_context_digest:
									"01c7c46b5c848478e7d5977ead0a872518734bd30d2ec681307dc2e786b35267",
								binding_receipt_digest: "a".repeat(64),
								observed_at_epoch_ms: 900,
								fresh_until_epoch_ms: 1_100,
							},
						}),
					},
					{
						admission: {
							verifyProduct: async () => ({
								verdict: "native-capability-absent",
							}),
							verifyTarget: async () => ({
								verdict: "native-capability-absent",
							}),
						},
						createTokenExecutor: () => {
							throw new Error("native executor must stay absent");
						},
						environment: {
							inspectToken: async () => ({
								state: "ready",
								next_action: "validate-service-account",
							}),
							createTokenRetrieval: () => tokenPort,
						},
					},
				);
			const admittedStatus = await installedModule.runForTest(
				["auth", "status", "--json"],
				runtime,
			);
			expect(admittedStatus.exitCode).toBe(0);
			expect(JSON.parse(admittedStatus.stdout)).toMatchObject({
				status: "ok",
				data: {
					state: "ready",
					selected_lane: "environment-injected-op",
					assurance: "lower-assurance",
				},
				continuation: { next_action_id: "run-authenticated-runbook" },
			});
			expect(calls).toEqual({ metadata: 1, field: 0 });
		},
		120_000,
	);
});
