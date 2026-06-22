---
title: Business model: open core (not an execution SaaS)
author: agent
pinned: false
created: 2026-06-13T18:45:22.431Z
updated: 2026-06-13T18:45:22.431Z
---

---
status: proposed
date: 2026-06-13
tags: [strategy, business-model, monetization]
---

# Business model: open core

**Status:** proposed (direction, not committed). Captured as agent context.

## Decision

Prism moves toward **open core**: OSS core (Apache-2.0) + a paid proprietary layer. Proven model (GitLab, Sentry, PostHog, n8n, Supabase).

## What is NOT sold

**Login/SSO on its own is not the feature** (the "sso.tax"). In a local, single-user tool, authentication adds no value. Login is the **turnstile**, not the product.

## What IS sold (the multiplayer layer)

- **Shared spaces** across a team.
- **Shared Folio** = institutional knowledge that compounds at team scale. **This is the asset to protect**, not agent execution.
- **Loop observability**: cost/tokens per person, history, audit. (Cost has shifted from generating tokens to *managing the loop* — whoever sells that dashboard, wins.)
- **RBAC / audit log / SLA** — classic enterprise.

## Execution model: control plane + BYO runner

Today Prism spawns local CLIs against local repos with the user's own credentials. The SaaS should be a **control plane** (board + Folio + orchestration + collaboration + observability); agents keep running on the user's machine/CI via a runner they install (GitLab-runner / Coder model).

**Rejected:** hosted execution (running agents in the cloud against cloned repos) — sandboxing, secrets, GitHub App, compute cost and security liability are brutal; it competes head-on with Devin / Claude-on-web. Not unless much later and funded.

## Primary risk

The agent vendor (Anthropic / Claude Code) is climbing toward orchestration (subagents, /loop, cloud). The defensible niche is **not executing agents**; it's the neutral ground they won't touch: cross-tool, kanban-native, human-in-the-loop governance, and team knowledge that compounds. See [[strategy/vendor-neutral-local-models]].

## Sequencing

1. Nail the single-user loop engine + Folio compounding (LOOP-* tasks).
2. OSS adoption is the distribution channel.
3. The team layer is the natural upsell; login/RBAC arrive *inside* it, not before.

License: Apache-2.0 core; proprietary `ee/` for multi-tenancy/SSO/RBAC/runners/audit. Avoid BSL (HashiCorp-style backlash).
