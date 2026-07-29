import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shippedCatalogDigest } from "./browser-use-catalog-digest";
import { runForTest } from "./browser-use";
import { createDefaultPlatformFs } from "./browser-use-paths";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";
import { shippedRunbooksRoot } from "./browser-use-runbook";
import {
	type BrowserUseCorpusGenerationCandidatePayload,
	encodeDurableRecord,
} from "./browser-use-schemas";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

const disposables: { dispose(): void }[] = [];
const processRoots: string[] = [];
const browserUseCli = join(dirname(fileURLToPath(import.meta.url)), "browser-use.ts");

afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
	for (const root of processRoots) {
		rmSync(root, { recursive: true, force: true });
	}
});

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

type CommandRunner = (argv: readonly string[]) => Promise<CommandResult>;

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function writeBundleFile(root: string, relativePath: string, contents: string): void {
	const path = join(root, relativePath);
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	writeFileSync(path, contents, { encoding: "utf-8", mode: 0o600 });
}

async function prepareCandidateBundle(
	run: CommandRunner,
	base: string,
	generationId: string,
): Promise<{
	sourceRoot: string;
	candidateRecord: string;
	targetId: string;
}> {
	const migrationSourceRoot = join(base, `migration-source-${generationId}`);
	writeBundleFile(
		migrationSourceRoot,
		"fixture-service/playbooks/inspect.json",
		'{"flow":"inspect"}\n',
	);
	let verifiedData: Record<string, unknown> | undefined;
	for (const phase of ["inventory", "plan", "apply", "verify"] as const) {
		const result = await run([
			"migration",
			phase,
			"--source",
			migrationSourceRoot,
			"--json",
		]);
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		if (phase === "verify") {
			verifiedData = parseJson(result.stdout).data as Record<string, unknown>;
		}
	}
	if (verifiedData === undefined) throw new Error("verified migration data missing");
	const snapshotId = verifiedData.snapshot_id;
	const snapshotDigest = verifiedData.snapshot_digest;
	const targets = verifiedData.canonical_targets as
		| Array<{
				canonical_target_id: string;
				source_relative_paths: string[];
		  }>
		| undefined;
	if (
		typeof snapshotId !== "string" ||
		typeof snapshotDigest !== "string" ||
		targets?.length !== 1 ||
		targets[0] === undefined
	) {
		throw new Error("verified migration identity missing");
	}
	const target = targets[0];
	const [serviceId, flowId] = target.canonical_target_id.split("/");
	if (serviceId === undefined || flowId === undefined) {
		throw new Error("canonical target must be service/flow");
	}
	const sourceRoot = join(base, `candidate-${generationId}`);
	const runbookPath = `runbooks/${serviceId}/${flowId}/runbook.json`;
	const registryPath = "actions/registry.json";
	const proofPath = `proofs/${serviceId}-${flowId}.json`;
	const runbook = `${JSON.stringify({
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: serviceId,
		flow_id: flowId,
		flow_name: flowId,
		version: "1.0.0",
		summary: `Read ${target.canonical_target_id}.`,
		allowed_origins: ["https://example.test"],
		inputs: [],
		steps: [{ kind: "snapshot", interactive: false }],
	})}\n`;
	const registry = '{"actions":[]}\n';
	const proof = '{"proof":"verified","fixture_marker":"NEVER_EMIT_SOURCE_BYTES"}\n';
	const candidate: BrowserUseCorpusGenerationCandidatePayload = {
		contract: "browser-use.corpus-generation-candidate",
		schema_version: "1",
		generation_id: generationId,
		source_snapshot: {
			snapshot_id: snapshotId,
			snapshot_digest: snapshotDigest,
		},
		canonical_targets: [
			{
				canonical_target_id: target.canonical_target_id,
				activation: "active",
				runbook_path: runbookPath,
				runbook_digest: sha256(runbook),
				source_relative_paths: target.source_relative_paths,
				proof_refs: [`proof-${serviceId}-${flowId}`],
				inactive_reason: null,
			},
		],
		action_registry: {
			registry_path: registryPath,
			registry_digest: sha256(registry),
			actions: [],
		},
		auth: { candidates: [], routes: [] },
		proofs: [
			{
				proof_ref: `proof-${serviceId}-${flowId}`,
				path: proofPath,
				digest: sha256(proof),
			},
		],
		shipped_catalog_digest: await shippedCatalogDigest(
			shippedRunbooksRoot(),
			createDefaultPlatformFs(),
		),
	};
	const candidateRecord = encodeDurableRecord(
		"corpus-generation-candidate",
		candidate,
	);
	for (const [relativePath, contents] of [
		[runbookPath, runbook],
		[registryPath, registry],
		[proofPath, proof],
		["corpus-generation-candidate.json", candidateRecord],
	] as const) {
		writeBundleFile(sourceRoot, relativePath, contents);
	}
	return {
		sourceRoot,
		candidateRecord,
		targetId: target.canonical_target_id,
	};
}

