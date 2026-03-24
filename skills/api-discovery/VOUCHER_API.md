# Voucher API Architecture Reference

Quick reference for navigating the Voucher repository. Use this to know exactly where to look.

**Repo path:** `/Users/s1010081/code/voucher`

## Architecture

Clean-architecture .NET API with MediatR CQRS and Cosmos DB:

```
HTTP Request
  → Controller (versioned, partial classes)
    → Query/Command (MediatR request)
      → Handler (business logic)
        → Repository (BaseRepository<T>)
          → CosmosDbService
            → Cosmos DB Container
```

## Project Structure

| Layer | Path | Purpose |
|-------|------|---------|
| API | `src/dotnet/Api/src/dotnet/Voucher.API/` | Controllers, auth, models |
| Application | `src/dotnet/Api/src/dotnet/Voucher.Application/` | MediatR queries, commands, handlers |
| Domain | `src/dotnet/Core/src/dotnet/Bunnings.Voucher.Core.Domain/` | Entities, repositories, Cosmos services |
| Tests (unit) | `src/dotnet/Api/src/dotnet/Tests/Voucher.API.Tests/` | Unit tests |
| Tests (integration) | `src/dotnet/Api/src/dotnet/Voucher.API.Integration.Tests/` | Integration tests |
| Tests (auto) | `tests/Voucher.API.AutoTests/` | Automated acceptance tests |
| Infrastructure | `src/dotnet/Api/deploy/infra/` | Terraform for Cosmos DB |
| OpenAPI Specs | `specs/oas/` | Version-specific YAML specs |

## Controllers

All at `src/dotnet/Api/src/dotnet/Voucher.API/Controllers/v1/`:

| Controller | Subdirectory | Key Actions |
|-----------|-------------|-------------|
| ApiController | (root) | Discovery endpoint |
| VoucherController | `Voucher/` | GetBalance, GetDetails, GetEvents, Create |
| RenderImageController | `Voucher/` | Render voucher as PDF/image |
| OrdersController | `Orders/` | CreateOrder, GetAllOrders |
| EventsController | `Events/` | Activate, Redeem, Cancel, PreAuth, OperatorReplace |
| FulfilmentsController | `Fulfilments/` | GetFulfilments, workflow events |
| FulfilmentController | `Fulfilments/` | Single fulfilment operations |
| DesignManageController | `DesignManage/` | CRUD designs, images, hang sells |
| DesignUsageController | `DesignUsage/` | Encode/decode design tokens |
| BatchesController | `Batches/` | Batch operations |
| GiftcardController | `Giftcard/` | Digital giftcard registration |
| ItemsController | `Items/` | Item/SKU operations |
| InitiateJobsController | `InitiateJobs/` | Background job triggers |
| VoucherActionsController | `VoucherActions/` | Balance check, refund |

## Controller File Naming Convention

Controllers use **partial classes** split by operation and version:

```
{Controller}.cs                           — Base class, shared logic
{Controller}.{Operation}.{HttpMethod}.V{Major}_{Minor}.cs  — Version-specific
```

Examples:
- `DesignManageController.cs` (base)
- `DesignManageController.GET.V1_0.cs` (GET operations for v1.0)
- `DesignManageController.Put.V1_0.cs` (PUT operations)
- `DesignManageController.Delete.V1_0.cs` (DELETE operations)
- `DesignManageController.Image.GET.V1_0.cs` (image-specific GET)

## CQRS Pattern (Complete Example)

### Controller

```csharp
// Controllers/v1/Orders/OrdersController.cs
[HttpGet]
[MapToApiVersion(Constants.V1_2), MapToApiVersion(Constants.V1_3)]
[Authorize(policy: CanGetOrders.PrivilegeName)]
public async Task<ActionResult<GetAllOrdersResponse>> GetAllOrders(
    [FromQuery] GetAllOrdersRequest request, CancellationToken cancellationToken)
{
    var response = await Mediator.Send(
        new GetAllOrdersQuery(request.Top, request.ContinuationToken),
        cancellationToken);
    return Ok(response);
}
```

### Query + Handler

```csharp
// Voucher.Application/Orders/Query/GetAllOrders/GetAllOrdersQuery.cs
public record GetAllOrdersQuery(int? Top, string? ContinuationToken)
    : IRequest<GetAllOrdersResponse>;

public class GetAllOrdersQueryHandler(IOrderRepository orderRepository)
    : IRequestHandler<GetAllOrdersQuery, GetAllOrdersResponse>
{
    public async Task<GetAllOrdersResponse> Handle(
        GetAllOrdersQuery request, CancellationToken cancellationToken)
    {
        var orders = await orderRepository.GetItems(
            request.Top, request.ContinuationToken, cancellationToken);
        return orders.ToResponse();
    }
}
```

