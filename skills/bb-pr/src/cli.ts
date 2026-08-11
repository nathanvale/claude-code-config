#!/usr/bin/env bun

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { COMMANDS, findCommand, renderHelp, type CommandDefinition } from "./command-contract";
import { resolveRepository, type BitbucketRepository } from "./git-remote";
import { analyzeOpenApiDrift, BITBUCKET_OPENAPI_URL, type OpenApiBaseline, type OpenApiDriftAnalysis } from "./openapi-drift";

const API_BASE_URL = "https://api.bitbucket.org/2.0";
const DEFAULT_OPENAPI_BASELINE = fileURLToPath(new URL("../openapi-baseline.json", import.meta.url));
const ENVELOPE_CONTRACT_ID = "bb-pr.result";
const ENVELOPE_SCHEMA_VERSION = "1";
const VALID_STATES = ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"] as const;
const VALID_STRATEGIES = ["squash", "merge_commit", "fast_forward"] as const;
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]);

type RetrySafety = "same_input_safe" | "same_input_unsafe" | "inspect_before_retry";

interface CliIo {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
}

type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

interface CliDependencies {
	fetcher: FetchLike;
	environment: Record<string, string | undefined>;
	cwd: string;
	io: CliIo;
	runId: string;
}

interface ParsedInput {
	command: CommandDefinition;
	positionals: string[];
	flags: Map<string, string | true>;
	repositoryOverride: { workspace?: string; repo?: string };
}

interface ApiRequest {
	path: string;
	method?: string;
	body?: unknown;
	accept?: string;
	contentType?: string;
	headers?: Record<string, string>;
	previewBody?: unknown;
}

interface RequestContext {
	input: ParsedInput;
	base: string;
	id: () => number;
	limit: () => number;
}

type RequestBuilder = (context: RequestContext) => ApiRequest;

interface CommandResult {
	changed_state: "none" | "preview" | "complete";
	data: unknown;
	next_safe_action: string;
	retry_safety: RetrySafety;
	effect: "read" | "write";
	status?: "ok" | "attention";
	exitCode?: number;
	remediationClass?: "none" | "maintenance_review" | "approval_required" | "untrusted_baseline";
}

class CliError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly nextSafeAction: string,
		readonly retrySafety: RetrySafety = "same_input_safe",
		readonly retryAfterSeconds?: number,
		readonly maximumAttempts?: number,
	) {
		super(message);
	}
}

/** Run the public bb-pr CLI with injectable boundaries for focused proof. */
export async function runCli(
	argv: string[],
	overrides: Partial<CliDependencies> = {},
): Promise<number> {
	const dependencies: CliDependencies = {
		fetcher: overrides.fetcher ?? fetch,
		environment: overrides.environment ?? process.env,
		cwd: overrides.cwd ?? process.cwd(),
		io: overrides.io ?? {
			stdout: (text) => console.log(text),
			stderr: (text) => console.error(text),
		},
		runId: overrides.runId ?? randomUUID(),
	};

	try {
		const frontDoor = handleFrontDoor(argv, dependencies.io);
		if (frontDoor !== null) return frontDoor;

		const input = parseInput(argv);
		if (input.command.name === "doctor") {
			const response = await diagnoseOpenApi(input, dependencies);
			dependencies.io.stdout(JSON.stringify(successEnvelope(dependencies.runId, input.command, BITBUCKET_OPENAPI_URL, response)));
			return response.exitCode ?? 0;
		}
		if (input.command.name === "operations") {
			const response = await discoverOperations(input, dependencies);
			dependencies.io.stdout(JSON.stringify(successEnvelope(dependencies.runId, input.command, BITBUCKET_OPENAPI_URL, response)));
			return 0;
		}

		const authHeader = resolveAuthHeader(dependencies.environment);
		if (input.command.name === "api") {
			const response = await executeCommand(input, undefined, authHeader, dependencies);
			const target = `${API_BASE_URL}${normalizeApiPath(input.positionals[0])}`;
			dependencies.io.stdout(JSON.stringify(successEnvelope(dependencies.runId, input.command, target, response)));
			return 0;
		}

		const repository = await resolveRepository({
			...input.repositoryOverride,
			environment: dependencies.environment,
			cwd: dependencies.cwd,
		}).catch((error: unknown) => {
			throw new CliError(
				"repository_unresolved",
				error instanceof Error ? error.message : String(error),
				"Run inside the intended Bitbucket clone, or pass --workspace and --repo together.",
			);
		});
		const response = await executeCommand(input, repository, authHeader, dependencies);
		dependencies.io.stdout(JSON.stringify(successEnvelope(dependencies.runId, input.command, `${repository.workspace}/${repository.repo}`, response)));
		return 0;
	} catch (error: unknown) {
		const cliError = normalizeError(error);
		const exitCode = cliError.code === "usage_error" || cliError.code === "unknown_command" ? 2 : 1;
		dependencies.io.stderr(JSON.stringify({
			contract_id: ENVELOPE_CONTRACT_ID,
			schema_version: ENVELOPE_SCHEMA_VERSION,
			status: "error",
			run_id: dependencies.runId,
			error: { code: cliError.code, message: cliError.message },
			retry_safety: cliError.retrySafety,
			next_safe_action: cliError.nextSafeAction,
			exit_code: exitCode,
			...(cliError.retryAfterSeconds === undefined ? {} : { retry_after_seconds: cliError.retryAfterSeconds }),
			...(cliError.maximumAttempts === undefined ? {} : { maximum_attempts: cliError.maximumAttempts }),
		}));
		return exitCode;
	}
}

