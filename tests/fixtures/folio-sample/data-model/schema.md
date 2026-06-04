---
title: Data Model Schema
author: user
pinned: false
created: 2026-05-31T00:00:00.000Z
updated: 2026-05-31T00:00:00.000Z
tags: [data-model, schema]
---

## Schema

The data model: folios, chapters, and pages. A page belongs to a chapter; a
chapter belongs to a folio. The schema keys every row on the folio id.

Pages carry title, content, author, and a pinned flag. Chapters emerge from
page slugs — there is no explicit chapter table write path.