### Repository

```csharp
// Bunnings.Voucher.Core.Domain/Orders/OrderRepository.cs
public class OrderRepository : BaseRepository<Order>, IOrderRepository
{
    // Inherits: Records, GetItems, GetItem, AddItemAsync, UpdateItemAsync
    // BaseRepository wraps CosmosDbService
}
```

## Cosmos DB Access

### Repository Pattern
- All repos extend `BaseRepository<T>`
- Base provides: `Records` (LINQ), `GetItems()` (OData + continuation), `AddItemAsync()`, `UpdateItemAsync()`
- `CosmosDbService` wraps the Cosmos SDK with idempotency support
- Entities implement `ICosmosEntity` (Id, PartitionKey, ETag)

### Known Containers
From Terraform config (`src/dotnet/Api/deploy/infra/`):
- voucher, order, fulfilment, design, batch, item, event
- **seller** (renamed from "reseller" in POS-3008)
- preauth, communication, exportvoucher

### Container Search
```
Grep({ pattern: "<entity>", path: "/Users/s1010081/code/voucher/src/dotnet/Api/deploy", type: "tf" })
```

## Authorization

Privilege-based, same pattern as gms.api:
- Privilege classes in `Voucher.API/Auth/Privileges/{Domain}/`
- Applied via `[Authorize(policy: CanDoThing.PrivilegeName)]`
- Scopes: ReadScope, ManageScope

## API Versioning

- Header-based: `x-version-api` (values: "1.0", "1.1", "1.2", "1.3")
- `[MapToApiVersion(Constants.V1_3)]` on controller actions
- New endpoints typically target v1.3

## OpenAPI Specs

Location: `specs/oas/`

Spec naming: `Voucher.{Scope}.API.v{Major}_{Minor}.oas.swagger.yaml`
- Scopes: Read, Manage, Customer, Partner, Public, My, Refund

To check if an entity is documented:
```
Grep({ pattern: "<entity>", path: "/Users/s1010081/code/voucher/specs", type: "yaml" })
```

## Application Layer Organization

Queries and commands at `src/dotnet/Api/src/dotnet/Voucher.Application/`:

```
Voucher.Application/
├── Vouchers/          → Query/Command for voucher operations
├── Orders/            → Order queries and commands
├── Events/            → Event handlers (activate, redeem, etc.)
├── Designs/           → Design management
├── Fulfilments/       → Fulfilment queries
├── Batches/           → Batch processing
├── Items/             → Item queries
└── {NewEntity}/       → Pattern for new domains
```

## Adding a New Endpoint (Pattern)

1. **Entity** — Create domain entity in `Bunnings.Voucher.Core.Domain/{Entity}/`
2. **Repository** — Create `I{Entity}Repository` + `{Entity}Repository` extending `BaseRepository<{Entity}>`
3. **Query/Command** — Create in `Voucher.Application/{Entity}/Query/` or `Command/`
4. **Controller** — Create `{Entity}Controller.cs` in `Controllers/v1/{Entity}/`
5. **Privilege** — Create `Can{Action}.cs` in `Auth/Privileges/{Entity}/`
6. **Request/Response** — Create in `Voucher.API/Models/` and `Voucher.Application/{Entity}/Query/`
7. **DI** — Repository auto-discovered via assembly scanning; controller auto-discovered by ASP.NET
8. **OpenAPI** — Update or generate spec in `specs/oas/`
9. **Terraform** — Add Cosmos container if needed in `deploy/infra/`

## Search Strategy

To check if an entity endpoint exists, search in this order (cheapest first):

1. `git log --all --oneline --grep="<entity>" -i` (commits)
2. `git branch -r | grep -i <entity>` (feature branches)
3. Grep for `<Entity>Controller` in `Controllers/v1/` (.cs files)
4. Grep for `<Entity>Query|Get<Entity>` in `Voucher.Application/` (.cs files)
5. Grep for `I<Entity>Repository` in `Bunnings.Voucher.Core.Domain/` (.cs files)
6. Grep for `<entity>` in `deploy/infra/` (.tf files) — Cosmos containers
7. Grep for `<entity>` in `specs/oas/` (.yaml files) — OpenAPI specs

## Recent History (Seller-Specific)

The "seller" entity has a known history:
- **POS-3008**: Renamed "reseller" container to "seller" (commits ab876eb, bfcb9b5, 96fa3b0)
- **BUNDIG-59414**: Originally added "reseller" container (commit f614f97)
- Container exists in Cosmos DB but **no /sellers API endpoint exists yet**
- The seller Cosmos container has a unique constraint added during rename
