---
title: What Folio Is
author: user
pinned: true
created: 2026-05-31
updated: 2026-05-31
tags: [vision, producto]
---

## What it is

Folio is a **navigable, augmentable knowledge base** shared between a user and their agents. It solves the problem that, on every new task, agents start from zero: they re-discover the stack, re-read the same files, and ignore past decisions.

The three terms in the name each do real work:
- **Knowledge base** — it persists and accumulates; it is not ephemeral session memory.
- **Navigable** — the user explores, edits, and understands what their agent knows.
- **Augmentable** — it grows with use; both the user and the agent add to it.

## Core thesis

The value is **asymmetric over time**. On the first task, the agent knows nothing. By the tenth, it already has patterns. By the hundredth, it beats any static doc. The more the space is used, the smarter the agent becomes. That gives natural retention.

## Use cases (the design compass)

It is not just for code. The model is the same; the content changes:
- **Dev** — stack, architecture, conventions, decisions, lessons, state.
- **Oncall** — runbooks, incidents, fragile services, contacts. The `oncall-helper` agent looks up past incidents and proposes the steps that worked.
- **Writing** — characters, world rules, chapters.
- **Research** — sources, findings, open questions.

The user who installs v1 is a developer, but the data model does NOT assume code. Neutral vocabulary. See [[concept/vocabulary]].
