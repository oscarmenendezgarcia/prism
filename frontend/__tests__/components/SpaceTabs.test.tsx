import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpaceTabs } from '../../src/components/layout/SpaceTabs';
import { useAppStore } from '../../src/stores/useAppStore';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(), getTasks: vi.fn(), createTask: vi.fn(), moveTask: vi.fn(),
  deleteTask: vi.fn(), createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
}));

const mockSpaces = [
  { id: 'default', name: 'General', createdAt: '', updatedAt: '' },
  { id: 'space-2', name: 'Work', createdAt: '', updatedAt: '' },
];

beforeEach(() => {
  useAppStore.setState({
    spaces: mockSpaces,
    activeSpaceId: 'default',
  });
  vi.clearAllMocks();
});

describe('SpaceTabs', () => {
  it('renders a tab for each space', () => {
    render(<SpaceTabs />);
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
  });

  it('renders add-space button', () => {
    render(<SpaceTabs />);
    expect(screen.getByLabelText('Create new space')).toBeInTheDocument();
  });

  it('active tab has correct aria-selected', () => {
    render(<SpaceTabs />);
    const generalTab = screen.getByRole('tab', { name: /general/i });
    expect(generalTab).toHaveAttribute('aria-selected', 'true');
    const workTab = screen.getByRole('tab', { name: /work/i });
    expect(workTab).toHaveAttribute('aria-selected', 'false');
  });

  it('calls setActiveSpace and loadBoard when non-active tab clicked', () => {
    const mockSetActive = vi.fn();
    const mockLoadBoard = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ setActiveSpace: mockSetActive, loadBoard: mockLoadBoard } as any);
    render(<SpaceTabs />);

    fireEvent.click(screen.getByRole('tab', { name: /work/i }));
    expect(mockSetActive).toHaveBeenCalledWith('space-2');
    expect(mockLoadBoard).toHaveBeenCalled();
  });

  it('does not call setActiveSpace when clicking already-active tab', () => {
    const mockSetActive = vi.fn();
    useAppStore.setState({ setActiveSpace: mockSetActive } as any);
    render(<SpaceTabs />);

    fireEvent.click(screen.getByRole('tab', { name: /general/i }));
    expect(mockSetActive).not.toHaveBeenCalled();
  });

  it('opens create space modal when + button clicked', () => {
    const mockOpenModal = vi.fn();
    useAppStore.setState({ openSpaceModal: mockOpenModal } as any);
    render(<SpaceTabs />);

    fireEvent.click(screen.getByLabelText('Create new space'));
    expect(mockOpenModal).toHaveBeenCalledWith('create');
  });
});
