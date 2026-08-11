import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COMMANDS } from "./command-contract";
import { runCli } from "./cli";
import { writeBaselineAtomically } from "./generate-openapi-baseline";
import { analyzeOpenApiDrift, buildOpenApiBaseline } from "./openapi-drift";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const openApiFixture = {
	swagger: "2.0",
	basePath: "/2.0",
	consumes: ["application/json"],
	produces: ["application/json"],
	paths: {
		"/repositories/{workspace}/{repo_slug}/pullrequests": {
			get: {
				tags: ["Pullrequests"],
				summary: "List pull requests",
				parameters: [{ name: "workspace", in: "path", required: true, type: "string" }],
				responses: { "200": { description: "Success", schema: { type: "object" } } },
			},
			post: {
				tags: ["Pullrequests"],
				summary: "Create a pull request",
				parameters: [],
				responses: { "201": { description: "Created", schema: { type: "object" } } },
			},
		},
	},
};

function writeOpenApiBaseline(): string {
	const directory = mkdtempSync(join(tmpdir(), "bb-pr-openapi-"));
	const path = join(directory, "baseline.json");
	writeFileSync(path, JSON.stringify(buildOpenApiBaseline(openApiFixture)));
	return path;
}

async function runOpenApiDoctor(fixture: unknown) {
	const run = harness(async () => Response.json(fixture));
	run.dependencies.environment = {};
	const baseline = writeOpenApiBaseline();
	const exitCode = await runCli(["doctor", "openapi", "--baseline-file", baseline], run.dependencies);
	return { exitCode, result: JSON.parse(run.stdout[0]) };
}

async function expectExecutedGenericWriteRetrySafety(fetcher: FetchLike): Promise<void> {
	const run = harness(fetcher);
	expect(await runCli(["api", "/x", "--method", "POST", "--execute"], run.dependencies)).toBe(1);
	const result = JSON.parse(run.stderr[0]);
	expect(result.retry_safety).toBe("inspect_before_retry");
	expect(result.next_safe_action).toMatch(/inspect/i);
}

function harness(fetcher?: FetchLike) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const environment: Record<string, string | undefined> = {
		BITBUCKET_EMAIL: "agent@example.test",
		BITBUCKET_API_TOKEN: "secret-not-printed",
		BB_WORKSPACE: "workspace",
		BB_REPO_SLUG: "repo",
	};
	return {
		stdout,
		stderr,
		dependencies: {
			...(fetcher ? { fetcher } : {}),
			environment,
			cwd: "/tmp",
			io: {
				stdout: (text: string) => stdout.push(text),
				stderr: (text: string) => stderr.push(text),
			},
			runId: "run-test",
		},
	};
}

