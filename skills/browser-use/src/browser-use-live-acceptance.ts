import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runForTest } from "./browser-use";
import { parseHandoffFacts } from "./browser-use-discovery";
import {
	type BrowserUseAuthoredReviewedActionRecord,
	verifyAuthoredReviewedActionPromotion,
} from "./browser-use-reviewed-action-authoring";
import {
	createNativeReviewedActionOperatorBroker,
	runReviewedActionPromotionFrontDoor,
} from "./browser-use-reviewed-action-promotion";
import {
	activateRunbookGeneration,
	commitRunbookGenerationCutover,
} from "./browser-use-runbook-generation";
import { loadPrivateRunbookCatalogFromGit } from "./browser-use-private-runbook-catalog";
import { createDefaultPlatformFs, openBrowserUsePaths } from "./browser-use-paths";
import { createProductionBrowserUseRuntime } from "./browser-use-runtime";
import { liveRunbookFixtureResponse } from "./fixtures/runbook-live-readonly-fixture";

const LIVE_GATE = "BROWSER_USE_LIVE_ACCEPTANCE";
const BROKER_PATH = "BROWSER_USE_REVIEWED_ACTION_APPROVAL_BROKER";

const HELP = `Browser Use live Runbook acceptance

Usage:
  BROWSER_USE_LIVE_ACCEPTANCE=1 \\
  BROWSER_USE_REVIEWED_ACTION_APPROVAL_BROKER=/absolute/path/to/ApprovalBroker \\
  bun run acceptance:live

Prerequisites:
  - Signed Browser Use ApprovalBroker with Secure Enclave and Touch ID access.
  - Warm Agent Chrome available through: browser-connect connect agent-browser --json.
  - Loopback binding permitted for the read-only fixture page.
  - Git and the browser-use package dependencies installed.

The command creates a disposable Git catalog and scratch XDG store. It prompts an
external human to review exact action bytes, activates and cuts over that catalog,
then dispatches one read-only action through Agent Chrome. It uses no credentials.
`;

type LiveOutput = { write(text: string): unknown };

function jsonLine(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

async function git(root: string, ...args: string[]): Promise<void> {
	const child = Bun.spawn(["git", ...args], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Browser Use Live Acceptance",
			GIT_AUTHOR_EMAIL: "browser-use-live@example.invalid",
			GIT_COMMITTER_NAME: "Browser Use Live Acceptance",
			GIT_COMMITTER_EMAIL: "browser-use-live@example.invalid",
		},
	});
	const [exitCode, , stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) throw new Error(`git command failed: ${stderr.trim()}`);
}

function commandData(output: { exitCode: number; stdout: string; stderr: string }): Record<string, unknown> {
	if (output.exitCode !== 0) throw new Error(`browser-use command failed: ${output.stderr || output.stdout}`);
	const parsed = JSON.parse(output.stdout) as { data?: unknown };
	if (typeof parsed.data !== "object" || parsed.data === null) throw new Error("browser-use returned no result data");
	return parsed.data as Record<string, unknown>;
}

