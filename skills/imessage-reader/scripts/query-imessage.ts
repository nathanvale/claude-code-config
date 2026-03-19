#!/usr/bin/env bun
/**
 * iMessage Database Reader — Query macOS Messages.app chat.db directly.
 *
 * Every query automatically saves returned messages as markdown files
 * with YAML frontmatter (read-through persistence). Files are always
 * overwritten to capture edits.
 *
 * Requires Full Disk Access for the calling process.
 * Database location: ~/Library/Messages/chat.db
 *
 * Usage:
 *   bun run query-imessage.ts messages --since 2026-03-01 --until 2026-03-19
 *   bun run query-imessage.ts messages --contact "+61412345678" --limit 50
 *   bun run query-imessage.ts messages --search "school move"
 *   bun run query-imessage.ts contacts
 *   bun run query-imessage.ts threads --contact "+61412345678"
 *   bun run query-imessage.ts schema
 *   bun run query-imessage.ts help
 */

import Database from "bun:sqlite";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
	type AttachmentRow,
	appleEpochToISO,
	dateToAppleNsEndOfDay as dateToAppleNsEndOfDayFromLib,
	dateToAppleNs as dateToAppleNsFromLib,
	formatContactName as formatContactNameFromLib,
	formatOutputPath as formatOutputPathFromLib,
	linkMessageTargets as linkMessageTargetsFromLib,
	type MessageRow,
	matchesSearch,
	normalizePhone as normalizePhoneFromLib,
	type ParsedMessage,
	parseRow as parseRowFromLib,
	pruneNulls as pruneNullsFromLib,
	resolveAttachmentPath as resolveAttachmentPathFromLib,
	resolveContact,
	saveMessageAsMarkdown as saveMessageAsMarkdownFromLib,
} from "./lib";

// ── Constants ──────────────────────────────────────────────────────────

const DB_PATH = join(homedir(), "Library/Messages/chat.db");
const SCHEMA_VERSION = 3;
const MAX_LIMIT = 50_000;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})T/;

/**
 * Default save directory for markdown persistence.
 * Overridable via --save-dir flag.
 */
const DEFAULT_SAVE_DIR = join(homedir(), "Documents/messages");

// ── Error Handling ────────────────────────────────────────────────────

/** Exit codes for structured error reporting */
const EXIT = {
	SUCCESS: 0,
	UNKNOWN_ERROR: 1,
	INVALID_ARGS: 2,
	DB_ACCESS_DENIED: 3,
	QUERY_FAILED: 4,
} as const;

/** Structured error for machine-parseable agent output */
class SkillError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly hint: string,
		public readonly exitCode: number = EXIT.UNKNOWN_ERROR,
	) {
		super(message);
		this.name = "SkillError";
	}

	/** Emit JSON error to stdout and exit */
	emit(): never {
		console.log(
			JSON.stringify({
				schema_version: SCHEMA_VERSION,
				error: true,
				code: this.code,
				message: this.message,
				hint: this.hint,
			}),
		);
		process.exit(this.exitCode);
	}
}

// ── Input Validation ──────────────────────────────────────────────────

/**
 * Validate a date string is YYYY-MM-DD or ISO 8601 format.
 * Throws SkillError if invalid.
 */
function validateDate(s: string): string {
	const match = s.match(DATE_ONLY_RE) ?? s.match(ISO_DATE_RE);
	if (!match) {
		throw new SkillError(
			"INVALID_DATE",
			`Invalid date: "${s}"`,
			"Use YYYY-MM-DD or ISO 8601 format (e.g. 2026-03-01 or 2026-03-01T09:00:00Z)",
			EXIT.INVALID_ARGS,
		);
	}

	const [, yearText, monthText, dayText] = match;
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const probe = new Date(Date.UTC(year, month - 1, day));
	if (
		probe.getUTCFullYear() !== year ||
		probe.getUTCMonth() + 1 !== month ||
		probe.getUTCDate() !== day
	) {
		throw new SkillError(
			"INVALID_DATE",
			`Invalid date: "${s}"`,
			"Ensure month is 01-12 and day is valid for the month",
			EXIT.INVALID_ARGS,
		);
	}

	const d = DATE_ONLY_RE.test(s)
		? new Date(year, month - 1, day, 0, 0, 0, 0)
		: new Date(s);
	if (Number.isNaN(d.getTime())) {
		throw new SkillError(
			"INVALID_DATE",
			`Date parses to NaN: "${s}"`,
			"Ensure month is 01-12, day is valid for the month",
			EXIT.INVALID_ARGS,
		);
	}
	return s;
}

