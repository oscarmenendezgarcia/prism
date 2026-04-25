/**
 * Unit tests for AgentPersonalityCard.
 *
 * Covers:
 *  - Empty state (no personality): shows CTA card with "Set personality" + "Generate" buttons
 *  - Personality state: shows display name, persona excerpt, MCP chip, Edit/Regenerate buttons
 *  - "Edit" opens the AgentPersonalityEditor modal
 *  - Generating state disables Generate/Regenerate button and shows spinner label
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentPersonalityCard } from '../../src/components/agents/AgentPersonalityCard';
import { useAgentPersonalityStore } from '../../src/stores/useAgentPersonalityStore';
import type { AgentInfo, AgentPersonality } from '../../src/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the AgentPersonalityEditor to avoid rendering the full modal tree in these unit tests.
vi.mock('../../src/components/agents/AgentPersonalityEditor', () => ({
  AgentPersonalityEditor: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="editor-modal">
      <button onClick={onClose}>Close editor</button>
    </div>
  ),
}));

vi.mock('../../src/api/client', () => ({
  listAgentPersonalities: vi.fn().mockResolvedValue([]),
  upsertAgentPersonality: vi.fn().mockResolvedValue({}),
  deleteAgentPersonality: vi.fn().mockResolvedValue(undefined),
  generateAgentPersonality: vi.fn().mockResolvedValue({}),
  discoverMcpTools: vi.fn().mockResolvedValue({ servers: [] }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENT: AgentInfo = {
  id: 'senior-architect',
  displayName: 'Senior Architect',
  filePath: '/path/to/senior-architect.md',
};

const PERSONALITY: AgentPersonality = {
  agentId: 'senior-architect',
  displayName: 'The Architect',
  color: '#7C3AED',
  persona: 'Calm, precise, and systematic. Focuses on long-term architecture decisions.',
  mcpTools: ['mcp__prism__*', 'mcp__plugin_playwright__*'],
  avatar: '🏛️',
  source: 'generated',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Store reset
// ---------------------------------------------------------------------------

function resetStore(overrides: Partial<ReturnType<typeof useAgentPersonalityStore.getState>> = {}) {
  useAgentPersonalityStore.setState({
    personalities: {},
    loading: false,
    generating: {},
    mcpServers: [],
    ...overrides,
  });
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('AgentPersonalityCard — empty state (no personality)', () => {
  it('renders agent-card-empty testid', () => {
    render(<AgentPersonalityCard agent={AGENT} personality={null} mcpServers={[]} />);
    expect(screen.getByTestId('agent-card-empty')).toBeInTheDocument();
  });

  it('shows agent display name and id', () => {
    render(<AgentPersonalityCard agent={AGENT} personality={null} mcpServers={[]} />);
    expect(screen.getByText('Senior Architect')).toBeInTheDocument();
    expect(screen.getByText('senior-architect')).toBeInTheDocument();
  });

  it('shows "No personality set yet." text', () => {
    render(<AgentPersonalityCard agent={AGENT} personality={null} mcpServers={[]} />);
    expect(screen.getByText('No personality set yet.')).toBeInTheDocument();
  });

  it('shows "Set personality" button', () => {
    render(<AgentPersonalityCard agent={AGENT} personality={null} mcpServers={[]} />);
    expect(screen.getByText('Set personality')).toBeInTheDocument();
  });

  it('shows "Generate" button', () => {
    render(<AgentPersonalityCard agent={AGENT} personality={null} mcpServers={[]} />);
    expect(screen.getByText('Generate')).toBeInTheDocument();
  });

  it('opens editor modal when "Set personality" is clicked', () => {
    render(<AgentPersonalityCard agent={AGENT} personality={null} mcpServers={[]} />);
    fireEvent.click(screen.getByText('Set personality'));
    expect(screen.getByTestId('editor-modal')).toBeInTheDocument();
  });

  it('closes editor modal when onClose is called', () => {
    render(<AgentPersonalityCard agent={AGENT} personality={null} mcpServers={[]} />);
    fireEvent.click(screen.getByText('Set personality'));
    expect(screen.getByTestId('editor-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close editor'));
    expect(screen.queryByTestId('editor-modal')).not.toBeInTheDocument();
  });

  it('disables Generate button and shows Generating… when generating=true', () => {
    resetStore({ generating: { 'senior-architect': true } });
    render(<AgentPersonalityCard agent={AGENT} personality={null} mcpServers={[]} />);
    expect(screen.getByText('Generating…')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /Generating…/i });
    expect(btn).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Personality state
// ---------------------------------------------------------------------------

describe('AgentPersonalityCard — personality exists', () => {
  it('renders agent-card testid (not agent-card-empty)', () => {
    render(<AgentPersonalityCard agent={AGENT} personality={PERSONALITY} mcpServers={[]} />);
    expect(screen.getByTestId('agent-card')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-card-empty')).not.toBeInTheDocument();
  });

  it('shows personality displayName', () => {
    render(<AgentPersonalityCard agent={AGENT} personality={PERSONALITY} mcpServers={[]} />);
    expect(screen.getByText('The Architect')).toBeInTheDocument();
  });

  it('shows agent id in mono', () => {
    render(<AgentPersonalityCard agent={AGENT} personality={PERSONALITY} mcpServers={[]} />);
    expect(screen.getByText('senior-architect')).toBeInTheDocument();
  });

  it('shows persona excerpt', () => {
    render(<AgentPersonalityCard agent={AGENT} personality={PERSONALITY} mcpServers={[]} />);
    expect(screen.getByText(/Calm, precise/i)).toBeInTheDocument();
  });

  it('truncates persona to 120 chars with ellipsis', () => {
    const longPersona = 'A'.repeat(130);
    render(<AgentPersonalityCard agent={AGENT} personality={{ ...PERSONALITY, persona: longPersona }} mcpServers={[]} />);
    const excerptEl = screen.getByText(/A+…/);
    expect(excerptEl.textContent).toHaveLength(121); // 120 + '…'
  });

  it('shows MCP tool chips', () => {
    render(<AgentPersonalityCard agent={AGENT} personality={PERSONALITY} mcpServers={[]} />);
    // The label is the tool without mcp__ and __* wrappers
    expect(screen.getByText('prism')).toBeInTheDocument();
    expect(screen.getByText('plugin_playwright')).toBeInTheDocument();
  });

  it('shows avatar emoji', () => {
    render(<AgentPersonalityCard agent={AGENT} personality={PERSONALITY} mcpServers={[]} />);
    expect(screen.getByText('🏛️')).toBeInTheDocument();
  });

  it('shows Edit and Regenerate buttons', () => {
    render(<AgentPersonalityCard agent={AGENT} personality={PERSONALITY} mcpServers={[]} />);
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Regenerate')).toBeInTheDocument();
  });

  it('opens editor modal when Edit is clicked', () => {
    render(<AgentPersonalityCard agent={AGENT} personality={PERSONALITY} mcpServers={[]} />);
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByTestId('editor-modal')).toBeInTheDocument();
  });

  it('disables Regenerate button when generating=true', () => {
    resetStore({ generating: { 'senior-architect': true } });
    render(<AgentPersonalityCard agent={AGENT} personality={PERSONALITY} mcpServers={[]} />);
    expect(screen.getByText('Generating…')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /Generating…/i });
    expect(btn).toBeDisabled();
  });

  it('does not show persona section when persona is empty', () => {
    render(<AgentPersonalityCard agent={AGENT} personality={{ ...PERSONALITY, persona: '' }} mcpServers={[]} />);
    // persona section text should not appear
    expect(screen.queryByText(/Calm, precise/i)).not.toBeInTheDocument();
  });
});