function handleFrontDoor(argv: string[], io: CliIo): number | null {
	if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
		io.stdout(renderHelp());
		return 0;
	}
	if (argv[0] === "help") {
		if (argv.length > 2) {
			io.stderr("Usage: bb-pr help [command]");
			return 2;
		}
		const command = argv[1];
		if (command && !findCommand(command)) {
			io.stderr(renderHelp(command));
			return 2;
		}
		io.stdout(renderHelp(command));
		return 0;
	}
	if (argv[0] === "commands") {
		if (argv.length !== 2 || argv[1] !== "--json") {
			io.stderr("Usage: bb-pr commands --json");
			return 2;
		}
		io.stdout(JSON.stringify({
			contract_id: "bb-pr.commands",
			schema_version: "1",
			commands: COMMANDS,
		}));
		return 0;
	}
	if (argv.includes("--help") || argv.includes("-h")) {
		const command = argv[0];
		if (argv.length !== 2) {
			io.stderr(`Usage: bb-pr ${command} --help`);
			return 2;
		}
		if (!findCommand(command)) {
			io.stderr(renderHelp(command));
			return 2;
		}
		io.stdout(renderHelp(command));
		return 0;
	}
	return null;
}

function parseInput(argv: string[]): ParsedInput {
	const command = findCommand(argv[0]);
	if (!command) throw new CliError("unknown_command", `Unknown command: ${argv[0]}`, "Run bb-pr --help or bb-pr commands --json.");
	const positionals: string[] = [];
	const flags = new Map<string, string | true>();
	const valueFlags = new Set([
		"--state", "--limit", "--max-chars", "--text", "--path", "--line",
		"--comment-id", "--strategy", "--title", "--source", "--destination",
		"--description", "--workspace", "--repo", "--query", "--method",
		"--body-json", "--body", "--body-file", "--headers-json", "--accept",
		"--content-type", "--baseline-file", "--cursor", "--body-sha256",
	]);
	const booleanFlags = new Set(["--execute", "--close-source-branch"]);

	for (let index = 1; index < argv.length; index += 1) {
		const token = argv[index];
		if (valueFlags.has(token)) {
			if (!command.flags.includes(token)) throw usage(`Flag ${token} is not supported by ${command.name}.`);
			if (flags.has(token)) throw usage(`Flag ${token} cannot be repeated.`);
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) throw usage(`Flag ${token} requires a value.`);
			flags.set(token, value);
			index += 1;
			continue;
		}
		if (booleanFlags.has(token)) {
			if (!command.flags.includes(token)) throw usage(`Flag ${token} is not supported by ${command.name}.`);
			if (flags.has(token)) throw usage(`Flag ${token} cannot be repeated.`);
			flags.set(token, true);
			continue;
		}
		if (token.startsWith("--")) throw usage(`Unknown flag: ${token}`);
		positionals.push(token);
	}
	if (positionals.length < command.positionals.minimum || positionals.length > command.positionals.maximum) {
		throw usage(`Command ${command.name} accepts ${describePositionalCount(command.positionals.minimum, command.positionals.maximum)}.`);
	}

	return {
		command,
		positionals,
		flags,
		repositoryOverride: {
			workspace: stringFlag(flags, "--workspace"),
			repo: stringFlag(flags, "--repo"),
		},
	};
}

function describePositionalCount(minimum: number, maximum: number): string {
	if (minimum === maximum) return `${minimum} positional argument${minimum === 1 ? "" : "s"}`;
	return `${minimum} through ${maximum} positional arguments`;
}

