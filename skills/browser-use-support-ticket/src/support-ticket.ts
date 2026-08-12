import { createHash, randomUUID } from "node:crypto"
import {
	COMMAND_OUTCOMES,
	COMMAND_SIDE_EFFECTS,
	COMMAND_NAME,
	CONTRACT_ID,
	EXTERNAL_EFFECTS,
	HELP_TEXT,
	PRIVACY_CLASSIFICATIONS,
	PRIVACY_REVIEWERS,
	RETRY_DISPOSITIONS,
	SCHEMA_VERSION,
	SUPPORT_COMPONENTS,
	SUPPORT_FAILURE_KINDS,
	SUPPORT_GITHUB_LOGIN,
	SUPPORT_LABEL,
	SUPPORT_REPOSITORY,
	SUPPORT_STATUSES,
} from "./command-contract"

const MAX_COMMANDS = 100
const MAX_FIELD_CHARS = 4_000
const MAX_COMMAND_CHARS = 2_000
const MAX_DIAGNOSTICS = 50
const MAX_REDACTIONS = 20
const MAX_TOOL_VERSIONS = 20
const MAX_ISSUE_BODY_CHARS = 60_000

/** One complete shell command plus its observed result and effect boundary. */
export interface SupportTicketCommand {
	/** Full shell command after public-safe redaction. */
	command: string
	/** Observed terminal result. */
	outcome: SupportTicketCommandOutcome
	/** Stable tool error code when one exists. */
	errorCode?: string
	/** Process exit status when one exists. */
	exitCode?: number
	/** Externally visible effect attributable to this command. */
	sideEffect: SupportTicketCommandSideEffect
	/** Optional bounded context; never a raw log. */
	note?: string
}

/** Structured evidence supplied by the Browser Use driver after a toolchain defect. */
export interface SupportTicketInput {
	/** Browser Use toolchain owner implicated by the evidence. */
	component: SupportTicketComponent
	/** Defect boundary that decides which evidence proves a support-worthy failure. */
	failureKind: SupportTicketFailureKind
	/** User-visible state caused by the defect. */
	status: SupportTicketStatus
	/** Stable machine-readable defect code. */
	errorCode: string
	/** Stable component, workflow, or contract location where the defect surfaced. */
	failureLocus: string
	/** Public-safe identifier for this occurrence and its private diagnostics. */
	correlationId: string
	/** Public-safe paraphrase of the requested outcome; never the raw prompt. */
	requestSummary: string
	/** Short defect statement used to build the issue title. */
	summary: string
	/** User-visible consequence of the failure. */
	impact: string
	/** Intended Browser Use behavior. */
	expected: string
	/** Observed Browser Use behavior. */
	actual: string
	/** Smallest repeatable description that reaches the failure. */
	minimalReproduction: string
	/** Known state of any externally visible browser mutation. */
	externalEffect: SupportTicketExternalEffect
	/** Same-input retry decision and one next safe action. */
	retry: {
		disposition: SupportTicketRetryDisposition
		nextAction: string
	}
	/** Complete ordered shell command history with per-step outcomes. */
	commands: SupportTicketCommand[]
	/** Bounded diagnostic facts, never raw secret-bearing logs. */
	diagnostics?: string[]
	/** Evidence that the runtime, route, or prose outcome failed its contract. */
	failureEvidence: string[]
	/** Safe runtime metadata that helps maintainers reproduce the defect. */
	environment?: {
		harness?: string
		operatingSystem?: string
		toolVersions?: Record<string, string>
		sourceRevision?: string
		installChannel?: string
	}
	/** Explicit classification for the public GitHub publication boundary. */
	privacy: {
		classification: SupportTicketPrivacyClassification
		reviewedBy: SupportTicketPrivacyReviewer
		redactions: string[]
	}
}

/** Browser Use defect classes accepted by the support-ticket runtime. */
export type SupportTicketFailureKind = (typeof SUPPORT_FAILURE_KINDS)[number]

/** Browser Use CLI, adapter, or supporting runtime named by the evidence. */
export type SupportTicketComponent = (typeof SUPPORT_COMPONENTS)[number]

/** User-visible status accepted by the ticket contract. */
export type SupportTicketStatus = (typeof SUPPORT_STATUSES)[number]

/** External-effect states accepted by the ticket contract. */
export type SupportTicketExternalEffect = (typeof EXTERNAL_EFFECTS)[number]

/** Same-input retry states accepted by the ticket contract. */
export type SupportTicketRetryDisposition = (typeof RETRY_DISPOSITIONS)[number]

/** Per-command outcomes accepted by the ticket contract. */
export type SupportTicketCommandOutcome = (typeof COMMAND_OUTCOMES)[number]

