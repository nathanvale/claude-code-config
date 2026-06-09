#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MCPORTER_COMMAND_ENV = "CODING_TASK_TRACKER_MCPORTER_COMMAND_JSON";
const CONFIG_DIR = ".coding-task-tracker";
const REPO_CONFIG_FILE = "repo.json";
const LOCAL_CONFIG_FILE = "local.json";

const STATUSES = ["Backlog", "Ready", "Doing", "Blocked", "Review", "Done"] as const;
const TRIAGE_STATUSES = ["Backlog", "Ready"] as const;
const TRIAGE_STATES = [
	"needs-triage",
	"needs-info",
	"ready-for-agent",
	"ready-for-human",
	"wontfix",
] as const;
const CATEGORIES = ["bug", "enhancement"] as const;
const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;

type SideEffect = "read" | "write";
type RetrySafety = "safe" | "unsafe" | "unknown";

type RawTask = Record<string, unknown>;

export type Task = {
	name: string;
	task_id: string;
	task_id_number: string;
	status: string;
	triage_state: string;
	category: string;
	priority: string;
	repo: string;
	branch: string;
	agent: string;
	reference_url: string;
	pull_request: string;
	blocked_reason: string;
	url: string;
	page_id: string;
	pickable: boolean;
	next_safe_action: string;
};

function isTask(value: Task | Envelope): value is Task {
	return "task_id" in value;
}

type MutationEvidence = {
	attempted: boolean;
	confirmed: boolean;
	evidence: string;
};

type OwnerResolutionStatus = "exact" | "inherited" | "missing" | "broken";
type OwnerResolutionSource = "cwd_search" | "explicit_owner" | "bind_target";
type ConfigState = "ok" | "missing" | "malformed" | "invalid";

type OwnerResolution = {
	status: OwnerResolutionStatus;
	source: OwnerResolutionSource;
	start_dir: string;
	owner_path: string | null;
	owner_key: string | null;
	owner_uuid: string | null;
	ancestor_distance: number | null;
	config_dir: string | null;
	repo_config_state: ConfigState;
	local_config_state: ConfigState;
	binding_state: "bound" | "missing" | "invalid" | "unverified";
	write_allowed: boolean;
	write_block_reason: null | "inherited_owner" | "missing_owner" | "broken_config";
};

export type Envelope = {
	status: "ok" | "error";
	command: string;
	run_id: string;
	side_effect: SideEffect;
	same_input_retry: RetrySafety;
	mutation: MutationEvidence;
	owner_resolution?: OwnerResolution;
	data?: unknown;
	error?: {
		code: string;
		message: string;
		evidence?: unknown;
	};
	next_action: string;
};

type ParsedCli = {
	command: string;
	flags: Record<string, string | boolean>;
	json: boolean;
	help: boolean;
};

type McporterResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	error?: Error;
};

type Runner = (tool: string, payload: Record<string, unknown>) => McporterResult;

type TrackerConfig = {
	ownerPath: string;
	ownerKey: string;
	ownerUuid: string;
	provider: "notion";
	dataSourceUrl: string;
	readyViewUrl: string;
	allTasksViewUrl: string;
	ownerResolution: OwnerResolution;
};

type RepoTrackerConfig = {
	owner_key: string;
	owner_uuid: string;
	provider: "notion";
};

type LocalTrackerConfig = {
	data_source_url: string;
	ready_view_url: string;
	all_tasks_view_url: string;
};

type FrontDoorCandidate = {
	owner_path: string;
	owner_arg: string;
	label: string;
	reason: string;
	configured: boolean;
	recommended: boolean;
};

type TaskTarget = {
	taskId?: string;
	pageId?: string;
	url?: string;
};

const HELP = `Coding Task Tracker

Usage:
  coding-task-tracker [command] [flags]

Commands:
  front-door                    Ask which repo domain should own tracking
  bind --data-source <url> --ready-view <url> --all-tasks-view <url>
                                Bind this owner path to an existing Notion tracker
  ready                         List pickable Ready tasks
  list --status <status>         List active tasks by status
  get (--task-id|--page-id|--url) Fetch one task
  create --name <text>           Create a backlog task
  claim <target> --agent <name> --branch <branch>
  note <target> --message <text>
  block <target> --reason <text>
  review <target> [--pull-request <url>]
  done <target>
  priority <target> --priority <P0|P1|P2|P3>
  triage <target> [--status <Backlog|Ready>] [--triage-state <state>] [--category <category>]
  doctor                         Check mcporter Notion access

Target flags:
  --task-id <id>                 Accepts 29 or TASK-29
  --page-id <id>
  --url <url>

Common flags:
  --json                         Emit the runtime envelope as JSON
  --owner <path>                  Exact tracker owner path; for bind, target owner path
  --owner-key <key>               Stable human-readable owner key for bind
  --owner-uuid <uuid>             Stable owner UUID for bind, generated when absent
  --limit <n>                    Limit list output
  --force                        Override claim pickable gate
  -h, --help                     Show this help
`;

