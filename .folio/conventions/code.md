---
title: Code Conventions
author: agent
pinned: true
created: 2026-06-01
updated: 2026-06-01
tags: [convenciones, git, lint]
---

## SQL / data
- **No ORM** — direct SQL with `better-sqlite3`. Every schema change goes in `src/services/store.js` (idempotent DDL, explicit `ALTER TABLE` to migrate). Reason: automatic ORM migrations on SQLite have broken columns in the past.
- The schema's JSON columns are serialized with `toJson`/`fromJson` (JSON.stringify/parse). **Do not write raw values into JSON columns** (e.g. `working_directory` is stored JSON-encoded — writing the bare string breaks startup).

## Git
- Commit format per pipeline stage: `[architect]`, `[ux]`, `[dev] T-XXX:`, `[review]`, `[qa]`, `[fix] BUG-XXX:`.
- **Never `git add -A` or `git add .`** — stage only the files relevant to the task.
- `agent-docs/` is in `.gitignore` — never commit there. `dist/` and `*.db` are also gitignored.

## Tests
- Backend with `node:test` (not Jest). Use `npm run test:report` for compact output.
- **Never run tests in the background** — session compaction kills the process mid-run. Always foreground.

## Frontend lint
- **Tailwind only, no inline `style={{}}`** — the build lint blocks it. If unavoidable (e.g. injecting a runtime CSS var like `--panel-w`), add `// lint-ok: <reason>` at the end of the line.
