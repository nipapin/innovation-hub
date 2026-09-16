# Storage API reference

Base path: `/api/storage/v1`  
Auth: session cookie (web UI) · `/api/account/machine-tokens` (`mch_…`, per-user)

**Remote computers (fleet)** use a separate contract: `POST /api/v1` with `{ action, props, token }`. See [REMOTE_ACCESS_API.md](./REMOTE_ACCESS_API.md) and **Admin → Remote access → API**.

Architecture and sync rules: [STORAGE_SYNC_CONTRACT.md](./STORAGE_SYNC_CONTRACT.md).

---

## Authentication

All `/api/storage/v1/*` endpoints accept either:

| Client | How |
|---|---|
| Web UI | Session cookie `inhub_session` |
| Processing app (per-user) | `Authorization: Bearer mch_…` |
| Remote computer (fleet) | Prefer `POST /api/v1`. Bearer `rc_…` still accepted here for compatibility. |

Errors:

| Status | Meaning |
|---|---|
| `401` | Missing / invalid credentials |
| `403` | Inactive account, or machine token scoped to another project |
| `404` | Project not found / no access |

Admin role and remote computer tokens (`rc_…`) can access any project. Machine tokens with `projectId` set may only touch that project.

Remote computer presence / heartbeat: [REMOTE_ACCESS_API.md](./REMOTE_ACCESS_API.md) (`action: "heartbeat"` on `/api/v1`).

---

## Common types

### `ProjectFile`

```json
{
  "id": "uuid",
  "projectId": "uuid",
  "folderPath": "IN",
  "name": "clip.mov",
  "isFolder": false,
  "s3Key": "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
  "sizeBytes": 1234567,
  "contentType": "video/quicktime",
  "createdAt": "2026-08-06T10:00:00.000Z"
}
```

Folders have `isFolder: true`, `s3Key: null`, `sizeBytes: 0`.

### `TreeEntry`

Extends file metadata from the cache:

```json
{
  "id": "uuid",
  "projectId": "uuid",
  "folderPath": "IN",
  "name": "clip.mov",
  "isFolder": false,
  "s3Key": "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
  "sizeBytes": 1234567,
  "contentType": "video/quicktime",
  "etag": "abc123",
  "contentHash": null,
  "originMtime": 1722930000,
  "createdAt": "2026-08-06T10:00:00.000Z",
  "updatedAt": "2026-08-06T10:00:00.000Z",
  "lastSeq": 1842
}
```

### `Change`

```json
{
  "seq": 1842,
  "op": "put",
  "key": "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
  "projectId": "uuid",
  "name": "clip.mov",
  "folderPath": "IN",
  "isFolder": false,
  "size": 1234567,
  "etag": "abc123",
  "contentHash": null,
  "eventTime": 1722930000,
  "fileId": "uuid",
  "contentType": "video/quicktime",
  "from": null,
  "to": null,
  "displayPath": "anya@studio.example / Ads Q3 / IN / clip.mov"
}
```

`op` is `"put"`, `"delete"`, or `"move"`. `seq` is monotonic per journal (global `BIGSERIAL`).

For `move`, `from` / `to` are `{ "folderPath", "name" }`. `name` / `folderPath` on the event match `to`. A folder move is **one** event — clients rewrite descendant prefixes locally (`fileId` is stable).

Tree entries also include `displayPath`.

### Error body

```json
{ "message": "Human-readable reason." }
```

---

## Machine tokens

Session cookie required (browser / logged-in user). Raw token is returned **once** on create.

### `GET /api/account/machine-tokens`

List non-revoked tokens for the current user.

**Response `200`**

```json
{
  "tokens": [
    {
      "id": "uuid",
      "name": "render-box-1",
      "projectId": null,
      "createdAt": "2026-08-06T10:00:00.000Z",
      "lastUsedAt": null
    }
  ]
}
```

### `POST /api/account/machine-tokens`

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | 1–120 chars |
| `projectId` | string \| null | no | Scope to one project; omit/`null` = all owned projects |

**Response `201`**

```json
{
  "id": "uuid",
  "token": "mch_…",
  "name": "render-box-1",
  "projectId": null
}
```

