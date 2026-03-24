import { describe, expect, test } from "bun:test";
import {
  assertConflictReflection,
  buildArtifactPaths,
  buildReflectPrompt,
  buildTaskBrief,
} from "./voice-conflict-reflect.ts";

describe("buildArtifactPaths", () => {
  test("uses deterministic conflict reflection artifact names", () => {
    expect(buildArtifactPaths("richard")).toEqual({
      bundlePath:
        "/Users/nathanvale/code/my-second-brain/runtime/people-enrichment/tmp/richard-conflict-reflection-bundle.md",
      reflectionPath:
        "/Users/nathanvale/code/my-second-brain/runtime/people-enrichment/tmp/richard-conflict-reflection.md",
    });
  });
});

describe("buildTaskBrief", () => {
  test("includes the reflection boundary and medium guardrail", () => {
    const brief = buildTaskBrief("Richard Johnson");

    expect(brief).toContain("Mode: reflect");
    expect(brief).toContain("Reflect on the supplied conflict with Richard Johnson");
    expect(brief).toContain("Return structured markdown");
    expect(brief).toContain("suggest a better medium");
  });
});

describe("buildReflectPrompt", () => {
  test("locks the model to the supplied bundle and contract", () => {
    const prompt = buildReflectPrompt("# Bundle", "/tmp/bundle.md");

    expect(prompt).toContain("The ContextBundle at /tmp/bundle.md");
    expect(prompt).toContain("contract-conflict-processing.md");
    expect(prompt).toContain(
      "Return only structured markdown matching the conflict reflection contract.",
    );
  });
});

describe("assertConflictReflection", () => {
  test("accepts the required markdown structure", () => {
    expect(() =>
      assertConflictReflection(`# Conflict Reflection

## What Happened
- Surface conflict: x
- Why it stings: y
- What remains unresolved: z

## The Dance
- Your move: a
- Their move: b
- Loop to interrupt: c

## What Is Tender Or True
- Your vulnerability: d
- Their likely vulnerability: e
- What not to flatten: f

## What Needs Repair
- Responsibility to own: g
- Responsibility not to over-own: h
- Boundary to keep: i

## Possible Next Move
- Goal: j
- Better medium: call
- First sentence: k`),
    ).not.toThrow();
  });

  test("rejects missing headings", () => {
    expect(() => assertConflictReflection("# Nope")).toThrow(
      "Conflict reflection is missing required heading",
    );
  });
});
