/**
 * Shared YAML scalar quoter for runtime renderers (`ledger.ts`,
 * `ledger-init.ts`, `packets.ts`). Returns a double-quoted YAML scalar with
 * the minimal escape set that keeps hostile values parseable through
 * `Bun.YAML.parse` and other strict YAML 1.2 parsers.
 *
 * Hostile-value coverage was carried over from the Issue-90 ledger learnings:
 * NUL, control characters, embedded quotes, embedded newlines, embedded
 * fence sequences, mapping-key escapes, and numeric coercion all round-trip
 * through this helper without breaking surrounding YAML structure.
 *
 * The output is always double-quoted; pass the result of this function in
 * any position where a YAML scalar is expected. For mapping value
 * positions where the value is `null`, render the literal `null` separately
 * — this helper is for *string* scalars only.
 */
export function quoteYamlScalar(value: string): string {
  let escaped = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\\") escaped += "\\\\";
    else if (ch === '"') escaped += '\\"';
    else if (ch === "\n") escaped += "\\n";
    else if (ch === "\r") escaped += "\\r";
    else if (ch === "\t") escaped += "\\t";
    else if (code < 0x20 || code === 0x7f) {
      escaped += `\\x${code.toString(16).padStart(2, "0")}`;
    } else {
      escaped += ch;
    }
  }
  return `"${escaped}"`;
}

/**
 * Render a list of string scalars as a single-line flow YAML sequence,
 * quoting each element via {@link quoteYamlScalar}. Empty list yields
 * `[]`.
 */
export function quoteYamlScalarList(values: readonly string[]): string {
  if (values.length === 0) return "[]";
  return `[${values.map((v) => quoteYamlScalar(v)).join(", ")}]`;
}
