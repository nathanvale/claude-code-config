import { describe, expect, test } from "bun:test";
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
		expect(stdout.text()).toContain("browser-connect connect agent-browser --json");
		expect(stdout.text()).toContain("BROWSER_USE_LIVE_ACCEPTANCE=1");
		expect(stdout.text()).toContain("Touch ID");
		expect(stderr.text()).toBe("");
	});

	test("refuses before any live side effect when the environment gate is absent", async () => {
		const stdout = capture();
		const stderr = capture();
		expect(await runBrowserUseLiveAcceptance([], {}, stdout.writer, stderr.writer)).toBe(20);
		expect(stdout.text()).toBe("");
		expect(JSON.parse(stderr.text())).toMatchObject({ ok: false, code: "live-acceptance-disabled" });
	});
});
