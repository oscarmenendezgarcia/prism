/**
 * McpToolPicker — multi-select checklist for MCP tool server prefixes.
 * ADR-1 (agent-personalities): shows discovered servers from mcpDiscovery.
 */

import React from 'react';
import type { McpServer } from '@/types';

interface McpToolPickerProps {
  servers: McpServer[];
  selected: string[];
  onChange: (tools: string[]) => void;
  disabled?: boolean;
}

export function McpToolPicker({ servers, selected, onChange, disabled = false }: McpToolPickerProps) {
  // Always include mcp__prism__* in the list even if discovery didn't return it
  const allServers: McpServer[] = servers.some((s) => s.toolPrefix === 'mcp__prism__*')
    ? servers
    : [{ id: 'prism', source: 'built-in', toolPrefix: 'mcp__prism__*', description: 'Kanban, tasks, pipeline operations' }, ...servers];

  function toggle(toolPrefix: string) {
    if (toolPrefix === 'mcp__prism__*') return; // always required
    if (selected.includes(toolPrefix)) {
      onChange(selected.filter((t) => t !== toolPrefix));
    } else {
      onChange([...selected, toolPrefix]);
    }
  }

  if (allServers.length === 0) {
    return (
      <p className="text-xs text-text-disabled italic">
        No MCP servers discovered. mcp__prism__* is always available.
      </p>
    );
  }

  return (
    <div className="space-y-1.5" role="group" aria-label="MCP tool access">
      {allServers.map((server) => {
        const isPrism   = server.toolPrefix === 'mcp__prism__*';
        const isChecked = selected.includes(server.toolPrefix) || isPrism;
        return (
          <label
            key={server.toolPrefix}
            className={[
              'flex items-start gap-2.5 py-1.5 px-2 rounded-md cursor-pointer',
              'transition-colors duration-fast',
              isPrism
                ? 'opacity-60 cursor-not-allowed'
                : 'hover:bg-surface-variant',
            ].filter(Boolean).join(' ')}
          >
            <input
              type="checkbox"
              checked={isChecked}
              disabled={disabled || isPrism}
              onChange={() => toggle(server.toolPrefix)}
              className="mt-0.5 accent-primary w-3.5 h-3.5 flex-shrink-0"
            />
            <div className="min-w-0">
              <span className="text-xs font-mono text-text-primary block truncate">
                {server.toolPrefix}
              </span>
              {server.description && (
                <span className="text-[10px] text-text-secondary">{server.description}</span>
              )}
              {isPrism && (
                <span className="text-[10px] text-text-disabled">(always required)</span>
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
}
