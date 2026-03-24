# Figma API Endpoints

Base URL: `https://api.figma.com/v1`

## Files

| Endpoint | Method | Purpose | Tier | Scope |
|----------|--------|---------|------|-------|
| `/files/:key` | GET | Get file JSON (full document tree) | 2 | `file_content:read` |
| `/files/:key?depth=N` | GET | Get file with limited depth | 2 | `file_content:read` |
| `/files/:key?ids=X,Y` | GET | Get specific nodes only | 2 | `file_content:read` |
| `/files/:key/nodes?ids=X` | GET | Get node with full properties | 2 | `file_content:read` |
| `/files/:key/versions` | GET | Get version history | 3 | `file_content:read` |
| `/files/:key/meta` | GET | Get file metadata only | 3 | `file_metadata:read` |

### File Parameters

| Param | Type | Description |
|-------|------|-------------|
| `version` | string | Specific version ID |
| `ids` | string | Comma-separated node IDs |
| `depth` | integer | Document tree depth (default: full) |
| `geometry` | string | `paths` for vector data |
| `plugin_data` | string | `shared` or plugin IDs |
| `branch_data` | boolean | Include branch info |

## Images

| Endpoint | Method | Purpose | Tier | Scope |
|----------|--------|---------|------|-------|
| `/images/:key` | GET | Render nodes as images | 1 | `file_content:read` |
| `/files/:key/images` | GET | Get image fill URLs | 2 | `file_content:read` |

### Image Parameters

| Param | Type | Description | Default |
|-------|------|-------------|---------|
| `ids` | string | **Required.** Comma-separated node IDs | - |
| `scale` | number | Render scale (0.01-4) | 1 |
| `format` | string | `png`, `jpeg`, `svg`, `pdf` | png |
| `svg_outline_text` | boolean | Outline text in SVG | true |
| `svg_include_id` | boolean | Include layer name in SVG id | false |
| `svg_include_node_id` | boolean | Include node id in data attribute | false |
| `use_absolute_bounds` | boolean | Use absolute bounds | false |
| `contents_only` | boolean | Exclude overlapping content | true |

**Note:** Image URLs expire after 30 days.

## Components & Styles

| Endpoint | Method | Purpose | Tier | Scope |
|----------|--------|---------|------|-------|
| `/files/:key/components` | GET | List file components | 2 | `file_content:read` |
| `/files/:key/component_sets` | GET | List component sets | 2 | `file_content:read` |
| `/files/:key/styles` | GET | List file styles | 2 | `file_content:read` |
| `/teams/:id/components` | GET | List team components | 2 | `file_content:read` |
| `/teams/:id/styles` | GET | List team styles | 2 | `file_content:read` |

## Variables

| Endpoint | Method | Purpose | Tier | Scope |
|----------|--------|---------|------|-------|
| `/files/:key/variables/local` | GET | Get local variables | 2 | `file_variables:read` |
| `/files/:key/variables/published` | GET | Get published variables | 2 | `file_variables:read` |
| `/files/:key/variables` | POST | Create/update/delete variables | 1 | `file_variables:write` |

**Note:** Variables API is available to Enterprise org members only.

### Variables Response Structure

```json
{
  "meta": {
    "variableCollections": {
      "1:234": {
        "id": "1:234",
        "name": "Colors",
        "modes": [
          { "modeId": "1:0", "name": "Light" },
          { "modeId": "1:1", "name": "Dark" }
        ],
        "defaultModeId": "1:0"
      }
    },
    "variables": {
      "1:567": {
        "id": "1:567",
        "name": "primary-color",
        "resolvedType": "COLOR",
        "valuesByMode": {
          "1:0": { "r": 0.2, "g": 0.4, "b": 0.8, "a": 1 },
          "1:1": { "r": 0.3, "g": 0.5, "b": 0.9, "a": 1 }
        },
        "scopes": ["ALL_FILLS"],
        "codeSyntax": {
          "WEB": "--color-primary",
          "ANDROID": "colorPrimary",
          "iOS": "colorPrimary"
        }
      }
    }
  }
}
```

### Variable Types

| Type | Description |
|------|-------------|
| `BOOLEAN` | True/false values |
| `FLOAT` | Numbers (spacing, sizing) |
| `STRING` | Text values |
| `COLOR` | RGBA color values |

## Comments

| Endpoint | Method | Purpose | Tier | Scope |
|----------|--------|---------|------|-------|
| `/files/:key/comments` | GET | List file comments | 3 | `file_comments:read` |
| `/files/:key/comments` | POST | Post new comment | 2 | `file_comments:write` |
| `/files/:key/comments/:id` | DELETE | Delete comment | 2 | `file_comments:write` |
| `/files/:key/comments/:id/reactions` | GET | Get comment reactions | 3 | `file_comments:read` |
| `/files/:key/comments/:id/reactions` | POST | Add reaction | 3 | `file_comments:write` |

