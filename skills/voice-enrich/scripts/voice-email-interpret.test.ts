import { describe, expect, test } from "bun:test";
import {
  assertEmailInterpretation,
  buildArtifactPaths,
  buildInterpretPrompt,
  buildTaskBrief,
} from "./voice-email-interpret.ts";

describe("buildArtifactPaths", () => {
  test("uses deterministic email interpretation artifact names", () => {
    expect(buildArtifactPaths("tyson-wodak")).toEqual({
      bundlePath:
        "/Users/nathanvale/code/my-second-brain/runtime/people-enrichment/tmp/tyson-wodak-email-interpretation-bundle.md",
      interpretationPath:
        "/Users/nathanvale/code/my-second-brain/runtime/people-enrichment/tmp/tyson-wodak-email-interpretation.md",
    });
  });
});

describe("buildTaskBrief", () => {
  test("includes interpretation boundary and reply restraint", () => {
    const brief = buildTaskBrief("Tyson Wodak");

    expect(brief).toContain("Mode: interpret");
    expect(brief).toContain("incoming email from Tyson Wodak");
    expect(brief).toContain("Return structured markdown");
    expect(brief).toContain("plain reading separate from relational inference");
  });
});

describe("buildInterpretPrompt", () => {
  test("locks the model to the supplied bundle and contract", () => {
    const prompt = buildInterpretPrompt("# Bundle", "/tmp/bundle.md");

    expect(prompt).toContain("The ContextBundle at /tmp/bundle.md");
    expect(prompt).toContain("contract-email-interpretation.md");
    expect(prompt).toContain("Return only structured markdown matching the email interpretation contract.");
  });
});

describe("assertEmailInterpretation", () => {
  test("accepts the required markdown structure", () => {
    expect(() =>
      assertEmailInterpretation(`# Email Interpretation

## Surface Read
- Primary ask: x
- Tone: y
- Urgency: low

## Relational Read
- What it may mean: z
- What not to overread: q

## Response Strategy
- Goal: a
- Watch-out: b

## Suggested Reply
Subject: Keep existing subject

Reply`),
    ).not.toThrow();
  });

  test("rejects missing headings", () => {
    expect(() => assertEmailInterpretation("# Nope")).toThrow(
      "Email interpretation is missing required heading",
    );
  });
});
