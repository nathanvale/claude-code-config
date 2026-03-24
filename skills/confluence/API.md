# Confluence API Reference

## Connection

| Setting | Value |
|---|---|
| Base URL | `https://bunnings.atlassian.net/wiki` |
| API Version | v2 (`/api/v2/`) |
| Auth | Basic: `nathan.vale1@bunnings.com.au:$(printenv JIRA_API_TOKEN)` |
| Content-Type | `application/json` |

## Endpoints

### Create Page

```
POST /api/v2/pages
```

```json
{
  "spaceId": "4686282742",
  "status": "current",
  "title": "Page Title",
  "parentId": "15317172325",
  "body": {
    "representation": "storage",
    "value": "<h2>HTML content</h2><p>Storage format</p>"
  }
}
```

**Response:** Returns full page object with `id`, `title`, `_links.webui`.

### Update Page

```
PUT /api/v2/pages/{pageId}
```

```json
{
  "id": "PAGE_ID",
  "status": "current",
  "title": "Page Title",
  "parentId": "PARENT_ID",
  "version": {
    "number": 2,
    "message": "Updated content"
  },
  "body": {
    "representation": "storage",
    "value": "<h2>Updated HTML</h2>"
  }
}
```

**CRITICAL GOTCHA:** You MUST include the full `body.value` content when updating. If the body field is empty or omitted, the page content gets **permanently wiped to blank**. Always fetch current content first if doing partial updates.

### Get Page

```
GET /api/v2/pages/{pageId}?body-format=storage
```

Returns page with body content in storage format.

### Search Pages

```
GET /api/v2/pages?space-id=4686282742&title=EXACT_TITLE
```

Use this to check for duplicates before creating.

## Default Page Locations

| Location | Page ID | Path |
|---|---|---|
| Gift Card (GMS) Technical Plans | `15317172325` | Architecture - Projects > Gift Card (GMS) Technical Plans |
| Architecture - Projects | `13808602239` | Root architecture folder |
| Store Platforms Home | `4685632118` | Space home page |

## Space Configuration

| Property | Value |
|---|---|
| Space Key | `TDM` |
| Space ID | `4686282742` |
| Space Name | Store Platforms |

## Auth Pattern

All curl calls use this auth pattern:

```bash
curl -s \
  -u "nathan.vale1@bunnings.com.au:$(printenv JIRA_API_TOKEN)" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  "https://bunnings.atlassian.net/wiki/api/v2/..."
```

The `JIRA_API_TOKEN` environment variable works for both JIRA and Confluence (same Atlassian Cloud instance).

## URL Construction

Page URLs follow this pattern:
```
https://bunnings.atlassian.net/wiki/spaces/{SPACE_KEY}/pages/{PAGE_ID}/{URL_ENCODED_TITLE}
```

The simplest reliable form (title optional):
```
https://bunnings.atlassian.net/wiki/spaces/TDM/pages/{PAGE_ID}
```

## Error Codes

| Code | Cause | Fix |
|---|---|---|
| 400 | Duplicate title, malformed body | Check title uniqueness, validate HTML |
| 401 | Token expired or invalid | Regenerate JIRA_API_TOKEN |
| 403 | No permission to space/page | Check Confluence space permissions |
| 404 | Space or parent page not found | Verify space ID and parent page ID |
| 413 | Body too large | Split into sub-pages |
| Connection refused | Proxy misconfiguration | Run `proxy-off` if off VPN |

## Storage Format Notes

- Uses HTML with Confluence-specific `ac:` macros
- `<ac:structured-macro ac:name="info">` for info panels
- Tables need `<colgroup>` with `<col />` elements
- Use `<tbody>` directly (no `<thead>`)
- Em dashes: `&mdash;` not raw `—`
- Code inline: `<code>text</code>`
