# Solution map example 3 — filtered todo list

Same layout as `STOPWATCH_SOLUTION.md`: one **●** per row in exactly one of `state` | `action` | `fn` | `array` (fictional but typical UI pattern; use it as a template for other features).

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `filter` (`"all"` \| `"active"` \| `"completed"`) | ● |  |  |  |
| `todos` (`useState<TodoItem[]>`) | ● |  |  |  |
| `draft` (controlled input for new task text) | ● |  |  |  |
| Change filter tabs |  | ● |  |  |
| Submit new todo (button or Enter) |  | ● |  |  |
| Toggle one todo’s `done` |  | ● |  |  |
| Delete one todo |  | ● |  |  |
| Clear all completed |  | ● |  |  |
| `filteredTodos` (view for current `filter`) |  |  |  | ● |
| `TodoItem` row shape (`{ id, text, done }`) |  |  |  | ● |
| `addTodo` / `toggleTodo` / `removeTodo` (immutable updates) |  |  | ● |  |
| `nextId` or `crypto.randomUUID` for new rows |  |  | ● |  |
| Trim + reject empty `draft` on submit |  |  | ● |  |
| `remainingCount` (active items) |  |  | ● |  |

**Why two array rows:** `filteredTodos` is the derived list you map over; `TodoItem` is the row type — same split as `laps` vs `StopwatchLap` in the stopwatch map.

| Column | Meaning (same as stopwatch) |
|--------|----------------------------|
| state | `useState` and mutable refs the UI depends on |
| action | User events (pointer, key, submit) that call handlers |
| fn | Pure helpers, immutable updates, derived non-list logic |
| array | List values and the shape of each row |

---

## Even smaller: single checkbox + “changed” message (micro-example)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `agreed` (boolean) | ● |  |  |  |
| Toggle checkbox |  | ● |  |  |
| `showSavedHint` (flash after change) | ● |  |  |  |
| `acknowledgeHint` (click or timeout) |  | ● |  |  |

Row count is 4 — the matrix still holds for one control plus feedback.
