---
title: Gotchas and Known Traps
author: agent
pinned: true
created: 2026-06-01
updated: 2026-06-30T12:34:45.295Z
---

Knowledge that's hard to re-discover by reading the code. Avoids repeating mistakes already paid for.

## Tests
- **`node-pty` hangs the tests in some environments** — use the mock, never import it directly in tests. The `terminal.test.js` failure is pre-existing; don't chase it as a regression.
- **Background tests die** with session compaction. Always foreground.
- **New shared components that make API calls on mount break existing test mocks.** `vi.mock` partial objects don't inherit real implementations — every API method the component calls on mount must be present in every parent's mock object. Missing entries cause runtime failures, not type errors. After adding any mount-time API call to a shared component, grep for `vi.mock` across tests that render that component and add the new method (`vi.fn().mockResolvedValue(...)`) to each mock.
- **jsdom filters characters from `type="url"` inputs when using `userEvent.type`.** Fix: use `fireEvent.change(input, { target: { value: 'https://...' } })` for any `type="url"` input.
- **`PIPELINE_POLL_INTERVAL_MS` defaults to 2000 ms** — multi-stage integration tests must override it (e.g. `PIPELINE_POLL_INTERVAL_MS=50`) or use much longer waits.
- **`model` is absent from `stageStatuses[i]` in test mode (PIPELINE_NO_SPAWN).** Fields `cliTool`, `provider`, `resolvedFrom` are written early but `model` is not. Tests asserting `model` in `meta.json` must use the real-spawn path or accept these fields as absent.

## Server / build
- **A stale `dist/`** is the #1 cause of "my frontend change isn't showing up" — run `npm run build` after touching the frontend.
- **New routes** in `routes/index.js` don't exist until the server is restarted.
- **Don't restart the server with agents running** (they lose MCP).
- **`PUT /tasks/:id` does NOT handle attachments.** Use `PATCH /tasks/:id/attachments` (merge) and `DELETE /tasks/:id/attachments/:encodedName`.

## Data
- JSON columns (e.g. `spaces.working_directory`, `pipeline`) are stored JSON-encoded. Writing a raw value via direct SQL breaks `listSpaces` at startup.
- **`UPDATABLE_FIELDS` guard in `handleUpdateTask`** fires before any field-specific processing. Any new task field added to `PUT /tasks/:id` MUST be added to `UPDATABLE_FIELDS` or requests get a silent 400.
- **`sendError()` wraps errors as `{ error: { code, message } }`** — not flat. Tests must use `res.body.error.code`.

## Store API (for test authors)
- **Insert method is `store.insertTask(task, spaceId, column)`** — not `createTask`. The task object does NOT carry `space_id`.
- **POST /tasks returns the task object directly** — not wrapped in `{ task: {...} }`.
- **Use a monotonic counter, not `Date.now()`, for unique test space names** — `Date.now()` risks collisions in fast suites.

## Pipeline
- Some runs create their own branch `feature/<feature>-<task>` and commit there. After a run, check `git reflog`/`git branch` and `git merge --ff-only <branch>`.
- Parallel runs provision worktrees (`.worktrees/`, gitignored).
- **Missing/stale worktree:** (1) dir pre-exists empty (aborted run) and `git worktree add` silently fails; (2) branch created but worktree never added. Always run `git worktree list` first. Fix: `rm -rf .worktrees/run-<id> && git worktree prune && git worktree add .worktrees/run-<id> <branch>`.
- Folio write-back runs as an **epilogue after the run completes** (not a stage). Kill switch: `PRISM_FOLIO_WRITEBACK=off`.

## Stitch MCP (ux-api-designer)
- **Stitch MCP fails silently or with auth errors (401) in some pipeline contexts** — observed as timeout (May 2026, Jun 2026) and 401 OAuth error. Root cause: OAuth credentials not always available in subagent pipeline contexts.
- **Stitch download URLs (`contribution.usercontent.google.com`) return processed text via WebFetch, not raw HTML.** Root cause: Google CDN URLs require browser session cookies — WebFetch has none. Fix: save the `downloadUrl` verbatim in `wireframes-stitch.md`; write a stub HTML in `stitch-screens/` that links to the live URL so developer-agent can open it in a browser. Never retry these URLs with WebFetch.
- **Fallback:** produce detailed ASCII wireframes with explicit Tailwind class specs. Document the failure in `wireframes-stitch.md`. **Do not block the pipeline on Stitch.**

## Playwright (code-reviewer / qa-engineer)
- **Port 5173 may be owned by a different Vite instance.** Run `lsof -i :5173` before opening Playwright.
- **Playwright MCP browser lock between pipeline stages.** When the reviewer leaves the browser open, the QA agent's `browser_navigate` fails with "Browser is already in use". Prevention: every reviewer/QA agent must call `browser_close` as its final action.

## File backend (Folio)
- **folioId must be stable across hydrations** — derived deterministically from `.folio/` root path, persisted in `folio.json`. Never reintroduce a random id in `hydrateFromMarkdown`.
- **`folio_create` on the file backend is idempotent/single-folio** — it renames the directory's one folio rather than inserting a second. Bulk authoring by writing `.md` files directly into `.folio/` is valid and preferred over N `create_page` calls.