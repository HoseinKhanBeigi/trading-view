# Solution map example 5 — **complex** server-driven data table (deep cut)

Same rules as `STOPWATCH_SOLUTION.md`: **one ● per row**, **one** of `state` | `action` | `fn` | `array`. This version **splits** the feature into **layers** so you can document a real product table (URL, cache, bulk actions, virtualization, a11y) without one unreadable mega-table.

**Legend:** **(opt)** = only if you ship that capability; still one home per row when you add it.

---

## Column meanings (unchanged)

| Column | Meaning |
|--------|--------|
| state | `useState` + refs the feature depends on |
| action | User or assistive-tech events that call handlers |
| fn | Pure adapters, formatters, query builders, debounce, `compare` |
| array | Column defs, row list, facet options, query-key segments |

---

## A. Core **view** state (what the user sees and what the next request asks for)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `query` (free text, chips, **debounced** before “commit” to server) | ● |  |  |  |
| `sortKey` + `sortDir`; which columns are **server-** vs **client-** sortable | ● |  |  |  |
| `page` + `pageSize` **or** `cursor` / `nextPageToken` (offset vs keyset—pick in **spec**) | ● |  |  |  |
| `filters` (structured: date range, enums, bools—often separate from raw `query`) | ● |  |  |  |
| `isLoading` (first paint) vs `isFetching` (background refresh; keep old **data** visible) | ● |  |  |  |
| `error` + last good `data` (rows) + `total` / `hasNext` / **empty** flags from API | ● |  |  |  |
| `requestId` counter or **AbortController** `ref` (drop stale responses) | ● |  |  |  |
| Debounce `timerId` **ref** | ● |  |  |  |
| **(opt)** Facet definitions **returned** by server (`{ id, options[] }`) cached in state | ● |  |  |  |
| Type / change filter fields; **commit** search (Enter) vs live debounce |  | ● |  |  |
| Toggle sort; **reset** to first page when sort/filter changes |  | ● |  |  |
| Next/prev page; change page size; **“load more”** if cursor-based |  | ● |  |  |
| Retry after error; **refresh** without losing scroll (optional) |  | ● |  |  |
| `buildListRequest(state)` → query string / body + stable **sort** encoding |  |  | ● |  |
| Debounce `query` (only the fields that should not hit the server every keystroke) |  |  | ● |  |
| `parseListResponse` → `{ rows, total, nextCursor, facets? }` + type guards |  |  | ● |  |
| `ListRow` / `FilterField` / server **facet** option shape |  |  |  | ● |
| `rows` you render (full page slice, or the **virtual window** in §E) |  |  |  | ● |

---

## B. **Fetch, cache, and query keys** (React Query / SWR / RTK Query style)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| **(opt)** `placeholderData: keepPreviousData` or manual “stick last `rows`” | ● |  |  |  |
| **(opt)** `prefetch` next page on hover/idle (`ref` or query client) | ● |  |  |  |
| Invalidate on mutation success (e.g. delete row) or focus window |  | ● |  |  |
| `listQueryKey(args)` = `['list', orgId, { query, sort, page, … }]` |  |  |  | ● |
| Serialize **args** in a **stable** order (same request → same key) |  |  | ● |  |
| **Dedupe** in-flight: library default + `requestId` from §A |  |  | ● |  |

---

## C. **Columns** (visibility, order, width, **sticky** / resize)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `columnOrder: ColumnId[]` (persisted in localStorage or account setting) | ● |  |  |  |
| `columnVisibility: Record<ColumnId, boolean>` | ● |  |  |  |
| `columnWidths: Record<ColumnId, number>` (px) from drag-resize | ● |  |  |  |
| **(opt)** `pinnedLeft` / `pinnedRight` column ids (scroll sync with body) | ● |  |  |  |
| Drag to **reorder** column headers; open column picker |  | ● |  |  |
| Drag **resize** handle; **double-click** auto-fit to content (optional) |  | ● |  |  |
| `mergeColumnStateWithDefs(defs, userPrefs)`; clamp widths min/max |  |  | ● |  |
| `ColumnDef` (id, header, `accessor`/`cell`, `meta`, `enableSorting`, `size`) |  |  |  | ● |

