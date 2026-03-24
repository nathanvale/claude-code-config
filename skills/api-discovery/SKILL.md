---
name: api-discovery
description: Discover API endpoint status in gms.api and voucher repos. Checks if an endpoint exists, extracts contracts, or documents patterns for mocking. Returns structured JSON.
allowed-tools: Bash(git:*), Bash(grep:*), Bash(find:*), Bash(ls:*), mcp__plugin_kit_kit__*, mcp__plugin_git_git-intelligence__*, Read, Glob, Grep, Task
context: fork
argument-hint: <entity-name> [--ticket POS-XXXX]
---

# API Discovery: Backend Endpoint Investigation

Composable skill that investigates whether an API endpoint exists in `gms.api` and/or `voucher` repos, extracts the contract if it does, or documents the implementation pattern for MSW mocking if it doesn't.

Designed to be composed into other skills (e.g., `/kickoff`) via `skills: api-discovery`.

## Input

The caller provides:
- **Entity name** — the domain entity to search for (e.g., "sellers", "orders", "designs")
- **Ticket ID** (optional) — linked JIRA ticket for the API work (e.g., POS-3036)
- **Expected contract** (optional) — TypeScript interface or JSON shape the frontend expects

## Output

Return a **structured JSON object** with this shape:

```json
{
  "entity": "sellers",
  "repos": {
    "gms.api": {
      "status": "not_found | exists | in_progress",
      "controller": null | "/path/to/SellersController.cs",
      "route": null | "api/v1/sellers",
      "httpMethods": [],
      "authPolicy": null | "CanGetSellers",
      "queryHandler": null | "/path/to/GetSellersQuery.cs",
      "voucherClientMethod": null | "GetSellers()",
      "responseModel": null | "/path/to/SellersResponse.cs",
      "responseShape": null | "{ sellers: ISeller[] }",
      "apiVersion": null | "1.3",
      "branchName": null | "feat/POS-3037-sellers-proxy",
      "commits": [],
      "similarEndpoint": {
        "name": "Designs",
        "controller": "/path/to/DesignsController.cs",
        "pattern": "Controller → GetDesignsQuery → VoucherApiClient.GetDesigns()"
      }
    },
    "voucher": {
      "status": "not_found | exists | in_progress",
      "controller": null | "/path/to/SellersController.cs",
      "route": null | "sellers",
      "httpMethods": [],
      "authPolicy": null | "CanGetSellers",
      "queryHandler": null | "/path/to/GetSellersQuery.cs",
      "repository": null | "ISellerRepository",
      "cosmosContainer": null | "seller",
      "responseModel": null | "/path/to/SellersResponse.cs",
      "responseShape": null | "{ ... }",
      "apiVersion": null | "1.3",
      "openApiSpec": null | "/path/to/spec.yaml",
      "branchName": null | "feat/POS-3036-sellers-endpoint",
      "commits": [],
      "terraformConfig": null | "container 'seller' in databases variable",
      "similarEndpoint": {
        "name": "Designs",
        "controller": "/path/to/DesignManageController.cs",
        "pattern": "Controller → GetDesignsQuery → DesignRepository → Cosmos"
      }
    }
  },
  "mockStrategy": {
    "mswEndpoint": "GET /api/v1/sellers",
    "responseShape": "ISeller[]",
    "notes": "GMS API proxies transparently — mock at GMS level"
  },
  "discrepancies": [],
  "confidence": "high | medium | low"
}
```

## Workflow

### Step 1: Search Both Repos in Parallel

Launch two parallel investigations — one per repo.

#### gms.api Investigation

Follow the search order from [GMS_API.md](GMS_API.md):

1. **Git history search** — commits mentioning the entity or ticket:
   ```bash
   cd /Users/s1010081/code/gms.api && git log --all --oneline -20 --grep="<entity>" -i
   cd /Users/s1010081/code/gms.api && git log --all --oneline -20 --grep="<ticket_id>"
   ```

2. **Branch search** — feature branches for this work:
   ```bash
   cd /Users/s1010081/code/gms.api && git branch -r | grep -i <entity>
   ```

3. **Controller search** — check if a controller exists:
   ```
   Grep({ pattern: "<Entity>Controller", path: "/Users/s1010081/code/gms.api/src", type: "cs" })
   Glob({ pattern: "**/Controllers/**/<Entity>*Controller*.cs", path: "/Users/s1010081/code/gms.api" })
   ```

4. **Domain model search** — check for response DTOs:
   ```
   Grep({ pattern: "<Entity>Response|<Entity>ViewModel|<Entity>Model", path: "/Users/s1010081/code/gms.api/src", type: "cs" })
   ```

5. **VoucherApiClient search** — check for client method:
   ```
   Grep({ pattern: "Get<Entity>|<entity>", path: "/Users/s1010081/code/gms.api/src/GiftCards.VoucherApiRepository", type: "cs" })
   ```

