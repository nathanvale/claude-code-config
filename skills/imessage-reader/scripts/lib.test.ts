process.env.TZ = "Australia/Melbourne";

import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
	aggregateTapbacks,
	appleDateToUnixMs,
	appleEpochToISO,
	appleEpochToLocalISO,
	attachmentKind,
	canonicalAttachmentLocalPath,
	canonicalSavePath,
	choosePreferredPart,
	computeThreadDepthAndRoot,
	dateToAppleNs,
	dateToAppleNsEndOfDay,
	decodeAttributedBody,
	escapeYaml,
	extractCommitmentCandidates,
	findHeuristicTarget,
	formatContactName,
	formatLocalISO,
	generatePartGuid,
	guidSlugV2,
	hasMeaningfulText,
	linkMessageTargets,
	type ManifestEntry,
	type MessageRow,
	matchesSearch,
	migrateLegacyNote,
	normalizeMessageText,
	normalizePhone,
	type ParsedMessage,
	type ParsedMessageInternal,
	parsedMessageToV2Input,
	parseFrontmatter,
	parsePartReference,
	parseRow,
	pruneNulls,
	type ResolvedAttachmentPath,
	readCursor,
	resolveAttachmentPath,
	resolveContact,
	saveMessageAsMarkdown,
	saveMessageAsMarkdownV2,
	tapbackTypeToName,
	upsertManifestEntry,
	type V2Attachment,
	type V2NoteInput,
	writeCursor,
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

// ── V2 Corpus Tests ────────────────────────────────────────────────────

function makeV2Input(overrides: Partial<V2NoteInput> = {}): V2NoteInput {
	return {
		source_id: "p:0/FF2A8C91-3B47-4D6E-A812-9E5C7F0B1234",
		source_thread_id: "chat000001",
		sent_at: "2026-03-20T09:15:22+11:00",
		direction: "inbound",
		message_kind: "text",
		from: "Melanie",
		handle: "+61412345678",
		is_from_me: false,
		service: "iMessage",
		thread: "Melanie",
		is_group: false,
		conversation_with: "Melanie",
		conversation_type: "direct",
		text: "Hey, are you picking Levi up from school today?",
		...overrides,
	};
}

describe("guidSlugV2", () => {
	test("lowercases and replaces non-alphanumeric with hyphens", () => {
		expect(guidSlugV2("p:0/FF2A8C91-3B47-4D6E-A812-9E5C7F0B1234")).toBe(
			"p-0-ff2a8c91-3b47-4d6e-a812-9e5c7f0b1234",
		);
	});

	test("collapses repeated hyphens", () => {
		expect(guidSlugV2("p:0/ABC123")).toBe("p-0-abc123");
	});

	test("trims leading and trailing hyphens", () => {
		expect(guidSlugV2("/ABC/")).toBe("abc");
	});
});

describe("canonicalSavePath", () => {
	test("produces YYYY/MM/YYYY-MM-DD-HHmmss-imessage-{slug}.md", () => {
		const path = canonicalSavePath(
			"2026-03-20T09:15:22+11:00",
			"p:0/FF2A8C91-3B47-4D6E-A812-9E5C7F0B1234",
		);
		expect(path).toBe(
			"2026/03/2026-03-20-091522-imessage-p-0-ff2a8c91-3b47-4d6e-a812-9e5c7f0b1234.md",
		);
	});

	test("matches fx-02 golden path", () => {
		const path = canonicalSavePath(
			"2026-03-20T09:16:45+11:00",
			"p:0/A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
		);
		expect(path).toBe(
			"2026/03/2026-03-20-091645-imessage-p-0-a1b2c3d4-e5f6-7890-abcd-ef1234567890.md",
		);
	});
});

