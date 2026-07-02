// fallow-ignore-file unused-file
import { describe, expect, test } from "bun:test";
import {
	duplicateStringSet,
	isRawObject,
	rawStringField,
	stringFromUnknown,
} from "./raw-object";

describe("raw object helpers", () => {
	test("rawStringField accepts only string fields on non-array objects", () => {
		expect(rawStringField({ report_id: "r1" }, "report_id")).toBe("r1");
		expect(rawStringField({ report_id: 1 }, "report_id")).toBeUndefined();
		expect(rawStringField(["r1"], "report_id")).toBeUndefined();
		expect(rawStringField(null, "report_id")).toBeUndefined();
	});

	test("isRawObject excludes arrays and nulls", () => {
		expect(isRawObject({ report_id: "r1" })).toBe(true);
		expect(isRawObject(["r1"])).toBe(false);
		expect(isRawObject(null)).toBe(false);
	});

	test("stringFromUnknown returns only string values", () => {
		expect(stringFromUnknown("r1")).toBe("r1");
		expect(stringFromUnknown(1)).toBeUndefined();
		expect(stringFromUnknown(undefined)).toBeUndefined();
	});

	test("duplicateStringSet returns repeated strings and ignores missing values", () => {
		expect([...duplicateStringSet(["a", undefined, "b", "a", "b", "c"])]).toEqual([
			"a",
			"b",
		]);
	});
});
