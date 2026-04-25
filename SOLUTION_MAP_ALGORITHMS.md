# Solution map for algorithms (simple)

**Order:** start with small loops, then **binary search**, then **graphs** (BFS, DFS, Dijkstra).

Same idea as the UI maps (`STOPWATCH_SOLUTION.md`, …): **one ● per row**, **one** column. For algorithms, use these four:

| Column | What it is |
|--------|------------|
| **spec** | What you put in, what you get, when you stop |
| **struct** | The working data: indices, `best`, queues, `visited`, … |
| **step** | What happens in the main loop, once |
| **fn** | Small pure helpers: `compare`, `neighbors`, `relax` |

---

## 1. Maximum in an array (start here)

| Name / role | spec | struct | step | fn |
|-------------|------|--------|------|-----|
| Non-empty list of numbers; you want the **largest** | ● |  |  |  |
| `best` = best value seen so far (start at `a[0]`) |  | ● |  |  |
| Walk the list; if the next value is better, set `best` to it |  |  | ● |  |
| “Better” = compare two numbers |  |  |  | ● |

No graph, one pass — the matrix is the same, just tiny.

---

## 2. Linear search

| Name / role | spec | struct | step | fn |
|-------------|------|--------|------|-----|
| Array and a value `x`; return an index with `a[i] === x`, or “not there” | ● |  |  |  |
| Index `i` (or iterator) |  | ● |  |  |
| Check `a[i]`; if match, return; else move `i` forward |  |  | ● |  |
| Equality test |  |  |  | ● |

---

## 3. Binary search (sorted array)

| Name / role | spec | struct | step | fn |
|-------------|------|--------|------|-----|
| **Sorted** array; find `x` or not found | ● |  |  |  |
| `lo`, `hi` |  | ● |  |  |
| Look at the middle, throw away the half that cannot contain `x` |  |  | ● |  |
| Compare `a[mid]` to `x` |  |  |  | ● |

---

## 4. The graph (shared)

| Name / role | spec | struct | step | fn |
|-------------|------|--------|------|-----|
| Nodes and edges; directed or undirected | ● |  |  |  |
| List of neighbors for each node (`adj` or the same in code) |  | ● |  |  |
| `neighbors(v)` |  |  |  | ● |

BFS, DFS, and Dijkstra all use this. Undirected: either store an edge in both directions or be careful in **step** so you do not get stuck pinging the parent.

---

## 5. BFS (level by level)

| Name / role | spec | struct | step | fn |
|-------------|------|--------|------|-----|
| Start at `s`; all edges “cost 1” | ● |  |  |  |
| “How many edges from `s`?” = `dist`, or at least `visited` |  | ● |  |  |
| A **queue** of nodes to visit |  | ● |  |  |
| Pop `u`, for each new neighbor: mark, set distance, **push to queue** |  |  | ● |  |
| If some nodes are still unseen, start again from one of them (components) | ● |  |  |  |
| `neighbors` |  |  |  | ● |

---

## 6. DFS (as deep as possible, then back)

| Name / role | spec | struct | step | fn |
|-------------|------|--------|------|-----|
| Start (or “visit all nodes” if the graph is split) | ● |  |  |  |
| `visited` (on directed graphs, extra **colors** help find cycles) |  | ● |  |  |
| Go deep: **recursive** `dfs` from each new neighbor, *or* **stack**-based same idea |  |  | ● |  |
| `neighbors` |  |  |  | ● |

---

## 7. Dijkstra (shortest path with **weights** ≥ 0)

| Name / role | spec | struct | step | fn |
|-------------|------|--------|------|-----|
| Weighted graph, start `source` | ● |  |  |  |
| Best known distance to each node `dist` |  | ● |  |  |
| **Priority queue** of “best guess so far” (node + distance) |  | ● |  |  |
| Pop smallest; if outdated, ignore; else try each neighbor, **improve** `dist` and push |  |  | ● |  |
| Edge weight + `relax` (shorter? update) |  |  |  | ● |

BFS = Dijkstra when every weight is 1 and you use a normal queue.

---

**UI vs this:** In UI, columns were `action` and “array.” Here, **spec** and **step** are the story of the method; **struct** is the memory the algorithm needs.
