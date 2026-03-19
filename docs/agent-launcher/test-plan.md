# Test Plan: Agent Launcher from Task Cards

**Feature:** Agent Launcher (feature/agent-launcher)
**QA Cycle:** 2026-03-19
**Tester:** qa-engineer-e2e
**Branch:** feature/agent-launcher

---

## Executive Summary

The agent-launcher feature adds five new backend endpoints and five new frontend components enabling users to launch AI agents directly from Kanban task cards. The critical paths are: agent file discovery with path-traversal prevention, CLI command injection into the PTY terminal, and prompt temp-file generation with atomic writes.

**Key risks identified:**
1. **Critical: SETTINGS_FILE is hardcoded to DEFAULT_DATA_DIR** — the settings read/write path ignores the `dataDir` option passed to the server at startup. This causes the default-settings integration test to fail when a real `data/settings.json` already exists, and means settings isolation between environments is impossible.
2. **High: Missing test coverage for 4 agent-launcher frontend components** — `AgentRunIndicator`, `AgentSettingsPanel`, `PipelineProgressBar`, and `useAgentCompletion` have zero test files.
3. **High: Missing store slice tests** — the launcher action slice (`prepareAgentRun`, `executeAgentRun`, `cancelAgentRun`, `startPipeline`, `advancePipeline`, `abortPipeline`, `loadSettings`, `saveSettings`) is untested.
4. **Medium: `buildCliCommand` does not quote space-containing paths** — paths with spaces in the `cat-subshell` mode produce a broken shell command.
5. **Medium: `aria-disabled` vs native `disabled` mismatch** — the `AgentLauncherMenu` button uses both `disabled` (native) and `aria-disabled` is not set; the native `disabled` suppresses tooltip title on some screen readers.

---

## Scope and Objectives

### In Scope
- `GET /api/v1/agents` — agent directory listing
- `GET /api/v1/agents/:agentId` — agent file read with path traversal prevention
- `POST /api/v1/agent/prompt` — prompt assembly, temp-file write, CLI command build
- `GET /api/v1/settings` — settings read with defaults
- `PUT /api/v1/settings` — settings deep-merge and atomic write
- Frontend components: `AgentLauncherMenu`, `AgentPromptPreview`, `AgentRunIndicator`, `AgentSettingsPanel`, `PipelineProgressBar`
- Zustand store: agent launcher slice in `useAppStore`
- `useAgentCompletion` hook

### Out of Scope
- Actual PTY/terminal integration (WebSocket injection tested separately in terminal tests)
- Real CLI tool execution (claude / opencode binaries not present in CI)
- Pipeline full end-to-end (requires real agent runs)

---

## Test Levels

### Unit Tests

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-001 | unit | `toDisplayName` converts kebab stem to title case | `'senior-architect'` | `'Senior Architect'` | Must |
| TC-002 | unit | `buildCliCommand` with `cat-subshell` and claude tool | settings.cli.tool='claude', path='/tmp/p.md' | starts with `claude -p "$(cat /tmp/p.md)"` | Must |
| TC-003 | unit | `buildCliCommand` with `opencode` tool | settings.cli.tool='opencode' | starts with `opencode run` | Must |
| TC-004 | unit | `buildCliCommand` with `stdin-redirect` | fileInputMethod='stdin-redirect' | contains `< "` | Should |
| TC-005 | unit | `buildCliCommand` with `flag-file` | fileInputMethod='flag-file' | contains `--file "` | Should |
| TC-006 | unit | `buildPromptText` includes TASK CONTEXT section | task, space, settings objects | contains `## TASK CONTEXT` | Must |
| TC-007 | unit | `buildPromptText` includes AGENT INSTRUCTIONS | agentContent provided | contains `## AGENT INSTRUCTIONS` | Must |
| TC-008 | unit | `buildPromptText` omits KANBAN block when disabled | includeKanbanBlock=false | does not contain `## KANBAN INSTRUCTIONS` | Must |
| TC-009 | unit | `buildPromptText` omits GIT block when disabled | includeGitBlock=false | does not contain `## GIT INSTRUCTIONS` | Should |
| TC-010 | unit | `buildPromptText` appends ADDITIONAL INSTRUCTIONS | customInstructions='Focus on perf' | contains 'Focus on perf' | Should |
| TC-011 | unit | `deepMergeSettings` merges one level deep | base + partial with nested object | returns merged without losing base keys | Must |
| TC-012 | unit | `deepMergeSettings` replaces arrays (not merges) | base.pipeline.stages=[] partial.pipeline.stages=['a'] | result.pipeline.stages=['a'] | Should |
| TC-013 | unit | `formatElapsed(0)` returns '0:00' | 0 | '0:00' | Should |
| TC-014 | unit | `formatElapsed(65)` returns '1:05' | 65 | '1:05' | Should |
| TC-015 | unit | `formatElapsed(754)` returns '12:34' | 754 | '12:34' | Should |
| TC-016 | unit | Store `cancelAgentRun` sends Ctrl+C and clears activeRun | terminalSender set, activeRun set | sender called with '\x03', activeRun null | Must |
| TC-017 | unit | Store `cancelAgentRun` with null sender shows disconnect toast | terminalSender null | error toast, activeRun null | Must |
| TC-018 | unit | Store `clearActiveRun` sets activeRun to null | activeRun non-null | activeRun null | Must |
| TC-019 | unit | Store `abortPipeline` sends Ctrl+C and clears pipelineState | pipelineState running | sender called with '\x03', pipelineState null | Should |
| TC-020 | unit | Store `abortPipeline` with null sender still clears state | terminalSender null | pipelineState null | Should |
| TC-021 | unit | `AgentRunIndicator` renders null when activeRun is null | activeRun=null | no DOM output | Should |
| TC-022 | unit | `AgentRunIndicator` shows agent displayName and elapsed time | activeRun set | display name visible, elapsed '0:00' | Should |
| TC-023 | unit | `AgentRunIndicator` Cancel button calls cancelAgentRun | click Cancel | store.cancelAgentRun called | Should |

