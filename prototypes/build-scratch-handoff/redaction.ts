// PROTOTYPE — throwaway. Pure Gate 2 deny-list (no I/O, no terminal codes).
//
// Gate 2: redact-on-build, FAIL-CLOSED. A single hit on either detector refuses
// the WHOLE batch and names the offending entry. This is the second net for
// anything Gate 1 (browser-use, "return shape only") missed. Decision F.
//
// Placeholder vocab follows one-password: shape, not value
// (e.g. redacted:password-field), never the secret itself.

/** A field-name pattern indicates the field is sensitive by what it's called. */
const FIELD_NAME_PATTERNS: RegExp[] = [
  /password/i,
  /token/i,
  /secret/i,
  /\bkey\b/i,
  /credential/i,
  /otp/i,
  /mfa/i,
];

/** A value-shape pattern indicates the value itself looks like a secret. */
const VALUE_SHAPE_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "bearer/api-token", re: /\b(?:sk|pk|bearer|ghp|xox[baprs])[-_][A-Za-z0-9]{8,}\b/ },
  { label: "long-hex", re: /\b[0-9a-f]{32,}\b/i },
  { label: "base64-blob", re: /\b[A-Za-z0-9+/]{40,}={0,2}\b/ },
  { label: "6-digit-otp", re: /^\s*\d{6}\s*$/ },
];

/** A value-shape placeholder is an already-redacted Gate 1 output — let it pass. */
const REDACTED_PLACEHOLDER = /^redacted:/;

export interface DenyHit {
  /** Which field tripped the gate. */
  field: string;
  /** "field-name" (called something sensitive) or "value-shape" (looks secret). */
  detector: "field-name" | "value-shape";
  /** Human-readable reason (pattern label), never the offending value. */
  reason: string;
}

export type GateResult =
  | { ok: true }
  | { ok: false; hit: DenyHit };

/**
 * Run Gate 2 over a list of (fieldName, value) entries. Returns the FIRST hit
 * and stops — fail-closed means one hit refuses the whole batch, so there's no
 * value in enumerating the rest. The caller refuses the entire build on !ok.
 */
export function gate2(entries: { name: string; value: string }[]): GateResult {
  for (const { name, value } of entries) {
    // Already-redacted Gate 1 placeholders are the safe case — skip them.
    if (REDACTED_PLACEHOLDER.test(value)) continue;

    for (const re of FIELD_NAME_PATTERNS) {
      if (re.test(name)) {
        return {
          ok: false,
          hit: { field: name, detector: "field-name", reason: `name matches /${re.source}/${re.flags}` },
        };
      }
    }

    for (const { label, re } of VALUE_SHAPE_PATTERNS) {
      if (re.test(value)) {
        return {
          ok: false,
          hit: { field: name, detector: "value-shape", reason: `value matches ${label}` },
        };
      }
    }
  }
  return { ok: true };
}

/** Replace a sensitive value with a shape placeholder (Gate 1-style vocab). */
export function placeholderFor(fieldName: string): string {
  const n = fieldName.toLowerCase();
  if (/password/.test(n)) return "redacted:password-field";
  if (/token|key|secret|credential/.test(n)) return "redacted:token-field";
  if (/otp|mfa|verif/.test(n)) return "redacted:otp-field";
  if (/card/.test(n)) return "redacted:card-field";
  return "redacted:sensitive-field";
}
