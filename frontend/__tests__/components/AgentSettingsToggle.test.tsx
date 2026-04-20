import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentSettingsToggle } from '../../src/components/agent-launcher/AgentSettingsToggle';
import { useAppStore } from '../../src/stores/useAppStore';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(), getTasks: vi.fn(), createTask: vi.fn(), moveTask: vi.fn(),
  deleteTask: vi.fn(), createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
}));

beforeEach(() => {
  useAppStore.setState({ agentSettingsPanelOpen: false });
});

describe('AgentSettingsToggle', () => {
  it('renders with static aria-label regardless of panel state', () => {
    render(<AgentSettingsToggle />);
    expect(screen.getByRole('button', { name: /agent settings/i })).toBeInTheDocument();
  });

  it('static aria-label is preserved when panel is open', () => {
    useAppStore.setState({ agentSettingsPanelOpen: true });
    render(<AgentSettingsToggle />);
    expect(screen.getByRole('button', { name: /agent settings/i })).toBeInTheDocument();
  });

  it('has aria-pressed=false when panel is closed', () => {
    render(<AgentSettingsToggle />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('has aria-pressed=true when panel is open', () => {
    useAppStore.setState({ agentSettingsPanelOpen: true });
    render(<AgentSettingsToggle />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls setAgentSettingsPanelOpen to toggle state on click', () => {
    const mockSet = vi.fn();
    useAppStore.setState({ agentSettingsPanelOpen: false, setAgentSettingsPanelOpen: mockSet } as any);
    render(<AgentSettingsToggle />);
    fireEvent.click(screen.getByRole('button'));
    expect(mockSet).toHaveBeenCalledWith(true);
  });

  it('applies inactive classes when panel is closed', () => {
    render(<AgentSettingsToggle />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('text-text-secondary');
  });

  it('applies active classes when panel is open', () => {
    useAppStore.setState({ agentSettingsPanelOpen: true });
    render(<AgentSettingsToggle />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('text-primary');
  });

  it('has w-9 h-9 icon-only size classes (Trend A redesign)', () => {
    render(<AgentSettingsToggle />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('w-9');
    expect(btn.className).toContain('h-9');
  });

  it('has items-center justify-center layout (Trend A redesign)', () => {
    render(<AgentSettingsToggle />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('items-center');
    expect(btn.className).toContain('justify-center');
  });

  it('uses rounded-lg instead of rounded-xl (Trend A wireframe spec)', () => {
    render(<AgentSettingsToggle />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('rounded-lg');
    expect(btn.className).not.toContain('rounded-xl');
  });

  it('renders icon-only — no text label (Trend A redesign)', () => {
    render(<AgentSettingsToggle />);
    const btn = screen.getByRole('button');
    const icon = btn.querySelector('.material-symbols-outlined');
    expect(icon).toBeInTheDocument();
    expect(btn.querySelector('span:not(.material-symbols-outlined)')).toBeNull();
  });
});