describe("saveMessageAsMarkdownV2", () => {
	test("writes v2 note with correct frontmatter (fx-01)", () => {
		const dir = mkdtempSync(join(tmpdir(), "imessage-v2-"));
		tmpDirs.add(dir);
		const filePath = saveMessageAsMarkdownV2(makeV2Input(), dir);
		expect(filePath).toBeTruthy();
		const content = readFileSync(filePath as string, "utf-8");
		expect(content).toContain("schema_version: 2");
		expect(content).toContain(
			'source_id: "p:0/FF2A8C91-3B47-4D6E-A812-9E5C7F0B1234"',
		);
		expect(content).toContain("direction: inbound");
		expect(content).toContain('conversation_with: "Melanie"');
		expect(content).toContain("conversation_type: direct");
		expect(content).toContain('day_of_week: "Friday"');
		expect(content).toContain('time_of_day: "morning"');
		expect(content).toContain("## Message");
		expect(content).toContain(
			"Hey, are you picking Levi up from school today?",
		);
	});

	test("writes outbound note correctly (fx-02)", () => {
		const dir = mkdtempSync(join(tmpdir(), "imessage-v2-"));
		tmpDirs.add(dir);
		const filePath = saveMessageAsMarkdownV2(
			makeV2Input({
				source_id: "p:0/A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
				sent_at: "2026-03-20T09:16:45+11:00",
				direction: "outbound",
				from: "me",
				is_from_me: true,
				text: "Yep, I'll grab him at 3:15. Need anything from the shops?",
			}),
			dir,
		);
		expect(filePath).toBeTruthy();
		const content = readFileSync(filePath as string, "utf-8");
		expect(content).toContain("direction: outbound");
		expect(content).toContain('from: "me"');
		expect(content).toContain("is_from_me: true");
	});

	test("sorts comma-separated unnamed group chat names deterministically (fx-09)", () => {
		const dir = mkdtempSync(join(tmpdir(), "imessage-v2-"));
		tmpDirs.add(dir);
		const filePath = saveMessageAsMarkdownV2(
			makeV2Input({
				source_id: "p:0/11112222-3333-4444-5555-666677778888",
				sent_at: "2026-03-20T12:45:00+11:00",
				message_kind: "text",
				from: "Dave",
				handle: "+61498765432",
				thread: "Dave, Melanie, Sarah",
				is_group: true,
				conversation_with: "Dave, Melanie, Sarah",
				conversation_type: "group",
				group_guid: "iMessage;+;chat000099",
				text: "Are we still on for the BBQ this weekend?",
			}),
			dir,
		);
		const content = readFileSync(filePath as string, "utf-8");
		expect(content).toContain('conversation_with: "Dave, Melanie, Sarah"');
		expect(content).toContain("conversation_type: group");
	});

	test("idempotent re-sync overwrites same path (fx-12)", () => {
		const dir = mkdtempSync(join(tmpdir(), "imessage-v2-"));
		tmpDirs.add(dir);
		const path1 = saveMessageAsMarkdownV2(makeV2Input(), dir);
		const path2 = saveMessageAsMarkdownV2(
			makeV2Input({
				text: "Hey, are you picking Levi up from school today? (edited: or should I?)",
				edited: true,
				date_edited: "2026-03-20T09:16:00+11:00",
				date_edited_local: "2026-03-20T09:16:00",
			}),
			dir,
		);
		expect(path1).toBe(path2);
		const content = readFileSync(path2 as string, "utf-8");
		expect(content).toContain("edited: true");
		expect(content).toContain("(edited: or should I?)");
	});

	test("skips messages with no text", () => {
		const dir = mkdtempSync(join(tmpdir(), "imessage-v2-"));
		tmpDirs.add(dir);
		expect(
			saveMessageAsMarkdownV2(makeV2Input({ text: null }), dir),
		).toBeNull();
	});
});

