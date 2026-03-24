# gms.api Architecture Reference

Quick reference for navigating the GMS API repository. Use this to know exactly where to look.

**Repo path:** `/Users/s1010081/code/gms.api`

## Architecture

Clean-architecture ASP.NET Core API using MediatR CQRS pattern:

```
HTTP Request
  → Controller (thin, dispatches to MediatR)
    → Query/Command (request object)
      → Handler (business logic)
        → VoucherApiClient (HTTP calls to Voucher API)
          → Voucher API
```

## Project Structure

| Layer | Path | Purpose |
|-------|------|---------|
| API | `src/GiftCards.Api/` | Controllers, auth, middleware, DI |
| Application | `src/GiftCards.Application/` | MediatR queries, commands, handlers |
| Domain | `src/GiftCards.Domain/` | Models, ViewModels, DTOs, constants |
| Persistence | `src/GiftCards.Persistence/` | Entity Framework, migrations |
| VoucherApiClient | `src/GiftCards.VoucherApiRepository/` | HTTP client for Voucher API |
| EventApiClient | `src/GiftCards.EventApiRepository/` | Event API HTTP client |
| Tests | `src/Tests/` | Unit + integration tests |

## Controllers

All controllers at `src/GiftCards.Api/Controllers/v1/`:

| Controller | Route | Key Actions |
|-----------|-------|-------------|
| BaseController | (abstract) | Provides `Mediator` property |
| CardsController | `api/v1/cards` | Get, StoresGet, Cancel, BulkActivate, OperatorReplace |
| OrdersController | `api/v1/orders` | GetOrders, CreateOrder |
| FulfilmentsController | `api/v1/fulfilments` | Summary, Fulfilments, FulfilmentEvents |
| FulfilmentController | `api/v1/fulfilment` | Event operations (Pick, Complete, Cancel) |
| DesignsController | `api/v1/` | Designs, Hangsells, Items, Image |
| FeedsController | `api/v1/feeds` | Card feeds |
| BizTalkIntegrationController | `api/v1/biztalkintegration` | Legacy integration |

## CQRS Pattern (Complete Example)

### Controller

```csharp
// src/GiftCards.Api/Controllers/v1/DesignsController.cs
[HttpGet("designs")]
[Authorize(policy: CanGetDesignImage.PrivilegeName)]
public async Task<ActionResult<IEnumerable<Design>>> Designs(CancellationToken cancellationToken)
{
    var designs = await Mediator.Send(new GetDesignsQuery(), cancellationToken);
    return Ok(designs);
}
```

### Query + Handler

```csharp
// src/GiftCards.Application/VoucherAPI/Queries/GetDesignsQuery.cs
public class GetDesignsQuery : IRequest<IEnumerable<Design>>
{
    public class Handler(IVoucherApiClient voucherApiClient)
        : IRequestHandler<GetDesignsQuery, IEnumerable<Design>>
    {
        public async Task<IEnumerable<Design>> Handle(
            GetDesignsQuery request, CancellationToken cancellationToken)
        {
            return await voucherApiClient.GetDesigns(cancellationToken);
        }
    }
}
```

### VoucherApiClient Method

```csharp
// src/GiftCards.VoucherApiRepository/VoucherApiClient.cs
public async Task<IEnumerable<Design>> GetDesigns(CancellationToken cancellationToken)
{
    var urlBuilder = new StringBuilder("");
    urlBuilder.Append(_voucherApiUrl.TrimEnd('/')).Append("/design");
    // ... query param construction ...
    var responseMessage = await Get(urlBuilder.ToString(), _voucherApiVersion, MediaType, cancellationToken);
    var responseString = await responseMessage.Content.ReadAsStringAsync(cancellationToken);
    return JsonConvert.DeserializeObject<IEnumerable<Design>>(responseString);
}
```

## Key Conventions

### URL Construction
VoucherApiClient builds URLs with StringBuilder:
```csharp
var urlBuilder = new StringBuilder("");
urlBuilder.Append(_voucherApiUrl.TrimEnd('/')).Append("/<entity>");
// Query params via List<string> + Uri.EscapeDataString
```

### Versioning
- HTTP header: `x-version-api` (e.g., "1.3")
- Per-query constant: `private const string VoucherApiVersion = "1.3";`

### Authorization
- Privilege classes in `src/GiftCards.Api/Auth/Privileges/`
- Applied via `[Authorize(policy: CanDoThing.PrivilegeName)]`
- Each privilege defines scopes (ReadScope, AdminScope, SupportScope, etc.)

### DI Registration
- MediatR auto-scans `GiftCards.Application` assembly for handlers
- HttpClients registered in `src/GiftCards.Api/Extensions/EndpointServiceExtensions.cs`
- New controllers are auto-discovered (ASP.NET convention)
- New privileges auto-discovered from assembly scanning

### Response Models
- Voucher API responses: `src/GiftCards.Domain/Models/VoucherApi/`
- ViewModels (GMS-specific): `src/GiftCards.Domain/ViewModels/`
- Design models: `src/GiftCards.Domain/ViewModels/Designs/`

### Error Handling
- `ProblemDetailsException` for HTTP errors
- 404 → "not found", 400 → validation error, other → 500

## Adding a New Endpoint (Pattern)

To proxy a new Voucher API endpoint through gms.api:

1. **VoucherApiClient** — Add method in `VoucherApiClient.cs` + interface `IVoucherApiClient.cs`
2. **Domain model** — Add response DTO in `GiftCards.Domain/Models/VoucherApi/` or `ViewModels/`
3. **Query** — Create `Get<Entity>Query.cs` in `GiftCards.Application/VoucherAPI/Queries/<Entity>/`
4. **Controller** — Add action in existing controller or create new `<Entity>Controller.cs`
5. **Privilege** — Create `Can<Action>.cs` in `GiftCards.Api/Auth/Privileges/`
6. **Tests** — Add handler + controller tests

## Search Strategy

To check if an entity endpoint exists, search in this order (cheapest first):

1. `git log --all --oneline --grep="<entity>" -i` (commits)
2. `git branch -r | grep -i <entity>` (feature branches)
3. Grep for `<Entity>Controller` in `src/GiftCards.Api/Controllers/` (.cs files)
4. Grep for `<Entity>Query|<Entity>Command` in `src/GiftCards.Application/` (.cs files)
5. Grep for `Get<Entity>|<entity>` in `src/GiftCards.VoucherApiRepository/` (.cs files)
6. Grep for `<Entity>Response|<Entity>Model` in `src/GiftCards.Domain/` (.cs files)
