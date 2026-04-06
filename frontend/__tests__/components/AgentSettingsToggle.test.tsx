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
  it('renders with correct aria-label when panel is closed', () => {
    render(<AgentSettingsToggle />);
    expect(screen.getByRole('button', { name: /open agent settings/i })).toBeInTheDocument();
  });

  it('renders with correct aria-label when panel is open', () => {
    useAppStore.setState({ agentSettingsPanelOpen: true });
    render(<AgentSettingsToggle />);
    expect(screen.getByRole('button', { name: /close agent settings/i })).toBeInTheDocument();
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

  it('has h-10 min-w-[72px] px-3 size classes (T-4 redesign)', () => {
    render(<AgentSettingsToggle />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('h-10');
    expect(btn.className).toContain('min-w-[72px]');
    expect(btn.className).toContain('px-3');
  });

  it('has flex-col layout for icon+label column (T-4 redesign)', () => {
    render(<AgentSettingsToggle />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('flex-col');
    expect(btn.className).toContain('gap-0.5');
  });

  it('uses rounded-lg instead of rounded-xl (T-4 wireframe spec)', () => {
    render(<AgentSettingsToggle />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('rounded-lg');
    expect(btn.className).not.toContain('rounded-xl');
  });
});