6. **MediatR query search** — check for query/command:
   ```
   Grep({ pattern: "<Entity>Query|<Entity>Command", path: "/Users/s1010081/code/gms.api/src/GiftCards.Application", type: "cs" })
   ```

#### voucher Investigation

Follow the search order from [VOUCHER_API.md](VOUCHER_API.md):

1. **Git history search** — commits mentioning the entity or ticket:
   ```bash
   cd /Users/s1010081/code/voucher && git log --all --oneline -20 --grep="<entity>" -i
   cd /Users/s1010081/code/voucher && git log --all --oneline -20 --grep="<ticket_id>"
   ```

2. **Branch search** — feature branches:
   ```bash
   cd /Users/s1010081/code/voucher && git branch -r | grep -i <entity>
   ```

3. **Controller search** — check for controller:
   ```
   Grep({ pattern: "<Entity>Controller", path: "/Users/s1010081/code/voucher/src/dotnet/Api/src/dotnet/Voucher.API/Controllers", type: "cs" })
   Glob({ pattern: "**/Controllers/v1/<Entity>*/**/*.cs", path: "/Users/s1010081/code/voucher" })
   ```

4. **Application layer search** — query/command handlers:
   ```
   Grep({ pattern: "<Entity>Query|Get<Entity>", path: "/Users/s1010081/code/voucher/src/dotnet/Api/src/dotnet/Voucher.Application", type: "cs" })
   ```

5. **Repository search** — data access:
   ```
   Grep({ pattern: "I<Entity>Repository|<Entity>Repository", path: "/Users/s1010081/code/voucher/src/dotnet/Core", type: "cs" })
   ```

6. **Cosmos container search** — infrastructure:
   ```
   Grep({ pattern: "<entity>", path: "/Users/s1010081/code/voucher/src/dotnet/Api/deploy", type: "tf" })
   Grep({ pattern: "<entity>", path: "/Users/s1010081/code/voucher/src/dotnet/Api/deploy" })
   ```

7. **OpenAPI spec search** — documented contracts:
   ```
   Grep({ pattern: "<entity>", path: "/Users/s1010081/code/voucher/specs", type: "yaml" })
   ```

### Step 2: Deep Read (if found)

If the endpoint **exists** in either repo:

1. **Read the controller** — extract route, HTTP methods, auth policy, query params
2. **Read the query/handler** — understand the data flow
3. **Read the response model** — extract the exact JSON shape
4. **Read the VoucherApiClient method** (gms.api only) — understand URL construction and versioning

Use `kit_index_overview` first to survey the file, then `Read` only the critical sections.

### Step 3: Find Similar Endpoint (if not found)

If the endpoint does **not** exist:

1. **Find the most architecturally similar existing endpoint** — prefer endpoints in the same domain or with similar data access patterns
2. **Read the similar endpoint's full chain** to document the pattern:
   - gms.api: Controller → Query → Handler → VoucherApiClient method
   - voucher: Controller → Query → Handler → Repository → Cosmos container
3. **Document the pattern** so the implementer knows exactly what files to create and what conventions to follow

**Similarity heuristics for gms.api:**
- Designs endpoint is the closest match for any new "get list of things" endpoint (GET with optional filters, flat array response)
- Orders endpoint is the match for "create something" endpoints (POST with request body)
- Cards endpoint is the match for "get single entity by ID" endpoints

**Similarity heuristics for voucher:**
- DesignManage controller for CRUD endpoints on reference data
- Orders controller for transactional endpoints
- Batches controller for bulk operations

### Step 4: Assess Confidence

| Confidence | Criteria |
|---|---|
| **high** | Endpoint exists and contract is readable, OR similar endpoint is very close match |
| **medium** | Feature branch exists but code is incomplete, OR ticket documents contract but implementation differs |
| **low** | No code, no branch, no spec — relying solely on ticket description for contract |

### Step 5: Check for Discrepancies

Compare across sources:
- Frontend types (if provided) vs backend response model
- JIRA ticket contract description vs actual implementation
- gms.api proxy model vs voucher source model
- Property naming differences (e.g., `canSellPhysical` vs `canSellFixed`)

Report any discrepancies in the output.

## Error Handling

| Scenario | Handling |
|---|---|
| Repo not cloned | Set status to `"repo_not_found"`, skip that repo |
| Git search fails | Fall back to Grep/Glob only |
| Kit tools unavailable | Fall back to Grep/Glob |
| No similar endpoint found | Set `similarEndpoint` to null, confidence to `"low"` |
| Multiple matching controllers | Report all, flag as potential issue |

## Token Budget

This skill should complete within ~30k tokens. Mitigations:
1. Use `response_format: "json"` on all MCP calls
2. Use `kit_index_overview` before `Read`
3. Only deep-read files when endpoint IS found (contract extraction)
4. For "not found" cases, read ONE similar endpoint chain only
5. Git history limited to 20 commits per search