### Post Comment Request

```json
{
  "message": "Implementation matches design",
  "comment_id": "123",
  "client_meta": {
    "node_id": "1:234",
    "node_offset": { "x": 100, "y": 200 }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message` | string | Comment text (required) |
| `comment_id` | string | Reply to existing comment |
| `client_meta.node_id` | string | Attach to specific node |
| `client_meta.node_offset` | object | Position within node |

### Comment Response

```json
{
  "id": "456",
  "message": "Implementation matches design",
  "created_at": "2024-01-19T10:30:00Z",
  "user": {
    "id": "789",
    "handle": "designer",
    "img_url": "https://..."
  },
  "client_meta": {
    "node_id": "1:234"
  },
  "resolved_at": null
}
```

## Dev Resources

| Endpoint | Method | Purpose | Tier | Scope |
|----------|--------|---------|------|-------|
| `/files/:key/dev_resources` | GET | Get dev resources | 2 | `file_dev_resources:read` |
| `/files/:key/dev_resources` | POST | Create dev resources | 2 | `file_dev_resources:write` |
| `/files/:key/dev_resources` | PUT | Update dev resources | 2 | `file_dev_resources:write` |
| `/files/:key/dev_resources` | DELETE | Delete dev resources | 2 | `file_dev_resources:write` |

### Create Dev Resource Request

```json
{
  "dev_resources": [
    {
      "name": "React Component",
      "url": "https://github.com/org/repo/blob/main/src/Button.tsx",
      "file_key": "abc123",
      "node_id": "1:234"
    }
  ]
}
```

### Dev Resource Response

```json
{
  "dev_resources": [
    {
      "id": "dev_resource_id",
      "name": "React Component",
      "url": "https://github.com/org/repo/blob/main/src/Button.tsx",
      "file_key": "abc123",
      "node_id": "1:234"
    }
  ]
}
```

## Users & Teams

| Endpoint | Method | Purpose | Tier | Scope |
|----------|--------|---------|------|-------|
| `/me` | GET | Get current user | 3 | `current_user:read` |
| `/teams/:id/projects` | GET | List team projects | 3 | `files:read` |
| `/projects/:id/files` | GET | List project files | 3 | `files:read` |

## Webhooks

| Endpoint | Method | Purpose | Tier | Scope |
|----------|--------|---------|------|-------|
| `/webhooks` | GET | List webhooks | 3 | `webhooks:write` |
| `/webhooks` | POST | Create webhook | 2 | `webhooks:write` |
| `/webhooks/:id` | GET | Get webhook | 3 | `webhooks:write` |
| `/webhooks/:id` | PUT | Update webhook | 2 | `webhooks:write` |
| `/webhooks/:id` | DELETE | Delete webhook | 2 | `webhooks:write` |

### Create Webhook Request

```json
{
  "event_type": "FILE_UPDATE",
  "team_id": "team_id",
  "endpoint": "https://your-server.com/webhook",
  "passcode": "your_secret",
  "description": "Notify on file changes"
}
```

### Webhook Event Types

| Event | Description |
|-------|-------------|
| `FILE_UPDATE` | File was modified |
| `FILE_DELETE` | File was deleted |
| `FILE_VERSION_UPDATE` | New version created |
| `FILE_COMMENT` | Comment added |
| `LIBRARY_PUBLISH` | Library was published |

### Webhook Payload

```json
{
  "event_type": "FILE_UPDATE",
  "file_key": "abc123",
  "file_name": "Design File",
  "timestamp": "2024-01-19T10:30:00Z",
  "triggered_by": {
    "id": "user_id",
    "handle": "designer"
  }
}
```

## Rate Limit Tiers

| Tier | Description | Example Endpoints |
|------|-------------|-------------------|
| 1 | Heavy operations | Image rendering, variable writes |
| 2 | Standard reads | Files, nodes, components, styles |
| 3 | Light operations | User info, comments list, webhooks list |

See [RATE-LIMITS.md](RATE-LIMITS.md) for detailed limits by seat type.

## Response Patterns

### Success Response

```json
{
  "name": "File Name",
  "document": { ... },
  "components": { ... },
  "styles": { ... },
  "version": "1234567890"
}
```

### Error Response

```json
{
  "status": 403,
  "err": "Forbidden"
}
```

### Common Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad request (invalid params) |
| 403 | Forbidden (token lacks scope/access) |
| 404 | Not found (invalid file/node) |
| 429 | Rate limited |
| 500 | Server error |
