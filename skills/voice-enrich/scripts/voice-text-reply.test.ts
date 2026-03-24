import { describe, expect, test } from "bun:test";
import {
  assertTextReply,
  buildArtifactPaths,
  buildReplyPrompt,
  buildTaskBrief,
} from "./voice-text-reply.ts";

describe("buildArtifactPaths", () => {
  test("uses deterministic runtime artifact names", () => {
    expect(buildArtifactPaths("melanie")).toEqual({
      bundlePath:
        "/Users/nathanvale/code/my-second-brain/runtime/people-enrichment/tmp/melanie-text-reply-bundle.md",
      replyPath:
        "/Users/nathanvale/code/my-second-brain/runtime/people-enrichment/tmp/melanie-text-reply.txt",
    });
  });
});

describe("buildTaskBrief", () => {
  test("includes the reply boundary and medium-shift rule", () => {
    const brief = buildTaskBrief("Melanie");

    expect(brief).toContain("Mode: reply");
    expect(brief).toContain("Draft a text reply to Melanie");
    expect(brief).toContain("Return plain text only.");
    expect(brief).toContain("bridge text");
  });
});

describe("buildReplyPrompt", () => {
  test("locks the model to the supplied bundle and plain-text contract", () => {
    const prompt = buildReplyPrompt("# Bundle", "/tmp/bundle.md");

    expect(prompt).toContain("The ContextBundle at /tmp/bundle.md");
    expect(prompt).toContain("contract-text-message.md");
    expect(prompt).toContain("Return only the sendable text message in plain text.");
  });
});

describe("assertTextReply", () => {
  test("accepts plain sendable text", () => {
    expect(() => assertTextReply("I hear you. Let's talk tonight when we're both calmer.")).not.toThrow();
  });

  test("rejects markdown formatting", () => {
    expect(() => assertTextReply("# Reply\n- one")).toThrow("must not include markdown");
  });

  test("rejects code fences", () => {
    expect(() => assertTextReply("```text\nhi\n```")).toThrow("must not include code fences");
  });
});
