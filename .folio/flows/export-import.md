---
title: Export / Import
author: user
pinned: false
created: 2026-05-31
updated: 2026-06-04T08:15:48.802Z
---

## Phase 1 — A markdown folder (the canonical form)

- chapter = folder, page = `.md` file, slug = path.
- YAML frontmatter per page: `author`, `pinned`, `created`, `updated`, `tags`.
- `_attachments/<chapter>/<page>/` for blobs.
- `folio.json` = the manifest (name, config, format version).

```
my-folio/
├── folio.json
├── stack/
│   ├── runtime.md
│   └── running.md
└── _attachments/...
```

## The strategic payoff: git IS your sync

If a folio is a markdown folder, you need no sync infrastructure. `git init` on the folder gives versioning, history, and team sharing, with a tool every dev already uses. Instead of building and running custom sync machinery, Folio gets it for free by leaning on git — closing the sync gap with zero extra infrastructure.

## Round-trip

The complete frontmatter makes the folder re-importable. Design the frontmatter from the start so the round-trip is possible, even if import is implemented later. It opens the door to storage eventually BEING the folder (the Obsidian model).

## Phase 2 — The .folio wrapper

`name.folio` = a **zip** of the folder + the manifest. It is NOT a proprietary format: inside, it's still markdown (like `.docx`/`.epub`). Transparent, no lock-in. A single artifact for sharing. It is literally `zip` → deferrable.

## Source of truth

SQLite at runtime (Prism); markdown/.folio is export/import. With the file-backend, the markdown IS the truth. See [[architecture/storage-backend]].