/** Per-command effects accepted by the ticket contract. */
export type SupportTicketCommandSideEffect = (typeof COMMAND_SIDE_EFFECTS)[number]

/** Publication classes accepted by the public issue gate. */
export type SupportTicketPrivacyClassification = (typeof PRIVACY_CLASSIFICATIONS)[number]

/** Public-data reviewers accepted by the ticket contract. */
export type SupportTicketPrivacyReviewer = (typeof PRIVACY_REVIEWERS)[number]

/** Sanitized GitHub issue content plus its duplicate-detection identity. */
export interface BuiltSupportTicket {
	/** Bounded issue title. */
	title: string
	/** Public-safe Markdown support-ticket body. */
	body: string
	/** Stable digest of normalized defect identity. */
	fingerprint: string
	/** Hidden issue-body marker used for duplicate lookup. */
	marker: string
	/** Current and legacy markers accepted during duplicate lookup. */
	duplicateMarkers: string[]
	/** Digest binding the reviewed title and body to the file action. */
	contentDigest: string
}

/** Result of one GitHub CLI subprocess. */
export interface GithubCommandResult {
	/** Process exit status. */
	exitCode: number
	/** Captured standard output. */
	stdout: string
	/** Captured standard error. */
	stderr: string
}

/** Narrow GitHub process boundary used by production and deterministic tests. */
export interface GithubRuntime {
	/**
	 * Run one `gh` command without shell interpolation.
	 *
	 * @param args - Arguments after the `gh` executable.
	 * @param stdin - Optional issue body delivered over standard input.
	 * @returns Captured process result.
	 *
	 * @example
	 * ```ts
	 * runtime.run(["api", "user", "--jq", ".login"])
	 * ```
	 */
	run(args: string[], stdin?: string): GithubCommandResult
}

/** Outcome returned after duplicate inspection and optional issue creation. */
export interface FileSupportTicketResult {
	/** Whether a new issue was created or an existing issue absorbed the report. */
	outcome: "created" | "deduplicated"
	/** GitHub issue number when it can be derived. */
	issueNumber?: number
	/** Public issue URL. */
	issueUrl: string
	/** Duplicate fingerprint written into the issue body. */
	fingerprint: string
	/** Digest of the exact reviewed title and body. */
	contentDigest: string
}

/** Parsed CLI invocation after fail-closed flag validation. */
export type ParsedSupportTicketArgs =
	| { kind: "help" }
	| {
			kind: "run"
			command: "preview" | "file"
			inputPath: string
			json: boolean
			execute: boolean
			previewDigest?: string
	  }

class SupportTicketError extends Error {
	constructor(
		readonly code: string,
		readonly exitCode: number,
		readonly nextAction: string,
		readonly sameInputRetry: "safe-after-repair" | "unsafe" | "reconcile-first" =
			"safe-after-repair",
	) {
		super(code)
		this.name = "SupportTicketError"
	}
}

function escapedRegExp(value: string): RegExp {
	return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
}

function redactUrl(rawUrl: string): string {
	try {
		const url = new URL(rawUrl)
		const authBearing =
			/accounts\.google\.com$/i.test(url.hostname) ||
			/(?:oauth|signin|challenge|callback)/i.test(url.pathname) ||
			[...url.searchParams.keys()].some((key) =>
				/(?:token|code|state|secret|client_id|challenge)/i.test(key),
			)
		if (authBearing) return "<redacted-auth-url>"
		if (/^wss?:$/.test(url.protocol) || /\/devtools\//i.test(url.pathname)) {
			return `${url.protocol}//${url.host}/[REDACTED]`
		}
		if (url.search || url.hash) return `${url.origin}${url.pathname}?<redacted>`
		return rawUrl
	} catch {
		return "<redacted-url>"
	}
}

/**
 * Remove secret values and public-repository identity leaks from support text.
 *
 * @param input - Command, diagnostic, or narrative text to sanitize.
 * @param homeDirectory - Home path replaced with the portable `$HOME` token.
 * @returns Sanitized text for the public-support review gate.
 *
 * @example
 * ```ts
 * redactSupportText("TOKEN=secret tool --password value", "/Users/me")
 * ```
 */
