# Solution map: math **in code** (numeric algorithms)

Same matrix as `SOLUTION_MAP_ALGORITHMS.md`: **one ● per row**, **one** column. These are **tiny programs** that implement math—loops, integers, floating point—**not** proof-on-paper style.

| Column | What it is |
|--------|------------|
| **spec** | Inputs, types, preconditions (e.g. `n ≥ 0`), output, edge cases (`0!`, negative?) |
| **struct** | Variables you update in the loop: accumulators, remainders, bits |
| **step** | One loop iteration or one recurrence (what you do each time) |
| **fn** | Black-box ops you call: `%`, `floor`, `*` with care; or a **named** helper |

---

## 1. Factorial `n!` (start here)

| Name / role | spec | struct | step | fn |
|-------------|------|--------|------|-----|
| Integer `n ≥ 0`; return product `1·2·…·n` (and `0! = 1`) | ● |  |  |  |
| Running product `acc` (start at 1) |  | ● |  |  |
| Multiply `acc` by the next `k` from 1 to `n` |  |  | ● |  |
| Integer multiply (watch overflow in real code) |  |  |  | ● |

---

## 2. GCD (Euclidean algorithm, integers)

| Name / role | spec | struct | step | fn |
|-------------|------|--------|------|-----|
| Integers `a, b` (often `b ≥ 0`); return greatest common divisor | ● |  |  |  |
| Pair `(a, b)` you replace each round |  | ● |  |  |
| While `b ≠ 0`: replace `(a,b) ← (b, a mod b)`; else answer is `a` |  |  | ● |  |
| `a % b` (and use `|a|`,`|b|` if you need non-negative) |  |  |  | ● |

---

## 3. Integer power `base**exp` (fast exponentiation)

| Name / role | spec | struct | step | fn |
|-------------|------|--------|------|-----|
| `base`, non-negative integer `exp`; return `base^exp` (watch overflow) | ● |  |  |  |
| `result` accumulator, `b`, `e` (or “square base / halve exp”) |  | ● |  |  |
| If `e` is odd, fold `b` into `result`; square `b`, halve `e` (bit / division loop) |  |  | ● |  |
| Multiply integers; `e >> 1` or `e // 2` |  |  |  | ● |

---

## 4. Horner: evaluate a polynomial

\(p(x) = a_0 + a_1 x + \cdots + a_n x^n\) from coefficients and `x`.

| Name / role | spec | struct | step | fn |
|-------------|------|--------|------|-----|
| `coeffs` (high to low or low to high—pick one and stick to it), real `x` | ● |  |  |  |
| Running value `v` (Horner: start from highest index) |  | ● |  |  |
| `v = v * x + coeff[i]` in order from “top” degree down to constant |  |  | ● |  |
| `*` and `+` in matching precision (float / decimal) |  |  |  | ● |

---

## Micro: clamp a number to `[lo, hi]`

| Name / role | spec | struct | step | fn |
|-------------|------|--------|------|-----|
| `x`, `lo`, `hi` with `lo ≤ hi` | ● |  |  |  |
| No loop: output `min(max(x, lo), hi)` (or if/else) |  |  | ● |  |
| `min` / `max` |  |  |  | ● |

---

**Relation to `SOLUTION_MAP_ALGORITHMS.md`:** Same `spec` / `struct` / `step` / `fn` habit; **step** is your loop (or a straight-line sequence). **struct** is the handful of **mutable** locals that carry the state of the math.
