# Prism MCP Server

Exposes the [Prism](../README.md) REST API as six MCP tools callable by Claude Code and Claude Desktop. Agents can call `kanban_create_task`, `kanban_move_task`, and others directly — no curl boilerplate needed in prompts.

Architecture: ADR-001 — stdio transport, HTTP client coupling, `@modelcontextprotocol/sdk`.

---

## Prerequisites

- **Node.js** v18 or later (v23 recommended — matches the main project)
- **Prism server running** at `http://localhost:3000`
  - Start it with: `node server.js` from the project root
- **npm** (included with Node.js)

---

## Installation

```bash
cd /path/to/prism/mcp
npm install
```

This installs `@modelcontextprotocol/sdk` and its dependencies into `mcp/node_modules/`. The main project root is unaffected — it retains zero dependencies.

Verify the install:

```bash
node -e "import('@modelcontextprotocol/sdk/server/mcp.js').then(m => console.log('SDK OK'))"
```

---

## Configuration

### Claude Code — project-scoped (recommended)

Create or edit `.claude/settings.json` in the `prism` project root:

```json
{
  "mcpServers": {
    "kanban": {
      "command": "node",
      "args": ["./mcp/mcp-server.js"]
    }
  }
}
```

This works from any working directory inside the project because Claude Code resolves the path relative to the project root.

### Claude Code — global

Add to `~/.claude/settings.json` (replace `/absolute/path/to` with your actual path):

```json
{
  "mcpServers": {
    "kanban": {
      "command": "node",
      "args": ["/absolute/path/to/prism/mcp/mcp-server.js"],
      "env": {
        "KANBAN_API_URL": "http://localhost:3000/api/v1"
      }
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, or `%APPDATA%\Claude\claude_desktop_config.json` on Windows:

```json
{
  "mcpServers": {
    "kanban": {
      "command": "node",
      "args": ["/absolute/path/to/prism/mcp/mcp-server.js"],
      "env": {
        "KANBAN_API_URL": "http://localhost:3000/api/v1"
      }
    }
  }
}
```

After editing the config, restart Claude Desktop for changes to take effect.

### Environment variable

`KANBAN_API_URL` — override the base URL of the Kanban REST API.
Default: `http://localhost:3000/api/v1`

Use this when the Kanban server runs on a non-default port:

```bash
KANBAN_API_URL=http://localhost:4000/api/v1 node mcp/mcp-server.js
```

---

## Verification

1. Start the Kanban server: `node server.js`
2. Reload Claude Code (or restart Claude Desktop).
3. Ask Claude: "List all Kanban tasks" — it should call `kanban_list_tasks` automatically.
4. Inspect MCP server logs in Claude Code's Output panel (look for `[MCP]` lines on stderr).

---

## Tool Reference

All tools return a JSON response in a `text` content block. On error, `isError: true` is set and the text is `Error [CODE]: message`.

### `kanban_list_tasks`

List all tasks, optionally filtered by column or assigned agent.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `column` | `"todo" \| "in-progress" \| "done"` | No | Filter to a single column |
| `assigned` | string | No | Filter to tasks assigned to this agent |

**Example:** "Show me all in-progress tasks assigned to developer-agent"

```json
{ "column": "in-progress", "assigned": "developer-agent" }
```

---

### `kanban_get_task`

Get a single task by ID. Searches all columns and returns the task with a `column` field.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Task ID |

---

### `kanban_create_task`

Create a new task in the `todo` column.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | Yes | Task title (max 200 chars) |
| `type` | `"task" \| "research"` | Yes | Task type |
| `description` | string | No | Optional description (max 1000 chars) |
| `assigned` | string | No | Agent name to assign to |

---

### `kanban_update_task`

Update one or more fields of an existing task in-place. Only provided fields change.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Task ID to update |
| `title` | string | No | New title |
| `type` | `"task" \| "research"` | No | New type |
| `description` | string | No | New description |
| `assigned` | string | No | New assigned agent |

---

### `kanban_move_task`

Move a task to a different column.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Task ID to move |
| `to` | `"todo" \| "in-progress" \| "done"` | Yes | Target column |

---

### `kanban_delete_task`

Permanently delete a task from any column. This action is irreversible.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Task ID to delete |

---

## Running Tests

Unit tests for the HTTP client (no server required):

```bash
node --test mcp/tests/kanban-client.test.js
```

Integration tests (starts a Kanban server on port 3099, no external server needed):

```bash
node --test mcp/tests/mcp-server.test.js
```

Run all tests in the mcp/ sub-package:

```bash
cd mcp && npm test
```

---

## Troubleshooting

### "Kanban server is not running at localhost:3000"

The MCP server cannot connect to the Kanban REST API. Start it:

```bash
node server.js
```

Then retry the tool call — Claude Code will call the tool again on the next request.

### MCP server not appearing in Claude Code

1. Verify the path in your settings is correct and the file exists:
   ```bash
   ls mcp/mcp-server.js
   ```
2. Verify npm packages are installed:
   ```bash
   ls mcp/node_modules/@modelcontextprotocol/sdk
   ```
3. Test the server starts without error:
   ```bash
   echo '{}' | node mcp/mcp-server.js
   ```
   You should see `[MCP] ... [INFO] Starting prism v1.0.0` on stderr.
4. Reload the Claude Code window (Cmd+Shift+P > "Developer: Reload Window").

### "tools/list returns 0 tools" or MCP not connecting

Check that `node` is in your PATH from within the MCP server's environment. Claude Code spawns the process with a limited environment. Add the full path to node in the config:

```json
{
  "mcpServers": {
    "kanban": {
      "command": "/usr/local/bin/node",
      "args": ["/absolute/path/to/prism/mcp/mcp-server.js"]
    }
  }
}
```

Find your node path with: `which node`

### stdout corruption / MCP protocol errors

All application logging in `mcp-server.js` goes to stderr. If you see binary or JSON-RPC frames mixed with log lines, confirm you have not added any `console.log()` calls to `mcp-server.js` or `kanban-client.js` — those would corrupt stdout. Use `process.stderr.write()` for any logging.