describe("cursor read/write", () => {
	test("round-trips cursor through disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "imessage-cursor-"));
		tmpDirs.add(dir);
		const cursorPath = join(dir, "default-sync.json");

		expect(readCursor(cursorPath)).toBeNull();

		const cursor = {
			schema_version: 1 as const,
			source_system: "imessage" as const,
			mode: "default",
			last_successful_sent_at: "2026-03-20T09:15:22+11:00",
			last_successful_source_id: "p:0/FF2A8C91-3B47-4D6E-A812-9E5C7F0B1234",
			updated_at: "2026-03-20T09:20:00+11:00",
		};
		writeCursor(cursorPath, cursor);
		const read = readCursor(cursorPath);
		expect(read).toBeTruthy();
		expect(read?.last_successful_source_id).toBe(
			"p:0/FF2A8C91-3B47-4D6E-A812-9E5C7F0B1234",
		);
	});
});

describe("upsertManifestEntry", () => {
	test("deduplicates by source_id while preserving the latest path", () => {
		const dir = mkdtempSync(join(tmpdir(), "imessage-manifest-"));
		tmpDirs.add(dir);
		const manifestPath = join(dir, "message-paths.jsonl");
		const first: ManifestEntry = {
			schema_version: 1,
			source_id: "p:0/ABC123",
			relative_path: "docs/messages/imessage/2026/03/old.md",
			slug_version: 2,
			updated_at: "2026-03-20T09:00:00+11:00",
		};
		const second: ManifestEntry = {
			schema_version: 1,
			source_id: "p:0/ABC123",
			relative_path: "docs/messages/imessage/2026/03/new.md",
			slug_version: 2,
			updated_at: "2026-03-20T09:10:00+11:00",
		};
		upsertManifestEntry(manifestPath, first);
		upsertManifestEntry(manifestPath, second);
		const lines = readFileSync(manifestPath, "utf-8").trim().split("\n");
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain(
			'"relative_path":"docs/messages/imessage/2026/03/new.md"',
		);
	});
});

describe("parseFrontmatter", () => {
	test("extracts key-value pairs from frontmatter", () => {
		const content = `---
guid: "p:0/ABC123"
date_local: "2026-03-20T20:00:11"
schema_version: 1
---

## Message

Hello
`;
		const fm = parseFrontmatter(content);
		expect(fm).toBeTruthy();
		expect(fm?.guid).toBe("p:0/ABC123");
		expect(fm?.schema_version).toBe("1");
	});
});

describe("migrateLegacyNote", () => {
	test("moves legacy path to canonical v2 path", () => {
		const dir = mkdtempSync(join(tmpdir(), "imessage-migrate-"));
		tmpDirs.add(dir);

		// Create legacy note at old path
		const legacyDir = join(dir, "2026", "2026-03-20");
		mkdirSync(legacyDir, { recursive: true });
		const legacyPath = join(legacyDir, "p_0_ABC123.md");
		writeFileSync(
			legacyPath,
			`---
guid: "p:0/ABC123"
date_local: "2026-03-20T20:00:11"
title: "iMessage with Melanie"
type: artifact-sidecar
status: active
---

## Message

Just a test message for migration.
`,
			"utf-8",
		);

		const newPath = migrateLegacyNote(legacyPath, dir);
		expect(newPath).toBeTruthy();
		expect(newPath).toContain(
			"2026/03/2026-03-20-200011-imessage-p-0-abc123.md",
		);

		const content = readFileSync(newPath as string, "utf-8");
		expect(content).toContain("schema_version: 2");
		expect(content).toContain("source_id:");
	});

	test("does not overwrite an existing canonical file when migrating duplicate slug variants", () => {
		const dir = mkdtempSync(join(tmpdir(), "imessage-migrate-"));
		tmpDirs.add(dir);

		const canonicalPath = join(
			dir,
			"2026",
			"03",
			"2026-03-18-164211-imessage-p-0-def456.md",
		);
		mkdirSync(join(dir, "2026", "03"), { recursive: true });
		writeFileSync(
			canonicalPath,
			`---
schema_version: 2
source_id: "p:0/DEF456"
sent_at: "2026-03-18T16:42:11"
---

## Message

Canonical content.
`,
			"utf-8",
		);

		const legacyDir = join(dir, "2026", "2026-03-18");
		mkdirSync(legacyDir, { recursive: true });
		const legacyPath = join(legacyDir, "p_0_DEF456.md");
		writeFileSync(
			legacyPath,
			`---
guid: "p:0/DEF456"
date_local: "2026-03-18T16:42:11"
---

## Message

Legacy duplicate content.
`,
			"utf-8",
		);

		const migrated = migrateLegacyNote(legacyPath, dir);
		expect(migrated).toBe(canonicalPath);
		const canonicalContent = readFileSync(canonicalPath, "utf-8");
		expect(canonicalContent).toContain("Canonical content.");
	});
});

