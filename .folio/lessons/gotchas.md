---
title: Gotchas and Known Traps
author: agent
pinned: true
created: 2026-06-01
updated: 2026-06-23T10:58:33.184Z
---

---
title: Gotchas and Known Traps
author: agent
pinned: true
created: 2026-06-01
updated: 2026-06-23
---

Knowledge that's hard to re-discover by reading the code. Avoids repeating mistakes already paid for.

## Tests
- **`node-pty` hangs the tests in some environments** — use the mock, never import it directly in tests. The `terminal.test.js` failure (PTY exit/respawn) is **pre-existing and unrelated** to nearly any change; don't chase it as a regression.
- **Background tests die** with session compaction. Always foreground.
- **New shared components that make API calls on mount break existing test mocks.** `vi.mock` partial objects don't inherit real implementations — every API method the component actually calls on mount must be present in every parent component's mock object. Missing entries cause runtime failures, not type errors (76 tests failed when `ArcAutocomplete` called `api.getArcs()` on mount but mocks for `CreateTaskModal` and `TaskDetailPanel` didn't include it). Pattern: after adding any mount-time API call to a shared component, grep for `vi.mock` across tests that render that component and add the new method (`vi.fn().mockResolvedValue(...)`) to each mock object.
- **jsdom filters characters from `type="url"` inputs when using `userEvent.type`.** jsdom validates and strips characters keystroke-by-keystroke; combined with `requestAnimationFrame`-based auto-focus stealing intermediate events, URLs come out truncated or empty. **Fix:** use `fireEvent.change(input, { target: { value: 'https://...' } })` for any `type="url"` input in Vitest/jsdom tests.

## Server / build
- **A stale `dist/`** is the #1 cause of "my frontend change isn't showing up" — the server serves `dist/`, so you have to `npm run build` after touching the frontend.
- **New routes** in `routes/index.js` don't exist until the server is restarted.
- **Don't restart the server with agents running** (they lose MCP).
- **`PUT /tasks/:id` does NOT handle attachments.** Attachments live on their own sub-route: `PATCH /tasks/:id/attachments` (merge) and `DELETE /tasks/:id/attachments/:encodedName`. The spec wording "PUT task already accepts attachments" refers to the MCP tool's behaviour, which internally calls those sub-routes. Don't add attachment logic to the task PUT handler.

## Data
- The schema's JSON columns (e.g. `spaces.working_directory`, `pipeline`) are stored **JSON-encoded**. Writing a raw value via direct SQL breaks `listSpaces` at startup (`JSON.parse` blows up).
- **`UPDATABLE_FIELDS` guard in `handleUpdateTask`** fires before any field-specific processing and returns 400 if none of its listed fields are present. Current list: `['title', 'type', 'description', 'assigned', 'pipeline', 'arc']`. **Any new task field added to PUT /tasks/:id MUST be added to `UPDATABLE_FIELDS`**, or requests that only contain the new field get a silent 400. (BUG-001 in MODEL-1: `stageModels` was processed after the guard but not in the list — TaskDetailPanel Save was broken.)
- **`sendError()` wraps errors as `{ error: { code, message } }`**, not a flat `{ code, message }`. Integration tests checking error codes must use `res.body.error.code`, not `res.body.code`. Not visible at call sites — `sendError(res, 400, 'CODE', 'msg')` hides the nesting.

## Store API (for test authors)
- **Insert method is `store.insertTask(task, spaceId, column)`** — not `createTask` (does not exist). The task object does NOT carry a `space_id` field; space is a separate parameter.
- **POST /tasks returns the task object directly** — not wrapped in `{ task: {...} }`. Do not unwrap in test assertions.
- **Use a monotonic counter, not `Date.now()`, for unique test space names.** `Date.now()` risks collisions in fast-running test suites; an incrementing module-level counter is safe.

## Pipeline
- Some pipeline runs create their **own branch** `feature/<feature>-<task>` and commit there (not on the base branch). After a run, check with `git reflog`/`git branch` and run `git merge --ff-only <branch>` to bring the commits in.
- Parallel runs over the same working dir provision **worktrees** (`.worktrees/`, gitignored).
- **Missing or stale worktree directory** — two failure modes: (1) the directory pre-exists as empty (aborted prior run) and `git worktree add` silently fails; (2) the pipeline branch was created but `git worktree add` was never run. In both cases every file read returns "no such file". **Always run `git worktree list` before reading artifacts** — if the run's entry is absent: `rm -rf .worktrees/run-<id> && git worktree prune && git worktree add .worktrees/run-<id> <branch>`.
- Folio write-back runs as an **epilogue after the run completes** (it is not a stage). Kill switch: `PRISM_FOLIO_WRITEBACK=off`.

## Stitch MCP (ux-api-designer)
- **Stitch MCP fails silently or with auth errors (401) in some pipeline contexts** — observed as timeout (May 2026, Jun 2026) and 401 OAuth error (Jun 2026). Root cause: OAuth credentials not always available in subagent pipeline contexts.
- **Fallback:** produce detailed ASCII wireframes with explicit Tailwind class specs. The design system tokens are well-defined enough that developer-agent can implement pixel-accurate UI without Stitch screens. Document the failure in `wireframes-stitch.md` with a retry prompt for humans.
- **Do not block the pipeline on Stitch** — ASCII wireframes + Tailwind tokens are sufficient.

## Playwright (code-reviewer / qa-engineer)
- **Port 5173 may be owned by a different Vite instance.** If another Vite dev server is already running (e.g. from a main worktree), the current worktree's Vite silently picks port 5174. Navigating Playwright to port 5173 shows OLD code. **Always run `lsof -i :5173` before opening Playwright** to confirm which process owns the port.
- **Playwright MCP browser lock between pipeline stages.** When the code-reviewer leaves the Playwright browser open, the qa-engineer's `browser_navigate` fails with "Browser is already in use". **Workaround:** fall back to API-level tests via `startTestServer()`. **Prevention:** every reviewer/QA agent must call `browser_close` as its final action.

## File backend (Folio)
- **folioId must be stable across hydrations** — derived deterministically from `.folio/` root path, persisted in `folio.json`. Never reintroduce a random id in `hydrateFromMarkdown`. See [[architecture/storage-backend]].
- **`folio_create` on the file backend is idempotent/single-folio** — it renames the directory's one folio rather than inserting a second. Bulk authoring by writing `.md` files directly into `.folio/` is valid and preferred over N `create_page` calls.
