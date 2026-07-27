import { isAbsolute } from "node:path";
import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import type {
	McporterCommandInput,
	McporterCommandResult,
} from "./mcporter-transport";
import { SAFE_RUN_ID } from "./browser-use-identifiers";

const HANDOFF_CONTRACT_ID = "browser-connect.verified-handoff";
const HANDOFF_SCHEMA_VERSION = "2";
const COMMAND_TIMEOUT_MS = 30_000;

/**
 * Playwright intents supported by the first read-only execution slice.
 *
 * Trace inspection and HTTP replay remain unavailable until Browser Use owns
 * their artifact and archive-input contracts.
 */
export type PlaywrightTaskIntent =
	| "frontend-test"
	| "locator-aria-assertion";

/**
 * Verified Browser Connect payload consumed by the Playwright lane.
 */
export type PlaywrightTaskVerifiedHandoff = BrowserConnectHandoffPayload & {
	contract_id: string;
	schema_version: string;
};

/**
 * One bounded Playwright CLI snapshot task against an exact tab and origin.
 */
export type PlaywrightTask = {
	handoff: PlaywrightTaskVerifiedHandoff;
	run_id: string;
	target_tab_index: number;
	allowed_origins: readonly string[];
	intent: PlaywrightTaskIntent;
};

/**
 * Shell-free process seam used by the Playwright CLI lane.
 */
export type PlaywrightTaskRuntime = {
	runCommand(input: McporterCommandInput): Promise<McporterCommandResult>;
};

/**
 * Stable Playwright lane refusal classes.
 */
export type PlaywrightTaskFailureCode =
	| "playwright_task_handoff_invalid"
	| "playwright_task_input_invalid"
	| "playwright_task_connection_unstable"
	| "playwright_task_tab_unavailable"
	| "playwright_task_command_failed"
	| "playwright_task_origin_refused"
	| "playwright_task_detach_failed";

/**
 * Read-only Playwright lane outcome projected into the shared run mapper.
 */
export type PlaywrightTaskResult =
	| {
			ok: true;
			outcome: "confirmed";
			executed_commands: number;
	  }
	| {
			ok: false;
			outcome: "not-achieved";
			code: PlaywrightTaskFailureCode;
			message: string;
	  };

/**
 * Execute one read-only Playwright snapshot through a verified CDP handoff.
 *
 * The lane attaches a run-scoped named session, selects the caller's numeric
 * tab, checks the snapshot's fresh Page URL against exact allowed origins, and
 * always detaches without closing Agent Chrome.
 *
 * @param runtime - Shell-free process runner
 * @param task - Verified handoff and bounded snapshot request
 * @returns Confirmed snapshot evidence or one typed refusal
 */
export async function executePlaywrightTask(
	runtime: PlaywrightTaskRuntime,
	task: PlaywrightTask,
): Promise<PlaywrightTaskResult> {
	const validated = validateTask(task);
	if (!validated.ok) return validated.failure;

	const session = `browser-use-${task.run_id}`;
	const executable = task.handoff.attachment.probe_executable;
	const attach = await runNative(runtime, {
		command: executable,
		args: [
			"attach",
			`--cdp=${task.handoff.endpoint.http}`,
			`--session=${session}`,
		],
		timeoutMs: COMMAND_TIMEOUT_MS,
	});
	if (!commandSucceeded(attach)) {
		return failure(
			"playwright_task_connection_unstable",
			"Playwright CLI could not attach to the verified CDP endpoint.",
		);
	}

	let taskOutcome: PlaywrightTaskResult;
	const select = await runSessionCommand(runtime, executable, session, [
		"tab-select",
		String(task.target_tab_index),
	]);
	if (!commandSucceeded(select)) {
		taskOutcome = failure(
			"playwright_task_tab_unavailable",
			"Playwright CLI could not select the requested tab index.",
		);
	} else {
		const snapshot = await runSessionCommand(runtime, executable, session, [
			"snapshot",
		]);
		if (!commandSucceeded(snapshot)) {
			taskOutcome = failure(
				"playwright_task_command_failed",
				"Playwright CLI could not capture a fresh accessibility snapshot.",
			);
		} else {
			const observedOrigin = pageOriginOf(snapshot?.stdout ?? "");
			taskOutcome =
				observedOrigin !== undefined &&
				validated.allowedOrigins.has(observedOrigin)
					? {
							ok: true,
							outcome: "confirmed",
							executed_commands: 4,
						}
					: failure(
							"playwright_task_origin_refused",
							"Playwright CLI snapshot evidence did not prove an allowed page origin.",
						);
		}
	}

	const detach = await runSessionCommand(runtime, executable, session, [
		"detach",
	]);
	if (!commandSucceeded(detach)) {
		return failure(
			"playwright_task_detach_failed",
			"Playwright CLI evidence completed but the named session did not detach cleanly.",
		);
	}
	return taskOutcome;
}

