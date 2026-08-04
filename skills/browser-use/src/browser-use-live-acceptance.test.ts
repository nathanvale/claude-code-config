import { describe, expect, spyOn, test } from "bun:test";
import { runBrowserUseLiveAcceptance } from "./browser-use-live-acceptance";

function capture() {
	const chunks: string[] = [];
	return {
		writer: { write(text: string) { chunks.push(text); return true; } },
		text: () => chunks.join(""),
	};
}

describe("live Runbook acceptance gate", () => {
	test("is discoverable without starting a browser or fixture server", async () => {
		const stdout = capture();
		const stderr = capture();
		expect(await runBrowserUseLiveAcceptance(["--help"], {}, stdout.writer, stderr.writer)).toBe(0);
		expect(stdout.text()).toContain("BROWSER_USE_LIVE_ACCEPTANCE=1");
		expect(stdout.text()).toContain("Production Reviewed Action promotion is unavailable");
		expect(stderr.text()).toBe("");
	});

	test("refuses before any live side effect when the environment gate is absent", async () => {
		const stdout = capture();
		const stderr = capture();
		expect(await runBrowserUseLiveAcceptance([], {}, stdout.writer, stderr.writer)).toBe(20);
		expect(stdout.text()).toBe("");
		expect(JSON.parse(stderr.text())).toMatchObject({ ok: false, code: "live-acceptance-disabled" });
	});

	test("native capability absence wins over every legacy enablement value", async () => {
		const serverSpy = spyOn(Bun, "serve");
		const processSpy = spyOn(Bun, "spawn");
		const stdout = capture();
		const stderr = capture();
		try {
			expect(await runBrowserUseLiveAcceptance([], {
				BROWSER_USE_LIVE_ACCEPTANCE: "1",
				BROWSER_USE_REVIEWED_ACTION_APPROVAL_BROKER: "/tmp/self-reported-broker",
				BROWSER_USE_REVIEWED_ACTION_VERIFIER: "self-reported-verifier",
			}, stdout.writer, stderr.writer)).toBe(20);
			expect(stdout.text()).toBe("");
			expect(JSON.parse(stderr.text())).toMatchObject({
				ok: false,
				code: "native-capability-absent",
				repair: "install-and-admit-browser-use-security",
			});
			expect(serverSpy).not.toHaveBeenCalled();
			expect(processSpy).not.toHaveBeenCalled();
		} finally {
			serverSpy.mockRestore();
			processSpy.mockRestore();
		}
	});
});
