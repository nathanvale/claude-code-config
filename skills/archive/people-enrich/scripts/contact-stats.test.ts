import { describe, expect, test } from "bun:test";
import { parseFrontmatter, slugify } from "./lib";

describe("parseFrontmatter", () => {
  test("parses standard iMessage frontmatter", () => {
    const content = `---
conversation_with: "Richard Johnson"
direction: outbound
sent_at: "2024-06-15T10:30:00+10:00"
day_of_week: "Saturday"
time_of_day: "morning"
is_group: false
handle: "+61497848278"
---
## Message
Hello!`;

    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.conversation_with).toBe("Richard Johnson");
    expect(result!.direction).toBe("outbound");
    expect(result!.day_of_week).toBe("Saturday");
    expect(result!.time_of_day).toBe("morning");
    expect(result!.is_group).toBe(false);
    expect(result!.handle).toBe("+61497848278");
  });

  test("parses group message", () => {
    const content = `---
conversation_with: "Melanie"
direction: inbound
sent_at: "2024-01-01T12:00:00+11:00"
day_of_week: "Monday"
time_of_day: "afternoon"
is_group: true
handle: "+61412667520"
---
## Message
Happy new year!`;

    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.is_group).toBe(true);
  });

  test("returns null for missing frontmatter", () => {
    expect(parseFrontmatter("No frontmatter here")).toBeNull();
  });

  test("returns null for missing conversation_with", () => {
    const content = `---
direction: inbound
sent_at: "2024-01-01T12:00:00"
---
Body`;
    expect(parseFrontmatter(content)).toBeNull();
  });

  test("handles unquoted values", () => {
    const content = `---
conversation_with: Melanie
direction: inbound
sent_at: 2024-01-01
day_of_week: Monday
time_of_day: morning
is_group: false
handle: +61412667520
---`;

    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.conversation_with).toBe("Melanie");
    expect(result!.handle).toBe("+61412667520");
  });
});

describe("slugify", () => {
  test("converts display name to slug", () => {
    expect(slugify("Richard Johnson")).toBe("richard-johnson");
    expect(slugify("Melanie")).toBe("melanie");
    expect(slugify("Marion Livingstone Vale")).toBe("marion-livingstone-vale");
    expect(slugify("Maya Rose Vale")).toBe("maya-rose-vale");
  });

  test("strips special characters", () => {
    expect(slugify("O'Brien")).toBe("o-brien");
    expect(slugify("Name (nickname)")).toBe("name-nickname");
  });
});

// Integration-style tests using the contact-stats logic
// These test the accumulation and gap detection without hitting the filesystem

describe("gap detection", () => {
  /**
   * Reimplementation of detectGaps for testing without importing the main script.
   */
  function detectGaps(
    sortedDates: string[],
  ): Array<{ start: string; end: string; days: number }> {
    const gaps: Array<{ start: string; end: string; days: number }> = [];
    if (sortedDates.length < 2) return gaps;

    for (let i = 1; i < sortedDates.length; i++) {
      const prev = new Date(sortedDates[i - 1]);
      const curr = new Date(sortedDates[i]);
      const diffDays = Math.round(
        (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (diffDays >= 14) {
        gaps.push({
          start: sortedDates[i - 1].slice(0, 10),
          end: sortedDates[i].slice(0, 10),
          days: diffDays,
        });
      }
    }
    return gaps;
  }

  test("detects 14+ day gap", () => {
    const dates = ["2024-01-01T10:00:00", "2024-01-20T10:00:00"];
    const gaps = detectGaps(dates);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].days).toBe(19);
    expect(gaps[0].start).toBe("2024-01-01");
    expect(gaps[0].end).toBe("2024-01-20");
  });

  test("ignores gaps under 14 days", () => {
    const dates = ["2024-01-01T10:00:00", "2024-01-10T10:00:00"];
    const gaps = detectGaps(dates);
    expect(gaps).toHaveLength(0);
  });

  test("detects multiple gaps", () => {
    const dates = [
      "2024-01-01T10:00:00",
      "2024-01-02T10:00:00",
      "2024-02-01T10:00:00",
      "2024-02-02T10:00:00",
      "2024-04-01T10:00:00",
    ];
    const gaps = detectGaps(dates);
    expect(gaps).toHaveLength(2);
  });

  test("handles empty and single-element arrays", () => {
    expect(detectGaps([])).toHaveLength(0);
    expect(detectGaps(["2024-01-01T10:00:00"])).toHaveLength(0);
  });
});
