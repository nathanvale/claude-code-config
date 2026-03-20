import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const APPLE_EPOCH_OFFSET = 978_307_200;
const NANOSECOND_FACTOR = 1_000_000_000;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DEFAULT_ATTACHMENT_ROOTS = [
	join(homedir(), "Library/Messages/Attachments"),
];
const LINK_SEARCH_WINDOW_MS = 5 * 60 * 1000;

function isStructuredControlCode(code: number): boolean {
	return (
		(code >= 0x00 && code <= 0x08) ||
		code === 0x0b ||
		code === 0x0c ||
		(code >= 0x0e && code <= 0x1f)
	);
}

function containsStructuredControlChars(value: string): boolean {
	for (const char of value) {
		if (isStructuredControlCode(char.codePointAt(0) ?? 0)) return true;
	}
	return false;
}

function trimTrailingStructuredControlChars(value: string): string {
	let end = value.length;
	while (end > 0) {
		const code = value.charCodeAt(end - 1);
		if (!isStructuredControlCode(code)) break;
		end -= 1;
	}
	return value.slice(0, end);
}

function splitControlRuns(value: string): string[] {
	const runs: string[] = [];
	let current = "";

	for (const char of value) {
		const code = char.codePointAt(0) ?? 0;
		if (code <= 0x1f) {
			if (current.length > 0) runs.push(current);
			current = "";
			continue;
		}

		current += char;
	}

	if (current.length > 0) runs.push(current);
	return runs;
}

/**
 * Normalized attachment path metadata used in JSON output and markdown frontmatter.
 */
export type ResolvedAttachmentPath = {
	path: string | null;
	original_path: string | null;
	exists: boolean;
	absolute: boolean;
	missing: boolean;
};

/**
 * Raw message row shape returned from chat.db.
 */
export type MessageRow = {
	rowid: number;
	guid: string;
	text: string | null;
	attributedBody: Buffer | Uint8Array | null;
	is_from_me: number;
	apple_date: number;
	date_read: number | null;
	date_edited: number | null;
	service: string | null;
	subject: string | null;
	thread_originator_guid: string | null;
	reply_to_guid: string | null;
	associated_message_guid: string | null;
	associated_message_type: number | null;
	handle_id: string | null;
	chat_display_name: string | null;
	chat_identifier: string | null;
	chat_style: number | null;
};

/**
 * Raw attachment row shape returned from chat.db joins.
 */
export type AttachmentRow = {
	message_id: number;
	filename: string | null;
	mime_type: string | null;
	uti: string | null;
	total_bytes: number | null;
	transfer_name: string | null;
};

/**
 * Attachment payload shape emitted by the reader.
 */
export type ParsedAttachment = {
	filename: string | null;
	path: string | null;
	original_path: string | null;
	mime_type: string | null;
	uti: string | null;
	size: number | null;
	name: string | null;
	exists: boolean;
	absolute: boolean;
	missing: boolean;
};

/**
 * Message part categories emitted by the reader.
 */
export type MessageKind = "text" | "media" | "tapback";

/**
 * Stable parsed message shape emitted by the CLI.
 */
export type ParsedMessage = {
	guid: string;
	source_guid: string;
	group_guid: string | null;
	part_index: number | null;
	message_kind: MessageKind;
	text: string | null;
	is_from_me: boolean;
	date: string | null;
	date_local: string | null;
	date_read: string | null;
	date_read_local: string | null;
	edited: true | null;
	date_edited: string | null;
	date_edited_local: string | null;
	service: string | null;
	handle: string | null;
	contact_name: string | null;
	chat_name: string | null;
	chat_id: string | null;
	is_group: boolean;
	thread_originator: string | null;
	reply_to_raw: string | null;
	reply_to: string | null;
	reaction_to_raw: string | null;
	reaction_to: string | null;
	reaction_type: number | null;
	subject: string | null;
	attachment?: ParsedAttachment | null;
};

/**
 * Internal parsed message shape that keeps the DB rowid for attachment joins.
 */
export type ParsedMessageInternal = ParsedMessage & { _rowid: number };

/**
 * Attachment path resolver function signature used for dependency injection.
 */
export type AttachmentResolver = (
	filename: string | null,
	transferName: string | null,
) => ResolvedAttachmentPath;

/**
 * Dependency bag for path normalization so tests can avoid touching the real filesystem.
 */
export type ResolveAttachmentPathOptions = {
	roots?: string[];
	checkExists?: (path: string | null | undefined) => boolean;
};

/**
 * Dependency bag for `parseRow()` so tests can inject contact lookup and attachment resolution.
 */
export type ParseRowOptions = {
	contactMap: Map<string, string>;
	resolveAttachment: AttachmentResolver;
};

/**
 * Replace the user's home directory prefix with `~` for safer, shorter output.
 */
export function formatOutputPath(path: string): string {
	const home = homedir();
	if (path === home) return "~";
	if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
	return path;
}

/**
 * Escape special characters for use in double-quoted YAML scalar values.
 */
export function escapeYaml(s: string): string {
	return s
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r");
}

/**
 * Remove null and undefined values from an object while preserving falsy values.
 */
export function pruneNulls<T extends Record<string, unknown>>(
	obj: T,
): Partial<T> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (value != null) result[key] = value;
	}
	return result as Partial<T>;
}

/**
 * Strip the object-replacement marker Apple prefixes onto attachment-backed captions.
 */
export function normalizeMessageText(text: string | null): string | null {
	if (text == null) return null;
	const normalized = text.replace(/^\uFFFC(?:\r?\n|\s)*/u, "");
	return normalized.length > 0 ? normalized : text;
}

/**
 * Treat Apple object-replacement-only text as attachment placeholder, not real content.
 */
export function hasMeaningfulText(text: string | null): text is string {
	if (text == null) return false;
	const trimmed = text.trim();
	return trimmed.length > 0 && !/^(?:\uFFFC)+$/u.test(trimmed);
}

/**
 * Generate a stable split-part GUID compatible with Messages association refs.
 */
export function generatePartGuid(originalGuid: string, index: number): string {
	return `p:${index}/${originalGuid}`;
}

/**
 * Return true when a path is absolute on macOS.
 */
export function isAbsolutePath(path: string | null | undefined): boolean {
	return typeof path === "string" && path.startsWith("/");
}

/**
 * Expand a leading tilde to the current user home directory.
 */
export function expandTildeInPath(path: string): string {
	return path.startsWith("~") ? join(homedir(), path.slice(2)) : path;
}

/**
 * Safe file existence check for attachment path normalization.
 */
export function fileExists(path: string | null | undefined): boolean {
	if (!path) return false;
	try {
		return existsSync(path);
	} catch {
		return false;
	}
}

/**
 * Normalize Messages attachment paths to absolute local filesystem paths when possible.
 *
 * Tests can inject synthetic roots and a fake existence check. Production falls back
 * to the user's Messages attachment directory and real filesystem checks.
 */
