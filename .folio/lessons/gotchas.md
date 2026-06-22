---
title: Gotchas and Known Traps
author: agent
pinned: true
created: 2026-06-01
updated: 2026-06-15T08:18:30.560Z
---

---
title: Gotchas and Known Traps
author: agent
pinned: true
created: 2026-06-01
updated: 2026-06-15
tags: [lecciones, gotchas, ci]
---

Knowledge that's hard to re-discover by reading the code. Avoids repeating mistakes already paid for.

## Tests
- **`node-pty` hangs the tests in some environments** — use the mock, never import it directly in tests. The `terminal.test.js` failure (PTY exit/respawn) is **pre-existing and unrelated** to nearly any change; don't chase it as a regression.
- **Background tests die** with session compaction. Always foreground.
- **New shared components that make API calls on mount break existing test mocks.** `vi.mock` partial objects don't inherit real implementations — every API method the component actually calls on mount must be present in every parent component's mock object. Missing entries cause runtime failures, not type errors (76 tests failed when `ArcAutocomplete` called `api.getArcs()` on mount but mocks for `CreateTaskModal` and `TaskDetailPanel` didn't include it). Pattern: after adding any mount-time API call to a shared component, grep for `vi.mock` across tests that render that component and add the new method (`fn: vi.fn().mockResolvedValue(...)`) to each mock object.
- **jsdom filters characters from `type="url"` inputs when using `userEvent.type`.** jsdom validates and strips characters keystroke-by-keystroke; combined with `requestAnimationFrame`-based auto-focus stealing intermediate events, URLs come out truncated or empty. **Fix:** use `fireEvent.change(input, { target: { value: 'https://...' } })` for any `type="url"` input in Vitest/jsdom tests.

## Server / build
- **A stale `dist/`** is the #1 cause of "my frontend change isn't showing up" — the server serves `dist/`, so you have to `npm run build` after touching the frontend.
- **New routes** in `routes/index.js` don't exist until the server is restarted.
- **Don't restart the server with agents running** (they lose MCP).
- **`PUT /tasks/:id` does NOT handle attachments.** Attachments live on their own sub-route: `PATCH /tasks/:id/attachments` (merge) and `DELETE /tasks/:id/attachments/:encodedName`. The spec wording "PUT task already accepts attachments" refers to the MCP tool's behaviour, which internally calls those sub-routes. Don't add attachment logic to the task PUT handler.

## Data
- The schema's JSON columns (e.g. `spaces.working_directory`, `pipeline`) are stored **JSON-encoded**. Writing a raw value via direct SQL breaks `listSpaces` at startup (`JSON.parse` blows up).
- There was a bug in `PUT /api/v1/spaces/:id` that **deleted all of the space's tasks** on rename — verify that any change to `spaceManager.renameSpace` preserves the tasks.

## Store API (for test authors)
- **Insert method is `store.insertTask(task, spaceId, column)`** — not `createTask` (does not exist). The task object does NOT carry a `space_id` field; space is a separate parameter.
- **POST /tasks returns the task object directly** — not wrapped in `{ task: {...} }`. Do not unwrap in test assertions.
- **Use a monotonic counter, not `Date.now()`, for unique test space names.** `Date.now()` risks collisions in fast-running test suites; an incrementing module-level counter is safe.

## Pipeline
- Some pipeline runs create their **own branch** `feature/<feature>-<task>` and commit there (not on the base branch). After a run, check with `git reflog`/`git branch` and run `git merge --ff-only <branch>` to bring the commits in.
- Parallel runs over the same working dir provision **worktrees** (`.worktrees/`, gitignored).
- **Missing or stale worktree directory** — two failure modes: (1) the directory pre-exists as empty (aborted prior run) and `git worktree add` silently fails; (2) the pipeline branch was created but `git worktree add` was never run, so the directory simply doesn't exist. In both cases every file read returns "no such file". **Always run `git worktree list` before reading any artifacts** — if the run's entry is absent, create it: `rm -rf .worktrees/run-<id> && git worktree prune && git worktree add .worktrees/run-<id> <branch>`.
- Folio write-back runs as an **epilogue after the run completes** (it is not a stage). Kill switch: `PRISM_FOLIO_WRITEBACK=off`.

## Stitch MCP (ux-api-designer)
- **Stitch MCP fails silently or with auth errors (401) in some pipeline contexts** — observed as timeout (May 2026, Jun 2026) and 401 OAuth error (Jun 2026). Root cause: OAuth credentials not always available in subagent pipeline contexts.
- **Fallback:** produce detailed ASCII wireframes with explicit Tailwind class specs instead. The design system tokens (`bg-surface`, `text-text-primary`, etc.) are well-defined enough that developer-agent can implement pixel-accurate UI without Stitch screens. Document the failure in `wireframes-stitch.md` with a retry prompt for humans.
- **Do not block the pipeline on Stitch** — ASCII wireframes + Tailwind tokens are sufficient.

## Playwright (code-reviewer / qa-engineer)
- **Port 5173 may be owned by a different Vite instance.** If another Vite dev server for the same project is already running (e.g. from a main worktree), the current worktree's Vite silently picks port 5174. Navigating Playwright to port 5173 shows the OLD code — causing false change-detection results. **Always run `lsof -i :5173` before opening Playwright** to confirm which process owns the port, then verify the target server serves the new code (e.g. fetch a known-new string from a source file) before drawing conclusions from screenshots.
- **Playwright MCP browser lock between pipeline stages.** When the code-reviewer leaves the Playwright browser open, the qa-engineer's `browser_navigate` fails with "Browser is already in use". `browser_close` also fails in this state. **Workaround:** fall back to API-level tests via `startTestServer()`. **Prevention:** every reviewer/QA agent must call `browser_close` as its final action before finishing its stage.

## File backend identity
- **The file-backend folioId MUST be stable across hydrations.** `openFileBackend` rebuilds the in-memory index from markdown on every open, and the standalone MCP resolver re-hydrates whenever a `.md` mtime advances — which every `create_page` does. If hydration minted a fresh `crypto.randomUUID()` each time (the original bug), the folioId returned to a client went stale on the very next call → `folio_create_page`'s `getFolio()` guard failed with **"Folio not active"**, and `folio_list` churned a new id every call. The id is now derived deterministically from the `.folio/` root path (`folioIdForRoot`), with a persisted `folio.json` `id` taking precedence. **Don't reintroduce a random id in `hydrateFromMarkdown`.** See decision 18 and [[architecture/storage-backend]].
- **`folio_create` on the file backend writes `folio.json`** (id + chosen name) and is idempotent/single-folio — it renames the directory's one folio rather than inserting a second. An empty `.folio/` still hydrates exactly one folio (named after the dir) before any create. Bulk authoring by writing `.md` files directly into `.folio/` is still valid and preferred over N `create_page` calls.
