---
title: Bootstrap from the Repo
author: user
pinned: false
created: 2026-05-31
updated: 2026-06-01
tags: [bootstrap, repo, cold-start]
---

## Initial fill-in when there is a repo

Triggered by the **presence of a repo** (inferred from the space's working dir), NOT by an intent picker. No repo (ops, writing, research) → no bootstrap, and the folio accretes through use.

**When it fires:** at **stage 0 of the first pipeline run** in the space, before the stage-0 prompt is built (so that same run already sees the bootstrapped pages). It is **one-shot per space** — idempotent via the `folio_bootstrap` table, so deleting the folio afterwards does NOT re-trigger it — and it writes with `createIfMissing:true`. That makes bootstrap the one pipeline path that **auto-activates** the folio with no user gesture, relaxing the strict opt-in described in [[data-model/activation]] for repo-backed spaces. Opt out globally with `PRISM_FOLIO_BOOTSTRAP=off`. Guard order: kill-switch → already-bootstrapped → folio-already-exists (respect user curation) → no-repo.

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
