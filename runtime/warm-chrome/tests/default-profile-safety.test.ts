import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isDefaultChromeProfilePath } from "../src/runtime.ts";

// ===========================================================================
// DDA-F26 default-profile safety invariant.
//
// Browser Use must never enable remote debugging on the user's real default
// Chrome profile, nor attach/verify/launch/repair against it — the automation
// surface is confined to the dedicated WARM_CHROME_DEFAULT_PROFILE_DIR.
//
// The attach/verify/launch/repair half is enforced by isDefaultChromeProfilePath
// (proof.ts, launch.ts, repair.ts) and proven in check-stations.test.ts and
// runtime.test.ts. This file pins the ENABLE half, traced from the 2026-07-27
// incident: a Human-Chrome operator recovery (enable_human_chrome_remote_debugging)
// toggled Chrome's PERSISTENT devtools.remote_debugging.user-enabled setting on
// the user's real logged-in profile, so remote debugging re-enabled on every
// restart. The guarantee: no shipping warm-chrome code programmatically writes
// that persistent setting. Remote debugging is requested ONLY via a transient
// --remote-debugging-port launch flag against the dedicated profile; the
// persistent Chrome setting is never mutated by this package. The day an
// implementation slips a persistent enable in, this test goes red.
// ===========================================================================

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

async function sourceFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await sourceFiles(path)));
			continue;
		}
		if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
			files.push(path);
		}
	}
	return files;
}

describe("DDA-F26 default-profile safety: the persistent remote-debugging setting is never enabled", () => {
	test("no shipping source writes Chrome's persistent devtools.remote_debugging.user-enabled setting", async () => {
		const files = await sourceFiles(SRC_DIR);
		expect(files.length).toBeGreaterThan(0);

		// A programmatic enable would touch Chrome's Local State / Preferences and
		// set the persistent user-enabled flag. Remote debugging is legitimately
		// requested only via the transient --remote-debugging-port launch flag, so
		// none of these persistent-setting tokens may appear in shipping source.
		const forbidden = [
			"remote_debugging",
			"user-enabled",
			"user_enabled",
			"remote-debugging-enabled",
		];

		const offenders: Array<{ file: string; token: string; line: number }> = [];
		for (const file of files) {
			const lines = (await readFile(file, "utf8")).split("\n");
			lines.forEach((text, index) => {
				for (const token of forbidden) {
					if (text.includes(token)) {
						offenders.push({ file, token, line: index + 1 });
					}
				}
			});
		}

		expect(offenders).toEqual([]);
	});

	test("Local State / Preferences writes are absent from shipping source (no persistent Chrome-settings mutation)", async () => {
		const files = await sourceFiles(SRC_DIR);
		const offenders: Array<{ file: string; line: number }> = [];
		for (const file of files) {
			const lines = (await readFile(file, "utf8")).split("\n");
			lines.forEach((text, index) => {
				// A write to Chrome's own persisted config is the mutation vector the
				// incident exercised. Reads (proof reads DevToolsActivePort) are fine;
				// a write path to Local State / a profile Preferences file is not.
				const mentionsChromeConfig =
					text.includes("Local State") || text.includes("Preferences");
				const mentionsWrite = /writeFile|writeFileSync|\bwriteFileDurable\b/.test(
					text,
				);
				if (mentionsChromeConfig && mentionsWrite) {
					offenders.push({ file, line: index + 1 });
				}
			});
		}
		expect(offenders).toEqual([]);
	});

	test("the matcher confines automation to the dedicated profile: the real default profile is rejected", () => {
		const env = { HOME: "/Users/example" };
		// The user's real logged-in profile and its Default sub-profile are default.
		expect(
			isDefaultChromeProfilePath(
				"/Users/example/Library/Application Support/Google/Chrome",
				env,
			),
		).toBe(true);
		expect(
			isDefaultChromeProfilePath(
				"/Users/example/Library/Application Support/Google/Chrome/Default",
				env,
			),
		).toBe(true);
		// The dedicated warm profile is the ONLY sanctioned automation target.
		expect(
			isDefaultChromeProfilePath("/Users/example/.agent-warm-profile", env),
		).toBe(false);
	});
});
