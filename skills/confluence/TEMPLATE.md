# Confluence Technical Plan Template

This is the Confluence storage format (HTML) template for technical plan pages. Read this file, substitute all `{{VARIABLE}}` placeholders with generated HTML content, then POST to the Confluence API.

## Variables

| Variable | Required | Description |
|---|---|---|
| `{{TICKET}}` | Yes | JIRA ticket ID (e.g., POS-3044) |
| `{{JIRA_URL}}` | Yes | Full JIRA URL: `https://bunnings.atlassian.net/browse/{TICKET}` |
| `{{TITLE}}` | Yes | Short plan title/summary |
| `{{AUTHOR}}` | Yes | Author name (default: Nathan Vale) |
| `{{REVIEWER}}` | Yes | Reviewer name |
| `{{DATE}}` | Yes | Today's date (YYYY-MM-DD) |
| `{{OVERVIEW}}` | Yes | 1-2 sentence description of the plan |
| `{{CURRENT_STATE}}` | Yes | HTML: what exists today |
| `{{APPROACH}}` | Yes | HTML: high-level approach summary |
| `{{PHASES}}` | Yes | HTML: all implementation phases (each with `<h2>`) |
| `{{TESTS}}` | Yes | HTML: test plan (unit + component sections) |
| `{{OUT_OF_SCOPE}}` | Yes | HTML: bulleted list of exclusions |
| `{{API_DEPENDENCIES}}` | No | HTML: table rows for external dependencies |
| `{{OPEN_QUESTIONS}}` | No | HTML: numbered list of unresolved questions |
| `{{KEY_FILES}}` | Yes | HTML: table rows of purpose + file path |

## Template

```html
<ac:structured-macro ac:name="info">
<ac:rich-text-body>
<table><colgroup><col /><col /></colgroup><tbody>
<tr><td><strong>Ticket</strong></td><td><a href="{{JIRA_URL}}">{{TICKET}}</a></td></tr>
<tr><td><strong>Author</strong></td><td>{{AUTHOR}}</td></tr>
<tr><td><strong>Reviewer</strong></td><td>{{REVIEWER}}</td></tr>
<tr><td><strong>Date</strong></td><td>{{DATE}}</td></tr>
</tbody></table>
</ac:rich-text-body>
</ac:structured-macro>

<h2>Overview</h2>
<p>{{OVERVIEW}}</p>

<h2>Current State</h2>
{{CURRENT_STATE}}

<h2>Approach</h2>
{{APPROACH}}

{{PHASES}}

<h2>Tests</h2>
{{TESTS}}

<h2>Out of Scope</h2>
{{OUT_OF_SCOPE}}

<h2>API Dependencies</h2>
<table><colgroup><col /><col /><col /><col /></colgroup><tbody>
<tr><th>Dependency</th><th>Ticket</th><th>Status</th><th>Owner</th></tr>
{{API_DEPENDENCIES}}
</tbody></table>

<h2>Open Questions</h2>
{{OPEN_QUESTIONS}}

<h2>Key Files</h2>
<table><colgroup><col /><col /></colgroup><tbody>
<tr><th>Purpose</th><th>File</th></tr>
{{KEY_FILES}}
</tbody></table>
```

## Section Patterns

Use these HTML patterns when building section content:

### Current State (bulleted list with bold labels)
```html
<ul>
<li><strong>Exists:</strong> <code>ISeller</code> type, RTK Query endpoint, MSW mocks</li>
<li><strong>Gap:</strong> Distributor orders bypass seller filtering</li>
</ul>
```

### Approach (paragraph with inline code)
```html
<p>Build on the existing seller filtering architecture. The helpers (<code>filterDesignsBySeller</code>, <code>getDenominationPermissions</code>) already work &mdash; feed them the correct seller based on order type.</p>
```

### Phase (heading + optional table or list)
```html
<h2>Phase 1: Type and Mock Updates</h2>
<table><colgroup><col /><col /></colgroup><tbody>
<tr><th>Change</th><th>Detail</th></tr>
<tr><td>Update <code>ISeller</code> type</td><td>Rename <code>canSellPhysical</code> to <code>canSellFixed</code></td></tr>
</tbody></table>
```

### Phase with sub-sections
```html
<h2>Phase 2: Seller Selection Logic</h2>
<h3>2a. Fix sellers query trigger</h3>
<p><code>CreateBulkPrintOrderPage.tsx</code> &mdash; change skip condition.</p>
<h3>2b. New helper</h3>
<p>Filters sellers where:</p>
<ul>
<li><code>contact.countryCode</code> matches selected currency</li>
<li><code>canSellFixed === true</code> OR <code>canSellSettable === true</code></li>
</ul>
```

### Tests
```html
<h3>Unit Tests &mdash; SellerFilterHelpers.ts</h3>
<ul>
<li><code>getDistributorSellers</code> &mdash; filtering by country + permissions</li>
<li>Edge case: <code>physicalVoucher</code> not populated &mdash; excluded</li>
</ul>
<h3>Component Tests &mdash; distributor selection flow</h3>
<ul>
<li>Selecting distributor filters designs correctly</li>
<li>Changing currency resets distributor</li>
</ul>
```

### Out of Scope
```html
<ul>
<li>GMS API proxy (POS-3037) &mdash; mocked via MSW</li>
<li>Empty <code>fixedDenominationValues[]</code> edge case (POS-3133)</li>
</ul>
```

### API Dependencies (table rows only)
```html
<tr><td>Voucher API <code>GET /sellers</code></td><td><a href="https://bunnings.atlassian.net/browse/POS-3036">POS-3036</a></td><td>In Progress</td><td>Prasanth</td></tr>
```

### Open Questions
```html
<ol>
<li>The existing type uses <code>canSellPhysical</code> but the JIRA contract says <code>canSellFixed</code>. Going with <code>canSellFixed</code> &mdash; Prasanth to confirm.</li>
</ol>
```

### Key Files (table rows only)
```html
<tr><td>Create order page</td><td><code>src/pages/BulkPrintOrders/CreateBulkPrintOrderPage.tsx</code></td></tr>
<tr><td>Seller type</td><td><code>src/types/seller.ts</code></td></tr>
```

## Important Notes

- Use `&mdash;` for em dashes (not `—` character directly)
- Use `<code>` for all code references (types, functions, file paths, values)
- All JIRA ticket references should be hyperlinks
- Tables MUST have `<colgroup>` with `<col />` elements (Confluence requirement)
- Do NOT use `<thead>` / `<tfoot>` — Confluence storage format uses flat `<tbody>` with `<th>` in first row
