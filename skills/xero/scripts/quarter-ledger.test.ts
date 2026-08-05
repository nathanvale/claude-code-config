import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
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
	environment: Record<string, string> = {},
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
	const processHandle = Bun.spawn(["bun", scriptPath, ...argumentsList], {
		env: { ...process.env, ...environment },
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
			"lock-status",
			"lock-repair",
		])
		expect(output.data.actions[1].sideEffects.local).toBe("write")
		expect(output.data.actions[1].options).toContainEqual(
			expect.objectContaining({ id: "--input", required: true }),
		)
	})

	test("inspects active lock owner metadata without changing it", async () => {
		const directory = await makeTemporaryDirectory()
		const ledgerPath = join(directory, "ledger.jsonl")
		const lockPath = `${ledgerPath}.lock`
		await writeFile(
			lockPath,
			`${JSON.stringify({
				schemaVersion: 1,
				lockId: "active-owner",
				pid: process.pid,
				hostname: hostname(),
				createdAt: "2026-08-05T05:00:00.000Z",
			})}\n`,
		)

		const result = await runLedger([
			"lock-status",
			"--ledger",
			ledgerPath,
			"--json",
		])
		const output = JSON.parse(result.stdout)

		expect(result.exitCode).toBe(0)
		expect(output.data.owner.pid).toBe(process.pid)
		expect(output.data.ownerState).toBe("active")
		expect(output.data.repairable).toBe(false)
		expect(output.data.digest).toMatch(/^[a-f0-9]{64}$/)
		expect(await Bun.file(lockPath).exists()).toBe(true)
	})

	test("refuses to repair an active lock owner", async () => {
		const directory = await makeTemporaryDirectory()
		const ledgerPath = join(directory, "ledger.jsonl")
		const lockPath = `${ledgerPath}.lock`
		await writeFile(
			lockPath,
			`${JSON.stringify({
				schemaVersion: 1,
				lockId: "active-owner",
				pid: process.pid,
				hostname: hostname(),
				createdAt: "2026-08-05T05:00:00.000Z",
			})}\n`,
		)
		const status = JSON.parse(
			(
				await runLedger([
					"lock-status",
					"--ledger",
					ledgerPath,
					"--json",
				])
			).stdout,
		)

		const result = await runLedger([
			"lock-repair",
			"--ledger",
			ledgerPath,
			"--lock-digest",
			status.data.digest,
			"--json",
		])
		const output = JSON.parse(result.stdout)

		expect(result.exitCode).toBe(8)
		expect(output.error.code).toBe("LOCK_OWNER_ACTIVE")
		expect(output.error.changed).toBe(false)
		expect(await Bun.file(lockPath).exists()).toBe(true)
	})

	test("refuses to repair an owner from an unverifiable host", async () => {
		const directory = await makeTemporaryDirectory()
		const ledgerPath = join(directory, "ledger.jsonl")
		const lockPath = `${ledgerPath}.lock`
		await writeFile(
			lockPath,
			`${JSON.stringify({
				schemaVersion: 1,
				lockId: "remote-owner",
				pid: 999999,
				hostname: "different-host.example",
				createdAt: "2020-01-01T00:00:00.000Z",
			})}\n`,
		)
		const statusResult = await runLedger([
			"lock-status",
			"--ledger",
			ledgerPath,
			"--json",
		])
		const status = JSON.parse(statusResult.stdout)

		expect(status.data.ownerState).toBe("unverifiable")
		expect(status.data.repairable).toBe(false)
		const result = await runLedger([
			"lock-repair",
			"--ledger",
			ledgerPath,
			"--lock-digest",
			status.data.digest,
			"--json",
		])
		const output = JSON.parse(result.stdout)

		expect(result.exitCode).toBe(8)
		expect(output.error.code).toBe("LOCK_OWNER_UNVERIFIABLE")
		expect(output.error.changed).toBe(false)
		expect(await Bun.file(lockPath).exists()).toBe(true)
	})

	test("repairs only a digest-matched lock with a verified dead owner", async () => {
		const directory = await makeTemporaryDirectory()
		const ledgerPath = join(directory, "ledger.jsonl")
		const lockPath = `${ledgerPath}.lock`
		const exitedOwner = Bun.spawn(["bun", "-e", "process.exit(0)"], {
			stdout: "ignore",
			stderr: "ignore",
		})
		const deadPid = exitedOwner.pid
		await exitedOwner.exited
		await writeFile(
			lockPath,
			`${JSON.stringify({
				schemaVersion: 1,
				lockId: "dead-owner",
				pid: deadPid,
				hostname: hostname(),
				createdAt: "2020-01-01T00:00:00.000Z",
			})}\n`,
		)
		const statusResult = await runLedger([
			"lock-status",
			"--ledger",
			ledgerPath,
			"--json",
		])
		const status = JSON.parse(statusResult.stdout)

		expect(status.data.ownerState).toBe("dead")
		expect(status.data.repairable).toBe(true)
		const mismatch = await runLedger([
			"lock-repair",
			"--ledger",
			ledgerPath,
			"--lock-digest",
			"0".repeat(64),
			"--json",
		])
		expect(JSON.parse(mismatch.stdout).error.code).toBe(
			"LOCK_IDENTITY_CHANGED",
		)
		expect(await Bun.file(lockPath).exists()).toBe(true)

		const result = await runLedger([
			"lock-repair",
			"--ledger",
			ledgerPath,
			"--lock-digest",
			status.data.digest,
			"--json",
		])
		const output = JSON.parse(result.stdout)

		expect(result.exitCode).toBe(0)
		expect(output.data.changed).toBe(true)
		expect(output.data.removedDigest).toBe(status.data.digest)
		expect(await Bun.file(lockPath).exists()).toBe(false)
	})

	test("rejects record-only input on status", async () => {
		const result = await runLedger(["status", "--input", "-", "--json"])
		const output = JSON.parse(result.stdout)

		expect(result.exitCode).toBe(2)
		expect(output.error.code).toBe("INVALID_USAGE")
		expect(output.error.message).toBe("status does not accept --input")
	})

	test("rejects status-only quarter filter on record", async () => {
		const result = await runLedger([
			"record",
			"--input",
			"-",
			"--quarter",
			"FY26-Q2",
			"--json",
		])
		const output = JSON.parse(result.stdout)

		expect(result.exitCode).toBe(2)
		expect(output.error.code).toBe("INVALID_USAGE")
		expect(output.error.message).toBe("record does not accept --quarter")
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
		expect(statusOutput.data.nextSafeAction).toBe(
			"inspect_oldest_incomplete_quarter",
		)
		expect(status.stdout).not.toContain("gmail-message-private-reference")
		expect((await readFile(ledgerPath, "utf8")).trim().split("\n")).toHaveLength(1)
	})

	test("hardens an existing permissive ledger before appending", async () => {
		const directory = await makeTemporaryDirectory()
		const ledgerPath = join(directory, "ledger.jsonl")
		await writeFile(ledgerPath, "")
		await chmod(ledgerPath, 0o666)
		const input = JSON.stringify({
			quarter: "FY26-Q2",
			periodStart: "2025-10-01",
			periodEnd: "2025-12-31",
			event: "note",
			occurredAt: "2026-08-05T05:00:00.000Z",
			evidence: { kind: "manual_note", ref: "permission-test" },
		})

		const result = await runLedger(
			["record", "--ledger", ledgerPath, "--input", "-", "--json"],
			input,
		)

		expect(result.exitCode).toBe(0)
		expect((await stat(ledgerPath)).mode & 0o777).toBe(0o600)
		expect((await readFile(ledgerPath, "utf8")).trim()).not.toBe("")
	})

	test("reports chmod failure before persistence without writing", async () => {
		const directory = await makeTemporaryDirectory()
		const ledgerPath = join(directory, "ledger.jsonl")
		await writeFile(ledgerPath, "")
		await chmod(ledgerPath, 0o666)
		const input = JSON.stringify({
			quarter: "FY26-Q2",
			periodStart: "2025-10-01",
			periodEnd: "2025-12-31",
			event: "note",
			occurredAt: "2026-08-05T05:00:00.000Z",
			evidence: { kind: "manual_note", ref: "permission-fault-test" },
		})
		const result = await runLedger(
			["record", "--ledger", ledgerPath, "--input", "-", "--json"],
			input,
			{
				NODE_ENV: "test",
				XERO_QUARTER_LEDGER_TEST_FAULT: "before_chmod",
			},
		)
		const output = JSON.parse(result.stdout)

		expect(result.exitCode).toBe(1)
		expect(output.error.code).toBe("RUNTIME_FAILURE")
		expect(output.error.changed).toBe(false)
		expect(await readFile(ledgerPath, "utf8")).toBe("")
		expect((await stat(ledgerPath)).mode & 0o777).toBe(0o666)
	})

	test("reports a terminal operational action when every quarter is complete", async () => {
		const directory = await makeTemporaryDirectory()
		const ledgerPath = join(directory, "ledger.jsonl")
		const events = [
			{
				event: "reconciled",
				evidence: { kind: "xero_receipt", ref: "reconciliation-receipt" },
			},
			{
				event: "workpaper_exported",
				evidence: { kind: "local_file", ref: "bas-workpaper.xlsx" },
			},
			{
				event: "sent_to_accountant",
				evidence: { kind: "gmail_sent", ref: "gmail-sent-message" },
			},
			{
				event: "lodged",
				evidence: { kind: "accountant_email", ref: "lodgment-confirmation" },
			},
		]

		for (const [index, event] of events.entries()) {
			const input = JSON.stringify({
				quarter: "FY26-Q2",
				periodStart: "2025-10-01",
				periodEnd: "2025-12-31",
				occurredAt: `2026-08-05T0${index + 1}:00:00.000Z`,
				...event,
			})
			const record = await runLedger(
				["record", "--ledger", ledgerPath, "--input", "-", "--json"],
				input,
			)
			expect(record.exitCode).toBe(0)
		}

		const result = await runLedger([
			"status",
			"--ledger",
			ledgerPath,
			"--json",
		])
		const output = JSON.parse(result.stdout)

		expect(result.exitCode).toBe(0)
		expect(output.data.quarters[0].payment).toBe("unknown")
		expect(output.data.nextSafeAction).toBe(
			"monitor_payment_and_next_quarter",
		)
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
		expect(output.error.changed).toBe(false)
		expect(output.error.safeToRetrySameInput).toBe(false)
		expect(await Bun.file(ledgerPath).exists()).toBe(false)
	})

	test("reports an uncertain outcome when append persistence cannot be known", async () => {
		const directory = await makeTemporaryDirectory()
		const ledgerPath = join(directory, "ledger.jsonl")
		const input = JSON.stringify({
			quarter: "FY26-Q3",
			periodStart: "2026-01-01",
			periodEnd: "2026-03-31",
			event: "note",
			occurredAt: "2026-08-05T05:00:00.000Z",
			evidence: { kind: "manual_note", ref: "fault-test" },
		})
		const result = await runLedger(
			["record", "--ledger", ledgerPath, "--input", "-", "--json"],
			input,
			{
				NODE_ENV: "test",
				XERO_QUARTER_LEDGER_TEST_FAULT: "append_started",
			},
		)
		const output = JSON.parse(result.stdout)

		expect(result.exitCode).toBe(1)
		expect(output.error.code).toBe("RUNTIME_FAILURE")
		expect(output.error.changed).toBe("unknown")
		expect(output.error.nextSafeAction).toBe("inspect_ledger_before_retrying")
	})

	test("reports a changed outcome when failure follows durable append", async () => {
		const directory = await makeTemporaryDirectory()
		const ledgerPath = join(directory, "ledger.jsonl")
		const input = JSON.stringify({
			quarter: "FY26-Q3",
			periodStart: "2026-01-01",
			periodEnd: "2026-03-31",
			event: "note",
			occurredAt: "2026-08-05T05:00:00.000Z",
			evidence: { kind: "manual_note", ref: "fault-test" },
		})
		const result = await runLedger(
			["record", "--ledger", ledgerPath, "--input", "-", "--json"],
			input,
			{
				NODE_ENV: "test",
				XERO_QUARTER_LEDGER_TEST_FAULT: "append_synced",
			},
		)
		const output = JSON.parse(result.stdout)

		expect(result.exitCode).toBe(1)
		expect(output.error.code).toBe("RUNTIME_FAILURE")
		expect(output.error.changed).toBe(true)
		expect(output.error.nextSafeAction).toBe(
			"inspect_recorded_event_before_retrying",
		)
		expect((await readFile(ledgerPath, "utf8")).trim().split("\n")).toHaveLength(1)
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
