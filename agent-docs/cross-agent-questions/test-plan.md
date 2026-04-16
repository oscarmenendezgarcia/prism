# Test Plan: Cross-Agent Question Resolver

## Executive Summary

The cross-agent question resolver feature adds `targetAgent` routing to pipeline question-comments, enabling the pipeline manager to spawn a resolver agent to answer questions autonomously. All 140 backend tests pass (0 failures). Two code-level bugs were identified: one **Medium** (resolver chaining for sequential questions both with `targetAgent`) and one **Low** (observability log loses PID on timeout). No Critical or High bugs found. The feature is **ready to merge** pending the Medium bug fix.

---

## Scope & Objectives

**Feature under test:** Cross-Agent Question Resolver (ADR-1, `cross-agent-questions`)

**Objectives:**
1. Verify `targetAgent` field is correctly validated, persisted, and routed in the REST API and MCP tool
2. Verify `pipelineManager.attemptCrossAgentResolution` correctly spawns/skips resolvers per pipeline membership
3. Verify resolver lifecycle: spawn → poll → exit 0 (success) or exit != 0 / timeout (needsHuman)
4. Verify anti-recursion guard prevents second-level resolver chains
5. Verify `handleResolverClose` and `markCommentNeedsHuman` behave correctly
6. Verify server restart recovery (T-010) for live/dead resolver processes
7. Verify full backward compatibility with comments that have no `targetAgent`
8. Verify OWASP surface area for the new inputs and spawning path

---

## Test Levels

### Unit Tests (inline — no server)
| Test Group | Location | Count |
|---|---|---|
| `findActiveRunByTaskId` | `pipeline-blocked.test.js` | 2 |
| `blockRunByComment` | `pipeline-blocked.test.js` | 2 |
| `unblockRunByComment` | `pipeline-blocked.test.js` | 3 |
| `bypassQuestionCheck` regression (GT-003) | `pipeline-blocked.test.js` | 2 |

### Integration Tests (isolated server)
| Test Group | Location | Count |
|---|---|---|
| Comment handler — targetAgent validation | `comments.test.js` | 6 |
| Comment handler — needsHuman PATCH | `comments.test.js` | 4 |
| REST API — pipeline block/unblock | `pipeline-blocked.test.js` | 12 |
| Cross-agent resolver (PIPELINE_NO_SPAWN=1) | `pipeline-blocked.test.js` | 5 |
| MCP comment pipeline — targetAgent field | `mcp-comment-pipeline.test.js` | 7 |
| MCP comment pipeline — existing flows | `mcp-comment-pipeline.test.js` | 26 |

### Full Suite (node:test runner)
140 tests across 18 non-hanging test files.

---

## Test Cases Table