function makeRunId(): string {
	return `ctt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function envelope(input: {
	status: Envelope["status"];
	command: string;
	sideEffect: SideEffect;
	retry: RetrySafety;
	mutation?: Partial<MutationEvidence>;
	data?: unknown;
	error?: Envelope["error"];
	nextAction: string;
	ownerResolution?: OwnerResolution;
	runId?: string;
}): Envelope {
	return {
		status: input.status,
		command: input.command,
		run_id: input.runId ?? makeRunId(),
		side_effect: input.sideEffect,
		same_input_retry: input.retry,
		mutation: {
			attempted: input.mutation?.attempted ?? false,
			confirmed: input.mutation?.confirmed ?? false,
			evidence: input.mutation?.evidence ?? "no mutation attempted",
		},
		...(input.ownerResolution === undefined ? {} : { owner_resolution: input.ownerResolution }),
		...(input.data === undefined ? {} : { data: input.data }),
		...(input.error === undefined ? {} : { error: input.error }),
		next_action: input.nextAction,
	};
}

export function parseCli(argv: string[]): ParsedCli {
	let command = "front-door";
	const flags: Record<string, string | boolean> = {};
	const consumedFlagTokens = new Set<number>();

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === undefined) continue;
		if (token === "-h" || token === "--help") {
			flags.help = true;
			consumedFlagTokens.add(index);
			continue;
		}
		if (!token.startsWith("--")) {
			continue;
		}

		const key = token.slice(2);
		consumedFlagTokens.add(index);
		const next = argv[index + 1];
		if (next === undefined || next.startsWith("--")) {
			flags[key] = true;
			continue;
		}
		flags[key] = next;
		consumedFlagTokens.add(index + 1);
		index += 1;
	}

	for (const [index, token] of argv.entries()) {
		if (token === "-h" || token === "--help") {
			command = "help";
			break;
		}
		if (consumedFlagTokens.has(index)) continue;
		if (token.startsWith("--")) continue;
		command = token;
		break;
	}

	return {
		command,
		flags,
		json: flags.json === true,
		help: flags.help === true || command === "help",
	};
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function parseJsonFile(filePath: string): { state: ConfigState; value: Record<string, unknown> | null } {
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? { state: "ok", value: parsed as Record<string, unknown> }
			: { state: "malformed", value: null };
	} catch {
		return { state: existsSync(filePath) ? "malformed" : "missing", value: null };
	}
}

function trackerEvidence(config: TrackerConfig): Record<string, string> {
	return {
		owner_path: config.ownerPath,
		owner_key: config.ownerKey,
		owner_uuid: config.ownerUuid,
		provider: config.provider,
	};
}

function ownerArgFrom(startDir: string, ownerPath: string): string {
	const relative = path.relative(path.resolve(startDir), path.resolve(ownerPath));
	return relative || ".";
}

function ownerLabel(ownerPath: string, repoRoot: string | null): string {
	if (repoRoot && path.resolve(ownerPath) === path.resolve(repoRoot)) return "repo root";
	return path.basename(ownerPath) || ownerPath;
}

function hasTrackerConfig(ownerPath: string): boolean {
	return existsSync(path.join(ownerPath, CONFIG_DIR)) && statSync(path.join(ownerPath, CONFIG_DIR)).isDirectory();
}

function findRepoRoot(startDir: string): string | null {
	let current = path.resolve(startDir);
	while (true) {
		if (existsSync(path.join(current, ".git"))) return current;
		const packageJsonPath = path.join(current, "package.json");
		if (existsSync(packageJsonPath)) {
			const parsed = parseJsonFile(packageJsonPath);
			if (parsed.value && typeof parsed.value.workspaces === "object") return current;
		}
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

function readWorkspacePackagePaths(repoRoot: string): string[] {
	const parsed = parseJsonFile(path.join(repoRoot, "package.json"));
	const workspaces = parsed.value?.workspaces;
	const packagePatterns: unknown[] = Array.isArray(workspaces)
		? workspaces
		: workspaces && typeof workspaces === "object" && Array.isArray((workspaces as Record<string, unknown>).packages)
			? ((workspaces as Record<string, unknown>).packages as unknown[])
			: [];
	const paths: string[] = [];
	for (const value of packagePatterns) {
		if (typeof value !== "string") continue;
		if (value.endsWith("/*")) {
			const parent = path.join(repoRoot, value.slice(0, -2));
			if (!existsSync(parent) || !statSync(parent).isDirectory()) continue;
			for (const entry of readdirSync(parent, { withFileTypes: true })) {
				if (entry.isDirectory() && !entry.name.startsWith(".")) {
					paths.push(path.join(parent, entry.name));
				}
			}
			continue;
		}
		const candidate = path.join(repoRoot, value);
		if (existsSync(candidate) && statSync(candidate).isDirectory()) paths.push(candidate);
	}
	return paths;
}

function makeFrontDoorCandidate(input: {
	startDir: string;
	ownerPath: string;
	label: string;
	reason: string;
	recommended?: boolean;
}): FrontDoorCandidate {
	return {
		owner_path: path.resolve(input.ownerPath),
		owner_arg: ownerArgFrom(input.startDir, input.ownerPath),
		label: input.label,
		reason: input.reason,
		configured: hasTrackerConfig(input.ownerPath),
		recommended: input.recommended === true,
	};
}

function frontDoorCandidates(startDir: string, resolvedOwnerPath: string | null): FrontDoorCandidate[] {
	const repoRoot = findRepoRoot(startDir);
	const byPath = new Map<string, FrontDoorCandidate>();
	const add = (candidate: FrontDoorCandidate) => byPath.set(candidate.owner_path, candidate);

	add(
		makeFrontDoorCandidate({
			startDir,
			ownerPath: startDir,
			label: "current directory",
			reason: "Use when this folder owns a distinct work domain.",
			recommended: resolvedOwnerPath === null || path.resolve(resolvedOwnerPath) === path.resolve(startDir),
		}),
	);
	if (resolvedOwnerPath) {
		add(
			makeFrontDoorCandidate({
				startDir,
				ownerPath: resolvedOwnerPath,
				label: "resolved owner",
				reason: "Use the tracker owner already resolved from this location.",
				recommended: path.resolve(resolvedOwnerPath) !== path.resolve(startDir),
			}),
		);
	}
	if (repoRoot) {
		add(
			makeFrontDoorCandidate({
				startDir,
				ownerPath: repoRoot,
				label: ownerLabel(repoRoot, repoRoot),
				reason: "Use when the whole repo shares one tracker.",
				recommended: resolvedOwnerPath === null && path.resolve(repoRoot) !== path.resolve(startDir),
			}),
		);
		for (const packagePath of readWorkspacePackagePaths(repoRoot)) {
			add(
				makeFrontDoorCandidate({
					startDir,
					ownerPath: packagePath,
					label: path.relative(repoRoot, packagePath),
					reason: "Use when this workspace package or skill owns its own tracker.",
				}),
			);
		}
	}

	return [...byPath.values()]
		.sort((left, right) => Number(right.recommended) - Number(left.recommended) || left.owner_arg.localeCompare(right.owner_arg))
		.slice(0, 12);
}

function dataSourceIdFromUrl(value: string): string {
	return value.replace(/^collection:\/\//, "").trim();
}

function normalizeDataSourceUrl(value: string): string {
	const raw = value.trim();
	return raw.startsWith("collection://") ? raw : `collection://${raw}`;
}

function normalizeViewUrl(value: string): string {
	const raw = value.trim();
	return raw.startsWith("view://") ? raw : `view://${raw}`;
}

function dataSourceTextMatches(dataSourceUrl: string, text: string): boolean {
	return text.includes(`"url":"${dataSourceUrl}"`) || text.includes(dataSourceUrl);
}

function configError(
	command: string,
	sideEffect: SideEffect,
	code: string,
	message: string,
	ownerResolution: OwnerResolution,
	evidence?: unknown,
): Envelope {
	return envelope({
		status: "error",
		command,
		sideEffect,
		retry: "safe",
		mutation: {
			attempted: false,
			confirmed: false,
			evidence: "tracker binding was not resolved before Notion access",
		},
		error: {
			code,
			message,
			...(evidence === undefined ? {} : { evidence }),
		},
		ownerResolution,
		nextAction:
			ownerResolution.status === "broken"
				? "repair-tracker-config-or-rerun-bind"
				: "bind-existing-tracker-from-intended-owner-path",
	});
}

function makeOwnerResolution(input: Partial<OwnerResolution> & {
	status: OwnerResolutionStatus;
	source: OwnerResolutionSource;
	startDir: string;
}): OwnerResolution {
	return {
		status: input.status,
		source: input.source,
		start_dir: path.resolve(input.startDir),
		owner_path: input.owner_path ?? null,
		owner_key: input.owner_key ?? null,
		owner_uuid: input.owner_uuid ?? null,
		ancestor_distance: input.ancestor_distance ?? null,
		config_dir: input.config_dir ?? null,
		repo_config_state: input.repo_config_state ?? "missing",
		local_config_state: input.local_config_state ?? "missing",
		binding_state: input.binding_state ?? "missing",
		write_allowed: input.write_allowed ?? false,
		write_block_reason:
			input.write_block_reason ??
			(input.status === "missing"
				? "missing_owner"
				: input.status === "broken"
					? "broken_config"
					: input.status === "inherited"
						? "inherited_owner"
						: null),
	};
}

function findTrackerOwner(startDir: string, explicitOwner = ""): { ownerPath: string; ancestorDistance: number } | null {
	if (explicitOwner) {
		return { ownerPath: path.resolve(startDir, explicitOwner), ancestorDistance: 0 };
	}

	let current = path.resolve(startDir);
	let distance = 0;
	while (true) {
		const configPath = path.join(current, CONFIG_DIR);
		if (existsSync(configPath) && statSync(configPath).isDirectory()) {
			return { ownerPath: current, ancestorDistance: distance };
		}
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
		distance += 1;
	}
}

