process.env.TZ = "Australia/Melbourne";

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	makeHeuristicAttributedBody,
	makeJunkByteRegressionBlob,
	makeLongAttributedBody,
	makePlusMarkerRegressionBlob,
	makeShortAttributedBody,
} from "./fixtures";
import {
	type AttachmentRow,
	appleDateToUnixMs,
	appleEpochToISO,
	appleEpochToLocalISO,
	choosePreferredPart,
	dateToAppleNs,
	dateToAppleNsEndOfDay,
	decodeAttributedBody,
	escapeYaml,
	findHeuristicTarget,
	formatContactName,
	formatLocalISO,
	generatePartGuid,
	hasMeaningfulText,
	linkMessageTargets,
	type MessageRow,
	matchesSearch,
	normalizeMessageText,
	normalizePhone,
	type ParsedMessage,
	type ParsedMessageInternal,
	parsePartReference,
	parseRow,
	pruneNulls,
	type ResolvedAttachmentPath,
	resolveAttachmentPath,
	resolveContact,
	saveMessageAsMarkdown,
} from "./lib";

function makeMessageRow(overrides: Partial<MessageRow> = {}): MessageRow {
	return {
		rowid: 1,
		guid: "msg-1",
		text: "Hello there",
		attributedBody: null,
		is_from_me: 0,
		apple_date: dateToAppleNs("2026-03-19T10:00:00+11:00"),
		date_read: null,
		date_edited: null,
		service: "iMessage",
		subject: null,
		thread_originator_guid: null,
		reply_to_guid: null,
		associated_message_guid: null,
		associated_message_type: null,
		handle_id: "+61400000000",
		chat_display_name: "Melanie",
		chat_identifier: "chat-1",
		chat_style: 45,
		...overrides,
	};
}

function makeAttachmentRow(
	overrides: Partial<AttachmentRow> = {},
): AttachmentRow {
	return {
		message_id: 1,
		filename: "~/Library/Messages/Attachments/x/y/photo.png",
		mime_type: "image/png",
		uti: "public.png",
		total_bytes: 1234,
		transfer_name: "photo.png",
		...overrides,
	};
}

function stubResolver(path = "/tmp/photo.png"): ResolvedAttachmentPath {
	return {
		path,
		original_path: path,
		exists: true,
		absolute: true,
		missing: false,
	};
}

function makeParsedMessage(
	overrides: Partial<ParsedMessage> = {},
): ParsedMessage {
	return {
		guid: "p:0/msg-1",
		source_guid: "msg-1",
		group_guid: "msg-1",
		part_index: 0,
		message_kind: "text",
		text: "hello world",
		is_from_me: false,
		date: "2026-03-19T10:00:00.000Z",
		date_local: "2026-03-19T21:00:00+11:00",
		date_read: null,
		date_read_local: null,
		edited: null,
		date_edited: null,
		date_edited_local: null,
		service: "iMessage",
		handle: "+61400000000",
		contact_name: "Melanie",
		chat_name: "Melanie",
		chat_id: "chat-1",
		is_group: false,
		thread_originator: null,
		reply_to_raw: null,
		reply_to: null,
		reaction_to_raw: null,
		reaction_to: null,
		reaction_type: null,
		subject: null,
		attachment: null,
		...overrides,
	};
}

const contactMap = new Map<string, string>([["+61400000000", "Melanie"]]);
const tmpDirs = new Set<string>();

function expectValue<T>(value: T | null | undefined): T {
	expect(value).toBeTruthy();
	return value as T;
}

afterEach(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tmpDirs.clear();
});

