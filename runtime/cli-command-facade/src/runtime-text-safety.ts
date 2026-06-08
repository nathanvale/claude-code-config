/**
 * Validate an optional public-safe docs pointer (Agent Hint or Runtime Action
 * Guidance). Same transport and host policy for both surfaces (KTD6): a
 * non-empty absolute http/https URL with no credentials and no public-unsafe
 * host. `path` selects the issue prefix so callers report against their own field.
 */
export function validateOptionalDocsUrl(
	path: string,
	value: unknown,
): string[] {
	if (typeof value !== "string" || value.trim() === "") {
		return [`${path} must be a non-empty string`];
	}
	return [
		...validatePublicSafeDocsUrl(path, value),
		...validateSafeRuntimeText(path, value),
	];
}

const RUNTIME_CONTRACT_UNSAFE_TEXT_PATTERNS = [
	{
		label: "credential",
		pattern:
			/(password|secret|credential|api[-_ ]?key|client[-_ ]?secret|authorization|bearer\s+\S+)/i,
	},
	{
		label: "cookie-session",
		pattern: /(cookie|session[-_ ]?id|session[-_ ]?token)/i,
	},
	{
		label: "tenant-or-account",
		pattern:
			/(tenant[-_ ]?id|tenant_[A-Za-z0-9]+|account[-_ ]?id|account_[A-Za-z0-9]+|payment[-_ ]?account|payment_account_[A-Za-z0-9]+)/i,
	},
	{
		label: "local-path",
		pattern: /(^|\s)(\/Users\/|\/private\/|\/tmp\/|[A-Za-z]:\\)/,
	},
	{
		label: "browser-debugger-url",
		pattern: /\b(wss?|https?):\/\/(?:127\.0\.0\.1|localhost):\d+\/devtools\//i,
	},
	{ label: "op-secret-ref", pattern: /op:\/\//i },
	{
		label: "scope",
		pattern: /\b(scope|required scope|scopeRequired|scopeMissing)\b/i,
	},
	{
		label: "command-example",
		pattern: /(^|\s)(bun|npm|npx|pnpm|yarn|node|python|python3|curl|git)\s+\S/i,
	},
] as const;

/**
 * Control characters that must never reach the agent-facing discovery tree.
 *
 * Allows the benign whitespace help text legitimately uses (`\t` 0x09,
 * `\n` 0x0A); rejects every other C0 control (`\x00-\x1F`, covers ESC 0x1B that
 * starts ANSI escapes, NUL 0x00, BEL 0x07), DEL (`\x7F`), the Unicode bidi
 * directional formatting characters — both the implicit marks (LRM/RLM
 * `‎-‏`) and the explicit embeddings/overrides/isolates
 * (LRE/RLE/PDF/LRO/RLO `‪-‮`, LRI/RLI/FSI/PDI `⁦-⁩`) — that can visually
 * reorder text to hide payloads, the line/paragraph separators (LS ``,
 * PS ``) that act as invisible newlines, and the BOM/ZWNBSP (`﻿`).
 */
const CONTROL_CHAR_PATTERN =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately scanning for control characters in projected free-text values.
	/[\x00-\x08\x0B-\x1F\x7F‎‏‪-‮\u2028\u2029⁦-⁩﻿]/;

/**
 * Scan a projected free-text VALUE for unsafe content, in order (KTD4):
 *   1. non-string reject (R5) — `validateSafeRuntimeText` early-returns on
 *      non-strings, so an explicit type guard is required here;
 *   2. control-char reject (R4);
 *   3. unsafe runtime-contract pattern scan (R1) via `validateSafeRuntimeText`.
 * Steps 1 and 2 short-circuit (each returns exactly one issue and skips the
 * rest), so a value never stacks a type/control-char reject on top of a pattern
 * hit. Step 3 may return more than one issue: a value matching several unsafe
 * patterns (e.g. credential AND local-path) reports each, which is the more
 * useful signal for the author.
 * Returns issue strings mirroring `validateSafeRuntimeText`'s `string[]` shape;
 * empty array means clean. Optional-field absence is the caller's concern: pass
 * a present value only when it should be scanned.
 */
export function validateProjectedFreeText(
	path: string,
	value: unknown,
): string[] {
	if (typeof value !== "string") {
		return [`${path} must be a string, not ${typeof value}`];
	}
	if (CONTROL_CHAR_PATTERN.test(value)) {
		return [`${path} contains control characters`];
	}
	return validateSafeRuntimeText(path, value);
}

export function validateNonEmptyString(path: string, value: unknown): string[] {
	if (typeof value !== "string" || value.trim().length === 0) {
		return [`${path} must be a non-empty string`];
	}
	return validateSafeRuntimeText(path, value);
}

/**
 * Validate a required, agent-facing free-text VALUE: non-empty plus the full
 * projected-free-text scan (control chars, bidi/ANSI, and the unsafe
 * runtime-contract patterns). Use this — not {@link validateNonEmptyString} —
 * for any string that is projected to an agent, so it inherits the same
 * control-char gate every other projected field enforces via
 * {@link validateProjectedFreeText}. The non-empty guard short-circuits so a
 * blank value reports exactly one issue instead of stacking a control-char or
 * pattern hit on top.
 */
export function validateNonEmptyProjectedText(
	path: string,
	value: unknown,
): string[] {
	if (typeof value !== "string" || value.trim().length === 0) {
		return [`${path} must be a non-empty string`];
	}
	return validateProjectedFreeText(path, value);
}

export const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Sensitive SCREAMING_SNAKE_CASE segments that imply a secret. This is a
 * NAME gate, distinct from {@link validateSafeRuntimeText} (a free-text VALUE
 * scanner). Two concerns, two owners: the value scanner misses `API_TOKEN`/
 * `PRIVATE_KEY`/`GH_PAT` and falsely rejects `TENANT_ID`/`OAUTH_SCOPE`.
 */
const SENSITIVE_ENV_VAR_NAME_SEGMENTS = new Set<string>([
	"SECRET",
	"TOKEN",
	"PASSWORD",
	"PASSWD",
	"PASSPHRASE",
	"KEY",
	"CREDENTIAL",
	"CREDENTIALS",
	"PRIVATE",
	"AUTH",
	"BEARER",
	"PAT",
	"APIKEY",
	"SESSION",
]);

/**
 * Vendor/qualifier prefixes that commonly fuse with a secret noun in an
 * underscore-less name (`API` + `TOKEN`, `GH` + `PAT`). Used by
 * {@link matchSensitiveEnvVarName} to anchor the fused-segment scan: the secret
 * token must sit against a recognized prefix, never arbitrary leading letters.
 * This is the tuning surface — small and secret-fusion-specific, NOT a list of
 * fused compounds. Every addition must be re-run against the benign fixture set.
 */
const KNOWN_FUSED_PREFIXES = new Set<string>([
	"API",
	"GH",
	"DB",
	"MY",
	"ACCESS",
	"CLIENT",
	"APP",
	"USER",
	"SERVICE",
	"REFRESH",
]);

/**
 * True when an env-var NAME implies a secret. Splits on `_` and tests each
 * segment via {@link matchSensitiveSegment}, which fires on either:
 * (a) segment equality with a sensitive token (`GH_PAT`, `API_TOKEN`); or
 * (b) bounded fused decomposition — a known prefix plus a token (`APITOKEN` →
 *     `API` + `TOKEN`), or two adjacent tokens (`SECRETKEY` → `SECRET` + `KEY`).
 *
 * Branch (b) narrows the underscore-less SUFFIX-fused evasion where the secret
 * noun trails (#63): it catches names anchored to a recognized prefix or a
 * second token (`APITOKEN`, `SECRETKEY`). It is deliberately NOT a bare
 * substring/`endsWith` scan: that would false-reject benign names whose segment
 * ends with a token by coincidence (`MONKEY_CONFIG`→KEY, `OBSESSION_FLAG`→
 * SESSION, `OAUTH_SCOPE`→AUTH). The prefix anchor keeps those passing.
 *
 * Residual blind spots (all project; tracked as follow-up, NOT full closure):
 * - SUFFIX-fused with an UNLISTED prefix — a vendor prefix absent from
 *   {@link KNOWN_FUSED_PREFIXES} (`XEROSECRET`, `STRIPETOKEN`, `NPMTOKEN`).
 * - SUFFIX-fused with a COMPOUND prefix — the single strip does not recurse,
 *   so stacked qualifiers escape (`APIACCESSTOKEN` → head `APIACCESS` matches
 *   neither a prefix nor a token).
 * - PREFIX-fused where the noun LEADS (`TOKENFILE`, `KEYSTORE`, `AUTHHEADER`).
 *
 * Widening any of these trades against new false-positives (branch (b) already
 * fail-closes benign-ish names like `APPKEY`/`APPSESSION`); the prefix set is
 * the tuning surface. Distinct from the `AUTH_REGION` over-reject (benign
 * `AUTH`-segment names wrongly rejected by branch (a)), owned by #68.
 */
export function matchSensitiveEnvVarName(name: string): boolean {
	return name.split("_").some(matchSensitiveSegment);
}

/**
 * True when one underscore segment implies a secret, by either branch:
 * (a) the segment equals a sensitive token (`TOKEN`, `PAT`); or
 * (b) the segment decomposes into a known prefix followed by a sensitive token
 *     (`API` + `TOKEN`), or into two adjacent sensitive tokens (`SECRET` + `KEY`).
 * Branch (b) is anchored to {@link KNOWN_FUSED_PREFIXES} or another token, so a
 * benign segment that merely ends in a token by coincidence (`MONKEY` → `KEY`,
 * `OBSESSION` → `SESSION`, `OAUTH` → `AUTH`) is not matched.
 */
function matchSensitiveSegment(segment: string): boolean {
	if (SENSITIVE_ENV_VAR_NAME_SEGMENTS.has(segment)) return true;
	for (const token of SENSITIVE_ENV_VAR_NAME_SEGMENTS) {
		if (segment === token || !segment.endsWith(token)) continue;
		const head = segment.slice(0, segment.length - token.length);
		if (head === "") continue;
		if (KNOWN_FUSED_PREFIXES.has(head)) return true;
		if (SENSITIVE_ENV_VAR_NAME_SEGMENTS.has(head)) return true;
	}
	return false;
}

function validateSafeRuntimeText(path: string, value: unknown): string[] {
	if (typeof value !== "string") return [];
	const issues: string[] = [];
	for (const { label, pattern } of RUNTIME_CONTRACT_UNSAFE_TEXT_PATTERNS) {
		if (pattern.test(value)) {
			issues.push(`${path} includes unsafe runtime-contract text: ${label}`);
		}
	}
	return issues;
}

function validatePublicSafeDocsUrl(path: string, value: string): string[] {
	const issues: string[] = [];
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return [`${path} must be an absolute public URL`];
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		issues.push(`${path} must use http or https`);
	}
	if (url.username || url.password) {
		issues.push(`${path} must not include credentials`);
	}
	if (isPublicUnsafeHostname(url.hostname)) {
		issues.push(`${path} must not point at a non-public host`);
	}
	return issues;
}

