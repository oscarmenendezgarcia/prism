# Prism — MCP Server

> Maintained by agents. Update when tools are added, changed, or removed.

## Overview

The Prism MCP server exposes the Kanban board and pipeline as tools callable by Claude Code agents.

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
| `kanban_update_task` | `id` | `title`, `type`, `description`, `assigned`, `attachments`, `spaceId` | Update fields and/or attachments |
| `kanban_move_task` | `id`, `to` | `spaceId` | Move to `todo \| in-progress \| done` |
| `kanban_delete_task` | `id` | `spaceId` | Delete a task |
| `kanban_clear_board` | — | `spaceId` | Delete all tasks in a space |

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
| `kanban_start_pipeline` | `spaceId`, `taskId` | `stages` | Launch pipeline on a `todo` task. Returns `{ runId }` immediately |
| `kanban_get_run_status` | `runId` | — | Poll run status |

Run statuses: `pending`, `running`, `completed`, `failed`, `interrupted`

## Attachments

Attachments can be `type: "text"` (inline content) or `type: "file"` (absolute path on disk).

```json
{ "name": "ADR-1.md", "type": "file", "content": "/absolute/path/to/ADR-1.md" }
```

When listing tasks, attachment content is stripped — only `name` and `type` are returned. Fetch content via `GET /spaces/:spaceId/tasks/:id/attachments/:index`.

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
