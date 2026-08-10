import { chmod, mkdtemp, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	approvePreparedReceipt,
	createReceiptStore,
	dispatchApprovedInvocation,
	isOutcomeUnknownError,
	markReceiptDispatched,
	settleIncompleteAttempt,
	validateDispatchApproval,
	validatePreparedRequest,
	validatePreparedRequestBinding,
	validateResultSummary,
	type ReceiptStore,
} from "../src/receipt-store.ts";
import type { ExecutionReceipt } from "../src/model.ts";
import { fingerprintValue } from "../src/pre-image.ts";

function preparedReceipt(): ExecutionReceipt {
	return {
		schema_version: 1,
		receipt_id: "receipt-1",
		attempt: 1,
		adapter: "firecrawl-cli",
		route: "firecrawl.search",
		checkpoint_id: "firecrawl-v1",
		qualification_cell: {
			lane: "explicit_cli",
			client: "tool-execution",
			provider: "firecrawl",
			route: "firecrawl.search",
		},
		request_fingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		config_fingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		state: "prepared",
		created_at: "2026-08-09T00:00:00.000Z",
		updated_at: "2026-08-09T00:00:00.000Z",
	};
}

describe("receipt store", () => {
	test("writes private receipts atomically and ignores an interrupted temp file", async () => {
		const root = await mkdtemp(join(tmpdir(), "tool-execution-receipts-"));
		const store: ReceiptStore = createReceiptStore(root);
		await store.write(preparedReceipt());

		await writeFile(join(root, ".receipt-1.json.interrupted"), "{broken", {
			mode: 0o600,
		});
		await chmod(root, 0o700);

		expect(await store.read("receipt-1")).toEqual(preparedReceipt());
		expect((await stat(root)).mode & 0o777).toBe(0o700);
		expect((await stat(join(root, "receipt-1.json"))).mode & 0o777).toBe(0o600);
	});

	test("rejects undeclared receipt fields instead of persisting a raw payload", async () => {
		const root = await mkdtemp(join(tmpdir(), "tool-execution-receipts-"));
		const store = createReceiptStore(root);
		await expect(
			store.write({ ...preparedReceipt(), request: { api_key: "not-stored" } } as never),
		).rejects.toThrow("unsupported field");
	});

	test("marks dispatch before the provider boundary without changing the attempt", () => {
		expect(
			markReceiptDispatched(preparedReceipt(), "2026-08-09T00:00:01.000Z"),
		).toMatchObject({
			receipt_id: "receipt-1",
			attempt: 1,
			state: "dispatched",
			updated_at: "2026-08-09T00:00:01.000Z",
		});
	});

	test("makes pre-dispatch timeout terminal and post-dispatch timeout unknown", () => {
		const prepared = preparedReceipt();
		const dispatched = markReceiptDispatched(
			prepared,
			"2026-08-09T00:00:01.000Z",
		);

		expect(
			settleIncompleteAttempt(prepared, {
				kind: "timeout",
				updatedAt: "2026-08-09T00:00:02.000Z",
			}),
		).toMatchObject({ state: "terminal", terminal_reason: "pre_dispatch_timeout" });
		expect(
			settleIncompleteAttempt(dispatched, {
				kind: "timeout",
				updatedAt: "2026-08-09T00:00:02.000Z",
			}),
		).toMatchObject({ state: "unknown", terminal_reason: "post_dispatch_timeout" });
	});

	test("refuses approval without an explicit task-policy decision", () => {
		expect(
			approvePreparedReceipt(preparedReceipt(), {
				taskApproved: false,
				decision: "approve",
				now: "2026-08-09T00:00:01.000Z",
				expiresAt: "2026-08-09T00:05:01.000Z",
			}),
		).toEqual(preparedReceipt());
	});

	test("records an explicit task-policy denial as terminal without a fallback", () => {
		expect(
			approvePreparedReceipt(preparedReceipt(), {
				taskApproved: true,
				decision: "deny",
				now: "2026-08-09T00:00:01.000Z",
				expiresAt: "2026-08-09T00:05:01.000Z",
			}),
		).toMatchObject({ state: "terminal", terminal_reason: "approval_denied" });
	});

	test("binds task-policy approval to request, route, attempt, and checkpoint", () => {
		expect(
			approvePreparedReceipt(preparedReceipt(), {
				taskApproved: true,
				decision: "approve",
				now: "2026-08-09T00:00:01.000Z",
				expiresAt: "2026-08-09T00:05:01.000Z",
			}),
		).toMatchObject({
			state: "prepared",
			approval: {
				approval_surface: "task_policy",
				request_fingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				route: "firecrawl.search",
				attempt: 1,
				checkpoint_id: "firecrawl-v1",
			},
		});
	});

	test("dispatch refuses missing, stale, and mismatched task approval", () => {
		const approved = approvePreparedReceipt(preparedReceipt(), {
			taskApproved: true,
			decision: "approve",
			now: "2026-08-09T00:00:01.000Z",
			expiresAt: "2026-08-09T00:05:01.000Z",
		});
		const check = {
			now: "2026-08-09T00:02:00.000Z",
			requestFingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			route: "firecrawl.search",
			attempt: 1,
			checkpointId: "firecrawl-v1",
		};

		expect(validateDispatchApproval(preparedReceipt(), check)).toEqual({
			ok: false,
			reason: "approval_missing",
		});
		expect(
			validateDispatchApproval(approved, {
				...check,
				now: "2026-08-09T00:06:00.000Z",
			}),
		).toEqual({ ok: false, reason: "approval_stale" });
		expect(
			validateDispatchApproval(approved, {
				...check,
				requestFingerprint: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
			}),
		).toEqual({ ok: false, reason: "approval_mismatched" });
	});

	test("binds the call input to the prepared adapter, cell, and request", () => {
		const receipt = preparedReceipt();
		const request = {
			adapter: "firecrawl-cli" as const,
			route: receipt.route,
			checkpoint_id: receipt.checkpoint_id,
			qualification_cell: receipt.qualification_cell,
			request: { operation: "search", query: "bounded public query" },
		};
		const bound = {
			...receipt,
			request_fingerprint: fingerprintValue(request.request),
		};

		expect(validatePreparedRequestBinding(bound, request)).toEqual({ ok: true });
	});

	test("rejects malformed adapter payloads before receipt creation", () => {
		const base = {
			route: "firecrawl.search",
			checkpoint_id: "firecrawl-v1",
			qualification_cell: preparedReceipt().qualification_cell,
		};

		expect(() =>
			validatePreparedRequest({
				...base,
				adapter: "firecrawl-cli",
				request: { operation: "search" },
			}),
		).toThrow("Firecrawl request query must be a non-empty string.");
		expect(() =>
			validatePreparedRequest({
				...base,
				adapter: "mcporter-cli",
				route: "mcporter.firecrawl.search",
				qualification_cell: {
					...preparedReceipt().qualification_cell,
					route: "mcporter.firecrawl.search",
				},
				request: {
					server: "firecrawl",
					tool: "firecrawl_search",
					arguments: null,
				},
			}),
		).toThrow("MCPorter request arguments must be a plain object.");
	});

	test("rejects cross-labelled adapters and recursive authority-bearing arguments", () => {
		const base = {
			route: "mcporter.firecrawl.search",
			checkpoint_id: "firecrawl-v1",
			qualification_cell: {
				lane: "explicit_cli",
				client: "tool-execution",
				provider: "firecrawl",
				route: "mcporter.firecrawl.search",
			},
			adapter: "mcporter-cli",
			request: {
				server: "firecrawl",
				tool: "firecrawl_search",
				arguments: { query: "bounded public query" },
			},
		};

		expect(() =>
			validatePreparedRequest({
				...base,
				qualification_cell: {
					...base.qualification_cell,
					client: "other-client",
				},
			}),
		).toThrow("Prepared request adapter binding is invalid.");
		expect(() =>
			validatePreparedRequest({
				...base,
				request: {
					...base.request,
					arguments: {
						query: "bounded public query",
						nested: { api_url: "https://attacker.test" },
					},
				},
			}),
		).toThrow("authority-bearing field");
	});

	test("rejects caller-supplied config fingerprints and unsafe result codes", () => {
		expect(() =>
			validatePreparedRequest({
				adapter: "firecrawl-cli",
				route: "firecrawl.search",
				checkpoint_id: "firecrawl-v1",
				qualification_cell: preparedReceipt().qualification_cell,
				request: { operation: "search", query: "bounded public query" },
				config_fingerprint: "sha256:short",
			}),
		).toThrow("unsupported field");
		expect(() =>
			validateResultSummary({
				class: "jsonrpc_protocol_or_server_error",
				code: "token=fixture-secret",
				result_fingerprint: `sha256:${"d".repeat(64)}`,
			}),
		).toThrow("code is invalid");
	});

	test("reaps only a dead prepared lock and retries the claim once", async () => {
		const root = await mkdtemp(join(tmpdir(), "tool-execution-lock-recovery-"));
		const store = createReceiptStore(root);
		const approved = approvePreparedReceipt(preparedReceipt(), {
			taskApproved: true,
			decision: "approve",
			now: "2026-08-09T00:00:01.000Z",
			expiresAt: "2026-08-09T00:05:01.000Z",
		});
		await store.write(approved);
		const lockPath = join(root, ".receipt-1.dispatch.lock");
		await writeFile(
			lockPath,
			JSON.stringify({ pid: 99_999_999, created_at: new Date().toISOString() }),
			{ mode: 0o600 },
		);

		await expect(
			store.claimPreparedDispatch(approved, "2026-08-09T00:00:02.000Z"),
		).resolves.toMatchObject({ state: "dispatched" });
	});

	test("never reaps a live, fresh malformed, or dispatched lock", async () => {
		for (const fixture of ["live", "malformed", "dispatched"] as const) {
			const root = await mkdtemp(join(tmpdir(), `tool-execution-lock-${fixture}-`));
			const store = createReceiptStore(root);
			const approved = approvePreparedReceipt(preparedReceipt(), {
				taskApproved: true,
				decision: "approve",
				now: "2026-08-09T00:00:01.000Z",
				expiresAt: "2026-08-09T00:05:01.000Z",
			});
			await store.write(
				fixture === "dispatched"
					? markReceiptDispatched(approved, "2026-08-09T00:00:02.000Z")
					: approved,
			);
			const lockPath = join(root, ".receipt-1.dispatch.lock");
			await writeFile(
				lockPath,
				fixture === "malformed"
					? "broken"
					: JSON.stringify({
							pid: fixture === "live" ? process.pid : 99_999_999,
							created_at: new Date().toISOString(),
						}),
				{ mode: 0o600 },
			);
			await utimes(lockPath, new Date(), new Date());

			await expect(
				store.claimPreparedDispatch(approved, "2026-08-09T00:00:03.000Z"),
			).rejects.toThrow();
		}
	});

	test("reaps an old invalid lock only while its receipt remains prepared", async () => {
		const root = await mkdtemp(join(tmpdir(), "tool-execution-old-invalid-lock-"));
		const store = createReceiptStore(root);
		const approved = approvePreparedReceipt(preparedReceipt(), {
			taskApproved: true,
			decision: "approve",
			now: "2026-08-09T00:00:01.000Z",
			expiresAt: "2026-08-09T00:05:01.000Z",
		});
		await store.write(approved);
		const lockPath = join(root, ".receipt-1.dispatch.lock");
		await writeFile(lockPath, "{}", { mode: 0o600 });
		const old = new Date(Date.now() - 60_000);
		await utimes(lockPath, old, old);

		await expect(
			store.claimPreparedDispatch(approved, "2026-08-09T00:00:03.000Z"),
		).resolves.toMatchObject({ state: "dispatched" });
	});

	test("approval replacement cannot overwrite a concurrent dispatch", async () => {
		const root = await mkdtemp(join(tmpdir(), "tool-execution-approval-race-"));
		const store = createReceiptStore(root);
		const approved = approvePreparedReceipt(preparedReceipt(), {
			taskApproved: true,
			decision: "approve",
			now: "2026-08-09T00:00:01.000Z",
			expiresAt: "2026-08-09T00:05:01.000Z",
		});
		const replacement = approvePreparedReceipt(approved, {
			taskApproved: true,
			decision: "approve",
			now: "2026-08-09T00:00:02.000Z",
			expiresAt: "2026-08-09T00:05:02.000Z",
		});
		await store.write(approved);

		const outcomes = await Promise.allSettled([
			store.claimPreparedDispatch(approved, "2026-08-09T00:00:03.000Z"),
			store.replacePrepared(approved, replacement),
		]);
		expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(
			1,
		);
		const durable = await store.read(approved.receipt_id);
		expect(durable?.state === "dispatched" || durable === replacement).toBe(true);
	});

	test("a failed dispatched checkpoint remains pre-dispatch and terminal", async () => {
		const receipt = approvePreparedReceipt(preparedReceipt(), {
			taskApproved: true,
			decision: "approve",
			now: "2026-08-09T00:00:01.000Z",
			expiresAt: "2026-08-09T00:05:01.000Z",
		});
		let providerBoundaryCrossed = false;
		let persisted: ExecutionReceipt | undefined;
		const store: ReceiptStore = {
			root: "fixture",
			async write(next) {
				if (next.state === "dispatched") throw new Error("checkpoint write failed");
				persisted = next;
			},
			async read() { return undefined; },
			async list() { return []; },
			async claimPreparedDispatch(next, updatedAt) {
				const dispatched = markReceiptDispatched(next, updatedAt);
				await this.write(dispatched);
				return dispatched;
			},
			async replacePrepared() { throw new Error("unused"); },
		};

		const outcome = await dispatchApprovedInvocation({
			receipt,
			store,
			invocation: { command: "fixture", args: [] },
			requestFingerprint: receipt.request_fingerprint,
			now: () => "2026-08-09T00:00:02.000Z",
			timeoutMs: 1000,
			childEnv: {},
			spawn: async (input) => {
				await input.beforeSpawn?.();
				providerBoundaryCrossed = true;
				throw new Error("unreachable");
			},
		});

		expect(providerBoundaryCrossed).toBe(false);
		expect(outcome.receipt).toMatchObject({
			state: "terminal",
			terminal_reason: "pre_dispatch_interruption",
		});
		expect(persisted?.state).toBe("terminal");
	});

	test("a durable write failure after provider dispatch is outcome unknown", async () => {
		const approved = approvePreparedReceipt(preparedReceipt(), {
			taskApproved: true,
			decision: "approve",
			now: "2026-08-09T00:00:01.000Z",
			expiresAt: "2026-08-09T00:05:01.000Z",
		});
		let durable = approved;
		const store: ReceiptStore = {
			root: "fixture",
			async write(next) {
				if (next.state !== "dispatched") {
					throw new Error("terminal write failed");
				}
				durable = next;
			},
			async read() {
				return durable;
			},
			async list() {
				return [durable];
			},
			async claimPreparedDispatch(next, updatedAt) {
				durable = markReceiptDispatched(next, updatedAt);
				await this.write(durable);
				return durable;
			},
			async replacePrepared() { throw new Error("unused"); },
		};

		try {
			await dispatchApprovedInvocation({
				receipt: approved,
				store,
				invocation: { command: "fixture", args: [] },
				requestFingerprint: approved.request_fingerprint,
				now: () => "2026-08-09T00:00:02.000Z",
				timeoutMs: 1000,
				childEnv: {},
				spawn: async (input) => {
					await input.beforeSpawn?.();
					return { exitCode: 0, stdout: '{"data":[]}', stderr: "" };
				},
			});
			throw new Error("Expected outcome-unknown failure.");
		} catch (error) {
			expect(isOutcomeUnknownError(error)).toBe(true);
		}
		expect(durable.state).toBe("dispatched");
	});
});
