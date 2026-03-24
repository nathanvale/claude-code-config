---
name: notion
description: Notion API reference for meetings database. Schema, patterns, and common queries.
user-invocable: false
---

# Notion Meetings API Reference

Building block providing architectural knowledge for Notion API skills.

## Database Schema

| Property | Type | Description |
|----------|------|-------------|
| Title | title | Meeting name |
| Date | date | Meeting date/time |
| Status | status | Soon, Objectives, In progress, Solved |
| Priority Level | status | Low, Medium, High |
| Tags | multi_select | Fullstack, Frontend, API, etc. |

## Environment Variables

```bash
NOTION_API_TOKEN        # API token from notion.so/my-integrations
NOTION_MEETINGS_DB_ID   # Database ID: 190a3712-3878-80bc-a320-e79031a71114
```

## Common Query Patterns

### List all (most recent first)
```json
{
  "sorts": [{"property": "Date", "direction": "descending"}],
  "page_size": 20
}
```

### Filter by past week
```json
{
  "filter": {"property": "Date", "date": {"past_week": {}}},
  "sorts": [{"property": "Date", "direction": "descending"}]
}
```

### Search by title
```json
{
  "filter": {"property": "Title", "title": {"contains": "SEARCH_TERM"}},
  "sorts": [{"property": "Date", "direction": "descending"}]
}
```

## API Endpoints

| Operation | Endpoint |
|-----------|----------|
| Query database | `POST /v1/databases/{db_id}/query` |
| Get page | `GET /v1/pages/{page_id}` |
| Get blocks | `GET /v1/blocks/{page_id}/children` |

## Reference

- [Notion API Docs](https://developers.notion.com/reference)
- API Version: `2022-06-28`
