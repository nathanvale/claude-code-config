/** Stable command names exposed by the BFT CLI. */
export type CommandName =
	| "commands"
	| "doctor"
	| "sessions"
	| "bookings"
	| "book"
	| "cancel";

/** Failure groups used by agents to choose a safe repair. */
export type ErrorCategory =
	| "usage"
	| "dependency"
	| "authentication"
	| "network"
	| "not-found"
	| "conflict"
	| "uncertain-mutation"
	| "remote";

/** Machine-readable failure with an explicit recovery path. */
export interface CommandError {
	category: ErrorCategory;
	message: string;
	next: string;
}

/** Common envelope for every JSON command result. */
export interface CommandResult<T> {
	ok: boolean;
	command: CommandName;
	run_id: string;
	changed: boolean;
	retry_safe: boolean;
	data?: T;
	error?: CommandError;
}

/** Normalized class session shown by the CLI. */
export interface Session {
	id: string;
	name: string;
	start_at: string;
	end_at?: string;
	trainer?: string;
	capacity?: number;
	booked?: number;
	available?: number;
	waitlist_count?: number;
	waitlist_available?: boolean;
	full: boolean;
}

/** Normalized existing booking shown by the CLI. */
export interface Booking {
	id: string;
	session_id?: string;
	name: string;
	start_at?: string;
	status?: string;
	waitlisted: boolean;
}

/** 1Password-backed material required for a short-lived login. */
export interface Credentials {
	login: string;
	password: string;
	branchId: string;
	namespace: string;
	headers: Record<string, string>;
	device: string;
}

/** API access token held only in process memory. */
export interface AuthSession {
	token: string;
	branchId: string;
	namespace: string;
	headers: Record<string, string>;
}

/** CLI arguments after deterministic parsing. */
export interface ParsedArgs {
	command?: CommandName;
	json: boolean;
	help: boolean;
	execute: boolean;
	joinWaitlist: boolean;
	date?: string;
	days: number;
	sessionId?: string;
	bookingId?: string;
}