function resolveAuthHeader(environment: Record<string, string | undefined>): string {
	const email = environment.BITBUCKET_EMAIL ?? environment.BITBUCKET_USER ?? environment.BB_USERNAME;
	const token = environment.BITBUCKET_API_TOKEN ?? environment.BITBUCKET_TOKEN ?? environment.BB_TOKEN;
	const accessToken = environment.BITBUCKET_ACCESS_TOKEN ?? environment.BB_ACCESS_TOKEN;
	const jwt = environment.BITBUCKET_JWT ?? environment.BB_JWT;
	const modes = [token, accessToken, jwt].filter((value) => Boolean(value));
	if (modes.length > 1) {
		throw new CliError(
			"auth_ambiguous",
			"Multiple Bitbucket credential modes are present.",
			"Invoke bb-pr with exactly one credential mode: API token, access token, or JWT.",
		);
	}
	if (accessToken) return `Bearer ${accessToken}`;
	if (jwt) return `JWT ${jwt}`;
	if (!email || !token) {
		throw new CliError(
			"auth_missing",
			"Bitbucket credentials are required.",
			"Invoke bb-pr through the credential wrapper you already use. Run bb-pr --help for accepted variable names.",
		);
	}
	return `Basic ${btoa(`${email}:${token}`)}`;
}

async function executeCommand(
	input: ParsedInput,
	repository: BitbucketRepository | undefined,
	authHeader: string,
	dependencies: CliDependencies,
): Promise<CommandResult> {
	const request = buildRequest(input, repository);
	const effect = resolveEffect(input);
	const execute = input.flags.has("--execute");
	if (effect === "write" && !execute) {
		return {
			changed_state: "preview",
			data: { target: `${API_BASE_URL}${request.path}`, command: input.command.name, request: sanitizePreview(request) },
			next_safe_action: "Obtain explicit approval for this exact preview, then rerun with --execute.",
			retry_safety: "same_input_safe",
			effect,
		};
	}

	let data = await callApi(request, authHeader, dependencies.fetcher, effect);
	data = redactSensitiveValues(data);
	if ((input.command.name === "diff" || input.command.name === "api") && typeof data === "string") {
		const maximumCharacters = boundedInteger(stringFlag(input.flags, "--max-chars") ?? "50000", "max chars", 1000, 500000);
		data = {
			format: input.command.name === "diff" ? "diff" : "text",
			content: data.slice(0, maximumCharacters),
			truncated: data.length > maximumCharacters,
			original_characters: data.length,
		};
	}
	return {
		changed_state: effect === "write" ? "complete" : "none",
		data,
		next_safe_action: effect === "write" ? "Inspect the affected Bitbucket resource and confirm the intended state." : nextReadAction(input.command.name),
		retry_safety: effect === "write" ? "same_input_unsafe" : "same_input_safe",
		effect,
	};
}

function buildRequest(input: ParsedInput, repository: BitbucketRepository | undefined): ApiRequest {
	if (input.command.name === "api") return buildGenericApiRequest(input);
	if (!repository) throw new CliError("repository_unresolved", "This command requires repository coordinates.", "Run inside the intended Bitbucket clone, or pass --workspace and --repo together.");
	const base = `/repositories/${encodeURIComponent(repository.workspace)}/${encodeURIComponent(repository.repo)}`;
	const id = () => requirePositiveInteger(input.positionals[0], "pull-request id");
	const limit = () => boundedInteger(stringFlag(input.flags, "--limit") ?? "50", "limit", 1, 100);
	const builder = REQUEST_BUILDERS[input.command.name];
	if (!builder) {
		throw new CliError("unknown_command", `No runtime handler for ${input.command.name}.`, "Run bb-pr commands --json and report command drift.");
	}
	return builder({ input, base, id, limit });
}

