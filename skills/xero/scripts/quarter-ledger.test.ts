import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

const scriptPath = join(import.meta.dir, "quarter-ledger.ts")
const temporaryDirectories: string[] = []

async function makeTemporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "xero-quarter-ledger-"))
	temporaryDirectories.push(directory)
	return directory
}

async function runLedger(
	argumentsList: string[],
	stdin = "",
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
	const processHandle = Bun.spawn(["bun", scriptPath, ...argumentsList], {
		stdin: new Blob([stdin]),
		stdout: "pipe",
		stderr: "pipe",
	})

	const [exitCode, stdout, stderr] = await Promise.all([
		processHandle.exited,
		new Response(processHandle.stdout).text(),
		new Response(processHandle.stderr).text(),
	])

	return { exitCode, stdout, stderr }
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	)
})

describe("quarter-ledger CLI", () => {
	test("renders discoverable help", async () => {
		const result = await runLedger(["--help"])

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("quarter-ledger commands")
		expect(result.stdout).toContain("record")
		expect(result.stdout).toContain("status")
		expect(result.stderr).toBe("")
	})

	test("publishes a machine-readable command catalog", async () => {
		const result = await runLedger(["commands", "--json"])
		const output = JSON.parse(result.stdout)

		expect(result.exitCode).toBe(0)
		expect(output.status).toBe("data")
		expect(output.data.actions.map((action: { id: string }) => action.id)).toEqual([
			"status",
			"record",
		])
		expect(output.data.actions[1].sideEffects.local).toBe("write")
	})

	test("reports empty private state without creating a ledger", async () => {
		const directory = await makeTemporaryDirectory()
		const ledgerPath = join(directory, "ledger.jsonl")
		const result = await runLedger([
			"status",
			"--ledger",
			ledgerPath,
			"--json",
		])
		const output = JSON.parse(result.stdout)

		expect(result.exitCode).toBe(0)
		expect(output.data.quarters).toEqual([])
		expect(output.data.nextSafeAction).toBe("record_verified_evidence")
		expect(await Bun.file(ledgerPath).exists()).toBe(false)
	})

	test("records evidence idempotently and derives quarter status", async () => {
		const directory = await makeTemporaryDirectory()
		const ledgerPath = join(directory, "ledger.jsonl")
		const inputPath = join(directory, "event.json")
		const event = {
			quarter: "FY26-Q2",
			periodStart: "2025-10-01",
			periodEnd: "2025-12-31",
			event: "sent_to_accountant",
			occurredAt: "2026-08-05T05:00:00.000Z",
			evidence: {
				kind: "gmail_sent",
				ref: "gmail-message-private-reference",
			},
		}
		await writeFile(inputPath, JSON.stringify(event))

		const firstRecord = await runLedger([
			"record",
			"--ledger",
			ledgerPath,
			"--input",
			inputPath,
			"--json",
		])
		const secondRecord = await runLedger([
			"record",
			"--ledger",
			ledgerPath,
			"--input",
			inputPath,
			"--json",
		])
		const status = await runLedger([
			"status",
			"--ledger",
			ledgerPath,
			"--quarter",
			"FY26-Q2",
			"--json",
		])
		const firstOutput = JSON.parse(firstRecord.stdout)
		const secondOutput = JSON.parse(secondRecord.stdout)
		const statusOutput = JSON.parse(status.stdout)

		expect(firstRecord.exitCode).toBe(0)
		expect(firstOutput.data.duplicate).toBe(false)
		expect(secondRecord.exitCode).toBe(0)
		expect(secondOutput.data.duplicate).toBe(true)
		expect(statusOutput.data.quarters[0].lifecycle).toBe("sent_to_accountant")
		expect(statusOutput.data.quarters[0].sentToAccountant).toBe(true)
		expect(status.stdout).not.toContain("gmail-message-private-reference")
		expect((await readFile(ledgerPath, "utf8")).trim().split("\n")).toHaveLength(1)
	})

	test("rejects lodgment without accountant or ATO evidence", async () => {
		const directory = await makeTemporaryDirectory()
		const ledgerPath = join(directory, "ledger.jsonl")
		const input = JSON.stringify({
			quarter: "FY26-Q3",
			periodStart: "2026-01-01",
			periodEnd: "2026-03-31",
			event: "lodged",
			occurredAt: "2026-08-05T05:00:00.000Z",
			evidence: {
				kind: "local_file",
				ref: "activity-statement.xlsx",
			},
		})
		const result = await runLedger(
			["record", "--ledger", ledgerPath, "--input", "-", "--json"],
			input,
		)
		const output = JSON.parse(result.stdout)

		expect(result.exitCode).toBe(2)
		expect(output.status).toBe("error")
		expect(output.error.code).toBe("INVALID_EVIDENCE")
		expect(output.error.safeToRetrySameInput).toBe(false)
		expect(await Bun.file(ledgerPath).exists()).toBe(false)
	})

	test("rejects period drift for an existing quarter", async () => {
		const directory = await makeTemporaryDirectory()
		const ledgerPath = join(directory, "ledger.jsonl")
		const first = JSON.stringify({
			quarter: "FY26-Q4",
			periodStart: "2026-04-01",
			periodEnd: "2026-06-30",
			event: "note",
			occurredAt: "2026-08-05T05:00:00.000Z",
			evidence: { kind: "manual_note", ref: "quarter-opened" },
		})
		const drifted = JSON.stringify({
			quarter: "FY26-Q4",
			periodStart: "2026-04-02",
			periodEnd: "2026-06-30",
			event: "reconciled",
			occurredAt: "2026-08-05T06:00:00.000Z",
			evidence: { kind: "xero_receipt", ref: "receipt-1" },
		})

		expect(
			(
				await runLedger(
					["record", "--ledger", ledgerPath, "--input", "-", "--json"],
					first,
				)
			).exitCode,
		).toBe(0)
		const result = await runLedger(
			["record", "--ledger", ledgerPath, "--input", "-", "--json"],
			drifted,
		)
		const output = JSON.parse(result.stdout)

		expect(result.exitCode).toBe(5)
		expect(output.error.code).toBe("PERIOD_DRIFT")
		expect(output.error.safeToRetrySameInput).toBe(false)
	})
})