export function resolveTrackerConfig(
	command: string,
	sideEffect: SideEffect,
	startDir = process.cwd(),
	flags: Record<string, string | boolean> = {},
): TrackerConfig | Envelope {
	const explicitOwner = optionalString(flags, "owner");
	const source: OwnerResolutionSource = explicitOwner ? "explicit_owner" : "cwd_search";
	const found = findTrackerOwner(startDir, explicitOwner);
	if (!found) {
		const resolution = makeOwnerResolution({
			status: "missing",
			source,
			startDir,
		});
		return configError(command, sideEffect, "tracker_not_configured", "No Coding Task Tracker owner config found.", resolution, {
			start_dir: path.resolve(startDir),
			expected: `${CONFIG_DIR}/`,
		});
	}

	const { ownerPath, ancestorDistance } = found;
	const repoPath = path.join(ownerPath, CONFIG_DIR, REPO_CONFIG_FILE);
	const localPath = path.join(ownerPath, CONFIG_DIR, LOCAL_CONFIG_FILE);
	const repo = parseJsonFile(repoPath);
	const local = parseJsonFile(localPath);
	const baseResolution = {
		source,
		startDir,
		owner_path: ownerPath,
		ancestor_distance: explicitOwner ? 0 : ancestorDistance,
		config_dir: path.join(ownerPath, CONFIG_DIR),
		repo_config_state: repo.state,
		local_config_state: local.state,
	} satisfies Partial<OwnerResolution> & { source: OwnerResolutionSource; startDir: string };

	if (!repo.value) {
		const resolution = makeOwnerResolution({
			...baseResolution,
			status: "broken",
			binding_state: "invalid",
		});
		return configError(command, sideEffect, "tracker_config_broken", "Tracker owner config could not be parsed.", resolution, {
			path: repoPath,
		});
	}
	if (!local.value) {
		const resolution = makeOwnerResolution({
			...baseResolution,
			status: "broken",
			binding_state: "missing",
		});
		return configError(command, sideEffect, "tracker_config_broken", "Tracker local binding config could not be parsed.", resolution, {
			path: localPath,
		});
	}

	const ownerKey = asString(repo.value.owner_key).trim();
	const ownerUuid = asString(repo.value.owner_uuid).trim();
	const provider = asString(repo.value.provider).trim();
	const dataSourceUrl = asString(local.value.data_source_url).trim();
	const readyViewUrl = asString(local.value.ready_view_url).trim();
	const allTasksViewUrl = asString(local.value.all_tasks_view_url).trim();

	if (!ownerKey || !ownerUuid || provider !== "notion" || !dataSourceUrl || !readyViewUrl || !allTasksViewUrl) {
		const resolution = makeOwnerResolution({
			...baseResolution,
			status: "broken",
			repo_config_state: !ownerKey || !ownerUuid || provider !== "notion" ? "invalid" : repo.state,
			local_config_state: !dataSourceUrl || !readyViewUrl || !allTasksViewUrl ? "invalid" : local.state,
			binding_state: "invalid",
		});
		return configError(command, sideEffect, "tracker_config_broken", "Tracker binding config is missing required values.", resolution, {
			repo_config: repoPath,
			local_config: localPath,
		});
	}

	const status: OwnerResolutionStatus = explicitOwner || ancestorDistance === 0 ? "exact" : "inherited";
	const ownerResolution = makeOwnerResolution({
		...baseResolution,
		status,
		owner_key: ownerKey,
		owner_uuid: ownerUuid,
		repo_config_state: "ok",
		local_config_state: "ok",
		binding_state: "bound",
		write_allowed: status === "exact",
		write_block_reason: status === "exact" ? null : "inherited_owner",
	});

	return {
		ownerPath,
		ownerKey,
		ownerUuid,
		provider: "notion",
		dataSourceUrl: normalizeDataSourceUrl(dataSourceUrl),
		readyViewUrl: normalizeViewUrl(readyViewUrl),
		allTasksViewUrl: normalizeViewUrl(allTasksViewUrl),
		ownerResolution,
	};
}

export function normalizeTaskId(value: unknown): string {
	const raw = asString(value).trim();
	const match = raw.match(/\d+/);
	return match?.[0] ?? raw;
}

export function extractPageId(value: string): string {
	const match = value.match(/[a-f0-9]{32}/i);
	if (!match) {
		return value;
	}
	const raw = match[0].toLowerCase();
	return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

function isOneOf<T extends readonly string[]>(value: string, options: T): value is T[number] {
	return (options as readonly string[]).includes(value);
}

function taskNextAction(task: Pick<Task, "status" | "triage_state" | "pickable">): string {
	if (task.pickable) return "claim";
	if (task.status === "Blocked") return "resolve-blocker-or-update-blocked-reason";
	if (task.status === "Doing") return "add-progress-note-or-move-to-review";
	if (task.status === "Review") return "review-or-mark-done";
	if (task.triage_state === "needs-info") return "collect-missing-info";
	if (task.status === "Backlog") return "triage-task";
	return "inspect-task";
}

export function normalizeTask(raw: RawTask): Task {
	const url = asString(raw.url);
	const status = asString(raw.Status);
	const triageState = asString(raw["Triage State"]);
	const taskIdNumber = normalizeTaskId(raw["Task ID"]);
	const pickable = status === "Ready" && triageState === "ready-for-agent";
	const task = {
		name: asString(raw.Name),
		task_id: taskIdNumber ? `TASK-${taskIdNumber}` : "",
		task_id_number: taskIdNumber,
		status,
		triage_state: triageState,
		category: asString(raw.Category),
		priority: asString(raw.Priority),
		repo: asString(raw.Repo),
		branch: asString(raw.Branch),
		agent: asString(raw.Agent),
		reference_url: asString(raw["Reference URL"]),
		pull_request: asString(raw["Pull Request"]),
		blocked_reason: asString(raw["Blocked Reason"]),
		url,
		page_id: extractPageId(url),
		pickable,
		next_safe_action: "",
	};
	return { ...task, next_safe_action: taskNextAction(task) };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(text);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function parseTaskFromFetch(config: TrackerConfig, result: Record<string, unknown>): Task | null {
	const text = asString(result.text);
	const sourceOk = text.includes(`parent-data-source url="${config.dataSourceUrl}"`);
	const match = text.match(/<properties>\s*([\s\S]*?)\s*<\/properties>/);
	if (!sourceOk || !match?.[1]) return null;
	const properties = parseJsonObject(match[1]);
	if (!properties) return null;
	return normalizeTask(properties);
}

function parseMcporterJson(result: McporterResult): Record<string, unknown> | null {
	return parseJsonObject(result.stdout.trim());
}

function resolveMcporterCommand(): string[] {
	const raw = process.env[MCPORTER_COMMAND_ENV];
	if (!raw) return ["mcporter"];

	try {
		const parsed = JSON.parse(raw);
		if (
			Array.isArray(parsed) &&
			parsed.length > 0 &&
			parsed.every((value) => typeof value === "string" && value.trim().length > 0)
		) {
			return parsed;
		}
	} catch {
		// Fall through to the structured missing dependency error path.
	}

	throw new Error(`${MCPORTER_COMMAND_ENV} must be a JSON array of command arguments`);
}

function defaultRunner(tool: string, payload: Record<string, unknown>): McporterResult {
	const command = resolveMcporterCommand();
	const [binary, ...prefixArgs] = command;
	if (!binary) {
		throw new Error(`${MCPORTER_COMMAND_ENV} resolved to an empty command`);
	}
	const result = spawnSync(
		binary,
		[
			...prefixArgs,
			"call",
			`notion.${tool}`,
			"--json",
			JSON.stringify(payload),
			"--output",
			"json",
		],
		{
			encoding: "utf8",
			timeout: 120_000,
		},
	);

	return {
		exitCode: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		error: result.error,
	};
}

function requireString(
	flags: Record<string, string | boolean>,
	key: string,
	command: string,
	sideEffect: SideEffect,
): Envelope | string {
	const value = flags[key];
	if (typeof value === "string" && value.trim()) return value.trim();
	return envelope({
		status: "error",
		command,
		sideEffect,
		retry: "safe",
		error: {
			code: "missing_input",
			message: `Missing --${key}.`,
		},
		nextAction: `rerun-with-${key}`,
	});
}

function optionalString(flags: Record<string, string | boolean>, key: string): string {
	const value = flags[key];
	return typeof value === "string" ? value.trim() : "";
}

function numberFlag(flags: Record<string, string | boolean>, key: string, fallback: number): number {
	const value = flags[key];
	if (typeof value !== "string") return fallback;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 1) return fallback;
	return parsed;
}

function callNotion(runner: Runner, tool: string, payload: Record<string, unknown>): McporterResult {
	return runner(tool, Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)));
}