function buildGenericApiRequest(input: ParsedInput): ApiRequest {
	const path = normalizeApiPath(input.positionals[0]);
	const method = (stringFlag(input.flags, "--method") ?? "GET").toUpperCase();
	if (!HTTP_METHODS.has(method)) throw usage(`Method must be one of: ${[...HTTP_METHODS].join(", ")}.`);

	const bodyFlags = ["--body-json", "--body", "--body-file"].filter((name) => input.flags.has(name));
	if (bodyFlags.length > 1) throw usage("Use only one of --body-json, --body, or --body-file.");

	let body: unknown;
	let previewBody: unknown;
	let contentType = stringFlag(input.flags, "--content-type");
	const jsonBody = stringFlag(input.flags, "--body-json");
	const textBody = stringFlag(input.flags, "--body");
	const bodyFile = stringFlag(input.flags, "--body-file");
	if (jsonBody) {
		try {
			body = JSON.parse(jsonBody);
		} catch {
			throw usage("--body-json must contain valid JSON.");
		}
		previewBody = { source: "inline_json", redacted: redactSensitiveValues(body) };
		contentType ??= "application/json";
	} else if (textBody !== undefined) {
		body = textBody;
		previewBody = { source: "inline_text" };
		contentType ??= "text/plain";
	} else if (bodyFile) {
		if (!existsSync(bodyFile)) throw usage(`Body file does not exist: ${bodyFile}`);
		const file = Bun.file(bodyFile);
		const bytes = readFileSync(bodyFile);
		const digest = createHash("sha256").update(bytes).digest("hex");
		body = bytes;
		previewBody = { source: "file", path: bodyFile, bytes: file.size };
		contentType ??= file.type || "application/octet-stream";
	}
	const approvedDigest = stringFlag(input.flags, "--body-sha256");
	if (body === undefined && approvedDigest) throw usage("--body-sha256 is valid only when a request body is present.");
	if (body !== undefined) {
		const digest = requestBodyDigest(body);
		previewBody = { ...(previewBody as Record<string, unknown>), sha256: digest };
		if (input.flags.has("--execute") && !approvedDigest) throw usage("Generic body execution requires --body-sha256 from the approved preview.");
		if (approvedDigest && approvedDigest.toLowerCase() !== digest) throw usage("--body-sha256 does not match the current request-body bytes.");
	}

	return {
		path,
		method,
		body,
		previewBody,
		accept: stringFlag(input.flags, "--accept"),
		contentType,
		headers: parseHeaders(input.flags),
	};
}

function normalizeApiPath(value: string | undefined): string {
	if (!value) throw usage("Missing Bitbucket API path.");
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith("//") || value.includes("\\")) throw usage("Pass a relative Bitbucket REST v2 path, not a URL.");
	const path = value.startsWith("/") ? value : `/${value}`;
	const pathname = path.split("?", 1)[0];
	if (pathname.split("/").some((segment) => segment === ".." || decodeURIComponentSafe(segment) === "..")) throw usage("API paths cannot traverse parent segments.");
	return path;
}

function decodeURIComponentSafe(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		throw usage("API path contains invalid percent encoding.");
	}
}

function parseHeaders(flags: Map<string, string | true>): Record<string, string> | undefined {
	const raw = stringFlag(flags, "--headers-json");
	if (!raw) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw usage("--headers-json must contain a JSON object.");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw usage("--headers-json must contain a JSON object.");
	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(parsed)) {
		if (isCredentialHeader(name) || ["host", "content-length"].includes(name.toLowerCase())) throw usage(`Header cannot be overridden: ${name}`);
		if (typeof value !== "string") throw usage(`Header value must be a string: ${name}`);
		headers[name] = value;
	}
	return headers;
}

function resolveEffect(input: ParsedInput): "read" | "write" {
	if (input.command.effect !== "dynamic") return input.command.effect;
	const method = (stringFlag(input.flags, "--method") ?? "GET").toUpperCase();
	return READ_METHODS.has(method) ? "read" : "write";
}

async function diagnoseOpenApi(input: ParsedInput, dependencies: CliDependencies): Promise<CommandResult> {
	if (input.positionals.length !== 1 || input.positionals[0] !== "openapi") throw usage("Doctor target must be: openapi.");
	const baselinePath = stringFlag(input.flags, "--baseline-file") ?? DEFAULT_OPENAPI_BASELINE;
	if (!existsSync(baselinePath)) {
		throw new CliError("openapi_baseline_missing", `OpenAPI baseline not found: ${baselinePath}`, "Restore the generated baseline from source control, then rerun the doctor.");
	}

	let baseline: OpenApiBaseline;
	try {
		baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as OpenApiBaseline;
	} catch (error: unknown) {
		throw new CliError("openapi_baseline_invalid", error instanceof Error ? error.message : String(error), "Regenerate and review the OpenAPI baseline, then rerun the doctor.");
	}

	const document = await fetchOpenApiDocument(dependencies.fetcher);

	let analysis: OpenApiDriftAnalysis;
	try {
		analysis = analyzeOpenApiDrift(document, baseline);
	} catch (error: unknown) {
		throw new CliError("openapi_contract_invalid", error instanceof Error ? error.message : String(error), "Inspect the baseline and live Swagger shape before accepting any contract update.");
	}
	const breaking = analysis.health === "breaking_drift";
	const bundledBaseline = baselinePath === DEFAULT_OPENAPI_BASELINE;
	const trustedIssueDraft = bundledBaseline ? analysis.issue_draft : null;
	return {
		status: breaking ? "attention" : "ok",
		exitCode: breaking ? 3 : 0,
		changed_state: "none",
		data: {
			...analysis,
			issue_draft: trustedIssueDraft,
			baseline_file: baselinePath,
			baseline_trust: bundledBaseline ? "bundled" : "custom_untrusted",
			owner_notification: breaking
				? { status: "not_sent", reason: bundledBaseline ? "approval_required" : "untrusted_baseline", issue_url: null }
				: { status: "not_required", issue_url: null },
		},
		next_safe_action: breaking
			? bundledBaseline
				? "Delegate this bounded drift evidence to a Terra review agent, deduplicate the issue draft in nathanvale/claude-code-config, then obtain explicit approval before creating an issue."
				: "Treat this custom-baseline result as local diagnostics only. Reproduce against the bundled baseline before any escalation."
			: analysis.health === "additive_drift"
				? "Review the additive operations during normal maintenance; no owner notification is required."
				: analysis.health === "review_drift"
					? "Review the indeterminate semantic drift during normal maintenance; no owner notification was created."
					: "No OpenAPI repair action is required.",
		retry_safety: "same_input_safe",
		effect: "read",
		remediationClass: breaking ? (bundledBaseline ? "approval_required" : "untrusted_baseline") : analysis.health === "healthy" ? "none" : "maintenance_review",
	};
}

