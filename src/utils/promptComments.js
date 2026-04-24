/**
 * Returns the note-triggers + handoff-summary block injected into every
 * agent prompt. Keeping it here avoids duplicating the text across
 * prompt.js (terminal mode) and pipelineManager.js (pipeline mode).
 *
 * @param {string} spaceId
 * @param {string} taskId
 * @returns {string[]} lines ready to join with '\n'
 */
function buildCommentGuidanceLines(spaceId, taskId) {
  return [
    'POST A NOTE (type: "note", does NOT pause pipeline) for any of these:',
    '  • Non-obvious assumption: something you assumed that is not explicit in the spec',
    `    mcp__prism__kanban_add_comment({ spaceId: "${spaceId}", taskId: "${taskId}", author: "<your-agent-id>", type: "note", text: "Assumption: <what + why>" })`,
    '  • Blueprint deviation: you decided to do something differently than specified',
    `    mcp__prism__kanban_add_comment({ spaceId: "${spaceId}", taskId: "${taskId}", author: "<your-agent-id>", type: "note", text: "Deviation: <what changed + why>" })`,
    '  • Non-trivial trade-off: you chose approach A over B and the reason is not obvious',
    `    mcp__prism__kanban_add_comment({ spaceId: "${spaceId}", taskId: "${taskId}", author: "<your-agent-id>", type: "note", text: "Trade-off: chose <A> over <B> because <reason>" })`,
    '',
    'HANDOFF SUMMARY — post BEFORE moving to done (always, even if no deviations):',
    `  mcp__prism__kanban_add_comment({ spaceId: "${spaceId}", taskId: "${taskId}", author: "<your-agent-id>", type: "note", text: "Handoff: produced <artifacts>. Next agent should read <key files>." })`,
  ];
}

module.exports = { buildCommentGuidanceLines };
