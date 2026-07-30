#!/usr/bin/env bun

import { existsSync } from "node:fs";

import {
	CredentialError,
	credentialProviderMetadata,
	loadCredentials,
} from "./credentials.ts";
import {
	GlofoxError,
	cancelBooking,
	createBooking,
	listBookings,
	listSessions,
	login,
} from "./glofox-client.ts";
import type {
	AuthSession,
	Booking,
	CommandError,
	CommandName,
	CommandResult,
	Credentials,
	ParsedArgs,
	Session,
} from "./model.ts";

const COMMANDS: CommandName[] = [
	"commands",
	"doctor",
	"sessions",
	"bookings",
	"book",
	"cancel",
];

export interface BftRuntime {
	now: () => Date;
	loadCredentials: () => Promise<Credentials>;
	login: (credentials: Credentials) => Promise<AuthSession>;
	listSessions: (
		auth: AuthSession,
		from: string,
		to: string,
	) => Promise<Session[]>;
	listBookings: (auth: AuthSession) => Promise<Booking[]>;
	createBooking: (
		auth: AuthSession,
		sessionId: string,
		joinWaitlist: boolean,
	) => Promise<unknown>;
	cancelBooking: (auth: AuthSession, bookingId: string) => Promise<unknown>;
}

const LIVE_RUNTIME: BftRuntime = {
	now: () => new Date(),
	loadCredentials,
	login,
	listSessions,
	listBookings,
	createBooking,
	cancelBooking,
};

const HELP = `bft-booking

View BFT classes and manage Glofox bookings.

Usage:
  bft-booking commands [--json]
  bft-booking doctor [--json]
  bft-booking sessions [--date YYYY-MM-DD|today|tomorrow] [--days N] [--json]
  bft-booking bookings [--json]
  bft-booking book --session-id ID [--join-waitlist] [--execute] [--json]
  bft-booking cancel --booking-id ID [--execute] [--json]

Safety:
  book and cancel preview by default. State changes require --execute.
  After an uncertain mutation, run bookings before any retry.

Credential provider:
  Managed wrapper: reported by doctor --json
  Default vault: API Credentials
  Default item: BFT / Glofox
  Required item fields: login, password, branch_id, namespace, x-glofox-* or x-api-key
  Override metadata only with BFT_OP_WRAPPER, BFT_OP_VAULT, BFT_OP_ITEM.
  Never pass secret values as arguments or environment variables.
`;

class UsageError extends Error {}

function parsePositiveInteger(raw: string, flag: string): number {
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1 || value > 31) {
		throw new UsageError(`${flag} must be an integer from 1 to 31.`);
	}
	return value;
}

function requiredValue(argv: string[], index: number, flag: string): string {
	const value = argv[index + 1];
	if (!value || value.startsWith("-")) {
		throw new UsageError(`${flag} needs a value.`);
	}
	return value;
}

function applyArgument(
	parsed: ParsedArgs,
	argv: string[],
	index: number,
): number {
	const argument = argv[index];
	if (argument === "--json") parsed.json = true;
	else if (argument === "--help" || argument === "-h") parsed.help = true;
	else if (argument === "--execute") parsed.execute = true;
	else if (argument === "--join-waitlist") parsed.joinWaitlist = true;
	else if (argument === "--date") {
		parsed.date = requiredValue(argv, index, argument);
		return index + 1;
	} else if (argument === "--days") {
		parsed.days = parsePositiveInteger(
			requiredValue(argv, index, argument),
			argument,
		);
		return index + 1;
	} else if (argument === "--session-id") {
		parsed.sessionId = requiredValue(argv, index, argument);
		return index + 1;
	} else if (argument === "--booking-id") {
		parsed.bookingId = requiredValue(argv, index, argument);
		return index + 1;
	} else {
		throw new UsageError(`Unknown argument: ${argument}`);
	}
	return index;
}