function notionError(
	command: string,
	sideEffect: SideEffect,
	result: McporterResult,
	mutation: Partial<MutationEvidence> = {},
	ownerResolution?: OwnerResolution,
): Envelope {
	return envelope({
		status: "error",
		command,
		sideEffect,
		retry: sideEffect === "read" ? "safe" : "unknown",
		mutation: {
			attempted: mutation.attempted ?? false,
			confirmed: false,
			evidence: mutation.evidence ?? "Notion call did not return success evidence",
		},
		error: {
			code: result.error ? "notion_transport_error" : "notion_call_failed",
			message: result.error?.message || result.stderr.trim() || result.stdout.trim() || "Notion call failed.",
			evidence: {
				exit_code: result.exitCode,
				stderr: result.stderr.trim(),
			},
		},
		ownerResolution,
		nextAction: "run-doctor-or-inspect-notion-error",
	});
}

function queryView(runner: Runner, viewUrl: string, limit: number): Task[] | Envelope {
	const tasks: Task[] = [];
	let cursor = "";

	while (tasks.length < limit) {
		const result = callNotion(runner, "notion-query-database-view", {
			view_url: viewUrl,
			page_size: Math.min(25, limit - tasks.length),
			start_cursor: cursor || undefined,
		});
		if (result.error || result.exitCode !== 0) {
			return notionError("query-view", "read", result);
		}

		const parsed = parseMcporterJson(result);
		const rows = Array.isArray(parsed?.results) ? parsed.results : [];
		tasks.push(
			...rows
				.filter((row): row is RawTask => row !== null && typeof row === "object" && !Array.isArray(row))
				.map(normalizeTask),
		);

		if (parsed?.has_more !== true) break;
		const nextCursor = asString(parsed.next_cursor);
		if (!nextCursor) break;
		cursor = nextCursor;
	}

	return tasks.slice(0, limit);
}

function withOwnerResolution(result: Envelope, ownerResolution: OwnerResolution): Envelope {
	return { ...result, owner_resolution: result.owner_resolution ?? ownerResolution };
}

function inheritedWriteBlocked(command: string, config: TrackerConfig): Envelope {
	return envelope({
		status: "error",
		command,
		sideEffect: "write",
		retry: "safe",
		mutation: {
			attempted: false,
			confirmed: false,
			evidence: "inherited owner write blocked before Notion access",
		},
		ownerResolution: config.ownerResolution,
		error: {
			code: "inherited_owner_write_blocked",
			message:
				"Write command resolved an inherited tracker owner. Rerun from the owner path, pass --owner <path>, or bind this folder first.",
		},
		nextAction: "rerun-with-explicit-owner-or-bind-exact-owner",
	});
}

function resolveCommandTracker(
	command: string,
	sideEffect: SideEffect,
	flags: Record<string, string | boolean>,
	startDir: string,
): TrackerConfig | Envelope {
	const config = resolveTrackerConfig(command, sideEffect, startDir, flags);
	if (!("ownerPath" in config)) return config;
	if (sideEffect === "write" && !config.ownerResolution.write_allowed) {
		return inheritedWriteBlocked(command, config);
	}
	return config;
}

function lookupByTaskId(config: TrackerConfig, runner: Runner, taskId: string): Task[] | Envelope {
	const all = queryView(runner, config.allTasksViewUrl, 100);
	if (!Array.isArray(all)) return all;
	const normalized = normalizeTaskId(taskId);
	return all.filter((task) => task.task_id_number === normalized);
}

function targetFromFlags(flags: Record<string, string | boolean>): TaskTarget {
	return {
		taskId: optionalString(flags, "task-id"),
		pageId: optionalString(flags, "page-id"),
		url: optionalString(flags, "url"),
	};
}

function taskLookupError(
	config: TrackerConfig,
	command: string,
	sideEffect: SideEffect,
	matches: Task[],
): Envelope {
	return envelope({
		status: "error",
		command,
		sideEffect,
		retry: "safe",
		mutation: {
			attempted: false,
			confirmed: false,
			evidence: "lookup returned zero or multiple matches before mutation",
		},
		error: {
			code: matches.length === 0 ? "task_not_found" : "ambiguous_task",
			message:
				matches.length === 0
					? "No matching Coding Task Tracker task found."
					: "Multiple matching Coding Task Tracker tasks found.",
			evidence: { matches: matches.map((task) => task.url) },
		},
		ownerResolution: config.ownerResolution,
		nextAction: matches.length === 0 ? "check-task-id-or-url" : "rerun-with-page-url",
	});
}

function fetchTask(config: TrackerConfig, runner: Runner, command: string, target: TaskTarget): Task[] | Envelope {
	if (target.taskId) {
		return lookupByTaskId(config, runner, target.taskId);
	}

	const id = target.url || target.pageId;
	if (!id) {
		return envelope({
			status: "error",
			command: "get",
			sideEffect: "read",
			retry: "safe",
			error: {
				code: "missing_target",
				message: "Provide --task-id, --page-id, or --url.",
			},
			ownerResolution: config.ownerResolution,
			nextAction: "rerun-with-target",
		});
	}

	const result = callNotion(runner, "notion-fetch", { id });
	if (result.error || result.exitCode !== 0) {
		return notionError(command, "read", result, undefined, config.ownerResolution);
	}
	const parsed = parseMcporterJson(result);
	const task = parsed ? parseTaskFromFetch(config, parsed) : null;
	return task ? [task] : [];
}

function resolveSingleTask(
	config: TrackerConfig,
	runner: Runner,
	command: string,
	flags: Record<string, string | boolean>,
	sideEffect: SideEffect,
): Task | Envelope {
	const matches = fetchTask(config, runner, command, targetFromFlags(flags));
	if (!Array.isArray(matches)) return matches;
	if (matches.length === 1) return matches[0] as Task;

	return taskLookupError(config, command, sideEffect, matches);
}

function dataSourceMismatchError(
	config: TrackerConfig,
	command: string,
	sideEffect: SideEffect,
	evidence: string,
): Envelope {
	return envelope({
		status: "error",
		command,
		sideEffect,
		retry: "safe",
		mutation: {
			attempted: false,
			confirmed: false,
			evidence,
		},
		error: {
			code: "data_source_mismatch",
			message: "Configured Coding Task Tracker data source was not confirmed.",
		},
		ownerResolution: config.ownerResolution,
		nextAction: "inspect-tracker-configuration",
	});
}

function fetchSchemaForWrite(config: TrackerConfig, runner: Runner, command: string): Envelope | null {
	const result = callNotion(runner, "notion-fetch", { id: config.dataSourceUrl });
	if (result.error || result.exitCode !== 0) {
		return notionError(command, "write", result, {
			attempted: false,
			evidence: "schema fetch failed before mutation",
		}, config.ownerResolution);
	}
	const parsed = parseMcporterJson(result);
	const text = asString(parsed?.text);
	if (!dataSourceTextMatches(config.dataSourceUrl, text)) {
		return dataSourceMismatchError(config, command, "write", "schema fetch did not match configured data source");
	}
	return null;
}

