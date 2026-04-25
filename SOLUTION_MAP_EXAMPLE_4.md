# Solution map example 4 — shopping cart (line items + subtotal)

Same layout as `STOPWATCH_SOLUTION.md`: one **●** per row in exactly one of `state` | `action` | `fn` | `array` (fictional but typical pattern; use it as a template for other list + aggregate UIs: invoices, order history, team seats, …).

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `lines` (`useState<CartLine[]>` or from context) | ● |  |  |  |
| `promoError` (optional: invalid code message) | ● |  |  |  |
| Change quantity (+ / – with clamp ≥ 1) |  | ● |  |  |
| Remove a line (trash / “Remove”) |  | ● |  |  |
| Apply promo code (submit field) |  | ● |  |  |
| `CartLine` row shape (`{ id, productId, title, unitCents, qty }`) |  |  |  | ● |
| `lineTotal(line)` = `unitCents * qty` |  |  | ● |  |
| `subtotalCents(lines)` = sum of line totals |  |  | ● |  |
| `formatMoney(cents)` for display |  |  | ● |  |

**Derived list:** the table body maps **`lines`**. If you also keep a *copy* in state for an optimistic “pending delete,” document that in **state**; otherwise one source of truth is enough for the map.

| Column | Meaning (same as stopwatch) |
|--------|----------------------------|
| state | `useState` and mutable refs the UI depends on |
| action | Taps, clicks, submits (including quantity steppers) |
| fn | Pure math, money formatting, validation helpers |
| array | The shape of each line and, if not in state, static lists (e.g. allowed promo codes) |

---

## Even smaller: one-line promo field (micro-example)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `promo` (controlled input) | ● |  |  |  |
| Submit / blur “apply” |  | ● |  |  |
| `VALID_CODES` (constant list) |  |  |  | ● |
| `normalize` / `lookup(code)` |  |  | ● |  |

This is only four rows; the same matrix still works for a tiny slice of the cart.