describe("parseRow", () => {
	test("splits text-only rows into a single text part", () => {
		const row = makeMessageRow();
		const parts = parseRow(row, [], {
			contactMap,
			resolveAttachment: () => stubResolver(),
		});

		expect(parts).toHaveLength(1);
		expect(parts[0]?.message_kind).toBe("text");
		expect(parts[0]?.guid).toBe("p:0/msg-1");
		expect(parts[0]?.contact_name).toBe("Melanie");
	});

	test("splits attachment-only rows into a media part", () => {
		const row = makeMessageRow({ text: "\uFFFC" });
		const parts = parseRow(row, [makeAttachmentRow()], {
			contactMap,
			resolveAttachment: () => stubResolver("/tmp/media.png"),
		});

		expect(parts).toHaveLength(1);
		expect(parts[0]?.message_kind).toBe("media");
		expect(parts[0]?.attachment?.path).toBe("/tmp/media.png");
	});

	test("puts text after media parts when a row has both text and attachments", () => {
		const row = makeMessageRow({
			guid: "msg-2",
			rowid: 2,
			text: "assets and text",
		});
		const parts = parseRow(
			row,
			[
				makeAttachmentRow({ message_id: 2, transfer_name: "a.png" }),
				makeAttachmentRow({ message_id: 2, transfer_name: "b.png" }),
			],
			{
				contactMap,
				resolveAttachment: (_filename, transferName) =>
					stubResolver(`/tmp/${transferName}`),
			},
		);

		expect(parts).toHaveLength(3);
		expect(parts.map((part) => part.message_kind)).toEqual([
			"media",
			"media",
			"text",
		]);
		expect(parts[2]?.text).toBe("assets and text");
	});

	test("decodes attributedBody when text is null", () => {
		const row = makeMessageRow({
			text: null,
			attributedBody: makeShortAttributedBody("The Virginia Trioli Show"),
		});
		const parts = parseRow(row, [], {
			contactMap,
			resolveAttachment: () => stubResolver(),
		});

		expect(parts[0]?.text).toBe("The Virginia Trioli Show");
	});

	test("returns unable-to-decode placeholder when attributedBody parsing fails", () => {
		const row = makeMessageRow({
			text: null,
			attributedBody: Buffer.from([0x00, 0xff, 0x00]),
		});
		const parts = parseRow(row, [], {
			contactMap,
			resolveAttachment: () => stubResolver(),
		});

		expect(parts[0]?.text).toBe("[attributedBody: unable to decode]");
	});

	test("emits tapback rows as a single tapback part", () => {
		const row = makeMessageRow({
			associated_message_type: 2003,
			associated_message_guid: "msg-0",
			text: "Laughed at an image",
		});
		const parts = parseRow(row, [], {
			contactMap,
			resolveAttachment: () => stubResolver(),
		});

		expect(parts).toHaveLength(1);
		expect(parts[0]?.message_kind).toBe("tapback");
		expect(parts[0]?.reaction_to_raw).toBe("msg-0");
	});
});