### Integration Tests

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-024 | integration | `GET /api/v1/agents` returns 200 array | no agents dir | 200, `[]` | Must |
| TC-025 | integration | `GET /api/v1/agents` includes newly created file without restart | create .md in agents dir | 200, file in array | Must |
| TC-026 | integration | `GET /api/v1/agents` returns correct AgentInfo shape | create test.md | id, name, displayName, path, sizeBytes present | Must |
| TC-027 | integration | `GET /api/v1/agents` returns 405 for POST | POST /api/v1/agents | 405 | Should |
| TC-028 | integration | `GET /api/v1/agents/:agentId` returns 200 with content | valid agent id | 200, content field present | Must |
| TC-029 | integration | `GET /api/v1/agents/:agentId` returns 404 for missing file | agentId='nonexistent-xyz' | 404, AGENT_NOT_FOUND | Must |
| TC-030 | integration | `GET /api/v1/agents/:agentId` returns 400 for uppercase id | agentId='UPPER_CASE' | 400, INVALID_AGENT_ID | Must |
| TC-031 | integration | `GET /api/v1/agents/:agentId` blocks URL-encoded traversal | agentId='..%2Fetc%2Fpasswd' | 400 or 404, never 200 | Critical |
| TC-032 | integration | `GET /api/v1/settings` returns 200 with full defaults | no settings file | 200, all default fields | Must |
| TC-033 | integration | `GET /api/v1/settings` returns 405 for DELETE | DELETE /api/v1/settings | 405 | Should |
| TC-034 | integration | `PUT /api/v1/settings` returns 200 with merged settings | partial cli.tool update | 200, merged result | Must |
| TC-035 | integration | `PUT /api/v1/settings` persists across subsequent GET | PUT then GET | GET returns updated value | Must |
| TC-036 | integration | `PUT /api/v1/settings` deep-merges without losing other fields | partial update of one field | other cli fields retain defaults | Must |
| TC-037 | integration | `PUT /api/v1/settings` rejects invalid cli.tool | body.cli.tool='bad-tool' | 400, VALIDATION_ERROR, field='cli.tool' | Must |
| TC-038 | integration | `PUT /api/v1/settings` rejects invalid fileInputMethod | body.cli.fileInputMethod='pipe' | 400, VALIDATION_ERROR | Must |
| TC-039 | integration | `PUT /api/v1/settings` rejects null body | body=null | 400, VALIDATION_ERROR | Must |
| TC-040 | integration | `POST /api/v1/agent/prompt` returns 201 with all required fields | valid request | 201, promptPath, promptPreview, cliCommand, estimatedTokens | Must |
| TC-041 | integration | `POST /api/v1/agent/prompt` writes prompt file to disk | valid request | fs.existsSync(promptPath) === true | Must |
| TC-042 | integration | `POST /api/v1/agent/prompt` promptPreview <= 500 chars | valid request | promptPreview.length <= 500 | Must |
| TC-043 | integration | `POST /api/v1/agent/prompt` promptPreview starts with '## TASK CONTEXT' | valid request | promptPreview.startsWith('## TASK CONTEXT') | Must |
| TC-044 | integration | `POST /api/v1/agent/prompt` cliCommand starts with 'claude' by default | claude tool | cliCommand.startsWith('claude') | Must |
| TC-045 | integration | `POST /api/v1/agent/prompt` cliCommand uses 'opencode run' when tool=opencode | settings.cli.tool=opencode | cliCommand.startsWith('opencode run') | Must |
| TC-046 | integration | `POST /api/v1/agent/prompt` includes KANBAN block when enabled | includeKanbanBlock=true | prompt file contains '## KANBAN INSTRUCTIONS' | Should |
| TC-047 | integration | `POST /api/v1/agent/prompt` omits KANBAN block when disabled | includeKanbanBlock=false | prompt file lacks '## KANBAN INSTRUCTIONS' | Should |
| TC-048 | integration | `POST /api/v1/agent/prompt` appends customInstructions | customInstructions provided | prompt contains custom text | Should |
| TC-049 | integration | `POST /api/v1/agent/prompt` returns 400 when agentId missing | body without agentId | 400, VALIDATION_ERROR, field='agentId' | Must |
| TC-050 | integration | `POST /api/v1/agent/prompt` returns 400 when taskId missing | body without taskId | 400, VALIDATION_ERROR, field='taskId' | Must |
| TC-051 | integration | `POST /api/v1/agent/prompt` returns 400 when spaceId missing | body without spaceId | 400, VALIDATION_ERROR, field='spaceId' | Must |
| TC-052 | integration | `POST /api/v1/agent/prompt` returns 404 for nonexistent agent | agentId='nonexistent-zzz' | 404, AGENT_NOT_FOUND | Must |
| TC-053 | integration | `POST /api/v1/agent/prompt` returns 404 for nonexistent task | taskId='nonexistent-xyz' | 404, TASK_NOT_FOUND | Must |
| TC-054 | integration | `POST /api/v1/agent/prompt` returns 405 for GET | GET /api/v1/agent/prompt | 405 | Should |
| TC-055 | integration | settings isolated to dataDir (ISOLATION) | isolated server + PUT then GET | GET returns updated value in temp dir, not real data/ | Critical |