/**
 * True when a hostname is not safe to project to an agent because it targets
 * the local host or a non-public network: loopback (`localhost`, `127.0.0.0/8`,
 * `0.0.0.0/8`, IPv6 `::1`), link-local (`169.254.0.0/16` including the
 * `169.254.169.254` cloud metadata service, IPv6 `fe80::/10`), or private
 * ranges (`10/8`, `172.16/12`, `192.168/16`, IPv6 ULA `fc00::/7`). A docs
 * pointer that resolves to any of these leaks internal topology and cannot
 * help a fresh agent recover.
 *
 * IPv6 is treated as unsafe-by-default: a bracketed/colon host is only public
 * if it is a parseable address outside every blocked range. Node's WHATWG URL
 * parser already canonicalizes alternate IPv4 encodings (`2130706433`,
 * `0x7f.0.0.1`, `127.1`) to dotted-quad before this runs, so only the
 * canonical forms need range checks.
 */
function isPublicUnsafeHostname(hostname: string): boolean {
	const host = hostname
		.toLowerCase()
		.replace(/^\[|\]$/g, "")
		.replace(/\.$/, "");
	if (host === "localhost") return true;
	if (host.includes(":")) return isUnsafeIpv6(host);
	const octets = host.split(".");
	if (octets.length !== 4 || !octets.every((o) => /^\d{1,3}$/.test(o))) {
		return false;
	}
	const a = Number(octets[0]);
	const b = Number(octets[1]);
	if (a === 0) return true;
	if (a === 127) return true;
	if (a === 10) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	return false;
}