function validateParsedArgs(parsed: ParsedArgs): void {
	const command = parsed.command ?? "";
	if (parsed.execute && !["book", "cancel"].includes(command)) {
		throw new UsageError("--execute is only valid for book or cancel.");
	}
	if (parsed.joinWaitlist && command !== "book") {
		throw new UsageError("--join-waitlist is only valid for book.");
	}
	if (parsed.sessionId && command !== "book") {
		throw new UsageError("--session-id is only valid for book.");
	}
	if (parsed.bookingId && command !== "cancel") {
		throw new UsageError("--booking-id is only valid for cancel.");
	}
	if ((parsed.date !== undefined || parsed.days !== undefined) && command !== "sessions") {
		throw new UsageError("--date and --days are only valid for sessions.");
	}
}

/** Parse the public command surface without hidden inference. */
export function parseArgs(argv: string[]): ParsedArgs {
	const parsed: ParsedArgs = {
		json: false,
		help: false,
		execute: false,
		joinWaitlist: false,
	};
	const command = argv[0];
	if (command && !command.startsWith("-")) {
		if (!COMMANDS.includes(command as CommandName)) {
			throw new UsageError(`Unknown command: ${command}`);
		}
		parsed.command = command as CommandName;
	}
	const startIndex = parsed.command ? 1 : 0;
	for (let index = startIndex; index < argv.length; index += 1) {
		index = applyArgument(parsed, argv, index);
	}
	validateParsedArgs(parsed);
	return parsed;
}

function melbourneDate(date: Date): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "Australia/Melbourne",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

function resolveDate(raw: string | undefined, now: Date): string {
	const today = melbourneDate(now);
	if (!raw || raw === "today") return today;
	if (raw === "tomorrow") return addDays(today, 1);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
		throw new UsageError("--date must be YYYY-MM-DD, today, or tomorrow.");
	}
	return raw;
}

function addDays(date: string, days: number): string {
	const [year, month, day] = date.split("-").map(Number);
	const start = new Date(Date.UTC(year, month - 1, day + days));
	return start.toISOString().slice(0, 10);
}

function result<T>(
	command: CommandName,
	data: T,
	options: { changed?: boolean; retrySafe?: boolean } = {},
): CommandResult<T> {
	return {
		ok: true,
		command,
		run_id: crypto.randomUUID(),
		changed: options.changed ?? false,
		retry_safe: options.retrySafe ?? true,
		data,
	};
}

function failure(
	command: CommandName,
	error: CommandError,
	options: { changed?: boolean; retrySafe?: boolean } = {},
): CommandResult<never> {
	return {
		ok: false,
		command,
		run_id: crypto.randomUUID(),
		changed: options.changed ?? false,
		retry_safe: options.retrySafe ?? true,
		error,
	};
}

function renderHuman(output: CommandResult<unknown>): string {
	if (!output.ok) {
		return `${output.error?.message}\nNext: ${output.error?.next}`;
	}
	const data = output.data;
	if (
		data &&
		typeof data === "object" &&
		"action" in data &&
		typeof data.action === "string"
	) {
		return `${data.action}${output.changed ? " completed" : " preview"}`;
	}
	return JSON.stringify(data, null, 2);
}

function commandMetadata() {
		return {
			commands: [
				{
					name: "commands",
					side_effect: "read",
					purpose: "Discover the command surface",
				},
				{ name: "doctor", side_effect: "read", purpose: "Check auth readiness" },
			{
				name: "sessions",
				side_effect: "read",
				purpose: "List classes and capacity",
			},
			{
				name: "bookings",
				side_effect: "read",
				purpose: "List current bookings",
			},
			{
				name: "book",
				side_effect: "preview unless --execute",
				purpose: "Book a class or join its waitlist",
			},
			{
				name: "cancel",
				side_effect: "preview unless --execute",
				purpose: "Cancel one exact booking",
			},
		],
	};
}

async function authenticated(runtime: BftRuntime) {
	return runtime.login(await runtime.loadCredentials());
}