/**
 * Validate limit is a positive integer within bounds.
 * Throws SkillError if invalid.
 */
function validateLimit(v: string): number {
	const n = Number(v);
	if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
		throw new SkillError(
			"INVALID_LIMIT",
			`Invalid limit: "${v}"`,
			`Must be a positive integer between 1 and ${MAX_LIMIT}`,
			EXIT.INVALID_ARGS,
		);
	}
	return n;
}

/**
 * Validate sort order is ASC or DESC. Returns the literal type.
 */
function validateOrder(oldestFirst: boolean | undefined): "ASC" | "DESC" {
	return oldestFirst ? "ASC" : "DESC";
}

/**
 * Open the database, run a callback, and guarantee cleanup via try/finally.
 */
function withDB<T>(fn: (db: Database) => T): T {
	let db: Database;
	try {
		db = new Database(DB_PATH, { readonly: true });
	} catch {
		throw new SkillError(
			"DB_ACCESS_DENIED",
			"Unable to access Messages database",
			"Full Disk Access required. Grant it in System Settings > Privacy & Security > Full Disk Access.",
			EXIT.DB_ACCESS_DENIED,
		);
	}
	try {
		return fn(db);
	} catch (err) {
		if (err instanceof SkillError) throw err;
		throw new SkillError(
			"QUERY_FAILED",
			"SQL query failed",
			"SQL query failed — the database may be corrupt or the schema may have changed",
			EXIT.QUERY_FAILED,
		);
	} finally {
		db.close();
	}
}

