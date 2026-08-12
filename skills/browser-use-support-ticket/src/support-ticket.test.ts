import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { COMMANDS, HELP_TEXT, LONG_OPTIONS } from "./command-contract"
import {
	buildSupportTicket,
	fileSupportTicket,
	parseSupportTicketArgs,
	redactSupportText,
	type GithubCommandResult,
	type GithubRuntime,
	type SupportTicketInput,
} from "./support-ticket"

const CLI_PATH = fileURLToPath(new URL("./support-ticket.ts", import.meta.url))

const INPUT: SupportTicketInput = {
	component: "browser-use",
	failureKind: "runtime-terminal",
	status: "blocked",
	errorCode: "AUTH_BINDING_CONTINUATION_INVALID",
	failureLocus: "browser-use.auth.repair-item-binding",
	correlationId: "run-019ff283e36a7140",
	requestSummary: "Enable one Google Cloud API through Browser Use.",
	summary: "Auth repair continuation cannot be satisfied",
	impact: "Browser task cannot continue after the owned recovery step.",
	expected: "The continuation repairs the run or returns complete repair inputs.",
	actual: "The run repeats repair-item-binding without the required binding identifiers.",
	minimalReproduction: "Start the owned auth flow, follow its continuation once, and inspect the repeated blocked state.",
	externalEffect: "none",
	retry: {
		disposition: "safe",
		nextAction: "Repair the binding inputs, then retry the owned continuation once.",
	},
	commands: [
		{
			command: "browser-connect connect agent-browser --json",
			outcome: "passed",
			exitCode: 0,
			sideEffect: "read",
		},
		{
			command:
				"browser-use auth login --handoff /Users/nathan/private/handoff.json --service google-cloud --allowed-origin https://accounts.google.com --json",
			outcome: "failed",
			errorCode: "repair_item_binding",
			exitCode: 20,
			sideEffect: "none",
		},
	],
	diagnostics: ["binding_receipt_invalid", "run remains awaiting-auth"],
	failureEvidence: [
		"The advertised continuation was followed once.",
		"The same blocked state remained after retry.",
	],
	environment: {
		harness: "codex",
		operatingSystem: "macOS 15.6",
		toolVersions: {
			"browser-use": "0.1.0",
			"browser-connect": "0.4.0",
		},
		sourceRevision: "abc1234",
		installChannel: "workspace",
	},
	privacy: {
		classification: "public-safe",
		reviewedBy: "agent",
		redactions: ["home path", "auth URL"],
	},
}

class FakeGithubRuntime implements GithubRuntime {
	readonly calls: Array<{ args: string[]; stdin?: string }> = []

	constructor(private readonly responses: GithubCommandResult[]) {}

	run(args: string[], stdin?: string): GithubCommandResult {
		this.calls.push({ args, stdin })
		const response = this.responses.shift()
		if (!response) throw new Error(`Unexpected gh call: ${args.join(" ")}`)
		return response
	}
}

function runCli(args: string[]) {
	return Bun.spawnSync([process.execPath, "run", CLI_PATH, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	})
}