### End-to-End Tests

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-056 | e2e | `AgentLauncherMenu` renders smart_toy icon button in todo column | task card in todo | button visible | Must |
| TC-057 | e2e | `AgentLauncherMenu` does not render in in-progress or done columns | task card not in todo | button not rendered | Must |
| TC-058 | e2e | `AgentLauncherMenu` button is disabled when activeRun is non-null | store.activeRun set | button has disabled attribute | Must |
| TC-059 | e2e | `AgentLauncherMenu` shows agent list on click | click button | agent names visible in menu | Must |
| TC-060 | e2e | `AgentLauncherMenu` shows empty state when no agents | agents=[] | "No agents found" message | Must |
| TC-061 | e2e | `AgentLauncherMenu` shows "Run Full Pipeline" option | click button | "Run Full Pipeline" visible | Should |
| TC-062 | e2e | `AgentLauncherMenu` closes on Escape key | open menu, press Escape | menu closes | Should |
| TC-063 | e2e | `AgentLauncherMenu` closes on outside click | open menu, click outside | menu closes | Should |
| TC-064 | e2e | `AgentPromptPreview` renders CLI command in code block | preparedRun set | cliCommand text visible | Must |
| TC-065 | e2e | `AgentPromptPreview` renders prompt preview in textarea | preparedRun set | promptPreview text visible | Must |
| TC-066 | e2e | `AgentPromptPreview` renders token badge | estimatedTokens=2400 | '~2.4k tokens' visible | Should |
| TC-067 | e2e | `AgentPromptPreview` Copy button copies cliCommand | click Copy | clipboard.writeText called | Should |
| TC-068 | e2e | `AgentPromptPreview` Edit button makes textarea editable | click Edit | textarea no longer readOnly | Should |
| TC-069 | e2e | `AgentPromptPreview` shows 'Edited' label in edit mode | click Edit | 'Edited' label visible | Should |
| TC-070 | e2e | `AgentPromptPreview` Execute button calls executeAgentRun | click Execute | store.executeAgentRun called | Must |
| TC-071 | e2e | `AgentPromptPreview` Cancel button calls clearPreparedRun | click Cancel | store.clearPreparedRun called | Must |
| TC-072 | e2e | `AgentRunIndicator` hidden when activeRun is null | activeRun=null | indicator not in DOM | Should |
| TC-073 | e2e | `AgentRunIndicator` shows pulsing dot, agent name, elapsed | activeRun set | all elements visible | Should |
| TC-074 | e2e | `AgentRunIndicator` Cancel button calls cancelAgentRun | click Cancel | store.cancelAgentRun called | Should |
| TC-075 | e2e | `AgentSettingsPanel` does not render when closed | agentSettingsPanelOpen=false | panel not in DOM | Should |
| TC-076 | e2e | `AgentSettingsPanel` renders CLI Tool radio group | panel open | three radio options visible | Should |
| TC-077 | e2e | `AgentSettingsPanel` reveals binary input when Custom selected | select Custom | binary path input visible | Should |
| TC-078 | e2e | `AgentSettingsPanel` Save Settings calls saveSettings | click Save Settings | store.saveSettings called | Should |
| TC-079 | e2e | `PipelineProgressBar` renders stage indicators | pipelineState running | 4 stage indicators visible | Should |
| TC-080 | e2e | `useAgentCompletion` calls clearActiveRun when task moves to done | task id matches activeRun.taskId in done column | clearActiveRun called | Must |
| TC-081 | e2e | `useAgentCompletion` calls advancePipeline when autoAdvance=true, confirmBetweenStages=false | pipeline running, confirmBetweenStages=false | advancePipeline called | Should |

