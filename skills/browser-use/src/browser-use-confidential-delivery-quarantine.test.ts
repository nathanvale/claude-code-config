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

	test("a delivered field stays capture-blocked after cleanup", async () => {
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
			ok: false,
		});
		expect(journal).toEqual([]);
		expect(controller.inspect()).toEqual({
			state: "cleaned",
			write_state: "delivered",
		});
	});

	test("a held cleaned target accepts another field without reopening capture", async () => {
		let commands = 0;
		const controller = createBrowserUseConfidentialDeliveryQuarantine({
			runCommand: async () => {
				commands += 1;
				return { exitCode: 0, stdout: "{}", stderr: "" };
			},
		});

		for (let field = 0; field < 2; field += 1) {
			expect(await controller.quarantine.pause({ target: TARGET })).toEqual({
				ok: true,
			});
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
		}

		expect(commands).toBe(0);
		expect(await controller.quarantine.resume({ target: TARGET })).toEqual({
			ok: false,
		});
	});

	test("a blocked second field cannot erase an earlier delivered field", async () => {
		const controller = createBrowserUseConfidentialDeliveryQuarantine({
			runCommand: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
		});
		expect(await controller.quarantine.pause({ target: TARGET })).toEqual({
			ok: true,
		});
		expect(
			await controller.quarantine.cleanup({
				target: TARGET,
				write_state: "delivered",
			}),
		).toEqual({ ok: true });
		expect(await controller.quarantine.pause({ target: TARGET })).toEqual({
			ok: true,
		});
		expect(
			await controller.quarantine.cleanup({
				target: TARGET,
				write_state: "blocked-before-write",
			}),
		).toEqual({ ok: true });

		expect(await controller.quarantine.resume({ target: TARGET })).toEqual({
			ok: false,
		});
	});

	test("rebinds one held target across navigation without widening run or target identity", async () => {
		const approvedRebindOrigins = [
			"https://portal.example.com",
			"https://service.example.com",
		];
		const controllerInput = {
			runCommand: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
			approved_rebind_origins: approvedRebindOrigins,
		};
		const controller =
			createBrowserUseConfidentialDeliveryQuarantine(controllerInput);
		expect(await controller.quarantine.pause({ target: TARGET })).toEqual({
			ok: true,
		});
		expect(
			await controller.quarantine.cleanup({
				target: TARGET,
				write_state: "delivered",
			}),
		).toEqual({ ok: true });

		const navigated = {
			...TARGET,
			top_level_origin: "https://service.example.com",
			frame_origin: "https://service.example.com",
			page_id: "page-2",
			frame_id: "frame-2",
			target_proof_digest: "b".repeat(64),
		};
		expect(
			controller.rebind({
				previous_target: TARGET,
				next_target: { ...navigated, target_id: "target-other" },
			}),
		).toEqual({ ok: false });
		approvedRebindOrigins.push("https://attacker.example.com");
		controllerInput.approved_rebind_origins = [
			"https://attacker.example.com",
		];
		expect(
			controller.rebind({
				previous_target: TARGET,
				next_target: {
					...navigated,
					top_level_origin: "https://attacker.example.com",
					frame_origin: "https://attacker.example.com",
				},
			}),
		).toEqual({ ok: false });
		expect(
			controller.rebind({
				previous_target: TARGET,
				next_target: navigated,
			}),
		).toEqual({ ok: true });
		expect(
			await controller.quarantine.pause({ target: navigated }),
		).toEqual({ ok: true });
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
