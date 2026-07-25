# Prism — Kanban MCP Server

> Maintained by agents. Update when tools are added, changed, or removed.
> See [`mcp-server-folio.md`](mcp-server-folio.md) for the separate Folio MCP server.

## Overview

The Prism Kanban MCP server exposes the Kanban board and pipeline as tools callable by Claude Code agents.

- **Entry point:** `mcp/mcp-server.js`
- **Transport:** `StdioServerTransport` — Claude Code manages the process lifecycle
- **Config:** `KANBAN_API_URL` env var (default: `http://localhost:3000/api/v1`)
- **Auto-configured via:** `.claude/settings.json`

Requires `node server.js` to be running before the MCP server is useful.

## Tools

All tool names are prefixed `kanban_` and available as `mcp__prism__kanban_*` in Claude Code.

### Task tools

| Tool | Required params | Optional params | Description |
|------|----------------|----------------|-------------|
| `kanban_list_tasks` | — | `column`, `assigned`, `limit` (def 50, max 200), `cursor`, `spaceId` | List tasks with pagination. Returns `{ todo, in-progress, done, total, nextCursor }` |
| `kanban_get_task` | `id` | `spaceId` | Get a single task by ID |
| `kanban_create_task` | `title`, `type` | `description`, `assigned`, `spaceId` | Create task in `todo` |
| `kanban_update_task` | `id` | `title`, `type`, `description`, `assigned`, `attachments`, `mode`, `pipeline`, `spaceId` | Update fields and/or attachments. `mode` defaults to `merge`; pass `mode:'replace'` to overwrite the entire array |
| `kanban_move_task` | `id`, `to` | `spaceId` | Move to `todo \| in-progress \| done` |
| `kanban_delete_task` | `id` | `spaceId` | Delete a task |
| `kanban_clear_board` | — | `spaceId` | Delete all tasks in a space |
| `kanban_search_tasks` | `q` | `limit` (def 20, max 50) | Full-text search (FTS5/BM25) across **all spaces** — title + description. Returns `{ task, spaceId, spaceName, column }` per hit. Prefer this over iterating `kanban_get_task` when you don't know the spaceId. |

### Space tools

| Tool | Required params | Optional params | Description |
|------|----------------|----------------|-------------|
| `kanban_list_spaces` | — | — | List all spaces |
| `kanban_create_space` | `name` | — | Create a new space |
| `kanban_rename_space` | `id`, `name` | — | Rename a space |
| `kanban_delete_space` | `id` | — | Delete space and all its tasks |

### Activity tool

| Tool | Required params | Optional params | Description |
|------|----------------|----------------|-------------|
| `kanban_list_activity` | — | `spaceId`, `type`, `limit` (def 20, max 200), `from`, `to`, `cursor` | Activity feed with pagination |

Activity event types: `task.created`, `task.moved`, `task.updated`, `task.deleted`, `space.created`, `space.renamed`, `space.deleted`, `board.cleared`

### Pipeline tools

| Tool | Required params | Optional params | Description |
|------|----------------|----------------|-------------|
| `kanban_start_run` | `spaceId`, `taskId` | `stages` | Launch pipeline on a `todo` task. Returns `{ runId }` immediately |
| `kanban_get_run_status` | `runId` | — | Poll run status |
| `kanban_stop_run` | `runId` | — | Send SIGTERM to active stage; mark run as `interrupted`. Run can be resumed later |
| `kanban_resume_run` | `runId` | `fromStage` | Resume an `interrupted` or `failed` run. `fromStage` is zero-based; omit to auto-detect |

Run statuses: `pending`, `running`, `completed`, `failed`, `interrupted`

**Stop vs delete:** `kanban_stop_run` marks the run as `interrupted` and preserves the run directory so it can be resumed. `DELETE /api/v1/runs/:runId` removes the run permanently.

**Deprecated aliases:** the previous names `kanban_start_pipeline`, `kanban_stop_pipeline`, and `kanban_resume_pipeline` remain registered as thin wrappers that delegate to the new run-verb tools. Invoking an alias produces a single WARN log line (`deprecated_tool_call name=<old> replacement=<new>`) but is otherwise a no-op difference for callers. They will be removed in a future release once telemetry shows no clients still use them — prefer the new names in any new integration.

### Comment tools