export function resolveAttachmentPath(
	filename: string | null,
	transferName: string | null,
	options: ResolveAttachmentPathOptions = {},
): ResolvedAttachmentPath {
	const rawPath = filename?.trim() || null;
	const roots = (options.roots ?? DEFAULT_ATTACHMENT_ROOTS).map(
		expandTildeInPath,
	);
	const checkExists = options.checkExists ?? fileExists;
	const candidates: string[] = [];

	if (rawPath) {
		const expanded = expandTildeInPath(rawPath);
		candidates.push(expanded);
		const marker = `${join("Library", "Messages", "Attachments")}/`;
		const markerIndex = expanded.indexOf(marker);
		if (markerIndex >= 0) {
			const relative = expanded.slice(markerIndex + marker.length);
			for (const root of roots) candidates.push(join(root, relative));
		}
		const rawBase = basename(expanded);
		if (rawBase.length > 0) {
			for (const root of roots) candidates.push(join(root, rawBase));
		}
	}

	if (transferName?.trim()) {
		for (const root of roots) candidates.push(join(root, transferName.trim()));
	}

	const seen = new Set<string>();
	for (const candidate of candidates) {
		if (!candidate || seen.has(candidate)) continue;
		seen.add(candidate);
		if (isAbsolutePath(candidate) && checkExists(candidate)) {
			return {
				path: candidate,
				original_path: rawPath ? expandTildeInPath(rawPath) : null,
				exists: true,
				absolute: true,
				missing: false,
			};
		}
	}

	const expandedRaw = rawPath ? expandTildeInPath(rawPath) : null;
	return {
		path: expandedRaw && isAbsolutePath(expandedRaw) ? expandedRaw : null,
		original_path: expandedRaw,
		exists: false,
		absolute: isAbsolutePath(expandedRaw),
		missing: rawPath != null || transferName != null,
	};
}

/**
 * Convert Apple epoch timestamps to Unix milliseconds.
 *
 * Messages stores a mix of second, millisecond, and nanosecond precision values
 * across macOS versions. Sentinel zero and negative values are treated as unset.
 */
export function appleDateToUnixMs(appleDate: number | null): number | null {
	if (appleDate == null || appleDate <= 0) return null;

	let seconds: number;
	if (appleDate > 1_000_000_000_000_000) {
		seconds = Math.floor(appleDate / NANOSECOND_FACTOR);
	} else if (appleDate > 100_000_000_000) {
		seconds = Math.floor(appleDate / 1000);
	} else {
		seconds = appleDate;
	}

	const unixMs = (seconds + APPLE_EPOCH_OFFSET) * 1000;
	return Number.isFinite(unixMs) ? unixMs : null;
}

/**
 * Format a Date using local wall time with an explicit UTC offset.
 */
