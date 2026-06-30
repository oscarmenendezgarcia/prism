/**
 * Space modal — handles both 'create' and 'rename' modes.
 * ADR-002: replaces #space-modal-overlay and the openSpaceModal() logic in spaces.js.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { DirectoryPicker } from '@/components/shared/DirectoryPicker';
import { useAppStore } from '@/stores/useAppStore';
import { localModelsToStageModelsMap } from '@/utils/modelRouting';

const SPACE_NAME_MAX    = 100;
const NICKNAME_MAX      = 50;
const TITLE_ID          = 'space-modal-title';

const DEFAULT_STAGES = ['senior-architect', 'ux-api-designer', 'developer-agent', 'qa-engineer-e2e'];

const NICKNAME_PLACEHOLDERS = ['e.g. The Architect', 'e.g. The Designer', 'e.g. The Builder', 'e.g. The Reviewer', 'e.g. The Tester'];

const inputClass =
  'w-full bg-surface border border-border rounded-lg px-4 py-3 text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-fast text-sm';

export function SpaceModal() {
  const spaceModal = useAppStore((s) => s.spaceModal);
  const closeModal = useAppStore((s) => s.closeSpaceModal);
  const createSpace = useAppStore((s) => s.createSpace);
  const renameSpace = useAppStore((s) => s.renameSpace);

  const [name, setName] = useState('');
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [pipeline, setPipeline] = useState<string[]>([]);
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [nicknamesOpen, setNicknamesOpen] = useState(false);
  const [nicknameErrors, setNicknameErrors] = useState<Record<string, string>>({});
  /** MODEL-1: per-stage model overrides for this space (agentId → model string). */
  const [localStageModels, setLocalStageModels] = useState<Record<string, string>>({});
  const [modelOverridesOpen, setModelOverridesOpen] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const isOpen = spaceModal?.open ?? false;
  const mode = spaceModal?.mode ?? 'create';
  const space = spaceModal?.space;

  // Stages shown in the nicknames section: the space's configured pipeline, or the defaults.
  const nicknameStages = (space?.pipeline && space.pipeline.length > 0)
    ? space.pipeline
    : DEFAULT_STAGES;

  // Pre-fill and reset on open
  useEffect(() => {
    if (isOpen) {
      setName(mode === 'rename' && space ? space.name : '');
      setWorkingDirectory(mode === 'rename' && space ? (space.workingDirectory ?? '') : '');
      setPipeline(mode === 'rename' && space ? (space.pipeline ?? []) : []);
      setNicknames(mode === 'rename' && space ? (space.agentNicknames ?? {}) : {});
      setNicknamesOpen(false);
      setNicknameErrors({});
      // MODEL-1: initialize model overrides from existing space config
      const existingModels: Record<string, string> = {};
      if (mode === 'rename' && space?.stageModels) {
        for (const [agentId, cfg] of Object.entries(space.stageModels)) {
          if (cfg !== null) existingModels[agentId] = cfg.model;
        }
      }
      setLocalStageModels(existingModels);
      setModelOverridesOpen(false);
      setError('');
      setSubmitting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, mode, space]);

  function validateNicknames(): boolean {
    const errors: Record<string, string> = {};
    for (const [agentId, value] of Object.entries(nicknames)) {
      const trimmed = value.trim();
      if (trimmed.length > NICKNAME_MAX) {
        errors[agentId] = `Max ${NICKNAME_MAX} characters`;
      }
    }
    setNicknameErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Space name is required.');
      inputRef.current?.focus();
      return;
    }
    if (trimmed.length > SPACE_NAME_MAX) {
      setError(`Name must not exceed ${SPACE_NAME_MAX} characters.`);
      return;
    }

    if (!validateNicknames()) return;

    const wd = workingDirectory.trim() || undefined;
    const pl = pipeline.length > 0 ? pipeline : undefined;
    setSubmitting(true);
    try {
      if (mode === 'create') {
        await createSpace(trimmed, wd, pl);
        closeModal();
      } else if (mode === 'rename' && space) {
        const stageModels = localModelsToStageModelsMap(localStageModels);
        await renameSpace(space.id, trimmed, wd ?? '', pl ?? [], nicknames, stageModels);
        closeModal();
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to save space');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={isOpen} onClose={closeModal} labelId={TITLE_ID}>
      <ModalHeader onClose={closeModal}>
        <ModalTitle id={TITLE_ID}>
          {mode === 'create' ? 'New Space' : 'Rename Space'}
        </ModalTitle>
      </ModalHeader>

      <ModalBody className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          {mode === 'create'
            ? 'Give your space a name to organize your tasks.'
            : 'Enter a new name for this space.'}
        </p>

        <div>
          <label htmlFor="space-name-input" className="block text-sm font-medium text-text-primary mb-1.5">
            Space Name
          </label>
          <input
            id="space-name-input"
            ref={inputRef}
            className={`${inputClass} ${error ? 'border-error ring-1 ring-error' : ''}`}
            type="text"
            maxLength={SPACE_NAME_MAX}
            placeholder="e.g. Marketing, Dev, Sprint 1"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          {error && (
            <span className="text-xs text-error mt-1 block" role="alert">{error}</span>
          )}
        </div>

        <div>
          <label htmlFor="space-wd-input" className="block text-sm font-medium text-text-primary mb-1.5">
            Working Directory <span className="text-text-disabled font-normal">(optional)</span>
          </label>
          <div data-dir-picker-anchor className="flex gap-2 items-start">
            <input
              id="space-wd-input"
              className={`${inputClass} flex-1 min-w-0`}
              type="text"
              placeholder="e.g. /Users/me/projects/my-app"
              value={workingDirectory}
              onChange={(e) => setWorkingDirectory(e.target.value)}
              autoComplete="off"
              aria-describedby="space-wd-hint"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }}
            />
            <DirectoryPicker
              value={workingDirectory}
              onChange={(path) => setWorkingDirectory(path)}
              buttonLabel="Browse for working directory"
            />
          </div>
          <span id="space-wd-hint" className="text-xs text-text-disabled mt-1 block">
            Select a directory or type a path. Used when agents run tasks in this space.
          </span>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1.5">
            Pipeline Stages <span className="text-text-disabled font-normal">(optional — defaults to full pipeline)</span>
          </label>
          <div className="flex flex-col gap-2">
            {(pipeline.length > 0 ? pipeline : []).map((stage, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  className={`${inputClass} flex-1 h-10`}
                  value={stage}
                  onChange={(e) => {
                    const next = [...pipeline];
                    next[i] = e.target.value;
                    setPipeline(next);
                  }}
                >
                  {DEFAULT_STAGES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="text-text-secondary hover:text-error transition-colors px-2 py-1 text-sm"
                  onClick={() => setPipeline(pipeline.filter((_, j) => j !== i))}
                  aria-label="Remove stage"
                >
                  ✕
                </button>
              </div>
            ))}
            {pipeline.length < DEFAULT_STAGES.length && (
              <button
                type="button"
                className="text-sm text-primary hover:text-primary/80 text-left transition-colors"
                onClick={() => {
                  const used = new Set(pipeline);
                  const next = DEFAULT_STAGES.find((s) => !used.has(s));
                  if (next) setPipeline([...pipeline, next]);
                }}
              >
                + Add stage
              </button>
            )}
            {pipeline.length > 0 && (
              <button
                type="button"
                className="text-xs text-text-disabled hover:text-text-secondary text-left transition-colors"
                onClick={() => setPipeline([])}
              >
                Reset to default
              </button>
            )}
          </div>
          <span className="text-xs text-text-disabled mt-1 block">
            Override the default agent pipeline for tasks in this space.
          </span>
        </div>

        {/* Model Overrides — rename mode only (MODEL-1) */}
        {mode === 'rename' && (
          <div className="border border-border rounded-lg [contain:paint]">
            <button
              type="button"
              onClick={() => setModelOverridesOpen((prev) => !prev)}
              aria-expanded={modelOverridesOpen}
              aria-controls="space-model-overrides-body"
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary hover:bg-surface-variant rounded-t-lg transition-colors duration-fast"
            >
              <span className="flex items-center gap-2">
                Model Overrides
                <span className="text-text-disabled font-normal">(optional)</span>
                {Object.keys(localStageModels).length > 0 && (
                  <span
                    className="text-xs font-medium bg-primary/15 text-primary px-2 py-0.5 rounded-full"
                    aria-label={`${Object.keys(localStageModels).length} model overrides active`}
                  >
                    {Object.keys(localStageModels).length} override{Object.keys(localStageModels).length !== 1 ? 's' : ''}
                  </span>
                )}
              </span>
              <span
                className={`material-symbols-outlined text-base leading-none text-text-secondary transition-transform duration-fast ${modelOverridesOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              >
                expand_more
              </span>
            </button>

            {modelOverridesOpen && (
              <div id="space-model-overrides-body" className="px-4 pb-4 flex flex-col gap-3 border-t border-border pt-3">
                <p className="text-xs text-text-disabled">
                  Override global model settings for this space. Leave blank to inherit from global settings.
                </p>

                {(pipeline.length > 0 ? pipeline : DEFAULT_STAGES).map((agentId) => {
                  const currentValue = localStageModels[agentId] ?? '';
                  const hasOverride = agentId in localStageModels;
                  const inputId = `model-override-${agentId}`;
                  return (
                    <div key={agentId} className="flex flex-col gap-1">
                      <label htmlFor={inputId} className="block text-xs font-medium text-text-secondary">
                        <span className="font-mono text-text-disabled">{agentId}</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id={inputId}
                          type="text"
                          placeholder="(global default)"
                          value={currentValue}
                          onChange={(e) => {
                            setLocalStageModels((prev) => ({ ...prev, [agentId]: e.target.value }));
                          }}
                          className={`${inputClass} py-2 flex-1 font-mono text-sm ${!hasOverride || !currentValue ? 'italic text-text-disabled' : 'text-text-primary'}`}
                          autoComplete="off"
                          aria-label={`Model override for ${agentId}`}
                        />
                        {hasOverride && currentValue && (
                          <button
                            type="button"
                            onClick={() => {
                              setLocalStageModels((prev) => {
                                const next = { ...prev };
                                delete next[agentId];
                                return next;
                              });
                            }}
                            className="flex-shrink-0 text-text-secondary hover:text-error transition-colors px-2 py-1 text-sm"
                            aria-label={`Clear override for ${agentId}`}
                            title="Clear override"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {Object.keys(localStageModels).length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-text-disabled hover:text-text-secondary text-left transition-colors self-start"
                    onClick={() => setLocalStageModels({})}
                  >
                    Clear all overrides
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Agent Nicknames — rename mode only */}
        {mode === 'rename' && (
          <div className="border border-border rounded-lg [contain:paint]">
            <button
              type="button"
              onClick={() => setNicknamesOpen((prev) => !prev)}
              aria-expanded={nicknamesOpen}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary hover:bg-surface-variant rounded-t-lg transition-colors duration-fast"
            >
              <span>Agent Nicknames <span className="text-text-disabled font-normal">(optional)</span></span>
              <span
                className={`material-symbols-outlined text-base leading-none text-text-secondary transition-transform duration-fast ${nicknamesOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              >
                expand_more
              </span>
            </button>

            {nicknamesOpen && (
              <div className="px-4 pb-4 flex flex-col gap-3 border-t border-border pt-3">
                <p className="text-xs text-text-disabled">
                  Assign a custom display name to each agent in this space. Names appear in the run indicator, logs, and handoff messages.
                </p>

                {nicknameStages.map((agentId, i) => {
                  const inputId = `nickname-${agentId}`;
                  return (
                    <div key={agentId}>
                      <label htmlFor={inputId} className="block text-xs font-medium text-text-secondary mb-1">
                        <span className="font-mono text-text-disabled">{agentId}</span>
                      </label>
                      <input
                        id={inputId}
                        type="text"
                        maxLength={NICKNAME_MAX + 1}
                        placeholder={NICKNAME_PLACEHOLDERS[i % NICKNAME_PLACEHOLDERS.length]}
                        value={nicknames[agentId] ?? ''}
                        onChange={(e) => {
                          setNicknames((prev) => ({ ...prev, [agentId]: e.target.value }));
                          if (nicknameErrors[agentId]) {
                            setNicknameErrors((prev) => {
                              const next = { ...prev };
                              delete next[agentId];
                              return next;
                            });
                          }
                        }}
                        className={`${inputClass} py-2 ${nicknameErrors[agentId] ? 'border-error ring-1 ring-error' : ''}`}
                        autoComplete="off"
                      />
                      {nicknameErrors[agentId] && (
                        <span className="text-xs text-error mt-1 block" role="alert">
                          {nicknameErrors[agentId]}
                        </span>
                      )}
                    </div>
                  );
                })}

                <button
                  type="button"
                  className="text-xs text-text-disabled hover:text-text-secondary text-left transition-colors self-start"
                  onClick={() => {
                    setNicknames({});
                    setNicknameErrors({});
                  }}
                >
                  Clear all nicknames
                </button>
              </div>
            )}
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button type="button" variant="ghost" onClick={closeModal}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={submitting}
          onClick={handleSubmit}
        >
          {submitting ? 'Saving...' : mode === 'create' ? 'Create Space' : 'Save'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
