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
| PUT | `/spaces/:spaceId/tasks/:id/attachments` | Replace attachments |
| GET | `/spaces/:spaceId/tasks/:id/attachments/:index` | Get attachment content |

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