| ID | Type | Description | Input | Expected Output | Priority | Result |
|----|------|-------------|-------|-----------------|----------|--------|
| TC-SCHEMA-01 | Unit | POST question + valid targetAgent → 201, persisted | `{type:'question', targetAgent:'senior-architect'}` | 201, body has `targetAgent`, `needsHuman=false` | High | PASS |
| TC-SCHEMA-02 | Unit | POST note + targetAgent → 400 | `{type:'note', targetAgent:'senior-architect'}` | 400 VALIDATION_ERROR mentioning `targetAgent` and `question` | High | PASS |
| TC-SCHEMA-03 | Unit | POST answer + targetAgent → 400 | `{type:'answer', targetAgent:'x'}` | 400 VALIDATION_ERROR | High | PASS |
| TC-SCHEMA-04 | Unit | POST question + empty targetAgent → 400 | `{type:'question', targetAgent:''}` | 400 VALIDATION_ERROR | High | PASS |
| TC-SCHEMA-05 | Unit | POST question + 101-char targetAgent → 400 | `{type:'question', targetAgent:'x'×101}` | 400 VALIDATION_ERROR mentioning 100 | Medium | PASS |
| TC-SCHEMA-06 | Unit | POST question without targetAgent → 201 (backward compat) | `{type:'question'}` | 201, no `targetAgent` field, `needsHuman=false` | High | PASS |
| TC-SCHEMA-07 | Unit | PATCH needsHuman=true → 200, persists | `{needsHuman:true}` | 200, `needsHuman=true`, `updatedAt` set | High | PASS |
| TC-SCHEMA-08 | Unit | PATCH needsHuman=false → 200, resets | `{needsHuman:false}` | 200, `needsHuman=false` | Medium | PASS |
| TC-SCHEMA-09 | Unit | PATCH needsHuman='yes' (string) → 400 | `{needsHuman:'yes'}` | 400, message mentions boolean | High | PASS |
| TC-SCHEMA-10 | Unit | PATCH empty body still 400 (backward compat) | `{}` | 400, lists text/type/resolved | High | PASS |
| TC-RESOLVER-01 | Integration | Valid targetAgent in stages → resolverActive=true | question with targetAgent in run.stages | run.resolverActive=true, blockedReason.targetAgent set | High | PASS (R-1) |
| TC-RESOLVER-02 | Integration | Invalid targetAgent (not in stages) → needsHuman=true, no resolver | question with targetAgent NOT in stages | comment.needsHuman=true, run.resolverActive absent | High | PASS (R-2) |
| TC-RESOLVER-03 | Integration | Question without targetAgent → normal block, no resolver | question, no targetAgent | run.status=blocked, resolverActive absent | High | PASS (R-3) |
| TC-RESOLVER-04 | Integration | PIPELINE_NO_SPAWN=1 — resolver exit 0 clears resolverActive | sentinel written as '0' | resolverActive cleared after 2 polling cycles | High | PASS (R-4) |
| TC-RESOLVER-05 | Integration | Anti-recursion guard prevents second resolver | resolverActive=true + new question with targetAgent | resolverActive stays true, no second spawn, needsHuman=false | High | PASS (R-5) |
| TC-RESOLVER-06 | Integration | Resolver timeout → needsHuman=true | PIPELINE_RESOLVER_TIMEOUT_MS=1, resolver never exits | comment.needsHuman=true | High | NOT COVERED (see gaps) |
| TC-RESOLVER-07 | Integration | Multiple questions both with targetAgent — second gets resolver | Q1 resolved by resolver, Q2 also has targetAgent | Resolver spawned for Q2 after Q1 resolves | Medium | FAIL — BUG-001 |
| TC-RESOLVER-08 | Integration | T-010 restart: live resolver process → polling reattached | server restarts with resolverActive=true, PID alive | resolver polling reattaches, run stays blocked | Medium | NOT COVERED (see gaps) |
| TC-RESOLVER-09 | Integration | T-010 restart: dead resolver process → needsHuman=true | server restarts with resolverActive=true, PID dead | needsHuman=true, resolverActive cleared | Medium | NOT COVERED (see gaps) |
| TC-MCP-01 | Integration | MCP kanban_add_comment passes targetAgent to REST | `kanban_add_comment({targetAgent:'ux-api-designer'})` | REST receives targetAgent in body | High | PASS (TC-027) |
| TC-MCP-02 | Integration | MCP add_comment without targetAgent — backward compat | `kanban_add_comment({type:'question'})` | 201, no targetAgent | High | PASS (TC-031) |
| TC-MCP-03 | Integration | E2E: invalid targetAgent → run blocked, needsHuman=true | targetAgent NOT in run.stages | run.blocked, comment.needsHuman=true (TC-033 partial) | High | PARTIAL (needsHuman not asserted in TC-033) |
| TC-BACKWARD-01 | Integration | Existing question flows unaffected | question, no targetAgent | Same behavior as before feature | High | PASS |
| TC-BACKWARD-02 | Integration | Note comment still doesn't block pipeline | note comment | run stays running | High | PASS |
| TC-BACKWARD-03 | Integration | PATCH resolved=true still unblocks run (no targetAgent path) | resolve a plain question | run transitions to running | High | PASS |
| TC-SECURITY-01 | Security | OWASP A03: Shell injection via comment.text in resolver prompt | `text` with shell metacharacters | Prompt file written with text verbatim, shell-safe via `< promptFilePath` | High | PASS (static analysis) |
| TC-SECURITY-02 | Security | OWASP A03: Path traversal via commentId in resolverDonePath | commentId = `../../evil` | UUID enforced by crypto.randomUUID() at creation | High | PASS (static analysis) |
| TC-SECURITY-03 | Security | OWASP A07: targetAgent injection via MAX_LEN guard | targetAgent > 100 chars | 400 rejected at handler | Medium | PASS (TC-SCHEMA-05) |

---

## Performance Thresholds

| Metric | Threshold | Observed | Status |
|--------|-----------|----------|--------|
| Full test suite (140 tests) | < 60s | ~32s | PASS |
| Resolver polling interval | 2000ms (by design) | 2000ms constant | PASS |
| Resolver default timeout | 300000ms (5 min) | configurable via env | PASS |
| markCommentNeedsHuman | < 10ms (local I/O) | < 1ms | PASS |

---

## Environment Requirements

- Node.js ≥ 14.17 (uses `crypto.randomUUID()`)
- `PIPELINE_NO_SPAWN=1` for integration tests (no real Claude processes needed)
- Isolated temp directories per test suite (via `mkdtempSync`)

---

## Assumptions & Exclusions

- **Assumed:** `kanban_answer_comment` correctly calls `unblockRunByComment` when `resolved=true`. This path is covered by existing pipeline-blocked tests.
- **Excluded:** Real Claude agent spawn testing (requires Claude binary, no CI coverage).
- **Excluded:** MCP protocol wire-level tests (covered by existing mcp-server tests).
- **Excluded:** `pipeline-templates.test.js` and `terminal.test.js` — known hanging tests (see memory notes).

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Multiple questions with targetAgent: only first gets auto-resolved | Medium | BUG-001 fix required |
| Resolver answers incorrectly, unblocking with bad information | Medium (design risk) | ADR accepts this; answer is persisted for human review |
| resolverActive flag leaks if server crashes mid-resolver | Low | T-010 handles this in init() |
| Timeout log loses PID info | Low | BUG-002 fix recommended |