export function redactSupportText(input: string, homeDirectory = process.env.HOME ?? ""): string {
	let output = input
	if (homeDirectory.length > 1) output = output.replace(escapedRegExp(homeDirectory), "$HOME")
	output = output.replace(/\/(?:Users|home)\/[^/\s'"`]+/g, "$HOME")
	output = output.replace(/[A-Za-z]:\\Users\\[^\\\s'"`]+/gi, "%USERPROFILE%")
	output = output.replace(
		/\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|COOKIE|API_KEY|AUTH)[A-Z0-9_]*=(?:'[^']*'|"[^"]*"|[^\s]+)/gi,
		(match) => `${match.slice(0, match.indexOf("=") + 1)}[REDACTED]`,
	)
	output = output.replace(/\bAuthorization\s*:\s*(?:Bearer|Basic)\s+[^\s]+/gi, "Authorization: [REDACTED]")
	output = output.replace(
		/(--(?:access-token|api-key|auth-url|client-secret|cookie|password|secret|token))(?:=|\s+)(?:'[^']*'|"[^"]*"|[^\s]+)/gi,
		"$1 [REDACTED]",
	)
	output = output.replace(/\bop:\/\/[^\s'"`]+/gi, "op://[REDACTED]")
	output = output.replace(/\bgh[opsu]_[A-Za-z0-9_]+\b/g, "[REDACTED_GITHUB_TOKEN]")
	output = output.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_API_KEY]")
	output = output.replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_KEY]")
	output = output.replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g, "[REDACTED_SLACK_TOKEN]")
	output = output.replace(
		/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
		"[REDACTED_JWT]",
	)
	output = output.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
	output = output.replace(/\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED_IP]")
	output = output.replace(/\b(?:https?|wss?):\/\/[^\s'"`<>]+/gi, redactUrl)
	return output
}

function requiredText(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new SupportTicketError(`invalid_${field}`, 3, `Provide a non-empty ${field} field.`)
	}
	return value.trim().slice(0, MAX_FIELD_CHARS)
}

function requiredTextList(
	value: unknown,
	field: string,
	minimum: number,
	maximum: number,
	itemLimit: number,
): string[] {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
		throw new SupportTicketError(
			`invalid_${field}`,
			3,
			`Provide ${minimum}-${maximum} ordered ${field} entries.`,
		)
	}
	return value.map((item) => requiredText(item, field).slice(0, itemLimit))
}

function optionalTextList(value: unknown, field: string): string[] {
	if (value === undefined) return []
	if (!Array.isArray(value) || value.length > MAX_DIAGNOSTICS) {
		throw new SupportTicketError(
			`invalid_${field}`,
			3,
			`Provide at most ${MAX_DIAGNOSTICS} ${field} entries.`,
		)
	}
	return value.map((item) => requiredText(item, field).slice(0, MAX_FIELD_CHARS))
}

function requiredEnum<T extends string>(
	value: unknown,
	field: string,
	values: readonly T[],
): T {
	if (typeof value !== "string" || !values.includes(value as T)) {
		throw new SupportTicketError(
			`invalid_${field}`,
			3,
			`Use one declared ${field}: ${values.join(", ")}.`,
		)
	}
	return value as T
}

function requiredIdentifier(value: unknown, field: string, pattern: RegExp): string {
	const text = requiredText(value, field)
	if (!pattern.test(text)) {
		throw new SupportTicketError(`invalid_${field}`, 3, `Provide a stable public-safe ${field}.`)
	}
	return text
}

function optionalInteger(value: unknown, field: string): number | undefined {
	if (value === undefined) return undefined
	if (!Number.isInteger(value) || (value as number) < -1 || (value as number) > 255) {
		throw new SupportTicketError(`invalid_${field}`, 3, `Provide a process exit code from -1 to 255.`)
	}
	return value as number
}

function requiredObject(value: unknown, field: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new SupportTicketError(`invalid_${field}`, 3, `Provide one ${field} object.`)
	}
	return value as Record<string, unknown>
}

function sanitizeCommands(
	value: unknown,
	homeDirectory: string,
): SupportTicketCommand[] {
	if (!Array.isArray(value) || value.length > MAX_COMMANDS) {
		throw new SupportTicketError(
			"invalid_commands",
			3,
			`Provide 0-${MAX_COMMANDS} ordered command records.`,
		)
	}
	return value.map((raw, index) => {
		const step = requiredObject(raw, `commands_${index + 1}`)
		return {
			command: redactSupportText(
				requiredText(step.command, `commands_${index + 1}_command`).slice(0, MAX_COMMAND_CHARS),
				homeDirectory,
			),
			outcome: requiredEnum(
				step.outcome,
				`commands_${index + 1}_outcome`,
				COMMAND_OUTCOMES,
			),
			errorCode:
				step.errorCode === undefined
					? undefined
					: requiredIdentifier(
							step.errorCode,
							`commands_${index + 1}_errorCode`,
							/^[A-Za-z0-9][A-Za-z0-9_.:-]{1,127}$/,
						),
			exitCode: optionalInteger(step.exitCode, `commands_${index + 1}_exitCode`),
			sideEffect: requiredEnum(
				step.sideEffect,
				`commands_${index + 1}_sideEffect`,
				COMMAND_SIDE_EFFECTS,
			),
			note:
				step.note === undefined
					? undefined
					: redactSupportText(requiredText(step.note, `commands_${index + 1}_note`), homeDirectory),
		}
	})
}

function sanitizeToolVersions(value: unknown, homeDirectory: string): Record<string, string> {
	if (value === undefined) return {}
	const versions = requiredObject(value, "environment_toolVersions")
	const entries = Object.entries(versions)
	if (entries.length > MAX_TOOL_VERSIONS) {
		throw new SupportTicketError(
			"invalid_environment_toolVersions",
			3,
			`Provide at most ${MAX_TOOL_VERSIONS} tool versions.`,
		)
	}
	return Object.fromEntries(
		entries.map(([tool, version]) => [
			requiredIdentifier(tool, "environment_toolName", /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/),
			redactSupportText(requiredText(version, "environment_toolVersion"), homeDirectory),
		]),
	)
}

function assertNoPrivateKey(text: string): void {
	if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i.test(text)) {
		throw new SupportTicketError(
			"sensitive_public_content",
			3,
			"Remove the private key material and rotate the exposed key before any public filing.",
			"unsafe",
		)
	}
}

