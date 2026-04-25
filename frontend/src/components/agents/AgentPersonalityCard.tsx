/**
 * AgentPersonalityCard — grid card for one agent + its personality.
 *
 * Displays:
 *   - Avatar emoji + display name
 *   - Color swatch stripe
 *   - Persona excerpt (≤120 chars)
 *   - MCP tool chips
 *   - Edit / Regenerate buttons
 *
 * When no personality is set, shows a "Set personality" CTA.
 */

import React, { useState, useCallback } from 'react';
import { Button } from '@/components/shared/Button';
import { AgentPersonalityEditor } from '@/components/agents/AgentPersonalityEditor';
import { useAgentPersonalityStore } from '@/stores/useAgentPersonalityStore';
import { useAppStore } from '@/stores/useAppStore';
import * as api from '@/api/client';
import type { AgentInfo, AgentPersonality, McpServer } from '@/types';

interface AgentPersonalityCardProps {
  agent: AgentInfo;
  personality: AgentPersonality | null;
  mcpServers: McpServer[];
}

export function AgentPersonalityCard({ agent, personality, mcpServers }: AgentPersonalityCardProps) {
  const generate   = useAgentPersonalityStore((s) => s.generate);
  const save       = useAgentPersonalityStore((s) => s.save);
  const generating = useAgentPersonalityStore((s) => s.generating[agent.id] ?? false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [proposal, setProposal]     = useState<Partial<AgentPersonality> | null>(null);
  const openMarkdownModal           = useAppStore((s) => s.openMarkdownModal);

  const handleViewPrompt = useCallback(async () => {
    const detail = await api.getAgent(agent.id);
    openMarkdownModal(
      agent.displayName,
      detail.content ?? '',
      agent.path,
    );
  }, [agent.id, agent.displayName, agent.path, openMarkdownModal]);

  const handleRegenerate = useCallback(async () => {
    try {
      const result = await generate(agent.id);
      // Automatically save the generated personality
      await save(agent.id, {
        ...result,
        source: 'generated',
        generatedAt: new Date().toISOString(),
      });
    } catch {
      // error already toasted
    }
  }, [agent.id, generate, save]);

  const handleEdit = useCallback(() => {
    setProposal(null);
    setEditorOpen(true);
  }, []);

  // ── No personality — show CTA card ──
  if (!personality) {
    return (
      <>
        <article
          className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-3"
          data-testid="agent-card-empty"
          aria-label={`${agent.displayName} — no personality set`}
        >
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-surface-variant flex items-center justify-center text-text-disabled text-lg select-none" aria-hidden="true">
              ?
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">{agent.displayName}</p>
              <p className="text-[10px] text-text-disabled font-mono">{agent.id}</p>
            </div>
          </div>

          <p className="text-xs text-text-secondary italic">No personality set yet.</p>

          <div className="flex gap-2 mt-auto flex-wrap">
            <Button variant="ghost" onClick={handleViewPrompt} className="text-xs">
              <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">description</span>
              View prompt
            </Button>
            <Button variant="primary" onClick={handleEdit} className="text-xs">
              <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">edit</span>
              Set personality
            </Button>
            <Button
              variant="secondary"
              onClick={handleRegenerate}
              disabled={generating}
              aria-busy={generating}
              className="text-xs"
            >
              {generating ? (
                <>
                  <span className="material-symbols-outlined text-sm leading-none animate-spin" aria-hidden="true">autorenew</span>
                  Generating…
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">auto_fix_high</span>
                  Generate
                </>
              )}
            </Button>
          </div>
        </article>

        {editorOpen && (
          <AgentPersonalityEditor
            agent={agent}
            personality={null}
            proposal={proposal}
            mcpServers={mcpServers}
            onClose={() => setEditorOpen(false)}
          />
        )}
      </>
    );
  }

  // ── Personality exists ──
  const personaExcerpt = personality.persona
    ? personality.persona.slice(0, 120) + (personality.persona.length > 120 ? '…' : '')
    : null;

  return (
    <>
      <article
        className="bg-surface border border-border rounded-xl overflow-hidden flex flex-col"
        style={{ borderLeftColor: personality.color, borderLeftWidth: '3px', borderLeftStyle: 'solid' }} // lint-ok: dynamic agent color stripe cannot be a Tailwind token
        data-testid="agent-card"
        aria-label={`${personality.displayName} — agent personality card`}
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-4 pb-2">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-lg select-none flex-shrink-0"
            style={{ backgroundColor: `${personality.color}20` }} // lint-ok: dynamic agent color with 12% alpha — no Tailwind token equivalent
            aria-hidden="true"
          >
            {personality.avatar || '🤖'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{personality.displayName}</p>
            <p className="text-[10px] text-text-disabled font-mono">{agent.id}</p>
          </div>
          {/* Color swatch */}
          <div
            className="w-5 h-5 rounded-md flex-shrink-0 mt-0.5"
            style={{ backgroundColor: personality.color }} // lint-ok: dynamic agent color swatch — one of 16 palette colors, no static token
            aria-label={`Color: ${personality.color}`}
            title={personality.color}
          />
        </div>

        {/* Persona excerpt */}
        {personaExcerpt && (
          <p className="px-4 pb-2 text-xs text-text-secondary leading-relaxed">
            {personaExcerpt}
          </p>
        )}

        {/* MCP tool chips */}
        {personality.mcpTools.length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap gap-1.5" aria-label="MCP tools">
            {personality.mcpTools.map((tool) => {
              const label = tool.replace('mcp__', '').replace('__*', '');
              return (
                <span
                  key={tool}
                  className="inline-flex items-center text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-surface-variant text-text-secondary"
                  title={tool}
                >
                  {label}
                </span>
              );
            })}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 px-4 pb-4 mt-auto flex-wrap">
          <Button variant="ghost" onClick={handleViewPrompt} className="text-xs">
            <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">description</span>
            View prompt
          </Button>
          <Button variant="secondary" onClick={handleEdit} className="text-xs flex-1">
            <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">edit</span>
            Edit
          </Button>
          <Button
            variant="ghost"
            onClick={handleRegenerate}
            disabled={generating}
            aria-busy={generating}
            className="text-xs flex-1"
          >
            {generating ? (
              <>
                <span className="material-symbols-outlined text-sm leading-none animate-spin" aria-hidden="true">autorenew</span>
                Generating…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">auto_fix_high</span>
                Regenerate
              </>
            )}
          </Button>
        </div>
      </article>

      {editorOpen && (
        <AgentPersonalityEditor
          agent={agent}
          personality={personality}
          proposal={null}
          mcpServers={mcpServers}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </>
  );
}
