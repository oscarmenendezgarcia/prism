/**
 * AgentPersonalityEditor — modal/drawer for editing an agent personality.
 *
 * Features:
 *   - Display name input (1-60 chars)
 *   - 16-swatch ColorPicker
 *   - Persona textarea with character counter (red >600)
 *   - McpToolPicker for tool access
 *   - Avatar emoji input
 *   - Regenerate button with optional hint
 *   - Save / Cancel
 *   - Keyboard: Esc closes, Tab cycles fields
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { ColorPicker, CURATED_PALETTE } from '@/components/agents/ColorPicker';
import { McpToolPicker } from '@/components/agents/McpToolPicker';
import { useAgentPersonalityStore } from '@/stores/useAgentPersonalityStore';
import type { AgentPersonality, AgentInfo, McpServer } from '@/types';

const PERSONA_MAX = 600;
const DISPLAY_NAME_MAX = 60;
const DEFAULT_COLOR = CURATED_PALETTE[0];

interface AgentPersonalityEditorProps {
  agent: AgentInfo;
  /** Existing personality (null = creating a new one). */
  personality: AgentPersonality | null;
  /** Pre-populated proposal (e.g. from onboarding generate). */
  proposal?: Partial<AgentPersonality> | null;
  mcpServers: McpServer[];
  onClose: () => void;
  /** Called after a successful save. */
  onSaved?: (saved: AgentPersonality) => void;
}

