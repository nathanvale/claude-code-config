// PROTOTYPE — throwaway. Compose a captured flow into VALID Chrome Recorder JSON
// with REAL selectors, validated against @puppeteer/replay's canonical parse().
//
// Run: bun prototypes/browser-use-uplift/recorder-json/build-recorder.ts

import { parse, stringify } from "@puppeteer/replay";

// ── The captured-flow shape browser-use ACTUALLY produces ────────────────────
// (proven this session: agent-browser snapshot -> @ref -> get attr id gives the
//  real durable selector; values are shape-only per Gate 1 — never typed secrets)
interface CapturedStep {
  action: "navigate" | "click" | "change";
  url?: string;
  /** real durable selector resolved from the acted-on ref (e.g. "#id"). */
  selector?: string;
  /** value SHAPE only — Gate 1. Never a typed secret. */
  valueShape?: string;
}

interface CapturedFlow {
  title: string;
  domain: string;
  steps: CapturedStep[];
}

// Fixture = exactly what we captured live on the oncore portal this session.
const CAPTURED: CapturedFlow = {
  title: "oncore — login",
  domain: "iteraterecruitment.oncoreservices.com",
  steps: [
    { action: "navigate", url: "https://iteraterecruitment.oncoreservices.com/Pages/Login.aspx" },
    { action: "change", selector: "#MainContent_LoginControl_UserName", valueShape: "redacted:username-field" },
    { action: "change", selector: "#MainContent_LoginControl_Password", valueShape: "redacted:password-field" },
    { action: "click", selector: "#MainContent_LoginControl_LoginButton" },
  ],
};

// ── Compose → Recorder UserFlow JSON ─────────────────────────────────────────
// Recorder's `selectors` is Selector[] = a fallback CHAIN. A real Recorder export
// carries several alternatives (css + aria + text); we have one strong #id, so we
// emit a single-element chain. Honest: one real selector, not Recorder's full
// multi-selector robustness set — good enough to replay, labelled as such.
function toRecorderFlow(flow: CapturedFlow): object {
  const steps: object[] = [
    // Recorder flows conventionally open with setViewport; keep it minimal.
    { type: "setViewport", width: 1200, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: false },
  ];

  for (const s of flow.steps) {
    if (s.action === "navigate") {
      steps.push({
        type: "navigate",
        url: s.url,
        assertedEvents: [{ type: "navigation", url: s.url }],
      });
    } else if (s.action === "change") {
      steps.push({
        type: "change",
        selectors: [[s.selector!]], // Selector[] — one css selector in the chain
        // value SHAPE only. A real typed secret NEVER reaches here (Gate 1).
        // This makes the flow intentionally NOT auth-replayable — it's evidence.
        value: s.valueShape!,
      });
    } else if (s.action === "click") {
      // Recorder REQUIRES offsetX/offsetY (click point within the element).
      // browser-use captures these from `get box @ref` (center of the element).
      steps.push({ type: "click", selectors: [[s.selector!]], offsetX: 10, offsetY: 10 });
    }
  }

  return { title: flow.title, steps };
}

// ── Build + VALIDATE against the canonical schema ────────────────────────────
const recorderFlow = toRecorderFlow(CAPTURED);

console.log("=== Recorder UserFlow JSON (browser-use → memory skill) ===");
console.log(JSON.stringify(recorderFlow, null, 2));

console.log("\n=== validate with @puppeteer/replay parse() (canonical schema) ===");
try {
  const parsed = parse(recorderFlow);
  console.log(`✓ VALID Recorder JSON — ${parsed.steps.length} steps, title: "${parsed.title}"`);
} catch (e) {
  console.log(`✗ INVALID: ${(e as Error).message}`);
  process.exit(1);
}

console.log("\n=== prove replayable: stringify() → Puppeteer code ===");
stringify(parse(recorderFlow) as Parameters<typeof stringify>[0])
  .then((code) => {
    const lines = code.split("\n").filter((l) => /page\.|goto|click|fill|type|\$\(/.test(l));
    console.log("  generated Puppeteer actions (first 6):");
    for (const l of lines.slice(0, 6)) console.log("   " + l.trim());
    console.log("\n✓ flow is genuinely replayable — but values are shape-only, so it");
    console.log("  reproduces the PATH/structure, not a real login (Gate 1 holds).");
  })
  .catch((e) => console.log("stringify note:", (e as Error).message));