// ── Phase 3: Attachments, Thread/Tapback Enrichment ────────────────────

describe("attachmentKind", () => {
	test("maps MIME types to kinds per spec", () => {
		expect(attachmentKind("image/heic")).toBe("image");
		expect(attachmentKind("video/mp4")).toBe("video");
		expect(attachmentKind("audio/mpeg")).toBe("audio");
		expect(attachmentKind("application/pdf")).toBe("document");
		expect(attachmentKind("text/plain")).toBe("document");
		expect(attachmentKind("application/zip")).toBe("other");
		expect(attachmentKind(null)).toBe("other");
	});
});

describe("tapbackTypeToName", () => {
	test("maps add codes to display names", () => {
		expect(tapbackTypeToName(2000)).toBe("Love");
		expect(tapbackTypeToName(2003)).toBe("Laugh");
	});

	test("maps remove codes", () => {
		expect(tapbackTypeToName(3000)).toBe("Remove Love");
	});

	test("returns null for unknown codes", () => {
		expect(tapbackTypeToName(9999)).toBeNull();
		expect(tapbackTypeToName(null)).toBeNull();
	});
});

describe("saveMessageAsMarkdownV2 with attachments (fx-04)", () => {
	test("writes structured attachments and body sections", () => {
		const dir = mkdtempSync(join(tmpdir(), "imessage-v2-att-"));
		tmpDirs.add(dir);

		const att: V2Attachment = {
			id: "att-001",
			kind: "document",
			filename: "plumber-invoice.pdf",
			mime_type: "application/pdf",
			local_path:
				"runtime/imessage/attachments/2026/03/p-0-c3d4e5f6-a7b8-9012-cdef-123456789012/plumber-invoice.pdf",
			size_bytes: 94521,
			sha256: null,
			extracted_text:
				"Invoice #1042 — Plumbing repair $385.00 inc GST. Due: 2026-03-25.",
			ai_caption: null,
		};

		const filePath = saveMessageAsMarkdownV2(
			makeV2Input({
				source_id: "p:0/C3D4E5F6-A7B8-9012-CDEF-123456789012",
				sent_at: "2026-03-18T16:42:11+11:00",
				text: "Here's the invoice from the plumber",
				attachments: [att],
			}),
			dir,
		);

		expect(filePath).toBeTruthy();
		const content = readFileSync(filePath as string, "utf-8");
		expect(content).toContain("attachments:");
		expect(content).toContain('id: "att-001"');
		expect(content).toContain("kind: document");
		expect(content).toContain('filename: "plumber-invoice.pdf"');
		expect(content).toContain("## Attachments");
		expect(content).toContain("`plumber-invoice.pdf` - document");
		expect(content).toContain("## Attachment Text");
		expect(content).toContain("### plumber-invoice.pdf");
		expect(content).toContain("Invoice #1042");
	});
});

