// fallow-ignore-file unused-file
import { describe, expect, test } from "bun:test";
import type { Stats } from "node:fs";
import {
	hasPrivateMode,
	isContainedPath,
	isNodeErrorCode,
	isPermissionErrorCode,
	lstatOptional,
	safeRealpath,
} from "./runtime-file-safety";
import type { SkillFeedbackRuntime } from "./runtime-contract";

function runtime(overrides: Partial<SkillFeedbackRuntime>): SkillFeedbackRuntime {
	return {
		repoRoot: () => "/repo",
		resolveReadTarget: async () => ({
			ok: true,
			explicit: false,
			seedPath: "/repo",
			repoRoot: "/repo",
			inboxPath: "/repo/.skill-feedback",
		}),
		readGitSha: async () => "",
		readSkillVersion: async () => "",
		readStdinTelemetry: async () => ({}),
		readStdinText: async () => "",
		checkIgnored: async () => 0,
		readText: async () => "",
		removeFile: async () => undefined,
		mkdirPrivate: async () => undefined,
		writePrivateFile: async () => undefined,
		lstatPath: async () => ({ mode: 0o700 }) as Stats,
		realpathPath: async (path) => path,
		nowIso: () => "2026-06-30T00:00:00.000Z",
		...overrides,
	};
}

describe("runtime file safety", () => {
	test("lstatOptional treats ENOENT as missing and preserves other errors", async () => {
		const missing = runtime({
			lstatPath: async () => {
				throw { code: "ENOENT" };
			},
		});
		await expect(lstatOptional("/missing", missing)).resolves.toBeUndefined();

		const denied = runtime({
			lstatPath: async () => {
				throw { code: "EACCES" };
			},
		});
		await expect(lstatOptional("/denied", denied)).rejects.toMatchObject({
			code: "EACCES",
		});
	});

	test("safeRealpath returns undefined when resolution fails", async () => {
		const failing = runtime({
			realpathPath: async () => {
				throw new Error("nope");
			},
		});

		await expect(safeRealpath("/repo/.skill-feedback", failing)).resolves.toBeUndefined();
	});

	test("path containment rejects siblings and optionally accepts the parent", () => {
		expect(isContainedPath("/repo/.skill-feedback", "/repo/.skill-feedback/report.json")).toBe(true);
		expect(isContainedPath("/repo/.skill-feedback", "/repo/other/report.json")).toBe(false);
		expect(isContainedPath("/repo/.skill-feedback", "/repo/.skill-feedback")).toBe(false);
		expect(
			isContainedPath("/repo/.skill-feedback", "/repo/.skill-feedback", {
				allowSame: true,
			}),
		).toBe(true);
	});

	test("mode and error helpers keep filesystem checks explicit", () => {
		expect(hasPrivateMode({ mode: 0o700 } as Stats, 0o077)).toBe(true);
		expect(hasPrivateMode({ mode: 0o755 } as Stats, 0o077)).toBe(false);
		expect(isNodeErrorCode({ code: "ENOENT" }, "ENOENT")).toBe(true);
		expect(isNodeErrorCode(new Error("missing"), "ENOENT")).toBe(false);
		expect(isPermissionErrorCode({ code: "EACCES" })).toBe(true);
		expect(isPermissionErrorCode({ code: "EPERM" })).toBe(true);
		expect(isPermissionErrorCode({ code: "ENOENT" })).toBe(false);
	});
});
