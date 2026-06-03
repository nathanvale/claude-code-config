# Browser Adapter Recovery Drift Notes

Source: prototype request on 2026-06-03.

## Question

- Find shared proof and recovery patterns across `chrome-devtools` and `agent-browser`.
- Identify what stays adapter-specific.
- Test whether Browser Adapter Map drift can be checked mechanically.

## Early Answer

- Use one shared recovery catalogue.
- Let adapter proof specs declare emitted diagnostics.
- Generate expected map keys from catalogue plus adapter specs.
- Let maps own operator repair text and commands.
- Check maps for missing keys, unknown keys, and noncanonical recovery targets.

## Shared Machinery Candidate

- Required map sections: `Owners`, `Rules`, `Recovery Map`, `Verify`.
- Shared success action: `use_verified_browser_adapter`.
- Shared proof-failure actions: `configure_adapter_dependency`, `update_adapter_config`, `inspect_adapter_config`, `change_adapter_input`.
- Shared local recovery keys: `browser_entry_handoff`, `missing_adapter`, `unknown_adapter`, `non_loopback_endpoint`, `invalid_usage`, `runtime_failure`.
- Shared diagnostic catalogue: diagnostic code -> canonical recovery target -> expected map section.
- Shared drift check: adapter spec emissions -> expected Recovery Map keys.

## Adapter-Specific Inputs

- `chrome-devtools` dependency surface: `mcporter`.
- `agent-browser` dependency surface: `agent-browser`.
- `chrome-devtools` binding proof: selected config binding plus `list_pages`.
- `agent-browser` binding proof: session CDP pin plus `get cdp-url`.
- `chrome-devtools` weak signal: empty `list_pages`.
- `agent-browser` weak signal: empty `tab list`.
- `agent-browser` risk signal: auto-launch or Chrome for Testing.

## Prototype Learning

- Global all-code map coverage is simple but bloats each adapter map.
- Adapter-emitted coverage is smaller but requires adapter proof specs as contract data.
- Canonical diagnostic-to-target mapping prevents maps from drifting semantically.
- Unknown map keys expose vocabulary invention.
- New catalogue codes need a map migration path.

## Production Shape Candidate

- Keep stable vocab in `skills/browser-use/scripts/command-contract.ts`.
- Add adapter proof spec data near `preflight-browser-adapter.ts`.
- Make Browser Adapter Map checker derive expected keys per adapter from proof specs.
- Keep exact local repair commands in `skills/browser-use/references/browser-adapter-<adapter>.md`.
- Add `agent-browser` map only after proof semantics are accepted.

## Open Questions

- Should map validation require all global diagnostic codes, or only diagnostics emitted by that adapter?
- Should risk diagnostics map to `inspect_adapter_config` or a richer `return_to_warm_chrome_proof` action?
- Should proof specs live in production runtime code or a separate contract-owned module?
- Should map checker validate section placement, or only key coverage and canonical targets?
