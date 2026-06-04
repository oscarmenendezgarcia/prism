---
title: Pluggable Storage Backend
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [arquitectura, backend, storage]
---

## The source of truth depends on context

The core defines the operations (get/search/create page); behind them sit two interchangeable backends. "SQLite is the source of truth" only holds for Prism.

## SQLite backend (Prism, embedded)

- Central DB `prism.db`. SQLite = source of truth **and** index.
- Folios bound to spaces via `space_folios`.
- It is a server with a database.

## File-backed backend (terminal / CLI)

- Discovers a **`.folio/` DIRECTORY** starting from the CWD, walking up the tree the way `git` does with `.git`.
- **Markdown = source of truth**, versioned alongside the repo via git → git IS the sync.
- No global registry, no `--folio` flag: the folio is the one in the folder you're in. Isolation by directory.

## File vs directory (the git model)

- **`.folio/` (DIRECTORY)** = the live local store. Markdown editable in place, git-diffable. Equivalent to `.git/`.
- **`name.folio` (zip FILE)** = an export/share artifact only. Equivalent to `git bundle`. See [[flows/export-import]].

If the live store were the zip, every read/write would have to unzip/re-zip and it wouldn't diff in git → bad idea. The zip is for sending, the directory is for working.

## Backend selection per space (Prism)

A Prism space chooses where its folio lives, using this same backend abstraction:

- **SQLite (universal default)** — folio in `data/prism.db`. For ANY space.
- **File-backend (opt-in)** — folio as a `.folio/` DIRECTORY inside the space's `working_directory`. Versioned with git, travels with the repo, same format as the standalone CLI.

**Rule:** the file-backend is only available if the space has a `working_directory`. No repo (ops, writing, research) → SQLite always. The presence of a working dir enables the option (the same way it gates bootstrap).

Per-space setting: `folioBackend: 'sqlite' | 'file'` (default `'sqlite'`). The `space_folios` binding still maps identity; with the file-backend the "folio" is the `.folio/` in the working dir. User+agent conflicts → last-write-wins + git.
