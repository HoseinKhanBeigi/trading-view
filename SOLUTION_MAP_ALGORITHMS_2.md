# Solution map for algorithms 2 (more code examples)

Same rules as `SOLUTION_MAP_ALGORITHMS.md` and `SOLUTION_MAP_MATH.md`: **one ● per row**, **one** of `spec` | `struct` | `step` | `fn`. This file is **other** problems—no story overlap with the first sheet (no graph walk, no binary search) unless a tiny `fn` uses `compare`.

| Column | What it is |
|--------|------------|
| **spec** | Inputs, preconditions, what you return, when the loop ends |
| **struct** | Indices, running totals, a table you fill |
| **step** | What one iteration of the main pass does |
| **fn** | Helpers: `min`, `max`, index math, read/write array |

---

## 1. Two pointers on a **sorted** array (pair sums to `target`)

Assume non-decreasing `a` and a solution exists, or you return “none.”

| Name / role | spec | struct | step | fn |
|-------------|------|--------|------|-----|
| Sorted `a`, target; find indices `(i, j)` with `a[i] + a[j] == target` (classic: `i < j`) | ● |  |  |  |
| Left index `L`, right index `R` |  | ● |  |  |
| If `a[L]+a[R] < target`, move `L` right; if `> target`, move `R` left; if equal, done |  |  | ● |  |
| `a[i] + a[j]` and compare to `target` |  |  |  | ● |

`O(n)` for one pass; if not sorted, sort first (different **spec** / cost) or use a hash set (another design).

---

## 2. Sieve of Eratosthenes (all primes up to `n`)

| Name / role | spec | struct | step | fn |
|-------------|------|--------|------|-----|
| Integer `n ≥ 2`; return every prime in `[2, n]` | ● |  |  |  |
| Boolean (or bit) `isComposite[2..n]` (or `isPrime` flipped) |  | ● |  |  |
| For `p` from 2 to `√n`: if not composite, mark `2p, 3p, …` as composite |  |  | ● |  |
| Multiples step / loop bounds; collect indices that stayed prime |  |  |  | ● |

**Note:** A variant uses only odd numbers; add that to **struct** if you care about space.

---

## 3. Kadane (maximum sum of a **contiguous** subarray)

| Name / role | spec | struct | step | fn |
|-------------|------|--------|------|-----|
| Array of numbers (can be all negative; then best is the least bad element) | ● |  |  |  |
| `endHere` = best sum ending at current index; `best` = best seen so far |  | ● |  |  |
| For each `x`: `endHere = max(x, endHere + x)`; `best = max(best, endHere)` |  |  | ● |  |
| `max` of two numbers |  |  |  | ● |

One linear scan, `O(1)` extra space.

---

## 4. Merge two sorted arrays into one output

(The merge *step* in merge sort; you may already have the full recursive sort in **spec** elsewhere.)

| Name / role | spec | struct | step | fn |
|-------------|------|--------|------|-----|
| `A` and `B` sorted ascending; produce sorted `C` of length `|A|+|B|` | ● |  |  |  |
| Indices `i` into `A`, `j` into `B`, write position in `C` |  | ● |  |  |
| While both sides have elements: take the smaller head, write to `C`, advance that index |  |  | ● |  |
| Compare two heads; copy any tail when one list is empty |  |  |  | ● |

---

## Micro: in-place **reverse** an array (or `string` in a buffer)

| Name / role | spec | struct | step | fn |
|-------------|------|--------|------|-----|
| Mutable sequence of length `n` | ● |  |  |  |
| `L = 0`, `R = n - 1` |  | ● |  |  |
| While `L < R`: swap `a[L]` and `a[R]`; `L++`, `R--` |  |  | ● |  |
| `swap` |  |  |  | ● |

---

**With part 1:** `SOLUTION_MAP_ALGORITHMS.md` → search + graphs; this file → pointers, number theory (sieve), running optimum (Kadane), linear merge, tiny reverse.