function validateDataSourceForRead(config: TrackerConfig, runner: Runner, command: string): Envelope | null {
	const result = callNotion(runner, "notion-fetch", { id: config.dataSourceUrl });
	if (result.error || result.exitCode !== 0) {
		return notionError(command, "read", result, undefined, config.ownerResolution);
	}
	const parsed = parseMcporterJson(result);
	const text = asString(parsed?.text);
	if (!dataSourceTextMatches(config.dataSourceUrl, text)) {
		return dataSourceMismatchError(config, command, "read", "data source validation did not match configured binding");
	}
	return null;
}

function validateViewForRead(config: TrackerConfig, runner: Runner, command: string, viewUrl: string): Envelope | null {
	const tasks = queryView(runner, viewUrl, 1);
	if (!Array.isArray(tasks)) return withOwnerResolution(tasks, config.ownerResolution);
	if (tasks.length === 0) return null;
	const task = tasks[0];
	if (!task) return null;
	const result = callNotion(runner, "notion-fetch", { id: task.page_id || task.url });
	if (result.error || result.exitCode !== 0) {
		return notionError(command, "read", result, undefined, config.ownerResolution);
	}
	const parsed = parseMcporterJson(result);
	if (parsed && parseTaskFromFetch(config, parsed)) return null;
	return envelope({
		status: "error",
		command,
		sideEffect: "read",
		retry: "safe",
		mutation: {
			attempted: false,
			confirmed: false,
			evidence: "view returned a task outside the configured data source",
		},
		ownerResolution: config.ownerResolution,
		error: {
			code: "view_data_source_mismatch",
			message: "Configured view returned a task outside the configured Coding Task Tracker data source.",
			evidence: { view_url: viewUrl, task_id: task.task_id, page_id: task.page_id },
		},
		nextAction: "inspect-tracker-view-binding",
	});
}

function applyTaskProperties(task: Task, properties: Record<string, string>): Task {
	const nextTask: Task = {
		...task,
		status: properties.Status ?? task.status,
		triage_state: properties["Triage State"] ?? task.triage_state,
		category: properties.Category ?? task.category,
		priority: properties.Priority ?? task.priority,
		repo: properties.Repo ?? task.repo,
		branch: properties.Branch ?? task.branch,
		agent: properties.Agent ?? task.agent,
		reference_url: properties["Reference URL"] ?? task.reference_url,
		pull_request: properties["Pull Request"] ?? task.pull_request,
		blocked_reason: properties["Blocked Reason"] ?? task.blocked_reason,
	};
	const pickable = nextTask.status === "Ready" && nextTask.triage_state === "ready-for-agent";
	return {
		...nextTask,
		pickable,
		next_safe_action: taskNextAction({ ...nextTask, pickable }),
	};
}

function validateTaskParentDataSource(
	config: TrackerConfig,
	runner: Runner,
	command: string,
	task: Task,
): Envelope | null {
	const result = callNotion(runner, "notion-fetch", { id: task.page_id || task.url });
	if (result.error || result.exitCode !== 0) {
		return notionError(command, "write", result, {
			attempted: false,
			evidence: "target page parent validation failed before mutation",
		}, config.ownerResolution);
	}
	const parsed = parseMcporterJson(result);
	const verified = parsed ? parseTaskFromFetch(config, parsed) : null;
	if (!verified) {
		return envelope({
			status: "error",
			command,
			sideEffect: "write",
			retry: "safe",
			mutation: {
				attempted: false,
				confirmed: false,
				evidence: "target page parent did not match configured data source",
			},
			ownerResolution: config.ownerResolution,
			error: {
				code: "view_data_source_mismatch",
				message: "Task page could not be proven to belong to the configured Coding Task Tracker data source.",
				evidence: {
					page_id: task.page_id,
					data_source_url: config.dataSourceUrl,
				},
			},
			nextAction: "inspect-tracker-view-binding",
		});
	}
	return null;
}

function updateTask(
	config: TrackerConfig,
	runner: Runner,
	command: string,
	task: Task,
	properties: Record<string, string>,
): Envelope {
	const schemaError = fetchSchemaForWrite(config, runner, command);
	if (schemaError) return schemaError;
	const targetError = validateTaskParentDataSource(config, runner, command, task);
	if (targetError) return targetError;

	const result = callNotion(runner, "notion-update-page", {
		page_id: task.page_id || task.url,
		command: "update_properties",
		properties,
	});
	if (result.error || result.exitCode !== 0) {
		return notionError(command, "write", result, {
			attempted: true,
			evidence: "update request was sent; mutation confirmation unavailable",
		}, config.ownerResolution);
	}

	return envelope({
		status: "ok",
		command,
		sideEffect: "write",
		retry: "unsafe",
		mutation: {
			attempted: true,
			confirmed: true,
			evidence: "notion-update-page returned success",
		},
		ownerResolution: config.ownerResolution,
		data: {
			tracker: trackerEvidence(config),
			task: applyTaskProperties(task, properties),
			changed_properties: Object.keys(properties),
			page_url: task.url,
			page_id: task.page_id,
		},
		nextAction: taskNextAction({
			status: properties.Status ?? task.status,
			triage_state: properties["Triage State"] ?? task.triage_state,
			pickable:
				(properties.Status ?? task.status) === "Ready" &&
				(properties["Triage State"] ?? task.triage_state) === "ready-for-agent",
		}),
	});
}

function createTask(config: TrackerConfig, runner: Runner, flags: Record<string, string | boolean>): Envelope {
	const requiredName = requireString(flags, "name", "create", "write");
	if (typeof requiredName !== "string") return withOwnerResolution(requiredName, config.ownerResolution);

	const category = optionalString(flags, "category") || "enhancement";
	const priority = optionalString(flags, "priority") || "P2";
	if (!isOneOf(category, CATEGORIES)) {
		return withOwnerResolution(invalidOption("create", "write", "category", category, CATEGORIES), config.ownerResolution);
	}
	if (!isOneOf(priority, PRIORITIES)) {
		return withOwnerResolution(invalidOption("create", "write", "priority", priority, PRIORITIES), config.ownerResolution);
	}

	const schemaError = fetchSchemaForWrite(config, runner, "create");
	if (schemaError) return schemaError;

	const properties: Record<string, string> = {
		Name: requiredName,
		Status: "Backlog",
		"Triage State": "needs-triage",
		Category: category,
		Priority: priority,
	};
	const repo = optionalString(flags, "repo") || config.ownerKey;
	const referenceUrl = optionalString(flags, "reference-url");
	if (repo) properties.Repo = repo;
	if (referenceUrl) properties["Reference URL"] = referenceUrl;

	const result = callNotion(runner, "notion-create-pages", {
		parent: { data_source_id: dataSourceIdFromUrl(config.dataSourceUrl) },
		pages: [{ properties }],
	});
	if (result.error || result.exitCode !== 0) {
		return notionError("create", "write", result, {
			attempted: true,
			evidence: "create request was sent; mutation confirmation unavailable",
		}, config.ownerResolution);
	}

	const parsed = parseMcporterJson(result);
	return envelope({
		status: "ok",
		command: "create",
		sideEffect: "write",
		retry: "unsafe",
		mutation: {
			attempted: true,
			confirmed: true,
			evidence: "notion-create-pages returned success",
		},
		ownerResolution: config.ownerResolution,
		data: {
			tracker: trackerEvidence(config),
			properties,
			notion: parsed,
		},
		nextAction: "triage-task",
	});
}

