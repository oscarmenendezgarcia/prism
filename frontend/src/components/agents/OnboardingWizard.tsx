/**
 * OnboardingWizard — sequential first-run personality generation flow.
 *
 * Shown when:
 *   - personalities map is empty (no saved personalities yet)
 *   - localStorage flag `prism.onboarding.agents.dismissed` is NOT set
 *
 * Flow per agent:
 *   1. Generate proposal via LLM  (automatic)
 *   2. Show proposal for review
 *   3. User can Edit, Skip, or Save & Next
 *
 * On finish or Skip All: sets the dismissed localStorage flag.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/shared/Button';
import { AgentPersonalityEditor } from '@/components/agents/AgentPersonalityEditor';
import { useAgentPersonalityStore } from '@/stores/useAgentPersonalityStore';
import { CURATED_PALETTE } from '@/components/agents/ColorPicker';
import type { AgentInfo, AgentPersonality, McpServer } from '@/types';

export const ONBOARDING_DISMISSED_KEY = 'prism.onboarding.agents.dismissed';

interface OnboardingWizardProps {
  agents: AgentInfo[];
  mcpServers: McpServer[];
  onDismiss: () => void;
}

type StepState =
  | { phase: 'generating' }
  | { phase: 'review'; proposal: Partial<AgentPersonality> }
  | { phase: 'editing'; proposal: Partial<AgentPersonality> }
  | { phase: 'error'; message: string };

export function OnboardingWizard({ agents, mcpServers, onDismiss }: OnboardingWizardProps) {
  const generate   = useAgentPersonalityStore((s) => s.generate);
  const save       = useAgentPersonalityStore((s) => s.save);

  const [stepIndex, setStepIndex] = useState(0);
  const [stepState, setStepState] = useState<StepState>({ phase: 'generating' });

  const currentAgent = agents[stepIndex];
  const totalAgents  = agents.length;
  const isLastAgent  = stepIndex === totalAgents - 1;

  // Generate proposal for the current agent
  const runGenerate = useCallback(async (agentId: string) => {
    setStepState({ phase: 'generating' });
    try {
      const proposal = await generate(agentId);
      setStepState({ phase: 'review', proposal });
    } catch (err) {
      setStepState({
        phase: 'error',
        message: (err as Error).message || 'Generation failed. You can skip or try again.',
      });
    }
  }, [generate]);

  // Start generation when step changes
  useEffect(() => {
    if (currentAgent) {
      runGenerate(currentAgent.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  const dismiss = useCallback(() => {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
    onDismiss();
  }, [onDismiss]);

  const handleSaveAndNext = useCallback(async () => {
    if (stepState.phase !== 'review' && stepState.phase !== 'editing') return;
    const proposal = stepState.proposal;
    if (!proposal || !currentAgent) return;

    try {
      await save(currentAgent.id, {
        displayName: proposal.displayName ?? currentAgent.displayName,
        color: proposal.color ?? CURATED_PALETTE[0],
        persona: proposal.persona ?? '',
        mcpTools: proposal.mcpTools ?? ['mcp__prism__*'],
        avatar: proposal.avatar,
        source: 'generated',
        generatedAt: new Date().toISOString(),
      });
    } catch {
      // toast already shown by store
    }

    if (isLastAgent) {
      dismiss();
    } else {
      setStepIndex((i) => i + 1);
    }
  }, [stepState, currentAgent, save, isLastAgent, dismiss]);

  const handleSkip = useCallback(() => {
    if (isLastAgent) {
      dismiss();
    } else {
      setStepIndex((i) => i + 1);
    }
  }, [isLastAgent, dismiss]);

  const handleBack = useCallback(() => {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  }, [stepIndex]);

  const handleEdit = useCallback(() => {
    if (stepState.phase === 'review') {
      setStepState({ phase: 'editing', proposal: stepState.proposal });
    }
  }, [stepState]);

  if (!currentAgent) return null;

  // Progress bar percentage
  const progress = Math.round(((stepIndex) / totalAgents) * 100);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Agent Personality Onboarding"
    >
      <div className="bg-surface rounded-2xl border border-border shadow-2xl w-full max-w-lg flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Set Up Agent Personalities</h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Step {stepIndex + 1} of {totalAgents} — {currentAgent.displayName}
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Skip onboarding"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:bg-surface-variant hover:text-text-primary transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">close</span>
          </button>
        </div>

        {/* Progress bar */}
        <div
          className="h-1 bg-surface-variant"
          role="progressbar"
          aria-label={`Onboarding progress`}
          aria-valuenow={stepIndex}
          aria-valuemin={0}
          aria-valuemax={totalAgents}
        >
          <div
            className="h-full bg-primary transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }} // lint-ok: dynamic percentage for progress bar — cannot be a static Tailwind width
          />
        </div>

        {/* Content */}
        <div className="px-6 py-5 flex-1 overflow-y-auto" aria-live="polite">
          {stepState.phase === 'generating' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <span
                className="material-symbols-outlined text-4xl text-primary animate-spin"
                role="status"
                aria-label={`Generating personality for ${currentAgent.displayName}`}
              >
                autorenew
              </span>
              <p className="text-sm text-text-secondary">
                Generating personality for <span className="font-medium text-text-primary">{currentAgent.displayName}</span>…
              </p>
            </div>
          )}

          {stepState.phase === 'error' && (
            <div className="flex flex-col gap-3 py-4">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-error/10 text-error">
                <span className="material-symbols-outlined text-lg leading-none flex-shrink-0 mt-0.5" aria-hidden="true">error</span>
                <p className="text-xs">{stepState.message}</p>
              </div>
              <Button variant="secondary" onClick={() => runGenerate(currentAgent.id)}>
                <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">refresh</span>
                Try Again
              </Button>
            </div>
          )}

          {(stepState.phase === 'review' || stepState.phase === 'editing') && (
            <div className="flex flex-col gap-4">
              {/* Proposal preview card */}
              {stepState.proposal && (
                <div
                  className="rounded-xl border overflow-hidden"
                  style={{ borderLeftColor: stepState.proposal.color ?? CURATED_PALETTE[0], borderLeftWidth: '4px', borderLeftStyle: 'solid' }} // lint-ok: dynamic agent color stripe cannot be a Tailwind token
                >
                  <div className="flex items-center gap-3 p-4 pb-2">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-xl select-none"
                      style={{ backgroundColor: `${stepState.proposal.color ?? CURATED_PALETTE[0]}20` }} // lint-ok: dynamic agent color with alpha — no Tailwind token equivalent
                      aria-hidden="true"
                    >
                      {stepState.proposal.avatar || '🤖'}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-text-primary">
                        {stepState.proposal.displayName ?? currentAgent.displayName}
                      </p>
                      <p className="text-[10px] text-text-disabled font-mono">{currentAgent.id}</p>
                    </div>
                    <div
                      className="ml-auto w-4 h-4 rounded-full flex-shrink-0"
                      style={{ backgroundColor: stepState.proposal.color ?? CURATED_PALETTE[0] }} // lint-ok: dynamic palette swatch color — no static token
                      aria-label={`Color: ${stepState.proposal.color ?? CURATED_PALETTE[0]}`}
                    />
                  </div>
                  {stepState.proposal.persona && (
                    <p className="px-4 pb-3 text-xs text-text-secondary leading-relaxed">
                      {stepState.proposal.persona.slice(0, 200)}
                      {(stepState.proposal.persona.length ?? 0) > 200 ? '…' : ''}
                    </p>
                  )}
                  {stepState.proposal.mcpTools && stepState.proposal.mcpTools.length > 0 && (
                    <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                      {stepState.proposal.mcpTools.map((tool) => (
                        <span key={tool} className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-surface-variant text-text-secondary">
                          {tool.replace('mcp__', '').replace('__*', '')}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={handleEdit}
                className="text-xs text-primary hover:text-primary-hover underline text-left transition-colors duration-fast"
              >
                Edit this proposal before saving
              </button>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={handleBack}
              disabled={stepIndex === 0 || stepState.phase === 'generating'}
            >
              <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">arrow_back</span>
              Back
            </Button>
            <Button variant="ghost" onClick={handleSkip} disabled={stepState.phase === 'generating'}>
              Skip
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={dismiss} className="text-text-secondary text-xs">
              Skip All
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveAndNext}
              disabled={stepState.phase === 'generating' || stepState.phase === 'error'}
            >
              {isLastAgent ? 'Finish' : 'Save & Next'}
              <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
                {isLastAgent ? 'check' : 'arrow_forward'}
              </span>
            </Button>
          </div>
        </div>
      </div>

      {/* Inline editor overlay — shown when user clicks "Edit this proposal" */}
      {stepState.phase === 'editing' && (
        <AgentPersonalityEditor
          agent={currentAgent}
          personality={null}
          proposal={stepState.proposal}
          mcpServers={mcpServers}
          onClose={() => {
            if (stepState.phase === 'editing') {
              setStepState({ phase: 'review', proposal: stepState.proposal });
            }
          }}
          onSaved={(saved) => {
            // Update local proposal state so the wizard card shows the edited version
            setStepState({ phase: 'review', proposal: saved });
          }}
        />
      )}
    </div>
  );
}
