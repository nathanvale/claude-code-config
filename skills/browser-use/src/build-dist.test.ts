import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildBrowserUseDist,
	validateBrowserUseNativeExecutable,
	validateShippedRunbookCatalog,
} from "./build-dist";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function writeRunbook(
	root: string,
	serviceId: string,
	flowId: string,
	runbook: unknown,
): void {
	const directory = join(root, serviceId, flowId);
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, "runbook.json"),
		`${JSON.stringify(runbook, null, 2)}\n`,
	);
}

describe("browser-use dist catalog validation", () => {
	test("rejects a shell script as a native security artifact", async () => {
		const root = mkdtempSync(join(tmpdir(), "browser-use-native-proof-"));
		temporaryRoots.push(root);
		const executable = join(root, "browser-use-op-supervisor");
		writeFileSync(executable, "#!/bin/sh\nexit 0\n");
		chmodSync(executable, 0o755);
		await expect(
			validateBrowserUseNativeExecutable(
				executable,
				"browser-use-op-supervisor",
			),
		).rejects.toThrow("not Mach-O");
	});

	test("rejects any invalid shipped runbook with its catalog path", async () => {
		const root = mkdtempSync(join(tmpdir(), "browser-use-build-catalog-"));
		temporaryRoots.push(root);
		const valid = JSON.parse(
			readFileSync(
				join(
					import.meta.dir,
					"..",
					"runbooks",
					"oncore",
					"timesheet-snapshot-verify",
					"runbook.json",
				),
				"utf8",
			),
		) as Record<string, unknown>;
		writeRunbook(root, "alpha", "valid", {
			...valid,
			service_id: "alpha",
			flow_id: "valid",
		});
		writeRunbook(root, "zeta", "broken", {
			...valid,
			service_id: "zeta",
			flow_id: "broken",
			steps: [],
		});

		const validation = validateShippedRunbookCatalog(root);
		await expect(validation).rejects.toThrow(
			"zeta/broken/runbook.json",
		);
		await expect(validation).rejects.toThrow("runbook_no_steps");
	});

	test(
		"runs the dist-only shipped catalog from a neutral working directory",
		async () => {
			const root = realpathSync(
				mkdtempSync(join(tmpdir(), "browser-use-dist-proof-")),
			);
			temporaryRoots.push(root);
			const installRoot = join(root, "install");
			const distRoot = join(installRoot, "dist");
			const neutralCwd = join(root, "neutral-cwd");
			mkdirSync(neutralCwd, { recursive: true });

			const proof = await buildBrowserUseDist({
				distRoot,
				log: () => {},
			});
			const expectedRunbooks = proof.relativePaths.map((relativePath) =>
				relativePath.split("/").slice(0, 2).join("/"),
			);
			expect(existsSync(join(installRoot, "runbooks"))).toBe(false);
			expect(
				existsSync(join(distRoot, "bin", "browser-use-op-supervisor")),
			).toBe(true);
			expect(
				existsSync(join(distRoot, "bin", "browser-use-confidential-delivery")),
			).toBe(true);

			const child = Bun.spawn(
				[
					process.execPath,
					join(distRoot, "browser-use.js"),
					"runbook",
					"list",
					"--json",
				],
				{
					cwd: neutralCwd,
					env: {
						HOME: join(root, "home"),
						XDG_CONFIG_HOME: join(root, "xdg-config"),
						XDG_DATA_HOME: join(root, "xdg-data"),
						XDG_STATE_HOME: join(root, "xdg-state"),
						XDG_CACHE_HOME: join(root, "xdg-cache"),
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);

			if (exitCode !== 0) {
				throw new Error(
					`dist-only runbook list exited ${exitCode}: stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
				);
			}
			expect(stderr).toBe("");
			const envelope = JSON.parse(stdout) as {
				data: {
					runbook_count: number;
					runbooks: Array<{ service_id: string; flow_id: string }>;
				};
			};
			expect(envelope.data.runbook_count).toBe(proof.runbookCount);
			expect(
				envelope.data.runbooks.map(
					({ service_id, flow_id }) => `${service_id}/${flow_id}`,
				),
			).toEqual(expectedRunbooks);

			const probeSource = join(root, "binding-store-probe.ts");
			writeFileSync(
				probeSource,
				`
import { createBrowserUseAuthBindingStore } from ${JSON.stringify(
					join(import.meta.dir, "browser-use-auth-binding-store.ts"),
				)};
import { createDefaultPlatformFs, openBrowserUsePaths } from ${JSON.stringify(
					join(import.meta.dir, "browser-use-paths.ts"),
				)};

const opened = await openBrowserUsePaths(createDefaultPlatformFs(), process.env);
if (!opened.ok) throw new Error(opened.refusal.code);
const resolution = {
	generation_id: "generation-a",
	activation_epoch: 1,
	auth_context_ref: "oncore-session",
	route_digest: "a".repeat(64),
	candidate_digest: "b".repeat(64),
	candidate: {
		candidate_id: "candidate-oncore",
		service_id: "oncore",
		auth_context: "interactive-login",
		legacy_context_prose: null,
		hint_item_id: null,
		proposed_origins: ["https://portal.example.com"],
		legacy_vault_name: null,
		provenance: "legacy-auth-pointer",
	},
};
const binding = {
	service_id: "oncore",
	service_account_id: "service-account-1",
	auth_context: "interactive-login",
	allowed_origins: ["https://portal.example.com"],
	allowed_login_paths: [],
	vault_id: "vault-1",
	item_id: "item-1",
	item_revision: 7,
	allowed_auth_methods: ["password"],
	binding_revision: 1,
};
const store = createBrowserUseAuthBindingStore({
	paths: opened.paths,
});
const saved = await store.save({ resolution, binding });
const loaded = await store.load(resolution);
console.log(JSON.stringify({ saved, loaded }));
`,
			);
			const probeBuild = await Bun.build({
				entrypoints: [probeSource],
				outdir: distRoot,
				target: "bun",
				splitting: false,
				minify: false,
				sourcemap: "none",
			});
			expect(probeBuild.success).toBe(true);

			const probe = Bun.spawn(
				[process.execPath, join(distRoot, "binding-store-probe.js")],
				{
					cwd: neutralCwd,
					env: {
						HOME: join(root, "home"),
						PATH: process.env.PATH ?? "/usr/bin:/bin",
						XDG_CONFIG_HOME: join(root, "probe-config"),
						XDG_DATA_HOME: join(root, "probe-data"),
						XDG_STATE_HOME: join(root, "probe-state"),
						XDG_CACHE_HOME: join(root, "probe-cache"),
						XDG_RUNTIME_DIR: join(root, "probe-runtime"),
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const [probeStdout, probeStderr, probeExitCode] = await Promise.all([
				new Response(probe.stdout).text(),
				new Response(probe.stderr).text(),
				probe.exited,
			]);
			if (probeExitCode !== 0) {
				throw new Error(
					`dist binding-store probe exited ${probeExitCode}: stdout=${JSON.stringify(probeStdout)} stderr=${JSON.stringify(probeStderr)}`,
				);
			}
			expect(probeStderr).toBe("");
			const probeResult = JSON.parse(probeStdout) as {
				saved: { ok: boolean };
				loaded: {
					ok: boolean;
					binding?: { item_id?: string };
				};
			};
			expect(probeResult.saved.ok).toBe(true);
			expect(probeResult.loaded.ok).toBe(true);
			expect(probeResult.loaded.binding?.item_id).toBe("item-1");
		},
		30_000,
	);
});