async function discoverOperations(input: ParsedInput, dependencies: CliDependencies): Promise<CommandResult> {
	const document = await fetchOpenApiDocument(dependencies.fetcher) as { swagger?: unknown; basePath?: unknown; consumes?: unknown; produces?: unknown; paths?: Record<string, Record<string, unknown>> };
	if (!document.paths || typeof document.paths !== "object") throw new CliError("openapi_invalid", "The canonical OpenAPI response has no paths object.", "Inspect the canonical OpenAPI URL for a contract change.");

	const queryText = stringFlag(input.flags, "--query") ?? "";
	const query = queryText.toLowerCase();
	const limit = boundedInteger(stringFlag(input.flags, "--limit") ?? "50", "limit", 1, 200);
	const cursor = boundedInteger(stringFlag(input.flags, "--cursor") ?? "0", "cursor", 0, Number.MAX_SAFE_INTEGER);
	const operations: Array<Record<string, unknown>> = [];
	for (const [path, pathItem] of Object.entries(document.paths)) {
		const pathParameters = summarizeParameters(pathItem.parameters);
		for (const [method, value] of Object.entries(pathItem)) {
			if (!HTTP_METHODS.has(method.toUpperCase()) || !value || typeof value !== "object") continue;
			const operation = value as { summary?: unknown; tags?: unknown; parameters?: unknown; consumes?: unknown; produces?: unknown };
			const candidate = `${method} ${path} ${String(operation.summary ?? "")} ${Array.isArray(operation.tags) ? operation.tags.join(" ") : ""}`.toLowerCase();
			if (query && !candidate.includes(query)) continue;
			const parameters = [...pathParameters, ...summarizeParameters(operation.parameters)];
			operations.push({
				method: method.toUpperCase(),
				path,
				summary: typeof operation.summary === "string" ? operation.summary : "",
				tags: Array.isArray(operation.tags) ? operation.tags.filter((tag): tag is string => typeof tag === "string") : [],
				parameters,
				consumes: stringArray(operation.consumes ?? document.consumes),
				produces: stringArray(operation.produces ?? document.produces),
				body_schema: parameters.find((parameter) => parameter.in === "body")?.schema ?? null,
			});
		}
	}

	operations.sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`));
	const page = operations.slice(cursor, cursor + limit);
	const nextCursor = cursor + page.length < operations.length ? cursor + page.length : null;
	return {
		changed_state: "none",
		data: {
			contract_url: BITBUCKET_OPENAPI_URL,
			swagger: document.swagger,
			base_path: document.basePath,
			matched: operations.length,
			cursor,
			returned: page.length,
			truncated: nextCursor !== null,
			next_cursor: nextCursor,
			next_invocation: nextCursor === null ? null : {
				argv: ["operations", ...(queryText ? ["--query", queryText] : []), "--cursor", String(nextCursor), "--limit", String(limit)],
			},
			operations: page,
		},
		next_safe_action: nextCursor === null
			? "Choose an operation, substitute its path parameters, then run bb-pr api with the documented method and body."
			: "Continue discovery with data.next_invocation.argv, which preserves the active query and page bounds.",
		retry_safety: "same_input_safe",
		effect: "read",
	};
}

async function fetchOpenApiDocument(fetcher: FetchLike): Promise<unknown> {
	let response: Response;
	try {
		response = await fetcher(BITBUCKET_OPENAPI_URL, { signal: AbortSignal.timeout(30_000) });
	} catch (error: unknown) {
		throw new CliError("openapi_unavailable", error instanceof Error ? error.message : String(error), "Retry once, then inspect Atlassian service health and the canonical OpenAPI URL.");
	}
	if (!response.ok) throw new CliError("openapi_unavailable", `OpenAPI request failed with HTTP ${response.status}.`, "Retry once, then inspect Atlassian service health and the canonical OpenAPI URL.");
	try {
		return await response.json();
	} catch (error: unknown) {
		throw new CliError("openapi_invalid", error instanceof Error ? error.message : String(error), "Inspect the canonical OpenAPI URL for a malformed or changed contract.");
	}
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function summarizeParameters(value: unknown): Array<Record<string, unknown>> {
	if (!Array.isArray(value)) return [];
	return value.flatMap((parameter) => {
		if (!parameter || typeof parameter !== "object") return [];
		const item = parameter as Record<string, unknown>;
		return [{ name: item.name, in: item.in, required: item.required === true, type: item.type, schema: item.schema }];
	});
}

const repositoryRequest: RequestBuilder = ({ base }) => ({ path: base });
const pullRequestResource = (suffix = ""): RequestBuilder => ({ base, id }) => ({ path: `${base}/pullrequests/${id()}${suffix}` });
const pagedPullRequestResource = (suffix: string): RequestBuilder => ({ base, id, limit }) => ({ path: `${base}/pullrequests/${id()}${suffix}?pagelen=${limit()}` });

const REQUEST_BUILDERS: Record<string, RequestBuilder> = {
	status: repositoryRequest,
	repo: repositoryRequest,
	list: ({ input, base }) => {
		const state = (stringFlag(input.flags, "--state") ?? "OPEN").toUpperCase();
		if (!VALID_STATES.includes(state as (typeof VALID_STATES)[number])) throw usage(`State must be one of: ${VALID_STATES.join(", ")}.`);
		const listLimit = boundedInteger(stringFlag(input.flags, "--limit") ?? "25", "limit", 1, 100);
		return { path: `${base}/pullrequests?state=${state}&pagelen=${listLimit}` };
	},
	view: pullRequestResource(),
	diff: ({ base, id }) => ({ path: `${base}/pullrequests/${id()}/diff`, accept: "text/plain" }),
	diffstat: pagedPullRequestResource("/diffstat"),
	comments: pagedPullRequestResource("/comments"),
	activity: pagedPullRequestResource("/activity"),
	checks: pagedPullRequestResource("/statuses"),
	comment: ({ input, base, id }) => ({
		path: `${base}/pullrequests/${id()}/comments`,
		method: "POST",
		body: { content: { raw: requiredFlag(input.flags, "--text") } },
	}),
	"inline-comment": ({ input, base, id }) => ({
		path: `${base}/pullrequests/${id()}/comments`,
		method: "POST",
		body: {
			content: { raw: requiredFlag(input.flags, "--text") },
			inline: { path: requiredFlag(input.flags, "--path"), to: boundedInteger(requiredFlag(input.flags, "--line"), "line", 1, Number.MAX_SAFE_INTEGER) },
		},
	}),
	reply: ({ input, base, id }) => ({
		path: `${base}/pullrequests/${id()}/comments`,
		method: "POST",
		body: {
			content: { raw: requiredFlag(input.flags, "--text") },
			parent: { id: boundedInteger(requiredFlag(input.flags, "--comment-id"), "comment id", 1, Number.MAX_SAFE_INTEGER) },
		},
	}),
	approve: ({ base, id }) => ({ path: `${base}/pullrequests/${id()}/approve`, method: "POST" }),
	unapprove: ({ base, id }) => ({ path: `${base}/pullrequests/${id()}/approve`, method: "DELETE" }),
	merge: ({ input, base, id }) => {
		const strategy = stringFlag(input.flags, "--strategy") ?? "squash";
		if (!VALID_STRATEGIES.includes(strategy as (typeof VALID_STRATEGIES)[number])) throw usage(`Strategy must be one of: ${VALID_STRATEGIES.join(", ")}.`);
		return {
			path: `${base}/pullrequests/${id()}/merge`,
			method: "POST",
			body: { merge_strategy: strategy, close_source_branch: input.flags.has("--close-source-branch") },
		};
	},
	decline: ({ base, id }) => ({ path: `${base}/pullrequests/${id()}/decline`, method: "POST" }),
	create: ({ input, base }) => ({
		path: `${base}/pullrequests`,
		method: "POST",
		body: {
			title: requiredFlag(input.flags, "--title"),
			source: { branch: { name: requiredFlag(input.flags, "--source") } },
			destination: { branch: { name: requiredFlag(input.flags, "--destination") } },
			description: stringFlag(input.flags, "--description") ?? "",
			close_source_branch: input.flags.has("--close-source-branch"),
		},
	}),
	branches: ({ base, limit }) => ({ path: `${base}/refs/branches?pagelen=${limit()}` }),
};

async function callApi(request: ApiRequest, authHeader: string, fetcher: FetchLike, effect: "read" | "write"): Promise<unknown> {
	let response: Response;
	try {
		response = await fetcher(`${API_BASE_URL}${request.path}`, {
			method: request.method ?? "GET",
			headers: {
				...request.headers,
				Authorization: authHeader,
				Accept: request.accept ?? "application/json",
				...(request.body !== undefined ? { "Content-Type": request.contentType ?? "application/json" } : {}),
			},
			body: serializeRequestBody(request.body),
			signal: AbortSignal.timeout(30_000),
		});
	} catch (error: unknown) {
		throw new CliError(
			"network_failure",
			error instanceof Error ? error.message : String(error),
			effect === "write" ? "Inspect the pull request before retrying." : "Check network access, then retry the same read.",
			effect === "write" ? "inspect_before_retry" : "same_input_safe",
		);
	}

	const contentType = response.headers.get("content-type") ?? "";
	let text: string;
	try {
		text = await response.text();
	} catch (error: unknown) {
		throw new CliError(
			"network_failure",
			error instanceof Error ? error.message : String(error),
			effect === "write" ? "Inspect the affected Bitbucket resource before retrying." : "Check network access, then retry the same read.",
			effect === "write" ? "inspect_before_retry" : "same_input_safe",
		);
	}
	let body: unknown = text;
	if (contentType.includes("json") && text) {
		try {
			body = JSON.parse(text);
		} catch {
			if (response.ok) {
				throw new CliError(
					"invalid_api_response",
					"Bitbucket returned malformed JSON for a successful response.",
					effect === "write" ? "Inspect the affected Bitbucket resource before retrying." : "Retry once; if it repeats, inspect Bitbucket service health.",
					effect === "write" ? "inspect_before_retry" : "same_input_safe",
				);
			}
			body = text;
		}
	}
	if (!response.ok) {
		const classification = classifyHttpError(response.status, effect, response.headers);
		throw new CliError(classification.code, `Bitbucket API ${response.status}: request rejected`, classification.nextSafeAction, classification.retrySafety, classification.retryAfterSeconds, classification.maximumAttempts);
	}
	return body;
}

function serializeRequestBody(body: unknown): BodyInit | undefined {
	if (body === undefined) return undefined;
	if (typeof body === "string" || body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body as BodyInit;
	return JSON.stringify(body);
}

function requestBodyDigest(body: unknown): string {
	const serialized = serializeRequestBody(body);
	if (typeof serialized === "string") return createHash("sha256").update(serialized).digest("hex");
	if (ArrayBuffer.isView(serialized)) return createHash("sha256").update(new Uint8Array(serialized.buffer, serialized.byteOffset, serialized.byteLength)).digest("hex");
	if (serialized instanceof ArrayBuffer) return createHash("sha256").update(new Uint8Array(serialized)).digest("hex");
	throw usage("Request body cannot be bound to a deterministic digest.");
}

function classifyHttpError(status: number, effect: "read" | "write", headers: Headers): { code: string; nextSafeAction: string; retrySafety: RetrySafety; retryAfterSeconds?: number; maximumAttempts?: number } {
	const retrySafety = effect === "write" ? "inspect_before_retry" : "same_input_safe";
	if (status === 401) return { code: "auth_rejected", nextSafeAction: "Refresh the process-scoped Bitbucket credentials, then run bb-pr status.", retrySafety: "same_input_safe" };
	if (status === 403) return { code: "permission_denied", nextSafeAction: "Check API-token scopes and repository access. Do not retry unchanged credentials.", retrySafety: "same_input_safe" };
	if ([404, 405, 415, 422].includes(status)) {
		const code = status === 404 ? "not_found" : status === 405 ? "method_not_allowed" : status === 415 ? "unsupported_media_type" : "request_rejected";
		return {
			code,
			nextSafeAction: effect === "write"
				? "Inspect the affected Bitbucket resource first. Then run bb-pr doctor openapi; execute again only after confirming no change and correcting the request."
				: "Run bb-pr doctor openapi. If it is healthy, correct the path, method, content type, or request body before retrying.",
			retrySafety,
		};
	}
	if (status === 429) {
		const retryAfterSeconds = parseRetryAfter(headers.get("retry-after"));
		return {
			code: "rate_limited",
			nextSafeAction: effect === "write"
				? `Wait ${retryAfterSeconds} seconds, inspect the affected Bitbucket resource, then retry at most once only when no change occurred.`
				: `Wait ${retryAfterSeconds} seconds, then retry at most once. Inspect service health if rate limiting continues.`,
			retrySafety,
			retryAfterSeconds,
			maximumAttempts: 1,
		};
	}
	return { code: "api_failure", nextSafeAction: effect === "write" ? "Inspect the pull request before retrying." : "Retry once, then inspect Bitbucket service health.", retrySafety };
}

function parseRetryAfter(value: string | null): number {
	const fallback = 30;
	if (!value) return fallback;
	if (/^\d+$/.test(value)) return Math.min(300, Math.max(1, Number(value)));
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) return fallback;
	return Math.min(300, Math.max(1, Math.ceil((timestamp - Date.now()) / 1000)));
}

function successEnvelope(runId: string, command: CommandDefinition, target: string, result: CommandResult) {
	return {
		contract_id: ENVELOPE_CONTRACT_ID,
		schema_version: ENVELOPE_SCHEMA_VERSION,
		status: result.status ?? "ok",
		run_id: runId,
		command: command.name,
		effect: result.effect,
		target,
		changed_state: result.changed_state,
		data: result.data,
		retry_safety: result.retry_safety,
		next_safe_action: result.next_safe_action,
		exit_code: result.exitCode ?? 0,
		remediation_class: result.remediationClass ?? "none",
	};
}

function sanitizePreview(request: ApiRequest): Record<string, unknown> {
	return {
		path: request.path,
		method: request.method,
		body: request.previewBody ?? request.body,
		accept: request.accept,
		content_type: request.contentType,
		headers: request.headers && Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, `sha256:${createHash("sha256").update(value).digest("hex")}`])),
	};
}

function isCredentialHeader(name: string): boolean {
	return /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$/i.test(name)
		|| /(secret|credential|access[-_]?token)/i.test(name);
}

function redactSensitiveValues(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redactSensitiveValues);
	if (!value || typeof value !== "object") return value;
	const record = value as Record<string, unknown>;
	const securedValue = record.secured === true || record.is_secured === true;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
		key,
		isSensitiveResponseKey(key) || (securedValue && key === "value") ? "[REDACTED]" : redactSensitiveValues(item),
	]));
}

function isSensitiveResponseKey(key: string): boolean {
	const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
	return ["token", "password", "secret", "credential", "authorization", "cookie", "privatekey", "apikey", "accesstoken", "refreshtoken", "clientsecret"].includes(normalized)
		|| normalized.endsWith("password")
		|| normalized.endsWith("secret")
		|| normalized.endsWith("credential")
		|| normalized.endsWith("token");
}

function requirePositiveInteger(value: string | undefined, label: string): number {
	if (!value) throw usage(`Missing ${label}.`);
	return boundedInteger(value, label, 1, Number.MAX_SAFE_INTEGER);
}

function boundedInteger(value: string, label: string, minimum: number, maximum: number): number {
	if (!/^\d+$/.test(value)) throw usage(`${label} must be an integer.`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw usage(`${label} must be between ${minimum} and ${maximum}.`);
	return parsed;
}

function requiredFlag(flags: Map<string, string | true>, name: string): string {
	const value = stringFlag(flags, name);
	if (!value) throw usage(`Missing required flag: ${name}.`);
	return value;
}

function stringFlag(flags: Map<string, string | true>, name: string): string | undefined {
	const value = flags.get(name);
	return typeof value === "string" ? value : undefined;
}

function usage(message: string): CliError {
	return new CliError("usage_error", message, "Run bb-pr help <command> and correct the invocation.");
}

function normalizeError(error: unknown): CliError {
	if (error instanceof CliError) return error;
	return new CliError("unexpected_failure", error instanceof Error ? error.message : String(error), "Run bb-pr status. If it passes, rerun the read or preview; inspect state before retrying a write.", "inspect_before_retry");
}

function nextReadAction(command: string): string {
	if (command === "list") return "Choose a pull-request identifier and run bb-pr view <id>.";
	if (command === "view") return "Inspect diffstat, checks, comments, or activity for this pull request.";
	if (command === "diffstat") return "Request a bounded diff for files that need inspection.";
	return "Use the returned evidence to choose the next safe read or an approved write preview.";
}

if (import.meta.main) {
	process.exitCode = await runCli(process.argv.slice(2));
}