describe("saveMessageAsMarkdownV2 with image, no extracted text (fx-05)", () => {
	test("writes attachment section but no Attachment Text section", () => {
		const dir = mkdtempSync(join(tmpdir(), "imessage-v2-img-"));
		tmpDirs.add(dir);

		const att: V2Attachment = {
			id: "att-001",
			kind: "image",
			filename: "IMG_4521.HEIC",
			mime_type: "image/heic",
			local_path:
				"runtime/imessage/attachments/2026/03/p-0-d4e5f6a7-b8c9-0123-defa-234567890123/IMG_4521.HEIC",
			size_bytes: 3281044,
			sha256: null,
			extracted_text: null,
			ai_caption: null,
		};

		const filePath = saveMessageAsMarkdownV2(
			makeV2Input({
				source_id: "p:0/D4E5F6A7-B8C9-0123-DEFA-234567890123",
				sent_at: "2026-03-17T15:22:33+11:00",
				text: "Look what Levi drew at school today!",
				attachments: [att],
			}),
			dir,
		);

		const content = readFileSync(filePath as string, "utf-8");
		expect(content).toContain("## Attachments");
		expect(content).toContain("`IMG_4521.HEIC` - image");
		expect(content).toContain("ai_caption: null");
		// No Attachment Text section when no extracted_text
		const lines = content.split("\n");
		const hasAttachmentText = lines.some((l: string) =>
			l.startsWith("## Attachment Text"),
		);
		expect(hasAttachmentText).toBe(false);
	});
});

describe("parsedMessageToV2Input with attachment payloads", () => {
	test("maps a media part into structured v2 attachments", () => {
		const input = parsedMessageToV2Input(
			makeParsedMessage({
				guid: "p:0/D4E5F6A7-B8C9-0123-DEFA-234567890123",
				part_index: 0,
				message_kind: "media",
				text: null,
				date_local: "2026-03-17T15:22:33+11:00",
				attachment: {
					filename: "IMG_4521.HEIC",
					path: "/Users/nathanvale/Library/Messages/Attachments/IMG_4521.HEIC",
					original_path: null,
					mime_type: "image/heic",
					uti: null,
					size: 3281044,
					name: "IMG_4521.HEIC",
					exists: true,
					absolute: true,
					missing: false,
				},
			}),
		);

		expect(input.attachments).toEqual([
			{
				id: "att-0",
				kind: "image",
				filename: "IMG_4521.HEIC",
				mime_type: "image/heic",
				local_path: canonicalAttachmentLocalPath(
					"2026-03-17T15:22:33+11:00",
					"p:0/D4E5F6A7-B8C9-0123-DEFA-234567890123",
					"IMG_4521.HEIC",
				),
				size_bytes: 3281044,
				sha256: null,
				extracted_text: null,
				ai_caption: null,
			},
		]);
	});

	test("writes null MIME types instead of empty strings", () => {
		const dir = mkdtempSync(join(tmpdir(), "imessage-v2-null-mime-"));
		tmpDirs.add(dir);
		const filePath = saveMessageAsMarkdownV2(
			makeV2Input({
				source_id: "p:0/NULL-MIME-ATTACHMENT",
				sent_at: "2026-03-21T09:15:00+11:00",
				text: "No MIME type on this one",
				attachments: [
					{
						id: "att-0",
						kind: "other",
						filename: "mystery.bin",
						mime_type: null,
						local_path:
							"runtime/imessage/attachments/2026/03/null-mime/mystery.bin",
						size_bytes: 42,
						sha256: null,
						extracted_text: null,
						ai_caption: null,
					},
				],
			}),
			dir,
		);

		const content = readFileSync(filePath as string, "utf-8");
		expect(content).toContain("mime_type: null");
		expect(content.includes('mime_type: ""')).toBe(false);
	});
});

