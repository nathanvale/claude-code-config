import { homedir } from "node:os";
import { join } from "node:path";
import type { Credentials } from "./model.ts";

const DEFAULT_WRAPPER = join(
	homedir(),
	"code",
	"dotfiles",
	"bin",
	"with-one-password-token",
);
const DEFAULT_VAULT = "API Credentials";
const DEFAULT_ITEM = "BFT / Glofox";
const CREDENTIAL_PROCESS_TIMEOUT_MS = 15_000;

interface OpField {
	label?: string;
	value?: string;
	purpose?: string;
}

interface OpItem {
	fields?: OpField[];
}

/** Error raised when the local secret-provider contract is incomplete. */
export class CredentialError extends Error {}

function normalizeLabel(value: string | undefined): string {
	return (value ?? "")
		.trim()
		.toLowerCase()
		.replaceAll(/[\s-]+/g, "_");
}

function valueFor(fields: OpField[], labels: string[]): string | undefined {
	for (const field of fields) {
		const normalized = normalizeLabel(field.label);
		const purpose = normalizeLabel(field.purpose);
		if (
			labels.includes(normalized) ||
			labels.includes(purpose) ||
			(labels.includes("login") && purpose === "username")
		) {
			const value = field.value?.trim();
			if (value) return value;
		}
	}
	return undefined;
}

function safeProcessEnvironment(): Record<string, string> {
	const allowed = ["HOME", "PATH", "TMPDIR", "USER", "LOGNAME", "SHELL", "LANG"];
	return Object.fromEntries(
		allowed.flatMap((key) => {
			const value = process.env[key];
			return value ? [[key, value]] : [];
		}),
	);
}

/**
 * Convert one exact 1Password item into the private login contract.
 *
 * @param input - Parsed item JSON returned by the official 1Password CLI
 * @param item - Non-secret item name used only in repair messages
 * @returns Validated credentials held in process memory
 * @throws {CredentialError} When required fields are missing
 *
 * @example
 * ```ts
 * const credentials = credentialsFromItem(itemJson, "BFT / Glofox")
 * ```
 */
export function credentialsFromItem(input: unknown, item: string): Credentials {
	const parsed = input as OpItem;
	const fields = Array.isArray(parsed?.fields) ? parsed.fields : [];
	const login = valueFor(fields, ["login", "username", "email"]);
	const password = valueFor(fields, ["password"]);
	const branchId = valueFor(fields, ["branch_id", "branch"]);
	const namespace = valueFor(fields, ["namespace"]);
	const device = valueFor(fields, ["device"]) ?? "ios";
	const headers = Object.fromEntries(
		fields.flatMap((field) => {
			const label = field.label?.trim().toLowerCase();
			const value = field.value?.trim();
			return (label?.startsWith("x-glofox-") || label === "x-api-key") &&
				value
				? [[label, value]]
				: [];
		}),
	);
	const missing = [
		!login && "login",
		!password && "password",
		!branchId && "branch_id",
		!namespace && "namespace",
		Object.keys(headers).length === 0 &&
			"at least one x-glofox-* or x-api-key field",
	].filter(Boolean);
	if (missing.length > 0) {
		throw new CredentialError(
			`1Password item "${item}" is missing: ${missing.join(", ")}.`,
		);
	}
	return {
		login: login as string,
		password: password as string,
		branchId: branchId as string,
		namespace: namespace as string,
		headers,
		device,
	};
}

/**
 * Read the exact BFT credential item through the managed 1Password token wrapper.
 *
 * @returns Login material held only in process memory
 * @throws {CredentialError} When the wrapper, item, or required fields are missing
 *
 * @example
 * ```ts
 * const credentials = await loadCredentials()
 * ```
 */
export async function loadCredentials(): Promise<Credentials> {
	const wrapper = process.env.BFT_OP_WRAPPER ?? DEFAULT_WRAPPER;
	const vault = process.env.BFT_OP_VAULT ?? DEFAULT_VAULT;
	const item = process.env.BFT_OP_ITEM ?? DEFAULT_ITEM;
	const processHandle = Bun.spawn(
		[
			wrapper,
			"op",
			"item",
			"get",
			item,
			"--vault",
			vault,
			"--format",
			"json",
		],
		{
			env: safeProcessEnvironment(),
			stdout: "pipe",
			stderr: "pipe",
			timeout: CREDENTIAL_PROCESS_TIMEOUT_MS,
		},
	);
	const [exitCode, stdout] = await Promise.all([
		processHandle.exited,
		new Response(processHandle.stdout).text(),
	]);
	if (exitCode !== 0) {
		throw new CredentialError(
			`Cannot read the declared 1Password item "${item}" from "${vault}".`,
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout) as unknown;
	} catch {
		throw new CredentialError("1Password returned unreadable item data.");
	}
	return credentialsFromItem(parsed, item);
}

/** Return non-secret credential-provider metadata for doctor output. */
export function credentialProviderMetadata(): {
	item: string;
	vault: string;
	wrapper: string;
	required_fields: string[];
} {
	return {
		item: process.env.BFT_OP_ITEM ?? DEFAULT_ITEM,
		vault: process.env.BFT_OP_VAULT ?? DEFAULT_VAULT,
		wrapper: process.env.BFT_OP_WRAPPER ?? DEFAULT_WRAPPER,
		required_fields: [
			"login",
			"password",
			"branch_id",
			"namespace",
			"x-glofox-* or x-api-key",
		],
	};
}
