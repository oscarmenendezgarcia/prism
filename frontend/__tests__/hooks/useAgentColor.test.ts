/**
 * Unit tests for the useAgentColor hook.
 *
 * Tests that the hook returns the correct personality fields when an agent has
 * a personality registered in useAgentPersonalityStore, and returns undefined
 * fields when the agent is unknown / unassigned.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAgentPersonalityStore } from '../../src/stores/useAgentPersonalityStore';
import { useAgentColor } from '../../src/hooks/useAgentColor';
import type { AgentPersonality } from '../../src/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ARCHITECT_PERSONALITY: AgentPersonality = {
  agentId: 'senior-architect',
  displayName: 'The Architect',
  color: '#7C3AED',
  persona: 'Calm and precise.',
  mcpTools: ['mcp__prism__*'],
  avatar: '🏛️',
  source: 'generated',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function resetStore(personalities: Record<string, AgentPersonality> = {}) {
  useAgentPersonalityStore.setState({
    personalities,
    loading: false,
    generating: {},
    mcpServers: [],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAgentColor', () => {
  beforeEach(() => {
    resetStore();
  });

  it('returns all undefined fields when agentId is null', () => {
    const { result } = renderHook(() => useAgentColor(null));
    expect(result.current.color).toBeUndefined();
    expect(result.current.displayName).toBeUndefined();
    expect(result.current.persona).toBeUndefined();
    expect(result.current.avatar).toBeUndefined();
  });

  it('returns all undefined fields when agentId is undefined', () => {
    const { result } = renderHook(() => useAgentColor(undefined));
    expect(result.current.color).toBeUndefined();
    expect(result.current.displayName).toBeUndefined();
  });

  it('returns all undefined fields when agentId has no personality registered', () => {
    const { result } = renderHook(() => useAgentColor('unknown-agent'));
    expect(result.current.color).toBeUndefined();
    expect(result.current.displayName).toBeUndefined();
    expect(result.current.persona).toBeUndefined();
    expect(result.current.avatar).toBeUndefined();
  });

  it('returns correct color when personality exists', () => {
    resetStore({ 'senior-architect': ARCHITECT_PERSONALITY });
    const { result } = renderHook(() => useAgentColor('senior-architect'));
    expect(result.current.color).toBe('#7C3AED');
  });

  it('returns correct displayName when personality exists', () => {
    resetStore({ 'senior-architect': ARCHITECT_PERSONALITY });
    const { result } = renderHook(() => useAgentColor('senior-architect'));
    expect(result.current.displayName).toBe('The Architect');
  });

  it('returns correct persona when personality exists', () => {
    resetStore({ 'senior-architect': ARCHITECT_PERSONALITY });
    const { result } = renderHook(() => useAgentColor('senior-architect'));
    expect(result.current.persona).toBe('Calm and precise.');
  });

  it('returns correct avatar when personality exists', () => {
    resetStore({ 'senior-architect': ARCHITECT_PERSONALITY });
    const { result } = renderHook(() => useAgentColor('senior-architect'));
    expect(result.current.avatar).toBe('🏛️');
  });

  it('returns undefined for an agentId that is NOT in the store even when other agents are', () => {
    resetStore({ 'senior-architect': ARCHITECT_PERSONALITY });
    const { result } = renderHook(() => useAgentColor('developer-agent'));
    expect(result.current.color).toBeUndefined();
    expect(result.current.displayName).toBeUndefined();
  });

  it('updates when a personality is added to the store', () => {
    const { result, rerender } = renderHook(() => useAgentColor('senior-architect'));
    expect(result.current.color).toBeUndefined();

    // Add personality to store
    useAgentPersonalityStore.setState((s) => ({
      personalities: { ...s.personalities, 'senior-architect': ARCHITECT_PERSONALITY },
    }));

    rerender();
    expect(result.current.color).toBe('#7C3AED');
  });

  it('updates when a personality is removed from the store', () => {
    resetStore({ 'senior-architect': ARCHITECT_PERSONALITY });
    const { result, rerender } = renderHook(() => useAgentColor('senior-architect'));
    expect(result.current.color).toBe('#7C3AED');

    // Remove personality from store
    useAgentPersonalityStore.setState(() => ({ personalities: {} }));

    rerender();
    expect(result.current.color).toBeUndefined();
  });
});