async function runDoctor(runtime: BftRuntime): Promise<CommandResult<unknown>> {
	const metadata = credentialProviderMetadata();
	const dependency = {
		bun: typeof Bun !== "undefined",
		op: typeof Bun !== "undefined" && Boolean(Bun.which("op")),
		wrapper: existsSync(metadata.wrapper),
	};
	const missingDependencies = Object.entries(dependency)
		.filter(([, ready]) => !ready)
		.map(([name]) => name);
	if (missingDependencies.length > 0) {
		return failure("doctor", {
			category: "dependency",
			message: `Missing dependencies: ${missingDependencies.join(", ")}.`,
			next: "Repair the reported dependency state, then rerun doctor --json.",
		});
	}
	try {
		await authenticated(runtime);
		return result("doctor", {
			ready: true,
			dependency,
			credential_provider: metadata,
			authenticated: true,
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Authentication check failed.";
		return failure("doctor", {
			category: error instanceof CredentialError ? "authentication" : "remote",
			message,
			next:
				'Create or repair the declared 1Password item, then rerun "doctor --json".',
		});
	}
}

async function runSessions(
	args: ParsedArgs,
	auth: AuthSession,
	runtime: BftRuntime,
): Promise<CommandResult<unknown>> {
	const from = resolveDate(args.date, runtime.now());
	const to = addDays(from, args.days ?? 1);
	const sessions = await runtime.listSessions(auth, from, to);
	return result("sessions", { from, to, count: sessions.length, sessions });
}

async function runBookings(
	auth: AuthSession,
	runtime: BftRuntime,
): Promise<CommandResult<unknown>> {
	const bookings = await runtime.listBookings(auth);
	return result("bookings", { count: bookings.length, bookings });
}

function validateBookingPath(
	session: Session,
	joinWaitlist: boolean,
): CommandResult<never> | undefined {
	if (joinWaitlist && !session.full) {
		return failure("book", {
			category: "conflict",
			message: "The class is not full, so the waitlist path is invalid.",
			next: "Preview the same session without --join-waitlist.",
		});
	}
	if (joinWaitlist && session.waitlist_available === false) {
		return failure("book", {
			category: "conflict",
			message: "The class reports no available waitlist.",
			next: "Choose another class or check again later.",
		});
	}
	if (!joinWaitlist && session.full) {
		return failure("book", {
			category: "conflict",
			message: "The class is full; normal booking is blocked.",
			next:
				session.waitlist_available === false
					? "Choose another class."
					: "Preview again with --join-waitlist.",
		});
	}
	return undefined;
}

async function runBook(
	args: ParsedArgs,
	auth: AuthSession,
	runtime: BftRuntime,
): Promise<CommandResult<unknown>> {
	if (!args.sessionId) throw new UsageError("book requires --session-id ID.");
	const from = melbourneDate(runtime.now());
	const sessions = await runtime.listSessions(auth, from, addDays(from, 31));
	const session = sessions.find((candidate) => candidate.id === args.sessionId);
	if (!session) {
		return failure("book", {
			category: "not-found",
			message: "That session is not in the next 31 days.",
			next: 'Run "sessions --date today --days 31 --json" and choose an exact session ID.',
		});
	}
	const blocked = validateBookingPath(session, args.joinWaitlist);
	if (blocked) return blocked;
	const action = args.joinWaitlist ? "join-waitlist" : "book";
	if (!args.execute) {
		return result("book", {
			action,
			session,
			will_change: false,
			next: `Confirm the class, then rerun with --execute${
				args.joinWaitlist ? " --join-waitlist" : ""
			}.`,
		});
	}
	await runtime.createBooking(auth, args.sessionId, args.joinWaitlist);
	let bookings: Booking[];
	try {
		bookings = await runtime.listBookings(auth);
	} catch {
		throw new GlofoxError(
			"Booking request succeeded, but booking verification did not complete.",
			{ mutationMayHaveChangedState: true },
		);
	}
	const verified = bookings.some(
		(booking) => booking.session_id === args.sessionId,
	);
	if (!verified) {
		throw new GlofoxError(
			"Booking request succeeded, but the booking was not found during verification.",
			{ mutationMayHaveChangedState: true },
		);
	}
	return result(
		"book",
		{
			action,
			session,
				verified_in_bookings: true,
			bookings,
		},
		{ changed: true, retrySafe: false },
	);
}

async function runCancel(
	args: ParsedArgs,
	auth: AuthSession,
	runtime: BftRuntime,
): Promise<CommandResult<unknown>> {
	if (!args.bookingId)
		throw new UsageError("cancel requires --booking-id ID.");
	const before = await runtime.listBookings(auth);
	const target = before.find((booking) => booking.id === args.bookingId);
	if (!target) {
		return failure("cancel", {
			category: "not-found",
			message: "That booking is not in the current booking list.",
			next: 'Run "bookings --json" and choose an exact booking ID.',
		});
	}
	if (!args.execute) {
		return result("cancel", {
			action: "cancel",
			booking: target,
			will_change: false,
			next: "Confirm this booking, then rerun with --execute.",
		});
	}
	await runtime.cancelBooking(auth, args.bookingId);
	let after: Booking[];
	try {
		after = await runtime.listBookings(auth);
	} catch {
		throw new GlofoxError(
			"Cancellation succeeded, but booking verification did not complete.",
			{ mutationMayHaveChangedState: true },
		);
	}
	if (after.some((booking) => booking.id === args.bookingId)) {
		throw new GlofoxError(
			"Cancellation succeeded, but the booking remained during verification.",
			{ mutationMayHaveChangedState: true },
		);
	}
	return result(
		"cancel",
		{
			action: "cancel",
			booking: target,
			verified_absent: true,
			bookings: after,
		},
			{ changed: true, retrySafe: false },
		);
}

async function runCommand(
	args: ParsedArgs,
	runtime: BftRuntime,
): Promise<CommandResult<unknown>> {
	const command = args.command ?? "commands";
	if (command === "commands") return result(command, commandMetadata());
	if (command === "doctor") return runDoctor(runtime);
	const auth = await authenticated(runtime);
	if (command === "sessions") return runSessions(args, auth, runtime);
	if (command === "bookings") return runBookings(auth, runtime);
	if (command === "book") return runBook(args, auth, runtime);
	return runCancel(args, auth, runtime);
}

function commandFailure(
	command: CommandName,
	error: unknown,
): CommandResult<never> {
	if (error instanceof CredentialError) {
		return failure(command, {
			category: "authentication",
			message: error.message,
			next:
				'Create or repair the declared 1Password item, then run "doctor --json".',
		});
	}
	if (error instanceof GlofoxError) {
		const uncertain = error.mutationMayHaveChangedState;
		const authentication = error.status === 401 || error.status === 403;
		return failure(
			command,
			{
				category: uncertain
					? "uncertain-mutation"
					: authentication
						? "authentication"
						: error.status === 404
							? "not-found"
							: "remote",
				message: error.message,
				next: uncertain
					? 'Do not retry. Run "bookings --json" and reconcile the result.'
					: 'Run "doctor --json"; fix its reported state, then retry.',
			},
			{ changed: uncertain, retrySafe: !uncertain },
		);
	}
	if (error instanceof UsageError) {
		return failure(command, {
			category: "usage",
			message: error.message,
			next: 'Run "--help" and correct the arguments.',
		});
	}
	return failure(command, {
		category: "remote",
		message: "Unexpected BFT booking failure.",
		next: 'Run "doctor --json"; retry only after the cause is known.',
	});
}

/**
 * Run the CLI through the live runtime or a focused test seam.
 *
 * @param argv - Public command arguments without the executable name
 * @param runtime - API and credential operations; defaults to the live runtime
 * @returns Process exit code for the completed command
 *
 * @example
 * ```ts
 * const exitCode = await main(["commands", "--json"])
 * ```
 */
export async function main(
	argv = Bun.argv.slice(2),
	runtime: BftRuntime = LIVE_RUNTIME,
): Promise<number> {
	let parsed: ParsedArgs;
	try {
		parsed = parseArgs(argv);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Invalid usage.";
		if (argv.includes("--json")) {
			console.log(
				JSON.stringify(
					failure("commands", {
						category: "usage",
						message,
						next: "Run --help and correct the arguments.",
					}),
				),
			);
			return 2;
		}
		console.error(message);
		console.error("Run with --help for usage.");
		return 2;
	}
	if (parsed.help || !parsed.command) {
		console.log(HELP);
		return 0;
	}

	let output: CommandResult<unknown>;
	try {
		output = await runCommand(parsed, runtime);
	} catch (error) {
		output = commandFailure(parsed.command, error);
	}

	if (parsed.json) console.log(JSON.stringify(output));
	else if (output.ok) console.log(renderHuman(output));
	else console.error(renderHuman(output));
	if (output.ok) return 0;
	return output.error?.category === "usage" ? 2 : 1;
}

if (import.meta.main) {
	process.exitCode = await main();
}