Store `token` securely. It is not shown again.

### `DELETE /api/account/machine-tokens`

**Body:** `{ "id": "uuid" }`  
**Response `200`:** `{ "ok": true }`

---

## `GET /api/storage/v1/capabilities`

Feature flags for storage clients. Authenticated via session, machine token, or remote computer token.


**Response `200`**

```json
{
  "apiVersion": 1,
  "protocol": 2,
  "multipart": true,
  "rename": true,
  "move": true,
  "copy": true,
  "sharing": true,
  "clients": true,
  "originMtime": true,
  "contentHash": true,
  "trash": true
}
```

`protocol: 2` means `/delta` may include `op: "move"`. Clients that do not understand `move` must treat unknown ops as a signal to refetch `/tree`.

`sharing: true` applies to the **website** only. Machine tokens never see shared projects — they continue to list ownership only.

Configure the R2 bucket with a lifecycle rule to **abort incomplete multipart uploads** (e.g. after 7 days), otherwise abandoned parts accumulate and are billed.
---

## `GET /api/storage/v1/projects`

List clients and projects visible to the caller. Prefer this over `GET /api/projects` for machine tokens.

| Auth | Result |
|---|---|
| Machine token with `projectId` set | That project only (+ its client if any) |
| USER | Owned clients + projects |
| ADMIN | All clients + projects |

**Response `200`**

```json
{
  "users": [
    { "id": "uuid", "email": "anya@studio.example", "fullName": "Аня Смирнова" }
  ],
  "clients": [{ "id": "uuid", "displayName": "Megafon" }],
  "projects": [
    {
      "id": "uuid",
      "name": "Ads Q3",
      "clientId": "uuid",
      "userId": "uuid",
      "ownerEmail": "anya@studio.example",
      "groupName": "personal",
      "isActive": true,
      "isPaused": false,
      "isArchived": false,
      "archivedAt": null,
      "updatedAt": "2026-08-07T12:00:00.000Z"
    }
  ]
}
```

`clientId` may be `null`. Client grouping is a DB relation only — R2 keys use `projects/{userId}/{projectId}/…`.

`userId` is the project owner (the first path segment of the R2 prefix). `users[]` lists those owners so the client can label the folder with `email` / `fullName` instead of a truncated UUID.

This endpoint returns **all** projects, including archived. The worker must skip rows with `isArchived: true`. Cabinet `GET /api/projects` is the opposite: it filters on the server (`?archived=true|false|all`, default `false`).

**Processing flags.** Three independent booleans, do not conflate them:

| Field | Meaning | What a worker should do |
|---|---|---|
| `isPaused` | User paused the project | Skip until resumed |
| `isActive` | Mirror of `!isPaused` (legacy) | Same as above |
| `isArchived` | Project moved to the Archive tab | **Skip — never start processing.** `archivedAt` holds the timestamp |

Archiving no longer sets `groupName` to `"archive"`: the group only drives UI layout, the status lives in `isArchived`.

### `POST /api/storage/v1/projects`

Create a project in the token owner's folder. Scoped machine tokens (`projectId` set) cannot create — `403`.

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | 1–120 chars |
| `clientId` | string \| null | no | Must belong to the owner |
| `description` | string | no | |
| `groupName` | `"personal"` \| `"shared"` \| `"tools"` \| `"archive"` | no | UI layout only |

**Response `201`:** `{ "project": { id, name, userId, ownerEmail, isArchived, … } }`

### `POST /api/storage/v1/project-rename`

Rename a project. R2 keys do not change.

**Body:** `{ "projectId": "uuid", "name": "New name" }`  
**Response `200`:** `{ "project": { … } }`

### `POST /api/storage/v1/project-state`

Pause / resume or archive / unarchive. Fields are independent; at least one is required.

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | |
| `paused` | boolean | no | Writes `is_paused` and mirrors `is_active` |
| `archived` | boolean | no | Writes `is_archived` / `archived_at`; workers must skip archived projects |

**Response `200`:** `{ "project": { … } }`

### `DELETE /api/storage/v1/projects`

Soft-delete a project into trash (30 days). R2 objects are **not** deleted immediately. Scoped tokens → `403`.