export function formatLocalISO(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const seconds = String(date.getSeconds()).padStart(2, "0");
	const offsetMinutes = -date.getTimezoneOffset();
	const sign = offsetMinutes >= 0 ? "+" : "-";
	const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(
		2,
		"0",
	);
	const offsetRemainder = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
	return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetRemainder}`;
}

/**
 * Convert an Apple epoch timestamp to ISO 8601 UTC.
 */
export function appleEpochToISO(appleDate: number | null): string | null {
	const unixMs = appleDateToUnixMs(appleDate);
	if (unixMs == null) return null;
	try {
		return new Date(unixMs).toISOString();
	} catch {
		return null;
	}
}

/**
 * Convert an Apple epoch timestamp to local wall time with explicit UTC offset.
 */
export function appleEpochToLocalISO(appleDate: number | null): string | null {
	const unixMs = appleDateToUnixMs(appleDate);
	if (unixMs == null) return null;
	try {
		return formatLocalISO(new Date(unixMs));
	} catch {
		return null;
	}
}

/**
 * Convert a YYYY-MM-DD or ISO 8601 date string to Apple epoch nanoseconds.
 */
export function dateToAppleNs(dateStr: string): number {
	const dateOnly = dateStr.match(DATE_ONLY_RE);
	let d: Date;

	if (dateOnly) {
		const [, yearText, monthText, dayText] = dateOnly;
		const year = Number(yearText);
		const month = Number(monthText);
		const day = Number(dayText);
		d = new Date(year, month - 1, day, 0, 0, 0, 0);
	} else {
		d = new Date(dateStr);
	}

	const unixSeconds = d.getTime() / 1000;
	const appleSeconds = unixSeconds - APPLE_EPOCH_OFFSET;
	return Math.floor(appleSeconds * NANOSECOND_FACTOR);
}

/**
 * Convert a local calendar day to an inclusive end-of-day Apple epoch timestamp.
 */
export function dateToAppleNsEndOfDay(dateStr: string): number {
	const match = dateStr.match(DATE_ONLY_RE);
	if (!match) return dateToAppleNs(dateStr);

	const [, yearText, monthText, dayText] = match;
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const d = new Date(year, month - 1, day, 23, 59, 59, 999);
	const unixSeconds = d.getTime() / 1000;
	const appleSeconds = unixSeconds - APPLE_EPOCH_OFFSET;
	return Math.floor(appleSeconds * NANOSECOND_FACTOR);
}

/**
 * Normalize Australian phone numbers for contact matching while leaving email-like
 * or short-code handles intact.
 */
export function normalizePhone(raw: string): string {
	let digits = raw.replace(/[^\d+]/g, "");

	if (digits.startsWith("04") && digits.length === 10) {
		digits = `+61${digits.slice(1)}`;
	} else if (/^0[2378]\d{8}$/.test(digits)) {
		digits = `+61${digits.slice(1)}`;
	} else if (/^61[234578]\d{8}$/.test(digits)) {
		digits = `+${digits}`;
	}

	return digits;
}

/**
 * Format a display name from first, last, and organization fields.
 */
export function formatContactName(
	first: string | null,
	last: string | null,
	org: string | null,
): string | null {
	const parts: string[] = [];
	if (first?.trim()) parts.push(first.trim());
	if (last?.trim()) parts.push(last.trim());
	if (parts.length > 0) return parts.join(" ");
	if (org?.trim()) return org.trim();
	return null;
}

/**
 * Resolve a phone number or email handle to a contact name.
 */
export function resolveContact(
	handle: string,
	contactMap: Map<string, string>,
): string | null {
	if (!handle) return null;

	const emailMatch = contactMap.get(handle.toLowerCase().trim());
	if (emailMatch) return emailMatch;

	const phoneMatch = contactMap.get(normalizePhone(handle));
	if (phoneMatch) return phoneMatch;

	return null;
}

/**
 * Decode Ventura+ `attributedBody` binary plists into plain text.
 */
export function decodeAttributedBody(
	blob: Buffer | Uint8Array | null,
): string | null {
	if (!blob || blob.length === 0) return null;

	const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
	const nsStringMarker = Buffer.from("NSString");
	const streamtypedMarker = Buffer.from("streamtyped");

	const isStructuredTextCandidate = (value: string): boolean => {
		const trimmed = value.trim();
		if (trimmed.length === 0 || trimmed.includes("\uFFFD")) return false;
		if (/^\$/.test(trimmed) || /^NS[A-Z]/.test(trimmed)) return false;
		if (/^(com\.apple|public\.)/.test(trimmed)) return false;
		return !containsStructuredControlChars(trimmed);
	};

	const isLikelyMessageText = (value: string): boolean => {
		const trimmed = value.trim();
		if (!isStructuredTextCandidate(trimmed)) return false;

		const looksLikePathOrUrl = /^(https?:\/\/|file:\/\/|\/)/.test(trimmed);
		const hasSentenceSignals = /[\s!?.,:;()[\]'"-]/.test(trimmed);
		const hasLettersOrEmoji = /[A-Za-z\u00A0-\uFFFF]/.test(trimmed);

		if (!hasLettersOrEmoji) return false;
		if (looksLikePathOrUrl && !hasSentenceSignals) return false;

		return true;
	};

	const scoreCandidate = (value: string): number => {
		const trimmed = value.trim();
		if (!isLikelyMessageText(trimmed)) return Number.NEGATIVE_INFINITY;

		let score = Math.min(trimmed.length, 200);
		if (/\s/.test(trimmed)) score += 40;
		if (/[a-z]/.test(trimmed)) score += 10;
		if (/[\u0080-\uFFFF]/.test(trimmed)) score += 10;
		if (/^(https?:\/\/|file:\/\/|\/)/.test(trimmed)) score -= 35;
		if (/(attachments?|Library|Messages)\//i.test(trimmed)) score -= 50;
		if (/^[A-Za-z0-9._-]+$/.test(trimmed) && !/\s/.test(trimmed)) score -= 30;

		return score;
	};

	const decodeStructuredSlice = (
		start: number,
		lengthHint?: number,
	): string | null => {
		if (start < 0 || start >= buf.length) return null;

		const end =
			lengthHint == null
				? buf.length
				: Math.min(start + lengthHint, buf.length);
		const decoded = buf.subarray(start, end).toString("utf-8");
		const cutPoints = [decoded.indexOf("\uFFFD"), decoded.indexOf("bplist00")]
			.filter((position) => position >= 0)
			.sort((a, b) => a - b);
		const candidate = trimTrailingStructuredControlChars(
			cutPoints.length > 0 ? decoded.slice(0, cutPoints[0]) : decoded,
		);
		return isStructuredTextCandidate(candidate)
			? candidate.trim() || null
			: null;
	};

	const skipStructuredControlBytes = (start: number): number => {
		let cursor = start;
		while (cursor < buf.length) {
			const currentByte = buf[cursor];
			if (currentByte == null || currentByte > 0x1f) break;
			cursor += 1;
		}
		return cursor;
	};

	try {
		let idx = buf.indexOf(nsStringMarker);
		if (idx !== -1) {
			idx += nsStringMarker.length;
			for (let i = idx; i < Math.min(idx + 50, buf.length - 1); i += 1) {
				if (buf[i] !== 0x2b) continue;

				const nextByte = buf[i + 1];
				if (nextByte == null) continue;
				if (nextByte > 1 && nextByte < 0x80) {
					const lengthHint = nextByte;
					const start = skipStructuredControlBytes(i + 2);
					const text = decodeStructuredSlice(start, lengthHint);
					if (text != null) return text;
					continue;
				}

				if (nextByte >= 0x80 && i + 2 < buf.length) {
					const lowByte = buf[i + 2];
					if (lowByte == null) continue;
					const lengthHint = ((nextByte & 0x7f) << 8) | lowByte;
					const start = skipStructuredControlBytes(i + 3);
					const text = decodeStructuredSlice(start, lengthHint);
					if (text != null) return text;
				}
			}
		}

		const markerPositions = [
			buf.indexOf(streamtypedMarker),
			buf.indexOf(nsStringMarker),
		].filter((position) => position >= 0);
		const searchStart =
			markerPositions.length > 0 ? Math.min(...markerPositions) : 0;
		const fullText = buf.subarray(searchStart).toString("utf-8");
		const runs = splitControlRuns(fullText).filter((s) => s.length > 1);
		const noise = new Set([
			"NSString",
			"NSDictionary",
			"NSArray",
			"NSNumber",
			"NSObject",
			"NSAttributedString",
			"NSMutableAttributedString",
			"NSAttributes",
			"NSParagraphStyle",
			"NSFont",
			"NSColor",
			"streamtyped",
			"$archiver",
			"$objects",
			"$top",
			"$version",
			"NSKeyedArchiver",
			"NS.keys",
			"NS.objects",
			"NS.string",
			"NS.data",
		]);
		const candidates = runs
			.map((value) => value.trim())
			.filter((value) => value.length > 1 && !noise.has(value))
			.map((value) => ({ value, score: scoreCandidate(value) }))
			.filter((candidate) => candidate.score >= 60)
			.sort((a, b) => b.score - a.score || b.value.length - a.value.length);
		return candidates[0]?.value ?? null;
	} catch {}

	return null;
}

function buildParsedAttachment(
	row: AttachmentRow,
	resolveAttachment: AttachmentResolver,
): ParsedAttachment {
	const resolved = resolveAttachment(row.filename, row.transfer_name);
	return {
		filename: row.filename,
		path: resolved.path,
		original_path: resolved.original_path,
		mime_type: row.mime_type,
		uti: row.uti,
		size: row.total_bytes,
		name: row.transfer_name,
		exists: resolved.exists,
		absolute: resolved.absolute,
		missing: resolved.missing,
	};
}

/**
 * Split one DB row into stable text/media/tapback parts.
 */
export function parseRow(
	row: MessageRow,
	attachmentRows: AttachmentRow[],
	options: ParseRowOptions,
): ParsedMessageInternal[] {
	const assocType = row.associated_message_type;

	let text = row.text;
	if (text == null && row.attributedBody != null) {
		const decoded = decodeAttributedBody(row.attributedBody);
		text = decoded ?? "[attributedBody: unable to decode]";
	}
	text = normalizeMessageText(text);

	const handle = row.handle_id;
	const date = appleEpochToISO(row.apple_date);
	const dateLocal = appleEpochToLocalISO(row.apple_date);
	const dateRead = appleEpochToISO(row.date_read);
	const dateReadLocal = appleEpochToLocalISO(row.date_read);
	const dateEdited = appleEpochToISO(row.date_edited);
	const dateEditedLocal = appleEpochToLocalISO(row.date_edited);
	const normalizedAttachments = attachmentRows.map((row) =>
		buildParsedAttachment(row, options.resolveAttachment),
	);
	const replyToRaw = row.thread_originator_guid;

	const base: Omit<
		ParsedMessageInternal,
		| "guid"
		| "part_index"
		| "message_kind"
		| "text"
		| "reply_to"
		| "reaction_to"
		| "attachment"
	> = {
		_rowid: row.rowid,
		source_guid: row.guid,
		group_guid: row.guid,
		is_from_me: row.is_from_me === 1,
		date,
		date_local: dateLocal,
		date_read: dateRead,
		date_read_local: dateReadLocal,
		edited: dateEdited != null ? true : null,
		date_edited: dateEdited,
		date_edited_local: dateEditedLocal,
		service: row.service,
		handle,
		contact_name: handle ? resolveContact(handle, options.contactMap) : null,
		chat_name: row.chat_display_name,
		chat_id: row.chat_identifier,
		is_group: row.chat_style === 43,
		thread_originator: row.thread_originator_guid,
		reply_to_raw: replyToRaw,
		reaction_to_raw:
			assocType && assocType >= 2000 ? row.associated_message_guid : null,
		reaction_type: assocType && assocType >= 2000 ? assocType : null,
		subject: row.subject,
	};

	if (assocType && assocType >= 2000) {
		return [
			{
				...base,
				guid: row.guid,
				part_index: null,
				message_kind: "tapback",
				text,
				reply_to: null,
				reaction_to: null,
				attachment: null,
			},
		];
	}

	const messages: ParsedMessageInternal[] = [];
	let partIndex = 0;

	for (const attachment of normalizedAttachments) {
		messages.push({
			...base,
			guid: generatePartGuid(row.guid, partIndex),
			part_index: partIndex,
			message_kind: "media",
			text: null,
			reply_to: null,
			reaction_to: null,
			attachment,
		});
		partIndex += 1;
	}

	if (hasMeaningfulText(text)) {
		messages.push({
			...base,
			guid: generatePartGuid(row.guid, partIndex),
			part_index: partIndex,
			message_kind: "text",
			text,
			reply_to: null,
			reaction_to: null,
			attachment: null,
		});
		partIndex += 1;
	}

	if (messages.length === 0) {
		messages.push({
			...base,
			guid: generatePartGuid(row.guid, 0),
			part_index: 0,
			message_kind: "text",
			text,
			reply_to: null,
			reaction_to: null,
			attachment: null,
		});
	}

	return messages;
}

/**
 * Parse a split-part reference like `p:2/<source-guid>`.
 */
export function parsePartReference(
	value: string | null,
): { index: number; sourceGuid: string } | null {
	if (!value) return null;
	const match = value.match(/^p:(\d+)\/(.+)$/);
	if (!match) return null;
	const indexText = match[1];
	const sourceGuid = match[2];
	if (indexText == null || sourceGuid == null) return null;
	return {
		index: Number(indexText),
		sourceGuid,
	};
}

/**
 * Determine whether two messages belong to the same conversation.
 */
export function sameConversation(
	a: ParsedMessageInternal,
	b: ParsedMessageInternal,
): boolean {
	if (a.chat_id && b.chat_id) return a.chat_id === b.chat_id;
	if (a.handle && b.handle) return a.handle === b.handle;
	return false;
}

/**
 * Choose the most useful target part for a reply or tapback when multiple parts exist.
 */
export function choosePreferredPart(
	parts: ParsedMessageInternal[],
	current: ParsedMessageInternal,
	kind: "reply" | "reaction",
): ParsedMessageInternal | null {
	const textPart = parts.find((part) => part.message_kind === "text") ?? null;
	const mediaPart = parts.find((part) => part.message_kind === "media") ?? null;

	if (kind === "reaction") {
		const reactionText = current.text ?? "";
		const quotedText = /[“"].+[”"]/.test(reactionText);
		const mediaCue =
			/\b(an image|a photo|a video|an audio message|audio message|sticker|attachment)\b/i.test(
				reactionText,
			);
		if (quotedText && textPart) return textPart;
		if (mediaCue && mediaPart) return mediaPart;
	}

	return textPart ?? mediaPart ?? parts[0] ?? null;
}

/**
 * Heuristically link a reply or tapback to a nearby earlier message in the same conversation.
 */
export function findHeuristicTarget(
	messages: ParsedMessageInternal[],
	index: number,
	kind: "reply" | "reaction",
): ParsedMessageInternal | null {
	const current = messages[index];
	if (!current?.date) return null;

	const currentMs = Date.parse(current.date);
	if (Number.isNaN(currentMs)) return null;

	let best: { candidate: ParsedMessageInternal; score: number } | null = null;

	for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
		const candidate = messages[cursor];
		if (!candidate?.date) continue;
		if (candidate.message_kind === "tapback") continue;
		if (!sameConversation(current, candidate)) continue;

		const candidateMs = Date.parse(candidate.date);
		if (Number.isNaN(candidateMs)) continue;
		const delta = currentMs - candidateMs;
		if (delta < 0) continue;
		if (delta > LINK_SEARCH_WINDOW_MS) break;

		let score = 1000 - delta / 1000;
		if (kind === "reaction") {
			const reactionText = current.text ?? "";
			const quotedText = /[“"].+[”"]/.test(reactionText);
			const mediaCue =
				/\b(an image|a photo|a video|an audio message|audio message|sticker|attachment)\b/i.test(
					reactionText,
				);
			if (mediaCue && candidate.message_kind === "media") score += 120;
			if (quotedText && candidate.message_kind === "text") score += 120;
			if (!quotedText && !mediaCue && candidate.message_kind === "text")
				score += 20;
		} else if (candidate.message_kind === "text") {
			score += 20;
		}

		if (best == null || score > best.score) {
			best = { candidate, score };
		}
	}

	return best?.candidate ?? null;
}

/**
 * Resolve reply and tapback targets against split-part message GUIDs.
 */
export function linkMessageTargets(
	messages: ParsedMessageInternal[],
): ParsedMessageInternal[] {
	const byGuid = new Map<string, ParsedMessageInternal>();
	const partsBySourceGuid = new Map<string, ParsedMessageInternal[]>();

	for (const message of messages) {
		byGuid.set(message.guid, message);
		if (message.message_kind !== "tapback") {
			const bucket = partsBySourceGuid.get(message.source_guid) ?? [];
			bucket.push(message);
			partsBySourceGuid.set(message.source_guid, bucket);
		}
	}

	for (const parts of partsBySourceGuid.values()) {
		parts.sort((a, b) => (a.part_index ?? 0) - (b.part_index ?? 0));
	}

	const resolveTarget = (
		current: ParsedMessageInternal,
		rawGuid: string | null,
		kind: "reply" | "reaction",
		index: number,
	): string | null => {
		if (rawGuid) {
			if (byGuid.has(rawGuid)) return rawGuid;

			const partRef = parsePartReference(rawGuid);
			if (partRef) {
				const parts = partsBySourceGuid.get(partRef.sourceGuid);
				if (parts?.length) {
					const exact = parts.find((part) => part.part_index === partRef.index);
					if (exact) return exact.guid;
					if (parts.length === 1) return parts[0]?.guid ?? rawGuid;
					return choosePreferredPart(parts, current, kind)?.guid ?? rawGuid;
				}
			}

			const parts = partsBySourceGuid.get(rawGuid);
			if (parts?.length) {
				if (parts.length === 1) return parts[0]?.guid ?? rawGuid;
				return choosePreferredPart(parts, current, kind)?.guid ?? rawGuid;
			}
		}

		return findHeuristicTarget(messages, index, kind)?.guid ?? null;
	};

	return messages.map((message, index) => {
		if (message.message_kind === "tapback") {
			return {
				...message,
				reaction_to: resolveTarget(
					message,
					message.reaction_to_raw,
					"reaction",
					index,
				),
			};
		}

		if (message.reply_to_raw) {
			return {
				...message,
				reply_to: resolveTarget(message, message.reply_to_raw, "reply", index),
			};
		}

		return message;
	});
}

/**
 * Testable search matcher for post-decode text filtering.
 */
export function matchesSearch(
	message: ParsedMessage,
	needle: string | null,
): boolean {
	if (needle == null) return true;
	return message.text?.toLowerCase().includes(needle.toLowerCase()) ?? false;
}

/**
 * Save a message as a markdown file with YAML frontmatter.
 */
export function saveMessageAsMarkdown(
	msg: ParsedMessage,
	saveDir: string,
): string | null {
	if (!msg.date || (!msg.text && !msg.attachment)) return null;

	const dt = new Date(msg.date);
	const year = dt.getFullYear();
	const month = String(dt.getMonth() + 1).padStart(2, "0");
	const day = String(dt.getDate()).padStart(2, "0");

	const dateFolder = `${year}/${year}-${month}-${day}`;
	const safeGuid = msg.guid.replace(/\//g, "_").replace(/:/g, "-");
	const filePath = join(saveDir, dateFolder, `${safeGuid}.md`);

	const handle = msg.handle ?? "unknown";
	const sender = msg.is_from_me ? "me" : (msg.contact_name ?? handle);
	const chatName = msg.chat_name ?? msg.chat_id ?? "direct";

	const fm: string[] = [
		"---",
		`guid: "${escapeYaml(msg.guid)}"`,
		`source_guid: "${escapeYaml(msg.source_guid)}"`,
		`message_kind: "${msg.message_kind}"`,
		`from: "${escapeYaml(sender)}"`,
		`handle: "${escapeYaml(handle)}"`,
		`date: ${msg.date}`,
		...(msg.date_local ? [`date_local: ${msg.date_local}`] : []),
		`is_from_me: ${msg.is_from_me}`,
		`service: ${msg.service ?? "unknown"}`,
		`thread: "${escapeYaml(chatName)}"`,
		`is_group: ${msg.is_group}`,
	];
	if (msg.group_guid) {
		fm.push(`group_guid: "${escapeYaml(msg.group_guid)}"`);
	}
	if (msg.part_index != null) {
		fm.push(`part_index: ${msg.part_index}`);
	}
	if (msg.contact_name) {
		fm.push(`contact_name: "${escapeYaml(msg.contact_name)}"`);
	}
	if (msg.thread_originator) {
		fm.push(`thread_originator: "${escapeYaml(msg.thread_originator)}"`);
	}
	if (msg.reply_to_raw) {
		fm.push(`reply_to_raw: "${escapeYaml(msg.reply_to_raw)}"`);
	}
	if (msg.reply_to) {
		fm.push(`reply_to: "${escapeYaml(msg.reply_to)}"`);
	}
	if (msg.reaction_to_raw) {
		fm.push(`reaction_to_raw: "${escapeYaml(msg.reaction_to_raw)}"`);
	}
	if (msg.reaction_to) {
		fm.push(`reaction_to: "${escapeYaml(msg.reaction_to)}"`);
		fm.push(`reaction_type: ${msg.reaction_type}`);
	}
	if (msg.subject) {
		fm.push(`subject: "${escapeYaml(msg.subject)}"`);
	}
	if (msg.edited) {
		fm.push("edited: true");
		if (msg.date_edited) fm.push(`date_edited: ${msg.date_edited}`);
		if (msg.date_edited_local)
			fm.push(`date_edited_local: ${msg.date_edited_local}`);
	}
	if (msg.attachment) {
		fm.push("has_attachment: true");
		if (msg.attachment.filename) {
			fm.push(`attachment_filename: "${escapeYaml(msg.attachment.filename)}"`);
		}
		if (msg.attachment.path) {
			fm.push(`attachment_path: "${escapeYaml(msg.attachment.path)}"`);
		}
		if (msg.attachment.original_path) {
			fm.push(
				`attachment_original_path: "${escapeYaml(msg.attachment.original_path)}"`,
			);
		}
		if (msg.attachment.name) {
			fm.push(`attachment_name: "${escapeYaml(msg.attachment.name)}"`);
		}
		if (msg.attachment.mime_type) {
			fm.push(
				`attachment_mime_type: "${escapeYaml(msg.attachment.mime_type)}"`,
			);
		}
		if (msg.attachment.uti) {
			fm.push(`attachment_uti: "${escapeYaml(msg.attachment.uti)}"`);
		}
		if (msg.attachment.size != null) {
			fm.push(`attachment_size: ${msg.attachment.size}`);
		}
		fm.push(`attachment_exists: ${msg.attachment.exists}`);
	}
	fm.push("---");

	const body =
		msg.text ?? msg.attachment?.path ?? msg.attachment?.filename ?? "";
	const content = `${fm.join("\n")}\n\n${body}\n`;

	try {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, content, "utf-8");
		return filePath;
	} catch (err) {
		console.error(`[imessage-reader] Failed to save ${filePath}: ${err}`);
		return null;
	}
}

// ── V2 Corpus Types ────────────────────────────────────────────────────

/**
 * Sync cursor state persisted at runtime/imessage/cursors/default-sync.json.
 */
export type SyncCursor = {
	schema_version: 1;
	source_system: "imessage";
	mode: string;
	last_successful_sent_at: string;
	last_successful_source_id: string;
	updated_at: string;
};

/**
 * One row in the manifest JSONL file.
 */
export type ManifestEntry = {
	schema_version: 1;
	source_id: string;
	relative_path: string;
	slug_version: 2;
	updated_at: string;
};

/**
 * Structured attachment entry for v2 notes.
 */
export type V2Attachment = {
	id: string;
	kind: string;
	filename: string;
	mime_type: string | null;
	local_path: string;
	size_bytes: number | null;
	sha256: string | null;
	extracted_text: string | null;
	ai_caption: string | null;
};

/**
 * Tapback reaction entry for enriched v2 notes.
 */
export type TapbackInfo = {
	type: string;
	from: string;
	guid: string;
};

/**
 * Optional enrichment data passed to the v2 note writer.
 */
export type MessageEnrichment = {
	threadDepth?: number;
	threadRoot?: string;
	tapbacks?: TapbackInfo[];
};

/**
 * Input shape for v2 note writing -- a parsed message plus conversation context.
 */
export type V2NoteInput = {
	source_id: string;
	source_thread_id: string;
	sent_at: string;
	direction: "inbound" | "outbound";
	message_kind: string;
	from: string;
	handle: string;
	is_from_me: boolean;
	service: string;
	thread: string;
	is_group: boolean;
	conversation_with: string;
	conversation_type: "direct" | "group";
	text: string | null;
	group_guid?: string | null;
	part_index?: number | null;
	contact_name?: string | null;
	thread_originator?: string | null;
	reply_to_raw?: string | null;
	reply_to?: string | null;
	reaction_to_raw?: string | null;
	reaction_to?: string | null;
	reaction_type?: number | null;
	subject?: string | null;
	edited?: true | null;
	date_edited?: string | null;
	date_edited_local?: string | null;
	attachments?: V2Attachment[];
	enrichment?: MessageEnrichment;
};

function sortedDisplayList(values: Array<string | null | undefined>): string[] {
	return values
		.filter((value): value is string => Boolean(value && value.trim()))
		.map((value) => value.trim())
		.sort((a, b) => a.localeCompare(b, "en-AU"));
}

function conversationWithFromMessage(msg: ParsedMessage): string {
	const handle = msg.handle ?? "unknown";
	const contactName = msg.contact_name ?? handle;

	if (!msg.is_group) {
		return contactName;
	}

	if (msg.chat_name?.trim()) {
		const explicitName = msg.chat_name.trim();
		if (!explicitName.includes(",")) {
			return explicitName;
		}

		const sortedNames = sortedDisplayList(explicitName.split(","));
		if (sortedNames.length > 0) {
			return sortedNames.slice(0, 3).join(", ");
		}
	}

	const fallbackNames = sortedDisplayList([msg.contact_name, msg.handle]);
	if (fallbackNames.length > 0) {
		return fallbackNames.slice(0, 3).join(", ");
	}

	return `group:${msg.chat_id ?? "unknown"}`;
}

// ── Commitment Extraction ───────────────────────────────────────────────

/**
 * Structured commitment candidate emitted before any task write.
 */
export type CommitmentCandidate = {
	schema_version: 1;
	source_system: "imessage";
	source_id: string;
	source_thread_id: string;
	sent_at: string;
	direction: "inbound" | "outbound";
	conversation_with: string;
	candidate_type: "promise" | "request" | "offer" | "follow_up";
	quote: string;
	summary: string;
	confidence: number;
	owner_hint?: string;
	owner_status: "resolved" | "ambiguous" | "unknown";
};

const OUTBOUND_PROMISE_RE =
	/\b(i('|')ll|i will|i('|')m going to|let me|i('|')m gonna)\b/i;
const OUTBOUND_OFFER_RE = /\b(i can|i could|want me to|shall i)\b/i;
const INBOUND_REQUEST_RE =
	/\b(can you|could you|please|would you|do you mind|don('|')t forget)\b/i;
const FOLLOW_UP_RE =
	/\b(by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|end of day|eod|friday))\b/i;

/**
 * Extract commitment candidates from a batch of parsed messages.
 * Returns structured candidates -- never auto-writes to any repo.
 */
export function extractCommitmentCandidates(
	messages: ParsedMessage[],
): CommitmentCandidate[] {
	const candidates: CommitmentCandidate[] = [];

	for (const msg of messages) {
		if (!msg.text || msg.message_kind === "tapback") continue;

		const text = msg.text.trim();
		if (text.length < 5) continue;

		const direction: "inbound" | "outbound" = msg.is_from_me
			? "outbound"
			: "inbound";
		const handle = msg.handle ?? "unknown";
		const contactName = msg.contact_name ?? handle;
		const conversationWith = msg.is_from_me ? contactName : contactName;

		let candidateType: CommitmentCandidate["candidate_type"] | null = null;
		let confidence = 0;

		if (direction === "outbound") {
			if (OUTBOUND_PROMISE_RE.test(text)) {
				candidateType = "promise";
				confidence = 0.85;
			} else if (OUTBOUND_OFFER_RE.test(text)) {
				candidateType = "offer";
				confidence = 0.7;
			}
		} else {
			if (INBOUND_REQUEST_RE.test(text)) {
				candidateType = "request";
				confidence = 0.75;
			}
		}

		if (!candidateType) continue;

		if (FOLLOW_UP_RE.test(text)) {
			confidence = Math.min(confidence + 0.1, 0.99);
		}

		candidates.push({
			schema_version: 1,
			source_system: "imessage",
			source_id: msg.guid,
			source_thread_id: msg.chat_id ?? "",
			sent_at: msg.date_local ?? msg.date ?? "",
			direction,
			conversation_with: conversationWith,
			candidate_type: candidateType,
			quote: text,
			summary: text,
			confidence: Math.round(confidence * 100) / 100,
			owner_status: msg.is_group ? "unknown" : "ambiguous",
		});
	}

	return candidates;
}

// ── Attachment Kind ─────────────────────────────────────────────────────

/**
 * Map a MIME type to an attachment kind per the attachment model spec.
 */
export function attachmentKind(mimeType: string | null): string {
	if (!mimeType) return "other";
	if (mimeType.startsWith("image/")) return "image";
	if (mimeType.startsWith("video/")) return "video";
	if (mimeType.startsWith("audio/")) return "audio";
	if (mimeType === "application/pdf") return "document";
	if (mimeType.startsWith("text/")) return "document";
	return "other";
}

// ── Tapback Type Mapping ───────────────────────────────────────────────

const TAPBACK_TYPE_MAP: Record<number, string> = {
	2000: "Love",
	2001: "Like",
	2002: "Dislike",
	2003: "Laugh",
	2004: "Emphasis",
	2005: "Question",
	3000: "Remove Love",
	3001: "Remove Like",
	3002: "Remove Dislike",
	3003: "Remove Laugh",
	3004: "Remove Emphasis",
	3005: "Remove Question",
};

/**
 * Map an associated_message_type to a human-readable tapback name.
 */
export function tapbackTypeToName(typeCode: number | null): string | null {
	if (typeCode == null) return null;
	return TAPBACK_TYPE_MAP[typeCode] ?? null;
}

// ── Thread Depth & Root ────────────────────────────────────────────────

/**
 * Compute thread depth and root for a batch of messages.
 * Walk reply_to chains to find the root; cache results.
 */
export function computeThreadDepthAndRoot(
	messages: ParsedMessage[],
): Map<string, { depth: number; root: string }> {
	const byGuid = new Map<string, ParsedMessage>();
	for (const msg of messages) byGuid.set(msg.guid, msg);

	const cache = new Map<string, { depth: number; root: string }>();

	function walk(
		guid: string,
		visiting = new Set<string>(),
	): { depth: number; root: string } {
		if (cache.has(guid))
			return cache.get(guid) as { depth: number; root: string };
		if (visiting.has(guid)) {
			const result = { depth: 0, root: guid };
			cache.set(guid, result);
			return result;
		}

		const msg = byGuid.get(guid);
		if (!msg?.reply_to || !byGuid.has(msg.reply_to)) {
			const result = { depth: 0, root: guid };
			cache.set(guid, result);
			return result;
		}

		visiting.add(guid);
		const parent = walk(msg.reply_to, visiting);
		visiting.delete(guid);
		const result = { depth: parent.depth + 1, root: parent.root };
		cache.set(guid, result);
		return result;
	}

	for (const msg of messages) walk(msg.guid);
	return cache;
}

// ── Tapback Aggregation ────────────────────────────────────────────────

/**
 * Aggregate tapback reactions onto target messages.
 * Remove tapbacks (3000+) cancel corresponding adds from the same sender.
 */
export function aggregateTapbacks(
	messages: ParsedMessage[],
): Map<string, TapbackInfo[]> {
	const activeByTarget = new Map<
		string,
		Map<string, TapbackInfo & { actorKey: string; timestamp: string }>
	>();

	for (const msg of messages) {
		if (msg.message_kind !== "tapback" || !msg.reaction_to) continue;

		const typeName = tapbackTypeToName(msg.reaction_type);
		if (!typeName) continue;

		const from = msg.is_from_me
			? "me"
			: (msg.contact_name ?? msg.handle ?? "unknown");
		const actorKey = msg.is_from_me ? "me" : (msg.handle ?? from);
		const targetKey = msg.reaction_to;
		const bucket = activeByTarget.get(targetKey) ?? new Map();
		const pairKey = `${actorKey}:${typeName.replace("Remove ", "")}`;

		if (typeName.startsWith("Remove ")) {
			bucket.delete(pairKey);
			activeByTarget.set(targetKey, bucket);
			continue;
		}

		bucket.set(pairKey, {
			type: typeName,
			from,
			guid: msg.guid,
			actorKey,
			timestamp: msg.date_local ?? msg.date ?? "",
		});
		activeByTarget.set(targetKey, bucket);
	}

	const result = new Map<string, TapbackInfo[]>();
	for (const [targetKey, bucket] of activeByTarget.entries()) {
		const tapbacks = Array.from(bucket.values())
			.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
			.map(({ type, from, guid }) => ({ type, from, guid }));
		result.set(targetKey, tapbacks);
	}
	return result;
}

// ── V2 Slug & Path ─────────────────────────────────────────────────────

/**
 * Canonical GUID slugifier v2: lowercase, replace non-alphanumeric with `-`,
 * collapse repeated `-`, trim leading/trailing `-`.
 */
export function guidSlugV2(guid: string): string {
	return guid
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-|-$/g, "");
}

/**
 * Compute time-of-day bucket from a local ISO timestamp.
 */
export function timeOfDay(localIso: string): string {
	const match = localIso.match(/T(\d{2}):/);
	const hour = match ? Number(match[1]) : 0;
	if (hour >= 5 && hour < 12) return "morning";
	if (hour >= 12 && hour < 17) return "afternoon";
	if (hour >= 17 && hour < 21) return "evening";
	return "night";
}

/**
 * Compute day-of-week from a local ISO timestamp.
 */
export function dayOfWeek(localIso: string): string {
	const d = new Date(localIso);
	return d.toLocaleDateString("en-AU", { weekday: "long" });
}

/**
 * Build the canonical v2 save path relative to the save dir.
 * Pattern: YYYY/MM/YYYY-MM-DD-HHmmss-imessage-{guid-slug-v2}.md
 */
export function canonicalSavePath(sentAt: string, sourceId: string): string {
	const d = new Date(sentAt);
	const year = String(d.getFullYear());
	const month = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	const hours = String(d.getHours()).padStart(2, "0");
	const minutes = String(d.getMinutes()).padStart(2, "0");
	const seconds = String(d.getSeconds()).padStart(2, "0");
	const slug = guidSlugV2(sourceId);
	const filename = `${year}-${month}-${day}-${hours}${minutes}${seconds}-imessage-${slug}.md`;
	return join(year, month, filename);
}

/**
 * Build the stable runtime-relative path for an attachment binary.
 * Binary copy can lag behind note persistence, but the target path
 * should still be deterministic.
 */
export function canonicalAttachmentLocalPath(
	sentAt: string,
	sourceId: string,
	filename: string,
): string {
	const d = new Date(sentAt);
	const year = String(d.getFullYear());
	const month = String(d.getMonth() + 1).padStart(2, "0");
	return join(
		"runtime/imessage/attachments",
		year,
		month,
		guidSlugV2(sourceId),
		filename,
	);
}

// ── V2 Frontmatter ─────────────────────────────────────────────────────

/**
 * Build the title for a v2 note: "iMessage with {contact} at {date} {HH:MM}"
 */
function v2Title(conversationWith: string, sentAt: string): string {
	const d = new Date(sentAt);
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	const hours = String(d.getHours()).padStart(2, "0");
	const minutes = String(d.getMinutes()).padStart(2, "0");
	return `iMessage with ${conversationWith} at ${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Build the date-only updated field from sent_at.
 */
function v2Updated(sentAt: string): string {
	const d = new Date(sentAt);
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/**
 * Save a v2 corpus note with canonical frontmatter and path.
 * Returns the absolute file path on success, null on failure.
 */
export function saveMessageAsMarkdownV2(
	input: V2NoteInput,
	saveDir: string,
): string | null {
	const hasAttachments = input.attachments && input.attachments.length > 0;
	if (!input.sent_at || (!input.text && !hasAttachments)) return null;

	const relPath = canonicalSavePath(input.sent_at, input.source_id);
	const filePath = join(saveDir, relPath);
	const title = v2Title(input.conversation_with, input.sent_at);
	const updated = v2Updated(input.sent_at);

	const fm: string[] = [
		"---",
		"schema_version: 2",
		`title: "${escapeYaml(title)}"`,
		"type: artifact-sidecar",
		"status: active",
		`updated: ${updated}`,
		"source_system: imessage",
		`source_id: "${escapeYaml(input.source_id)}"`,
		`source_thread_id: "${escapeYaml(input.source_thread_id)}"`,
		`sent_at: "${escapeYaml(input.sent_at)}"`,
		`direction: ${input.direction}`,
		`message_kind: ${input.message_kind}`,
		`from: "${escapeYaml(input.from)}"`,
		`handle: "${escapeYaml(input.handle)}"`,
		`is_from_me: ${input.is_from_me}`,
		`service: ${input.service}`,
		`thread: "${escapeYaml(input.thread)}"`,
		`is_group: ${input.is_group}`,
	];

	if (input.group_guid) {
		fm.push(`group_guid: "${escapeYaml(input.group_guid)}"`);
	}

	fm.push(
		`conversation_with: "${escapeYaml(input.conversation_with)}"`,
		`conversation_type: ${input.conversation_type}`,
		`day_of_week: "${dayOfWeek(input.sent_at)}"`,
		`time_of_day: "${timeOfDay(input.sent_at)}"`,
	);

	if (input.reply_to) {
		fm.push(`reply_to: "${escapeYaml(input.reply_to)}"`);
	}

	// Thread enrichment
	const enrichment = input.enrichment;
	if (enrichment?.threadDepth != null) {
		fm.push(`thread_depth: ${enrichment.threadDepth}`);
	}
	if (enrichment?.threadRoot) {
		fm.push(`thread_root: "${escapeYaml(enrichment.threadRoot)}"`);
	}

	// Tapback enrichment
	if (enrichment?.tapbacks) {
		if (enrichment.tapbacks.length === 0) {
			fm.push("tapbacks: []");
		} else {
			fm.push("tapbacks:");
			for (const tb of enrichment.tapbacks) {
				fm.push(`  - type: "${escapeYaml(tb.type)}"`);
				fm.push(`    from: "${escapeYaml(tb.from)}"`);
				fm.push(`    guid: "${escapeYaml(tb.guid)}"`);
			}
		}
	}

	// Structured attachments
	if (hasAttachments && input.attachments) {
		fm.push("attachments:");
		for (const att of input.attachments) {
			fm.push(`  - id: "${escapeYaml(att.id)}"`);
			fm.push(`    kind: ${att.kind}`);
			fm.push(`    filename: "${escapeYaml(att.filename)}"`);
			fm.push(
				`    mime_type: ${att.mime_type ? `"${escapeYaml(att.mime_type)}"` : "null"}`,
			);
			fm.push(`    local_path: "${escapeYaml(att.local_path)}"`);
			fm.push(`    size_bytes: ${att.size_bytes ?? "null"}`);
			fm.push(`    sha256: ${att.sha256 ? `"${att.sha256}"` : "null"}`);
			fm.push(
				`    extracted_text: ${att.extracted_text ? `"${escapeYaml(att.extracted_text)}"` : "null"}`,
			);
			fm.push(
				`    ai_caption: ${att.ai_caption ? `"${escapeYaml(att.ai_caption)}"` : "null"}`,
			);
		}
	}

	if (input.edited) {
		fm.push("edited: true");
		if (input.date_edited)
			fm.push(`date_edited: "${escapeYaml(input.date_edited)}"`);
		if (input.date_edited_local)
			fm.push(`date_edited_local: "${escapeYaml(input.date_edited_local)}"`);
	}

	fm.push("---");

	// Build body sections
	const bodySections: string[] = [];

	if (input.text) {
		bodySections.push(`## Message\n\n${input.text}`);
	}

	if (hasAttachments && input.attachments) {
		const attList = input.attachments
			.map((a) => `- \`${a.filename}\` - ${a.kind}`)
			.join("\n");
		bodySections.push(`## Attachments\n\n${attList}`);

		const withText = input.attachments.filter((a) => a.extracted_text);
		if (withText.length > 0) {
			const textSections = withText
				.map((a) => `### ${a.filename}\n\n${a.extracted_text}`)
				.join("\n\n");
			bodySections.push(`## Attachment Text\n\n${textSections}`);
		}
	}

	const content = `${fm.join("\n")}\n\n${bodySections.join("\n\n")}\n`;

	try {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, content, "utf-8");
		return filePath;
	} catch (err) {
		console.error(`[imessage-reader] Failed to save v2 ${filePath}: ${err}`);
		return null;
	}
}

// ── V2 Note Input Builder ──────────────────────────────────────────────

/**
 * Convert a ParsedMessage (from parseRow/linkMessageTargets) into a V2NoteInput.
 * This bridges the existing parse pipeline with the v2 corpus write path.
 */
export function parsedMessageToV2Input(msg: ParsedMessage): V2NoteInput {
	const handle = msg.handle ?? "unknown";
	const contactName = msg.contact_name ?? handle;
	const sender = msg.is_from_me ? "me" : contactName;
	const conversationWith = conversationWithFromMessage(msg);
	const sentAt = msg.date_local ?? msg.date ?? "";
	const attachmentFilename =
		msg.attachment?.filename ??
		msg.attachment?.name ??
		(msg.attachment?.path ? basename(msg.attachment.path) : null) ??
		"attachment";
	const attachments =
		msg.attachment == null
			? undefined
			: [
					{
						id: `att-${msg.part_index ?? 0}`,
						kind: attachmentKind(msg.attachment.mime_type),
						filename: attachmentFilename,
						mime_type: msg.attachment.mime_type,
						local_path: canonicalAttachmentLocalPath(
							sentAt,
							msg.guid,
							attachmentFilename,
						),
						size_bytes: msg.attachment.size,
						sha256: null,
						extracted_text: null,
						ai_caption: null,
					},
				];

	return {
		source_id: msg.guid,
		source_thread_id: msg.chat_id ?? "",
		sent_at: sentAt,
		direction: msg.is_from_me ? "outbound" : "inbound",
		message_kind: msg.message_kind,
		from: sender,
		handle,
		is_from_me: msg.is_from_me,
		service: msg.service ?? "iMessage",
		thread: msg.chat_name ?? contactName,
		is_group: msg.is_group,
		conversation_with: conversationWith,
		conversation_type: msg.is_group ? "group" : "direct",
		text: msg.text,
		group_guid: msg.group_guid,
		contact_name: msg.contact_name,
		reply_to: msg.reply_to,
		edited: msg.edited,
		date_edited: msg.date_edited,
		date_edited_local: msg.date_edited_local,
		attachments,
	};
}

// ── Cursor Read/Write ──────────────────────────────────────────────────

/**
 * Read a sync cursor from disk. Returns null if the file doesn't exist.
 */
export function readCursor(cursorPath: string): SyncCursor | null {
	try {
		const raw = readFileSync(cursorPath, "utf-8");
		return JSON.parse(raw) as SyncCursor;
	} catch {
		return null;
	}
}

/**
 * Write a sync cursor to disk. Only call after successful writes.
 */
export function writeCursor(cursorPath: string, cursor: SyncCursor): void {
	mkdirSync(dirname(cursorPath), { recursive: true });
	writeFileSync(cursorPath, JSON.stringify(cursor, null, 2), "utf-8");
}

// ── Manifest Append ────────────────────────────────────────────────────

function readManifestEntries(manifestPath: string): ManifestEntry[] {
	try {
		const raw = readFileSync(manifestPath, "utf-8").trim();
		if (!raw) return [];
		return raw
			.split("\n")
			.map((line) => JSON.parse(line) as ManifestEntry)
			.filter((entry) => Boolean(entry.source_id));
	} catch {
		return [];
	}
}

/**
 * Upsert a manifest entry by source_id so overlap windows do not create duplicates.
 */
export function upsertManifestEntry(
	manifestPath: string,
	entry: ManifestEntry,
): void {
	mkdirSync(dirname(manifestPath), { recursive: true });
	const entries = readManifestEntries(manifestPath).filter(
		(existing) => existing.source_id !== entry.source_id,
	);
	entries.push(entry);
	entries.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
	writeFileSync(
		manifestPath,
		entries.map((item) => JSON.stringify(item)).join("\n") + "\n",
		"utf-8",
	);
}

// ── Migration ──────────────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

/**
 * Extract frontmatter key-value pairs from a markdown file's content.
 * Simple line-based parser -- not a full YAML parser.
 */
export function parseFrontmatter(
	content: string,
): Record<string, string> | null {
	const match = content.match(FRONTMATTER_RE);
	if (!match?.[1]) return null;

	const result: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const colonIndex = line.indexOf(":");
		if (colonIndex < 1) continue;
		const key = line.slice(0, colonIndex).trim();
		let value = line.slice(colonIndex + 1).trim();
		// Strip surrounding quotes
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		result[key] = value;
	}
	return result;
}