function inProcessRunner(
	env: Record<string, string | undefined>,
): CommandRunner {
	const runtime = makeRuntime({ env });
	return (argv) => runForTest(argv, runtime);
}

function processRunner(
	env: Record<string, string | undefined>,
	cwd: string,
): CommandRunner {
	return async (argv) => {
		const child = Bun.spawn([process.execPath, browserUseCli, ...argv], {
			cwd,
			env: {
				HOME: env.HOME,
				XDG_CONFIG_HOME: env.XDG_CONFIG_HOME,
				XDG_DATA_HOME: env.XDG_DATA_HOME,
				XDG_STATE_HOME: env.XDG_STATE_HOME,
				XDG_CACHE_HOME: env.XDG_CACHE_HOME,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		return { exitCode, stdout, stderr };
	};
}

function expectGenerationPlainParity(
	stdout: string,
	data: Record<string, unknown>,
): void {
	const closure = data.closure as Record<string, unknown>;
	expect(stdout).toContain("contract=browser-use.generation-result schema=1");
	for (const field of [
		"generation_id",
		"generation_content_hash",
		"candidate_manifest_digest",
	] as const) {
		expect(stdout).toContain(`${field}=${String(data[field])}`);
	}
	for (const field of [
		"canonical_target_count",
		"active_target_count",
		"action_count",
		"auth_candidate_count",
		"auth_route_count",
		"proof_count",
	] as const) {
		expect(stdout).toContain(`${field}=${String(closure[field])}`);
	}
	expect(stdout).toContain("verified_noop=true");
	expect(stdout).toContain("next_action=activate_staged_generation");
	expect(stdout).toContain(
		`next_action_args=activate,--generation,${String(data.generation_id)},--json`,
	);
}

describe("migration generate public command", () => {
	test("publishes an activation-ready generation with JSON/plain parity, then activates it", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const run = inProcessRunner(xdg.env);
		const generationId = "generation-public-generate";
		const fixture = await prepareCandidateBundle(run, xdg.base, generationId);

		const generated = await run([
			"migration",
			"generate",
			"--source",
			fixture.sourceRoot,
		]);
		expect(generated.exitCode).toBe(0);
		expect(generated.stderr).toBe("");
		const envelope = parseJson(generated.stdout);
		expect(envelope).toMatchObject({
			status: "ok",
			data: {
				contract_id: "browser-use.generation-result",
				schema_version: "1",
				generation_id: generationId,
				generation_content_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
				candidate_manifest_digest: sha256(fixture.candidateRecord),
				closure: {
					canonical_target_count: 1,
					active_target_count: 1,
					action_count: 0,
					auth_candidate_count: 0,
					auth_route_count: 0,
					proof_count: 1,
				},
				verified_noop: false,
				next_safe_action: {
					id: "activate_staged_generation",
					command: "migration",
					args: ["activate", "--generation", generationId, "--json"],
				},
			},
			runtime_actions: [
				{
					id: "activate_staged_generation",
					side_effects: ["check", "write"],
				},
			],
			continuation: { next_action_id: "activate_staged_generation" },
		});
		expect(generated.stdout).not.toContain(fixture.sourceRoot);
		expect(generated.stdout).not.toContain("NEVER_EMIT_SOURCE_BYTES");

		const plain = await run([
			"migration",
			"generate",
			"--source",
			fixture.sourceRoot,
			"--plain",
		]);
		expect(plain.exitCode).toBe(0);
		expect(plain.stderr).toBe("");
		expectGenerationPlainParity(
			plain.stdout,
			parseJson(generated.stdout).data as Record<string, unknown>,
		);
		expect(plain.stdout).not.toContain(fixture.sourceRoot);
		expect(plain.stdout).not.toContain("NEVER_EMIT_SOURCE_BYTES");

		const activated = await run([
			"migration",
			"activate",
			"--generation",
			generationId,
			"--json",
		]);
		expect(activated.exitCode).toBe(0);
		expect(activated.stderr).toBe("");
		expect(parseJson(activated.stdout).data).toMatchObject({
			activation_state: "active",
			active_generation: {
				state: "active",
				current: { generation_id: generationId },
			},
		});
	});

	test("stages and explicitly activates a second public generation while the first remains active", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const run = inProcessRunner(xdg.env);
		const generationA = "generation-public-a";
		const fixtureA = await prepareCandidateBundle(
			run,
			xdg.base,
			generationA,
		);
		expect(
			(
				await run([
					"migration",
					"generate",
					"--source",
					fixtureA.sourceRoot,
					"--json",
				])
			).exitCode,
		).toBe(0);
		expect(
			(
				await run([
					"migration",
					"activate",
					"--generation",
					generationA,
					"--json",
				])
			).exitCode,
		).toBe(0);

		const generationB = "generation-public-b";
		const fixtureB = await prepareCandidateBundle(
			run,
			xdg.base,
			generationB,
		);
		const generatedB = await run([
			"migration",
			"generate",
			"--source",
			fixtureB.sourceRoot,
			"--json",
		]);
		expect(generatedB.exitCode).toBe(0);
		expect(generatedB.stderr).toBe("");
		expect(parseJson(generatedB.stdout).data).toMatchObject({
			generation_id: generationB,
			next_safe_action: { id: "activate_staged_generation" },
		});

		const stagedStatus = await run(["migration", "status", "--json"]);
		expect(stagedStatus.exitCode).toBe(0);
		expect(stagedStatus.stderr).toBe("");
		expect(parseJson(stagedStatus.stdout).data).toMatchObject({
			phase: "verified",
			staged_generation: generationB,
			activation_state: "active",
			active_generation: {
				state: "active",
				current: { generation_id: generationA },
			},
		});

		const activatedB = await run([
			"migration",
			"activate",
			"--generation",
			generationB,
			"--json",
		]);
		expect(activatedB.exitCode).toBe(0);
		expect(activatedB.stderr).toBe("");
		expect(parseJson(activatedB.stdout).data).toMatchObject({
			staged_generation: generationB,
			activation_state: "active",
			active_generation: {
				state: "active",
				current: { generation_id: generationB },
				prior: { generation_id: generationA },
			},
		});
	});

	test("maps producer refusals to redacted JSON and plain exit-20 recovery", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const run = inProcessRunner(xdg.env);
		const missingSource = join(xdg.base, "private-source-value");

		const json = await run([
			"migration",
			"generate",
			"--source",
			missingSource,
		]);
		expect(json.exitCode).toBe(20);
		expect(json.stderr).toBe("");
		const envelope = parseJson(json.stdout);
		expect(envelope).toMatchObject({
			status: "error",
			error: {
				code: "generation_source_invalid",
				exit_code: 20,
				recoverability: "change_input",
				retryable: false,
			},
			runtime_actions: [{ id: "repair_generation_source" }],
			continuation: { next_action_id: "repair_generation_source" },
		});
		expect(json.stdout).not.toContain(missingSource);
		expect(json.stdout).not.toContain("private-source-value");

		const plain = await run([
			"migration",
			"generate",
			"--source",
			missingSource,
			"--plain",
		]);
		expect(plain.exitCode).toBe(20);
		expect(plain.stdout).toBe("");
		expect(plain.stderr).toContain("generation_source_invalid");
		expect(plain.stderr).toContain("action=repair_generation_source");
		expect(plain.stderr).toContain("recoverability=change_input");
		expect(plain.stderr).not.toContain(missingSource);
		expect(plain.stderr).not.toContain("private-source-value");
	});

	test(
		"runs generate and activate through the real process from a neutral working directory",
		async () => {
			const xdg = makeTempXdgEnv();
			disposables.push(xdg);
			const neutralCwd = mkdtempSync(
				join(tmpdir(), "browser-use-generate-neutral-"),
			);
			processRoots.push(neutralCwd);
			const run = processRunner(xdg.env, neutralCwd);
			const generationId = "generation-process-generate";
			const fixture = await prepareCandidateBundle(run, xdg.base, generationId);

			const generated = await run([
				"migration",
				"generate",
				"--source",
				fixture.sourceRoot,
			]);
			expect(generated.exitCode).toBe(0);
			expect(generated.stderr).toBe("");
			expect(parseJson(generated.stdout).data).toMatchObject({
				contract_id: "browser-use.generation-result",
				generation_id: generationId,
				next_safe_action: {
					id: "activate_staged_generation",
				},
			});

			const activated = await run([
				"migration",
				"activate",
				"--generation",
				generationId,
				"--json",
			]);
			expect(activated.exitCode).toBe(0);
			expect(activated.stderr).toBe("");
			expect(parseJson(activated.stdout).data).toMatchObject({
				activation_state: "active",
				active_generation: {
					current: { generation_id: generationId },
				},
			});
		},
		30_000,
	);
});
