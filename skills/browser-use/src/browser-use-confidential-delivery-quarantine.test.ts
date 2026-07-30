import { describe, expect, test } from "bun:test";
import type { BrowserUseVerifiedTarget } from "./browser-use-confidential-field-delivery";
import { createBrowserUseConfidentialDeliveryQuarantine } from "./browser-use-confidential-delivery-quarantine";

const TARGET: BrowserUseVerifiedTarget = {
	lane_id: "agent-browser",
	run_id: "run-1",
	top_level_origin: "https://portal.example.com",
	frame_origin: "https://portal.example.com",
	target_id: "target-1",
	page_id: "page-1",
	frame_id: "frame-1",
	account_ref: "account-1",
	target_proof_digest: "a".repeat(64),
};

describe("production confidential-delivery quarantine", () => {
	test("pause refuses while a capture command is already in flight", async () => {
		let release: (() => void) | undefined;
		const commandFinished = new Promise<void>((resolve) => {
			release = resolve;
		});
		const controller = createBrowserUseConfidentialDeliveryQuarantine({
			runCommand: async () => {
				await commandFinished;
				return { exitCode: 0, stdout: "{}", stderr: "" };
			},
		});
		const inFlight = controller.runCommand({
			command: "/usr/bin/agent-browser",
			args: ["snapshot"],
			timeoutMs: 1_000,
		});
		expect(await controller.quarantine.pause({ target: TARGET })).toEqual({
			ok: false,
		});
		release?.();
		await inFlight;
		expect(await controller.quarantine.pause({ target: TARGET })).toEqual({
			ok: true,
		});
	});

	test("capture stays blocked from pause through cleanup and resumes only after cleanup", async () => {
		const journal: string[] = [];
		const controller = createBrowserUseConfidentialDeliveryQuarantine({
			runCommand: async () => {
				journal.push("command");
				return { exitCode: 0, stdout: "{}", stderr: "" };
			},
		});

		expect(await controller.quarantine.pause({ target: TARGET })).toEqual({
			ok: true,
		});
		await expect(
			controller.runCommand({
				command: "/usr/bin/agent-browser",
				args: ["snapshot"],
				timeoutMs: 1_000,
			}),
		).rejects.toThrow("capture is quarantined");
		expect(
			await controller.quarantine.cleanup({
				target: TARGET,
				write_state: "delivered",
			}),
		).toEqual({ ok: true });
		await expect(
			controller.runCommand({
				command: "/usr/bin/agent-browser",
				args: ["snapshot"],
				timeoutMs: 1_000,
			}),
		).rejects.toThrow("capture is quarantined");
		expect(await controller.quarantine.resume({ target: TARGET })).toEqual({
			ok: true,
		});
		expect(
			await controller.runCommand({
				command: "/usr/bin/agent-browser",
				args: ["snapshot"],
				timeoutMs: 1_000,
			}),
		).toEqual({ exitCode: 0, stdout: "{}", stderr: "" });
		expect(journal).toEqual(["command"]);
		expect(controller.inspect()).toEqual({
			state: "open",
			write_state: null,
		});
	});

	test("an unknown write remains quarantined and cannot start another delivery", async () => {
		let commands = 0;
		const controller = createBrowserUseConfidentialDeliveryQuarantine({
			runCommand: async () => {
				commands += 1;
				return { exitCode: 0, stdout: "{}", stderr: "" };
			},
		});
		expect(await controller.quarantine.pause({ target: TARGET })).toEqual({
			ok: true,
		});
		expect(
			await controller.quarantine.cleanup({
				target: TARGET,
				write_state: "write-outcome-unknown",
			}),
		).toEqual({ ok: true });
		expect(await controller.quarantine.resume({ target: TARGET })).toEqual({
			ok: false,
		});
		expect(await controller.quarantine.pause({ target: TARGET })).toEqual({
			ok: false,
		});
		await expect(
			controller.runCommand({
				command: "/usr/bin/agent-browser",
				args: ["snapshot"],
				timeoutMs: 1_000,
			}),
		).rejects.toThrow("capture is quarantined");
		expect(commands).toBe(0);
		expect(controller.inspect()).toEqual({
			state: "quarantined",
			write_state: "write-outcome-unknown",
		});
	});

	test("target drift cannot clean or reopen a paused quarantine", async () => {
		const controller = createBrowserUseConfidentialDeliveryQuarantine({
			runCommand: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
		});
		expect(await controller.quarantine.pause({ target: TARGET })).toEqual({
			ok: true,
		});
		const drifted = { ...TARGET, page_id: "page-other" };
		expect(
			await controller.quarantine.cleanup({
				target: drifted,
				write_state: "blocked-before-write",
			}),
		).toEqual({ ok: false });
		expect(await controller.quarantine.resume({ target: drifted })).toEqual({
			ok: false,
		});
		expect(controller.inspect()).toEqual({
			state: "paused",
			write_state: null,
		});
	});

	test("an unknown cleanup write state fails closed and keeps capture paused", async () => {
		const controller = createBrowserUseConfidentialDeliveryQuarantine({
			runCommand: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
		});
		expect(await controller.quarantine.pause({ target: TARGET })).toEqual({
			ok: true,
		});
		expect(
			await controller.quarantine.cleanup({
				target: TARGET,
				write_state: "future-state",
			} as never),
		).toEqual({ ok: false });
		expect(controller.inspect()).toEqual({
			state: "paused",
			write_state: null,
		});
	});
});
