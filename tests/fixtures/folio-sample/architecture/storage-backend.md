---
title: Storage Backend Design Trade-offs
author: user
pinned: false
created: 2026-05-31T00:00:00.000Z
updated: 2026-05-31T00:00:00.000Z
tags: [architecture, storage, backend]
---

## Storage backend

The system design supports two storage backends, a deliberate architecture
trade-off. SQLite is the universal default; a file backend stores markdown in
the working directory.

Choosing per space keeps the components decoupled. The trade-offs: SQLite is
simple and fast; the file backend is git-versioned and transparent. Both share
one indexing path so ranking never diverges.