describe("linkMessageTargets", () => {
	test("resolves exact part references", () => {
		const messages: ParsedMessageInternal[] = [
			{
				...makeParsedMessage(),
				_rowid: 1,
				guid: "p:0/msg-1",
				source_guid: "msg-1",
			},
			{
				...makeParsedMessage({
					guid: "tap-1",
					source_guid: "tap-1",
					message_kind: "tapback",
					text: "Liked “hello world”",
					reaction_to_raw: "p:0/msg-1",
				}),
				_rowid: 2,
			},
		];

		const linked = linkMessageTargets(messages);
		expect(linked[1]?.reaction_to).toBe("p:0/msg-1");
	});

	test("prefers text parts for replies to source GUIDs with multiple parts", () => {
		const messages: ParsedMessageInternal[] = [
			{
				...makeParsedMessage({
					guid: "p:0/msg-1",
					source_guid: "msg-1",
					message_kind: "media",
					text: null,
					attachment: {
						filename: null,
						path: "/tmp/a.png",
						original_path: "/tmp/a.png",
						mime_type: "image/png",
						uti: "public.png",
						size: 1,
						name: "a.png",
						exists: true,
						absolute: true,
						missing: false,
					},
				}),
				_rowid: 1,
			},
			{
				...makeParsedMessage({
					guid: "p:1/msg-1",
					source_guid: "msg-1",
					part_index: 1,
					text: "caption",
				}),
				_rowid: 1,
			},
			{
				...makeParsedMessage({
					guid: "reply-1",
					source_guid: "reply-1",
					reply_to_raw: "msg-1",
					text: "reply",
				}),
				_rowid: 2,
			},
		];

		const linked = linkMessageTargets(messages);
		expect(linked[2]?.reply_to).toBe("p:1/msg-1");
	});

	test("prefers media parts for reactions with media cues", () => {
		const messages: ParsedMessageInternal[] = [
			{
				...makeParsedMessage({
					guid: "p:0/msg-1",
					source_guid: "msg-1",
					message_kind: "media",
					text: null,
					attachment: {
						filename: null,
						path: "/tmp/a.png",
						original_path: "/tmp/a.png",
						mime_type: "image/png",
						uti: "public.png",
						size: 1,
						name: "a.png",
						exists: true,
						absolute: true,
						missing: false,
					},
				}),
				_rowid: 1,
			},
			{
				...makeParsedMessage({
					guid: "p:1/msg-1",
					source_guid: "msg-1",
					part_index: 1,
					text: "caption",
				}),
				_rowid: 1,
			},
			{
				...makeParsedMessage({
					guid: "tap-1",
					source_guid: "tap-1",
					message_kind: "tapback",
					text: "Liked an image",
					reaction_to_raw: "msg-1",
				}),
				_rowid: 2,
			},
		];

		const linked = linkMessageTargets(messages);
		expect(linked[2]?.reaction_to).toBe("p:0/msg-1");
	});

	test("falls back to heuristic matching within the same conversation", () => {
		const messages: ParsedMessageInternal[] = [
			{
				...makeParsedMessage({
					guid: "p:0/msg-1",
					source_guid: "msg-1",
					date: "2026-03-19T00:00:00.000Z",
				}),
				_rowid: 1,
			},
			{
				...makeParsedMessage({
					guid: "reply-1",
					source_guid: "reply-1",
					date: "2026-03-19T00:01:00.000Z",
					reply_to_raw: "missing-guid",
					text: "reply",
				}),
				_rowid: 2,
			},
		];

		const linked = linkMessageTargets(messages);
		expect(linked[1]?.reply_to).toBe("p:0/msg-1");
	});

	test("returns null when no heuristic candidate exists", () => {
		const messages: ParsedMessageInternal[] = [
			{
				...makeParsedMessage({
					guid: "p:0/msg-1",
					source_guid: "msg-1",
					date: "2026-03-19T00:00:00.000Z",
				}),
				_rowid: 1,
			},
			{
				...makeParsedMessage({
					guid: "reply-1",
					source_guid: "reply-1",
					date: "2026-03-19T01:00:00.000Z",
					reply_to_raw: "missing-guid",
					text: "reply",
				}),
				_rowid: 2,
			},
		];

		const linked = linkMessageTargets(messages);
		expect(linked[1]?.reply_to).toBeNull();
	});
});

describe("decodeAttributedBody", () => {
	test("decodes short-form blobs", () => {
		expect(decodeAttributedBody(makeShortAttributedBody("hello there"))).toBe(
			"hello there",
		);
	});

	test("decodes long-form blobs with a single control byte", () => {
		const text = `The Virginia Trioli Show ${"x".repeat(280)}`;
		expect(decodeAttributedBody(makeLongAttributedBody(text, [0x00]))).toBe(
			text,
		);
	});

	test("decodes long-form blobs with multiple control bytes", () => {
		const text = `My heart is in it ${"x".repeat(280)}`;
		expect(
			decodeAttributedBody(makeLongAttributedBody(text, [0x01, 0x00])),
		).toBe(text);
	});

	test("does not leak printable junk length bytes into short-form text", () => {
		const decoded = decodeAttributedBody(makeJunkByteRegressionBlob("d"));
		expect(decoded?.startsWith("d".repeat(2))).toBe(true);
		expect(decoded).toBe("d".repeat(100));
	});

	test("does not return the plus marker as message text", () => {
		expect(decodeAttributedBody(makePlusMarkerRegressionBlob())).toBe(
			"The real message is here",
		);
	});

	test("falls back to heuristic decoding when NSString is missing", () => {
		expect(
			decodeAttributedBody(
				makeHeuristicAttributedBody("Miss you so much sweetman"),
			),
		).toBe("Miss you so much sweetman");
	});

	test("returns null for random garbage", () => {
		expect(
			decodeAttributedBody(Buffer.from([0x00, 0xff, 0xaa, 0xbb])),
		).toBeNull();
	});
});