function commandStep(step: SupportTicketCommand, index: number): string {
	const metadata = [
		`Outcome: \`${step.outcome}\``,
		`Side effect: \`${step.sideEffect}\``,
		step.errorCode ? `Error: \`${step.errorCode}\`` : null,
		step.exitCode !== undefined ? `Exit: \`${step.exitCode}\`` : null,
	].filter((item): item is string => item !== null)
	const note = step.note ? `\n\n   ${step.note.replace(/\n/g, " ")}` : ""
	return `${index + 1}. ${metadata.join("; ")}\n\n   \`\`\`sh\n   ${step.command.replace(/```/g, "''' ")}\n   \`\`\`${note}`
}

function bulletList(items: string[]): string {
	return items.map((item) => `- ${item.replace(/\n/g, " ")}`).join("\n")
}

function tableValue(value: string): string {
	return value.replace(/\|/g, "\\|").replace(/\n/g, " ")
}

function jsonCodeBlock(value: unknown): string {
	return JSON.stringify(value, null, 2).replace(/```/g, "\\u0060\\u0060\\u0060")
}

/**
 * Validate, redact, and render one public Browser Use support ticket.
 *
 * @param input - Driver-supplied Browser Use toolchain failure evidence.
 * @param homeDirectory - Home path replaced before public rendering.
 * @returns Stable issue title, body, fingerprint, and duplicate marker.
 * @throws {SupportTicketError} When required evidence is missing or malformed.
 *
 * @example
 * ```ts
 * const ticket = buildSupportTicket(input, process.env.HOME)
 * ```
 */
export function buildSupportTicket(
	input: SupportTicketInput,
	homeDirectory = process.env.HOME ?? "",
): BuiltSupportTicket {
	if (!SUPPORT_COMPONENTS.includes(input.component)) {
		throw new SupportTicketError(
			"invalid_component",
			3,
			`Use one declared component: ${SUPPORT_COMPONENTS.join(", ")}.`,
		)
	}
	if (!SUPPORT_FAILURE_KINDS.includes(input.failureKind)) {
		throw new SupportTicketError(
			"invalid_failureKind",
			3,
			`Use one declared failureKind: ${SUPPORT_FAILURE_KINDS.join(", ")}.`,
		)
	}
	const privacy = requiredObject(input.privacy, "privacy")
	const privacyClassification = requiredEnum(
		privacy.classification,
		"privacy_classification",
		PRIVACY_CLASSIFICATIONS,
	)
	if (privacyClassification === "security-sensitive") {
		throw new SupportTicketError(
			"private_security_report_required",
			3,
			"Use the repository private vulnerability-reporting route; do not create a public issue.",
			"unsafe",
		)
	}
	if (privacyClassification !== "public-safe") {
		throw new SupportTicketError(
			"public_data_review_required",
			3,
			"Remove or de-identify private data, classify it public-safe, then preview again.",
			"unsafe",
		)
	}
	const privacyReviewer = requiredEnum(
		privacy.reviewedBy,
		"privacy_reviewedBy",
		PRIVACY_REVIEWERS,
	)
	const privacyRedactions = requiredTextList(
		privacy.redactions,
		"privacy_redactions",
		0,
		MAX_REDACTIONS,
		MAX_FIELD_CHARS,
	).map((item) => redactSupportText(item, homeDirectory))
	assertNoPrivateKey(JSON.stringify(input))

	const status = requiredEnum(input.status, "status", SUPPORT_STATUSES)
	const errorCode = requiredIdentifier(input.errorCode, "errorCode", /^[A-Z][A-Z0-9_]{2,79}$/)
	const failureLocus = requiredIdentifier(
		input.failureLocus,
		"failureLocus",
		/^[a-z0-9][a-z0-9._:-]{2,159}$/,
	)
	const correlationId = requiredIdentifier(
		input.correlationId,
		"correlationId",
		/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/,
	)
	const externalEffect = requiredEnum(input.externalEffect, "externalEffect", EXTERNAL_EFFECTS)
	const retry = requiredObject(input.retry, "retry")
	const retryDisposition = requiredEnum(
		retry.disposition,
		"retry_disposition",
		RETRY_DISPOSITIONS,
	)
	if (
		(["dispatched", "unknown"] as SupportTicketExternalEffect[]).includes(externalEffect) &&
		retryDisposition !== "reconcile-first"
	) {
		throw new SupportTicketError(
			"unsafe_retry_disposition",
			3,
			"Mark retry reconcile-first and inspect the same browser lane before another mutation.",
			"reconcile-first",
		)
	}
	if (externalEffect === "confirmed" && retryDisposition === "safe") {
		throw new SupportTicketError(
			"unsafe_retry_disposition",
			3,
			"Mark retry unsafe or reconcile-first after a confirmed external effect.",
			"unsafe",
		)
	}
	const nextAction = redactSupportText(requiredText(retry.nextAction, "retry_nextAction"), homeDirectory)
	const requestSummary = redactSupportText(
		requiredText(input.requestSummary, "requestSummary"),
		homeDirectory,
	)
	const summary = redactSupportText(requiredText(input.summary, "summary"), homeDirectory)
	const impact = redactSupportText(requiredText(input.impact, "impact"), homeDirectory)
	const expected = redactSupportText(requiredText(input.expected, "expected"), homeDirectory)
	const actual = redactSupportText(requiredText(input.actual, "actual"), homeDirectory)
	const minimalReproduction = redactSupportText(
		requiredText(input.minimalReproduction, "minimalReproduction"),
		homeDirectory,
	)
	const commands = sanitizeCommands(input.commands, homeDirectory)
	const failureEvidence = requiredTextList(
		input.failureEvidence,
		"failureEvidence",
		1,
		10,
		MAX_FIELD_CHARS,
	).map((item) => redactSupportText(item, homeDirectory))
	const diagnostics = optionalTextList(input.diagnostics, "diagnostics").map((item) =>
		redactSupportText(item, homeDirectory),
	)
	const environment = input.environment ?? {}
	const toolVersions = sanitizeToolVersions(environment.toolVersions, homeDirectory)
	const environmentRows = [
		environment.harness ? `Harness: ${redactSupportText(environment.harness, homeDirectory)}` : null,
		environment.operatingSystem
			? `OS: ${redactSupportText(environment.operatingSystem, homeDirectory)}`
			: null,
		environment.sourceRevision
			? `Source revision: ${redactSupportText(environment.sourceRevision, homeDirectory)}`
			: null,
		environment.installChannel
			? `Install channel: ${redactSupportText(environment.installChannel, homeDirectory)}`
			: null,
		...Object.entries(toolVersions).map(([tool, version]) => `${tool}: ${version}`),
	].filter((item): item is string => item !== null)
	const fingerprint = createHash("sha256")
		.update(
			JSON.stringify({
				schemaVersion: SCHEMA_VERSION,
				component: input.component,
				failureKind: input.failureKind,
				errorCode: errorCode.toLowerCase(),
				failureLocus: failureLocus.toLowerCase(),
			}),
		)
		.digest("hex")
		.slice(0, 20)
	const marker = `<!-- browser-use-support:${fingerprint} -->`
	const legacyFingerprint = createHash("sha256")
		.update(
			JSON.stringify({
				component: input.component,
				failureKind: input.failureKind,
				requestSummary: requestSummary.toLowerCase(),
				summary: summary.toLowerCase(),
				commands: commands.map((step) => step.command.replace(/\s+/g, " ").trim()),
			}),
		)
		.digest("hex")
		.slice(0, 20)
	const duplicateMarkers = [marker, `<!-- browser-use-support:${legacyFingerprint} -->`]
	const title = `[Browser Use][${input.component}] ${summary}`.slice(0, 120)
	const agentRecord = {
		schemaVersion: SCHEMA_VERSION,
		problemType: `${input.component}/${input.failureKind}`,
		occurrenceId: correlationId,
		defectSignature: fingerprint,
		status,
		component: input.component,
		failureKind: input.failureKind,
		errorCode,
		failureLocus,
		externalEffect,
		retry: { disposition: retryDisposition, nextAction },
		commands,
		environment: {
			harness: environment.harness
				? redactSupportText(environment.harness, homeDirectory)
				: undefined,
			operatingSystem: environment.operatingSystem
				? redactSupportText(environment.operatingSystem, homeDirectory)
				: undefined,
			toolVersions,
			sourceRevision: environment.sourceRevision
				? redactSupportText(environment.sourceRevision, homeDirectory)
				: undefined,
			installChannel: environment.installChannel
				? redactSupportText(environment.installChannel, homeDirectory)
				: undefined,
		},
	}
	const triageRows = [
		["Status", status],
		["Component", input.component],
		["Failure class", input.failureKind],
		["Error code", `\`${errorCode}\``],
		["Failure locus", `\`${failureLocus}\``],
		["External effect", externalEffect],
		["Same-input retry", retryDisposition],
		["Correlation", `\`${correlationId}\``],
		["Next safe action", nextAction],
	]
		.map(([key, value]) => `| ${key} | ${tableValue(value)} |`)
		.join("\n")
	const sections = [
		"## Triage",
		`| Field | Value |\n| --- | --- |\n${triageRows}`,
		"## User request",
		requestSummary,
		"## Impact",
		impact,
		"## Expected behavior",
		expected,
		"## Actual behavior",
		actual,
		"## Minimal reproduction",
		minimalReproduction,
		"## Full command history",
		commands.length > 0
			? commands.map(commandStep).join("\n\n")
			: "No shell commands ran before the failure.",
		"## Evidence",
		bulletList(failureEvidence),
	]
	if (diagnostics.length > 0) {
		sections.push(
			`<details>\n<summary>Diagnostics</summary>\n\n${bulletList(diagnostics)}\n\n</details>`,
		)
	}
	if (environmentRows.length > 0) sections.push("## Environment", bulletList(environmentRows))
	sections.push(
		`<details>\n<summary>Agent record</summary>\n\n\`\`\`json\n${jsonCodeBlock(agentRecord)}\n\`\`\`\n\n</details>`,
		"## Privacy",
		`Public-safe review: ${privacyReviewer}. All commands that ran are listed in order. Secret values, auth-bearing URLs, debugger identifiers, email addresses, non-loopback IP addresses, and home paths are redacted.${
			privacyRedactions.length > 0
				? `\n\nDeclared redactions:\n${bulletList(privacyRedactions)}`
				: ""
		}`,
		marker,
	)
	const body = `${sections.join("\n\n")}\n`
	if (body.length > MAX_ISSUE_BODY_CHARS) {
		throw new SupportTicketError(
			"issue_body_too_large",
			3,
			"Keep the full command list; shorten narrative and diagnostics, then preview again.",
		)
	}
	const contentDigest = createHash("sha256").update(`${title}\n${body}`).digest("hex")
	return { title, body, fingerprint, marker, duplicateMarkers, contentDigest }
}

