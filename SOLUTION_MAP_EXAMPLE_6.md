# Solution map example 6 — **multi-file upload** (drop zone + progress)

Same layout as `STOPWATCH_SOLUTION.md`: one **●** per row in exactly one of `state` | `action` | `fn` | `array` (fictional but typical: attachments, KYC images, import CSV, avatars, …).

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `items: UploadItem[]` each with `id`, `file`, `status` (`pending` \| `uploading` \| `done` \| `error`) | ● |  |  |  |
| Per-item `progress` 0–100 (or bytes sent / `total` from `XMLHttpRequest`) | ● |  |  |  |
| `errorMessage` + failed `id` (or map `id` → string) for inline errors | ● |  |  |  |
| `isDragging` (global drag-over for highlight) | ● |  |  |  |
| Hidden `<input type="file">` **ref** + `accept` (optional) | ● |  |  |  |
| **(opt)** `AbortController` / `xhr` `ref` per item to **cancel** upload | ● |  |  |  |
| Pick from system dialog; **drop** on zone; `dragenter` / `dragleave` (watch counter trick) |  | ● |  |  |
| **Remove** one file; **clear all**; **cancel** in-flight; **retry** on failed |  | ● |  |  |
| `UploadItem` row shape (see above) |  |  |  | ● |
| Allowed `accept` list and **max** size (from product **spec** or config) |  |  |  | ● |
| `validateFile(file)`: type + size; return reason string |  |  | ● |  |
| `readAsDataURL` or `createObjectURL` for **preview** (images); **revoke** on remove |  |  | ● |  |
| `formatBytes` for UI |  |  | ● |  |
| `startUpload(item)` → signed URL / `POST` / `put` to storage; update `status` + `progress` |  |  | ● |  |

**Two array rows:** `items` in **state** is the live queue; the **const** `accept` / max rules are often a fixed **array** in config. If you only store in state, keep one `array` row for **row type** + **static** `accept`.

| Column | Meaning (same as stopwatch) |
|--------|----------------------------|
| state | `useState` and refs: files, progress, errors, DnD, file input, cancel |
| action | Clicks, drop, pick, remove, cancel, retry |
| fn | Validate, format, preview URLs, start/retry upload, progress handlers |
| array | `UploadItem` shape; `accept` MIME / extensions list |

---

## Even smaller: **one** file, no list (micro-example)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `file: File \| null` + `status` + `error` | ● |  |  |  |
| Choose or drop **one** file; remove |  | ● |  |  |
| `validateFile` + single `upload` |  |  | ● |  |
| `accept` from props |  |  |  | ● |

Use this to check the same matrix on a field-sized control before you grow to **many** `UploadItem` rows.
