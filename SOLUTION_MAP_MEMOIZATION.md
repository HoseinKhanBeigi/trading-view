# Memoization & fast compute (React + JS)

## Read this first (plain English)

1. **What’s the pain?**  
   When state updates, **React runs your component function again**. Anything you calculate in the body (filter a list, build an object) runs again too — unless you **opt out** with memoization, or the work is so cheap you don’t care.

2. **Three tools — don’t mix them up**

| You want to… | Tool | In one line |
|--------------|------|-------------|
| Reuse the **result** of a calculation when inputs didn’t change | `useMemo` | “Remember this **value** (array, number, object).” |
| Reuse the **same function** across renders (so a child that compares by reference doesn’t see “new” every time) | `useCallback` | “Remember this **function**.” |
| Skip re-drawing a **child component** when its **props** are shallow-equal | `React.memo` | “Don’t re-run this **component** if props look the same.” |

3. **Tiny example**

```tsx
// Without memo: new [] every render → child always thinks "props changed"
const ids = items.map((i) => i.id);

// With useMemo: same array reference if `items` is the same reference
const ids = useMemo(() => items.map((i) => i.id), [items]);
```

4. **“Fast compute”** is not only hooks: **better algorithms** (use a `Map` for lookup, not 10k `.find` in a loop), **debounce** search, **virtual lists** for huge DOM, sometimes **Web Workers** for heavy work — see §6 below.

5. **How to read the tables below**  
   Each row is one **situation** (`problem` → `technique` → what to type (`api / fn`) → `gotcha`).

If anything below feels dense, read **only** sections **1–3** and **7** first, then come back.

---

| Column in the big tables | Meaning |
|--------------------------|---------|
| **problem** | What hurts: wasted work, jank, wrong updates |
| **technique** | The idea: cache, skip render, different algorithm |
| **api / fn** | Hook or pattern name (what you actually write) |
| **gotcha** | Common mistake |

---

## 1. `useMemo` — cache a *computed* value

| problem | technique | api / fn | gotcha |
|---------|-----------|----------|--------|
| Heavy **pure** work every render (big filter / sort) | Recompute only when `[deps]` change | `useMemo(() => compute(a, b), [a, b])` | If the work is **tiny** (e.g. `a + 1`), `useMemo` adds noise — **profile** first |
| You need the **same object/array instance** as last time (for `useEffect` deps or a `memo` child) | `useMemo` so identity is stable when `x` didn’t change | `useMemo(() => ({ x }), [x])` | If you make `{ x: 1 }` **new** every render, `memo(Child)` **never** helps |
| Filter + sort a list from props | One `useMemo` that depends on source list + sort key | `[...rows].sort(…)` inside `useMemo` | **Don’t mutate** `rows` in place; **copy** then sort, or you’ll have subtle bugs |

**Short rule:** `useMemo` = “same inputs → same **output reference** (or same number), skip recomputing.”

---

## 2. `useCallback` — stable *function* reference

| problem | technique | api / fn | gotcha |
|---------|-----------|----------|--------|
| You pass `onClick={() => do()}` to a `memo(Row)` | Parent creates a **new** function every render — child always re-renders | `const onClick = useCallback(() => do(), [deps])` | If you use **state** from closure, put that state in **`deps`**, or use **`setState(f => ...)`** so you don’t need stale `count` in deps |
| `useEffect` needs a stable `handler` in its dependency list | `useCallback` the handler with correct deps | `useCallback(fn, [a, b])` | If `fn` is recreated because **`a`** is a **new object** every parent render, fix the **parent** (pass an **id** string, not a new `{}`) |
| `useEffect(() => do(d), [d])` and `d` is always a **new** object from parent | Don’t put unstable objects in deps | Parent passes `id: string` or memos the object in the parent with `useMemo` | **JSON.stringify** in deps to “fix” objects is a **hack**; prefer **id** or stable data |

---

## 3. `React.memo` — skip re-rendering a component

