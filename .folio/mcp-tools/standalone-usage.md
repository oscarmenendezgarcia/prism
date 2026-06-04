---
title: Standalone Usage (without Prism)
author: user
pinned: false
created: 2026-05-31
updated: 2026-06-04T08:32:54.177Z
---

## Three interfaces, without Prism

### 1. CLI
```bash
folio init my-project
folio page set stack/runtime --file runtime.md
folio search "redis timeout"
folio get stack/runtime#tests
folio export ./out        # markdown folder
folio import ./out
```

### 2. MCP server (point any client at it: Claude Code, Cursor, Windsurf)
```bash
folio mcp                 # MCP server over stdio
```
The agent has `folio_search` / `folio_get_page` / `folio_create_page` against the local DB. This is the standalone case: persistent agent memory without Prism.

#### Multi-folio — one server, any folio (no restart)

The MCP server is **not pinned to a single folio**. Every tool takes an optional
`folioRoot` and the server opens/caches a `FolioService` for that root per call,
so one running server serves any `.folio/` on disk — no re-register, no reconnect
to switch folios.

- **`folioRoot` omitted** → the server's startup directory (`process.cwd()`) is
  used as the default. This is the simple "cd into your repo" experience.
- **`folioRoot` = a directory** → the nearest `.folio/` is discovered by walking
  up from it (like `git` finding `.git`).
- **`folioRoot` = a `.folio` directory** → opened directly as the root.

```jsonc
// Work on a different project's folio in the same session:
folio_list({ folioRoot: "~/Documents/oncall" })
// → [{ id, name: "On-Call Postmortems", ... }]
folio_create_page({
  folioRoot: "~/Documents/oncall",
  folioId:   "<id from folio_list>",
  slug:      "2026/redis-outage",
  content:   "# Redis outage\n..."
})
```

Different folios never mix, so keep unrelated topics in separate ones and pick
which to use per call. A *Philosophy* folio and a *Mathematics* folio are just two
directories with two stable ids; the same server serves both — switching is only a
different `folioRoot`, no restart:

```jsonc
folio_list_chapters({ folioRoot: "~/kb/philosophy" })   // → ethics, metaphysics, …
folio_list_chapters({ folioRoot: "~/kb/mathematics" })  // → algebra, topology, …
```

Do **not** re-register the server with a different startup cwd per folio (editing
the client's MCP config) — that's fighting the symptom. Register it once; target
folios with `folioRoot`.

> Bulk authoring tip: to seed many pages at once, writing the `.md` files directly
> into the `.folio/` directory is valid and preferred over N `folio_create_page`
> calls — the file format *is* the file backend's interface. Use the MCP tools for
> incremental, in-session reads and writes.

#### Several folios in ONE repo (nested `.folio/`)

The unit is the directory: **one `.folio/` = one folio.** You can't put two folios
inside a single `.folio/` (`folio_list` on a file root always returns exactly one).
A repo holds *several* folios by having *several* `.folio/` directories at
different paths — natural in a monorepo, one folio per package.

Two rules decide which folio a call resolves to, from its `folioRoot`:

1. **One `.folio/` = one folio**, with a stable id derived from that directory's
   absolute path (or its `folio.json` id, if set).
2. **Nearest-ancestor wins.** Exactly like `git` finding `.git`: the server walks
   UP from `folioRoot` to the closest `.folio/`.

```
my-monorepo/
├── .folio/                       ← folio A (repo-wide)
└── packages/
    ├── web/
    │   └── .folio/               ← folio B (web only)
    └── api/                      ← no .folio of its own
```

| `folioRoot` | resolves to |
|---|---|
| `my-monorepo` | folio A |
| `my-monorepo/packages/web` | folio B |
| `my-monorepo/packages/web/src/anything` | folio B (nearest up is web's) |
| `my-monorepo/packages/api` | folio A (api has none → walks up to the root) |
| `my-monorepo/.folio` (passed directly) | folio A |

⚠️ **Shadowing — the one thing to watch.** An inner `.folio/` *hides* the outer one
for everything at or below it. If you point at `packages/web/...` expecting the
repo-wide folio but `packages/web/.folio/` exists, you silently get the **web**
folio, not folio A. To force the outer one, pass a path with no nearer `.folio/`,
or point `folioRoot` straight at `my-monorepo/.folio`.

Pointing at the **shared parent of sibling folios** resolves to neither: the walk
only goes UP, never down, so `folioRoot: my-monorepo/packages` (no `.folio` there)
skips `web` and `api` and resolves to folio A — or errors if no ancestor has a
`.folio/`. There is never a "which sibling?" ambiguity; you always target one
explicitly.

> **Stable ids and moving the repo.** A folio created via `folio_create` (or by
> Prism) persists its `id` in `folio.json`, so it keeps that id even if you move
> or rename the directory. A folio made purely by hand (just `.md` files, no
> `folio.json` id) derives its id from the path — so moving the directory changes
> its id, and any `folioId` you stored elsewhere goes stale. Create folios through
> the tool if you need the id to be durable.

### 3. HTTP API
```
POST /folios · POST /folios/:id/pages · GET /folios/:id/search?q=...
```

## Key difference: pull vs push

Automatic stage-aware injection is a feature of **Prism's pipeline runner**. Without Prism there is no pipeline → no automatic injection: the agent pulls from the tools **on demand** (pull-only). Prism adds the automatic push on top.

## [[ ]] autocomplete

Only in Prism's UI (an FTS-backed dropdown). In the CLI v1: NO autocomplete — `folio search <text>` returns the slugs and you copy them. Shell completion is phase 2.
