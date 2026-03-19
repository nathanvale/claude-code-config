---
name: confluence-pages
description: Domain knowledge for extracting Confluence pages into clean markdown with provenance. Use when an agent needs to read a Confluence page, detect page state, and normalize the result for local notes or RAG ingestion.
user-invocable: false
---

# Confluence Pages

Operational knowledge for scraping a single Confluence page into a temp markdown artifact. This skill provides page-state detection, metadata extraction targets, and normalization rules. The calling agent owns constraints and output format.

## Purpose

Turn one Confluence page into a clean, provenance-rich markdown document that can later be transformed into a repo note.

## Canonical Inputs

Expect one Confluence page URL, usually one of:

- `https://{site}.atlassian.net/wiki/spaces/{SPACE}/pages/{PAGE_ID}/{slug}`
- `https://{site}.atlassian.net/wiki/x/{short-code}`

If the input is a short URL, navigate until the canonical page URL is known and use that final URL in the extracted artifact.

## Page States

| State | Indicators | Action |
| --- | --- | --- |
| Page content visible | Title + main page content visible | Proceed to metadata and content extraction |
| Loading shell | Atlassian chrome visible but main content empty or skeleton | Wait 3-5s, snapshot again |
| Auth redirect | URL or page content indicates login / SSO / account chooser | Use browser-automation auth flow, then return to target URL |
| Access denied | "You don't have access", permission warning, or blank page after auth | Return `SKIPPED` with permission reason |
| Human gate | CAPTCHA, device approval, or unexpected challenge | Return `NEEDS_HUMAN` |

## Extraction Targets

Capture these fields whenever available:

- `title`
- `canonical_url`
- `space_key`
- `page_id`
- `last_modified`
- `labels`

### Metadata Hints

- `space_key` usually appears in `/spaces/{SPACE}/...`
- `page_id` usually appears in `/pages/{PAGE_ID}/...`
- `title` is the visible page title, not the browser tab prefix
- `last_modified` may appear in page metadata, history text, or byline
- `labels` are useful when visible, but optional

If a field is unavailable, leave it blank in the temp artifact rather than inventing a value.

## Main Content Selection

Prefer the smallest selector that captures the actual page body instead of the whole app shell. Common candidates:

- `main`
- `[role="main"]`
- `article`
- `[data-testid="page-content"]`
- `[data-testid="page-layout.content"]`
- `.wiki-content`
- `#content`

Use the first selector that yields the page body without navigation chrome, sidebars, or comments.

## Normalization Rules

- Preserve heading hierarchy.
- Preserve tables in markdown form when practical.
- Preserve ordered and unordered lists.
- Preserve inline links with their destination URLs when available.
- Preserve code blocks and callouts if visible.
- Flatten Atlassian chrome, breadcrumbs, side panels, reactions, avatars, and comments.
- Expand collapsed content only when a single click reveals meaningful body text and does not mutate page state in a risky way.
- If a macro or panel is visible but cannot be cleanly converted, keep the visible text and add a short note rather than dropping it silently.

## Temp Artifact Format

Write the extracted page to `/tmp/confluence-page-{N}.md` using this structure:

```md
# {title}

## Extracted Metadata
- URL: {canonical_url}
- Space: {space_key}
- Page ID: {page_id}
- Last Modified: {last_modified}
- Labels: {comma-separated labels}

## Extracted Content
{normalized markdown}
```

If labels are unavailable, use an empty value instead of omitting the line. The orchestrator can decide what to persist.

## Quality Bar

- The artifact should be readable by a human without the browser.
- The artifact should be searchable by an LLM without needing Atlassian chrome.
- Prefer a slightly lossy but clean markdown conversion over dumping the entire DOM as noise.
- If the page only partially renders after two attempts, return `FAILED` rather than shipping an obviously incomplete extract.

## Known Gaps

- Atlassian auth can vary by tenant and may not match Monash Okta exactly.
- Expand macros, include macros, and embedded Smart Links may require page-specific handling.
- Attachments are out of scope for the first pass.