describe("support ticket safety", () => {
	test("redacts credentials, personal identifiers, auth URLs, debugger URLs, and home paths", () => {
		const text = [
			"TOKEN=secret-value browser-use auth login --password hunter2",
			"https://accounts.google.com/o/oauth2/auth?client_id=abc&state=secret",
			"https://example.com/path?token=abc",
			"http://%",
			"ws://127.0.0.1:9242/devtools/browser/secret-id",
			"/Users/nathan/private/handoff.json",
			"/home/alex/private/report.json",
			"alex@example.com 10.2.3.4",
			"gho_abcdefghijklmnop",
		].join("\n")
		const redacted = redactSupportText(text, "/Users/nathan")

		expect(redacted).not.toContain("secret-value")
		expect(redacted).not.toContain("hunter2")
		expect(redacted).not.toContain("client_id")
		expect(redacted).not.toContain("token=abc")
		expect(redacted).not.toContain("secret-id")
		expect(redacted).not.toContain("/Users/nathan")
		expect(redacted).not.toContain("/home/alex")
		expect(redacted).not.toContain("alex@example.com")
		expect(redacted).not.toContain("10.2.3.4")
		expect(redacted).not.toContain("gho_abcdefghijklmnop")
		expect(redacted).toContain("$HOME/private/handoff.json")
		expect(redacted).toContain("[REDACTED_EMAIL]")
		expect(redacted).toContain("[REDACTED_IP]")
	})

	test("renders human triage, full command history, and a versioned agent record", () => {
		const first = buildSupportTicket(INPUT, "/Users/nathan")
		const second = buildSupportTicket(INPUT, "/Users/nathan")

		expect(first.body).toContain("## Triage")
		expect(first.body).toContain("| External effect | none |")
		expect(first.body).toContain("| Same-input retry | safe |")
		expect(first.body).toContain("## Minimal reproduction")
		expect(first.body).toContain("## Full command history")
		expect(first.body).toContain("1. Outcome: `passed`")
		expect(first.body).toContain("2. Outcome: `failed`")
		expect(first.body).toContain("Outcome: `failed`")
		expect(first.body).toContain("Error: `repair_item_binding`")
		expect(first.body).toContain("Exit: `20`")
		expect(first.body).toContain("<summary>Agent record</summary>")
		expect(first.body).toContain('"schemaVersion": "2"')
		expect(first.body).toContain('"problemType": "browser-use/runtime-terminal"')
		expect(first.body).toContain('"occurrenceId": "run-019ff283e36a7140"')
		expect(first.body).toContain('"commands": [')
		expect(first.body).toContain("<!-- browser-use-support:")
		expect(first.duplicateMarkers).toHaveLength(2)
		expect(first.fingerprint).toBe(second.fingerprint)
	})

	test("deduplicates stable defects despite volatile occurrence and command values", () => {
		const first = buildSupportTicket(INPUT, "/Users/nathan")
		const second = buildSupportTicket({
			...INPUT,
			correlationId: "run-different-019ff284",
			requestSummary: "A different user wording for the same defect.",
			commands: INPUT.commands.map((step, index) => ({
				...step,
				command: `${step.command} --port ${9000 + index}`,
			})),
		})
		const differentCode = buildSupportTicket({
			...INPUT,
			errorCode: "AUTH_CALLBACK_TIMEOUT",
		})

		expect(second.fingerprint).toBe(first.fingerprint)
		expect(differentCode.fingerprint).not.toBe(first.fingerprint)
	})

	test.each(["prose-routing", "prose-outcome"] as const)(
		"renders %s failures without copying a raw prompt",
		(failureKind) => {
			const ticket = buildSupportTicket({
				...INPUT,
				failureKind,
				status: "degraded",
				errorCode: failureKind === "prose-routing" ? "ROUTE_NOT_SELECTED" : "REQUEST_UNMET",
				failureLocus: `browser-use.${failureKind}`,
				requestSummary: "Sort saved YouTube videos into useful groups.",
				commands: [],
				failureEvidence: [
					failureKind === "prose-routing"
						? "The Browser Use skill did not select an available route."
						: "The selected workflow completed without producing the requested grouping.",
				],
			})

			expect(ticket.body).toContain(`| Failure class | ${failureKind} |`)
			expect(ticket.body).toContain("## User request")
			expect(ticket.body).toContain("No shell commands ran before the failure.")
			expect(ticket.body).not.toContain("raw prompt")
		},
	)

	test.each([
		"browser-use",
		"browser-connect",
		"warm-chrome",
		"agent-browser",
		"chrome-devtools-mcp",
		"playwright-cdp",
		"browser-use-security",
		"cross-component",
		"other-toolchain",
	] as const)("names the %s toolchain component", (component) => {
		const ticket = buildSupportTicket({ ...INPUT, component })

		expect(ticket.title).toStartWith(`[Browser Use][${component}]`)
		expect(ticket.body).toContain(`| Component | ${component} |`)
	})

	test.each(["personal", "commercial-sensitive", "unknown"] as const)(
		"refuses %s data before rendering a public ticket",
		(classification) => {
			expect(() =>
				buildSupportTicket({
					...INPUT,
					privacy: { ...INPUT.privacy, classification },
				}),
			).toThrow("public_data_review_required")
		},
	)

	test("routes security-sensitive evidence away from public issues", () => {
		expect(() =>
			buildSupportTicket({
				...INPUT,
				privacy: { ...INPUT.privacy, classification: "security-sensitive" },
			}),
		).toThrow("private_security_report_required")
	})

	test("refuses private key material even when classified public-safe", () => {
		expect(() =>
			buildSupportTicket({
				...INPUT,
				actual: "-----BEGIN PRIVATE KEY----- secret -----END PRIVATE KEY-----",
			}),
		).toThrow("sensitive_public_content")
	})

	test("fails before GitHub when the rendered issue exceeds its public body budget", () => {
		const commands = Array.from({ length: 40 }, (_, index) => ({
			command: `browser-use run ${index} ${"x".repeat(1_800)}`,
			outcome: "passed" as const,
			exitCode: 0,
			sideEffect: "read" as const,
		}))

		expect(() => buildSupportTicket({ ...INPUT, commands })).toThrow("issue_body_too_large")
	})

	test("requires reconciliation when the external effect is unknown", () => {
		expect(() =>
			buildSupportTicket({
				...INPUT,
				externalEffect: "unknown",
				retry: { ...INPUT.retry, disposition: "safe" },
			}),
		).toThrow("unsafe_retry_disposition")

		const ticket = buildSupportTicket({
			...INPUT,
			externalEffect: "unknown",
			retry: {
				disposition: "reconcile-first",
				nextAction: "Inspect the same lane and target before any retry.",
			},
		})
		expect(ticket.body).toContain("| External effect | unknown |")
		expect(ticket.body).toContain("| Same-input retry | reconcile-first |")
	})

	test("refuses malformed per-command exit codes", () => {
		expect(() =>
			buildSupportTicket({
				...INPUT,
				commands: [{ ...INPUT.commands[0], exitCode: 999 }],
			}),
		).toThrow("invalid_commands_1_exitCode")
	})

	test.each([
		["environment", [], "invalid_environment"],
		["environment harness", { harness: 42 }, "invalid_environment_harness"],
		[
			"environment operating system",
			{ operatingSystem: false },
			"invalid_environment_operatingSystem",
		],
		[
			"environment source revision",
			{ sourceRevision: 123 },
			"invalid_environment_sourceRevision",
		],
		[
			"environment install channel",
			{ installChannel: {} },
			"invalid_environment_installChannel",
		],
	] as const)("refuses malformed %s", (_name, environment, errorCode) => {
		expect(() =>
			buildSupportTicket({ ...INPUT, environment } as unknown as SupportTicketInput),
		).toThrow(errorCode)
	})

	test("deduplicates an open issue before creating a new one", () => {
		const ticket = buildSupportTicket(INPUT, "/Users/nathan")
		const runtime = new FakeGithubRuntime([
			{ exitCode: 0, stdout: "nathanvale\n", stderr: "" },
			{ exitCode: 0, stdout: '[{"name":"browser-use"}]', stderr: "" },
			{ exitCode: 0, stdout: "[]", stderr: "" },
			{
				exitCode: 0,
				stdout: JSON.stringify([
					{
						number: 42,
						title: ticket.title,
						body: `existing\n${ticket.duplicateMarkers[1]}`,
						url: "https://github.com/nathanvale/claude-code-config/issues/42",
					},
				]),
				stderr: "",
			},
		])

		const result = fileSupportTicket(
			INPUT,
			runtime,
			buildSupportTicket(INPUT, "/Users/nathan").contentDigest,
			"/Users/nathan",
		)

		expect(result.outcome).toBe("deduplicated")
		expect(result.issueNumber).toBe(42)
		expect(runtime.calls).toHaveLength(4)
		expect(runtime.calls[2]?.args).toEqual([
			"issue",
			"list",
			"--repo",
			"nathanvale/claude-code-config",
			"--state",
			"open",
			"--label",
			"browser-use",
			"--search",
			`in:body "${ticket.duplicateMarkers[0]}"`,
			"--json",
			"number,title,body,url",
		])
		expect(runtime.calls[3]?.args).toContain(`in:body "${ticket.duplicateMarkers[1]}"`)
	})

	test("creates one labelled issue with the sanitized body over stdin", () => {
		const runtime = new FakeGithubRuntime([
			{ exitCode: 0, stdout: "nathanvale\n", stderr: "" },
			{ exitCode: 0, stdout: '[{"name":"browser-use"}]', stderr: "" },
			{
				exitCode: 0,
				stdout: JSON.stringify([
					{
						number: 41,
						body: "Search false positive without an exact duplicate marker.",
						url: "https://github.com/nathanvale/claude-code-config/issues/41",
					},
				]),
				stderr: "",
			},
			{ exitCode: 0, stdout: "[]", stderr: "" },
			{
				exitCode: 0,
				stdout: "https://github.com/nathanvale/claude-code-config/issues/43\n",
				stderr: "",
			},
		])

		const result = fileSupportTicket(
			INPUT,
			runtime,
			buildSupportTicket(INPUT, "/Users/nathan").contentDigest,
			"/Users/nathan",
		)

		expect(result.outcome).toBe("created")
		expect(runtime.calls[4]?.args).toContain("browser-use")
		expect(runtime.calls[4]?.stdin).toContain("## Full command history")
		expect(runtime.calls[4]?.stdin).not.toContain("/Users/nathan")
	})

	test("refuses the wrong active GitHub identity before repository reads", () => {
		const runtime = new FakeGithubRuntime([
			{ exitCode: 0, stdout: "myagentdojo\n", stderr: "" },
		])

		expect(() =>
			fileSupportTicket(
				INPUT,
				runtime,
				buildSupportTicket(INPUT, "/Users/nathan").contentDigest,
				"/Users/nathan",
			),
		).toThrow(
			"wrong_github_identity",
		)
		expect(runtime.calls).toHaveLength(1)
	})

	test("refuses a changed body after preview before any GitHub access", () => {
		const runtime = new FakeGithubRuntime([])

		expect(() => fileSupportTicket(INPUT, runtime, "wrong-preview-digest", "/Users/nathan")).toThrow(
			"preview_digest_mismatch",
		)
		expect(runtime.calls).toHaveLength(0)
	})

	test("marks GitHub create failure as reconcile-first because write state is unknown", () => {
		const ticket = buildSupportTicket(INPUT, "/Users/nathan")
		const runtime = new FakeGithubRuntime([
			{ exitCode: 0, stdout: "nathanvale\n", stderr: "" },
			{ exitCode: 0, stdout: '[{"name":"browser-use"}]', stderr: "" },
			{ exitCode: 0, stdout: "[]", stderr: "" },
			{ exitCode: 0, stdout: "[]", stderr: "" },
			{ exitCode: 1, stdout: "", stderr: "network interrupted" },
		])

		try {
			fileSupportTicket(INPUT, runtime, ticket.contentDigest, "/Users/nathan")
			throw new Error("Expected filing to fail")
		} catch (error) {
			expect(error).toMatchObject({
				message: "github_issue_create_unknown",
				sameInputRetry: "reconcile-first",
			})
		}
	})

	test("keeps parser flags aligned with the rendered help", () => {
		for (const command of COMMANDS) expect(HELP_TEXT).toContain(`  ${command}`)
		for (const option of LONG_OPTIONS) expect(HELP_TEXT).toContain(option)
		expect(parseSupportTicketArgs(["preview", "--input", "ticket.json", "--json"])).toEqual({
			kind: "run",
			command: "preview",
			inputPath: "ticket.json",
			json: true,
			execute: false,
			previewDigest: undefined,
		})
		expect(() => parseSupportTicketArgs(["file", "--input", "ticket.json"])).toThrow(
			"execute_required",
		)
		expect(() =>
			parseSupportTicketArgs(["file", "--input", "ticket.json", "--execute"]),
		).toThrow("preview_digest_required")
		expect(() =>
			parseSupportTicketArgs([
				"preview",
				"--input",
				"ticket.json",
				"--preview-digest",
				"a".repeat(64),
			]),
		).toThrow("preview_digest_not_allowed")
		expect(
			parseSupportTicketArgs([
				"file",
				"--input",
				"ticket.json",
				"--execute",
				"--preview-digest",
				"a".repeat(64),
			]),
		).toMatchObject({ previewDigest: "a".repeat(64) })
	})

	test("runs the public preview command with a structured success envelope", () => {
		const directory = mkdtempSync(join(tmpdir(), "browser-use-support-ticket-"))
		const inputPath = join(directory, "input.json")
		try {
			writeFileSync(inputPath, `${JSON.stringify(INPUT)}\n`)
			const result = runCli(["preview", "--input", inputPath, "--json"])
			const envelope = JSON.parse(result.stdout.toString()) as {
				status: string
				data: { body: string; content_digest: string }
			}

			expect(result.exitCode).toBe(0)
			expect(result.stderr.toString()).toBe("")
			expect(envelope.status).toBe("ok")
			expect(envelope.data.content_digest).toMatch(/^[a-f0-9]{64}$/)
			expect(envelope.data.body).toContain("$HOME/private/handoff.json")
			expect(envelope.data.body).not.toContain("/Users/nathan")
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})

	test("returns a structured repair envelope for invalid input JSON", () => {
		const directory = mkdtempSync(join(tmpdir(), "browser-use-support-ticket-"))
		const inputPath = join(directory, "input.json")
		try {
			writeFileSync(inputPath, "{\n")
			const result = runCli(["preview", "--input", inputPath, "--json"])
			const envelope = JSON.parse(result.stdout.toString()) as {
				status: string
				error: { code: string; same_input_retry: string }
				continuation: { next_action_id: string }
			}

			expect(result.exitCode).toBe(3)
			expect(result.stderr.toString()).toBe("")
			expect(envelope.status).toBe("error")
			expect(envelope.error.code).toBe("input_json_invalid")
			expect(envelope.error.same_input_retry).toBe("safe-after-repair")
			expect(envelope.continuation.next_action_id).toBe("repair_support_ticket")
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})

	test("returns invalid input for malformed environment metadata", () => {
		const directory = mkdtempSync(join(tmpdir(), "browser-use-support-ticket-"))
		const inputPath = join(directory, "input.json")
		try {
			writeFileSync(inputPath, `${JSON.stringify({ ...INPUT, environment: { harness: 42 } })}\n`)
			const result = runCli(["preview", "--input", inputPath, "--json"])
			const envelope = JSON.parse(result.stdout.toString()) as {
				status: string
				error: { code: string; exit_code: number }
			}

			expect(result.exitCode).toBe(3)
			expect(result.stderr.toString()).toBe("")
			expect(envelope.status).toBe("error")
			expect(envelope.error.code).toBe("invalid_environment_harness")
			expect(envelope.error.exit_code).toBe(3)
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})
})
