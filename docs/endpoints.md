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
| GET | `/spaces/:spaceId/tasks` | List tasks. Params: `?column=`, `?assigned=`, `?limit=` (default 50, max 200), `?cursor=` |
| POST | `/spaces/:spaceId/tasks` | Create task `{ title, type, description?, assigned?, attachments? }` |
| DELETE | `/spaces/:spaceId/tasks` | Clear all tasks in space |
| GET | `/spaces/:spaceId/tasks/:id` | Get single task |
| PATCH | `/spaces/:spaceId/tasks/:id` | Update task fields |
| PUT | `/spaces/:spaceId/tasks/:id/move` | Move task `{ to: "todo|in-progress|done" }` |
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
| POST | `/runs` | Start pipeline `{ spaceId, taskId, stages? }` |
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

## Legacy routes

`/api/v1/tasks/*` → redirected to default space (backward compat shim).

## Error format

```json
{ "error": { "code": "SCREAMING_SNAKE_CASE", "message": "Human-readable." } }
```
