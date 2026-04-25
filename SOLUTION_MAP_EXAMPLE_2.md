# Solution map example 2 — debounced search over a tag list

Same layout as `STOPWATCH_SOLUTION.md`: one **●** per row in exactly one of `state` | `action` | `fn` | `array` (fictional but typical UI pattern; use it as a template for other features).

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `query` (controlled input) | ● |  |  |  |
| `selectedTagId` (optional) | ● |  |  |  |
| `isPending` (debounce in flight) | ● |  |  |  |
| `timerRef` (debounce `setTimeout` id) | ● |  |  |  |
| Change search field |  | ● |  |  |
| Clear search |  | ● |  |  |
| Select a tag from list (click) |  | ● |  |  |
| Keyboard Enter / Esc |  | ● |  |  |
| `allTags` (source list from props) |  |  |  | ● |
| `visibleTags` (filtered) |  |  |  | ● |
| `Tag` / row item shape (`{ id, label }`) |  |  |  | ● |
| `onQueryChange` → schedule debounce |  |  | ● |  |
| `doFilter(query)` |  |  | ● |  |
| `clearDebounce` / cleanup on unmount |  |  | ● |  |
| `normalizeQuery` (trim, casefold) |  |  | ● |  |

**Why `visibleTags` is array:** a derived list you render; it is still “array” in the map; if you also store a copy in `useState` that row would be **state** (avoid duplicating in docs unless it matters for your spec).

| Column | Meaning (same as stopwatch) |
|--------|----------------------------|
| state | `useState` and mutable refs the UI depends on |
| action | User events (pointer, key) that call handlers |
| fn | Pure helpers, debounce, effects, derived non-list logic |
| array | List values and the shape of each row |

**Related file in this repo (pattern only, not a full match):** search/filter UIs in transaction history, market table filters — same *matrix idea*, different names.

---

## Even smaller: counter + “last 5 values” (micro-example)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `count` | ● |  |  |  |
| Click increment |  | ● |  |  |
| Click reset |  | ● |  |  |
| `history` (last N counts) |  |  |  | ● |
| `clamp` / `addToHistory` |  |  | ● |  |

That row count is 5 lines — the matrix works for very small blips too.
