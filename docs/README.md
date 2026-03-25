# docs/

System-level documentation for Prism. Maintained by agents — update these files when the system changes.

---

## Files

| File | Purpose |
|------|---------|
| `architecture.md` | Stack, data model, pipeline overview, key ADRs |
| `endpoints.md` | Full REST API reference — all routes, params, and response shapes |
| `mcp-server.md` | MCP server tools reference — all kanban_* tools with params and examples |
| `github-readiness.md` | Checklist for public GitHub release |

---

## Where are the feature artifacts?

Per-feature artifacts (ADRs, wireframes, api-specs, test-plans, stitch screens, etc.) live in `agent-docs/` at the project root. That directory is gitignored — it contains outputs from the agent pipeline and is not meant for public distribution.

---

## Pipeline overview

```
senior-architect  →  ux-api-designer  →  developer-agent  →  qa-engineer-e2e
     ADR                wireframes           code +               test-plan
  blueprint            api-spec.json         tests               test-results
  tasks.json          user-stories.md      CHANGELOG              bugs.md
```

All outputs go to `agent-docs/<feature>/`. QA bugs of severity Critical or High block the merge and trigger a fix loop back to the developer.