---

## D. **Row selection, expansion, and bulk** (the gnarly part)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `selectedIds: Set<RowId>` | ● |  |  |  |
| `lastClickedIndex` (or `anchorId`) for **Shift+click** range on **current page** | ● |  |  |  |
| `expandedRowId: RowId \| null` (or many, accordion vs free) for **detail panel** / subgrid | ● |  |  |  |
| **(opt)** “Select all **N** across **all** results” (dangerous) vs “select **this page** only” | ● |  |  |  |
| Toggle row; Shift+click range; header **select page**; **clear** |  | ● |  |  |
| **(opt)** Confirm modal for bulk delete / bulk tag |  | ● |  |  |
| **(opt)** Open row, navigate to `/items/:id` (may clear selection) |  | ● |  |  |
| `rangeSelect(idsOnPage, anchor, endIndex)`; sync with `Set` |  |  | ● |  |
| `getSelectableRowId(row)` (skip disabled rows) |  |  | ● |  |
| **(opt)** `bulkRequest(selectedIds, action)`; optimistic update + rollback |  |  | ● |  |
| `RowId` list in order on **current** page (for range math) |  |  |  | ● |

---

## E. **Virtual** body (large lists)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `scrollParentRef` + `estimateSize` + `overscan` | ● |  |  |  |
| Virtual `range` / `virtualItems` from the list lib (scroll + viewport) | ● |  |  |  |
| **(opt)** `measureElement` (dynamic row heights) + cache in virtualizer |  |  | ● |  |
| Scroll; **(opt)** scroll row into view on keyboard focus |  | ● |  |  |
| `getVirtualItems` + `paddingTop` / `paddingBottom` total height |  |  | ● |  |

**Head, filters, and pager** are not virtual: only the **row strip** (and sometimes a single horizontal scroll sync for sticky columns).

---

## F. **URL** as shareable view (admin dashboards, support links)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| **(opt)** `searchParams` as **source of truth** (lift state to router) | ● |  |  |  |
| `replaceState` vs `pushState` when only filters change (back-button policy) | ● |  |  |  |
| User **shares** link; back/forward; **paste** URL with valid/invalid params |  | ● |  |  |
| `stateFromSearchParams` / `searchParamsFromState` (round-trip, defaults) |  |  | ● |  |
| Coerce/validate types (e.g. `page` is int ≥ 1; unknown sort key → default) |  |  | ● |  |

If URL is not used, this whole section is **(opt)** and lives only in in-memory state (§A).

---

## G. **Accessibility, focus, and keyboard**

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| **(opt)** Roving `tabIndex` on rows / “grid” `role` + `aria-rowcount` (approx) | ● |  |  |  |
| `activeDescendant` id or which row is “focused” for arrows | ● |  |  |  |
| Arrow up/down (and Home/End); **Space** toggles select; **Enter** opens row |  | ● |  |  |
| Live region: “Loading results” / “12 results” (polite) |  |  | ● |  |
| `getRowId(row)` — stable id for `aria-*` and selection (pure) |  |  | ● |  |

---

## H. **Polish: empty, error, and permissions**

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| **(opt)** `canExport` / `canDelete` from session / `featureFlags` | ● |  |  |  |
| Empty: no data vs no **matching** results (two different UIs) |  |  | ● |  |
| Error: inline **banner** + `retry`; optional **per-row** error from mutation |  |  | ● |  |
| `guard(action, perms)` before bulk or export |  |  | ● |  |

---

## Micro: only **debounced** refetch (still one matrix)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `q` in input; `debouncedQ` in state or in query | ● |  |  |  |
| Type in search |  | ● |  |  |
| `debounce` + `invalidateQueries` / `setQuery` |  |  | ● |  |

Use this to sanity-check a **small** slice; the full feature is **§A–H** above.

---

**How to use this doc in a PR or design review:** cover **§A** always; add **B–F** as your product needs **shareable state**, **performance**, and **huge** lists; add **D + G** when selection and keyboard power users matter; **H** when roles and error UX are non-negotiable.