/**
 * Classify an IPv6 literal (brackets already stripped) as unsafe. Unsafe-by-
 * default: loopback `::1`, unspecified `::`, link-local `fe80::/10`, ULA
 * `fc00::/7`, and any IPv4-mapped `::ffff:*` address. The WHATWG URL parser
 * canonicalizes a mapped IPv4 to compressed hex (`::ffff:127.0.0.1` ->
 * `::ffff:7f00:1`), so the whole `::ffff:` prefix is rejected rather than
 * re-parsing the embedded IPv4 — a public docs URL has no reason to use a
 * mapped-IPv4 literal, and rejecting it keeps the allowlist conservative.
 * Any other literal is treated as public.
 */
function isUnsafeIpv6(host: string): boolean {
	if (host === "::1" || host === "::") return true;
	if (host.startsWith("::ffff:")) return true;
	if (/^fe[89ab][0-9a-f]?:/.test(host)) return true;
	if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
	return false;
}

const FAILURE_DOMAIN_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/**
 * Validate a package-owned `failure_domain` routing label (KTD5): packages own
 * the values themselves (`browser_entry`, `profile`, `listener`, …); the facade
 * only checks the spelling. The lower_snake_case pattern already excludes every
 * character {@link validateSafeRuntimeText} flags (no whitespace, control
 * chars, colons, slashes, or punctuation), so a label that passes the pattern
 * cannot carry unsafe runtime-contract text — the spelling check is the gate.
 */
export function validateFailureDomain(value: unknown): string[] {
	if (typeof value !== "string" || !FAILURE_DOMAIN_PATTERN.test(value)) {
		return [
			"error.failure_domain must be a lower_snake_case package-owned label",
		];
	}
	return [];
}
