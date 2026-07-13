# ADR-1: Config Panel redesign → Proposal D (agent-centric Routing + Skills)

## Status
Accepted

## Context
The Config Panel today is a slide-over with a narrow ~140px file sidebar (Global /
Agents / Project) + a CodeMirror editor, plus a separate **Model Routing** virtual
screen (`ModelRoutingSettings.tsx`) that renders one fieldset per pipeline stage with
preset chips and a custom-model input.

Two problems motivate this redesign:

1. **Routing lives apart from the thing it routes.** The model for an agent and the
   agent's own definition (skills, effort, system prompt) are edited in two unrelated
   places. Yet routing is already keyed by `agentId` — the data is agent-centric, the
   UI is not.
2. **The narrow sidebar does not scale** and the routing screen is a flat list with no
   sense of inheritance source (global vs space vs task override).

The visual spec is **`agent-docs/model-routing/config-redesign.html`**, sections
*"Propuesta D"* and *"Agent detail"* — authoritative for layout and hierarchy.

Proposal D reframes the panel: **one card per agent**. Collapsed shows model + skill
count; expanded shows the model selector (with inheritance badge), effort and skills.
"Routing" stops being a separate screen — it becomes the *model column* of each agent.

This ADR covers **Phase 1: frontend only, no backend, no new endpoints.** It reuses the
MODEL-1 (#153) routing data (`stageModels` at global/space/task) and the #154 space/task
override save paths. Skills and effort are **read-only** in Phase 1 (rendered from the
agent's existing `.md` frontmatter); their editing — plus a skills catalog endpoint — is
explicitly deferred to a Phase 2 (the mockup's "Agent detail · Requiere backend").

### Constraints
- **No backend changes, no new endpoints.** Reuse `GET /agents`, `GET /agents/:id`,
  `saveSettings`, `renameSpace` (carries `stageModels`).
- **Design system only:** Tailwind tokens, shared components (`Button`, `Tooltip`),
  dark theme. Scope of change is `frontend/src/components/config/*`.
- Pipeline stage set is small (4–5 agents) — N is tiny, so per-agent metadata may be
  fetched eagerly without a list endpoint.

### Two design questions the brief asked to resolve
1. **Scope selector (global / space / task).**
2. **Where the non-agent config files (CLAUDE.md, settings.json, project files) go.**

Both are decided below (see Decision §2 and §3).

## Decision
Replace the Config Panel's primary surface with an **agent-centric "Agents & Routing"
view** (Proposal D): a searchable list of expandable per-agent cards where the model
selector with an inheritance-source badge *is* the routing control; skills and effort
are shown read-only from the agent frontmatter. Non-agent config files move behind a
second **"Files"** tab that reuses the existing sidebar + CodeMirror editor. The scope
of the model override being edited is chosen by a header **scope segmented control with
two editable scopes — Global and Space** — while `task` remains a read-only inheritance
indicator (task overrides continue to be edited in `TaskDetailPanel`, already shipped in
#154).

### §1 — View structure
The panel header gains a two-option segmented control:

```
┌ Configuration ───────────────────────────────────── × ┐
│  [ Agents & Routing ]   [ Files ]                      │
```

- **Agents & Routing** (new default view) — Proposal D. Replaces the old "Model
  Routing" virtual item *and* the "Agents" file group.
- **Files** — the existing `ConfigFileSidebar` + `ConfigEditor`, but showing only the
  **Global** and **Project** file groups (the per-agent `.md` files are now represented
  as cards in the Agents & Routing view; editing an agent's raw system prompt is reached
  from the card's "Edit system prompt" advanced row, which opens that file in the
  existing editor — wired in Phase 2).

### §2 — Scope selector (resolved design)
A header-level segmented control inside the Agents & Routing view:

```
Scope:  [ Global ]  [ Space · Prism ]
```

- **Global** edits `agentSettings.pipeline.stageModels` (via `saveSettings`).
- **Space** edits the **active space's** `stageModels` (via the existing `renameSpace`
  path that already carries `stageModels`). The chip shows the active space name.
- **Task is intentionally NOT an editable scope here.** The Config Panel has no task in
  context; task overrides are edited where a task *is* in context — `TaskDetailPanel`
  (#154). `task` is kept in the inheritance-badge enum only, as a read indicator, so the
  badge component is reusable across both surfaces.

Each card's **model pill carries an inheritance badge** showing the *source of the
effective value at the selected scope*, following the resolution chain
`frontmatter(default) → global → space`:

| Selected scope | Override present | Badge        |
|----------------|------------------|--------------|
| Global         | global set       | `global`     |
| Global         | none             | `default`    |
| Space          | space set        | `space`      |
| Space          | only global set  | `global` (inherited) |
| Space          | none             | `default`    |

Editing the model pill writes the override **at the selected scope**; the **Clear**
action removes the override at that scope (reverting to the inherited/default value).

### §3 — Where non-agent config files go (resolved design)
Non-agent files (`CLAUDE.md`, `settings.json`, project files) live under the **Files**
tab, reusing `ConfigFileSidebar` (Global + Project groups only) + `ConfigEditor`
unchanged. This keeps Phase 1 additive: nothing about file editing changes — the file
sidebar is merely demoted to a second tab and stripped of its "Agents" group.

### §4 — Read-only metadata source (Phase 1)
Per-agent `model` (default), `effort`, and `skills` are read from the agent's existing
`.md` **frontmatter** via the existing `GET /agents/:id` (`AgentDetail.content`), parsed
client-side by a small frontmatter util. No new endpoint. Confirmed frontmatter shape:

```yaml
---
name: ux-api-designer
model: sonnet
effort: medium
color: yellow
skills:
  - ui-ux-pro-max
---
```

Because N agents ≈ 5, the view fetches each stage agent's detail in parallel on mount
(or lazily on first expand) and caches the parsed metadata in component/store state.
Effort and skills are rendered **read-only** (effort = disabled segmented reflecting the
frontmatter value; skills = static chips + count). Writing them is Phase 2.

## Rationale
- **Matches the user's mental model.** People think "the architect agent should use
  Opus", not "stage 0 of the routing table". One card per agent unifies the two things
  worth touching — model and skills — where the user already looks.
- **Zero backend cost now.** Every datum needed (stages, stageModels at 3 layers, agent
  frontmatter) is already served. Phase 1 ships pure frontend, honoring "sin endpoints
  nuevos".
- **Inheritance becomes legible.** The source badge answers "where does this model come
  from?" at a glance — the single biggest gap in the old flat routing list.
- **Files are not lost, just demoted.** Reusing the existing sidebar+editor behind a tab
  is the smallest possible change that still gives the agent view the full width.
- **Task scope stays where context exists.** Editing task overrides from a panel with no
  task selected would be a UX trap; #154 already put that control in `TaskDetailPanel`.

## Consequences
- **Positive**
  - Model + skills + effort per agent in one expandable row; full-width content.
  - Routing is no longer a separate concept — it is the model column.
  - Search filters by agent / model / skill, scaling to N agents.
  - Inheritance source is visible; clear-to-inherit is explicit.
  - No backend work; reuses MODEL-1/#154 save paths and shared components.
- **Negative / Risks**
  - *Effort & skills are read-only in Phase 1* — a half-built control could read as
    "broken". **Mitigation:** disabled styling + tooltip "Editing coming in Phase 2";
    skills shown as plain read-only chips, no add/remove affordance.
  - *Parsing frontmatter client-side* is brittle if an agent file is malformed.
    **Mitigation:** defensive parser; on parse failure show `default` model, 0 skills,
    no crash. Degrade gracefully.
  - *Eager N fetches on open* add a few small requests. **Mitigation:** N≈5; fetch in
    parallel; lazy-on-expand fallback if it ever grows.
  - *Two override-editing surfaces* (Config Panel for global/space, TaskDetailPanel for
    task). **Mitigation:** the badge makes the source explicit; documented in user
    stories.

## Alternatives Considered
- **Proposal A (segmented top tabs, full-width routing table):** simplest, but keeps
  routing and agent definition as separate screens — does not achieve the "edit the
  agent in one place" goal. Discarded as the primary direction (its top-tab pattern is
  reused for the Agents&Routing / Files switch).
- **Proposal B (icon rail + search):** scales well but icons-without-labels add
  discovery cost and it still separates routing from skills.
- **Proposal C (single scrollable doc + pill nav):** nice for many sections but the
  CodeMirror file editor fits poorly inside a scrolling card; more vertical scroll.
- **Adding Task as a third editable scope in the Config Panel:** rejected — no task
  context in the panel; would require a task picker and duplicate #154's control.
- **A new `GET /api/v1/skills` catalog + frontmatter write now:** rejected for Phase 1 —
  it is exactly the backend work the brief excludes; deferred to Phase 2.

## Review
Suggested review date: 2026-12-30 (or when Phase 2 — editable skills/effort + skills
catalog endpoint — is scheduled).
