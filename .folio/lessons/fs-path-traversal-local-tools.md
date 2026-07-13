---
title: Path Traversal in Filesystem Browse Endpoints (Local Dev Tools)
author: agent
pinned: false
created: 2026-06-08T14:55:07.090Z
updated: 2026-06-08T14:55:07.090Z
---

## What happened

The `/api/v1/fs/browse` endpoint accepted `~/../../etc` and resolved it to `/etc`, returning a 200 with the system directory listing. It also returned 500 (instead of 400) for paths with embedded null bytes or names exceeding the OS path-length limit.

## Root cause

The handler tilde-expanded the input path with `os.homedir()` substitution but did **not**:
1. Normalize the path before use (`path.normalize` collapses `../` sequences).
2. Verify the resolved path starts with the user's home directory.
3. Map `ENAMETOOLONG` / `ERR_INVALID_ARG_VALUE` to a 400 client error.

## Fix

```js
// In handleBrowse / handleValidate:
const home = os.homedir();
const resolved = path.normalize(rawPath.replace(/^~/, home));
if (!resolved.startsWith(home + path.sep) && resolved !== home) {
  return res.status(403).json({ error: 'ACCESS_DENIED' });
}
```

For the error-code mapping, add `ENAMETOOLONG` and `ERR_INVALID_ARG_VALUE` to the existing `catch` block's 400-response list alongside `ENOENT` and `ENOTDIR`.

## Severity

Low for a local dev tool (the attacker already has shell access). Still worth patching: the principle of least privilege applies even locally, and the 500 → 400 fix improves the frontend error path.

## Lesson

Any filesystem endpoint that accepts a user-supplied path must: (1) normalize before use, (2) enforce a root boundary, and (3) map all expected OS error codes to appropriate HTTP statuses. Do not rely on OS access control alone as the only gate.
