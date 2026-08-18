import { isAbsolute } from "node:path";
import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import type {
	McporterCommandInput,
	McporterCommandResult,
} from "./mcporter-transport";
import { semanticClickInputIsValid } from "./browser-use-agent-browser-semantics";
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
	/** Canonical target URL admitted before the Target Lease was acquired. */
	expected_target_url?: string;
	intent: PlaywrightTaskIntent;
	mutation?: {
		role: string;
		name: string;
		visible_selector: string;
	};
};

/**
 * Shell-free process seam used by the Playwright CLI lane.
 */
export type PlaywrightTaskRuntime = {
	runCommand(input: McporterCommandInput): Promise<McporterCommandResult>;
	beforeMutationDispatch?: (input: {
		run_id: string;
	}) => Promise<{ ok: boolean }>;
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
	| "playwright_task_ref_invalid"
	| "playwright_task_mutation_marker_unavailable"
	| "playwright_task_mutation_effect_unknown"
	| "playwright_task_postcondition_not_achieved"
	| "playwright_task_detach_failed";

/**
 * Read-only Playwright lane outcome projected into the shared run mapper.
 */
export type PlaywrightTaskResult =
	| {
			ok: true;
			outcome: "confirmed";
			executed_commands: number;
			mutation_dispatched: boolean;
	  }
	| {
			ok: false;
			outcome: "not-achieved" | "unknown";
			code: PlaywrightTaskFailureCode;
			message: string;
			mutation_dispatched: boolean;
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
			const observedUrl = pageUrlOf(snapshot?.stdout ?? "");
			if (
				observedOrigin === undefined ||
				!validated.allowedOrigins.has(observedOrigin) ||
				(task.expected_target_url !== undefined &&
					normalizedHttpUrl(observedUrl ?? "") !==
						normalizedHttpUrl(task.expected_target_url))
			) {
				taskOutcome = failure(
					"playwright_task_origin_refused",
					"Playwright CLI snapshot evidence did not prove an allowed page origin.",
				);
			} else if (task.mutation === undefined) {
				taskOutcome = {
					ok: true,
					outcome: "confirmed",
					executed_commands: 4,
					mutation_dispatched: false,
				};
			} else {
				const ref = resolveUniqueSemanticRef(snapshot?.stdout ?? "", {
					role: task.mutation.role,
					name: task.mutation.name,
				});
				if (ref === undefined) {
					taskOutcome = failure(
						"playwright_task_ref_invalid",
						"Playwright CLI could not resolve exactly one current snapshot ref for the semantic target.",
					);
				} else if (
					runtime.beforeMutationDispatch === undefined ||
					!(await runtime.beforeMutationDispatch({ run_id: task.run_id })).ok
				) {
					taskOutcome = failure(
						"playwright_task_mutation_marker_unavailable",
						"Playwright CLI refused the click because mutation dispatch truth could not be persisted first.",
					);
				} else {
					const click = await runSessionCommand(
						runtime,
						executable,
						session,
						["click", ref],
					);
					if (!commandSucceeded(click)) {
						taskOutcome = failure(
							"playwright_task_mutation_effect_unknown",
							"Playwright CLI could not prove whether the dispatched click changed the page.",
							"unknown",
							true,
						);
					} else {
						const postcondition = await runSessionCommand(
							runtime,
							executable,
							session,
							[
								"--raw",
								"eval",
								"el => !!(el && el.isConnected && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0)",
								task.mutation.visible_selector,
							],
						);
						if (!commandSucceeded(postcondition)) {
							taskOutcome = failure(
								"playwright_task_mutation_effect_unknown",
								"Playwright CLI could not obtain fresh structure after the dispatched click.",
								"unknown",
								true,
							);
						} else if (!booleanTrueResult(postcondition?.stdout ?? "")) {
							taskOutcome = failure(
								"playwright_task_postcondition_not_achieved",
								"Fresh Playwright structure did not satisfy the declared mutation postcondition.",
								"not-achieved",
								true,
							);
						} else {
							taskOutcome = {
								ok: true,
								outcome: "confirmed",
								executed_commands: 6,
								mutation_dispatched: true,
							};
						}
					}
				}
			}
		}
	}

	const detach = await runSessionCommand(runtime, executable, session, [
		"detach",
	]);
	if (!commandSucceeded(detach)) {
		return failure(
			"playwright_task_detach_failed",
			"Playwright CLI evidence completed but the named session did not detach cleanly.",
			taskOutcome.mutation_dispatched ? "unknown" : "not-achieved",
			taskOutcome.mutation_dispatched,
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
			task.intent !== "locator-aria-assertion") ||
		(task.mutation !== undefined &&
			!semanticClickInputIsValid({
				role: task.mutation.role,
				name: task.mutation.name,
				visibleSelector: task.mutation.visible_selector,
			}))
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
	const pageUrl = pageUrlOf(stdout);
	if (pageUrl === undefined) return undefined;
	try {
		return new URL(pageUrl).origin;
	} catch {
		return undefined;
	}
}