| problem | technique | api / fn | gotcha |
|---------|-----------|----------|--------|
| Parent state changes but **one row** doesn’t need to update | Wrap: `const Row = memo(RowView)` | `export const Row = memo(RowView)` | If you pass `row={ { ...data } }` **new** every time, `memo` does **nothing** — pass **primitives** or a **stable** `row` object |
| Row needs many fields | Pass `rowId` and **read** from context or a store, or ensure **parent** does not build new `row` | Design props carefully | `memo(Row, (a,b) => a.id === b.id)` is possible; easy to get **wrong** if you miss a prop |

`memo` only compares **props** (shallow). It does not freeze **context**; context changes still re-render consumers.

---

## 4. Cache outside React (`Map` / LRU)

| problem | technique | api / fn | gotcha |
|---------|-----------|----------|--------|
| Same `key → heavy result` many times (chart, parsing) | Store results in a **`Map`**, or **LRU** with max size | `cache.get(k) ?? cache.set(k, work(k))` | A **growing** `Map` with never-repeated keys = **memory leak** — cap size or clear |
| Libraries like **Reselect** | Each selector output **memo**’d so only changed inputs recompute | `createSelector` | Still need to pass **stable** input references where it matters |

---

## 5. Web Workers (heavy work off the main thread)

| problem | technique | api / fn | gotcha |
|---------|-----------|----------|--------|
| Parse 50MB CSV, big crypto, 10M loop | `Worker` + `postMessage` | `new Worker(...)`, `postMessage` | **Small** work: worker is **slower** (message + copy cost) |
| React + worker | Create worker in `useEffect`, **terminate** in cleanup | `useRef` for worker | Don’t `setState` on **every** tiny message; **batch** one update |

**Related (not a worker):** `startTransition` + `useDeferredValue` = “low priority” UI updates so typing stays fast — good for **big lists** with filters, not a replacement for a worker.

---

## 6. Big-O and UX tricks (not “memo” but same goal: fast)

| problem | technique | api / fn | gotcha |
|---------|-----------|----------|--------|
| Look up by id 1000× | Build **`Map` once** from list | `useMemo` → `new Map(list.map(…))` | Rebuild map when `list` ref changes, not every render for no reason |
| Re-filter 10k rows on every keystroke | **Debounce** the query, or `useDeferredValue(query)` | See `SOLUTION_MAP_EXAMPLE_2` | Debounce = wait after typing; **deferred** = can show **old** list briefly (that’s ok on purpose) |
| 20k DOM rows | **Virtualize** (only mount visible window) | `SOLUTION_MAP_EXAMPLE_7` | **IntersectionObserver** = “is this *element* in view” — different from “only render 20 visible rows” |

---

## 7. When *not* to use memo (common mistakes)

| What people do | Why it’s bad | What to do |
|----------------|--------------|------------|
| Wrap **every** handler in `useCallback` | Clutter; often no win | **Measure**; only if a **`memo` child** or **`useEffect`** really needs a stable ref |
| `useMemo` for `x + 1` | The memo costs more than the add | Remove it |
| **Wrong** dependency array in `useMemo` / `useCallback` | **Stale** or **over-eager** updates | List **every value** you read from render scope, or use functional updates; use **eslint-plugin-react-hooks** |
| Put `fetch` / `fetch()` side effects **inside** `useMemo` | `useMemo` can run in weird order; not for IO | Use **`useEffect`** for side effects |
| `useMemo` to guarantee “runs once” | React may **drop** the cache in theory; not a “run once” primitive | `useRef` for once-per-mount init, or `useState` lazy init |

---

## 8. One “chart” example (ties it together)

| problem | technique | api / fn | gotcha |
|---------|-----------|----------|--------|
| Rebuild `points` from `raw` on every drag of a slider | `useMemo` on `[raw, viewRange]`; optionally defer the **slider value** | `useMemo` + `useDeferredValue` on range | If drag must be **100%** instant, pre-bucket in a **worker** or precompute more |

---

**Cross-refs:** `SOLUTION_MAP_EXAMPLE_2` (debounce), `5` + `7` (big tables, virtual + IO), `SOLUTION_MAP_ALGORITHMS_2` (e.g. two pointers). If your app uses the **React Compiler**, it may add some memoization automatically; you still need to understand **algorithms** and **DOM** limits.