function validateTask(
	task: PlaywrightTask,
):
	| { ok: true; allowedOrigins: ReadonlySet<string> }
	| { ok: false; failure: PlaywrightTaskResult } {
	if (
		task.handoff.contract_id !== HANDOFF_CONTRACT_ID ||
		task.handoff.schema_version !== HANDOFF_SCHEMA_VERSION ||
		task.handoff.outcome !== "verified" ||
		task.handoff.browser_entry_mode !== "explicit-cdp" ||
		task.handoff.attachment.adapter_id !== "playwright-cdp" ||
		task.handoff.attachment.route !== "explicit-cdp" ||
		task.handoff.proof.route_evidence !== "verified-live" ||
		!isAbsolute(task.handoff.attachment.probe_executable)
	) {
		return {
			ok: false,
			failure: failure(
				"playwright_task_handoff_invalid",
				"Playwright execution requires a schema-2 verified-live handoff for the playwright-cdp lane.",
			),
		};
	}
	if (
		!SAFE_RUN_ID.test(task.run_id) ||
		!Number.isSafeInteger(task.target_tab_index) ||
		task.target_tab_index < 0 ||
		(task.intent !== "frontend-test" &&
			task.intent !== "locator-aria-assertion")
	) {
		return {
			ok: false,
			failure: failure(
				"playwright_task_input_invalid",
				"Playwright execution requires a bounded run id, supported intent, and non-negative tab index.",
			),
		};
	}
	const allowedOrigins = exactOriginSet(task.allowed_origins);
	if (allowedOrigins === undefined) {
		return {
			ok: false,
			failure: failure(
				"playwright_task_input_invalid",
				"Playwright execution requires at least one exact HTTP(S) allowed origin.",
			),
		};
	}
	return { ok: true, allowedOrigins };
}

function exactOriginSet(
	origins: readonly string[],
): ReadonlySet<string> | undefined {
	if (origins.length === 0) return undefined;
	const admitted = new Set<string>();
	for (const origin of origins) {
		try {
			const parsed = new URL(origin);
			if (
				(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
				parsed.origin !== origin
			) {
				return undefined;
			}
			admitted.add(parsed.origin);
		} catch {
			return undefined;
		}
	}
	return admitted;
}

function pageOriginOf(stdout: string): string | undefined {
	const pageUrl = stdout.match(/^- Page URL:\s*(\S+)\s*$/m)?.[1];
	if (pageUrl === undefined) return undefined;
	try {
		return new URL(pageUrl).origin;
	} catch {
		return undefined;
	}
}

async function runSessionCommand(
	runtime: PlaywrightTaskRuntime,
	executable: string,
	session: string,
	args: readonly string[],
): Promise<McporterCommandResult | undefined> {
	return runNative(runtime, {
		command: executable,
		args: [`--session=${session}`, ...args],
		timeoutMs: COMMAND_TIMEOUT_MS,
	});
}

async function runNative(
	runtime: PlaywrightTaskRuntime,
	input: McporterCommandInput,
): Promise<McporterCommandResult | undefined> {
	try {
		return await runtime.runCommand(input);
	} catch {
		return undefined;
	}
}

function commandSucceeded(
	result: McporterCommandResult | undefined,
): boolean {
	return (
		result !== undefined &&
		result.exitCode === 0 &&
		result.timedOut !== true
	);
}

function failure(
	code: PlaywrightTaskFailureCode,
	message: string,
): PlaywrightTaskResult {
	return { ok: false, outcome: "not-achieved", code, message };
}
