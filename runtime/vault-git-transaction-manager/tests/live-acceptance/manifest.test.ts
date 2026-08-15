import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import {
	LIVE_ACCEPTANCE_WORKFLOWS,
	LIVE_ACCEPTANCE_CORRECTNESS_ROW_COUNT,
	LIVE_ACCEPTANCE_LATENCY_ROWS,
	ORIGINAL_LIVE_ACCEPTANCE_ROW_COUNT,
	extractLiteralTestNames,
	validateLiveAcceptanceManifest,
} from "./manifest.ts";

const discovered = LIVE_ACCEPTANCE_WORKFLOWS.map(({ file }) => file);
const directory = dirname(fileURLToPath(import.meta.url));

describe("live acceptance manifest", () => {
	test("accepts the exact unique nonzero workflow set", () => {
		expect(
			validateLiveAcceptanceManifest(LIVE_ACCEPTANCE_WORKFLOWS, discovered),
		).toEqual(LIVE_ACCEPTANCE_WORKFLOWS);
	});

	test("refuses a missing workflow", () => {
		expect(() =>
			validateLiveAcceptanceManifest(
				LIVE_ACCEPTANCE_WORKFLOWS,
				discovered.slice(1),
			),
		).toThrow("missing=background-doctor.integration.test.ts");
	});

	test("refuses a duplicate workflow declaration", () => {
		expect(() =>
			validateLiveAcceptanceManifest(
				[...LIVE_ACCEPTANCE_WORKFLOWS, LIVE_ACCEPTANCE_WORKFLOWS[0]!],
				discovered,
			),
		).toThrow("duplicate live acceptance groups");
	});

	test("refuses an unexpected workflow", () => {
		expect(() =>
			validateLiveAcceptanceManifest(LIVE_ACCEPTANCE_WORKFLOWS, [
				...discovered,
				"unowned.integration.test.ts",
			]),
		).toThrow("unexpected=unowned.integration.test.ts");
	});

	test("refuses a non-positive expected count", () => {
		expect(() =>
			validateLiveAcceptanceManifest(
				[{ file: discovered[0]!, expectedTests: 0, ownedRows: [] }],
				[discovered[0]!],
			),
		).toThrow("non-positive expected test count");
	});

	test("refuses missing row ownership", () => {
		const first = LIVE_ACCEPTANCE_WORKFLOWS[0]!;
		expect(() =>
			validateLiveAcceptanceManifest(
				[
					{
						...first,
						expectedTests: first.expectedTests - 1,
						ownedRows: first.ownedRows.slice(1),
					},
					...LIVE_ACCEPTANCE_WORKFLOWS.slice(1),
				],
				discovered,
			),
		).toThrow("missing live acceptance row ownership");
	});

	test("refuses duplicate row ownership", () => {
		const first = LIVE_ACCEPTANCE_WORKFLOWS[0]!;
		const second = LIVE_ACCEPTANCE_WORKFLOWS[1]!;
		expect(() =>
			validateLiveAcceptanceManifest(
				[
					first,
					{
						...second,
						ownedRows: [first.ownedRows[0]!, ...second.ownedRows.slice(1)],
					},
					...LIVE_ACCEPTANCE_WORKFLOWS.slice(2),
				],
				discovered,
			),
		).toThrow("duplicate live acceptance row ownership");
	});

	test("declared row owners exactly match their source files", async () => {
		for (const workflow of LIVE_ACCEPTANCE_WORKFLOWS) {
			const source = await readFile(resolve(directory, workflow.file), "utf8");
			expect([...extractLiteralTestNames(source)].sort(), workflow.file).toEqual(
				[...workflow.ownedRows].sort(),
			);
		}
	});

	test("reconciles the original mixed rows with the dedicated latency lane", async () => {
		const correctnessRows = LIVE_ACCEPTANCE_WORKFLOWS.flatMap(
			({ ownedRows }) => ownedRows,
		);
		const performanceSource = await readFile(
			resolve(directory, "../performance.integration.test.ts"),
			"utf8",
		);
		const performanceRows = extractLiteralTestNames(performanceSource);
		const movedRows = LIVE_ACCEPTANCE_LATENCY_ROWS.filter(
			({ origin }) => origin === "moved_from_live_acceptance",
		);
		const splitRows = LIVE_ACCEPTANCE_LATENCY_ROWS.filter(
			({ origin }) => origin === "split_from_mixed_correctness_row",
		);

		expect(correctnessRows).toHaveLength(LIVE_ACCEPTANCE_CORRECTNESS_ROW_COUNT);
		expect([...performanceRows].sort()).toEqual(
			LIVE_ACCEPTANCE_LATENCY_ROWS.map(({ name }) => name).sort(),
		);
		expect(correctnessRows.length + movedRows.length).toBe(
			ORIGINAL_LIVE_ACCEPTANCE_ROW_COUNT,
		);
		expect(splitRows).toHaveLength(1);
		expect(correctnessRows).toContain(splitRows[0]?.sourceRow);
		expect(correctnessRows).not.toContain(movedRows[0]?.sourceRow);
		expect(correctnessRows.length + performanceRows.length).toBe(23);
	});
});