function bindTracker(runner: Runner, flags: Record<string, string | boolean>, startDir = process.cwd()): Envelope {
	const ownerRaw = optionalString(flags, "owner") || ".";
	const ownerPath = path.resolve(startDir, ownerRaw);
	const configPath = path.join(ownerPath, CONFIG_DIR);
	const repoPath = path.join(configPath, REPO_CONFIG_FILE);
	const localPath = path.join(configPath, LOCAL_CONFIG_FILE);
	const existingRepo = parseJsonFile(repoPath);
	const bindResolution = makeOwnerResolution({
		status: "exact",
		source: "bind_target",
		startDir,
		owner_path: ownerPath,
		ancestor_distance: 0,
		config_dir: configPath,
		repo_config_state: existingRepo.state,
		local_config_state: existsSync(localPath) ? parseJsonFile(localPath).state : "missing",
		binding_state: existingRepo.value ? "unverified" : "missing",
		write_allowed: true,
		write_block_reason: null,
	});
	const dataSourceInput =
		optionalString(flags, "data-source") ||
		optionalString(flags, "data-source-url") ||
		optionalString(flags, "collection");
	const readyViewInput = optionalString(flags, "ready-view") || optionalString(flags, "ready-view-url");
	const allTasksViewInput = optionalString(flags, "all-tasks-view") || optionalString(flags, "all-tasks-view-url");

	if (!dataSourceInput || !readyViewInput || !allTasksViewInput) {
		return envelope({
			status: "error",
			command: "bind",
			sideEffect: "write",
			retry: "safe",
			mutation: {
				attempted: false,
				confirmed: false,
				evidence: "input validation failed before config write",
			},
			error: {
				code: "missing_input",
				message: "Provide --data-source, --ready-view, and --all-tasks-view.",
			},
			ownerResolution: bindResolution,
			nextAction: "rerun-bind-with-notion-urls",
		});
	}
	if (!existingRepo.value && !optionalString(flags, "owner-key")) {
		return envelope({
			status: "error",
			command: "bind",
			sideEffect: "write",
			retry: "safe",
			mutation: {
				attempted: false,
				confirmed: false,
				evidence: "new owner bind requires explicit owner key before config write",
			},
			ownerResolution: bindResolution,
			error: {
				code: "missing_input",
				message: "Provide --owner-key when binding a new Coding Task Tracker owner path.",
				evidence: { owner_path: ownerPath },
			},
			nextAction: "rerun-bind-with-owner-key",
		});
	}

	const dataSourceUrl = normalizeDataSourceUrl(dataSourceInput);
	const readyViewUrl = normalizeViewUrl(readyViewInput);
	const allTasksViewUrl = normalizeViewUrl(allTasksViewInput);
	const result = callNotion(runner, "notion-fetch", { id: dataSourceUrl });
	if (result.error || result.exitCode !== 0) {
		return notionError("bind", "write", result, {
			attempted: false,
			evidence: "Notion data source validation failed before config write",
		}, bindResolution);
	}
	const parsed = parseMcporterJson(result);
	const text = asString(parsed?.text);
	if (!dataSourceTextMatches(dataSourceUrl, text)) {
		return envelope({
			status: "error",
			command: "bind",
			sideEffect: "write",
			retry: "safe",
			mutation: {
				attempted: false,
				confirmed: false,
				evidence: "Notion data source validation did not match requested binding",
			},
			error: {
				code: "data_source_mismatch",
				message: "Notion data source did not match the requested binding.",
			},
			ownerResolution: bindResolution,
			nextAction: "inspect-notion-data-source",
		});
	}

	const ownerKey = optionalString(flags, "owner-key") || asString(existingRepo.value?.owner_key) || path.basename(ownerPath);
	const ownerUuid = optionalString(flags, "owner-uuid") || asString(existingRepo.value?.owner_uuid) || randomUUID();
	const repoConfig: RepoTrackerConfig = {
		owner_key: ownerKey,
		owner_uuid: ownerUuid,
		provider: "notion",
	};
	const localConfig: LocalTrackerConfig = {
		data_source_url: dataSourceUrl,
		ready_view_url: readyViewUrl,
		all_tasks_view_url: allTasksViewUrl,
	};

	mkdirSync(configPath, { recursive: true, mode: 0o755 });
	writeFileSync(repoPath, `${JSON.stringify(repoConfig, null, 2)}\n`, { mode: 0o644 });
	writeFileSync(localPath, `${JSON.stringify(localConfig, null, 2)}\n`, { mode: 0o600 });

	return envelope({
		status: "ok",
		command: "bind",
		sideEffect: "write",
		retry: "unsafe",
		mutation: {
			attempted: true,
			confirmed: true,
			evidence: "tracker binding config written after Notion data source validation",
		},
		ownerResolution: {
			...bindResolution,
			owner_key: ownerKey,
			owner_uuid: ownerUuid,
			repo_config_state: "ok",
			local_config_state: "ok",
			binding_state: "bound",
		},
		data: {
			tracker: {
				owner_path: ownerPath,
				owner_key: ownerKey,
				owner_uuid: ownerUuid,
				provider: "notion",
			},
			written: {
				repo_config: repoPath,
				local_config: localPath,
			},
		},
		nextAction: "run-doctor",
	});
}

function frontDoor(flags: Record<string, string | boolean>, startDir = process.cwd()): Envelope {
	const resolved = resolveTrackerConfig("front-door", "read", startDir, flags);
	const ownerResolution = "ownerPath" in resolved ? resolved.ownerResolution : resolved.owner_resolution;
	const tracker = "ownerPath" in resolved ? trackerEvidence(resolved) : null;
	const candidates = frontDoorCandidates(startDir, ownerResolution?.owner_path ?? null);

	return envelope({
		status: "ok",
		command: "front-door",
		sideEffect: "read",
		retry: "safe",
		ownerResolution,
		data: {
			question: "Which part of this repo should own the task tracker?",
			current_path: path.resolve(startDir),
			resolved_tracker: tracker,
			candidates,
			commands: {
				use_owner: "coding-task-tracker --owner <owner_arg> ready --json",
				bind_owner:
					"coding-task-tracker bind --owner <owner_arg> --owner-key <key> --data-source <url> --ready-view <url> --all-tasks-view <url> --json",
				check_owner: "coding-task-tracker --owner <owner_arg> doctor --json",
			},
		},
		nextAction: "choose-tracker-owner-domain",
	});
}

function invalidOption(
	command: string,
	sideEffect: SideEffect,
	key: string,
	value: string,
	options: readonly string[],
): Envelope {
	return envelope({
		status: "error",
		command,
		sideEffect,
		retry: "safe",
		mutation: {
			attempted: false,
			confirmed: false,
			evidence: "input validation failed before mutation",
		},
		error: {
			code: "invalid_option",
			message: `Invalid --${key}: ${value}`,
			evidence: { options },
		},
		nextAction: `rerun-with-valid-${key}`,
	});
}

function targetFlags(flags: Record<string, string | boolean>): boolean {
	return Boolean(optionalString(flags, "task-id") || optionalString(flags, "page-id") || optionalString(flags, "url"));
}

const WRITE_TARGET_COMMANDS = ["claim", "note", "block", "review", "done", "priority", "triage"] as const;

function helpEnvelope(): Envelope {
	return envelope({
		status: "ok",
		command: "help",
		sideEffect: "read",
		retry: "safe",
		data: { help: HELP },
		nextAction: "choose-command",
	});
}

