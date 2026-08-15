import { basename } from "node:path";

/** Exact Google identity read from the owning productivity config. */
export interface GmailIdentity {
	/** Gmail account passed to every gog command. */
	account: string;
	/** Named OAuth client passed to every gog command. */
	client: string;
}

/** Usage error that stops before Gmail access. */
export class AuditUsageError extends Error {}

/**
 * Read and validate the explicit productivity config before Google dispatch.
 *
 * @param configPath - Path to the applicable `.productivity.yml`
 * @returns Exact account and OAuth client scalars
 * @throws {AuditUsageError} When identity is missing or ambiguous
 *
 * @example
 * ```typescript
 * const identity = await readGmailIdentity("./.productivity.yml")
 * ```
 */
export async function readGmailIdentity(configPath: string): Promise<GmailIdentity> {
	if (basename(configPath) !== ".productivity.yml") {
		throw new AuditUsageError("--config must name an explicit .productivity.yml file");
	}
	let parsed: unknown;
	try {
		parsed = Bun.YAML.parse(await Bun.file(configPath).text());
	} catch {
		throw new AuditUsageError("Unable to read a valid .productivity.yml");
	}
	if (!isRecord(parsed)) throw new AuditUsageError(".productivity.yml must contain a mapping");
	if (!isRecord(parsed.connectors)) {
		throw new AuditUsageError(".productivity.yml needs one connectors mapping");
	}
	const account = requireScalar(parsed.connectors, "email-account");
	const client = requireScalar(parsed.connectors, "email-client");
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) {
		throw new AuditUsageError("email-account is not an exact email address");
	}
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(client)) {
		throw new AuditUsageError("email-client is not an exact gog client name");
	}
	return { account, client };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireScalar(config: Record<string, unknown>, key: "email-account" | "email-client"): string {
	const value = config[key];
	if (typeof value !== "string" || value.trim() === "") {
		throw new AuditUsageError(`.productivity.yml needs one scalar connectors.${key}`);
	}
	return value;
}