function requireGithubSuccess(result: GithubCommandResult, code: string): string {
	if (result.exitCode !== 0) {
		throw new SupportTicketError(code, 6, "Repair GitHub CLI access, then retry the same input.")
	}
	return result.stdout.trim()
}

function issueNumberFromUrl(url: string): number | undefined {
	const match = url.match(/\/issues\/(\d+)(?:\/?$)/)
	return match?.[1] ? Number.parseInt(match[1], 10) : undefined
}

/**
 * File one support ticket after identity, label, and duplicate gates pass.
 *
 * @param input - Valid Browser Use toolchain failure evidence.
 * @param runtime - Narrow GitHub command boundary.
 * @param previewDigest - Exact digest returned by the reviewed preview.
 * @param homeDirectory - Home path removed before any public write.
 * @returns Created or deduplicated issue result.
 * @throws {SupportTicketError} When identity, label, lookup, or creation fails.
 *
 * @example
 * ```ts
 * const preview = buildSupportTicket(input)
 * const result = fileSupportTicket(input, runtime, preview.contentDigest)
 * ```
 */
export function fileSupportTicket(
	input: SupportTicketInput,
	runtime: GithubRuntime,
	previewDigest: string,
	homeDirectory = process.env.HOME ?? "",
): FileSupportTicketResult {
	const ticket = buildSupportTicket(input, homeDirectory)
	if (previewDigest !== ticket.contentDigest) {
		throw new SupportTicketError(
			"preview_digest_mismatch",
			3,
			"Preview the unchanged input again, inspect it, then use its exact content digest.",
		)
	}
	const identity = runtime.run(["api", "user", "--jq", ".login"])
	if (identity.exitCode !== 0) {
		throw new SupportTicketError(
			"github_auth_unavailable",
			4,
			"Run gh auth status; restore the nathanvale identity before retrying.",
		)
	}
	if (identity.stdout.trim() !== SUPPORT_GITHUB_LOGIN) {
		throw new SupportTicketError(
			"wrong_github_identity",
			4,
			`Switch gh to ${SUPPORT_GITHUB_LOGIN}, verify it, then retry.`,
		)
	}
	const labelOutput = requireGithubSuccess(
		runtime.run([
			"label",
			"list",
			"--repo",
			SUPPORT_REPOSITORY,
			"--limit",
			"100",
			"--json",
			"name",
		]),
		"github_label_lookup_failed",
	)
	let labels: Array<{ name?: unknown }>
	try {
		labels = JSON.parse(labelOutput) as Array<{ name?: unknown }>
	} catch {
		throw new SupportTicketError(
			"github_label_lookup_invalid",
			6,
			"Inspect gh label list JSON output, then retry.",
		)
	}
	if (!labels.some((label) => label.name === SUPPORT_LABEL)) {
		throw new SupportTicketError(
			"browser_use_label_missing",
			5,
			`Create the ${SUPPORT_LABEL} label in ${SUPPORT_REPOSITORY}, then retry.`,
		)
	}
	const issuesOutput = requireGithubSuccess(
		runtime.run([
			"issue",
			"list",
			"--repo",
			SUPPORT_REPOSITORY,
			"--state",
			"open",
			"--label",
			SUPPORT_LABEL,
			"--limit",
			"1000",
			"--json",
			"number,title,body,url",
		]),
		"github_issue_lookup_failed",
	)
	let issues: Array<{ number?: unknown; body?: unknown; url?: unknown }>
	try {
		issues = JSON.parse(issuesOutput) as Array<{
			number?: unknown
			body?: unknown
			url?: unknown
		}>
	} catch {
		throw new SupportTicketError(
			"github_issue_lookup_invalid",
			6,
			"Inspect gh issue list JSON output, then retry.",
		)
	}
	const duplicate = issues.find(
		(issue) =>
			typeof issue.body === "string" &&
			ticket.duplicateMarkers.some((marker) => (issue.body as string).includes(marker)),
	)
	if (duplicate && typeof duplicate.url === "string") {
		return {
			outcome: "deduplicated",
			issueNumber: typeof duplicate.number === "number" ? duplicate.number : undefined,
			issueUrl: duplicate.url,
			fingerprint: ticket.fingerprint,
			contentDigest: ticket.contentDigest,
		}
	}
	const createResult = runtime.run(
		[
			"issue",
			"create",
			"--repo",
			SUPPORT_REPOSITORY,
			"--title",
			ticket.title,
			"--body-file",
			"-",
			"--label",
			SUPPORT_LABEL,
		],
		ticket.body,
	)
	if (createResult.exitCode !== 0) {
		throw new SupportTicketError(
			"github_issue_create_unknown",
			6,
			"Inspect open browser-use issues for the defect signature before any retry.",
			"reconcile-first",
		)
	}
	const createOutput = createResult.stdout.trim()
	if (!/^https:\/\/github\.com\//.test(createOutput)) {
		throw new SupportTicketError(
			"github_issue_create_invalid",
			6,
			"Inspect gh issue create output before retrying; creation state is unknown.",
			"reconcile-first",
		)
	}
	return {
		outcome: "created",
		issueNumber: issueNumberFromUrl(createOutput),
		issueUrl: createOutput,
		fingerprint: ticket.fingerprint,
		contentDigest: ticket.contentDigest,
	}
}

