const SECRET_PATTERNS: RegExp[] = [
	/-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
	/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
	/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
	/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
	/\bnpm_[A-Za-z0-9]{20,}\b/g,
	/\bglpat-[A-Za-z0-9_-]{20,}\b/g,
	/\bsk-[A-Za-z0-9_-]{20,}\b/g,
	/\bAKIA[A-Z0-9]{16}\b/g,
	/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
	/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
	/\b(?:authorization|proxy-authorization)["']?\s*[:=]\s*[^\r\n]+/gi,
	/\b(?:cookie|set-cookie)["']?\s*:\s*[^\r\n]+/gi,
	/\b(?:password|passwd|passphrase|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?token|client[_-]?secret|secret[_-]?(?:access[_-]?)?key)["']?\s*[:=]\s*(?:["'][^"'\r\n]{8,}["']|[^\s,;]{8,})/gi,
	/https?:\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/g,
	/\/(?:Users|home)\/[^/\s]+(?:\/[^\s"'<>),;]*)?/g,
	/\b[A-Za-z]:\\Users\\[^\\\s]+(?:\\[^\s"'<>),;]*)?/g,
]

/**
 * Replace common credential shapes before historical prose leaves the runtime.
 *
 * @param text - Normalized historical message text
 * @returns Redacted text and substitution count
 *
 * @example
 * ```ts
 * const safe = redactSessionText(message.text)
 * ```
 */
export function redactSessionText(text: string): {
	text: string
	redactions: number
} {
	let value = text
	let redactions = 0
	for (const pattern of SECRET_PATTERNS) {
		pattern.lastIndex = 0
		value = value.replace(pattern, () => {
			redactions += 1
			return "[REDACTED]"
		})
	}
	return { text: value, redactions }
}
