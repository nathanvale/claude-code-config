# Smoke Test Checklist

Standard quality gates run after AC verification. All three tests must pass for an overall QA pass (layout is advisory only).

---

## 1. Console Errors

**How:** `list_console_messages({ types: ["error"] })`

**Pass criteria:** No NEW errors (errors not in the known filter list).

**Known filters (ignore these):**
| Pattern | Reason |
|---------|--------|
| `/non-serializable value.*detected/` | Redux designsApi — known tech debt |

**Fail action:** List each new console error in the smoke results with its message text.

---

## 2. Network Failures

**How:** `list_network_requests` — filter for non-2xx status codes.

**Pass criteria:** All meaningful requests returned 2xx.

**Known filters (ignore these):**
| Pattern | Reason |
|---------|--------|
| Status `0` (cancelled) | Browser cancelled — preflight or navigation |
| Status `404` for `*.map` files | Source map not found — not a runtime error |
| `OPTIONS` method (preflight) | CORS preflight — not application logic |

**Fail action:** List each failing request with URL and status code.

---

## 3. Layout Integrity

**How:** Full-page screenshot + `evaluate_script` to check images:

```javascript
// Check for broken images
const images = Array.from(document.images);
const broken = images.filter(img => img.naturalWidth === 0 && !img.src.includes('data:'));
broken.map(img => ({ src: img.src, alt: img.alt }));
```

**Pass criteria:** No broken images (naturalWidth=0).

**Known filters (ignore these):**
| Pattern | Reason |
|---------|--------|
| SVG placeholder images (`data:image/svg+xml`) | MSW mock design placeholders |
| Images with `src=""` | Intentionally empty src attributes |

**Advisory only:** Layout check failures produce a warning but do NOT fail the overall QA run. This accounts for MSW mock mode not having real design images.

---

## Execution Order

1. Console errors (fast — just read messages)
2. Network failures (fast — just read request log)
3. Layout integrity (requires screenshot + JS evaluation)

Always run all three, even if an earlier one fails.

---

## Per-AC Monitoring (chrome-verify)

Chrome-verify captures console errors and network failures per-AC using
msgid/reqid watermarking. This runs DURING AC verification, not after.

**How it works:**
1. Before each AC: record max msgid and reqid
2. After each AC: read new messages/requests since watermark
3. Apply known filters from sections 1 and 2 above
4. Attach to AC result as `console_errors[]` and `network_errors[]`

**Per-AC errors do NOT auto-fail the AC.** They're evidence for the
human reviewer. A Redux serialization warning during AC3 doesn't mean
AC3 failed — it means the page emitted a known warning.

---

## Route Sweep (qa-test Phase 3)

After AC verification, navigate to each route the story touches and
run all three checks (console errors, network failures, layout integrity).
This catches issues on pages the AC verification didn't visit directly.

Routes are detected from `key_files` patterns:

| key_files pattern | Route |
|-------------------|-------|
| `src/pages/BulkPrintOrders/CreateBulkPrintOrder*` | `/bulkprint/create` |
| `src/pages/BulkPrintOrders/PrintOrderList*` | `/printOrderHistory` |
| `src/pages/Orders/OnlineOrders/*` | `/orders` |
| `src/pages/Orders/OrderDetails/*` | `/orders/1` |
| `src/pages/Cards/*` | `/` |
| `src/pages/BulkActivation/*` | `/bulkactivation` |

If the story only touches one route, the sweep is a single-route check.
If the story touches shared components, only the primary route is swept.

---

## Future (v2+)

- Keyboard navigation (tab order verification)
- Responsive layout (resize viewport to mobile/tablet)
- Performance metrics (LCP, CLS via Chrome Performance API)
- Accessibility audit (axe-core via evaluate_script)