**Body:** `{ "projectId": "uuid" }`  
**Response `200`:** `{ "ok": true }`

### `POST /api/storage/v1/project-restore`

Restore a soft-deleted project.

**Body:** `{ "projectId": "uuid" }`  
**Response `200`:** `{ "project": { … } }`

---

## `POST /api/storage/v1/copy`

Server-side `CopyObject` into the destination owner's prefix. Colliding names get ` (2)`, ` (3)`, …

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | Source project |
| `fileIds` | string[] | yes | Roots to copy (files and/or folders) |
| `destProjectId` | string | no | Defaults to `projectId` |
| `destFolderPath` | string | no | Logical destination folder |
| `eventId` | string | no | Idempotency key for the job |

**Response `200`** (single file): `{ "files": […], "fileIds": ["…"] }`  
**Response `202`** (folder / batch): `{ "jobId": "uuid" }` — poll `GET /jobs/:id`; completed payload includes `fileIds`.

Cross-project copy is allowed when the actor can read the source and write the destination. Machine tokens only see owned projects.

---

## `POST /api/storage/v1/move`

Move into **another** project: server-side `CopyObject` into the destination owner's prefix, then the originals go to the source project's trash. Within one project use [`/rename`](#post-apistoragev1rename) — it only changes the logical path.

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | Source project |
| `fileIds` | string[] | yes | Roots to move (files and/or folders) |
| `destProjectId` | string | yes | Must differ from `projectId` (`400` otherwise) |
| `destFolderPath` | string | no | Logical destination folder |
| `eventId` | string | no | Idempotency key for the job |

**Response `200`** (single file): `{ "files": […], "fileIds": ["…"] }`  
**Response `202`** (folder / batch): `{ "jobId": "uuid" }` — poll `GET /jobs/:id` (`kind: "move"`); completed payload includes `fileIds` of the new copies.

The actor needs write access to **both** projects: the source loses its files. Everything is copied before anything is deleted, so a failure leaves at worst an extra copy, never a lost original. Copies get new `fileId`s, colliding names get ` (2)`, ` (3)`, …, and `uploaded_by` stays the original uploader. The `options` folder and canonical sidecars cannot be moved (`403`).

---

## `GET /api/storage/v1/jobs/:id`

Progress for long-running storage jobs (`copy`, `move`, `purge`, `recatalog`).

**Response `200`**

```json
{
  "job": {
    "id": "uuid",
    "kind": "copy",
    "state": "running",
    "total": 12,
    "done": 4,
    "error": null,
    "projectId": "uuid",
    "payload": { "fileIds": ["…"] },
    "createdAt": "…",
    "updatedAt": "…"
  }
}
```

---

## `GET /api/storage/v1/archive/plan`

Folder as ZIP: what the archives will be, without downloading anything. The plan
is derived from the catalog on every call — nothing is stored server-side.

**Query**

| Param | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | |
| `folderId` | string | no | Catalog row of the folder |
| `folderPath` | string | no | Used when `folderId` is absent; empty string = whole project |
| `partSize` | number | no | Bytes per archive. Default `2147483648` (2 GiB), clamped to 64 MiB … 2 GiB |

**Response `200`**

```json
{
  "plan": {
    "baseName": "Клип 12",
    "fileCount": 428,
    "totalBytes": 7516192768,
    "partSize": 2147483648,
    "version": "9f1c2ad4bb70e155",
    "parts": [
      {
        "index": 1,
        "name": "Клип 12-part1of4.zip",
        "fileCount": 118,
        "contentBytes": 2147000000,
        "archiveBytes": 2147045678,
        "oversize": false
      }
    ]
  },
  "limits": { "minPartSize": 67108864, "maxPartSize": 2147483648 }
}
```

`archiveBytes` is the exact `Content-Length` of that part. `oversize: true`
means the part holds a single file that is itself larger than `partSize` — files
are never split across parts. `parts: []` means the folder has no files.

Service rows (`options/`, `_catalog/`) are never included, admins included.
`413` when the subtree holds more than 100 000 items.

---

## `GET /api/storage/v1/archive`

One part, streamed. Viewer role is enough — the same as downloading a single
file.

**Query** — same as `/archive/plan`, plus:

| Param | Type | Required | Notes |
|---|---|---|---|
| `part` | number | no | Part index from the plan, 1-based. Default `1` |
| `version` | string | no | Plan fingerprint. Mismatch → `409` |

**Response `200`** — `application/zip`, uncompressed (`store`), with an exact
`Content-Length`, `Content-Disposition: attachment`, `Accept-Ranges: none` and
`X-Archive-Part: 2/4`.

**`409`** — `{ "message": "Folder changed — reload the archive list.", "version": "…" }`.
The folder changed after the plan was read, so part numbering is no longer the
same. Re-read the plan and start over.

Not resumable: entry CRCs are computed while streaming, so serving the middle of
an archive would mean re-reading everything before it. A broken part is
downloaded again.

Behind nginx the response carries `X-Accel-Buffering: no` — with
`proxy_buffering` on, a 2 GB response would be spooled to disk before the client
sees the first byte.

---

## Multipart upload

For objects larger than ~5 GiB or resumable uploads. After `complete`, the catalog is updated the same way as `/notify`.

| Endpoint | Body (summary) | Response |
|---|---|---|
| `POST /multipart/create` | `{ projectId, folderPath, fileName, contentType? }` | `{ uploadId, s3Key, fileName, folderPath, contentType }` |
| `POST /multipart/presign-part` | `{ projectId, s3Key, uploadId, partNumber, ttlSec? }` | `{ url, method: "PUT", partNumber, expiresIn }` |
| `POST /multipart/complete` | `{ projectId, s3Key, uploadId, folderPath, fileName, parts: [{ partNumber, etag }], … }` | `{ file, fileIds }` |
| `POST /multipart/abort` | `{ projectId, s3Key, uploadId }` | `{ ok: true }` |

Machine-api actions: `multipartCreate`, `multipartPresignPart`, `multipartComplete`, `multipartAbort`, `copy`, `getJob`, `deleteProject`, `restoreProject`.

---

## `POST /api/storage/v1/vault`

Ключи внешних сервисов и отчёт о потреблении. Тот же контракт доступен экшенами
`vendorKeys` / `vendorUsage` на `POST /api/v1` для машин с токеном `rc_…`.

**Ключи — перед задачей и только по нужным ей сервисам:**

```jsonc
{ "action": "keys",
  "services": ["eleven-labs"],
  "known": { "eleven-labs": 6 } }   // версии из локального сейфа
```

```jsonc
{ "keys": [ { "slug": "eleven-labs", "version": 7, "secret": "sk_…", "ttlSec": 21600 } ],
  "fresh": [],          // по этим версия у вас актуальная — ключ не поехал
  "unavailable": [],    // нет, на паузе, отозван или помечен proxy
  "vaultRevision": 42 }
```

`vaultRevision` приходит и в ответе на `heartbeat`. Разошлась с вашей — спросите
ключи заново: так отзыв доезжает за полминуты, а не по истечении `ttlSec`.

Копию храните шифрованной (Keychain / DPAPI), не дольше `ttlSec`, и никогда не
пишите ключ в логи: логи уезжают к нам, и вычистить их потом нечем.

**Потребление — сразу после ответа вендора, не дожидаясь `taskDone`:**

```jsonc
{ "action": "usage",
  "taskId": "0f5c…",
  "entries": [ { "service": "eleven-labs", "unit": "char", "units": 8140 } ] }
```

```jsonc
{ "recorded": 1, "duplicate": 0, "unknown": [], "unpriced": [], "noRate": [] }
```

⚠️ **Единицы, а не деньги.** Цену знает сайт: прайс, зашитый в плагин,
размножается по парку и разъезжается при первом же изменении цен у вендора.
`unit`: `token` · `char` · `sec` · `image` · `run`.

Повтор по той же тройке (задача, сервис, мера) расход не удваивает — держит
уникальный индекс. Ответ разбирайте: `unpriced` и `noRate` означают, что строка
**не записана**, и её надо прислать позже.

## `GET /api/storage/v1/tree`

Bootstrap / full subtree from Postgres cache.

**Query**

| Param | Required | Notes |
|---|---|---|
| `projectId` | yes | |
| `prefix` | no | Logical folder path (`""` = whole project). Matches `folder_path = prefix` or descendants. |

**Response `200`**

```json
{
  "entries": [ /* TreeEntry[] */ ],
  "cursor": 1842
}
```

`cursor` is the latest `storage_changes.seq` for this project (or `0` if empty). Use it as `since` for `/delta`.

---

## `GET /api/storage/v1/delta`

Incremental changes after a cursor.

**Query**

| Param | Required | Notes |
|---|---|---|
| `projectId` | yes | |
| `since` | no | Default `0`. Integer ≥ 0. Returns rows with `seq > since`. |

**Response `200`**

```json
{
  "changes": [ /* Change[] */ ],
  "cursor": 1900,
  "truncated": false,
  "settingsRevision": 42
}
```

| Field | Meaning |
|---|---|
| `changes` | Up to 5000 events, ordered by `seq` ascending |
| `cursor` | Advance local cursor to this value (even if `changes` is empty) |
| `truncated` | `true` if `since` is older than retained journal (~90 days) → discard local index and call `/tree` |
| `settingsRevision` | Current revision of the shared dictionaries. Global, not per project — differs from your local one → call `GET /settings`. Rides along here so clients need no separate polling loop. |

---

## `POST /api/storage/v1/presign`

Issue a short-lived signed URL. **Bytes go directly to/from R2**, not through the API.

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | |
| `method` | `"PUT"` \| `"GET"` | yes | PUT needs owner access |
| `folderPath` | string | no | Default `""`. For PUT when generating a new key |
| `fileName` | string | for PUT | Sanitized server-side |
| `contentType` | string | for PUT | Must pass upload policy |
| `s3Key` | string | for GET; optional for PUT | Must be under project prefix |
| `overwrite` | boolean | no | PUT only. Reuse the key of the file already named `fileName` in `folderPath` instead of minting a new one |
| `ttlSec` | number | no | 60–86400, default `3600` |

`overwrite` exists because the catalog looks a row up **by physical key**, and a fresh
upload mints a new `{uuid}-{name}`: without it, re-uploading the same name fails on
`assertNameFree` *after* the bytes are already in R2. With it the object, the catalog row
and the `file_id` stay the same — the file keeps its history and its links, and `/notify`
journals a `put`, so the pipeline sees an event and builds a task. The key is resolved
server-side: the browser has no business knowing the physical identity of an object. No
such file — a new key is minted, so the flag is harmless.

**Response `200` (PUT)**

```json
{
  "url": "https://…",
  "method": "PUT",
  "s3Key": "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
  "fileName": "clip.mov",
  "folderPath": "IN",
  "contentType": "video/quicktime",
  "expiresIn": 3600
}
```

**Response `200` (GET)**

```json
{
  "url": "https://…",
  "method": "GET",
  "s3Key": "…",
  "expiresIn": 3600
}
```

After a successful PUT to `url`, call **`/notify`**.

---

## `POST /api/storage/v1/notify`

Confirm an object that was uploaded via presigned PUT. Server runs HEAD on R2, upserts `project_files`, appends `storage_changes`.

**Body**

| Field | Type | Required |
|---|---|---|
| `projectId` | string | yes |
| `s3Key` | string | yes |
| `fileName` | string | yes |
| `folderPath` | string | no (default `""`) |
| `sizeBytes` | number | no |
| `contentType` | string | no |
| `originMtime` | number | no (unix seconds; preferred over R2 `mtime` metadata) |
| `contentHash` | string | no (e.g. sha256 hex; preferred over R2 metadata) |
| `eventId` | string | no (idempotency / dedup) |

Body fields override matching R2 object metadata when present. Metadata fallbacks: `x-amz-meta-mtime` / `mtime`, `x-amz-meta-sha256` / `sha256`.

**Response `201`:** `{ "file": ProjectFile }`  
**`409`:** object missing in R2 / write conflict  
**`400`:** key outside project prefix

---

## `POST /api/storage/v1/rename`

Rename or move a file/folder in the catalog. Does **not** change `s3Key` (logical path only). Uses the same `writeRename` path as the cabinet UI.

**Body**

| Field | Type | Required |
|---|---|---|
| `projectId` | string | yes |
| `fileId` | string | yes |
| `name` | string | no (at least one of `name` / `folderPath`) |
| `folderPath` | string | no |
| `eventId` | string | no |

**Response `200`:** `{ "file": ProjectFile }`  
**`404`:** file not found  
**`409`:** name collision in target folder

---

## `POST /api/storage/v1/mkdir`

Create a folder row in the cache (+ journal). Does not require an R2 object (folders are logical).

**Body**

| Field | Type | Required |
|---|---|---|
| `projectId` | string | yes |
| `name` | string | yes (1–180, no `/` or `\`) |
| `folderPath` | string | no (parent path, default `""`) |
| `eventId` | string | no |

Reserved name: `options` → `403`.

**Response `201`:** `{ "file": ProjectFile }`  
**`409`:** name already exists in that folder

---

## `DELETE /api/storage/v1/object`

Soft-delete a file or folder (cascade children). Rows are marked `deleted_at`; **R2 objects stay**. Journal `op: "delete"` so clients drop the item from lists.

**Body**

| Field | Type | Required |
|---|---|---|
| `projectId` | string | yes |
| `fileId` | string | yes |
| `eventId` | string | no |

**Response `200`**

```json
{
  "ok": true,
  "fileIds": ["uuid"],
  "deletedS3Keys": []
}
```

`options` folder → `403`. Missing file → `404`. Retention is **30 days**, then a purge removes the row and the object.

### `GET /api/storage/v1/trash?projectId=`

**Response `200`:** `{ "items": [{ "fileId", "name", "folderPath", "isFolder", "deletedAt", "sizeBytes" }] }`

### `POST /api/storage/v1/trash/restore`

**Body:** `{ "projectId", "fileId", "eventId"? }`  
If the parent folder is gone, restores to the project root. If the name is taken, uses `name (2).ext`. Folder restore also restores descendants deleted in the same cascade. Journal `put`.

**Response `200`:** `{ "file": ProjectFile }`

---

## `POST /api/storage/v1/reindex`

Full `ListObjectsV2` of the project prefix vs Postgres. Inserts / updates / removes cache rows and writes synthetic journal events.

**Query or body:** `projectId` (required)

**Response `200`**

```json
{
  "ok": true,
  "scanned": 120,
  "inserted": 3,
  "updated": 1,
  "removed": 0
}
```

Skips `options/*` and `project-meta.json` in the R2 listing. Catalog rows under `options/` (processing stats) are **not** deleted. New rows get a logical name (uuid prefix stripped); existing names are left alone. Max duration 120s. Owner (or admin) only.

---

## `GET /api/storage/v1/sidecars`

Read automation JSON from R2.

**Query**

| Param | Required | Values |
|---|---|---|
| `projectId` | yes | |
| `name` | yes | `folder-state` \| `options` |

**Response `200`:** `{ "key": "…", "body": "<raw json string>" }`  
**`404`:** object missing

---

## `PUT /api/storage/v1/sidecars`

Update sidecars. Discriminated by `kind`.

### `kind: "folder-state"`

Toggle automation (`folderState.json` + `projects.is_active` cache).

```json
{
  "kind": "folder-state",
  "projectId": "uuid",
  "enabled": true
}
```

**Response `200`:** `{ "folderState": { … } }`

### `kind: "options"`

Patch `exposedToSite` parameters in `options.json`.

`path` points at the property's `controlProps` — that is where the value lives and
where the desktop app reads it from. `value` is a boolean, number, string, a list of
strings (`autocomplete`) or a pair of numbers (`valueRange`); bounds, step and the
list of allowed choices come from the graph itself, never from the request.

```json
{
  "kind": "options",
  "projectId": "uuid",
  "changes": [
    { "path": ["nodes", "2", "data", "properties", "3", "controlProps"], "value": 30 }
  ]
}
```

**Response `200`:** `{ "options": [ /* ExposedOption[] */ ], "etag": "…" }`  
**`409`:** the parameter is not exposed, has a control the site cannot edit, or the
value is not one of the choices the graph allows. Numbers out of range are clamped
rather than rejected — see [PROJECT_OPTIONS_PANEL.md](./PROJECT_OPTIONS_PANEL.md).

### `kind: "raw"`

Replace entire sidecar body (optional conditional write).

```json
{
  "kind": "raw",
  "projectId": "uuid",
  "sidecar": "folder-state",
  "body": "{ … }",
  "ifMatch": "etag-optional"
}
```

**Response `200`:** `{ "ok": true, "etag": "…" }`  
**`409`:** precondition failed / business rule violation

---

## `POST /api/storage/v1/queue`

Task queue for the worker. One route with an `action` field rather than five paths —
the daemon calls `claim` on every pulse, and keeping five near-identical files for that
buys nothing. The same operations exist as actions on `POST /api/v1` for machines
holding an `rc_…` token; see [REMOTE_ACCESS_API.md](./REMOTE_ACCESS_API.md).

**No second token needed.** This surface accepts the `mch_…` token the client already
uses. The machine is identified by `machineUuid` — a UUID it generates once on first
launch and keeps in its own settings; the site registers the `remote_computers` row
itself on first contact. Hostname is only a human-readable label.

| `action` | Body (beyond `machineUuid` / `hostname`) | Response |
|---|---|---|
| `ping` | — | `{ ok: true }` — “I am online”, without asking for a task |
| `claim` | `capabilities?: string[]` | `{ task }` or `{ task: null }` when the queue is empty |
| `progress` | `taskId`, `stepId`, `status: "running"\|"done"\|"error"`, `message?` | `{ ok: true }` |
| `done` | `taskId`, `outFiles?: string[]`, `totalCost?: number` | `{ ok: true }` |
| `failed` | `taskId`, `error` | `{ ok: true }` |
| `release` | `taskId` | `{ ok: true }` |

**Claimed task**

```json
{
  "task": {
    "id": "uuid",
    "projectId": "uuid",
    "projectName": "Project",
    "ownerEmail": "client@example.com",
    "payload": { "schemaVersion": 1, "processingQueue": ["mainSearch"] },
    "attempts": 1,
    "maxAttempts": 3,
    "leaseExpiresAt": "2026-08-14T10:15:00.000Z"
  }
}
```

The lease lasts 15 minutes and is extended by every `progress` call — a long step must
keep reporting or the task returns to the queue. `done` is idempotent by `taskId`: a
repeat answers `ok` rather than failing. `failed` keeps the payload; `done` replaces it
with the outcome. `release` is for an emergency stop and does not count an attempt.

Visibility follows the token's role: an admin token works the shared queue, a regular
one only its owner's projects.

**Call `ping` on your own pulse, regardless of whether the worker is running.** The
admin UI shows two separate indicators per machine — *online* (any contact within 90 s)
and *worker polling* (a task request within 45 s). With an `mch_` token the site only
hears the machine when it asks for a task, so without `ping` the state “machine up,
worker off” is invisible and both indicators light up together.

**Response `409`** — the task is held by another machine (its lease expired and it was
re-claimed). **`404`** — no such task.

---

## `GET /api/storage/v1/settings`

Shared dictionaries: file types with extensions, node/data type colors, user path
masks. Installation-wide, **not** per project. Rationale and sync rules —
[SETTINGS_SYNC.md](./SETTINGS_SYNC.md).

**Query**

| Param | Required | Notes |
|---|---|---|
| `domains` | no | Comma-separated subset of `fileType,nodeType,dataType,pathPattern`. Omit for all. |

**Response `200`**

```json
{
  "revision": 42,
  "domains": {
    "fileType": [
      { "name": "video", "path": ["avi", "mov", "mp4"], "color": "#0a84fe", "isDefault": true }
    ]
  }
}
```

`path` means different things per domain: extensions for `fileType`, mask segments
for `pathPattern`, empty elsewhere. Entry order matters — an extension present in
two types belongs to the upper one. Entries are keyed by `name`; there is no `id`.

Program paths (ffmpeg, After Effects) and material folders are machine-local and
have no domain here — see [PIPELINE.md](./PIPELINE.md) §5.

---

## `PUT /api/storage/v1/settings`

**Body**

```json
{
  "baseRevision": 42,
  "domains": { "fileType": [ /* full domain */ ] }
}
```

Domains absent from `domains` are left untouched — send `fileType` alone without
knowing the rest. Extensions are lowercased and a leading dot is stripped; colors
are normalized to `#rrggbb` / `#rrggbbaa`.