function handleDoctor(command: string, flags: Record<string, string | boolean>, runner: Runner, startDir: string): Envelope {
	const config = resolveCommandTracker(command, "read", flags, startDir);
	if (!("ownerPath" in config)) return config;
	const sourceError = validateDataSourceForRead(config, runner, command);
	if (sourceError) return sourceError;
	const readyError = validateViewForRead(config, runner, command, config.readyViewUrl);
	if (readyError) return readyError;
	const allTasksError = validateViewForRead(config, runner, command, config.allTasksViewUrl);
	if (allTasksError) return allTasksError;
	const result = callNotion(runner, "notion-query-database-view", {
		view_url: config.readyViewUrl,
		page_size: 1,
	});
	if (result.error || result.exitCode !== 0) return notionError(command, "read", result, undefined, config.ownerResolution);
	return envelope({
		status: "ok",
		command,
		sideEffect: "read",
		retry: "safe",
		ownerResolution: config.ownerResolution,
		data: {
			tracker: trackerEvidence(config),
			notion: "reachable",
			data_source_url: config.dataSourceUrl,
			ready_view_url: config.readyViewUrl,
		},
		nextAction: "run-ready",
	});
}

function handleReady(command: string, flags: Record<string, string | boolean>, runner: Runner, startDir: string): Envelope {
	const config = resolveCommandTracker(command, "read", flags, startDir);
	if (!("ownerPath" in config)) return config;
	const tasks = queryView(runner, config.readyViewUrl, numberFlag(flags, "limit", 25));
	if (!Array.isArray(tasks)) return withOwnerResolution(tasks, config.ownerResolution);
	return envelope({
		status: "ok",
		command,
		sideEffect: "read",
		retry: "safe",
		ownerResolution: config.ownerResolution,
		data: { tracker: trackerEvidence(config), tasks, count: tasks.length },
		nextAction:
			config.ownerResolution.status === "inherited"
				? "confirm-owner-before-write"
				: tasks.length > 0
					? "claim-task"
					: "triage-backlog",
	});
}

function handleList(command: string, flags: Record<string, string | boolean>, runner: Runner, startDir: string): Envelope {
	const config = resolveCommandTracker(command, "read", flags, startDir);
	if (!("ownerPath" in config)) return config;
	const status = requireString(flags, "status", command, "read");
	if (typeof status !== "string") return withOwnerResolution(status, config.ownerResolution);
	if (!isOneOf(status, STATUSES)) {
		return withOwnerResolution(invalidOption(command, "read", "status", status, STATUSES), config.ownerResolution);
	}
	const tasks = queryView(runner, config.allTasksViewUrl, numberFlag(flags, "limit", 100));
	if (!Array.isArray(tasks)) return withOwnerResolution(tasks, config.ownerResolution);
	const filtered = tasks.filter((task) => task.status === status);
	return envelope({
		status: "ok",
		command,
		sideEffect: "read",
		retry: "safe",
		ownerResolution: config.ownerResolution,
		data: { tracker: trackerEvidence(config), tasks: filtered, count: filtered.length },
		nextAction:
			config.ownerResolution.status === "inherited"
				? "confirm-owner-before-write"
				: filtered.length > 0
					? "inspect-task"
					: "choose-another-status",
	});
}

function handleGet(command: string, flags: Record<string, string | boolean>, runner: Runner, startDir: string): Envelope {
	const config = resolveCommandTracker(command, "read", flags, startDir);
	if (!("ownerPath" in config)) return config;
	const matches = fetchTask(config, runner, command, targetFromFlags(flags));
	if (!Array.isArray(matches)) return matches;
	if (matches.length !== 1) return taskLookupError(config, command, "read", matches);
	return envelope({
		status: "ok",
		command,
		sideEffect: "read",
		retry: "safe",
		ownerResolution: config.ownerResolution,
		data: { tracker: trackerEvidence(config), task: matches[0] },
		nextAction:
			config.ownerResolution.status === "inherited"
				? "confirm-owner-before-write"
				: (matches[0]?.next_safe_action ?? "inspect-task"),
	});
}

function handleCreate(command: string, flags: Record<string, string | boolean>, runner: Runner, startDir: string): Envelope {
	const config = resolveCommandTracker(command, "write", flags, startDir);
	return "ownerPath" in config ? createTask(config, runner, flags) : config;
}

function missingTargetEnvelope(command: string): Envelope {
	return envelope({
		status: "error",
		command,
		sideEffect: (WRITE_TARGET_COMMANDS as readonly string[]).includes(command) ? "write" : "read",
		retry: "safe",
		error: {
			code: "missing_target",
			message: "Provide --task-id, --page-id, or --url.",
		},
		nextAction: "rerun-with-target",
	});
}

function handleClaim(command: string, flags: Record<string, string | boolean>, runner: Runner, startDir: string): Envelope {
	const config = resolveCommandTracker(command, "write", flags, startDir);
	if (!("ownerPath" in config)) return config;
	const agent = requireString(flags, "agent", command, "write");
	if (typeof agent !== "string") return withOwnerResolution(agent, config.ownerResolution);
	const branch = requireString(flags, "branch", command, "write");
	if (typeof branch !== "string") return withOwnerResolution(branch, config.ownerResolution);
	const task = resolveSingleTask(config, runner, command, flags, "write");
	if (!isTask(task)) return task;
	if (!task.pickable && flags.force !== true) {
		return envelope({
			status: "error",
			command,
			sideEffect: "write",
			retry: "safe",
			mutation: {
				attempted: false,
				confirmed: false,
				evidence: "task was not pickable before mutation",
			},
			error: {
				code: "not_pickable",
				message: "Claim requires Status = Ready and Triage State = ready-for-agent.",
				evidence: { status: task.status, triage_state: task.triage_state },
			},
			ownerResolution: config.ownerResolution,
			nextAction: "triage-task-or-rerun-with-force",
		});
	}
	return updateTask(config, runner, command, task, { Status: "Doing", Agent: agent, Branch: branch });
}

function handleNote(command: string, flags: Record<string, string | boolean>, runner: Runner, startDir: string): Envelope {
	const config = resolveCommandTracker(command, "write", flags, startDir);
	if (!("ownerPath" in config)) return config;
	const message = requireString(flags, "message", command, "write");
	if (typeof message !== "string") return withOwnerResolution(message, config.ownerResolution);
	const task = resolveSingleTask(config, runner, command, flags, "write");
	if (!isTask(task)) return task;
	const schemaError = fetchSchemaForWrite(config, runner, command);
	if (schemaError) return schemaError;
	const targetError = validateTaskParentDataSource(config, runner, command, task);
	if (targetError) return targetError;
	const result = callNotion(runner, "notion-create-comment", {
		page_id: task.page_id || task.url,
		markdown: message,
	});
	if (result.error || result.exitCode !== 0) {
		return notionError(command, "write", result, {
			attempted: true,
			evidence: "comment request was sent; mutation confirmation unavailable",
		}, config.ownerResolution);
	}
	return envelope({
		status: "ok",
		command,
		sideEffect: "write",
		retry: "unsafe",
		mutation: {
			attempted: true,
			confirmed: true,
			evidence: "notion-create-comment returned success",
		},
		ownerResolution: config.ownerResolution,
		data: { tracker: trackerEvidence(config), task, note_length: message.length },
		nextAction: task.next_safe_action,
	});
}

function handleBlock(command: string, flags: Record<string, string | boolean>, runner: Runner, startDir: string): Envelope {
	const config = resolveCommandTracker(command, "write", flags, startDir);
	if (!("ownerPath" in config)) return config;
	const reason = requireString(flags, "reason", command, "write");
	if (typeof reason !== "string") return withOwnerResolution(reason, config.ownerResolution);
	const task = resolveSingleTask(config, runner, command, flags, "write");
	return isTask(task) ? updateTask(config, runner, command, task, { Status: "Blocked", "Blocked Reason": reason }) : task;
}