describe("computeThreadDepthAndRoot (fx-06, fx-07)", () => {
	test("computes depth 0 for root, depth 1 for direct reply (fx-06)", () => {
		const messages: ParsedMessageInternal[] = [
			{
				...makeParsedMessage({
					guid: "p:0/E5F6A7B8-ROOT",
					source_guid: "E5F6A7B8-ROOT",
					date: "2026-03-20T00:00:00.000Z",
				}),
				_rowid: 1,
			},
			{
				...makeParsedMessage({
					guid: "p:0/F6A7B8C9-REPLY",
					source_guid: "F6A7B8C9-REPLY",
					reply_to: "p:0/E5F6A7B8-ROOT",
					date: "2026-03-20T00:02:30.000Z",
				}),
				_rowid: 2,
			},
		];

		const result = computeThreadDepthAndRoot(messages);
		expect(result.get("p:0/E5F6A7B8-ROOT")?.depth).toBe(0);
		expect(result.get("p:0/E5F6A7B8-ROOT")?.root).toBe("p:0/E5F6A7B8-ROOT");
		expect(result.get("p:0/F6A7B8C9-REPLY")?.depth).toBe(1);
		expect(result.get("p:0/F6A7B8C9-REPLY")?.root).toBe("p:0/E5F6A7B8-ROOT");
	});

	test("computes depth 2 for nested reply chain (fx-07)", () => {
		const messages: ParsedMessageInternal[] = [
			{
				...makeParsedMessage({ guid: "ROOT", source_guid: "ROOT" }),
				_rowid: 1,
			},
			{
				...makeParsedMessage({
					guid: "D1",
					source_guid: "D1",
					reply_to: "ROOT",
				}),
				_rowid: 2,
			},
			{
				...makeParsedMessage({ guid: "D2", source_guid: "D2", reply_to: "D1" }),
				_rowid: 3,
			},
		];

		const result = computeThreadDepthAndRoot(messages);
		expect(result.get("ROOT")?.depth).toBe(0);
		expect(result.get("D1")?.depth).toBe(1);
		expect(result.get("D2")?.depth).toBe(2);
		expect(result.get("D2")?.root).toBe("ROOT");
	});
});

describe("aggregateTapbacks (fx-08)", () => {
	test("cancels a Love add with a subsequent Remove Love from same sender", () => {
		const messages: ParsedMessageInternal[] = [
			{
				...makeParsedMessage({
					guid: "p:0/TARGET",
					source_guid: "TARGET",
					text: "I booked the restaurant",
				}),
				_rowid: 1,
			},
			{
				...makeParsedMessage({
					guid: "p:0/TAPBACK-ADD",
					source_guid: "TAPBACK-ADD",
					message_kind: "tapback",
					reaction_to: "p:0/TARGET",
					reaction_type: 2000,
					is_from_me: false,
					contact_name: "Melanie",
					handle: "+61412345678",
					date: "2026-03-19T19:30:15.000Z",
					date_local: "2026-03-19T19:30:15+11:00",
				}),
				_rowid: 2,
			},
			{
				...makeParsedMessage({
					guid: "p:0/TAPBACK-REMOVE",
					source_guid: "TAPBACK-REMOVE",
					message_kind: "tapback",
					reaction_to: "p:0/TARGET",
					reaction_type: 3000,
					is_from_me: false,
					contact_name: "Melanie",
					handle: "+61412345678",
					date: "2026-03-19T19:31:02.000Z",
					date_local: "2026-03-19T19:31:02+11:00",
				}),
				_rowid: 3,
			},
		];

		const result = aggregateTapbacks(messages);
		const tapbacks = result.get("p:0/TARGET") ?? [];
		expect(tapbacks).toHaveLength(0);
	});
});

describe("saveMessageAsMarkdownV2 with enrichment", () => {
	test("writes thread_depth and thread_root (fx-06a)", () => {
		const dir = mkdtempSync(join(tmpdir(), "imessage-v2-enrich-"));
		tmpDirs.add(dir);
		const filePath = saveMessageAsMarkdownV2(
			makeV2Input({
				source_id: "p:0/E5F6A7B8-C9D0-1234-EFAB-345678901234",
				sent_at: "2026-03-20T11:00:00+11:00",
				text: "Did you see the email from the school about camp?",
				enrichment: {
					threadDepth: 0,
					threadRoot: "p:0/E5F6A7B8-C9D0-1234-EFAB-345678901234",
				},
			}),
			dir,
		);
		const content = readFileSync(filePath as string, "utf-8");
		expect(content).toContain("thread_depth: 0");
		expect(content).toContain(
			'thread_root: "p:0/E5F6A7B8-C9D0-1234-EFAB-345678901234"',
		);
	});

	test("writes tapbacks: [] for cancelled tapbacks (fx-08)", () => {
		const dir = mkdtempSync(join(tmpdir(), "imessage-v2-tapback-"));
		tmpDirs.add(dir);
		const filePath = saveMessageAsMarkdownV2(
			makeV2Input({
				source_id: "p:0/DDDD1111-2222-3333-4444-555566667777",
				sent_at: "2026-03-19T19:30:00+11:00",
				direction: "outbound",
				from: "me",
				is_from_me: true,
				text: "I booked the restaurant for Saturday night",
				enrichment: { tapbacks: [] },
			}),
			dir,
		);
		const content = readFileSync(filePath as string, "utf-8");
		expect(content).toContain("tapbacks: []");
	});
});

