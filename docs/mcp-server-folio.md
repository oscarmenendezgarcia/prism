# Prism — Folio MCP Server

> Maintained by agents. Update when tools are added, changed, or removed.
> See [`mcp-server.md`](mcp-server.md) for the separate Kanban MCP server.

## Overview

The Folio MCP server exposes Folio (the navigable, augmentable knowledge base — see [`.folio/`](../.folio) for the format itself) as tools callable by Claude Code agents.

- **Entry point:** `mcp/folio-mcp-server.js` (tool definitions live in `mcp/folio-tools.js`, imported via `registerFolioTools`)
- **Transport:** `StdioServerTransport` — Claude Code manages the process lifecycle
- **Backend:** opens a `FolioService` directly — no HTTP hop through `node server.js`, no dependency on the Kanban server running
- **Multi-folio:** the server is **not** pinned to a single folio. Every tool accepts an optional `folioRoot` (absolute path to a directory at or under a repo containing a `.folio/`); when omitted, the server's startup directory (`process.cwd()`) is used. Roots are opened/cached on demand — no restart needed to switch folios.
- **Logging:** all logs go to stderr (stdout is reserved for the MCP protocol); one structured line per call: `{ tool, folioId, ok, ms }`.

Works standalone against any `.folio/`-bearing directory — does not require `node server.js` to be running.

## Tools

All tool names are prefixed `folio_`, available as `mcp__folio__folio_*` in Claude Code. Every tool below also accepts the optional `folioRoot` param described above (omitted from the tables for brevity).

### Page tools

| Tool | Required params | Optional params | Description |
|------|----------------|----------------|-------------|
| `folio_search` | `query`, `folioId` | `limit` (def 20, max 100) | Full-text search (FTS5/BM25) across pages in a folio. Returns ranked `{ slug, title, score, snippet }` (snippet = first 200 chars). |
| `folio_get_page` | `slug`, `folioId` | — | Get a page by `"chapter/page"` slug, or a specific section with `"chapter/page#section-slug"` (resolved the same way a `[[chapter/page#section]]` reference would be). |
| `folio_list_chapters` | `folioId` | — | List all chapters with `{ slug, title, position, pages }` (page count per chapter). |
| `folio_create_page` | `slug`, `content`, `folioId` | `title` (inferred from slug if absent) | Create a page. The chapter is created automatically if it doesn't exist yet. **Author is always `'agent'`** — refuses (`Folio not active`) if `folioId` doesn't resolve to an active folio, so an agent can't back-door-create one. |
| `folio_update_page` | `slug`, `content`, `folioId` | — | Replace a page's content. Title and pin-state updates are out of scope for this tool. |
| `folio_delete_page` | `slug`, `folioId` | — | Delete a page. Returns `{ deleted: true }` on success, `{ deleted: false }` if the slug doesn't resolve (not treated as an error). |

### Attachment tools

| Tool | Required params | Optional params | Description |
|------|----------------|----------------|-------------|
| `folio_list_attachments` | `slug`, `folioId` | — | List attachment metadata (`id`, `name`, `mimeType`, `size`) for a page. No blob bytes. |
| `folio_get_attachment` | `slug`, `name`, `folioId` | — | Fetch an attachment's blob. Images are returned as MCP image content; everything else as a base64 JSON envelope (`{ name, mimeType, base64 }`). |

### Folio (collection) tools

| Tool | Required params | Optional params | Description |
|------|----------------|----------------|-------------|
| `folio_list` | — | — | List all folios in the backend. Returns `[{ id, name, createdAt }]`. |
| `folio_create` | `name` | — | Create a new Folio. **Explicit user gesture** — agents should not call this on behalf of a user without confirmation. |
| `folio_delete` | `folioId` | — | **Destructive.** Deletes a Folio and ALL its chapters, pages, attachments, and FTS rows. Refused (`folio-level delete unsupported on file backend; use the CLI`) when the backend is `file`-kind — an agent must not be able to wipe a user's `.folio/` working directory. |

### Import / export tools

| Tool | Required params | Optional params | Description |
|------|----------------|----------------|-------------|
| `folio_export` | `folioId`, `destPath` | — | Export a Folio. If `destPath` ends in `.folio`, produces a zip archive (`packFolio`); otherwise writes a plain markdown folder (`exportFolio`). Returns counts: `{ dir\|file, name, chapters, pages, attachments }`. |
| `folio_import` | `srcPath` | `name` (overrides the manifest's name) | Import a Folio from a markdown folder or a `.folio` zip archive (detected by the `.folio` extension on `srcPath`). Always creates a **new** folio in the store. Returns `{ folioId, counts, skipped[] }`. |

## The `folioRoot` param

Every tool above accepts it:

> Absolute path to a directory at or under a repo that contains a `.folio/`. Omitted → the server default folio (resolved from its startup directory).

This is what makes one running `folio-mcp-server.js` process usable across multiple repos/folios in the same session without restarting — pass a different `folioRoot` per call to target a different `.folio/`.

## Configuration (`.claude/settings.json`)

```json
{
  "mcpServers": {
    "folio": {
      "command": "node",
      "args": ["./mcp/folio-mcp-server.js"]
    }
  }
}
```

No env var is required — unlike the Kanban server, Folio doesn't talk to an HTTP API, so there's no equivalent of `KANBAN_API_URL` to set.
