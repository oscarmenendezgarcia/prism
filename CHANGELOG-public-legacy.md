# Changelog: T-08 — Resolver public/ legacy

## Summary

The `public/` directory contained the original pre-React frontend (app.js, spaces.js, style.css).
After the migration to React+Vite, the backend serves all static assets from `dist/` (Vite build
output). The `public/` directory was already absent from the working tree and from git history on
this branch.

## Investigation findings

- `public/` does **not exist** on disk — already cleaned up prior to this task.
- `src/handlers/static.js` already correctly:
  - Sets `PUBLIC_DIR` to `dist/` (Vite output), not `public/`.
  - Contains an explicit inline comment: "The legacy public/ directory was removed after the
    React migration."
- `server.js` has no reference to `public/` at all — it delegates static serving entirely to
  `src/handlers/static.js`.
- No other `.js` file in the project references `public/`.

## Changes

### docs/github-readiness.md

- Updated section 9 from a pending action item to a resolved note, documenting that `public/`
  was removed during the React migration and that `static.js` already documents this.
- Updated T-08 status from `⏳ Pendiente` to `✅ Hecho` in the task table.

## Files changed

- `docs/github-readiness.md` — stale pending item updated to reflect completed state

## No code changes required

`server.js` and `src/handlers/static.js` were already correct. This task is purely a
documentation cleanup confirming the state that already existed.
