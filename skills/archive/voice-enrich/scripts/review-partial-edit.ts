import {
  applyPersonPatch,
  buildPersonPatch,
  extractIdentityCandidate,
  parsePeopleNote,
  type PersonPatch,
  type RelationshipBlock,
} from "../../people-enrich/scripts/people-note.ts";

export type ReviewAction = "keep" | "consider" | "rewrite";
export type ReviewConfidence = "strong" | "tentative";

export type ReviewBlock = {
  heading: string;
  action: ReviewAction;
  confidence: ReviewConfidence;
  suggestedRewrite?: string;
};

export type ReviewMarkdown = {
  blockReviews: ReviewBlock[];
  summarySuggestion?: string;
};

export type ReviewEditOperation =
  | {
      op: "replace-summary";
      content: string;
    }
  | {
      op: "replace-relationship-block";
      heading: string;
      content: string;
      confidence: ReviewConfidence;
    };

export type ReviewPartialEditPlan = {
  source: "review-markdown";
  policy: "preview-only";
  operations: ReviewEditOperation[];
};

const BLOCK_REVIEWS_HEADING = "## Block Reviews";
const MISSING_HEADINGS_HEADING = "## Missing Or Risky Headings";
const SUMMARY_HEADING = "## Summary Suggestion";
const CAUTIONS_HEADING = "## Cautions";

export function parseReviewMarkdown(content: string): ReviewMarkdown {
  const blockSection = sliceSection(content, BLOCK_REVIEWS_HEADING, [
    MISSING_HEADINGS_HEADING,
  ]);
  const summarySection = sliceSection(content, SUMMARY_HEADING, [CAUTIONS_HEADING]);

  return {
    blockReviews: parseBlockReviews(blockSection),
    summarySuggestion: normalizeSummarySuggestion(summarySection),
  };
}

export function buildReviewPartialEditPlan(
  review: string | ReviewMarkdown,
): ReviewPartialEditPlan {
  const parsed = typeof review === "string" ? parseReviewMarkdown(review) : review;
  const operations: ReviewEditOperation[] = [];

  if (parsed.summarySuggestion) {
    operations.push({
      op: "replace-summary",
      content: parsed.summarySuggestion,
    });
  }

  for (const block of parsed.blockReviews) {
    if (block.action !== "rewrite" || !block.suggestedRewrite) continue;
    operations.push({
      op: "replace-relationship-block",
      heading: block.heading,
      content: block.suggestedRewrite,
      confidence: block.confidence,
    });
  }

  return {
    source: "review-markdown",
    policy: "preview-only",
    operations,
  };
}

export function hasAppliableReviewEdits(plan: ReviewPartialEditPlan): boolean {
  return plan.operations.length > 0;
}

export function buildPatchFromReviewPartialEditPlan(
  existingContent: string,
  plan: ReviewPartialEditPlan,
  updated: string,
): PersonPatch {
  const parsed = parsePeopleNote(existingContent);
  const person = extractIdentityCandidate(parsed.frontmatter);
  if (!person) {
    throw new Error(
      "Existing note is missing canonical identity fields required for review previews.",
    );
  }

  let summary: string | undefined;
  const relationshipBlocks: RelationshipBlock[] = [];

  for (const operation of plan.operations) {
    if (operation.op === "replace-summary") {
      summary = operation.content;
      continue;
    }

    relationshipBlocks.push({
      heading: operation.heading,
      content: operation.content,
    });
  }

  return buildPersonPatch({
    existing: parsed,
    person,
    updated,
    summary,
    relationshipBlocks,
  });
}

export function applyReviewPartialEditPlan(
  existingContent: string,
  plan: ReviewPartialEditPlan,
  updated: string,
): string {
  const patch = buildPatchFromReviewPartialEditPlan(existingContent, plan, updated);
  return applyPersonPatch(existingContent, patch);
}

function sliceSection(
  content: string,
  startHeading: string,
  nextHeadings: string[],
): string {
  const startIndex = content.indexOf(startHeading);
  if (startIndex === -1) {
    throw new Error(`Review output is missing required section: ${startHeading}`);
  }

  const sectionStart = startIndex + startHeading.length;
  let sectionEnd = content.length;
  for (const heading of nextHeadings) {
    const headingIndex = content.indexOf(heading, sectionStart);
    if (headingIndex !== -1 && headingIndex < sectionEnd) {
      sectionEnd = headingIndex;
    }
  }

  return content.slice(sectionStart, sectionEnd).trim();
}

function parseBlockReviews(section: string): ReviewBlock[] {
  if (!section.trim()) return [];

  const matches = [...section.matchAll(/^### (.+)$/gm)];
  return matches.map((match, index) => {
    const heading = match[1].trim();
    const start = match.index! + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index! : section.length;
    return parseBlockReview(heading, section.slice(start, end).trim());
  });
}

function parseBlockReview(heading: string, body: string): ReviewBlock {
  let action: ReviewAction | undefined;
  let confidence: ReviewConfidence | undefined;
  let suggestedRewrite: string | undefined;

  const lines = body.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith("- Action:")) {
      action = parseAction(line.slice("- Action:".length).trim(), heading);
      continue;
    }
    if (line.startsWith("- Confidence:")) {
      confidence = parseConfidence(
        line.slice("- Confidence:".length).trim(),
        heading,
      );
      continue;
    }
    if (line.startsWith("- Suggested rewrite:")) {
      const inlineRewrite = line.slice("- Suggested rewrite:".length).trim();
      if (inlineRewrite) {
        suggestedRewrite = normalizeSuggestion(inlineRewrite);
        continue;
      }

      suggestedRewrite = normalizeSuggestion(
        dedent(lines.slice(index + 1).join("\n")),
      );
      break;
    }
  }

  if (!action) {
    throw new Error(`Review block "${heading}" is missing Action.`);
  }
  if (!confidence) {
    throw new Error(`Review block "${heading}" is missing Confidence.`);
  }

  return {
    heading,
    action,
    confidence,
    suggestedRewrite,
  };
}

function parseAction(value: string, heading: string): ReviewAction {
  if (value === "keep" || value === "consider" || value === "rewrite") {
    return value;
  }
  throw new Error(`Review block "${heading}" has unsupported Action: ${value}`);
}

function parseConfidence(value: string, heading: string): ReviewConfidence {
  if (value === "strong" || value === "tentative") {
    return value;
  }
  throw new Error(`Review block "${heading}" has unsupported Confidence: ${value}`);
}

function normalizeSuggestion(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "None." || trimmed === "None") {
    return undefined;
  }
  return trimmed;
}

function normalizeSummarySuggestion(value: string): string | undefined {
  const normalized = normalizeSuggestion(value);
  if (!normalized) return undefined;

  const quotedCandidate =
    normalized.match(/:\s*\n\n"([\s\S]+)"$/)?.[1] ??
    normalized.match(/^"([\s\S]+)"$/)?.[1];
  return quotedCandidate?.trim() || normalized;
}

function dedent(value: string): string {
  const lines = value.replace(/^\n+|\n+$/g, "").split("\n");
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^ */)?.[0].length ?? 0);
  const margin = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => line.slice(margin)).join("\n");
}