describe("resolveAttachmentPath", () => {
	test("keeps existing absolute paths", () => {
		const result = resolveAttachmentPath("/tmp/file.png", null, {
			checkExists: (path) => path === "/tmp/file.png",
		});
		expect(result).toEqual({
			path: "/tmp/file.png",
			original_path: "/tmp/file.png",
			exists: true,
			absolute: true,
			missing: false,
		});
	});

	test("expands tilde paths", () => {
		const result = resolveAttachmentPath(
			"~/Library/Messages/Attachments/a/b.png",
			null,
			{
				checkExists: () => false,
			},
		);
		expect(result.original_path?.startsWith("/")).toBe(true);
		expect(result.absolute).toBe(true);
	});

	test("rebases library marker paths against injected roots", () => {
		const result = resolveAttachmentPath(
			"/Users/x/Library/Messages/Attachments/88/08/file.png",
			null,
			{
				roots: ["/tmp/messages"],
				checkExists: (path) => path === "/tmp/messages/88/08/file.png",
			},
		);
		expect(result.path).toBe("/tmp/messages/88/08/file.png");
		expect(result.exists).toBe(true);
	});

	test("falls back to transfer name when filename is null", () => {
		const result = resolveAttachmentPath(null, "photo.png", {
			roots: ["/tmp/messages"],
			checkExists: (path) => path === "/tmp/messages/photo.png",
		});
		expect(result.path).toBe("/tmp/messages/photo.png");
		expect(result.exists).toBe(true);
	});
});

describe("date helpers", () => {
	test("treats zero and negative Apple dates as null", () => {
		expect(appleDateToUnixMs(0)).toBeNull();
		expect(appleDateToUnixMs(-1)).toBeNull();
	});

	test("round-trips ISO conversion through Apple nanoseconds", () => {
		const appleNs = dateToAppleNs("2026-03-19T10:00:00+11:00");
		expect(appleEpochToISO(appleNs)).toBe("2026-03-18T23:00:00.000Z");
	});

	test("emits local ISO with Melbourne offset", () => {
		const appleNs = dateToAppleNs("2026-03-19T10:00:00+11:00");
		expect(appleEpochToLocalISO(appleNs)).toBe("2026-03-19T10:00:00+11:00");
	});

	test("end-of-day Apple date is later than start-of-day", () => {
		expect(dateToAppleNsEndOfDay("2026-03-19")).toBeGreaterThan(
			dateToAppleNs("2026-03-19"),
		);
	});
});

describe("utility helpers", () => {
	test("pruneNulls preserves falsy values while removing nullish ones", () => {
		expect(
			pruneNulls({ a: 0, b: false, c: "", d: null, e: undefined }),
		).toEqual({
			a: 0,
			b: false,
			c: "",
		});
	});

	test("normalizeMessageText removes object replacement prefixes", () => {
		expect(normalizeMessageText("\uFFFC\nassets and text")).toBe(
			"assets and text",
		);
		expect(hasMeaningfulText("\uFFFC")).toBe(false);
	});

	test("normalizes Australian phone numbers and contact lookup", () => {
		expect(normalizePhone("0412 667 520")).toBe("+61412667520");
		expect(formatContactName("Melanie", "Vale", null)).toBe("Melanie Vale");
		expect(
			resolveContact("0412 667 520", new Map([["+61412667520", "Melanie"]])),
		).toBe("Melanie");
	});

	test("parses and generates part references", () => {
		expect(generatePartGuid("abc-123", 2)).toBe("p:2/abc-123");
		expect(parsePartReference("p:2/abc-123")).toEqual({
			index: 2,
			sourceGuid: "abc-123",
		});
		expect(parsePartReference("not-a-ref")).toBeNull();
	});

	test("formats local dates and escapes yaml", () => {
		expect(formatLocalISO(new Date("2026-03-18T23:00:00.000Z"))).toBe(
			"2026-03-19T10:00:00+11:00",
		);
		expect(escapeYaml('hello "there"\n')).toBe('hello \\"there\\"\\n');
	});
});

