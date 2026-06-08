# Bug Report: Space Settings — File Browser

## BUG-001: FS endpoints return HTML from running server (deployment gap)

- **Severity**: Medium
- **Type**: Operational / Deployment
- **Component**: `src/routes/index.js` (FS route block, lines 810–829) — live server on port 3000
- **Reproduction Steps**:
  1. Start `node server.js` (before this commit is applied)
  2. Apply the `feat(space-settings): inline file tree` commit
  3. `curl http://localhost:3000/api/v1/fs/home`
  4. Observe HTML response instead of `{"homePath":"/..."}`
- **Expected Behavior**: `{"homePath": "/Users/..."}` with `Content-Type: application/json`
- **Actual Behavior**: `<!DOCTYPE html>...` — the static SPA fallback is served because the server process was loaded before the FS routes were registered
- **Root Cause Analysis**: Node.js servers load all route handlers at startup. When new route handlers are committed while the server is running, the process keeps using the original in-memory `createRouter` closure. The FS routes (lines 816–829 in routes/index.js) are correctly registered in source, but the running process never executes them because it was started before this commit landed.
- **Proposed Fix**: Restart `node server.js` after merging/deploying this feature. Document the restart requirement in CHANGELOG and in the deployment README. Long term: consider a `nodemon`-like watch mechanism for development, or a `/health` endpoint that reports the loaded route set so operators can verify readiness.
- **Test Verification**: `curl -I http://localhost:3000/api/v1/fs/home` currently returns `404 application/json` (HEAD falls through to 404 handler) instead of `200 application/json`. After server restart, it returns `200 {"homePath":"..."}`.
- **OWASP Reference**: N/A

---

## BUG-002: Unhandled OS errors return 500 instead of 400 for invalid path inputs

- **Severity**: Low
- **Type**: Functional / Error Handling
- **Component**: `src/handlers/fs.js` — `handleBrowse` and `handleValidate`
- **Reproduction Steps**:
  1. Start a test server: `node tests/fs.test.js` (or spin up fresh server)
  2. `POST /api/v1/fs/browse` with body `{"path": "/tmp/` + `x`.repeat(4096) + `"}`
  3. Observe 500 with `ENAMETOOLONG` OS error message in response
- **Expected Behavior**: `400 INVALID_PATH` — path exceeds OS limits and is clearly invalid input
- **Actual Behavior**: `500 {"error":{"code":"INTERNAL_ERROR","message":"Failed to stat path: ENAMETOOLONG: name too long, stat '/tmp/xxx..."}}`
- **Root Cause Analysis**: `fs.statSync` in `handleBrowse` and `handleValidate` catches `ENOENT` and `EACCES` specifically, but no catch arm handles `ENAMETOOLONG`. The catch-all falls through to `sendError(res, 500, 'INTERNAL_ERROR', ...)`. Similarly, null bytes in paths (`/tmp\0/etc`) cause Node.js to throw `ERR_INVALID_ARG_VALUE` before the OS is even consulted — also unhandled.
- **Proposed Fix**: In the `catch (err)` blocks in both `handleBrowse` and `handleValidate`, add cases for `ENAMETOOLONG` and `ERR_INVALID_ARG_VALUE`:
  ```
  if (err.code === 'ENAMETOOLONG' || err.code === 'ERR_INVALID_ARG_VALUE') {
    return sendError(res, 400, 'INVALID_PATH', 'Path contains invalid characters or exceeds length limits');
  }
  ```
  Alternatively, add an upfront guard: reject paths longer than 1024 chars and paths containing null bytes before any `fs` call.
- **OWASP Reference**: A03:2021 — Injection (null byte injection causes 500 information disclosure)

---

## BUG-003: Path traversal via tilde expansion allows browsing outside home directory

- **Severity**: Low
- **Type**: Security (Advisory — local dev tool)
- **Component**: `src/handlers/fs.js` — `expandHome()` function
- **Reproduction Steps**:
  1. `POST /api/v1/fs/browse` with body `{"path": "~/../../etc"}`
  2. Observe 200 response listing `/etc` contents (same as `POST` with `{"path": "/etc"}`)
- **Expected Behavior**: `400 INVALID_PATH` — path navigates above home directory
- **Actual Behavior**: `200` — `expandHome("~/../../etc")` returns `/Users/me/../../etc`, which passes `path.isAbsolute()`, and the OS resolves `..` segments during `fs.statSync`, so `/etc` is browsed.
- **Root Cause Analysis**: `expandHome` simply concatenates `HOME_DIR` with the rest of the raw input. It does not normalize or validate that the resulting path stays within `HOME_DIR`. The `path.isAbsolute()` check only verifies the path starts with `/`, not that it is canonical.
- **Proposed Fix**: After `expandHome`, normalize the path and optionally restrict to a safe root:
  ```js
  const dirPath = path.normalize(expandHome(rawPath));
  // Optional: reject paths that escape home
  if (!dirPath.startsWith(HOME_DIR + path.sep) && dirPath !== HOME_DIR) {
    // Allow /absolute/path input — only restrict ~ expansion
    if (rawPath.startsWith('~')) {
      return sendError(res, 400, 'INVALID_PATH', '~ path must not navigate above home directory');
    }
  }
  ```
  Note: for a purely local dev tool, restricting to home only affects `~`-prefixed inputs. Absolute paths to `/etc` are already allowed and represent the user's own OS access. If scoping to home is desired, apply the restriction to all paths.
- **OWASP Reference**: A01:2021 — Broken Access Control (path traversal)

---

## Summary

| Bug | Severity | Blocks Release | Fix Difficulty |
|-----|----------|----------------|----------------|
| BUG-001: Server restart required | Medium | No (operational step) | Trivial — restart |
| BUG-002: ENAMETOOLONG/null byte → 500 | Low | No | Small — add err.code cases |
| BUG-003: Tilde path traversal | Low | No | Small — normalize + optional guard |

**No Critical or High code defects found.** All 23 backend integration tests and 1,809 frontend tests pass. The feature is functionally correct; BUG-001 will auto-resolve on server restart.
