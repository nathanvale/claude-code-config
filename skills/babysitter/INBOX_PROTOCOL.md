# Inbox Protocol — Transient Error Reporting

Skills that encounter transient failures (API timeouts, rate limits, tool unavailability) report them to the babysitter inbox for later processing.

## How to Report

Append a single JSON line to the inbox file via bash echo:

```bash
echo '{"at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","skill":"<SKILL_NAME>","error":"<ERROR_CODE>","message":"<human-readable description>","ticket":"<POS-XXXX or null>"}' >> ~/.claude/state/babysitter/inbox.ndjson
```

Replace `<SKILL_NAME>`, `<ERROR_CODE>`, `<message>`, and `<ticket>` with actual values.

## Why Bash Echo

- **Can't fail meaningfully** — append to a file. If the dir/file doesn't exist, it fails silently and the skill continues.
- **No token cost** — no forked context, no Skill() invocation overhead.
- **No dependency on babysitter** — if babysitter skill is deleted, the echo succeeds harmlessly.
- **Non-blocking** — the skill continues immediately after the echo.

## Line Schema (NDJSON)

Each line is a self-contained JSON object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `at` | ISO 8601 UTC | Yes | When the error occurred |
| `skill` | string | Yes | Source skill name (e.g., `"kickoff"`, `"git"`) |
| `error` | string | Yes | Error code (snake_case, from skill's registered codes) |
| `message` | string | Yes | Human-readable description of what happened |
| `ticket` | string | No | Jira ticket key if contextually relevant (e.g., `"POS-3044"`) |

## Error Code Conventions

- snake_case, lowercase
- Format: `<noun>_<failure_verb>` (e.g., `figma_rate_limited`, `state_write_failed`)
- Keep codes stable — babysitter matches on them for known-issue resolution

## When to Report

Report at the point where the skill **detects** the failure and **continues past it**. The echo goes right before the skill's existing fallback/continue logic. Do NOT report if the skill is about to hard-stop — the user will see that error directly.

## Processing

The babysitter processes the inbox on each `/babysitter` run:
1. Reads all lines, parses each as JSON (skips malformed lines)
2. Promotes each entry to an issue file in `~/.claude/state/babysitter/issues/`
3. Truncates inbox to empty
4. Resolves issues against KNOWN_ISSUES.json

## Registered Error Codes by Skill

Each skill below lists the error codes it may emit. This is the canonical registry — add new codes here when adding inbox reporting to a skill.

### kickoff
| Code | Trigger |
|------|---------|
| `figma_export_failed` | Figma frame export fails (rate limit, token issue) |
| `jira_unreachable` | Jira ticket fetch fails |
| `confluence_creation_failed` | Confluence page creation fails |

### plan
| Code | Trigger |
|------|---------|
| `gathered_not_found` | get-gathered returns not_found |
| `obsidian_write_failed` | para_create or para_replace_section fails |

### git (COMMIT.md)
| Code | Trigger |
|------|---------|
| `ticket_state_advance_failed` | ticket-state advance/log fails after commit |

### git (PR_CREATE.md)
| Code | Trigger |
|------|---------|
| `ticket_state_advance_failed` | ticket-state advance fails after PR creation |
| `gh_cli_failed` | `gh pr create` or `git push` fails |

### git (PR_REVIEW.md)
| Code | Trigger |
|------|---------|
| `gh_api_comment_failed` | Line-level PR comment via gh API fails |

### review-workflow
| Code | Trigger |
|------|---------|
| `jira_comment_failed` | Adding Jira comment fails |
| `pr_not_found` | No PR found for the given ticket/number |
| `ticket_state_advance_failed` | ticket-state advance fails after review completion |

### ticket-state
| Code | Trigger |
|------|---------|
| `state_write_failed` | Writing state JSON file fails |
| `jira_fetch_failed` | Jira fetch fails during init (summary population) |

### codebase-search
| Code | Trigger |
|------|---------|
| `mcp_tool_load_failed` | ToolSearch returns empty for a required MCP tool |

### where-am-i
| Code | Trigger |
|------|---------|
| `state_read_failed` | State file exists but can't be parsed |
| `drift_fix_failed` | An attempted drift fix via Skill() call failed |
| `jira_fetch_failed` | Jira skill call failed during Tier 3 enrichment |
| `github_fetch_failed` | GitHub CLI call failed during Tier 3 enrichment |

### qa-test
| Code | Trigger |
|------|---------|
| `qa_run_passed` | All ACs pass + smoke tests pass — stage advanced to qa_verified |
| `qa_run_failed` | One or more ACs failed — stage NOT advanced |
| `qa_run_passed_with_blocks` | Passed but some ACs blocked (user confirmed out-of-scope) |
| `dev_server_failed` | yarn start:mock fails to start on port 44389 |
| `chrome_devtools_unavailable` | Chrome DevTools MCP not available (list_pages fails) |
| `chrome_devtools_disconnected` | Chrome DevTools connection lost mid-test |
| `evidence_write_failed` | Cannot write screenshot or results JSON to evidence directory |
| `qa_verification_timeout` | QA run exceeds 30 minutes |

### git (PR_CREATE.md) — additional code
| Code | Trigger |
|------|---------|
| `qa_gate_skipped` | PR created without QA verification (user chose to skip) |

### chrome-verify
| Code | Trigger |
|------|---------|
| `chrome_verify_connection_lost` | Chrome DevTools disconnected mid-verification |
| `chrome_verify_script_error` | evaluate_script threw an error during AC check |
| `chrome_verify_nav_timeout` | Navigation to localhost route timed out |
| `chrome_verify_gotcha_added` | New gotcha pattern learned and appended to GOTCHAS.md (info) |

### review-impl
| Code | Trigger |
|------|---------|
| `obsidian_read_failed` | para_search or para_read fails during plan loading |
| `deep_dive_failed` | deep-dive skill returns no results or times out |

### figma-compare
| Code | Trigger |
|------|---------|
| `chrome_devtools_unavailable` | Chrome DevTools MCP not connected during pre-flight |
| `figma_export_failed` | Figma frame export fails (rate limit, token, seat issue) |
| `localhost_not_running` | Chrome navigation to localhost fails |