/**
 * Migrate a single legacy note file to canonical v2 path.
 * Returns the new path on success, null if skipped or failed.
 */
export function migrateLegacyNote(
	legacyPath: string,
	saveDir: string,
): string | null {
	let content: string;
	try {
		content = readFileSync(legacyPath, "utf-8");
	} catch {
		return null;
	}

	const fm = parseFrontmatter(content);
	if (!fm) return null;

	const sourceId = fm.guid ?? fm.source_id;
	const sentAt = fm.date_local ?? fm.sent_at;
	if (!sourceId || !sentAt) return null;

	const newRelPath = canonicalSavePath(sentAt, sourceId);
	const newAbsPath = join(saveDir, newRelPath);

	// Already at canonical path?
	if (legacyPath === newAbsPath) return null;

	// Patch schema_version in content
	let patched = content;
	if (!patched.includes("schema_version:")) {
		patched = patched.replace("---\n", "---\nschema_version: 2\n");
	} else {
		patched = patched.replace(/schema_version:\s*\d+/, "schema_version: 2");
	}

	// Add source_id if only guid exists
	if (fm.guid && !fm.source_id) {
		patched = patched.replace(`guid: "${fm.guid}"`, `source_id: "${fm.guid}"`);
	}

	// Remove deprecated flat attachment fields
	const deprecatedFields = [
		"has_attachment",
		"attachment_filename",
		"attachment_path",
		"attachment_original_path",
		"attachment_name",
		"attachment_mime_type",
		"attachment_uti",
		"attachment_size",
		"attachment_exists",
	];
	for (const field of deprecatedFields) {
		patched = patched.replace(new RegExp(`^${field}:.*\n`, "m"), "");
	}

	try {
		mkdirSync(dirname(newAbsPath), { recursive: true });
		if (!existsSync(newAbsPath)) {
			writeFileSync(newAbsPath, patched, "utf-8");
		}
		// Remove the legacy file if it's different from the new path
		if (legacyPath !== newAbsPath) {
			unlinkSync(legacyPath);
		}
		return newAbsPath;
	} catch (err) {
		console.error(`[migrate-notes] Failed to migrate ${legacyPath}: ${err}`);
		return null;
	}
}

/**
 * Walk a save directory and migrate all legacy notes to canonical v2 paths.
 * Returns a summary of migrated and skipped files.
 */
export function migrateAllNotes(saveDir: string): {
	migrated: number;
	skipped: number;
	errors: number;
} {
	let migrated = 0;
	let skipped = 0;
	const errors = 0;

	function walkDir(dir: string): void {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = join(dir, entry);
			if (entry.endsWith(".md")) {
				const result = migrateLegacyNote(fullPath, saveDir);
				if (result) {
					migrated++;
				} else {
					skipped++;
				}
			} else if (!entry.includes(".")) {
				// Likely a directory
				walkDir(fullPath);
			}
		}
	}

	walkDir(saveDir);
	return { migrated, skipped, errors };
}