/**
 * Parse the small public CLI surface without accepting undeclared flags.
 *
 * @param args - Arguments after the executable name.
 * @returns Help or validated run input.
 * @throws {SupportTicketError} When syntax or execute authority is invalid.
 *
 * @example
 * ```ts
 * parseSupportTicketArgs(["preview", "--input", "ticket.json", "--json"])
 * ```
 */
export function parseSupportTicketArgs(args: string[]): ParsedSupportTicketArgs {
	if (args.length === 0 || args.includes("--help") || args.includes("-h")) return { kind: "help" }
	const command = args[0]
	if (command !== "preview" && command !== "file") {
		throw new SupportTicketError("unknown_command", 2, `Run ${COMMAND_NAME} --help.`)
	}
	let inputPath: string | undefined
	let json = false
	let execute = false
	let previewDigest: string | undefined
	for (let index = 1; index < args.length; index += 1) {
		const argument = args[index]
		if (argument === "--input") {
			if (inputPath !== undefined || !args[index + 1]) {
				throw new SupportTicketError("invalid_input_flag", 2, `Run ${COMMAND_NAME} --help.`)
			}
			inputPath = args[index + 1]
			index += 1
			continue
		}
		if (argument === "--json") {
			json = true
			continue
		}
		if (argument === "--execute") {
			execute = true
			continue
		}
		if (argument === "--preview-digest") {
			if (previewDigest !== undefined || !args[index + 1]) {
				throw new SupportTicketError(
					"invalid_preview_digest_flag",
					2,
					`Run ${COMMAND_NAME} --help.`,
				)
			}
			previewDigest = args[index + 1]
			index += 1
			continue
		}
		throw new SupportTicketError("unknown_flag", 2, `Run ${COMMAND_NAME} --help.`)
	}
	if (!inputPath) throw new SupportTicketError("input_required", 2, "Provide --input <path|->.")
	if (command === "file" && !execute) {
		throw new SupportTicketError(
			"execute_required",
			2,
			"Preview first, then repeat file with --execute.",
		)
	}
	if (command === "file" && !/^[a-f0-9]{64}$/.test(previewDigest ?? "")) {
		throw new SupportTicketError(
			"preview_digest_required",
			2,
			"Preview first, then provide its --preview-digest value unchanged.",
		)
	}
	if (command === "preview" && execute) {
		throw new SupportTicketError("execute_not_allowed", 2, "Remove --execute from preview.")
	}
	if (command === "preview" && previewDigest !== undefined) {
		throw new SupportTicketError(
			"preview_digest_not_allowed",
			2,
			"Remove --preview-digest from preview.",
		)
	}
	return { kind: "run", command, inputPath, json, execute, previewDigest }
}

