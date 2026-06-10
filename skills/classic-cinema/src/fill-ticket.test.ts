import { describe, expect, test } from "bun:test";
import {
	buildTicketLines,
	CDN_BASE,
	formatSessionDatetime,
	formatTicketType,
	htmlEscape,
	resolvePosterUrl,
} from "./fill-ticket.ts";

describe("resolvePosterUrl (always absolute)", () => {
	test("relative mx/ prefix gets CDN", () => {
		expect(resolvePosterUrl("mx/posters/project-hail-mary-261bf935.jpg")).toBe(
			`${CDN_BASE}mx/posters/project-hail-mary-261bf935.jpg`,
		);
	});
	test("relative movies/ prefix gets CDN", () => {
		expect(resolvePosterUrl("movies/posters/andsons.jpg")).toBe(
			`${CDN_BASE}movies/posters/andsons.jpg`,
		);
	});
	test("full https url passes through", () => {
		const full = "https://movingstory-prod.imgix.net/mx/posters/foo.jpg";
		expect(resolvePosterUrl(full)).toBe(full);
	});
	test("http url passes through", () => {
		expect(resolvePosterUrl("http://example.com/poster.jpg")).toBe(
			"http://example.com/poster.jpg",
		);
	});
	test("result always starts with http", () => {
		for (const path of [
			"mx/posters/foo.jpg",
			"movies/posters/bar.jpg",
			"https://cdn.example.com/baz.jpg",
		]) {
			expect(resolvePosterUrl(path).startsWith("http")).toBe(true);
		}
	});
});

describe("formatSessionDatetime ('Fri 10 Apr, 11:00AM')", () => {
	test("ISO datetime formatted", () => {
		expect(formatSessionDatetime("2026-04-10T11:00:00")).toBe("Fri 10 Apr, 11:00AM");
	});
	test("ISO datetime PM", () => {
		expect(formatSessionDatetime("2026-04-10T20:00:00")).toBe("Fri 10 Apr, 8:00PM");
	});
	test("ISO datetime with minutes", () => {
		expect(formatSessionDatetime("2026-04-10T14:20:00")).toBe("Fri 10 Apr, 2:20PM");
	});
	test("preformatted passes through", () => {
		expect(formatSessionDatetime("Fri 10 Apr, 11:00AM")).toBe("Fri 10 Apr, 11:00AM");
	});
	test("preformatted PM passes through", () => {
		expect(formatSessionDatetime("Wed 8 Apr, 6:30PM")).toBe("Wed 8 Apr, 6:30PM");
	});
	test("bare date defaults to midnight", () => {
		expect(formatSessionDatetime("2026-04-10")).toBe("Fri 10 Apr, 12:00AM");
	});
	test("garbage input rejected", () => {
		expect(() => formatSessionDatetime("next tuesday maybe")).toThrow();
	});
	test("ISO with timezone offset reads wall-clock", () => {
		expect(formatSessionDatetime("2026-04-10T11:00:00+10:00")).toBe("Fri 10 Apr, 11:00AM");
	});
	test("midnight session", () => {
		expect(formatSessionDatetime("2026-04-10T00:00:00")).toBe("Fri 10 Apr, 12:00AM");
	});
	test("noon session", () => {
		expect(formatSessionDatetime("2026-04-10T12:00:00")).toBe("Fri 10 Apr, 12:00PM");
	});
	test("runtime appends end time", () => {
		// 7:00pm + 134 min = 9:14pm
		expect(formatSessionDatetime("2026-06-10T19:00:00", 134)).toBe(
			"Wed 10 Jun, 7:00PM-9:14PM",
		);
	});
});

describe("formatTicketType + htmlEscape", () => {
	test("ADULT -> Adult Ticket", () => {
		expect(formatTicketType("ADULT")).toBe("Adult Ticket");
		expect(formatTicketType("Child")).toBe("Child Ticket");
	});
	test("htmlEscape matches Python html.escape(quote=True)", () => {
		expect(htmlEscape(`a & b < c > d " e ' f`)).toBe(
			"a &amp; b &lt; c &gt; d &quot; e &#x27; f",
		);
	});
});

describe("buildTicketLines", () => {
	test("one line per ticket with escaped type and qty", () => {
		const out = buildTicketLines([{ type: "Adult", qty: 2, price: 2700 }]);
		expect(out).toContain("Adult Ticket x 2");
		expect(out.split("<tr>").length - 1).toBe(1);
	});
});
