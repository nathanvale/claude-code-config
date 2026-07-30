// ---------------------------------------------------------------------------
// Real browser-connect envelope captures (U1 envelope-acceptance seam).
//
// Fakes must match real output shape: a compact-vs-pretty JSON fake has hidden
// a real parse bug in this repo before, so these fixtures are captured output,
// not hand-written JSON.
//
// - REAL_VERIFIED_HANDOFF_ENVELOPE is stdout of a real
//   `browser-connect connect chrome-devtools-mcp --json` run against live
//   verified Agent Chrome (captured 2026-07-17). Stronger than the earlier
//   emission-path capture and production-representative:
//   attachment.probe_executable carries the absolute pinned adapter path the
//   KTD3 spawn guard requires (the old capture's relative value came from a
//   test resolver and would now fail that guard). Two values are sanitized
//   shape-for-shape (CodeRabbit PR #249): the capture's home-directory prefix
//   became a neutral absolute root, and the live session's ws debugger GUID (a
//   capability-bearing handle while that session runs) became a synthetic
//   UUID. Path layout, URL forms, and every other byte are the capture's own.
// - REAL_CONNECT_FAILURE_ENVELOPE is verbatim stdout of a real
//   `browser-connect connect chrome-devtools-mcp --json --run-id
//   fixture-connect-failure` spawn that failed closed (exit 20), captured
//   2026-07-16.
//
// Both were captured against browser-connect schema_version 1, updated to
// schema 2 for the logical profile identity, then updated to schema 3 for the
// exact live-clean profile posture proof. Every other byte is the capture's
// own. The process-boundary test
// (browser-connect-process-boundary.test.ts) re-proves the failure shape
// against the live CLI on every run, so drift between these captures and the
// real binary cannot go unnoticed.
// ---------------------------------------------------------------------------

export const LIVE_CLEAN_PROFILE_POSTURE_FIXTURE = {
	state: "live-clean",
	disk: {
		save_setting: "disabled",
		auto_signin_setting: "disabled",
		sync_setting: "disabled",
		stored_login: "live-observed-absent",
	},
	process: {
		disable_sync_switch: "present",
		disable_extensions_switch: "present",
	},
	effective: {
		observation: "running-chrome",
		save_capability: "disabled",
		fill_exposure: "no-source",
		sync_state: "disabled",
		save_prompt: "suppressed",
		observer: {
			source: "chrome-webui",
			browser_pid: 4242,
			port: "9222",
			profile_match: "exact",
			observed_at_ms: 1,
		},
	},
} as const;

export const REAL_VERIFIED_HANDOFF_ENVELOPE = `{
  "status": "ok",
  "run_id": "fixture-run",
  "data": {
    "outcome": "verified",
    "environment": {
      "name": "agent-chrome",
      "profile": "default"
    },
    "browser_entry_mode": "explicit-cdp",
    "attachment": {
      "adapter_id": "chrome-devtools-mcp",
      "route": "explicit-cdp",
      "probe_executable": "/opt/side-quest/browser-connect/adapters/chrome-devtools-mcp/1.5.0/node_modules/.bin/chrome-devtools-mcp"
    },
    "endpoint": {
      "http": "http://127.0.0.1:9222",
      "ws": "ws://127.0.0.1:9222/devtools/browser/4f5a2b1c-8d3e-4a6f-9b0c-1e2d3c4b5a69"
    },
    "launch": {
      "launched": false
    },
    "proof": {
      "environment_contract_id": "warm-chrome.browser-entry",
      "environment_schema_version": "2",
      "route_evidence": "verified-live",
      "profile_posture": {
        "state": "live-clean",
        "disk": {
          "save_setting": "disabled",
          "auto_signin_setting": "disabled",
          "sync_setting": "disabled",
          "stored_login": "live-observed-absent"
        },
        "process": {
          "disable_sync_switch": "present",
          "disable_extensions_switch": "present"
        },
        "effective": {
          "observation": "running-chrome",
          "save_capability": "disabled",
          "fill_exposure": "no-source",
          "sync_state": "disabled",
          "save_prompt": "suppressed",
          "observer": {
            "source": "chrome-webui",
            "browser_pid": 4242,
            "port": "9222",
            "profile_match": "exact",
            "observed_at_ms": 1
          }
        }
      }
    },
    "contract_id": "browser-connect.verified-handoff",
    "schema_version": "3"
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
      "name": "agent-chrome",
      "profile": "default"
    },
    "launch": {
      "launched": false
    },
    "detail": "Stop and inspect the foreign listener before adapter work.",
    "contract_id": "browser-connect.verified-handoff",
    "schema_version": "3"
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