### Performance Tests

| ID | Type | Description | Threshold |
|----|------|-------------|-----------|
| TC-082 | perf | `GET /api/v1/agents` p99 latency with 50 .md files in agents dir | < 100ms p99 (per spec) |
| TC-083 | perf | `GET /api/v1/agents/:agentId` p99 latency | < 100ms p99 (per spec) |
| TC-084 | perf | `POST /api/v1/agent/prompt` p99 latency | < 200ms p99 (per spec) |
| TC-085 | perf | `GET /api/v1/settings` p99 latency | < 100ms p99 |
| TC-086 | perf | `PUT /api/v1/settings` p99 latency | < 200ms p99 |
| TC-087 | perf | Prompt file accumulation: 1000 prompt files in data/.prompts/ | cleanup removes all files older than 24h |

### Security Tests

| ID | Type | Description | OWASP Reference |
|----|------|-------------|-----------------|
| TC-088 | security | Path traversal via URL-encoded `..%2F` in agentId | A01:2021 Broken Access Control |
| TC-089 | security | Path traversal via double-encoded `..%252F` in agentId | A01:2021 Broken Access Control |
| TC-090 | security | Path traversal via null-byte `%00` injection in agentId | A01:2021 Broken Access Control |
| TC-091 | security | AGENT_ID_RE regex rejects traversal before file access | A01:2021 Broken Access Control |
| TC-092 | security | `workingDirectory` in prompt body can reference arbitrary paths (advisory) | A01:2021 Broken Access Control |
| TC-093 | security | Shell metacharacters in task title/description do not execute when written to prompt file | A03:2021 Injection |
| TC-094 | security | Shell metacharacters in customInstructions do not alter cliCommand structure | A03:2021 Injection |
| TC-095 | security | Prompt file path not exposed to user beyond promptPath response field | A02:2021 Cryptographic Failures |
| TC-096 | security | `PUT /api/v1/settings` with cli.binary='rm -rf /' — binary is stored but never shell-executed by server | A03:2021 Injection |
| TC-097 | security | `ErrorResponse` never includes stack traces or internal paths | A05:2021 Security Misconfiguration |
| TC-098 | security | Missing HTTP security headers (CSP, X-Content-Type-Options, X-Frame-Options) on all endpoints | A05:2021 Security Misconfiguration |
| TC-099 | security | `XSS` — cliCommand displayed in `<pre>` via React (auto-escaped) | A03:2021 Injection |
| TC-100 | security | `data/.prompts/` not directly browsable via HTTP | A05:2021 Security Misconfiguration |

---

## Environment Requirements

- Node.js 23 (as confirmed by test runner behavior)
- `~/.claude/agents/` directory accessible (tests write isolated test agents)
- `data/` directory writable (prompt files, settings.json)
- Vitest + React Testing Library for frontend tests
- Backend tests: Node.js native `node:test` runner

---

## Assumptions and Exclusions

- **Assumption:** Real CLI tools (claude, opencode) are not present in the test environment — CLI command strings are inspected as strings only.
- **Assumption:** Network isolation — the server is local-only (localhost:3000), no authentication is required by design.
- **Assumption:** `data/settings.json` may exist and contain non-default values in the development environment; tests should use isolated data dirs.
- **Exclusion:** Actual PTY character injection verification (requires live WebSocket + pty process).
- **Exclusion:** Pipeline multi-stage full end-to-end (requires real agent binary execution).

---

## Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| SETTINGS_FILE not isolated to dataDir — test contamination | Critical | Confirmed | Fix required: pass dataDir into settings path |
| Large agent file (>1MB) assembled into prompt — memory pressure | Medium | Low | Add maxLength guard or log warning |
| Concurrent `POST /api/v1/agent/prompt` — prompt file timestamp collision | Medium | Low | Atomic write pattern in place; timestamp resolution is ms |
| `data/.prompts/` grows unbounded if cleanup not triggered | Medium | Medium | Cleanup called on startup and periodically |
| Shell metacharacters in task titles breaking terminal injection | High | Medium | The temp-file approach mitigates inline argument injection |