describe("bb-pr command surface", () => {
	test("renders prose help without auth or repository state", async () => {
		const run = harness();
		run.dependencies.environment = {};
		expect(await runCli([], run.dependencies)).toBe(0);
		expect(run.stdout.join("\n")).toContain("thin Bitbucket Cloud REST client");
		expect(run.stdout.join("\n")).toContain("Start with `bb-pr status`");
		expect(run.stderr).toEqual([]);
	});

	test("renders command help in prose", async () => {
		const run = harness();
		expect(await runCli(["help", "merge"], run.dependencies)).toBe(0);
		expect(run.stdout.join("\n")).toContain("External write");
		expect(run.stdout.join("\n")).toContain("source branch stays open");
	});

	test("emits machine-readable discovery from the same catalog", async () => {
		const run = harness();
		expect(await runCli(["commands", "--json"], run.dependencies)).toBe(0);
		const discovery = JSON.parse(run.stdout[0]);
		expect(discovery.commands.map((command: { name: string }) => command.name)).toEqual(COMMANDS.map((command) => command.name));
	});

	test("accepts help for every discovered command", async () => {
		for (const command of COMMANDS) {
			const run = harness();
			expect(await runCli([command.name, "--help"], run.dependencies)).toBe(0);
			expect(run.stdout[0]).toContain(`Usage: ${command.usage}`);
		}
	});

	test("aligns every discovered command with parser and runtime dispatch", async () => {
		const examples: Record<string, string[]> = {
			doctor: ["doctor", "openapi", "--baseline-file", writeOpenApiBaseline()],
			operations: ["operations", "--query", "pullrequest"],
			api: ["api", "/user"],
			status: ["status"],
			list: ["list"],
			view: ["view", "78"],
			diff: ["diff", "78"],
			diffstat: ["diffstat", "78"],
			comments: ["comments", "78"],
			activity: ["activity", "78"],
			checks: ["checks", "78"],
			comment: ["comment", "78", "--text", "Ready"],
			"inline-comment": ["inline-comment", "78", "--path", "src/app.ts", "--line", "42", "--text", "Question"],
			reply: ["reply", "78", "--comment-id", "123", "--text", "Fixed"],
			approve: ["approve", "78"],
			unapprove: ["unapprove", "78"],
			merge: ["merge", "78"],
			decline: ["decline", "78"],
			create: ["create", "--title", "Fix", "--source", "feat/fix", "--destination", "main"],
			branches: ["branches"],
			repo: ["repo"],
		};
		const fetcher: FetchLike = async (input) => {
			if (String(input).endsWith("swagger.json")) return Response.json(openApiFixture);
			if (String(input).endsWith("/diff")) return new Response("diff --git a/a b/a", { headers: { "content-type": "text/plain" } });
			return Response.json({ ok: true });
		};
		for (const command of COMMANDS) {
			const run = harness(fetcher);
			const argv = examples[command.name];
			expect(argv).toBeDefined();
			if (!argv) throw new Error(`Missing runtime example for ${command.name}`);
			expect(await runCli(argv, run.dependencies)).toBe(0);
			expect(JSON.parse(run.stdout[0]).command).toBe(command.name);
		}
	});

	test("discovers bounded operations from Atlassian's OpenAPI contract without auth", async () => {
		const run = harness(async () => Response.json(openApiFixture));
		run.dependencies.environment = {};
		expect(await runCli(["operations", "--query", "create", "--limit", "1"], run.dependencies)).toBe(0);
		const result = JSON.parse(run.stdout[0]);
		expect(result.effect).toBe("read");
		expect(result.data.operations).toEqual([expect.objectContaining({ method: "POST", path: "/repositories/{workspace}/{repo_slug}/pullrequests" })]);
		expect(result.data.operations[0].consumes).toEqual(["application/json"]);
		expect(result.data.operations[0].produces).toEqual(["application/json"]);
	});

	test("paginates operations in stable method-path order", async () => {
		const first = harness(async () => Response.json(openApiFixture));
		first.dependencies.environment = {};
		expect(await runCli(["operations", "--query", "pullrequest", "--limit", "1"], first.dependencies)).toBe(0);
		const firstResult = JSON.parse(first.stdout[0]);
		expect(firstResult.data.operations[0].method).toBe("GET");
		expect(firstResult.data.next_cursor).toBe(1);
		expect(firstResult.data.next_invocation.argv).toEqual(["operations", "--query", "pullrequest", "--cursor", "1", "--limit", "1"]);

		const second = harness(async () => Response.json(openApiFixture));
		second.dependencies.environment = {};
		expect(await runCli(["operations", "--limit", "1", "--cursor", "1"], second.dependencies)).toBe(0);
		const secondResult = JSON.parse(second.stdout[0]);
		expect(secondResult.data.operations[0].method).toBe("POST");
		expect(secondResult.data.next_cursor).toBeNull();
	});

	test("rejects extra front-door arguments", async () => {
		for (const argv of [["commands", "--json", "trailing"], ["help", "merge", "trailing"], ["merge", "78", "--help"]]) {
			const run = harness();
			expect(await runCli(argv, run.dependencies)).toBe(2);
		}
	});

	test("reports a healthy semantic OpenAPI contract", async () => {
		const { exitCode, result } = await runOpenApiDoctor(openApiFixture);
		expect(exitCode).toBe(0);
		expect(result.status).toBe("ok");
		expect(result.data.health).toBe("healthy");
		expect(result.data.issue_draft).toBeNull();
		expect(result.data.owner_notification).toEqual({ status: "not_required", issue_url: null });
	});

	test("reports additive OpenAPI drift without raising an issue", async () => {
		const fixture = structuredClone(openApiFixture) as typeof openApiFixture & { paths: Record<string, unknown> };
		fixture.paths["/user"] = { get: { summary: "Get current user", responses: { "200": { description: "Success" } } } };
		const { exitCode, result } = await runOpenApiDoctor(fixture);
		expect(exitCode).toBe(0);
		expect(result.data.health).toBe("additive_drift");
		expect(result.data.drift.added_operations).toEqual(["GET /user"]);
		expect(result.data.issue_draft).toBeNull();
		expect(result.data.owner_notification.status).toBe("not_required");
	});

	test("keeps custom-baseline breaking drift local and untrusted", async () => {
		const fixture = structuredClone(openApiFixture);
		const pathItem: { post?: unknown } = fixture.paths["/repositories/{workspace}/{repo_slug}/pullrequests"];
		delete pathItem.post;
		const { exitCode, result } = await runOpenApiDoctor(fixture);
		expect(exitCode).toBe(3);
		expect(result.status).toBe("attention");
		expect(result.changed_state).toBe("none");
		expect(result.data.health).toBe("breaking_drift");
		expect(result.data.drift.removed_operations).toEqual(["POST /repositories/{workspace}/{repo_slug}/pullrequests"]);
		expect(result.data.issue_draft).toBeNull();
		expect(result.data.baseline_trust).toBe("custom_untrusted");
		expect(result.data.owner_notification).toEqual({ status: "not_sent", reason: "untrusted_baseline", issue_url: null });
		expect(result.remediation_class).toBe("untrusted_baseline");
		expect(result.exit_code).toBe(3);
	});

	test("builds a stable approval-gated draft from semantic breaking drift", () => {
		const baseline = buildOpenApiBaseline(openApiFixture);
		const firstLive = structuredClone(openApiFixture);
		const firstPath: { post?: unknown } = firstLive.paths["/repositories/{workspace}/{repo_slug}/pullrequests"];
		delete firstPath.post;
		const secondLive = structuredClone(firstLive) as typeof firstLive & { paths: Record<string, unknown> };
		secondLive.paths["/user"] = { get: { responses: { "200": { description: "ok" } } } };
		const first = analyzeOpenApiDrift(firstLive, baseline);
		const second = analyzeOpenApiDrift(secondLive, baseline);
		expect(first.issue_draft?.title).toContain("Bitbucket OpenAPI breaking drift");
		expect(first.issue_draft?.dedupe_key).toBe(second.issue_draft?.dedupe_key);
	});

	test("detects Atlassian auth-scope drift", () => {
		const baseline = buildOpenApiBaseline(openApiFixture);
		const live = structuredClone(openApiFixture);
		Object.assign(live.paths["/repositories/{workspace}/{repo_slug}/pullrequests"].get, {
			"x-atlassian-oauth2-scopes": [{ name: "repository:read", required: true }],
		});
		expect(analyzeOpenApiDrift(live, baseline).health).toBe("breaking_drift");
	});

	test("classifies a new optional parameter as additive", () => {
		const baseline = buildOpenApiBaseline(openApiFixture);
		const live = structuredClone(openApiFixture);
		live.paths["/repositories/{workspace}/{repo_slug}/pullrequests"].get.parameters.push({ name: "q", in: "query", required: false, type: "string" });
		const result = analyzeOpenApiDrift(live, baseline);
		expect(result.health).toBe("additive_drift");
		expect(result.drift.expanded_operations).toEqual(["GET /repositories/{workspace}/{repo_slug}/pullrequests"]);
	});

	test("ignores unreachable definitions and honors operation parameter overrides", () => {
		const baselineDocument = structuredClone(openApiFixture) as typeof openApiFixture & { definitions: Record<string, unknown> };
		baselineDocument.definitions = { Unused: { type: "string" } };
		const pathItem = baselineDocument.paths["/repositories/{workspace}/{repo_slug}/pullrequests"] as typeof baselineDocument.paths["/repositories/{workspace}/{repo_slug}/pullrequests"] & { parameters: unknown[] };
		const post: { post?: unknown } = pathItem;
		delete post.post;
		pathItem.parameters = [{ name: "q", in: "query", required: false, type: "string" }];
		pathItem.get.parameters.push({ name: "q", in: "query", required: false, type: "integer" });
		const live = structuredClone(baselineDocument);
		live.definitions.Unused = { type: "boolean" };
		const livePath = live.paths["/repositories/{workspace}/{repo_slug}/pullrequests"] as typeof pathItem;
		livePath.parameters[0] = { name: "q", in: "query", required: false, type: "boolean" };
		expect(analyzeOpenApiDrift(live, buildOpenApiBaseline(baselineDocument)).health).toBe("healthy");
	});

	test("bounds large drift evidence while preserving totals", () => {
		const manyPaths = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`/items/${index}`, { get: { responses: { "200": {} } } }]));
		const baseline = buildOpenApiBaseline({ swagger: "2.0", basePath: "/2.0", paths: manyPaths });
		const result = analyzeOpenApiDrift({ swagger: "2.0", basePath: "/2.0", paths: {} }, baseline);
		expect(result.drift.removed_operations).toHaveLength(50);
		expect(result.drift.totals.removed_operations).toBe(100);
		expect(result.drift.truncated).toBe(true);
		expect(result.issue_draft?.body).toContain("80 more omitted");
	});

	test("resolves shared parameters into effective operation semantics", () => {
		const baselineDocument = {
			swagger: "2.0",
			basePath: "/2.0",
			parameters: { Q: { name: "q", in: "query", required: false, type: "string" } },
			paths: { "/x": { get: { parameters: [{ $ref: "#/parameters/Q" }], responses: { "200": {} } } } },
		};
		const baseline = buildOpenApiBaseline(baselineDocument);
		const tightened = structuredClone(baselineDocument);
		tightened.parameters.Q.required = true;
		expect(analyzeOpenApiDrift(tightened, baseline).health).toBe("breaking_drift");

		const inline = structuredClone(baselineDocument) as Omit<typeof baselineDocument, "parameters"> & { parameters?: typeof baselineDocument.parameters };
		delete inline.parameters;
		inline.paths["/x"].get.parameters = [{ name: "q", in: "query", required: false, type: "string" }] as unknown as [{ $ref: string }];
		expect(analyzeOpenApiDrift(inline, baseline).health).toBe("healthy");
	});

	test("treats definition and shared-response refs like equivalent inline shapes", () => {
		const baselineDocument = {
			swagger: "2.0",
			basePath: "/2.0",
			definitions: { Pet: { type: "object", properties: { name: { type: "string" } } } },
			responses: { PetResponse: { schema: { $ref: "#/definitions/Pet" } } },
			paths: { "/x": { get: { responses: { "200": { $ref: "#/responses/PetResponse" } } } } },
		};
		const baseline = buildOpenApiBaseline(baselineDocument);
		const inline = {
			swagger: "2.0",
			basePath: "/2.0",
			paths: { "/x": { get: { responses: { "200": { schema: { type: "object", properties: { name: { type: "string" } } } } } } } },
		};
		expect(analyzeOpenApiDrift(inline, baseline).health).toBe("healthy");
	});

	test("keeps breaking dedupe stable across unrelated accepted baseline additions", () => {
		const basePaths = { "/gone": { post: { responses: { "200": {} } } }, "/keep": { get: { responses: { "200": {} } } } };
		const maintainedPaths = { ...basePaths, "/accepted": { get: { responses: { "200": {} } } } };
		const first = analyzeOpenApiDrift(
			{ swagger: "2.0", basePath: "/2.0", paths: { "/keep": basePaths["/keep"] } },
			buildOpenApiBaseline({ swagger: "2.0", basePath: "/2.0", paths: basePaths }),
		);
		const second = analyzeOpenApiDrift(
			{ swagger: "2.0", basePath: "/2.0", paths: { "/keep": basePaths["/keep"], "/accepted": maintainedPaths["/accepted"] } },
			buildOpenApiBaseline({ swagger: "2.0", basePath: "/2.0", paths: maintainedPaths }),
		);
		expect(first.issue_draft?.dedupe_key).toBe(second.issue_draft?.dedupe_key);
	});

	test("preserves the prior baseline when atomic replacement fails", async () => {
		const directory = mkdtempSync(join(tmpdir(), "bb-pr-baseline-write-"));
		const output = join(directory, "baseline.json");
		const temporary = join(directory, "baseline.pending.json");
		writeFileSync(output, "prior baseline");
		await expect(writeBaselineAtomically(output, "{\"next\":true}\n", {
			temporaryPath: temporary,
			renameFile: async () => { throw new Error("rename interrupted"); },
		})).rejects.toThrow("rename interrupted");
		expect(readFileSync(output, "utf8")).toBe("prior baseline");
		expect(existsSync(temporary)).toBe(false);
	});

	test("ignores documentation-only OpenAPI changes", async () => {
		const fixture = structuredClone(openApiFixture);
		fixture.paths["/repositories/{workspace}/{repo_slug}/pullrequests"].get.summary = "A rewritten summary";
		fixture.paths["/repositories/{workspace}/{repo_slug}/pullrequests"].get.responses["200"].description = "Rewritten documentation";
		const { exitCode, result } = await runOpenApiDoctor(fixture);
		expect(exitCode).toBe(0);
		expect(result.data.health).toBe("healthy");
	});

	test("calls an arbitrary read path without repository detection", async () => {
		const requests: string[] = [];
		const run = harness(async (input) => {
			requests.push(String(input));
			return Response.json({ display_name: "Agent" });
		});
		delete run.dependencies.environment.BB_WORKSPACE;
		delete run.dependencies.environment.BB_REPO_SLUG;
		expect(await runCli(["api", "/user"], run.dependencies)).toBe(0);
		expect(requests).toEqual(["https://api.bitbucket.org/2.0/user"]);
		expect(JSON.parse(run.stdout[0]).data.display_name).toBe("Agent");
	});

	test("previews arbitrary non-read methods without network access", async () => {
		let calls = 0;
		const run = harness(async () => {
			calls += 1;
			return Response.json({});
		});
		expect(await runCli(["api", "/repositories/workspace/repo", "--method", "PATCH", "--body-json", "{\"description\":\"Updated\"}"], run.dependencies)).toBe(0);
		const result = JSON.parse(run.stdout[0]);
		expect(result.effect).toBe("write");
		expect(result.changed_state).toBe("preview");
		expect(result.data.request.body).toEqual(expect.objectContaining({ source: "inline_json", redacted: { description: "Updated" } }));
		expect(result.data.request.body.sha256).toHaveLength(64);
		expect(calls).toBe(0);
	});

	test("redacts secured generic bodies and binds execution to the preview digest", async () => {
		const body = "{\"secured\":true,\"value\":\"super-secret\",\"token\":\"plain-token\"}";
		const preview = harness();
		expect(await runCli(["api", "/pipelines_config/variables", "--method", "POST", "--body-json", body], preview.dependencies)).toBe(0);
		const request = JSON.parse(preview.stdout[0]).data.request;
		expect(request.body.redacted).toEqual({ secured: true, value: "[REDACTED]", token: "[REDACTED]" });
		expect(preview.stdout[0]).not.toContain("super-secret");
		expect(preview.stdout[0]).not.toContain("plain-token");

		const missingDigest = harness();
		expect(await runCli(["api", "/pipelines_config/variables", "--method", "POST", "--body-json", body, "--execute"], missingDigest.dependencies)).toBe(2);
		const execute = harness(async () => Response.json({ ok: true }));
		expect(await runCli(["api", "/pipelines_config/variables", "--method", "POST", "--body-json", body, "--body-sha256", request.body.sha256, "--execute"], execute.dependencies)).toBe(0);
	});

	test("rejects generic API host escapes and auth header overrides", async () => {
		const urlRun = harness();
		expect(await runCli(["api", "https://example.com/steal"], urlRun.dependencies)).toBe(2);
		expect(JSON.parse(urlRun.stderr[0]).error.code).toBe("usage_error");

		const headerRun = harness();
		expect(await runCli(["api", "/user", "--headers-json", "{\"Authorization\":\"Bearer other\"}"], headerRun.dependencies)).toBe(2);
		expect(JSON.parse(headerRun.stderr[0]).error.code).toBe("usage_error");

		for (const name of ["Cookie", "Proxy-Authorization", "X-API-Key", "X-Access-Token"]) {
			const credentialRun = harness();
			expect(await runCli(["api", "/user", "--headers-json", JSON.stringify({ [name]: "sensitive-value" })], credentialRun.dependencies)).toBe(2);
			expect(credentialRun.stderr[0]).not.toContain("sensitive-value");
		}
	});

	test("hashes allowed custom-header values in write previews", async () => {
		const run = harness();
		expect(await runCli(["api", "/x", "--method", "POST", "--headers-json", "{\"X-Correlation\":\"private-correlation\"}"], run.dependencies)).toBe(0);
		const result = JSON.parse(run.stdout[0]);
		expect(result.data.request.headers["X-Correlation"]).toStartWith("sha256:");
		expect(run.stdout[0]).not.toContain("private-correlation");
	});

	test("binds file-body execution to the approved SHA-256 digest", async () => {
		const directory = mkdtempSync(join(tmpdir(), "bb-pr-body-"));
		const path = join(directory, "body.bin");
		writeFileSync(path, "approved bytes");
		const preview = harness();
		expect(await runCli(["api", "/x", "--method", "POST", "--body-file", path], preview.dependencies)).toBe(0);
		const digest = JSON.parse(preview.stdout[0]).data.request.body.sha256;

		const execute = harness(async () => Response.json({ ok: true }));
		expect(await runCli(["api", "/x", "--method", "POST", "--body-file", path, "--body-sha256", digest, "--execute"], execute.dependencies)).toBe(0);
		writeFileSync(path, "changed bytes");
		const mismatch = harness();
		expect(await runCli(["api", "/x", "--method", "POST", "--body-file", path, "--body-sha256", digest, "--execute"], mismatch.dependencies)).toBe(2);
		expect(JSON.parse(mismatch.stderr[0]).error.message).toContain("does not match");
	});

	test("runs a read with JSON evidence and no credential leakage", async () => {
		const requests: string[] = [];
		const fetcher: FetchLike = async (input) => {
			requests.push(String(input));
			return Response.json({ values: [{ id: 78, title: "Release" }] });
		};
		const run = harness(fetcher);
		expect(await runCli(["list", "--limit", "10"], run.dependencies)).toBe(0);
		const result = JSON.parse(run.stdout[0]);
		expect(result.changed_state).toBe("none");
		expect(String(requests[0])).toContain("pullrequests?state=OPEN&pagelen=10");
		expect(run.stdout[0]).not.toContain("secret-not-printed");
	});

	test("redacts secret-shaped fields from API responses", async () => {
		const run = harness(async () => Response.json({ public_key: "safe", private_key: "private-material", nested: { access_token: "token-material" }, secured: true, value: "pipeline-secret", token: "plain-token" }));
		expect(await runCli(["api", "/repositories/workspace/repo/pipelines_config/ssh/key_pair"], run.dependencies)).toBe(0);
		const result = JSON.parse(run.stdout[0]);
		expect(result.data.public_key).toBe("safe");
		expect(result.data.private_key).toBe("[REDACTED]");
		expect(result.data.nested.access_token).toBe("[REDACTED]");
		expect(result.data.value).toBe("[REDACTED]");
		expect(result.data.token).toBe("[REDACTED]");
		expect(run.stdout[0]).not.toContain("private-material");
	});

	test("previews writes without making a request", async () => {
		let calls = 0;
		const fetcher: FetchLike = async () => {
			calls += 1;
			return Response.json({});
		};
		const run = harness(fetcher);
		expect(await runCli(["comment", "78", "--text", "Ready"], run.dependencies)).toBe(0);
		const result = JSON.parse(run.stdout[0]);
		expect(result.changed_state).toBe("preview");
		expect(calls).toBe(0);
	});

	test("executes an explicitly approved comment", async () => {
		const requests: RequestInit[] = [];
		const fetcher: FetchLike = async (_input, init) => {
			requests.push(init ?? {});
			return Response.json({ id: 123 }, { status: 201 });
		};
		const run = harness(fetcher);
		expect(await runCli(["comment", "78", "--text", "Ready", "--execute"], run.dependencies)).toBe(0);
		const result = JSON.parse(run.stdout[0]);
		expect(result.changed_state).toBe("complete");
		expect(requests[0].method).toBe("POST");
		expect(requests[0].body).toBe(JSON.stringify({ content: { raw: "Ready" } }));
	});

	test("fails closed when credentials are missing", async () => {
		const run = harness();
		run.dependencies.environment = { BB_WORKSPACE: "workspace", BB_REPO_SLUG: "repo" };
		expect(await runCli(["status"], run.dependencies)).toBe(1);
		const result = JSON.parse(run.stderr[0]);
		expect(result.error.code).toBe("auth_missing");
		expect(result.retry_safety).toBe("same_input_safe");
		expect(result.exit_code).toBe(1);
	});

	test("accepts the existing token aliases", async () => {
		const run = harness(async () => Response.json({ full_name: "workspace/repo" }));
		run.dependencies.environment = {
			BITBUCKET_USER: "agent@example.test",
			BB_TOKEN: "existing-token",
			BB_WORKSPACE: "workspace",
			BB_REPO_SLUG: "repo",
		};
		expect(await runCli(["status"], run.dependencies)).toBe(0);
		expect(run.stdout[0]).not.toContain("existing-token");
	});

	test("accepts a token-only Bearer credential mode", async () => {
		let authorization = "";
		const run = harness(async (_input, init) => {
			authorization = new Headers(init?.headers).get("Authorization") ?? "";
			return Response.json({ ok: true });
		});
		run.dependencies.environment = { BITBUCKET_ACCESS_TOKEN: "bearer-secret" };
		expect(await runCli(["api", "/user"], run.dependencies)).toBe(0);
		expect(authorization).toBe("Bearer bearer-secret");
		expect(run.stdout[0]).not.toContain("bearer-secret");
	});

	test("fails closed when multiple credential modes are present", async () => {
		const run = harness();
		run.dependencies.environment.BITBUCKET_ACCESS_TOKEN = "bearer-secret";
		expect(await runCli(["api", "/user"], run.dependencies)).toBe(1);
		expect(JSON.parse(run.stderr[0]).error.code).toBe("auth_ambiguous");
	});

	test("reports unknown commands through stderr and usage exit", async () => {
		const run = harness();
		expect(await runCli(["ship"], run.dependencies)).toBe(2);
		const result = JSON.parse(run.stderr[0]);
		expect(result.error.code).toBe("unknown_command");
	});

	test("keeps merge preview source branches open by default", async () => {
		const run = harness();
		expect(await runCli(["merge", "78", "--strategy", "squash"], run.dependencies)).toBe(0);
		const result = JSON.parse(run.stdout[0]);
		expect(result.data.request.body.close_source_branch).toBe(false);
	});

	test("bounds diff output and reports truncation", async () => {
		const fetcher: FetchLike = async () => new Response("x".repeat(1500), { headers: { "content-type": "text/plain" } });
		const run = harness(fetcher);
		expect(await runCli(["diff", "78", "--max-chars", "1000"], run.dependencies)).toBe(0);
		const result = JSON.parse(run.stdout[0]);
		expect(result.data.truncated).toBe(true);
		expect(result.data.content).toHaveLength(1000);
		expect(result.data.original_characters).toBe(1500);
	});

	test("rejects unknown flags before auth or network work", async () => {
		const run = harness();
		expect(await runCli(["view", "78", "--surprise"], run.dependencies)).toBe(2);
		expect(JSON.parse(run.stderr[0]).error.code).toBe("usage_error");
	});

	test("rejects out-of-contract flags, duplicate flags, and positionals from the catalog", async () => {
		const candidateFlags = ["--execute", "--baseline-file", "--query", "--title"];
		for (const command of COMMANDS) {
			const unsupported = candidateFlags.find((flag) => !command.flags.includes(flag));
			expect(unsupported).toBeDefined();
			const unsupportedRun = harness();
			const unsupportedArgv = unsupported === "--execute" ? [command.name, unsupported] : [command.name, unsupported as string, "value"];
			expect(await runCli(unsupportedArgv, unsupportedRun.dependencies)).toBe(2);

			const positionalRun = harness();
			expect(await runCli([command.name, ...Array.from({ length: command.positionals.maximum + 1 }, () => "extra")], positionalRun.dependencies)).toBe(2);
		}
		const duplicate = harness();
		expect(await runCli(["operations", "--limit", "1", "--limit", "2"], duplicate.dependencies)).toBe(2);
	});

	test("maps Bitbucket permission errors to a repairable JSON failure", async () => {
		const run = harness(async () => Response.json({ error: { message: "Scope missing" } }, { status: 403 }));
		expect(await runCli(["view", "78"], run.dependencies)).toBe(1);
		const result = JSON.parse(run.stderr[0]);
		expect(result.error).toEqual({ code: "permission_denied", message: "Bitbucket API 403: request rejected" });
		expect(run.stderr[0]).not.toContain("Scope missing");
		expect(result.next_safe_action).toContain("API-token scopes");
	});

	test("routes unexpected API compatibility failures to the OpenAPI doctor", async () => {
		const run = harness(async () => Response.json({ error: { message: "Route missing" } }, { status: 404 }));
		expect(await runCli(["api", "/repositories/workspace/repo/unknown"], run.dependencies)).toBe(1);
		const result = JSON.parse(run.stderr[0]);
		expect(result.error.code).toBe("not_found");
		expect(result.next_safe_action).toContain("bb-pr doctor openapi");
	});

	test("preserves HTTP classification for malformed JSON and write retry safety", async () => {
		const malformed = harness(async () => new Response("{broken", { status: 404, headers: { "content-type": "application/json" } }));
		expect(await runCli(["api", "/missing"], malformed.dependencies)).toBe(1);
		expect(JSON.parse(malformed.stderr[0]).error.code).toBe("not_found");

		await expectExecutedGenericWriteRetrySafety(async () => new Response("{broken", { status: 422, headers: { "content-type": "application/json" } }));
	});

	test("rejects malformed JSON on a successful API response", async () => {
		const run = harness(async () => new Response("{broken", { status: 200, headers: { "content-type": "application/json" } }));
		expect(await runCli(["api", "/user"], run.dependencies)).toBe(1);
		const result = JSON.parse(run.stderr[0]);
		expect(result.error.code).toBe("invalid_api_response");
		expect(result.retry_safety).toBe("same_input_safe");
	});

	test("bounds Retry-After guidance and retry attempts", async () => {
		const cases: Array<[string | null, (seconds: number) => boolean]> = [
			[null, (seconds) => seconds === 30],
			["12", (seconds) => seconds === 12],
			["9999", (seconds) => seconds === 300],
			["invalid", (seconds) => seconds === 30],
			[new Date(Date.now() + 60_000).toUTCString(), (seconds) => seconds >= 59 && seconds <= 60],
		];
		for (const [retryAfter, accepts] of cases) {
			const run = harness(async () => new Response("", { status: 429, headers: retryAfter ? { "retry-after": retryAfter } : {} }));
			expect(await runCli(["api", "/user"], run.dependencies)).toBe(1);
			const result = JSON.parse(run.stderr[0]);
			expect(result.error.code).toBe("rate_limited");
			expect(accepts(result.retry_after_seconds)).toBe(true);
			expect(result.maximum_attempts).toBe(1);
		}
		await expectExecutedGenericWriteRetrySafety(async () => new Response("", { status: 429, headers: { "retry-after": "12" } }));
	});

	test("classifies response-stream failures by write effect", async () => {
		const brokenResponse = () => new Response(new ReadableStream({ start(controller) { controller.error(new Error("stream interrupted")); } }));
		const read = harness(async () => brokenResponse());
		expect(await runCli(["api", "/user"], read.dependencies)).toBe(1);
		expect(JSON.parse(read.stderr[0]).retry_safety).toBe("same_input_safe");
		await expectExecutedGenericWriteRetrySafety(async () => brokenResponse());
	});

	test("treats an interrupted executed write as unknown", async () => {
		const run = harness(async () => { throw new Error("connection closed"); });
		expect(await runCli(["comment", "78", "--text", "Ready", "--execute"], run.dependencies)).toBe(1);
		const result = JSON.parse(run.stderr[0]);
		expect(result.error.code).toBe("network_failure");
		expect(result.retry_safety).toBe("inspect_before_retry");
		expect(result.next_safe_action).toContain("Inspect the pull request");
	});

	test("validates bounded command options before making a request", async () => {
		const run = harness();
		expect(await runCli(["list", "--state", "UNKNOWN"], run.dependencies)).toBe(2);
		expect(JSON.parse(run.stderr[0]).error.code).toBe("usage_error");
	});

	test("versions runtime envelopes and honors the documented list default", async () => {
		const requests: string[] = [];
		const run = harness(async (input) => {
			requests.push(String(input));
			return Response.json({ values: [] });
		});
		expect(await runCli(["list"], run.dependencies)).toBe(0);
		const result = JSON.parse(run.stdout[0]);
		expect(result).toEqual(expect.objectContaining({ contract_id: "bb-pr.result", schema_version: "1", exit_code: 0 }));
		expect(requests[0]).toContain("pagelen=25");
		const error = harness();
		expect(await runCli(["ship"], error.dependencies)).toBe(2);
		expect(JSON.parse(error.stderr[0])).toEqual(expect.objectContaining({ contract_id: "bb-pr.result", schema_version: "1", exit_code: 2 }));
	});
});