describe("search and heuristics helpers", () => {
	test("matches search case-insensitively", () => {
		expect(
			matchesSearch(
				makeParsedMessage({ text: "The Virginia Trioli Show" }),
				"virginia trioli",
			),
		).toBe(true);
		expect(
			matchesSearch(
				makeParsedMessage({ text: "The Virginia Trioli Show" }),
				"missing",
			),
		).toBe(false);
	});

	test("choosePreferredPart and heuristic helpers stay stable", () => {
		const parts: ParsedMessageInternal[] = [
			{
				...makeParsedMessage({
					guid: "p:0/msg",
					source_guid: "msg",
					message_kind: "media",
					text: null,
					date: "2026-03-19T00:00:00.000Z",
					attachment: {
						filename: null,
						path: "/tmp/a.png",
						original_path: "/tmp/a.png",
						mime_type: "image/png",
						uti: "public.png",
						size: 1,
						name: "a.png",
						exists: true,
						absolute: true,
						missing: false,
					},
				}),
				_rowid: 1,
			},
			{
				...makeParsedMessage({
					guid: "p:1/msg",
					source_guid: "msg",
					part_index: 1,
					text: "caption",
					date: "2026-03-19T00:00:00.000Z",
				}),
				_rowid: 1,
			},
		];
		const reaction = {
			...makeParsedMessage({
				guid: "tap",
				source_guid: "tap",
				message_kind: "tapback",
				text: "Liked an image",
			}),
			_rowid: 2,
		};
		expect(choosePreferredPart(parts, reaction, "reaction")?.guid).toBe(
			"p:0/msg",
		);
		const replyTarget = expectValue(parts[1]);

		const messages = [
			replyTarget,
			{
				...makeParsedMessage({
					guid: "reply",
					source_guid: "reply",
					date: "2026-03-19T00:01:00.000Z",
					reply_to_raw: "missing",
					text: "reply",
				}),
				_rowid: 3,
			},
		];
		expect(findHeuristicTarget(messages, 1, "reply")?.guid).toBe("p:1/msg");
	});
});

describe("saveMessageAsMarkdown", () => {
	test("writes text parts to temp markdown files", () => {
		const dir = mkdtempSync(join(tmpdir(), "imessage-reader-"));
		tmpDirs.add(dir);
		const filePath = saveMessageAsMarkdown(makeParsedMessage(), dir);
		const savedPath = expectValue(filePath);
		expect(readFileSync(savedPath, "utf8")).toContain("hello world");
	});

	test("writes attachment metadata for media parts", () => {
		const dir = mkdtempSync(join(tmpdir(), "imessage-reader-"));
		tmpDirs.add(dir);
		const filePath = saveMessageAsMarkdown(
			makeParsedMessage({
				guid: "p:0/msg:1",
				message_kind: "media",
				text: null,
				attachment: {
					filename: "~/Library/Messages/Attachments/x/y/photo.png",
					path: "/tmp/photo.png",
					original_path: "/tmp/photo.png",
					mime_type: "image/png",
					uti: "public.png",
					size: 123,
					name: "photo.png",
					exists: true,
					absolute: true,
					missing: false,
				},
			}),
			dir,
		);
		const savedPath = expectValue(filePath);
		const content = readFileSync(savedPath, "utf8");
		expect(savedPath).toContain("p-0_msg-1.md");
		expect(content).toContain("has_attachment: true");
		expect(content).toContain('attachment_path: "/tmp/photo.png"');
	});

	test("skips empty messages with no text and no attachment", () => {
		const dir = mkdtempSync(join(tmpdir(), "imessage-reader-"));
		tmpDirs.add(dir);
		expect(
			saveMessageAsMarkdown(
				makeParsedMessage({ text: null, attachment: null }),
				dir,
			),
		).toBeNull();
	});
});
