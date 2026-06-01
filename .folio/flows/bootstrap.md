---
title: Bootstrap from the Repo
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [bootstrap, repo, cold-start]
---

## Initial fill-in when there is a repo

Triggered by the **presence of a repo** (inferred from the space's working dir), NOT by an intent picker. No repo (ops, writing, research) → no bootstrap, and the folio accretes through use.

## Separate structure from content

- **Structure** (which chapters): emerges from use. The first slug creates its chapter. No templates.
- **Content** (the pages): only auto-fills if there is a source to read. The repo is that source for dev spaces.

## The bootstrap is conservative

An agent reads the repo and writes ONLY high-confidence, hard-to-re-discover knowledge:
- Stack (runtime, key deps, the test command).
- Folder structure / entry points.
- Basic architecture (how a request flows).

It does NOT invent decisions or lessons — those accrete from real work via [[flows/write-back]].

## Why conservative

An agent that reads an entire repo and writes a fat folio hallucinates and over-documents → low-signal pages that poison injection. Better a few correct pages. Everything the bootstrap writes is left with `author='agent'`.
