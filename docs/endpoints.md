# Prism — API Endpoints

> Maintained by agents. Update when endpoints are added, changed, or removed.
> Base URL: `http://localhost:3000/api/v1`

## Spaces

| Method | Path | Description |
|--------|------|-------------|
| GET | `/spaces` | List all spaces |
| POST | `/spaces` | Create a space `{ name, workingDirectory?, pipeline? }` |
| PUT | `/spaces/:id` | Rename/update a space `{ name?, workingDirectory?, pipeline? }` |
| DELETE | `/spaces/:id` | Delete a space and all its tasks |

## Tasks (space-scoped)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/spaces/:spaceId/board` | What the board shows: `{ columns: { [statusId]: { tasks, total, rankBefore?, rankAfter? } }, epics }`. The first 100 cards of a column, the last 50 of a done one, in rank order. Params: `?limits=<statusId>:<n>,...` (max 2000), `?epic=<id>`, `?include=<id>,...` (max 20: cards to bring past the limit of their column, not added to `total`). Cards carry `epic`, `parentKey`, `progress`, `pendingQuestions` and at most 400 characters of description (`descriptionTruncated`), and no comments. Answers with an `ETag`, and 304 to an `If-None-Match` that still holds |
| GET | `/spaces/:spaceId/tasks` | List issues grouped by status id. Params: `?status=` (or `?column=`), `?category=todo\|in-progress\|done`, `?assigned=`, `?limit=` (default 50, max 200), `?cursor=` |
| GET | `/spaces/:spaceId/tasks?parent=<id>` | The issues under one, without descriptions: `{ tasks, done, total }`. `?limit=` (default 200, max 1000) |
| GET | `/spaces/:spaceId/tasks?ids=<id>,<id>` | Issues by id, in any column: `{ tasks, total }` (max 100) |
| POST | `/spaces/:spaceId/tasks` | Create issue `{ title, type, statusId?, priority?, labels?, parentId?, dueDate?, estimate?, description?, assigned?, attachments?, dependsOn? }`. `type` may be `epic`. Starts in the first to-do status |
| DELETE | `/spaces/:spaceId/tasks` | Clear all tasks in space |
| GET | `/spaces/:spaceId/tasks/:id` | Get an issue, with its `children`. Every route here takes the key (`WEB-142`) in place of the id |
| GET | `/spaces/:spaceId/tasks/:id?view=panel` | The whole issue with its `isBlocked`, `blockedByCount` and `parent`, no attachment content and no `children`. `ETag` and 304 as the board |
| GET | `/spaces/:spaceId/tasks/:id/history` | What changed, newest first: `{ history: [{ actor, field, oldValue, newValue, createdAt }] }` |
| GET | `/issues/:key` | Find an issue by key in any space. Old keys keep working |
| PUT | `/spaces/:spaceId/statuses` | Replace the statuses `{ statuses: [{ id?, name, category }], moves?: { removedId: targetId } }`. No id means new. 409 `STATUS_IN_USE` if a removed status has issues and no destination |
| PUT | `/spaces/:spaceId/tasks/:id` | Update fields. `parentId`, `dueDate` and `estimate` take null to clear; `labels` takes [] |
| PATCH | `/spaces/:spaceId/tasks/rank` | Re-rank at once: `{ updates: [{ id, rank }] }`, or `{ rebalance: { id, overId, insertBefore } }` to place a card next to another and spread out its whole column |
| PUT | `/spaces/:spaceId/tasks/:id/move` | Move to a status of the space `{ to: "<status id>" }`. Defaults: `todo`, `in-progress`, `in-review`, `done` |
| DELETE | `/spaces/:spaceId/tasks/:id` | Delete task |
| PUT | `/spaces/:spaceId/tasks/:id/attachments` | Replace attachments array entirely (empty array clears all) |
| PATCH | `/spaces/:spaceId/tasks/:id/attachments` | Merge attachments by name (upsert in place, keep unlisted) |
| GET | `/spaces/:spaceId/tasks/:id/attachments/:index` | Get attachment content |

### PUT /tasks/:id/attachments — replace semantics

Overwrites the entire attachments array. An empty array clears all attachments.

