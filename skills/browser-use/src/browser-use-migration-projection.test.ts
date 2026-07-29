import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runForTest } from "./browser-use";
import { readBrowserUseMigrationStatus } from "./browser-use-migration";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

const disposables: Array<{ dispose(): void }> = [];
const fixtureRoot = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"browser-use-migration",
	"full-root-corpus",
);

afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

describe("large corpus migration projections", () => {
	test("status and activate stay compact parseable JSON while plan and durable state retain all 133 rows", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const source = join(xdg.base, "large-corpus");
		cpSync(fixtureRoot, source, { recursive: true });
		const supporting = join(source, "bulk-supporting");
		mkdirSync(supporting, { recursive: true, mode: 0o700 });
		for (let index = 0; index < 122; index += 1) {
			writeFileSync(
				join(supporting, `note-${String(index).padStart(3, "0")}.txt`),
				`safe supporting note ${index}\n`,
				{ mode: 0o600 },
			);
		}
		const runtime = makeRuntime({ env: xdg.env });

		expect(
			(
				await runForTest(
					["migration", "inventory", "--source", source, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		const planned = await runForTest(
			["migration", "plan", "--source", source, "--json"],
			runtime,
		);
		expect(planned.exitCode, planned.stdout).toBe(0);
		const plannedData = parseJson(planned.stdout).data as {
			disposition_count: number;
			dispositions: unknown[];
		};
		expect(plannedData.disposition_count).toBe(133);
		expect(plannedData.dispositions).toHaveLength(133);

		const imported = await runForTest(
			["migration", "import", "--source", source, "--json"],
			runtime,
		);
		expect(imported.exitCode).toBe(0);
		const generationId = (
			parseJson(imported.stdout).data as { generation_id: string }
		).generation_id;

		const status = await runForTest(
			["migration", "status", "--json"],
			runtime,
		);
		expect(status.exitCode).toBe(0);
		expect(Buffer.byteLength(status.stdout, "utf8")).toBeLessThan(16 * 1024);
		const statusData = parseJson(status.stdout).data as {
			disposition_count: number;
			dispositions: unknown[];
			dispositions_omitted: boolean;
			disposition_summary: Record<string, number>;
			target_provenance: unknown[];
			target_provenance_count: number;
			target_provenance_omitted: boolean;
		};
		expect(statusData).toMatchObject({
			disposition_count: 133,
			dispositions: [],
			dispositions_omitted: true,
			target_provenance: [],
		});
		expect(
			Object.values(statusData.disposition_summary).reduce(
				(total, count) => total + count,
				0,
			),
		).toBe(133);
		expect(statusData.target_provenance_omitted).toBe(
			statusData.target_provenance_count > 0,
		);

		const activated = await runForTest(
			[
				"migration",
				"activate",
				"--generation",
				generationId,
				"--json",
			],
			runtime,
		);
		expect(activated.exitCode).toBe(0);
		expect(Buffer.byteLength(activated.stdout, "utf8")).toBeLessThan(16 * 1024);
		expect(parseJson(activated.stdout).data).toMatchObject({
			activation_state: "active",
			disposition_count: 133,
			dispositions: [],
			dispositions_omitted: true,
		});

		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error(opened.refusal.code);
		const durable = await readBrowserUseMigrationStatus({
			fs,
			paths: opened.paths,
			clock: () => 1_774_848_000_000,
		});
		expect(durable.ok).toBe(true);
		if (!durable.ok) throw new Error(durable.code);
		expect(durable.state.dispositions).toHaveLength(133);
		expect(durable.state.target_provenance).toHaveLength(
			statusData.target_provenance_count,
		);
	});
});
