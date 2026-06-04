---
title: Reference Syntax
author: user
pinned: false
created: 2026-05-31
updated: 2026-06-02T10:28:01.039Z
---

## Chosen syntax: [[ ]]

The de facto standard in wikis and knowledge bases (Obsidian, Roam, Notion). Users recognize it instinctively and it doesn't collide with other uses.

Alternatives ruled out:
- `@slug` — future conflict with user mentions.
- `#slug` — evokes tags/categories, not content references.
- `/slug` — gets confused with file paths.
- `folio:slug` — unambiguous but verbose.

## Two levels of granularity

- `[[chapter/page]]` — the full page.
- `[[chapter/page#section]]` — only the indicated H2 block (lighter, more precise). Anchored by the H2 title, as in Markdown/GitHub.

Reference by line number is NOT supported (fragile, changes on edit).

## Resolution

In task prompts, Prism resolves the references BEFORE sending to the agent: it replaces `[[...]]` with the content. The agent receives plain text and has no idea there were references. References are **stable**: if the page is updated, the next run receives the new version.

## UI: clickable references

Wherever a complete `[[chapter/page]]` is rendered through `MarkdownViewer` (folio page content, previews, any markdown surface), it renders as a link that opens the Folio panel and navigates to that page — `openFolio()` + `useFolioStore.openPage(chapter, page)`. Section anchors (`#section`) open the page.

Implementation note (non-obvious): the linkification rewrites the **source string** before parsing, not the mdast — CommonMark parses `[[…]]` as bracketed link-reference syntax, so the full token never survives as a single text node a tree visitor could catch. Code spans (fenced + inline) are left verbatim, so a `[[ref]]` inside backticks stays literal. The `folio:` URL scheme is preserved via a custom `urlTransform` (react-markdown strips unknown schemes by default).

Scope: **rendered markdown only.** The editable description `<textarea>` (ReferenceAutocomplete) is not clickable — its highlight overlay is `pointer-events:none`; making it navigable would require a contenteditable editor or a read-mode toggle (deferred).

## Repo files vs attachments

- **Repo files**: only mentioned as text in the markdown. Folio does NOT copy them. The repo is the single source of truth for code.
- **Attachments**: blobs in Folio only for files that do NOT live in the repo (diagrams, PDFs, external notes).