/** Format JSON output — compact by default, pretty with --pretty */
function formatJSON(value: unknown, pretty: boolean): string {
	return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

// ── Contact Name Resolution ────────────────────────────────────────────

const ADDRESSBOOK_SOURCES_DIR = join(
	homedir(),
	"Library/Application Support/AddressBook/Sources",
);
const ADDRESSBOOK_DB_NAME = "AddressBook-v22.abcddb";

/**
 * Build a lookup map from normalized handle → display name by scanning
 * all AddressBook source databases. Merges phone numbers and email
 * addresses from Google, iCloud, and any other synced sources.
 *
 * Fails silently and returns an empty map if:
 * - The Sources directory doesn't exist
 * - No source DBs are found
 * - Individual source DBs can't be opened (permissions, corruption)
 */
function buildContactMap(): Map<string, string> {
	const map = new Map<string, string>();

	let sourceDirs: string[];
	try {
		sourceDirs = readdirSync(ADDRESSBOOK_SOURCES_DIR).sort();
	} catch {
		return map; // Sources dir doesn't exist or can't be read
	}

	for (const sourceId of sourceDirs) {
		const dbPath = join(ADDRESSBOOK_SOURCES_DIR, sourceId, ADDRESSBOOK_DB_NAME);
		let db: Database;
		try {
			db = new Database(dbPath, { readonly: true });
		} catch {
			continue; // This source can't be opened — skip it
		}

		try {
			// Query phone numbers with contact names
			const phoneRows = db
				.prepare(
					`SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, p.ZFULLNUMBER
					 FROM ZABCDRECORD r
					 JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
					 WHERE p.ZFULLNUMBER IS NOT NULL`,
				)
				.all() as {
				ZFIRSTNAME: string | null;
				ZLASTNAME: string | null;
				ZORGANIZATION: string | null;
				ZFULLNUMBER: string;
			}[];

			for (const row of phoneRows) {
				const name = formatContactNameFromLib(
					row.ZFIRSTNAME,
					row.ZLASTNAME,
					row.ZORGANIZATION,
				);
				if (!name) continue;
				const normalized = normalizePhoneFromLib(row.ZFULLNUMBER);
				if (normalized.length >= 3 && !map.has(normalized)) {
					map.set(normalized, name);
				}
			}

			// Query email addresses with contact names
			const emailRows = db
				.prepare(
					`SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, e.ZADDRESS
					 FROM ZABCDRECORD r
					 JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK
					 WHERE e.ZADDRESS IS NOT NULL`,
				)
				.all() as {
				ZFIRSTNAME: string | null;
				ZLASTNAME: string | null;
				ZORGANIZATION: string | null;
				ZADDRESS: string;
			}[];

			for (const row of emailRows) {
				const name = formatContactNameFromLib(
					row.ZFIRSTNAME,
					row.ZLASTNAME,
					row.ZORGANIZATION,
				);
				if (!name) continue;
				const normalized = row.ZADDRESS.toLowerCase().trim();
				if (normalized && !map.has(normalized)) {
					map.set(normalized, name);
				}
			}
		} catch {
			// Schema mismatch or corrupt source — skip
		} finally {
			db.close();
		}
	}

	return map;
}

/** Lazy singleton — built once per process, cached for reuse */
let _contactMap: Map<string, string> | null = null;
function getContactMap(): Map<string, string> {
	if (_contactMap == null) _contactMap = buildContactMap();
	return _contactMap;
}

/**
 * Save all messages and return counts of files written and errors.
 */
function persistMessages(
	messages: ParsedMessage[],
	saveDir: string,
): { saved: number; save_errors: number } {
	let saved = 0;
	let save_errors = 0;
	for (const msg of messages) {
		if (!msg.date || (!msg.text && !msg.attachment)) continue;
		const result = saveMessageAsMarkdownFromLib(msg, saveDir);
		if (result) {
			saved++;
		} else {
			// saveMessageAsMarkdown returns null for both skips and errors.
			// Only count as error if the message had text+date (wasn't a skip).
			save_errors++;
		}
	}
	return { saved, save_errors };
}

// ── Core Query ─────────────────────────────────────────────────────────

const MESSAGE_SQL = `
	SELECT
		m.rowid AS rowid,
		m.guid,
		m.text,
		m.attributedBody,
		m.is_from_me,
		m.date AS apple_date,
		m.date_read,
		m.date_edited,
		m.service,
		m.subject,
		m.thread_originator_guid,
		m.reply_to_guid,
		m.associated_message_guid,
		m.associated_message_type,
		h.id AS handle_id,
		c.display_name AS chat_display_name,
		c.chat_identifier,
		c.style AS chat_style
	FROM message m
	LEFT JOIN handle h ON m.handle_id = h.rowid
	LEFT JOIN chat_message_join cmj ON m.rowid = cmj.message_id
	LEFT JOIN chat c ON cmj.chat_id = c.rowid
`;

// ── Commands ───────────────────────────────────────────────────────────

function queryMessages(args: {
	since?: string;
	until?: string;
	contact?: string;
	search?: string;
	"from-me"?: boolean;
	"to-me"?: boolean;
	service?: string;
	limit: number;
	order: "ASC" | "DESC";
	"include-attachments"?: boolean;
	"save-dir"?: string;
	"no-save"?: boolean;
	pretty: boolean;
}) {
	const result = withDB((db) => {
		const conditions: string[] = [];
		const params: (string | number)[] = [];
		const searchNeedle = args.search?.toLowerCase().trim() || null;

		if (args.since) {
			conditions.push("m.date >= ?");
			params.push(dateToAppleNsFromLib(args.since));
		}
		if (args.until) {
			conditions.push("m.date <= ?");
			params.push(dateToAppleNsEndOfDayFromLib(args.until));
		}
		if (args.contact) {
			conditions.push("h.id LIKE ?");
			params.push(`%${args.contact}%`);
		}
		if (args["from-me"]) {
			conditions.push("m.is_from_me = 1");
		} else if (args["to-me"]) {
			conditions.push("m.is_from_me = 0");
		}
		if (args.service) {
			conditions.push("m.service = ?");
			params.push(args.service);
		}

		const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
		const fetchLimit =
			searchNeedle == null
				? args.limit
				: Math.min(Math.max(args.limit * 50, args.limit), MAX_LIMIT);
		const sql = `${MESSAGE_SQL} ${where} ORDER BY m.date ${args.order} LIMIT ?`;
		params.push(fetchLimit);

		const rows = db.prepare(sql).all(...params) as MessageRow[];
		if (rows.length === 0) return [];

		const rowids = rows.map((row) => row.rowid);
		const attachmentRowsByMessageId = new Map<number, AttachmentRow[]>();
		if (rowids.length > 0) {
			const placeholders = rowids.map(() => "?").join(",");
			const attRows = db
				.prepare(
					`SELECT maj.message_id, a.filename, a.mime_type, a.uti,
					        a.total_bytes, a.transfer_name
					 FROM message_attachment_join maj
					 JOIN attachment a ON maj.attachment_id = a.rowid
					 WHERE maj.message_id IN (${placeholders})`,
				)
				.all(...rowids) as AttachmentRow[];

			for (const att of attRows) {
				const mid = att.message_id;
				const bucket = attachmentRowsByMessageId.get(mid) ?? [];
				bucket.push(att);
				attachmentRowsByMessageId.set(mid, bucket);
			}
		}

		const messages = rows.flatMap((row) =>
			parseRowFromLib(row, attachmentRowsByMessageId.get(row.rowid) ?? [], {
				contactMap: getContactMap(),
				resolveAttachment: resolveAttachmentPathFromLib,
			}),
		);
		const linkedMessages = linkMessageTargetsFromLib(messages);
		const filteredMessages =
			searchNeedle == null
				? linkedMessages
				: linkedMessages.filter((message) =>
						matchesSearch(message, searchNeedle),
					);

		return filteredMessages.slice(0, args.limit);
	});

	// Strip internal _rowid once, reuse for both saving and output
	const messages = result.map(({ _rowid, ...msg }) => msg);

	// Read-through save: persist every message we just read
	const saveDir = args["save-dir"] ?? DEFAULT_SAVE_DIR;
	let saved = 0;
	let save_errors = 0;
	if (!args["no-save"]) {
		const saveResult = persistMessages(messages, saveDir);
		saved = saveResult.saved;
		save_errors = saveResult.save_errors;
	}

	const outputMessages = messages.map((msg) => pruneNullsFromLib(msg));

	const filters = pruneNullsFromLib({
		since: args.since ?? null,
		until: args.until ?? null,
		contact: args.contact ?? null,
		search: args.search ?? null,
	});

	const envelope: Record<string, unknown> = {
		schema_version: SCHEMA_VERSION,
		count: result.length,
		saved: args["no-save"] ? undefined : saved,
		save_dir: args["no-save"] ? undefined : formatOutputPathFromLib(saveDir),
		filters: Object.keys(filters).length > 0 ? filters : undefined,
		messages: outputMessages,
	};
	if (save_errors > 0) envelope.save_errors = save_errors;

	console.log(formatJSON(pruneNullsFromLib(envelope), args.pretty));
}

function queryContacts(args: { limit?: number; pretty: boolean }) {
	const contacts = withDB((db) => {
		const params: number[] = [];
		let limitClause = "";
		if (args.limit != null) {
			limitClause = "LIMIT ?";
			params.push(args.limit);
		}

		const sql = `
			SELECT
				h.id AS handle,
				h.service,
				COUNT(m.rowid) AS message_count,
				MIN(m.date) AS first_message,
				MAX(m.date) AS last_message
			FROM handle h
			JOIN message m ON m.handle_id = h.rowid
			GROUP BY h.id, h.service
			ORDER BY message_count DESC
			${limitClause}
		`;
		const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
		const cm = getContactMap();
		return rows.map((row) => ({
			handle: row.handle,
			contact_name: resolveContact(row.handle as string, cm),
			service: row.service,
			message_count: row.message_count,
			first_message: appleEpochToISO(row.first_message as number),
			last_message: appleEpochToISO(row.last_message as number),
		}));
	});

	console.log(
		formatJSON(
			{
				schema_version: SCHEMA_VERSION,
				count: contacts.length,
				contacts: contacts.map((c) => pruneNullsFromLib(c)),
			},
			args.pretty,
		),
	);
}

function queryThreads(args: {
	contact?: string;
	limit?: number;
	pretty: boolean;
}) {
	const threads = withDB((db) => {
		const conditions: string[] = [];
		const params: (string | number)[] = [];

		if (args.contact) {
			conditions.push(`c.rowid IN (
				SELECT chj.chat_id FROM chat_handle_join chj
				JOIN handle h ON chj.handle_id = h.rowid
				WHERE h.id LIKE ?
			)`);
			params.push(`%${args.contact}%`);
		}

		const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
		let limitClause = "";
		if (args.limit != null) {
			limitClause = "LIMIT ?";
			params.push(args.limit);
		}

		const sql = `
			SELECT
				c.rowid,
				c.chat_identifier,
				c.display_name,
				c.style,
				c.service_name,
				COUNT(DISTINCT cmj.message_id) AS message_count,
				GROUP_CONCAT(DISTINCT h.id) AS participants
			FROM chat c
			LEFT JOIN chat_message_join cmj ON c.rowid = cmj.chat_id
			LEFT JOIN chat_handle_join chj ON c.rowid = chj.chat_id
			LEFT JOIN handle h ON chj.handle_id = h.rowid
			${where}
			GROUP BY c.rowid
			ORDER BY message_count DESC
			${limitClause}
		`;
		const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
		return rows.map((row) => ({
			chat_id: row.chat_identifier,
			display_name: row.display_name,
			is_group: (row.style as number) === 43,
			service: row.service_name,
			message_count: row.message_count,
			participants: (row.participants as string)?.split(",") ?? [],
		}));
	});

	console.log(
		formatJSON(
			{ schema_version: SCHEMA_VERSION, count: threads.length, threads },
			args.pretty,
		),
	);
}

function showSchema(pretty: boolean) {
	const schema = withDB((db) => {
		const tables = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
			)
			.all() as { name: string }[];
		const result: Record<string, unknown> = {};
		for (const { name } of tables) {
			if (name.startsWith("_")) continue;
			const safeName = `"${name.replace(/"/g, '""')}"`;
			const cols = db.prepare(`PRAGMA table_info(${safeName})`).all() as {
				name: string;
				type: string;
			}[];
			const count = (
				db.prepare(`SELECT COUNT(*) AS c FROM ${safeName}`).get() as {
					c: number;
				}
			).c;
			result[name] = {
				columns: cols.map((c) => ({ name: c.name, type: c.type })),
				row_count: count,
			};
		}
		return result;
	});

	console.log(
		formatJSON({ schema_version: SCHEMA_VERSION, ...schema }, pretty),
	);
}