function pageUrlOf(stdout: string): string | undefined {
	return stdout.match(/^- Page URL:\s*(\S+)\s*$/m)?.[1];
}

function normalizedHttpUrl(value: string): string | undefined {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:"
			? parsed.href
			: undefined;
	} catch {
		return undefined;
	}
}

/** Resolve one Playwright tab index to its current exact URL and detach. */
export async function resolvePlaywrightTaskPageUrl(
	runtime: PlaywrightTaskRuntime,
	task: PlaywrightTask,
): Promise<{ ok: true; url: string } | { ok: false }> {
	const validated = validateTask(task);
	if (!validated.ok) return { ok: false };
	const session = `browser-use-${task.run_id}`;
	const executable = task.handoff.attachment.probe_executable;
	const attach = await runNative(runtime, {
		command: executable,
		args: ["attach", `--cdp=${task.handoff.endpoint.http}`, `--session=${session}`],
		timeoutMs: COMMAND_TIMEOUT_MS,
	});
	if (!commandSucceeded(attach)) return { ok: false };
	const selected = await runSessionCommand(runtime, executable, session, [
		"tab-select",
		String(task.target_tab_index),
	]);
	const snapshot = commandSucceeded(selected)
		? await runSessionCommand(runtime, executable, session, ["snapshot"])
		: undefined;
	const detached = await runSessionCommand(runtime, executable, session, ["detach"]);
	if (!commandSucceeded(snapshot) || !commandSucceeded(detached)) return { ok: false };
	const url = pageUrlOf(snapshot?.stdout ?? "");
	const origin = pageOriginOf(snapshot?.stdout ?? "");
	return url !== undefined && origin !== undefined && validated.allowedOrigins.has(origin)
		? { ok: true, url }
		: { ok: false };
}

function resolveUniqueSemanticRef(
	stdout: string,
	target: { role: string; name: string },
): string | undefined {
	const matches: string[] = [];
	for (const line of stdout.split("\n")) {
		const match = line.match(
			/^\s*-\s+([A-Za-z][A-Za-z0-9_-]{0,63})\s+("(?:[^"\\]|\\.)*")((?:\s+\[[^\]\r\n]{1,128}\])*)\s*:?\s*$/,
		);
		if (match === null || match[1] !== target.role) continue;
		let name: string;
		try {
			name = JSON.parse(match[2] ?? "");
		} catch {
			continue;
		}
		const ref = match[3]?.match(
			/(?:^|\s)\[ref=([A-Za-z][A-Za-z0-9_-]{0,127})\](?:\s|$)/,
		)?.[1];
		if (name === target.name && ref !== undefined) matches.push(ref);
	}
	return matches.length === 1 ? matches[0] : undefined;
}

function booleanTrueResult(stdout: string): boolean {
	return stdout
		.split("\n")
		.some((line) => line.trim() === "true");
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
	outcome: "not-achieved" | "unknown" = "not-achieved",
	mutationDispatched = false,
): PlaywrightTaskResult {
	return {
		ok: false,
		outcome,
		code,
		message,
		mutation_dispatched: mutationDispatched,
	};
}
