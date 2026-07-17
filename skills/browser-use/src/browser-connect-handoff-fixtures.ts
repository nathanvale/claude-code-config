// ---------------------------------------------------------------------------
// Real browser-connect envelope captures (U1 envelope-acceptance seam).
//
// Fakes must match real output shape: a compact-vs-pretty JSON fake has hidden
// a real parse bug in this repo before, so these fixtures are captured output,
// not hand-written JSON.
//
// - REAL_VERIFIED_HANDOFF_ENVELOPE is verbatim stdout of a real
//   `browser-connect connect chrome-devtools-mcp --json` run against live
//   verified Agent Chrome (captured 2026-07-17). Stronger than the earlier
//   emission-path capture and production-representative:
//   attachment.probe_executable carries the absolute pinned adapter path the
//   KTD3 spawn guard requires (the old capture's relative value came from a
//   test resolver and would now fail that guard).
// - REAL_CONNECT_FAILURE_ENVELOPE is verbatim stdout of a real
//   `browser-connect connect chrome-devtools-mcp --json --run-id
//   fixture-connect-failure` spawn that failed closed (exit 20), captured
//   2026-07-16.
//
// Both captured against browser-connect schema_version 1. The
// process-boundary test (browser-connect-process-boundary.test.ts) re-proves
// the failure shape against the live CLI on every run, so drift between these
// captures and the real binary cannot go unnoticed.
// ---------------------------------------------------------------------------

export const REAL_VERIFIED_HANDOFF_ENVELOPE = `{
  "status": "ok",
  "run_id": "fixture-run",
  "data": {
    "outcome": "verified",
    "environment": {
      "name": "agent-chrome"
    },
    "browser_entry_mode": "explicit-cdp",
    "attachment": {
      "adapter_id": "chrome-devtools-mcp",
      "route": "explicit-cdp",
      "probe_executable": "/Users/nathanvale/.side-quest/browser-connect/adapters/chrome-devtools-mcp/1.5.0/node_modules/.bin/chrome-devtools-mcp"
    },
    "endpoint": {
      "http": "http://127.0.0.1:9222",
      "ws": "ws://127.0.0.1:9222/devtools/browser/d6cb7b60-ee46-44be-8e5a-a427e1b52f9d"
    },
    "launch": {
      "launched": false
    },
    "proof": {
      "environment_contract_id": "warm-chrome.browser-entry",
      "environment_schema_version": "1",
      "route_evidence": "verified-live"
    },
    "contract_id": "browser-connect.verified-handoff",
    "schema_version": "1"
  },
  "runtime_actions": [
    {
      "id": "use_verified_handoff",
      "summary": "Attach the authorized adapter using the verified endpoint forms in this envelope.",
      "side_effects": [
        "browser"
      ]
    }
  ],
  "continuation": {
    "next_action_id": "use_verified_handoff"
  },
  "duration_ms": 737
}
`;

export const REAL_CONNECT_FAILURE_ENVELOPE = `{
  "status": "error",
  "run_id": "fixture-connect-failure",
  "data": {
    "outcome": "failed",
    "failure_class": "foreign-listener",
    "next_action_id": "inspect_listener",
    "environment": {
      "name": "agent-chrome"
    },
    "launch": {
      "launched": false
    },
    "detail": "Stop and inspect the foreign listener before adapter work.",
    "contract_id": "browser-connect.verified-handoff",
    "schema_version": "1"
  },
  "error": {
    "run_id": "fixture-connect-failure",
    "code": "foreign_listener",
    "message": "Stop and inspect the foreign listener before adapter work.",
    "exit_code": 20,
    "severity": "error",
    "recoverability": "none",
    "retryable": false,
    "hint": {
      "summary": "Stop and inspect the foreign listener before adapter work."
    },
    "failure_domain": "browser_entry_handoff"
  },
  "continuation": {
    "requires_operator": true,
    "constraints": [
      {
        "id": "no_adapter_fallback",
        "summary": "Do not switch to adapter discovery, a cold browser, or another browser environment after proof failure.",
        "forbidden_action_ids": [
          "select_compatible_route"
        ]
      }
    ],
    "choices": [
      {
        "id": "inspect_listener",
        "label": "Inspect the listener",
        "summary": "Inspect the unverified listener through its own process owner; remediation stays external and a fresh invocation must re-prove the port.",
        "recoverability": "repair_state",
        "side_effects": [
          "read",
          "check"
        ],
        "docs_url": "https://github.com/nathanvale/claude-code-config/blob/main/runtime/browser-connect/REPAIR.md#v1-inspect_listener"
      }
    ]
  },
  "duration_ms": 77
}
`;

// Mutate a REAL capture instead of assembling JSON by hand: parse the captured
// envelope, apply the test's precise change, re-serialize COMPACT. Compact
// output also proves the consumer accepts both serializations (the raw
// constants above stay pretty-printed).
// biome-ignore lint/suspicious/noExplicitAny: test-only ergonomic surface
export function verifiedHandoffEnvelope(mutate?: (envelope: any) => void): string {
	return mutateCapture(REAL_VERIFIED_HANDOFF_ENVELOPE, mutate);
}

// biome-ignore lint/suspicious/noExplicitAny: test-only ergonomic surface
export function connectFailureEnvelope(mutate?: (envelope: any) => void): string {
	return mutateCapture(REAL_CONNECT_FAILURE_ENVELOPE, mutate);
}

// biome-ignore lint/suspicious/noExplicitAny: test-only ergonomic surface
function mutateCapture(raw: string, mutate?: (envelope: any) => void): string {
	const parsed = JSON.parse(raw);
	mutate?.(parsed);
	return JSON.stringify(parsed);
}
