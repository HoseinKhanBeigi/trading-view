# Solution map example 6 — **multi-file upload** (drop zone + progress) — **deep cut**

Same rules as `STOPWATCH_SOLUTION.md`: **one ● per row**, **one** of `state` | `action` | `fn` | `array`. Uploader UIs are **deceptively large**: drag events, a **state machine** per file, `Blob` + network, and cleanup (`revokeObjectURL`, `AbortController`). This file splits the feature into **layers**; **`(opt)`** is optional in your product.

| Column | Meaning (same as stopwatch) |
|--------|----------------------------|
| state | `useState` + refs: queue, progress, DnD, file input, abort, timers |
| action | Clicks, keyboard, **drag/drop** pipeline, pick, remove, cancel, retry |
| fn | Validate, `FormData`/`PUT` body, `XMLHttpRequest` progress, `formatBytes`, `cn` |
| array | `UploadItem` shape; `accept` MIME; batch limits; or nothing |

---

## A. **Core queue** and per-item **state machine**

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `items: UploadItem[]` with stable **`clientId`**, `File`, `status` | ● |  |  |  |
| `status`: `pending` → `validating?` → `uploading` → `done` \| `error` \| `canceled` | ● |  |  |  |
| Per item: **determinate** — `{ loaded, total }` (or **derived** `0–100` from them) when `file.size` / server `total` is **known** | ● |  |  |  |
| Per item: **indeterminate** — a flag (or a union branch) when **no** `total` (e.g. unknown `Content-Length`); do **not** fake a percent; show spinner / `aria` indeterminate + optional **bytes sent** only | ● |  |  |  |
| Per item: `errorKey` or `message` (for i18n + support) | ● |  |  |  |
| `serverFileId` / public URL when `done` (so parent form can `POST` an id) | ● |  |  |  |
| **Global** cap: `maxFiles`, `maxTotalBytes` across queue (defensive vs users) | ● |  |  |  |
| Add files (after validation); **remove**; **reorder** (optional; drag within list) |  | ● |  |  |
| **Retry** only failed; **duplicates** policy (replace vs reject vs rename) |  | ● |  |  |
| `nextStatus(current, event)` (tiny reducer) or explicit transitions |  |  | ● |  |
| `UploadItem` / `FileMeta` type + discriminated unions for `status` |  |  |  | ● |
| `appendFiles(FileList)`: dedupe, sort by name, cap count |  |  |  | ● |

**Progress:** With **`File` from input**, you usually have `file.size` → can show **determinate** bar from XHR/axios `onProgress(loaded, total)`. **Indeterminate** is for streams / missing size: still get `loaded` in **some** APIs, but **no** `total` → no ratio; the UI in **§E** stays indeterminate.

**Where `array` lives:** the **authoritative** list is in **state** as `items[]`; a separate **array** row is for the **row type** + static **`accept`**.

---

## B. **Drop zone** and drag (browser quirks)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `isDragging` / **drag** depth **counter** (so child `dragleave` does not flash off) | ● |  |  |  |
| `isDragInvalid` (wrong MIME — optional visual “can’t drop”) | ● |  |  |  |
| `onDragOver` + `onDrop` on zone; **`preventDefault`** + right **dropEffect** |  | ● |  |  |
| `onDragEnter` / `onDragLeave` **increment/decrement** counter (not `=== 0` for leave on children) |  | ● |  |  |
| `dataTransfer.items` + `getAsFile()` / `webkitGetAsEntry` (**directory** in §C) |  |  | ● |  |
| Filter dropped list through same **`validateFile`** and caps as the file dialog |  |  | ● |  |

**Fullscreen overlay** while dragging: optional **(opt)** `state: isGlobalDrag` + `window` `dragover` (careful: always `preventDefault` where needed).

---

## C. **`<input type="file">`**: `accept`, `multiple`, **capture**, `directory`

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| Hidden input **ref**; reset with `el.value = ''` so the **same** file can be re-picked | ● |  |  |  |
| `accept` (MIME / `.ext`), `multiple`, **`capture`**, **`webkitdirectory`** **(opt)** | ● |  |  |  |
| “Browse” **click**; **(opt)** paste from clipboard (`ClipboardEvent`) |  | ● |  |  |
| Build `FileList` → same **`appendFiles`** as drop |  |  | ● |  |
| Parse **`accept` string** vs **feature detect** (directory not in Safari / varies) |  |  | ● |  |
| Allowed `accept` + **per-type** `maxFileBytes` in config |  |  |  | ● |

---

## D. **Network pipeline**: presign, `PUT` body, **concurrency** and **backpressure**

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| **`inFlightCount`** (or queue + **maxParallel** 2–3) to avoid 50 at once | ● |  |  |  |
| Per item: `AbortController` or **`xhr` ref**; map `id` → `abort` | ● |  |  |  |
| **(opt)** `presign: POST /upload/init` → `{ url, method, headers }` then `PUT` | ● |  |  |  |
| **Cancel**; **(opt)** pause all / resume (rare) |  | ● |  |  |
| `putFile(item, { onProgress, signal })` (fetch + **ReadableStream** or `XMLHttpRequest`) |  |  | ● |  |
| `onProgress(loaded, total)` → throttle updates (e.g. `requestAnimationFrame` or 100ms) |  |  | ● |  |
| When `inFlight` drops, `dequeue` next `pending` (worker loop) |  |  | ● |  |
| `Headers` (Content-Type, `x-amz-*` if S3) from presign |  |  |  | ● |