function showHelp(pretty: boolean) {
	console.log(
		formatJSON(
			{
				schema_version: SCHEMA_VERSION,
				commands: ["messages", "contacts", "threads", "schema", "help"],
			},
			pretty,
		),
	);
}

// ── CLI Routing ────────────────────────────────────────────────────────

try {
	const command = process.argv[2];
	const rest = process.argv.slice(3);

	switch (command) {
		case "messages": {
			let values: Record<string, unknown>;
			try {
				const parsed = parseArgs({
					args: rest,
					strict: true,
					options: {
						since: { type: "string" },
						until: { type: "string" },
						contact: { type: "string" },
						search: { type: "string" },
						"from-me": { type: "boolean", default: false },
						"to-me": { type: "boolean", default: false },
						service: { type: "string" },
						limit: { type: "string" },
						"oldest-first": { type: "boolean", default: false },
						"include-attachments": { type: "boolean", default: false },
						"save-dir": { type: "string" },
						"no-save": { type: "boolean", default: false },
						pretty: { type: "boolean", default: false },
					},
				});
				values = parsed.values as Record<string, unknown>;
			} catch (err) {
				throw new SkillError(
					"UNKNOWN_FLAG",
					String(err instanceof Error ? err.message : err),
					'Run "help" command to see available options',
					EXIT.INVALID_ARGS,
				);
			}

			// Validate inputs
			if (values.since) validateDate(values.since as string);
			if (values.until) validateDate(values.until as string);
			if (values["from-me"] && values["to-me"]) {
				throw new SkillError(
					"INVALID_ARGS",
					"Cannot use --from-me and --to-me together",
					"Choose one direction filter or omit both",
					EXIT.INVALID_ARGS,
				);
			}
			const limit = values.limit ? validateLimit(values.limit as string) : 100;
			const order = validateOrder(
				values["oldest-first"] as boolean | undefined,
			);
			const pretty = values.pretty as boolean;

			queryMessages({
				since: values.since as string | undefined,
				until: values.until as string | undefined,
				contact: values.contact as string | undefined,
				search: values.search as string | undefined,
				"from-me": values["from-me"] as boolean,
				"to-me": values["to-me"] as boolean,
				service: values.service as string | undefined,
				limit,
				order,
				"include-attachments": values["include-attachments"] as boolean,
				"save-dir": values["save-dir"] as string | undefined,
				"no-save": values["no-save"] as boolean,
				pretty,
			});
			break;
		}
		case "contacts": {
			let values: Record<string, unknown>;
			try {
				const parsed = parseArgs({
					args: rest,
					strict: true,
					options: {
						limit: { type: "string" },
						pretty: { type: "boolean", default: false },
					},
				});
				values = parsed.values as Record<string, unknown>;
			} catch (err) {
				throw new SkillError(
					"UNKNOWN_FLAG",
					String(err instanceof Error ? err.message : err),
					'Run "help" command to see available options',
					EXIT.INVALID_ARGS,
				);
			}

			const limit = values.limit
				? validateLimit(values.limit as string)
				: undefined;
			queryContacts({ limit, pretty: values.pretty as boolean });
			break;
		}
		case "threads": {
			let values: Record<string, unknown>;
			try {
				const parsed = parseArgs({
					args: rest,
					strict: true,
					options: {
						contact: { type: "string" },
						limit: { type: "string" },
						pretty: { type: "boolean", default: false },
					},
				});
				values = parsed.values as Record<string, unknown>;
			} catch (err) {
				throw new SkillError(
					"UNKNOWN_FLAG",
					String(err instanceof Error ? err.message : err),
					'Run "help" command to see available options',
					EXIT.INVALID_ARGS,
				);
			}

			const limit = values.limit
				? validateLimit(values.limit as string)
				: undefined;
			queryThreads({
				contact: values.contact as string | undefined,
				limit,
				pretty: values.pretty as boolean,
			});
			break;
		}
		case "schema": {
			let pretty = false;
			try {
				const parsed = parseArgs({
					args: rest,
					strict: true,
					options: { pretty: { type: "boolean", default: false } },
				});
				pretty = parsed.values.pretty as boolean;
			} catch (err) {
				throw new SkillError(
					"UNKNOWN_FLAG",
					String(err instanceof Error ? err.message : err),
					'Run "help" command to see available options',
					EXIT.INVALID_ARGS,
				);
			}
			showSchema(pretty);
			break;
		}
		case "help":
		case "--help":
		case "-h":
		case undefined: {
			let pretty = false;
			try {
				const parsed = parseArgs({
					args: command == null ? process.argv.slice(2) : rest,
					strict: true,
					options: { pretty: { type: "boolean", default: false } },
				});
				pretty = parsed.values.pretty as boolean;
			} catch (err) {
				throw new SkillError(
					"UNKNOWN_FLAG",
					String(err instanceof Error ? err.message : err),
					'Run "help" command to see available options',
					EXIT.INVALID_ARGS,
				);
			}
			showHelp(pretty);
			break;
		}
		default:
			throw new SkillError(
				"UNKNOWN_COMMAND",
				`Unknown command: ${command}`,
				"Available commands: messages, contacts, threads, schema, help",
				EXIT.INVALID_ARGS,
			);
	}
} catch (err) {
	if (err instanceof SkillError) {
		err.emit();
	}
	// Unexpected error — wrap in structured output
	const message = err instanceof Error ? err.message : String(err);
	console.log(
		JSON.stringify({
			schema_version: SCHEMA_VERSION,
			error: true,
			code: "UNKNOWN_ERROR",
			message,
			hint: "Unexpected error — check the stack trace in stderr",
		}),
	);
	if (err instanceof Error && err.stack) console.error(err.stack);
	process.exit(EXIT.UNKNOWN_ERROR);
}
