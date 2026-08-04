import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createProductionBrowserUseRuntime } from "./browser-use";
import type { BrowserUseTokenRetrievalPort } from "./browser-use-op";

const cleanup = new Set<string>();
afterEach(async () => {
	for (const path of cleanup) await rm(path, { recursive: true, force: true });
	cleanup.clear();
});

describe("production package authority boundary", () => {
	test("production options reject test authority at compile time", () => {
		const compileOnlyRejections = async () => {
			// @ts-expect-error production construction cannot inject authenticated-state proof
			await createProductionBrowserUseRuntime({ runbookAuthenticatedStateProof: async () => ({ proven: false, cause: "human-identity-attestation-required" }) });
			// @ts-expect-error production construction cannot inject Reviewed Action approval authority
			await createProductionBrowserUseRuntime({ reviewedActionApprovalVerifier: { verify: () => ({ ok: true }) } });
			// @ts-expect-error production construction cannot inject credential authority
			await createProductionBrowserUseRuntime({ authTokenRetrieval: {} as BrowserUseTokenRetrievalPort });
			// @ts-expect-error production construction cannot replace native admission
			await createProductionBrowserUseRuntime({ securitySeam: {} });
		};
		void compileOnlyRejections;
		expect(true).toBe(true);
	});

	test("JavaScript extra keys cannot inject production authority", async () => {
		const hostileFactory = createProductionBrowserUseRuntime as (
			options: Record<string, unknown>,
		) => ReturnType<typeof createProductionBrowserUseRuntime>;
		const runtime = await hostileFactory({
			env: {},
			runbookAuthenticatedStateProof: async () => ({ proven: true }),
			reviewedActionApprovalVerifier: { verify: () => ({ ok: true }) },
			authTokenRetrieval: { marker: "fixture" },
			securitySeam: { marker: "fixture" },
		});
		expect(runtime.runbookAuthenticatedStateProof).toBeUndefined();
		expect(runtime.reviewedActionApprovalVerifier).toBeUndefined();
		expect(runtime.authTokenRetrieval).toBeUndefined();
	});

	test("temporary production bundle excludes test factories and hostile authority", async () => {
		const root = await mkdtemp(join(tmpdir(), "browser-use-production-bundle-"));
		cleanup.add(root);
		const outdir = join(root, "bundle");
		const built = await Bun.build({
			entrypoints: [join(import.meta.dir, "browser-use.ts")],
			outdir,
			target: "bun",
			splitting: false,
			external: ["@side-quest/browser-connect/cli"],
		});
		expect(built.success).toBe(true);
		const bundlePath = join(outdir, "browser-use.js");
		const module = (await import(
			`${pathToFileURL(bundlePath).href}?test=${Date.now()}`
		)) as Record<string, unknown>;
		expect(module.default).toBeUndefined();
		expect(module.createDefaultBrowserUseRuntime).toBeUndefined();
		expect(Object.keys(module).filter((key) => /RuntimeForTest/.test(key))).toEqual(
			[],
		);

		const configRoot = join(root, "config");
		await mkdir(configRoot, { recursive: true, mode: 0o700 });
		await writeFile(
			join(configRoot, "runtime.json"),
			JSON.stringify({
				runbookAuthenticatedStateProof: "fixture",
				reviewedActionApprovalVerifier: "fixture",
				authTokenRetrieval: "fixture",
				securitySeam: "fixture",
			}),
			{ mode: 0o600 },
		);
		const child = Bun.spawn(
			[
				process.execPath,
				bundlePath,
				"auth",
				"enroll-browser-automation-token",
				"--json",
			],
			{
				env: {
					HOME: root,
					XDG_CONFIG_HOME: configRoot,
					BROWSER_USE_RUNBOOK_AUTHENTICATED_STATE_PROOF: "fixture",
					BROWSER_USE_REVIEWED_ACTION_APPROVAL_VERIFIER: "fixture",
					BROWSER_USE_AUTH_TOKEN_RETRIEVAL: "fixture",
					BROWSER_USE_SECURITY_SEAM: "fixture",
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [exitCode, stdout] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
		]);
		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toMatchObject({
			data: {
				evaluation: {
					status: "native-capability-absent",
					blocked_cause: "missing-token",
				},
			},
			continuation: { next_action_id: "install-token" },
		});
	});
});
