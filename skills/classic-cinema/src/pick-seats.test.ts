import { describe, expect, test } from "bun:test";
import type { SeatRow } from "./cinema-api.ts";
import { pickSeats } from "./pick-seats.ts";

// Build a row of `n` standard seats named <rowName><1..n>, marking some sold.
function row(name: string, n: number, sold: number[] = []): SeatRow {
	return {
		name,
		seats: Array.from({ length: n }, (_, i) => ({
			name: `${name}${i + 1}`,
			typeId: "standard",
			sold: sold.includes(i + 1),
		})),
	};
}

// 9 rows A..I → thirds: front A,B,C / middle D,E,F / back G,H,I
function nineRows(): SeatRow[] {
	return ["A", "B", "C", "D", "E", "F", "G", "H", "I"].map((n) => row(n, 10));
}

describe("pickSeats", () => {
	test("back zone picks a back row, centred", () => {
		const result = pickSeats(nineRows(), "back", 2);
		expect(result).not.toBeNull();
		const rowLetter = result?.codes[0]?.charAt(0) ?? "";
		expect(["G", "H", "I"]).toContain(rowLetter);
		// 2 adjacent, centred around index 4-5 of a 10-seat row
		expect(result?.codes).toHaveLength(2);
		expect(result?.zoneUsed).toBe("back");
	});

	test("front zone picks a front row", () => {
		const result = pickSeats(nineRows(), "front", 3);
		const rowLetter = result?.codes[0]?.charAt(0) ?? "";
		expect(["A", "B", "C"]).toContain(rowLetter);
		expect(result?.codes).toHaveLength(3);
	});

	test("adjacent seats are consecutive in the row", () => {
		const result = pickSeats(nineRows(), "middle", 2);
		const nums = result?.codes.map((c) => Number.parseInt(c.replace(/\D/g, ""), 10)) ?? [];
		expect(nums[1] - nums[0]).toBe(1);
	});

	test("expands to another zone when requested zone has no run", () => {
		// Front rows all sold out; should expand to middle.
		const rows = [
			row("A", 10, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
			row("B", 10, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
			row("C", 10, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
			row("D", 10),
			row("E", 10),
			row("F", 10),
			row("G", 10),
			row("H", 10),
			row("I", 10),
		];
		const result = pickSeats(rows, "front", 2);
		expect(result).not.toBeNull();
		expect(result?.zoneUsed).not.toBe("front");
	});

	test("returns null when no adjacent run exists anywhere", () => {
		// Every row alternates sold so no 2 adjacent free seats exist.
		const alt = ["A", "B", "C", "D", "E", "F", "G", "H", "I"].map((n) =>
			row(n, 10, [2, 4, 6, 8, 10]),
		);
		// free seats are indices 0,2,4,6,8 → never consecutive → no run of 2
		expect(pickSeats(alt, "middle", 2)).toBeNull();
	});

	test("skips gap and accessible seats", () => {
		const r: SeatRow = {
			name: "A",
			seats: [
				{ name: "A1", typeId: "standard" },
				{ name: "gap", typeId: "gap" },
				{ name: "A2", typeId: "wheelchair" },
				{ name: "A3", typeId: "standard" },
				{ name: "A4", typeId: "standard" },
			],
		};
		// Only A3,A4 are an adjacent standard pair (A1 is isolated by the gap/wheelchair).
		const result = pickSeats([r, r, r], "middle", 2);
		expect(result?.codes).toEqual(["A3", "A4"]);
	});
});