`fetch` has **no** upload progress; use **`XMLHttpRequest`**, **`axios` onUploadProgress`**, or **tus** (§G).

---

## E. **Progress UI**: percent, **speed**, **ETA**, indeterminate

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| **(opt)** Per item: `startedAt` + EMA of speed for `ETA` (can lie if network stalls) | ● |  |  |  |
| **(opt)** `useReducedMotion` → prefer bar without jiggle | ● |  |  |  |
| Render bar / ring; `aria-valuenow` / `aria-valuetext` |  |  | ● |  |
| `formatBytes` / s; `formatDuration` (ETA) |  |  | ● |  |

If **`total` unknown** (some streams), use **indeterminate** **state** + `role="progressbar"` **indeterminate** pattern in **action**/markup, not a fake percent.

---

## F. **Previews** (images, PDF, video poster) and **object URL** lifecycle

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| Per item: `previewUrl: string` from **`URL.createObjectURL(file)`** (only for in-browser preview) | ● |  |  |  |
| **(opt)** `objectUrl` **ref** map `id` → `url` for O(1) **revoke** on remove/complete | ● |  |  |  |
| Remove / complete → **`URL.revokeObjectURL`** to avoid **memory** leaks |  |  | ● |  |
| **(opt)** `createImageBitmap` / decode before Mark `uploading` (huge image guard) |  |  | ● |  |
| Non-image: show **icon** by MIME **(opt)** from `array` of `{ mime, Icon }` |  |  |  | ● |
| `HEIC` / exotic types: show “preview not available” in **fn**/branch |  |  | ● |  |

**PDF:** in-browser `iframe` `src={bloburl}` is heavy; often **no preview**, icon only (note in **spec**).

---

## G. **Cancel** / **retry** / **(opt) resumable** uploads

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| **Cancel** one (abort + set `canceled` + re-queue slot for next) |  | ● |  |  |
| **Retry** from `error` (new presign? same URL policy — **server** **spec**) |  | ● |  |  |
| `abort` + remove from `inFlight` + call next from queue |  |  | ● |  |
| **(opt)** **tus** / multipart / **chunk** index + ETag (different **struct**; own map) |  |  | ● |  |

If your backend is **tus** or **S3 MPU**, add a **separate** subsection: each **chunk** is its own sub-**struct**; this file stays one level for “plain **PUT** file.”

---

## H. **Accessibility** and **UX**

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| Zone is **`role=button` or** labeled region; keyboard **Space/Enter** opens dialog |  | ● |  |  |
| **Live** region: “3 files uploading,” “2 failed” (polite, not every %) |  |  | ● |  |
| Focus: after remove, focus **next** or **zone**; **trap** not always needed |  |  | ● |  |
| `aria-describedby` for limits (`maxFiles`, `accept`) |  |  | ● |  |

---

## I. **Errors and i18n** (user-facing, support)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| Map `errorCode` → message **id**; avoid raw S3 JSON in UI |  |  | ● |  |
| `FileTooBig` / `BadType` / `Network` / `Aborted` / `5xx` |  |  |  | ● |
| **(opt)** “Copy support info” = `file.name`, `file.size`, `clientId` (PII policy) |  | ● |  |  |

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| **(opt)** `virusScan: pending` → `clean` (polling or webhook) after **PUT** | ● |  |  |  |
| Polling `GET /file/:id/status` or **SSE**; until clean, do not emit `done` to parent |  |  | ● |  |

**Second table** is **(opt)** post-upload pipeline (another **state** machine extension).

---

## J. **Parent form** contract (so the uploader is reusable)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| **Controlled:** `onChange({ fileIds, items })` when list changes; **or** uncontrolled with **ref** `imperativeHandle` | ● |  |  |  |
| **(opt)** `disabled` + `readOnly` from parent | ● |  |  |  |
| **(opt)** **Submit** of parent: block if any `status !== done` and `!virusScan?` or show summary |  |  | ● |  |
| `validate` before **save**: all required slots filled |  |  | ● |  |

---

## Even smaller: **one** file (unchanged use case; tiny matrix)

| Name / role | state | action | fn | array |
|-------------|-------|--------|----|----|
| `file`, `status`, `error` (no list) | ● |  |  |  |
| Choose / drop / remove |  | ● |  |  |
| `validateFile` + one `putFile` + progress |  |  | ● |  |
| `accept` from props |  |  |  | ● |

---

**How to use this doc in review:** start at **A + B + C** (queue + DnD + file input). Add **D** for real uploads; **E–F** for product polish; **G–H–I** for reliability and compliance; **J** for embed in forms. **`SOLUTION_MAP_EXAMPLE_7.md`** (IO vs **virtual** lists) matters if the **file list** is huge — you might **virtualize** the list of `UploadItem` rows; **not** the bytes.
