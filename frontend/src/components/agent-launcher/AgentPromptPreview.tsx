/**
 * Prompt preview modal — shown before injecting a CLI command into the PTY.
 * ADR-1 (Agent Launcher) §3.1: mandatory preview step before execution.
 *
 * Shows:
 * - CLI command in a monospace code block with Copy button
 * - Full prompt text (promptFull) in a scrollable MarkdownViewer by default
 * - Collapse/expand toggle: expanded shows full text, collapsed shows first 500 chars
 * - Estimated token count badge
 * - Execute and Cancel buttons
 *
 * T-007: default to full prompt; add expand/collapse toggle.
 */

import React, { useState, useCallback } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { MarkdownViewer } from '@/components/shared/MarkdownViewer';
import { useAppStore, usePromptPreviewOpen, usePreparedRun, useAvailableAgents } from '@/stores/useAppStore';

const MODAL_LABEL_ID = 'agent-prompt-preview-title';

export function AgentPromptPreview() {
  const open         = usePromptPreviewOpen();
  const preparedRun  = usePreparedRun();
  const agents       = useAvailableAgents();

  const executeAgentRun  = useAppStore((s) => s.executeAgentRun);
  const clearPreparedRun = useAppStore((s) => s.clearPreparedRun);

  const [editMode, setEditMode]         = useState(false);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [copied, setCopied]             = useState(false);
  /** When true, display only the first 500 chars of the prompt. Default: false (show full). */
  const [collapsed, setCollapsed]       = useState(false);

  const agentDisplayName = preparedRun
    ? (agents.find((a) => a.id === preparedRun.agentId)?.displayName ?? preparedRun.agentId)
    : '';

  const handleClose = useCallback(() => {
    clearPreparedRun();
    setEditMode(false);
    setEditedPrompt('');
    setCollapsed(false);
  }, [clearPreparedRun]);

  const handleExecute = useCallback(async () => {
    setEditMode(false);
    setEditedPrompt('');
    setCollapsed(false);
    await executeAgentRun();
  }, [executeAgentRun]);

  const handleCopy = useCallback(async () => {
    if (!preparedRun) return;
    try {
      await navigator.clipboard.writeText(preparedRun.cliCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable — silently ignore
    }
  }, [preparedRun]);

  const handleToggleEdit = useCallback(() => {
    if (!editMode && preparedRun) {
      setEditedPrompt(preparedRun.promptFull ?? preparedRun.promptPreview);
    }
    setEditMode((v) => !v);
  }, [editMode, preparedRun]);

  if (!preparedRun) return null;

  const fullPrompt    = preparedRun.promptFull ?? preparedRun.promptPreview;
  const displayPrompt = collapsed ? fullPrompt.slice(0, 500) : fullPrompt;

  const tokenLabel = preparedRun.estimatedTokens >= 1000
    ? `~${(preparedRun.estimatedTokens / 1000).toFixed(1)}k tokens`
    : `~${preparedRun.estimatedTokens} tokens`;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelId={MODAL_LABEL_ID}
      className="max-w-2xl"
    >
      <ModalHeader onClose={handleClose}>
        <div className="flex items-center gap-2">
          <span
            className="material-symbols-outlined text-lg text-primary leading-none"
            aria-hidden="true"
          >
            smart_toy
          </span>
          <ModalTitle id={MODAL_LABEL_ID}>
            Run {agentDisplayName}
          </ModalTitle>
        </div>
      </ModalHeader>

      <ModalBody className="space-y-4">
        {/* CLI command block */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
              CLI Command
            </span>
            <button
              onClick={handleCopy}
              className="text-xs text-primary hover:text-primary-hover transition-colors duration-150 flex items-center gap-1"
              aria-label="Copy CLI command to clipboard"
            >
              <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
                {copied ? 'check' : 'content_copy'}
              </span>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="bg-surface-variant border border-border rounded-md p-3 text-xs font-mono text-text-primary overflow-x-auto whitespace-pre-wrap break-all">
            {preparedRun.cliCommand}
          </pre>
        </div>

        {/* Prompt section */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                Prompt Preview
              </span>
              {editMode && (
                <span className="text-xs text-warning font-medium">Edited</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Token badge */}
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/[0.12] text-primary">
                {tokenLabel}
              </span>
              {/* Collapse/expand toggle — only shown in read mode */}
              {!editMode && (
                <button
                  onClick={() => setCollapsed((v) => !v)}
                  className="text-xs text-text-secondary hover:text-primary transition-colors duration-150"
                  aria-label={collapsed ? 'Show full prompt' : 'Show preview only'}
                >
                  {collapsed ? 'Show full' : 'Collapse'}
                </button>
              )}
              <button
                onClick={handleToggleEdit}
                className="text-xs text-text-secondary hover:text-primary transition-colors duration-150"
                aria-label={editMode ? 'View read-only preview' : 'Edit prompt preview'}
              >
                {editMode ? 'Done editing' : 'Edit'}
              </button>
            </div>
          </div>

          {editMode ? (
            <textarea
              value={editedPrompt}
              onChange={(e) => setEditedPrompt(e.target.value)}
              rows={12}
              className="w-full bg-surface-variant border border-border rounded-md p-3 text-xs font-mono text-text-primary resize-none focus:outline-hidden focus:ring-1 focus:ring-primary/50"
              aria-label="Prompt preview (edit mode)"
            />
          ) : (
            <div
              className="bg-surface-variant border border-border rounded-md p-3 overflow-y-auto max-h-96"
              aria-label="Prompt preview"
            >
              <MarkdownViewer content={displayPrompt} />
            </div>
          )}

          {editMode && (
            <p className="text-[11px] text-text-disabled mt-1">
              Preview only — the full prompt is in the temp file.
            </p>
          )}
          {!editMode && collapsed && (
            <p className="text-[11px] text-text-disabled mt-1">
              Showing first 500 characters.{' '}
              <button
                onClick={() => setCollapsed(false)}
                className="underline hover:text-primary transition-colors"
              >
                Show full prompt
              </button>
            </p>
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleExecute}>
          <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
            play_arrow
          </span>
          Execute
        </Button>
      </ModalFooter>
    </Modal>
  );
}