// ── Phase 4: Commitment Extraction ─────────────────────────────────────

describe("extractCommitmentCandidates", () => {
	test("detects outbound promise from fx-10 fixture", () => {
		const msg = makeParsedMessage({
			guid: "p:0/22223333-4444-5555-6666-777788889999",
			text: "I'll ask Marilyn now",
			is_from_me: true,
			date_local: "2026-03-20T20:00:11+11:00",
			handle: "+61412345678",
			contact_name: "Melanie",
			chat_id: "chat000001",
			is_group: false,
		});

		const candidates = extractCommitmentCandidates([msg]);
		expect(candidates).toHaveLength(1);
		expect(candidates[0]?.candidate_type).toBe("promise");
		expect(candidates[0]?.direction).toBe("outbound");
		expect(candidates[0]?.conversation_with).toBe("Melanie");
		expect(candidates[0]?.quote).toBe("I'll ask Marilyn now");
		expect(candidates[0]?.owner_status).toBe("ambiguous");
		expect(candidates[0]?.source_system).toBe("imessage");
		expect(candidates[0]?.schema_version).toBe(1);
	});

	test("detects inbound request", () => {
		const msg = makeParsedMessage({
			text: "Can you pick up milk on the way home?",
			is_from_me: false,
			contact_name: "Melanie",
		});
		const candidates = extractCommitmentCandidates([msg]);
		expect(candidates).toHaveLength(1);
		expect(candidates[0]?.candidate_type).toBe("request");
		expect(candidates[0]?.direction).toBe("inbound");
	});

	test("detects outbound offer", () => {
		const msg = makeParsedMessage({
			text: "I can pick up Levi from school",
			is_from_me: true,
			contact_name: "Melanie",
		});
		const candidates = extractCommitmentCandidates([msg]);
		expect(candidates).toHaveLength(1);
		expect(candidates[0]?.candidate_type).toBe("offer");
	});

	test("skips non-commitment messages", () => {
		const msg = makeParsedMessage({
			text: "Sounds good!",
			is_from_me: true,
		});
		const candidates = extractCommitmentCandidates([msg]);
		expect(candidates).toHaveLength(0);
	});

	test("skips tapback messages", () => {
		const msg = makeParsedMessage({
			text: "Loved an image",
			message_kind: "tapback",
			is_from_me: false,
		});
		const candidates = extractCommitmentCandidates([msg]);
		expect(candidates).toHaveLength(0);
	});

	test("marks group chat candidates as owner_status unknown", () => {
		const msg = makeParsedMessage({
			text: "I'll bring the dessert",
			is_from_me: true,
			is_group: true,
			contact_name: "Dave",
		});
		const candidates = extractCommitmentCandidates([msg]);
		expect(candidates).toHaveLength(1);
		expect(candidates[0]?.owner_status).toBe("unknown");
	});

	test("boosts confidence for messages with deadline cues", () => {
		const msg = makeParsedMessage({
			text: "I'll send the report by Friday",
			is_from_me: true,
			contact_name: "Melanie",
		});
		const candidates = extractCommitmentCandidates([msg]);
		expect(candidates).toHaveLength(1);
		const confidence = candidates[0]?.confidence ?? 0;
		expect(confidence).toBeGreaterThan(0.85);
	});
});