Request body:
```json
{ "attachments": [...] }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `attachments` | `Attachment[]` | yes | Same schema as task creation. Replaces all existing attachments. |

Error responses:
- `400 VALIDATION_ERROR` — `attachments` is missing or not a valid array.
- `413 ATTACHMENT_LIMIT_EXCEEDED` — the incoming count exceeds `ATTACHMENT_MAX_COUNT` (20).

### PATCH /tasks/:id/attachments — merge semantics

Merges incoming attachments by name into the existing array. Keeps unlisted items unchanged.

Request body:
```json
{ "attachments": [...] }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `attachments` | `Attachment[]` | yes | Upserts by `name` (preserves order, appends new names). Empty array is a no-op. |

Merge algorithm:
- Existing items whose `name` matches an incoming item are updated in place (original position preserved).
- New names are appended in the order they appear (last-write-wins for duplicates within the payload).
- Items not mentioned in the payload are kept unchanged.

Error responses:
- `400 VALIDATION_ERROR` — `attachments` is missing or not a valid array.
- `413 ATTACHMENT_LIMIT_EXCEEDED` — the merged count would exceed `ATTACHMENT_MAX_COUNT` (20). Body includes `{ existing, incoming, merged, max }`.

### Task dependencies (`dependsOn`)

`dependsOn` is an array of task IDs in the same space, capped at 20. It is accepted on task
create and update, and validated at the boundary:

| Failure | Status | Code |
|---------|--------|------|
| A referenced task does not exist | 422 | `DEPENDENCY_NOT_FOUND` |
| The change would close a cycle | 409 | `CYCLE_DETECTED` |
| Shape/length invalid | 400 | `VALIDATION_ERROR` |

`GET /tasks` derives two read-only fields per task from it — they are computed, never stored:

- `isBlocked` — true while any dependency is not in `done`
- `blockedByCount` — how many are still unfinished

Deleting a task scrubs its id out of every other task's `dependsOn` in the same transaction, so
no dangling reference survives. **`POST /runs` refuses a blocked task with 409 `TASK_BLOCKED`**;
that check sits at the single entry point shared by the UI, MCP and REST.

### GET /tasks response shape

```json
{
  "todo": [Task],
  "in-progress": [Task],
  "done": [Task],
  "total": 42,
  "nextCursor": "base64url | null"
}
```

## Activity

| Method | Path | Description |
|--------|------|-------------|
| GET | `/spaces/:spaceId/activity` | Space activity feed |
| GET | `/activity` | Global activity feed |

Params: `?type=`, `?limit=` (default 20, max 200), `?from=`, `?to=`, `?cursor=`

## Pipeline runs

| Method | Path | Description |
|--------|------|-------------|
| POST | `/runs` | Start pipeline `{ spaceId, taskId, stages? }`. **409 `TASK_BLOCKED`** when the task has unfinished dependencies |
| GET | `/runs/:runId` | Get run status |
| GET | `/runs/:runId/stages/:n/log` | Stream stage log |
| DELETE | `/runs/:runId` | Abort/delete run |

## Config

| Method | Path | Description |
|--------|------|-------------|
| GET | `/config/files[?spaceId=]` | List editable config files. If `spaceId` is provided, also includes `<workingDirectory>/CLAUDE.md` and `<workingDirectory>/.claude/agents/*.md` from the space's project dir. |
| GET | `/config/files/:fileId[?spaceId=]` | Read file content |
| PUT | `/config/files/:fileId[?spaceId=]` | Write file content |

### Config file scopes

| Scope | Source |
|-------|--------|
| `global` | `~/.claude/*.md` |
| `agent` | `~/.claude/agents/*.md` |
| `project` | `./CLAUDE.md` (Prism's own project dir) |
| `space-project` | `<space.workingDirectory>/CLAUDE.md` |
| `space-agent` | `<space.workingDirectory>/.claude/agents/*.md` |

## Harnesses

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/harnesses` | Resolve which CLI harnesses (`claude`, `opencode`, `pi`, `hermes`) are installed on this machine, with an `installUrl` for each unavailable one (for the UI's install links). |

Response shape:

```jsonc
{
  "harnesses": [
    { "cliTool": "claude",  "modelFormat": "preset",        "available": true,  "path": "/usr/local/bin/claude",  "installUrl": "https://www.anthropic.com/product/claude-code" },
    { "cliTool": "opencode", "modelFormat": "provider/model", "available": false, "path": null,                       "installUrl": "https://opencode.ai/" }
  ]
}
```

## Legacy routes

`/api/v1/tasks/*` → redirected to default space (backward compat shim).

## Error format

```json
{ "error": { "code": "SCREAMING_SNAKE_CASE", "message": "Human-readable." } }
```