const productionGithubRuntime: GithubRuntime = {
	run(args, stdin) {
		const result = Bun.spawnSync(["gh", ...args], {
			stdout: "pipe",
			stderr: "pipe",
			stdin: stdin === undefined ? undefined : new TextEncoder().encode(stdin),
		})
		return {
			exitCode: result.exitCode,
			stdout: new TextDecoder().decode(result.stdout),
			stderr: new TextDecoder().decode(result.stderr),
		}
	},
}

async function readInput(path: string): Promise<SupportTicketInput> {
	let text: string
	try {
		text = path === "-" ? await Bun.stdin.text() : await Bun.file(path).text()
	} catch {
		throw new SupportTicketError("input_unreadable", 3, "Repair the input path, then retry.")
	}
	try {
		return JSON.parse(text) as SupportTicketInput
	} catch {
		throw new SupportTicketError("input_json_invalid", 3, "Provide one valid JSON object.")
	}
}

function writeJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function runCli(args: string[]): Promise<number> {
	const runId = randomUUID()
	let jsonRequested = args.includes("--json")
	try {
		const parsed = parseSupportTicketArgs(args)
		if (parsed.kind === "help") {
			process.stdout.write(HELP_TEXT)
			return 0
		}
		jsonRequested = parsed.json
		const input = await readInput(parsed.inputPath)
		if (parsed.command === "preview") {
			const ticket = buildSupportTicket(input)
			if (parsed.json) {
				writeJson({
					status: "ok",
					run_id: runId,
					data: {
						outcome: "previewed",
						title: ticket.title,
						body: ticket.body,
						fingerprint: ticket.fingerprint,
						content_digest: ticket.contentDigest,
						contract_id: CONTRACT_ID,
						schema_version: SCHEMA_VERSION,
					},
					runtime_actions: [{ id: "file_support_ticket", side_effects: ["network", "write"] }],
					continuation: { next_action_id: "file_support_ticket" },
				})
			} else {
				process.stdout.write(`${ticket.title}\n\n${ticket.body}`)
			}
			return 0
		}
		const result = fileSupportTicket(input, productionGithubRuntime, parsed.previewDigest ?? "")
		if (parsed.json) {
			writeJson({
				status: "ok",
				run_id: runId,
				data: { ...result, contract_id: CONTRACT_ID, schema_version: SCHEMA_VERSION },
				runtime_actions: [],
			})
		} else {
			process.stdout.write(`${result.outcome}: ${result.issueUrl}\n`)
		}
		return 0
	} catch (error) {
		const failure =
			error instanceof SupportTicketError
				? error
				: new SupportTicketError(
						"unexpected_failure",
						6,
						"Inspect the local failure without copying raw output into GitHub.",
					)
		if (jsonRequested) {
			writeJson({
				status: "error",
				run_id: runId,
				error: {
					code: failure.code,
					exit_code: failure.exitCode,
					retryable: failure.sameInputRetry === "safe-after-repair",
					same_input_retry: failure.sameInputRetry,
					contract_id: CONTRACT_ID,
					schema_version: SCHEMA_VERSION,
				},
				runtime_actions: [
					{ id: "repair_support_ticket", summary: failure.nextAction, side_effects: ["check"] },
				],
				continuation: { next_action_id: "repair_support_ticket" },
			})
		} else {
			process.stderr.write(`${failure.code}: ${failure.nextAction}\n`)
		}
		return failure.exitCode
	}
}

if (import.meta.main) process.exit(await runCli(Bun.argv.slice(2)))