export function AgentPersonalityEditor({
  agent,
  personality,
  proposal,
  mcpServers,
  onClose,
  onSaved,
}: AgentPersonalityEditorProps) {
  const save       = useAgentPersonalityStore((s) => s.save);
  const generate   = useAgentPersonalityStore((s) => s.generate);
  const generating = useAgentPersonalityStore((s) => s.generating[agent.id] ?? false);

  // ── Form state ──
  const initial = proposal ?? personality;
  const [displayName, setDisplayName] = useState(initial?.displayName ?? agent.displayName);
  const [color, setColor]             = useState(initial?.color ?? DEFAULT_COLOR);
  const [persona, setPersona]         = useState(initial?.persona ?? '');
  const [mcpTools, setMcpTools]       = useState<string[]>(
    initial?.mcpTools ?? ['mcp__prism__*'],
  );
  const [avatar, setAvatar]           = useState(initial?.avatar ?? '');
  const [hint, setHint]               = useState('');
  const [saving, setSaving]           = useState(false);
  const [hintOpen, setHintOpen]       = useState(false);

  // Reset form when proposal changes (e.g. after a new generate)
  useEffect(() => {
    if (proposal) {
      if (proposal.displayName) setDisplayName(proposal.displayName);
      if (proposal.color)       setColor(proposal.color);
      if (proposal.persona)     setPersona(proposal.persona);
      if (proposal.mcpTools)    setMcpTools(proposal.mcpTools);
      if (proposal.avatar)      setAvatar(proposal.avatar ?? '');
    }
  }, [proposal]);

  // ── Validation ──
  const displayNameTrimmed = displayName.trim();
  const personaLen         = persona.length;
  const isValid =
    displayNameTrimmed.length >= 1 &&
    displayNameTrimmed.length <= DISPLAY_NAME_MAX &&
    personaLen <= PERSONA_MAX &&
    !!color;

  // ── Handlers ──
  const handleSave = useCallback(async () => {
    if (!isValid || saving) return;
    setSaving(true);
    try {
      await save(agent.id, {
        displayName: displayNameTrimmed,
        color,
        persona,
        mcpTools,
        avatar: avatar.trim() || undefined,
        source: 'manual',
      });
      const saved: AgentPersonality = {
        agentId: agent.id,
        displayName: displayNameTrimmed,
        color,
        persona,
        mcpTools,
        avatar: avatar.trim() || undefined,
        source: 'manual',
        updatedAt: new Date().toISOString(),
      };
      onSaved?.(saved);
      onClose();
    } catch {
      // error already toasted by the store
    } finally {
      setSaving(false);
    }
  }, [agent.id, isValid, saving, displayNameTrimmed, color, persona, mcpTools, avatar, save, onSaved, onClose]);

  const handleRegenerate = useCallback(async () => {
    try {
      const proposal = await generate(agent.id, hint || undefined);
      // Update form fields with the proposal
      setDisplayName(proposal.displayName);
      setColor(proposal.color);
      setPersona(proposal.persona);
      setMcpTools(proposal.mcpTools);
      if (proposal.avatar) setAvatar(proposal.avatar);
      setHintOpen(false);
      setHint('');
    } catch {
      // error already toasted by the store
    }
  }, [agent.id, generate, hint]);

  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  return (
    <Modal open onClose={onClose}>
      <ModalHeader onClose={onClose}>
        <ModalTitle>Edit Personality — {agent.displayName}</ModalTitle>
      </ModalHeader>

      <ModalBody>
        <div className="flex flex-col gap-5">

          <div>
            <label htmlFor="ap-display-name" className="text-xs font-medium text-text-secondary block mb-1.5">
              Display Name <span className="text-error" aria-hidden="true">*</span>
            </label>
            <input
              id="ap-display-name"
              ref={firstInputRef}
              type="text"
              maxLength={DISPLAY_NAME_MAX}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={saving || generating}
              placeholder={agent.displayName}
              className={[
                'w-full bg-surface border rounded-lg px-3 py-2 text-sm text-text-primary',
                'focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/40',
                'disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-fast',
                displayNameTrimmed.length === 0 || displayNameTrimmed.length > DISPLAY_NAME_MAX
                  ? 'border-error'
                  : 'border-border',
              ].join(' ')}
              aria-describedby="ap-display-name-count"
            />
            <p id="ap-display-name-count" className="text-[10px] text-text-disabled mt-1 text-right">
              {displayNameTrimmed.length}/{DISPLAY_NAME_MAX}
            </p>
          </div>

          <div>
            <label htmlFor="ap-avatar" className="text-xs font-medium text-text-secondary block mb-1.5">
              Avatar <span className="text-text-disabled font-normal">(optional emoji or initials)</span>
            </label>
            <input
              id="ap-avatar"
              type="text"
              value={avatar}
              onChange={(e) => setAvatar(e.target.value.slice(0, 4))}
              disabled={saving || generating}
              placeholder="🤖"
              maxLength={4}
              className="w-20 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-fast"
              aria-label="Avatar emoji or initials"
            />
          </div>

          <div>
            <p className="text-xs font-medium text-text-secondary mb-2">
              Color <span className="text-error" aria-hidden="true">*</span>
            </p>
            <ColorPicker value={color} onChange={setColor} disabled={saving || generating} />
            <p className="text-[10px] text-text-disabled mt-1 font-mono">{color}</p>
          </div>

          <div>
            <label htmlFor="ap-persona" className="text-xs font-medium text-text-secondary block mb-1.5">
              Persona <span className="text-text-disabled font-normal">(injected into pipeline prompts)</span>
            </label>
            <textarea
              id="ap-persona"
              rows={5}
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              disabled={saving || generating}
              placeholder="Describe this agent's tone, style, and working philosophy…"
              className={[
                'w-full bg-surface border rounded-lg px-3 py-2 text-sm text-text-primary',
                'resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/40',
                'disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-fast',
                personaLen > PERSONA_MAX ? 'border-error' : 'border-border',
              ].join(' ')}
              aria-describedby="ap-persona-count"
            />
            <p
              id="ap-persona-count"
              className={`text-[10px] mt-1 text-right ${personaLen > PERSONA_MAX ? 'text-error font-medium' : 'text-text-disabled'}`}
            >
              {personaLen}/{PERSONA_MAX}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-text-secondary mb-2">
              MCP Tool Access
              <span className="ml-1 text-text-disabled font-normal">(which servers this agent can call)</span>
            </p>
            <div className="bg-surface border border-border rounded-lg px-3 py-2 max-h-44 overflow-y-auto">
              <McpToolPicker
                servers={mcpServers}
                selected={mcpTools}
                onChange={setMcpTools}
                disabled={saving || generating}
              />
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="secondary"
                onClick={hintOpen ? handleRegenerate : () => setHintOpen(true)}
                disabled={saving || generating}
                aria-busy={generating}
              >
                {generating ? (
                  <>
                    <span className="material-symbols-outlined text-sm leading-none animate-spin" aria-hidden="true">autorenew</span>
                    Generating…
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">auto_fix_high</span>
                    {hintOpen ? 'Generate with hint' : 'Regenerate'}
                  </>
                )}
              </Button>
              {hintOpen && !generating && (
                <Button variant="ghost" onClick={() => setHintOpen(false)}>Cancel hint</Button>
              )}
            </div>
            {hintOpen && (
              <div className="mt-2">
                <input
                  type="text"
                  value={hint}
                  onChange={(e) => setHint(e.target.value.slice(0, 200))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleRegenerate(); }}
                  placeholder="Style hint — e.g. 'more direct, less verbose'"
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/40 transition-all duration-fast"
                  aria-label="Generation hint"
                  disabled={generating}
                />
              </div>
            )}
          </div>

        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={!isValid || saving || generating}
          aria-busy={saving}
        >
          {saving ? (
            <>
              <span className="material-symbols-outlined text-sm leading-none animate-spin" aria-hidden="true">autorenew</span>
              Saving…
            </>
          ) : 'Save'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