**Response `200`** — same shape as `GET`, with the new `revision`.

**Response `409`** — `baseRevision` is stale. The body carries the whole current
document, so the client merges and retries without a second round trip:

```json
{
  "error": "revision-conflict",
  "revision": 47,
  "domains": { /* … */ }
}
```

Writing requires an `ADMIN` session, a machine token, or a computer token.

---

## Client flows

### Sync loop (website / processing app)

```
1. GET /tree?projectId=…          → apply entries, store cursor
2. loop every few seconds:
     GET /delta?projectId=…&since={cursor}
     if truncated → goto 1
     apply changes; cursor = response.cursor
```

### Upload (processing app)

```
1. POST /presign  { projectId, method: "PUT", folderPath, fileName, contentType }
2. HTTP PUT bytes to response.url  (Content-Type must match)
3. POST /notify   { projectId, s3Key, folderPath, fileName, sizeBytes, contentType }
4. Other clients see the put via /delta
```

**A name that is already taken is decided at step 1, not at step 3.** `/notify` →
`writeFilePut` rejects a duplicate name, and by then the bytes are already in R2 — the
upload is lost and the client has nothing to offer the person. The cabinet therefore
compares names against the tree it already holds and asks first, with three answers:

| answer | how it is sent | what happens |
|---|---|---|
| overwrite | `/presign` with `overwrite: true` | same object, same catalog row, same `file_id`; the file keeps its history and links, `/notify` journals a `put`, so the pipeline builds a task again |
| keep both | `fileName` replaced with `clip (2).mov` | a second file next to the first; the number goes before the extension, or the file stops being a video for everything that reads extensions |
| skip | nothing is sent | this file is not uploaded, the rest of the batch continues |

