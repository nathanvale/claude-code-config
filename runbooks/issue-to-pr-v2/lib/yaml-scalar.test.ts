import { YAML } from "bun";
import { describe, expect, test } from "bun:test";

import { quoteYamlScalar, quoteYamlScalarList } from "./yaml-scalar";

function roundTrip(value: string): unknown {
  return YAML.parse(`value: ${quoteYamlScalar(value)}\n`) as {
    value: unknown;
  };
}

describe("yaml-scalar: quoteYamlScalar core escapes", () => {
  test("escapes backslash, double quote, newline, carriage return, and tab", () => {
    expect(quoteYamlScalar("a\\b")).toBe('"a\\\\b"');
    expect(quoteYamlScalar('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteYamlScalar("line1\nline2")).toBe('"line1\\nline2"');
    expect(quoteYamlScalar("line1\rline2")).toBe('"line1\\rline2"');
    expect(quoteYamlScalar("col1\tcol2")).toBe('"col1\\tcol2"');
  });

  test("escapes other C0 control characters and DEL via \\x escape", () => {
    expect(quoteYamlScalar("\x00")).toBe('"\\x00"');
    expect(quoteYamlScalar("\x01")).toBe('"\\x01"');
    expect(quoteYamlScalar("\x1f")).toBe('"\\x1f"');
    expect(quoteYamlScalar("\x7f")).toBe('"\\x7f"');
  });

  test("leaves printable ASCII and high-codepoint text unescaped inside the quotes", () => {
    expect(quoteYamlScalar("plain string")).toBe('"plain string"');
    expect(quoteYamlScalar("emoji: \u{1f600}")).toBe('"emoji: \u{1f600}"');
    expect(quoteYamlScalar("naïve")).toBe('"naïve"');
  });
});

describe("yaml-scalar: hostile values round-trip through Bun.YAML.parse", () => {
  test("NUL byte is preserved as a string after round-trip", () => {
    const result = roundTrip("alpha\x00beta") as { value: string };
    expect(result.value).toBe("alpha\x00beta");
  });

  test("UTF-16 surrogate inside a string does not break parsing", () => {
    const result = roundTrip("before 😀 after") as {
      value: string;
    };
    expect(result.value).toBe("before 😀 after");
  });

  test("embedded fence sequence does not terminate the YAML scalar", () => {
    const hostile = '```yaml\nstatus: "hijacked"\n```';
    const result = roundTrip(hostile) as { value: string };
    expect(result.value).toBe(hostile);
  });

  test("value that looks like a YAML mapping key escapes safely", () => {
    const result = roundTrip("key: value") as { value: string };
    expect(result.value).toBe("key: value");
  });

  test("numeric-looking string round-trips as a string, not a number", () => {
    const result = roundTrip("0042") as { value: string };
    expect(result.value).toBe("0042");
    expect(typeof result.value).toBe("string");
  });

  test("boolean-looking string round-trips as a string, not a boolean", () => {
    const result = roundTrip("yes") as { value: string };
    expect(result.value).toBe("yes");
    expect(typeof result.value).toBe("string");
  });

  test("empty string round-trips as an empty string, not null", () => {
    const result = roundTrip("") as { value: string };
    expect(result.value).toBe("");
    expect(typeof result.value).toBe("string");
  });

  test("string containing only whitespace round-trips byte-for-byte", () => {
    const result = roundTrip("   \t   ") as { value: string };
    expect(result.value).toBe("   \t   ");
  });

  test("multi-byte UTF-8 value round-trips byte-for-byte", () => {
    const value = "café — entrée — naïveté";
    const result = roundTrip(value) as { value: string };
    expect(result.value).toBe(value);
  });
});

describe("yaml-scalar: quoteYamlScalarList", () => {
  test("empty list emits the flow-empty token", () => {
    expect(quoteYamlScalarList([])).toBe("[]");
  });

  test("flow sequence quotes every element", () => {
    expect(quoteYamlScalarList(["a", "b"])).toBe('["a", "b"]');
  });

  test("flow sequence round-trips hostile elements through Bun.YAML.parse", () => {
    const hostile = ["a\nb", 'with "quote"', "with\\backslash"];
    const parsed = YAML.parse(`values: ${quoteYamlScalarList(hostile)}\n`) as {
      values: string[];
    };
    expect(parsed.values).toEqual(hostile);
  });
});
