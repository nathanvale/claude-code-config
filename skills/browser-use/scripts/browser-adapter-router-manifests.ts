// Browser Adapter Router V1 capability manifests.
//
// Manifest-backed routable reports live here, with the Router runtime — not in
// docs, references, or SKILL prose (plan R8, R8a, R8b). Each manifest is a
// provenance-bearing snapshot of one adapter's capabilities, validated through
// the same report validator as adapter self-reports (R8b, U0 scenario "Manifest
// constants pass through the same validator as adapter self-reports").
//
// These constants are research-grade evidence captured by a maintainer; they are
// NOT live probes. Freshness is enforced at route time against `checked_at` +
// `stale_after_days` (KTD8, plan "Manifest-backed V1 can still drift").

import type {
	AdapterCapability,
	BrowserAdapterId,
	CapabilityReport,
} from "./browser-adapter-router-model";

// One ISO date stamp shared by the seeded manifests. `Date.now()`/`new Date()`
// are intentionally avoided in runtime code so behavior stays deterministic; the
// stamp is a literal a maintainer updates when re-verifying (plan Sources).
const MANIFEST_CHECKED_AT = "2026-06-02" as const;

// Standard freshness window for maintainer-verified manifests. Routes past this
// window emit `adapter_capability_stale` rather than routing on drifted data.
const MANIFEST_STALE_AFTER_DAYS = 30 as const;

type ManifestCapabilityFactory = (
	capability: AdapterCapability,
	support: CapabilityReport["capabilities"][number]["support"],
	confidence: number,
	verification_method: string,
) => CapabilityReport["capabilities"][number];

function capabilityForSource(source_url: string): ManifestCapabilityFactory {
	return (capability, support, confidence, verification_method) => ({
		capability,
		support,
		confidence,
		evidence: {
			verification_method,
			source_url,
		},
	});
}

const CHROME_DEVTOOLS_SOURCE_URL =
	"https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session";
const AGENT_BROWSER_SOURCE_URL = "https://github.com/vercel-labs/agent-browser";
const PLAYWRIGHT_CDP_SOURCE_URL =
	"https://github.com/microsoft/playwright-mcp";
const chromeCapability = capabilityForSource(CHROME_DEVTOOLS_SOURCE_URL);
const agentBrowserCapability = capabilityForSource(AGENT_BROWSER_SOURCE_URL);
const playwrightCapability = capabilityForSource(PLAYWRIGHT_CDP_SOURCE_URL);

const CHROME_DEVTOOLS_MANIFEST: CapabilityReport = {
	adapter_id: "chrome-devtools",
	schema_version: "1",
	report_source: "manifest",
	resolved_command: "mcporter",
	validation: "valid",
	attachment_model: "verified_warm_chrome",
	provenance: {
		adapter_version: "chrome-devtools-mcp@latest",
		source_url: CHROME_DEVTOOLS_SOURCE_URL,
		checked_at: MANIFEST_CHECKED_AT,
		verification_method: "maintainer_docs_review",
		stale_after_days: MANIFEST_STALE_AFTER_DAYS,
	},
	capabilities: [
		chromeCapability("snapshot_refs", "full", 90, "maintainer_docs_review"),
		chromeCapability("element_actions", "full", 90, "maintainer_docs_review"),
		chromeCapability("selector_actions", "full", 85, "maintainer_docs_review"),
		chromeCapability("screenshot_media", "full", 90, "maintainer_docs_review"),
		chromeCapability("console_debug", "full", 95, "maintainer_docs_review"),
		chromeCapability("network_inspection", "full", 95, "maintainer_docs_review"),
		chromeCapability("performance_profile", "full", 85, "maintainer_docs_review"),
		chromeCapability(
			"devtools_performance_insight",
			"full",
			90,
			"maintainer_docs_review",
		),
		chromeCapability("memory_debug", "partial", 60, "maintainer_docs_review"),
		chromeCapability("react_vitals", "none", 80, "maintainer_docs_review"),
	],
};