The same question covers a whole dropped folder: names are checked per destination
folder, and "do the same for the rest" holds until the end of that batch. Folders created
by this very upload are not in the tree yet — there is nothing to collide with there.

There is deliberately no "delete the old one": it gives the same result as overwrite and
pays for it with the file's identity — its links, its uploader and its connection to
earlier tasks.

### Download

```
POST /presign { projectId, method: "GET", s3Key }
→ GET response.url
```

Or use existing media proxy / legacy download routes for browser session users.

Whole folder:

```
GET /archive/plan?projectId=…&folderId=…   → { parts: […], version }
GET /archive?projectId=…&folderId=…&part=1&version=…   (repeat per part)
```

---

## Object key layout

```
projects/{userId}/{projectId}/project-meta.json
projects/{userId}/{projectId}/options/folderState.json
projects/{userId}/{projectId}/options/options.json
projects/{userId}/{projectId}/{folderPath}/{uuid}-{safeName}
```

`userId` and `projectId` are stable UUIDs. Logical folders live in Postgres; only files (and sidecar JSON) are R2 objects.

---

## Legacy routes

Cabinet UI still calls `/api/projects/[id]/drive/*` and `/files/*`. Those mutate through the same write-path and journal. **Fleet agents should use only `POST /api/v1`.** Per-user processing apps may keep `/api/storage/v1`.

| Legacy | Prefer |
|---|---|
| `GET /api/projects/:id/drive` | `GET /tree` |
| `POST /api/projects/:id/drive` (mkdir) | `POST /mkdir` |
| `DELETE …/drive/files/:fileId` | `DELETE /object` |
| `POST …/files/presign` + confirm | `POST /presign` + `/notify` |

---

## HTTP status cheat sheet

| Code | Typical cause |
|---|---|
| `200` / `201` | Success |
| `400` | Bad JSON / missing params / invalid key |
| `401` | Not authenticated |
| `403` | Reserved name, scoped token, inactive user |
| `404` | Project or file not found |
| `409` | Conflict (duplicate name, missing R2 object, ETag) |
| `503` | Storage not configured / R2 / reindex failure |
| `500` | Unexpected server error |
