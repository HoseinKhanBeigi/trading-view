# `Matrix` class (Python) — table map

Plain **rectangular 2D table** in memory: `m` rows, `n` columns. One **row** in each table = one **concept**; columns describe **where it lives** in the design (same *spirit* as `STOPWATCH_SOLUTION.md`, but for a class, not React).

| Part | name | what it is |
|------|------|------------|
| field | `self.rows` | `list` of `list` — copy of input rows: `[list(r) for r in rows]` |
| field | `self.m` | `int` — **row** count = `len(rows)` |
| field | `self.n` | `int` — **column** count = `len(rows[0])` (all rows same length) |
| check | (constructor) | Reject **empty** `rows`; require **every** row has length `n` |
| method | `shape()` | Returns `(m, n)` — tuple (rows, columns) |
| method | `__getitem__(index)` | `matrix[i]` → **i-th row** (the inner `list`) |
| method | `__repr__` | `print` / REPL: one **string** per row, lines joined with `\n` |
| method | `__mul__` | See **§ `__mul__`** below: scalar **or** matrix × matrix |

---

## Constructor rules (in order)

| Step | what happens | on failure |
|------|----------------|------------|
| 1 | `if not rows` | `ValueError("Empty matrix")` |
| 2 | `row_len = len(rows[0])` | (first row defines width) |
| 3 | For each `r` in `rows`, `len(r) == row_len` | `ValueError("Rows must have equal length")` |
| 4 | `self.rows = [list(r) for r in rows]` | Shallow **copy** per row (safe if caller reassigns their lists later) |
| 5 | `self.m`, `self.n` | Stored as `len(rows)` and `row_len` |

---

## Access patterns

| Expression | result | note |
|------------|--------|------|
| `M[i]` | full **row** `i` (list) | via `__getitem__` |
| `M[i][j]` | element at row `i`, column `j` | mutates `self.rows[i][j]` in place (no `__setitem__` on `Matrix` itself) |
| `M.shape()` | `(m, n)` | not a property; call it as method |
| `A * B` | `A.__mul__(B)` | see **§ `__mul__`**: scalar **or** matrix product |

---

## `__mul__(self, other)` — `self * other`

Python calls this for **`M * x`** only. It does **not** run for **`x * M`** when `x` is a number — for that, add **`__rmul__`** (see **Footguns** below).

### Branch: what is `other`?

| `other` type | meaning | result shape | error |
|--------------|---------|--------------|--------|
| `int` or `float` | **Scalar** multiply: every entry × `other` | same as `self`: `(m, n)` | — |
| `Matrix` | **Matrix** product (linear algebra) | `(self.m, other.n)` = **(m, p)** | `ValueError` if `self.n != other.m` |

**Dimension rule (matrix × matrix):** `self` is **m×n**, `other` must be **n×p** (so `self.n == other.m`). Result is **m×p**.

### Scalar path

| Step | what happens |
|------|----------------|
| 1 | New matrix: each cell `(i, j)` is `self.rows[i][j] * other`. |
| 2 | Return `Matrix([...])` — constructor runs, rows are copied again. |

### Matrix path (triple loop)

| Loop / variable | role |
|-----------------|------|
| `i` | row in `self` and in `result` |
| `j` | column in `other` and in `result` |
| `k` | index along the **inner** dimension: `sum_k self[i,k] * other[k,j]` |
| `s` | accumulator for one output cell `result[i][j]` |

| Output cell | meaning |
|-------------|---------|
| `result[i][j]` | dot product of **row** `i` of `self` with **column** `j` of `other` |

### Footguns / extensions

| topic | detail |
|-------|--------|
| **`2 * M`** | Use **`__rmul__(self, other)`** for `isinstance(other, (int, float))`: `return self * other`. |
| **`*` vs `@`** | Your `__mul__` overloads **both** scalar and matmul; NumPy uses `*` elementwise and `@` for matmul. You can add **`__matmul__`** for `A @ B` only and keep `*` for scalars + matmul, or document the current rule. |
| **Other types** | If `other` is neither number nor `Matrix`, raise **`TypeError`** with a clear message. |

---

## What this class may still *not* include

| gap | if you need it |
|-----|-----------------|
| matrix **`+`**, **transpose** | add `__add__`, `transpose`, … |
| **elementwise** `*` (Hadamard) | different from your `__mul__` matmul — use another name, e.g. `hadamard` / `__and__` is wrong; usually `elementwise_mul` |
| `numpy` / `@` | Python has `__matmul__` for `A @ B` if you want `*` for scalars and `@` for matrix product (PEP 465) |
| frozen / immutable | copy elements deeply or return tuples only |
| `Matrix[i,j]` in one index | add `__getitem__` to accept a tuple `(i, j)` |
| `__str__` vs `__repr__` | right now one string; split if users need different formats |

This file is a **reference** for the snippet you have; keep code and docs in sync if you change the implementation.