const AGENT_BROWSER_MANIFEST: CapabilityReport = {
	adapter_id: "agent-browser",
	schema_version: "1",
	report_source: "manifest",
	resolved_command: "agent-browser",
	validation: "valid",
	attachment_model: "verified_warm_chrome",
	provenance: {
		adapter_version: "agent-browser@latest",
		source_url: AGENT_BROWSER_SOURCE_URL,
		checked_at: MANIFEST_CHECKED_AT,
		verification_method: "maintainer_docs_review",
		stale_after_days: MANIFEST_STALE_AFTER_DAYS,
	},
	capabilities: [
		agentBrowserCapability("snapshot_refs", "full", 85, "maintainer_docs_review"),
		agentBrowserCapability("element_actions", "full", 85, "maintainer_docs_review"),
		agentBrowserCapability("selector_actions", "full", 80, "maintainer_docs_review"),
		agentBrowserCapability("screenshot_media", "full", 85, "maintainer_docs_review"),
		agentBrowserCapability("console_debug", "partial", 60, "maintainer_docs_review"),
		agentBrowserCapability(
			"network_inspection",
			"partial",
			55,
			"maintainer_docs_review",
		),
		agentBrowserCapability("performance_profile", "none", 70, "maintainer_docs_review"),
		agentBrowserCapability(
			"devtools_performance_insight",
			"none",
			75,
			"maintainer_docs_review",
		),
		agentBrowserCapability("memory_debug", "unknown", 40, "maintainer_docs_review"),
		agentBrowserCapability("react_vitals", "unknown", 45, "maintainer_docs_review"),
	],
};

const PLAYWRIGHT_CDP_MANIFEST: CapabilityReport = {
	adapter_id: "playwright-cdp",
	schema_version: "1",
	report_source: "manifest",
	resolved_command: "playwright",
	validation: "valid",
	attachment_model: "verified_warm_chrome",
	provenance: {
		adapter_version: "@playwright/mcp@latest",
		source_url: PLAYWRIGHT_CDP_SOURCE_URL,
		checked_at: MANIFEST_CHECKED_AT,
		verification_method: "maintainer_docs_review",
		stale_after_days: MANIFEST_STALE_AFTER_DAYS,
	},
	capabilities: [
		playwrightCapability("snapshot_refs", "full", 85, "maintainer_docs_review"),
		playwrightCapability("element_actions", "full", 90, "maintainer_docs_review"),
		playwrightCapability("selector_actions", "full", 90, "maintainer_docs_review"),
		playwrightCapability("screenshot_media", "full", 85, "maintainer_docs_review"),
		playwrightCapability("console_debug", "full", 80, "maintainer_docs_review"),
		playwrightCapability("network_inspection", "full", 80, "maintainer_docs_review"),
		playwrightCapability(
			"performance_profile",
			"partial",
			55,
			"maintainer_docs_review",
		),
		playwrightCapability(
			"devtools_performance_insight",
			"none",
			70,
			"maintainer_docs_review",
		),
		playwrightCapability("memory_debug", "none", 70, "maintainer_docs_review"),
		playwrightCapability("react_vitals", "none", 75, "maintainer_docs_review"),
	],
};

// Registry-aligned manifest lookup. A missing entry means no manifest-backed
// report exists for that adapter, which the Router treats as
// `adapter_capability_unknown` unless a validated self-report is supplied.
export const BROWSER_ADAPTER_ROUTER_MANIFESTS: Readonly<
	Partial<Record<BrowserAdapterId, CapabilityReport>>
> = {
	"chrome-devtools": CHROME_DEVTOOLS_MANIFEST,
	"agent-browser": AGENT_BROWSER_MANIFEST,
	"playwright-cdp": PLAYWRIGHT_CDP_MANIFEST,
};
