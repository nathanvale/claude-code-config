---
name: notion
description: "Notion MCP via mcporter: search, fetch, create, update, databases, views, comments, users, teams, and meeting notes."
role: tool-workflow
metadata: {"clawdbot":{"requires":{"bins":["mcporter"]}}}
---

# Notion MCP

Use the official hosted Notion MCP through `mcporter`.

## Owner

- Server: `https://mcp.notion.com/mcp`.
- Configured selector: `notion`.
- Transport, auth, call syntax, and generated CLI: `mcporter`.
- Live tool contract: `mcporter list notion --schema`.
- Enhanced Markdown owner: `mcporter resource notion notion://docs/enhanced-markdown-spec`.
- View DSL owner: `mcporter resource notion notion://docs/view-dsl-spec`.

## Setup

Run once per machine when `mcporter list notion --brief` reports unknown server or auth failure:

```bash
mcporter config add notion https://mcp.notion.com/mcp --scope home --auth oauth
mcporter auth notion
```

## Workflow

1. Verify access:

```bash
mcporter list notion --brief
```

2. Inspect exact inputs before choosing a tool:

```bash
mcporter list notion --schema
```

3. Prefer `mcporter call notion.<tool>` for parity with the live MCP surface.
4. Pass nested JSON objects with `--args '<object>'` or `--args -`; `--json '<object>'` is accepted as a compatibility form.
5. Use `--output json` when the result feeds another command or script.

## Capability Map

- Search workspace, connected sources, pages, data sources, and users with `notion-search`.
- Fetch pages, databases, data sources, transcripts, and discussions with `notion-fetch`.
- Create, update, move, duplicate, or template pages with page tools.
- Create databases and update data sources with database/data-source tools.
- Query database views and meeting notes with query tools.
- Create or update database views with view tools.
- Read/write comments with comment tools.
- Look up users and teams with directory tools.

Run `mcporter list notion --brief` for the current complete tool list.

## Common Calls

Search:

```bash
mcporter call notion.notion-search query="release notes" page_size=5 --output json
```

Fetch:

```bash
mcporter call notion.notion-fetch id="<page-or-database-url-or-id>" --output json
```

Fetch raw meeting transcript:

```bash
mcporter call notion.notion-fetch id="<page-id>" include_transcript=true --output json
```

Scope search to a data source:

```bash
mcporter call notion.notion-search query="design review" data_source_url="collection://<data-source-id>" page_size=10 --output json
```

Query a view:

```bash
mcporter call notion.notion-query-database-view view_url="<notion-view-url>" page_size=25 --output json
```

Read comments:

```bash
mcporter call notion.notion-get-comments page_id="<page-id>" include_resolved=true --output json
```

## Write Safety

- Confirm intent before create, update, move, duplicate, comment, database, data-source, or view writes unless the user explicitly requested the exact mutation.
- Fetch the target page, database, data source, or view before mutating it.
- Read `notion://docs/enhanced-markdown-spec` before creating or updating page content.
- Read `notion://docs/view-dsl-spec` before creating or updating views.
- For database page creation, fetch the database first and use the returned `collection://` data source ID.
- Use property names from fetched data-source schema.
- Do not infer private workspace placement when the parent is unclear.
- Report the changed page, database, data source, view, or comment ID after writes.

## Known Pitfalls

- Search is semantic and bounded; use low `page_size` for lookup, then fetch exact results.
- Database URLs are not data-source URLs; fetch the database and use `collection://...`.
- Hosted Notion MCP does not expose page delete or page trash; use signed-in Notion UI or another explicit API route for page removal.
- `in_trash` is available for data sources, not ordinary page deletion.
- Page content uses Notion enhanced Markdown, not arbitrary Markdown.
- Transcript summaries may be generated; use raw transcript blocks when attribution matters.
- Parallel OAuth attempts can race; run `mcporter auth notion` serially after token errors.

## Generated CLI

Use this only when a repeatable shell surface is needed:

```bash
mcporter generate-cli notion --bundle dist/notion-mcp.js
mcporter inspect-cli dist/notion-mcp.js
```

Generated CLI artifacts embed a schema snapshot. Regenerate when `mcporter list notion --brief` shows new or changed tools.

## Verification

```bash
mcporter list notion --brief
mcporter resource notion
mcporter call notion.notion-search query=healthcheck page_size=1 --output json
```

YAML-parse this file after edits.
