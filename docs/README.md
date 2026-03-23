# docs/

This folder contains the design and planning artifacts produced by the iterative agent pipeline used to develop Prism. Every feature goes through four stages before code is written: architecture → UX & API design → implementation → QA. The outputs of each stage live here.

---

## What these files are

| File | Produced by | Purpose |
|------|-------------|---------|
| `ADR-*.md` | Senior Architect | Architecture Decision Record — context, options considered, decision made, consequences |
| `blueprint.md` | Senior Architect | Component design, data flows, API contracts, and architectural constraints |
| `tasks.json` | Senior Architect | Task breakdown with dependencies and acceptance criteria |
| `api-spec.json` | UX/API Designer | OpenAPI 3.0 specification for all endpoints introduced by the feature |
| `wireframes.md` | UX/API Designer | Screen-by-screen UX description with layout, interactions, and states |
| `wireframes-stitch.md` | UX/API Designer | Stitch screen IDs and HTML download URLs for generated UI previews |
| `user-stories.md` | UX/API Designer | Acceptance-criteria-style user stories |
| `stitch-screens/` | UX/API Designer | Downloaded HTML files from the Stitch UI generator |
| `test-plan.md` | QA Engineer | Test strategy, scenarios, and coverage targets |
| `test-results.json` | QA Engineer | Structured test run results |
| `bugs.md` | QA Engineer | Bug report with severity classification |
| `CHANGELOG.md` | Developer | What was implemented, commit by commit |

Not every feature has every file — the set depends on whether the feature has a public API, a UI, or required a full QA pass.

---

## Folder structure

Each folder maps to one feature or initiative:

```
docs/
├── agent-launcher/          # Agent launcher UI — spawn and manage AI agents from the board
├── agent-run-history/       # Agent run history panel — view past agent executions per task
├── allow-resize-settings/   # Resizable settings panel layout
├── assigned-field/          # Assigned-to field on task cards
├── bug-agents-progress/     # Bug: agent progress not reflected in real time
├── clear-board/             # Clear all tasks from a board column
├── config-editor/           # In-app config editor for ~/.claude/*.md files
├── design-system/           # Design system tokens, Figma rules, and Stitch components
├── mcp/                     # MCP server integration — expose Prism via Model Context Protocol
├── optcg-redesign/          # One Piece TCG card browser redesign
├── optcg-search/            # One Piece TCG client-side card search
├── pipeline-subtasks/       # Subtask support in the agent pipeline
├── pty-support/             # PTY (pseudo-terminal) support for the embedded terminal
├── qa/                      # Standalone QA reports for early features (pre-pipeline)
├── react-migration/         # Migration from vanilla JS frontend to React + TypeScript
├── redesign/                # Full Prism UI redesign
├── settings-bar/            # Settings bar component
├── spaces/                  # Multi-space (project) support
├── task-attachments/        # File and artifact attachments on task cards
├── terminal-shell/          # Embedded terminal shell panel
├── timestamp-display/       # Created/updated timestamp display on task cards
│
├── ADR-1.md                 # (root) ADR for the original One Piece TCG card search — predates subfolder layout
├── blueprint.md             # (root) Blueprint for the original card search feature
├── api-spec.json            # (root) API spec for the original card search feature
├── tasks.json               # (root) Task breakdown for the original card search feature
├── user-stories.md          # (root) User stories for the original card search feature
├── wireframes.md            # (root) Wireframes for the original card search feature
└── github-readiness.md      # Checklist for public GitHub release readiness
```

> The root-level `ADR-1.md`, `blueprint.md`, and related files belong to the `optcg-search` feature and were created before the per-feature subfolder convention was established. All subsequent features use their own subfolder.

---

## How to read an ADR

Each ADR follows this structure:

1. **Status** — `Draft` / `Proposed` / `Accepted` / `Superseded`
2. **Context** — What problem is being solved and why
3. **Decision** — What was decided
4. **Options considered** — Alternatives evaluated and why they were rejected
5. **Consequences** — Trade-offs and follow-on work

If an ADR is `Superseded`, a newer ADR in the same folder (or a child feature folder) replaces it.

---

## Pipeline overview

```
senior-architect  →  ux-api-designer  →  developer-agent  →  qa-engineer-e2e
     ADR                wireframes           code +               test-plan
  blueprint            api-spec.json         tests               test-results
  tasks.json          user-stories.md      CHANGELOG              bugs.md
```

QA bugs of severity Critical or High block the merge and trigger a fix loop back to the developer.