/** Execute the explicitly gated, host-owned live acceptance path. */
export async function runBrowserUseLiveAcceptance(
	args: readonly string[],
	env: Record<string, string | undefined> = process.env,
	stdout: LiveOutput = process.stdout,
	stderr: LiveOutput = process.stderr,
): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		stdout.write(HELP);
		return 0;
	}
	if (env[LIVE_GATE] !== "1") {
		stderr.write(jsonLine({
			ok: false,
			code: "live-acceptance-disabled",
			message: `Set ${LIVE_GATE}=1 only on the host prepared for presence-backed acceptance.`,
		}));
		return 20;
	}
	const brokerPath = env[BROKER_PATH];
	if (brokerPath === undefined || brokerPath === "") {
		stderr.write(jsonLine({
			ok: false,
			code: "approval-broker-path-required",
			message: `Set ${BROKER_PATH} to the signed ApprovalBroker executable.`,
		}));
		return 20;
	}

	let fixtureRoot: string | undefined;
	let server: ReturnType<typeof Bun.serve> | undefined;
	try {
		fixtureRoot = await mkdtemp(join(tmpdir(), "browser-use-live-acceptance-"));
		const sourceRoot = join(fixtureRoot, "catalog");
		const xdgRoot = join(fixtureRoot, "xdg");
		await mkdir(join(sourceRoot, "skills/browser-use/actions"), { recursive: true });
		await mkdir(join(sourceRoot, "skills/browser-use/runbooks"), { recursive: true });
		await mkdir(join(xdgRoot, "runtime"), { recursive: true, mode: 0o700 });
		await writeFile(join(sourceRoot, "skills/browser-use/actions/registry.json"), '{"actions":[]}\n');
		await git(sourceRoot, "init", "-q");

		server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: liveRunbookFixtureResponse,
		});
		const origin = `http://127.0.0.1:${server.port}`;
		const liveEnv = {
			...env,
			XDG_CONFIG_HOME: join(xdgRoot, "config"),
			XDG_DATA_HOME: join(xdgRoot, "data"),
			XDG_STATE_HOME: join(xdgRoot, "state"),
			XDG_CACHE_HOME: join(xdgRoot, "cache"),
			XDG_RUNTIME_DIR: join(xdgRoot, "runtime"),
		};
		const candidatePath = join(sourceRoot, "candidate.json");
		await writeFile(candidatePath, `${JSON.stringify({
			contract: "browser-use.reviewed-action-candidate",
			schema_version: "1",
			action_id: "count-visible-rows",
			origin,
			source: "async ({ inputs }) => ({ rows: document.querySelectorAll('.row').length })",
			containment: "read-only-observation",
			input_schema: { kind: "object", fields: {} },
			result_schema: { kind: "object", fields: { rows: { required: true, schema: { kind: "number", integer: true } } } },
			result_sensitivity: "low",
		}, null, 2)}\n`);
		const authoringRuntime = await createProductionBrowserUseRuntime({ env: liveEnv, sourceCheckoutRoot: sourceRoot });
		const actionApply = commandData(await runForTest(["action", "apply", "--file", candidatePath, "--json"], authoringRuntime));
		const actionResult = actionApply.result as { digest?: unknown };
		if (typeof actionResult?.digest !== "string") throw new Error("action apply returned no digest");
		await git(sourceRoot, "add", "skills/browser-use/actions/registry.json", `skills/browser-use/actions/assets/${actionResult.digest}.js`);
		await git(sourceRoot, "commit", "-qm", "candidate under external review");

		const promotion = await runReviewedActionPromotionFrontDoor({
			sourceRoot,
			actionId: "count-visible-rows",
			approvalReference: "browser-use-live-acceptance",
			env: liveEnv,
			broker: createNativeReviewedActionOperatorBroker(brokerPath),
		});
		if (!promotion.ok) throw new Error(`promotion refused: ${promotion.code}`);
		await git(sourceRoot, "add", "skills/browser-use/actions/registry.json");
		await git(sourceRoot, "commit", "-qm", "externally reviewed promotion receipt");
		const runtime = await createProductionBrowserUseRuntime({ env: liveEnv, sourceCheckoutRoot: sourceRoot });

		const runbookPath = join(sourceRoot, "runbook.json");
		await writeFile(runbookPath, `${JSON.stringify({
			contract: "browser-use.runbook",
			schema_version: "2",
			service_id: "live-fixture",
			flow_id: "observe-rows",
			flow_name: "observe-rows",
			version: "1",
			summary: "Open a localhost fixture and count visible rows without mutation.",
			allowed_origins: [origin],
			inputs: [],
			steps: [
				{ kind: "open", url: `${origin}/business`, postcondition: { kind: "url-equals", url: `${origin}/business` } },
				{ kind: "action", action_id: "count-visible-rows", expected_digest: actionResult.digest, inputs: {} },
			],
		}, null, 2)}\n`);
		commandData(await runForTest(["runbook", "apply", "--file", runbookPath, "--json"], runtime));
		await git(sourceRoot, "add", "skills/browser-use/runbooks/live-fixture/observe-rows/runbook.json");
		await git(sourceRoot, "commit", "-qm", "complete live acceptance catalog");

		const verifier = runtime.reviewedActionApprovalVerifier;
		if (verifier === undefined) throw new Error("production Reviewed Action verifier was not configured");
		const loaded = await loadPrivateRunbookCatalogFromGit({
			repoRoot: sourceRoot,
			promotionVerifier: {
				async verify(input) {
					const verified = verifyAuthoredReviewedActionPromotion({
						commit: input.commit,
						record: input.record as BrowserUseAuthoredReviewedActionRecord,
						assetBytes: input.assetBytes,
						promotionHistory: input.promotionHistory,
						verifier,
					});
					return verified.ok ? { ok: true as const } : verified;
				},
			},
		});
		if (!loaded.ok) throw new Error(`catalog closure refused: ${loaded.code}`);
		const opened = await openBrowserUsePaths(createDefaultPlatformFs(), liveEnv);
		if (!opened.ok) throw new Error(`scratch XDG store refused: ${opened.refusal.code}`);
		const generationDeps = { fs: runtime.platformFs, paths: opened.paths, clock: runtime.now };
		const activated = await activateRunbookGeneration(generationDeps, {
			catalog: loaded.catalog,
			reviewedCatalogDigest: loaded.catalog.catalog_digest,
			expectedEpoch: 0,
		});
		if (!activated.ok) throw new Error(`activation refused: ${activated.code}`);
		const repeated = await activateRunbookGeneration(generationDeps, {
			catalog: loaded.catalog,
			reviewedCatalogDigest: loaded.catalog.catalog_digest,
			expectedEpoch: activated.epoch,
		});
		if (!repeated.ok || repeated.changed) throw new Error("repeat activation was not a no-op");
		const cutover = await commitRunbookGenerationCutover(generationDeps);
		if (!cutover.ok) throw new Error(`cutover refused: ${cutover.code}`);

		const runId = `live-acceptance-${Date.now()}`;
		const handoff = await runtime.mintHandoff({ adapterId: "agent-browser", runId });
		if (handoff.exitCode !== 0) throw new Error("browser-connect could not mint an Agent Chrome handoff");
		const handoffFacts = parseHandoffFacts(handoff.stdout);
		if (!handoffFacts.ok || handoffFacts.kind !== "verified" || handoffFacts.facts.adapter !== "agent-browser") {
			throw new Error("browser-connect returned no verified Agent Chrome handoff");
		}
		const openedFixture = await runtime.runCommand({
			command: handoffFacts.facts.probeExecutable,
			args: [
				"--cdp", handoffFacts.facts.endpointWs,
				"--session", `browser-use-${runId}`,
				"tab", "new", `${origin}/business`, "--json",
			],
			timeoutMs: 30_000,
		});
		if (openedFixture.exitCode !== 0) throw new Error("Agent Chrome could not open the read-only fixture page");
		const handoffPath = join(fixtureRoot, "handoff.json");
		await writeFile(handoffPath, handoff.stdout, { mode: 0o600 });
		const executed = commandData(await runForTest([
			"runbook", "run",
			"--service", "live-fixture",
			"--flow", "observe-rows",
			"--handoff", handoffPath,
			"--json",
		], runtime));
		const run = executed.run as { state?: unknown; run_id?: unknown };
		if (run?.state !== "confirmed") throw new Error("live Runbook did not reach confirmed state");
		stdout.write(jsonLine({
			ok: true,
			contract: "browser-use.live-runbook-acceptance",
			generation_id: activated.generation_id,
			catalog_digest: activated.catalog_digest,
			run_id: run.run_id,
			state: run.state,
		}));
		return 0;
	} catch (error) {
		stderr.write(jsonLine({
			ok: false,
			code: "live-acceptance-failed",
			message: error instanceof Error ? error.message : String(error),
		}));
		return 20;
	} finally {
		server?.stop(true);
		if (fixtureRoot !== undefined) await rm(fixtureRoot, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	process.exitCode = await runBrowserUseLiveAcceptance(process.argv.slice(2));
}
