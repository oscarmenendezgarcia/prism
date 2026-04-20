/**
 * CommentsSection — threaded comment list + new-comment form for the TaskDetailPanel.
 *
 * Layout:
 *   - Questions: amber/yellow pill header + "pending" / "resolved" badge + body text
 *   - Answers: 12px left-indent, grey-neutral colour, nested under their parent question
 *   - Notes: grey-neutral, no threading badge
 *   - Add-comment form: type selector + textarea + Submit button
 *
 * ADR-1 (task-comments): reads task.comments[] (embedded in Task, returned by GET task).
 * Wire-up: caller supplies spaceId/taskId/comments and callbacks so this component stays pure.
 */

import React, { useCallback, useState } from 'react';
import type { Comment } from '@/types';
import { formatTimestamp } from '@/utils/formatTimestamp';
import { Button } from '@/components/shared/Button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommentsSectionProps {
  spaceId: string;
  taskId: string;
  comments: Comment[];
  /** Called after a new comment is submitted so the parent can refresh the task. */
  onCommentCreated: (payload: { author: string; text: string; type: Comment['type']; parentId?: string; targetAgent?: string }) => Promise<void>;
  /** Called when a question is resolved/un-resolved. */
  onCommentUpdated: (commentId: string, patch: { resolved?: boolean; text?: string }) => Promise<void>;
  /** Whether interactions are disabled (e.g. while an agent pipeline is running). */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unresolvedQuestionCount(comments: Comment[]): number {
  return comments.filter((c) => c.type === 'question' && !c.resolved).length;
}

// ---------------------------------------------------------------------------
// CommentBubble — renders one comment
// ---------------------------------------------------------------------------

interface CommentBubbleProps {
  comment: Comment;
  isAnswer: boolean;
  onResolveToggle?: (commentId: string, resolved: boolean) => void;
  disabled?: boolean;
}

