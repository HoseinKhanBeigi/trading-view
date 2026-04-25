# Solution map example 7 — **IntersectionObserver** vs **list virtualization** (separate)

These are **different** problems:

| Tool | What it does |
|------|----------------|
| **IntersectionObserver (IO)** | Tells you when a **node** (sentinel) **enters or leaves** a scroll/root region — good for “load more,” “pause video,” “count impressions,” **lazy images**. |
| **Virtualization** | Only **render** a **window** of rows that fit the viewport; you still have a long list in memory, but the DOM is tiny — good for **thousands of rows** without one cell per item mounted. |

You can use **both** (virtual list + a sentinel to prefetch the next page), but the **state** and **flow** in the map are still **two ideas**; do not merge them into one table unless a single row is really “both at once.”

Same layout as `STOPWATCH_SOLUTION.md`: one **●** per row, **one** of `state` | `action` | `fn` | `array`.

| Column | Meaning (same as stopwatch) |
|--------|----------------------------|
| state | `useState` and refs the UI or effect depends on |
| action | User events; for IO, “scroll” is not always an **action** row — the **observer callback** is closer to a **side effect** (often grouped under **fn** with the row that *updates* state) |
| fn | Observers, `getBoundingClientRect` helpers, `measure`, pure math for offsets |
| array | List of items, height estimates, or nothing |

---

## A. **IntersectionObserver** — infinite scroll (sentinel at list bottom)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `hasMore` (server says another page exists) + `isFetchingNext` | ● |  |  |  |
| **Ref** to the **sentinel** `div` (last child or sibling after list) | ● |  |  |  |
| **Ref** to the `IntersectionObserver` instance (disconnect on unmount) | ● |  |  |  |
| Optional: `root` ref if the scroll is **not** the viewport (table body div) | ● |  |  |  |
| **(opt)** “Load more” **button** (same fetch as when sentinel hits) |  | ● |  |  |
| **(opt)** User toggles “auto-load” off → remove observer or ignore callback |  | ● |  |  |
| `createObserver` / `IO` with `root`, `rootMargin` (“load **before** visible”) |  |  | ● |  |
| In callback: if `isIntersecting` and `!isFetchingNext` and `hasMore` → `fetchNextPage` |  |  | ● |  |
| `disconnect` in `useLayoutEffect` cleanup or when `hasMore` is false |  |  | ● |  |

**Note:** You usually do **not** store the full `entries[]` from each callback in **state** — a short “should load now?” branch is enough.

**No row for “the big list” in §A** unless the observer watches **each** item (ads/impressions) — then each row is a ref + one observer *per* item or one observer + many targets (separate spec).

### A2. **IntersectionObserver** — lazy **image** (one element in view)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `imgRef` on wrapper; `isLoaded` / `shouldLoad` | ● |  |  |  |
| When intersecting, set `shouldLoad` → set real `src` (or `srcSet`) |  |  | ● |  |
| `onLoad` / `onError` to swap placeholder; **unobserve** after load (optional) |  |  | ● |  |

**Still IO:** no virtualization — you might have **many** images in the document, but each small block is the same **map** as A2.

---

## B. **Virtualization** — window into a long list (not “in view” detection)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| **Scroll** container `ref` + `scrollTop` (or lib-owned internal state) | ● |  |  |  |
| **Total** count + **estimate** of row `height` (or per-row `measure` cache) | ● |  |  |  |
| **Visible** `start` / `end` index (or `virtualItems` from TanStack Virtual / `react-virtual`, …) | ● |  |  |  |
| User **scrolls** the body |  | ● |  |  |
| `getVirtualItems` + **padding** (top + bottom) so scrollbar length matches full list |  |  | ● |  |
| **(opt)** `ResizeObserver` on row or list to remeasure (still **not** the same as IO for a sentinel) |  |  | ● |  |
| Full `items[]` in memory (or a **sliding window** of pages from server) |  |  |  | ● |
| Only the **sliced** `items.slice(start, end)` (or from virtualizer) is **mapped to DOM** |  |  |  | ● |

**Virtualization** does *not* need IntersectionObserver for the main trick — the math is `scrollTop / rowHeight` (plus overscan and dynamic height). **IO** is for **triggers** (sentinel) or **per-item** visibility, not for computing which index range to map.

---

## C. **When you use both** (separate tables, then connect in code)

1. **§B** virtualizes the **row strip** (few DOM nodes).
2. **§A** places a **sentinel** *after* the list (or as last “virtual” row) so when it enters the **scroll root**, you call `fetchNextPage` and **append** to `items[]` (or merge into your query cache).

In the **solution map**, keep **A** and **B** in **different** subsections; add **one** cross-row in your implementation notes, e.g. “`fetchNext` only when sentinel intersects **and** `hasMore`,” not a fourth merged matrix.

---

## Micro: only **one** of them

| Pattern | One-line role |
|--------|----------------|
| **IO only** | Sticky “You’ve reached the end” or analytics when a banner **appears** — no list virtualization. |
| **Virtual only** | 10k rows, **all** data already in memory — no sentinel, no infinite scroll. |