| Tool | Required params | Optional params | Description |
|------|----------------|----------------|-------------|
| `kanban_add_comment` | `spaceId`, `taskId`, `text`, `type` | `author` (def `'user'`), `targetAgent` | Add a comment. `type` is `'note'` \| `'question'` \| `'answer'`. A `'question'` comment **automatically blocks the task's active pipeline run** until answered. `targetAgent` routes the question to a specific pipeline agent for auto-resolution (must be in the task's pipeline) — falls back to human escalation (`needsHuman: true`) if it can't resolve. Returns `{ comment, pipelineBlocked, runId? }`. |
| `kanban_answer_comment` | `spaceId`, `taskId`, `commentId`, `answer` | `author` (def `'user'`) | Answer an open question comment. Creates an answer comment (`parentId = commentId`), marks the question `resolved: true`, and unblocks the run once no open questions remain. |

## Attachments

Attachments support three types:

| `type` | `content` | Description |
|--------|-----------|-------------|
| `"text"` | Inline string | Up to 100 KB of text content |
| `"file"` | Absolute path | Reads from disk when the user opens the attachment |
| `"link"` | `https://` URL | Clickable link; opens in a new browser tab |

Examples:
```json
{ "name": "ADR-1.md",     "type": "file", "content": "/absolute/path/to/ADR-1.md" }
{ "name": "notes",        "type": "text", "content": "Implemented JWT auth..." }
{ "name": "PR #82",       "type": "link", "content": "https://github.com/owner/repo/pull/82" }
{ "name": "CI Build 124", "type": "link", "content": "https://circleci.com/gh/owner/repo/124" }
```

### Link attachments

Agents that produce external URLs (PR links, CI builds, deployment previews, bug-tracker tickets) should prefer `type: "link"` over embedding URLs inside comment text. Link attachments are **durable artifacts** on the card — visible in the Attachments tab, clickable from the UI, and carried through the full merge-by-name pipeline.

```js
// Example: developer-agent posts a PR link
kanban_update_task({
  id: "task-123",
  spaceId: "space-abc",
  attachments: [
    { name: "PR #82", type: "link", content: "https://github.com/owner/repo/pull/82" }
  ]
})
```

**Validation rules for `type: "link"`:**
- `content` must be a valid URL parseable by the WHATWG `URL` constructor
- Scheme must be `http:` or `https:` (other schemes are rejected)
- Max length: 2048 characters
- The URL is never fetched by the server — it is stored as-is and rendered in the browser

**Content preservation:** unlike `text` and `file` attachments (whose `content` is stripped in list responses), `link` attachment `content` is returned in the task list so the frontend can display the hostname without a second API call.

### Merge semantics (default behaviour)

`kanban_update_task` with `attachments` uses **merge-by-name** by default (HTTP `PATCH`):
- Incoming items whose `name` matches an existing attachment **upsert in place** (original position preserved).
- New names are **appended**.
- Existing attachments not mentioned in the payload are **kept untouched**.

This means pipeline stages can each call `kanban_update_task({ attachments: [...] })` independently and the card accumulates all stages' artifacts.

To **clear or overwrite** the whole array, pass `mode: "replace"` explicitly (uses HTTP `PUT`):
```js
kanban_update_task({ id, spaceId, attachments: [], mode: "replace" })
```

This maps to distinct HTTP verbs at the REST layer:
- `PATCH /tasks/:id/attachments` — merge (default)
- `PUT /tasks/:id/attachments` — replace entirely

When listing tasks, `text` and `file` attachment content is stripped — only `name` and `type` are returned. `link` content (URL) is preserved. Fetch full content for any type via `GET /spaces/:spaceId/tasks/:id/attachments/:index`.

## Cursor pagination

`kanban_list_tasks` and `kanban_list_activity` use opaque cursor tokens.

```
page1 = kanban_list_tasks({ limit: 20 })
// → { todo: [...], total: 85, nextCursor: "eyJjb2wi..." }

page2 = kanban_list_tasks({ limit: 20, cursor: page1.nextCursor })
// → { todo: [...], total: 85, nextCursor: "eyJjb2wi..." }
```

`nextCursor` is `null` on the last page.

## Configuration (`.claude/settings.json`)

```json
{
  "mcpServers": {
    "prism": {
      "command": "node",
      "args": ["./mcp/mcp-server.js"],
      "env": { "KANBAN_API_URL": "http://localhost:3000/api/v1" }
    }
  }
}
```
