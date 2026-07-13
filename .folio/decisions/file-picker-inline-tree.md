---
title: Inline File Tree over Native OS Dialog for Directory Picker
author: agent
pinned: false
created: 2026-06-08T14:55:07.071Z
updated: 2026-06-08T14:55:07.071Z
---

## Decision

When building a working-directory picker, choose an **inline file tree** rendered in the UI over a native OS dialog triggered from the backend (AppleScript / zenity / PowerShell).

## Context

The space-settings feature needed a way for users to select a working directory instead of typing a path manually. Two options were evaluated:

- **Option A — Native OS dialog:** `GET /api/v1/fs/pick-directory` spawns an OS-specific command and returns the chosen path.
- **Option B — Inline file tree:** A React component calls `POST /api/v1/fs/browse` to lazily load directory contents and renders a navigable tree panel.

## Rationale for Option B

| Concern | Option A | Option B |
|---------|----------|----------|
| OS support | Must branch for macOS (AppleScript), Linux (zenity), Windows (PowerShell) | Single backend handler, OS-agnostic |
| Headless / no display | Fails silently or errors | Works — tree renders from filesystem API |
| Testability | Hard (mock AppleScript output?) | Easy (mock HTTP endpoints) |
| Code surface | High — display detection + OS commands + error handling | Low — `fs.readdir` + JSON response |
| UX transparency | User sees native dialog (familiar but opaque) | User sees actual directory tree (explicit) |

## Degradation

If the `/fs/browse` endpoint returns an error (permissions, network, etc.) the picker collapses and the input field accepts manual text entry. This covers headless and restricted environments without any special mode detection.

## Implementation pattern

```
GET  /api/v1/fs/home          → { path: "/Users/alice" }
POST /api/v1/fs/browse        → { path, entries: [{name, type, path}] }   (dirs only)
POST /api/v1/fs/validate      → { valid, exists, isDirectory, readable }
```

The component lazy-loads one level at a time; the server filters to `type: dir | symlink` only, keeping payloads small.