function CommentBubble({ comment, isAnswer, onResolveToggle, disabled }: CommentBubbleProps) {
  const isQuestion = comment.type === 'question';
  const isNote     = comment.type === 'note';

  const containerClass = [
    'flex gap-3',
    isAnswer ? 'ml-4 pl-3 border-l border-border' : '',
  ].filter(Boolean).join(' ');

  const bubbleClass = [
    'flex flex-col gap-1 p-3 rounded-lg border text-sm flex-1 min-w-0',
    isAnswer
      ? 'bg-surface border-border'
      : isQuestion && !comment.resolved
      ? 'bg-warning/[0.06] border-warning/20'
      : isQuestion && comment.resolved
      ? 'bg-surface border-border opacity-60'
      : 'bg-surface-elevated border-border',
  ].filter(Boolean).join(' ');

  return (
    <div className={containerClass} data-testid="comment-bubble">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
        {comment.author[0].toUpperCase()}
      </div>
      {/* Bubble body */}
      <div className={bubbleClass}>
        {/* Header row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Type pill */}
          {isQuestion && (
            <span
              data-testid="comment-type-badge"
              className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide leading-none ${
                comment.resolved
                  ? 'bg-success/[0.12] text-success'
                  : 'bg-warning/[0.15] text-warning'
              }`}
            >
              {comment.resolved ? 'resolved' : 'question'}
            </span>
          )}
          {isNote && (
            <span
              data-testid="comment-type-badge"
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide leading-none bg-surface-variant text-text-secondary"
            >
              note
            </span>
          )}
          {isAnswer && (
            <span className="material-symbols-outlined text-[14px] leading-none text-text-secondary" aria-hidden="true">
              subdirectory_arrow_right
            </span>
          )}

          {/* needs-human badge */}
          {comment.needsHuman && (
            <span
              data-testid="needs-human-badge"
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide leading-none bg-error/[0.15] text-error"
            >
              needs human
            </span>
          )}

          {/* Author */}
          <span className="text-xs font-medium text-text-primary truncate">
            {comment.author}
          </span>

          {/* targetAgent routing indicator */}
          {comment.targetAgent && (
            <span
              data-testid="comment-target-agent"
              className="text-[10px] text-text-disabled"
            >
              → {comment.targetAgent}
            </span>
          )}

          {/* Timestamp */}
          <span className="text-[10px] text-text-disabled ml-auto flex-shrink-0">
            {formatTimestamp(comment.createdAt)}
          </span>

          {/* Resolve toggle for questions */}
          {isQuestion && onResolveToggle && !disabled && (
            <button
              type="button"
              onClick={() => onResolveToggle(comment.id, !comment.resolved)}
              aria-label={comment.resolved ? 'Mark as unresolved' : 'Mark as resolved'}
              title={comment.resolved ? 'Mark as unresolved' : 'Mark as resolved'}
              className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full hover:bg-surface-variant text-text-secondary hover:text-primary focus:outline-hidden focus:ring-2 focus:ring-primary transition-colors duration-fast"
            >
              <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">
                {comment.resolved ? 'undo' : 'check_circle'}
              </span>
            </button>
          )}
        </div>

        {/* Body */}
        <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap break-words">
          {comment.text}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddCommentForm — inline form to post a new comment
// ---------------------------------------------------------------------------

interface AddCommentFormProps {
  onSubmit: (type: Comment['type'], text: string, targetAgent?: string) => Promise<void>;
  disabled?: boolean;
}

function AddCommentForm({ onSubmit, disabled }: AddCommentFormProps) {
  const [type, setType]               = useState<Comment['type']>('note');
  const [text, setText]               = useState('');
  const [targetAgent, setTargetAgent] = useState('');
  const [submitting, setSubmitting]   = useState(false);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting || disabled) return;
    setSubmitting(true);
    try {
      const agent = type === 'question' ? targetAgent.trim() || undefined : undefined;
      await onSubmit(type, trimmed, agent);
      setText('');
      setTargetAgent('');
    } finally {
      setSubmitting(false);
    }
  }, [type, text, targetAgent, onSubmit, submitting, disabled]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  return (
    <div className="flex gap-3 pt-4 border-t border-border" data-testid="add-comment-form">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-1">
        Y
      </div>
      {/* Form body */}
      <div className="flex-1 flex flex-col gap-2 min-w-0">
        {/* Type selector */}
        <div role="group" aria-label="Comment type" className="flex rounded-lg overflow-hidden border border-border">
          {(['note', 'question', 'answer'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              disabled={disabled}
              className={`flex-1 py-1 text-xs font-medium capitalize transition-colors duration-fast focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed ${
                type === t
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-elevated text-text-secondary hover:bg-surface-variant hover:text-text-primary'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Route-to-agent input (questions only) */}
        {type === 'question' && (
          <input
            type="text"
            value={targetAgent}
            onChange={(e) => setTargetAgent(e.target.value)}
            disabled={disabled || submitting}
            placeholder="Route to agent (optional)"
            aria-label="Route to agent"
            data-testid="target-agent-input"
            className="w-full px-3 py-2 rounded-lg bg-surface-elevated border border-border text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-fast"
          />
        )}

        {/* Textarea */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || submitting}
          rows={3}
          placeholder={
            type === 'question'
              ? 'Ask a question... (blocks pipeline until answered)'
              : type === 'answer'
              ? 'Answer a question...'
              : 'Add a note...'
          }
          aria-label="Comment text"
          className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-fast min-h-[72px]"
        />

        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-text-disabled">
            ⌘↵ to submit
          </span>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={disabled || submitting || !text.trim()}
            className="text-xs px-3 py-1.5"
          >
            {submitting ? (
              <>
                <span className="material-symbols-outlined text-sm leading-none animate-spin" aria-hidden="true">
                  progress_activity
                </span>
                Posting...
              </>
            ) : (
              'Post comment'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommentsSection — main export
// ---------------------------------------------------------------------------

export function CommentsSection({
  comments,
  onCommentCreated,
  onCommentUpdated,
  disabled,
}: CommentsSectionProps): React.ReactElement {
  /** Default author for new comments — could be extended to read from settings. */
  const author = 'user';

  const handleSubmit = useCallback(
    (type: Comment['type'], text: string, targetAgent?: string) =>
      onCommentCreated({ author, text, type, targetAgent }),
    [onCommentCreated],
  );

  const handleResolveToggle = useCallback(
    (commentId: string, resolved: boolean) =>
      onCommentUpdated(commentId, { resolved }),
    [onCommentUpdated],
  );

  // Build a lookup: questionId → answers[]
  const answersByParent: Record<string, Comment[]> = {};
  for (const c of comments) {
    if (c.type === 'answer' && c.parentId) {
      if (!answersByParent[c.parentId]) answersByParent[c.parentId] = [];
      answersByParent[c.parentId].push(c);
    }
  }

  // Top-level items: notes + questions (answers are nested under questions)
  const topLevel = comments.filter((c) => c.type !== 'answer' || !c.parentId);

  const unresolved = unresolvedQuestionCount(comments);

  return (
    <div className="flex flex-col gap-4" data-testid="comments-section">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-text-disabled uppercase tracking-widest">
          Comments
        </span>
        {comments.length > 0 && (
          <span className="text-[10px] text-text-disabled">
            ({comments.length})
          </span>
        )}
        {unresolved > 0 && (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-warning/[0.15] text-warning leading-none"
            data-testid="unresolved-badge"
            aria-label={`${unresolved} unresolved question${unresolved !== 1 ? 's' : ''}`}
          >
            {unresolved} pending
          </span>
        )}
      </div>

      {/* Thread */}
      {topLevel.length > 0 && (
        <div className="flex flex-col gap-4" aria-label="Comment thread">
          {topLevel.map((comment) => (
            <React.Fragment key={comment.id}>
              <CommentBubble
                comment={comment}
                isAnswer={false}
                onResolveToggle={comment.type === 'question' ? handleResolveToggle : undefined}
                disabled={disabled}
              />
              {/* Nested answers — indented under parent */}
              {(answersByParent[comment.id] ?? []).map((answer) => (
                <CommentBubble
                  key={answer.id}
                  comment={answer}
                  isAnswer={true}
                  disabled={disabled}
                />
              ))}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Empty state */}
      {comments.length === 0 && (
        <p className="text-xs text-text-disabled italic" data-testid="comments-empty">
          No comments yet
        </p>
      )}

      {/* Add-comment form */}
      <AddCommentForm onSubmit={handleSubmit} disabled={disabled} />
    </div>
  );
}