function handleReview(command: string, flags: Record<string, string | boolean>, runner: Runner, startDir: string): Envelope {
	const config = resolveCommandTracker(command, "write", flags, startDir);
	if (!("ownerPath" in config)) return config;
	const task = resolveSingleTask(config, runner, command, flags, "write");
	if (!isTask(task)) return task;
	const pullRequest = optionalString(flags, "pull-request");
	return updateTask(config, runner, command, task, {
		Status: "Review",
		...(pullRequest ? { "Pull Request": pullRequest } : {}),
	});
}

function handleDone(command: string, flags: Record<string, string | boolean>, runner: Runner, startDir: string): Envelope {
	const config = resolveCommandTracker(command, "write", flags, startDir);
	if (!("ownerPath" in config)) return config;
	const task = resolveSingleTask(config, runner, command, flags, "write");
	return isTask(task) ? updateTask(config, runner, command, task, { Status: "Done" }) : task;
}

function handlePriority(command: string, flags: Record<string, string | boolean>, runner: Runner, startDir: string): Envelope {
	const config = resolveCommandTracker(command, "write", flags, startDir);
	if (!("ownerPath" in config)) return config;
	const priority = requireString(flags, "priority", command, "write");
	if (typeof priority !== "string") return withOwnerResolution(priority, config.ownerResolution);
	if (!isOneOf(priority, PRIORITIES)) {
		return withOwnerResolution(invalidOption(command, "write", "priority", priority, PRIORITIES), config.ownerResolution);
	}
	const task = resolveSingleTask(config, runner, command, flags, "write");
	return isTask(task) ? updateTask(config, runner, command, task, { Priority: priority }) : task;
}

function handleTriage(command: string, flags: Record<string, string | boolean>, runner: Runner, startDir: string): Envelope {
	const config = resolveCommandTracker(command, "write", flags, startDir);
	if (!("ownerPath" in config)) return config;
	const status = optionalString(flags, "status");
	const triageState = optionalString(flags, "triage-state");
	const category = optionalString(flags, "category");
	if (!status && !triageState && !category) {
		return envelope({
			status: "error",
			command,
			sideEffect: "write",
			retry: "safe",
			error: {
				code: "missing_input",
				message: "Provide --status, --triage-state, or --category.",
			},
			ownerResolution: config.ownerResolution,
			nextAction: "rerun-with-status-triage-state-or-category",
		});
	}
	if (status && !isOneOf(status, TRIAGE_STATUSES)) {
		return withOwnerResolution(invalidOption(command, "write", "status", status, TRIAGE_STATUSES), config.ownerResolution);
	}
	if (triageState && !isOneOf(triageState, TRIAGE_STATES)) {
		return withOwnerResolution(
			invalidOption(command, "write", "triage-state", triageState, TRIAGE_STATES),
			config.ownerResolution,
		);
	}
	if (category && !isOneOf(category, CATEGORIES)) {
		return withOwnerResolution(invalidOption(command, "write", "category", category, CATEGORIES), config.ownerResolution);
	}
	const task = resolveSingleTask(config, runner, command, flags, "write");
	return isTask(task)
		? updateTask(config, runner, command, task, {
				...(status ? { Status: status } : {}),
				...(triageState ? { "Triage State": triageState } : {}),
				...(category ? { Category: category } : {}),
			})
		: task;
}

function unknownCommand(command: string): Envelope {
	return envelope({
		status: "error",
		command,
		sideEffect: "read",
		retry: "safe",
		error: {
			code: "unknown_command",
			message: `Unknown command: ${command}`,
		},
		nextAction: "run-help",
	});
}

export function runCommand(parsed: ParsedCli, runner: Runner = defaultRunner, startDir = process.cwd()): Envelope {
	const { command, flags } = parsed;

	try {
		if (parsed.help) return helpEnvelope();
		if ((WRITE_TARGET_COMMANDS as readonly string[]).includes(command) && !targetFlags(flags)) return missingTargetEnvelope(command);

		switch (command) {
			case "front-door":
				return frontDoor(flags, startDir);
			case "bind":
				return bindTracker(runner, flags, startDir);
			case "doctor":
				return handleDoctor(command, flags, runner, startDir);
			case "ready":
				return handleReady(command, flags, runner, startDir);
			case "list":
				return handleList(command, flags, runner, startDir);
			case "get":
				return handleGet(command, flags, runner, startDir);
			case "create":
				return handleCreate(command, flags, runner, startDir);
			case "claim":
				return handleClaim(command, flags, runner, startDir);
			case "note":
				return handleNote(command, flags, runner, startDir);
			case "block":
				return handleBlock(command, flags, runner, startDir);
			case "review":
				return handleReview(command, flags, runner, startDir);
			case "done":
				return handleDone(command, flags, runner, startDir);
			case "priority":
				return handlePriority(command, flags, runner, startDir);
			case "triage":
				return handleTriage(command, flags, runner, startDir);
			default:
				return unknownCommand(command);
		}
	} catch (error) {
		return envelope({
			status: "error",
			command,
			sideEffect: "read",
			retry: "safe",
			error: {
				code: "runtime_error",
				message: (error as Error).message,
			},
			nextAction: "inspect-runtime-error",
		});
	}
}

function renderText(result: Envelope): string {
	if (result.command === "help" && result.status === "ok") {
		const data = result.data as { help?: string };
		return data.help ?? HELP;
	}
	if (result.command === "front-door" && result.status === "ok") {
		const data = result.data as
			| { question?: string; candidates?: FrontDoorCandidate[]; commands?: { use_owner?: string; bind_owner?: string } }
			| undefined;
		const candidates = data?.candidates ?? [];
		const candidateText =
			candidates.length === 0
				? "No owner candidates found yet."
				: candidates
						.map((candidate) => {
							const marker = candidate.recommended ? " [recommended]" : "";
							const configured = candidate.configured ? "configured" : "not bound";
							return `- ${candidate.owner_arg}${marker} (${configured}) ${candidate.label}`;
						})
						.join("\n");
		return `${data?.question ?? "Which part of this repo should own the task tracker?"}\n\n${candidateText}\n\nnext: ${result.next_action}`;
	}
	if (result.status === "error") {
		return `${result.error?.code ?? "error"}: ${result.error?.message ?? "Command failed"}\nnext: ${result.next_action}`;
	}
	const data = result.data as { tasks?: Task[]; task?: Task; count?: number } | undefined;
	if (Array.isArray(data?.tasks)) {
		if (data.tasks.length === 0) return `No tasks.\nnext: ${result.next_action}`;
		return data.tasks
			.map((task) => `${task.task_id || "TASK-?"} ${task.status}/${task.triage_state} ${task.name}\n${task.url}`)
			.join("\n\n");
	}
	if (data?.task) {
		const task = data.task;
		return `${task.task_id} ${task.status}/${task.triage_state}\n${task.name}\n${task.url}\nnext: ${task.next_safe_action}`;
	}
	return `OK: ${result.command}\nnext: ${result.next_action}`;
}

function main(): void {
	const parsed = parseCli(process.argv.slice(2));
	const result = runCommand(parsed);
	if (parsed.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		const output = renderText(result);
		if (result.status === "error") {
			console.error(output);
		} else {
			console.log(output);
		}
	}
	process.exitCode = result.status === "ok" ? 0 : 1;
}

if (import.meta.main) {
	main();
}
