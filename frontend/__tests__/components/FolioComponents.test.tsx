/**
 * Unit tests for Folio UI components (T-008 QA: folio-index-ui)
 *
 * Covers:
 *   FolioChapterList — empty state, loading, populated chapters, aria-labels
 *   FolioPageList    — empty chapter, loading, page rows with author labels, back nav
 *   FolioPageEditor  — view mode, edit mode, dirty state, delete confirmation
 *   FolioToggle      — render, toggle aria-pressed
 *   NewPageModal     — slug validation, chapter pre-fill, submit disabled until valid
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── FolioChapterList ─────────────────────────────────────────────────────────
import { FolioChapterList } from '../../src/components/folio/FolioChapterList';
// ── FolioPageList ────────────────────────────────────────────────────────────
import { FolioPageList } from '../../src/components/folio/FolioPageList';
// ── FolioPageEditor ──────────────────────────────────────────────────────────
import { FolioPageEditor } from '../../src/components/folio/FolioPageEditor';
// ── FolioToggle ──────────────────────────────────────────────────────────────
import { FolioToggle } from '../../src/components/folio/FolioToggle';
// ── NewPageModal ─────────────────────────────────────────────────────────────
import { NewPageModal } from '../../src/components/folio/NewPageModal';
// ── FolioScreen ──────────────────────────────────────────────────────────────
import { FolioScreen } from '../../src/components/folio/FolioScreen';

import { useAppStore } from '../../src/stores/useAppStore';
import { useFolioStore } from '../../src/stores/useFolioStore';
import type { FolioChapter, FolioPageMeta, FolioPage } from '../../src/api/client';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  getSpaces:          vi.fn(),
  getTasks:           vi.fn(),
  createTask:         vi.fn(),
  moveTask:           vi.fn(),
  deleteTask:         vi.fn(),
  createSpace:        vi.fn(),
  renameSpace:        vi.fn(),
  deleteSpace:        vi.fn(),
  getAttachmentContent: vi.fn(),
  getFolioIndex:      vi.fn(),
  getChapterPages:    vi.fn(),
  getFolioPage:       vi.fn(),
  createFolioPage:    vi.fn(),
  updateFolioPage:    vi.fn(),
  deleteFolioPage:    vi.fn(),
}));

vi.mock('../../src/stores/useFolioStore', () => ({
  useFolioStore: vi.fn(),
  useFolioView:       vi.fn(),
  useFolioActive:     vi.fn(),
  useFolioChapters:   vi.fn(),
  useFolioPages:      vi.fn(),
  useFolioActivePage: vi.fn(),
  useFolioLoading:    vi.fn(),
  useFolioMutating:   vi.fn(),
}));

// MarkdownViewer: render as a plain div for test isolation.
vi.mock('../../src/components/shared/MarkdownViewer', () => ({
  MarkdownViewer: ({ content }: { content: string }) => (
    <div data-testid="markdown-viewer">{content}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHAPTERS: FolioChapter[] = [
  { slug: 'architecture', title: 'Architecture', position: 0, pageCount: 3 },
  { slug: 'implementation', title: 'Implementation', position: 1, pageCount: 1 },
];

const now = new Date().toISOString();
const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

const PAGES: FolioPageMeta[] = [
  {
    id: 'page-1',
    slug: 'auth-redesign',
    chapterSlug: 'architecture',
    title: 'Auth Redesign',
    author: 'user',
    createdAt: twoHoursAgo,
    updatedAt: twoHoursAgo,
  },
  {
    id: 'page-2',
    slug: 'api-schema',
    chapterSlug: 'architecture',
    title: 'API Schema v2',
    author: 'agent',
    createdAt: twoHoursAgo,
    updatedAt: twoHoursAgo,
  },
];

const FULL_PAGE: FolioPage = {
  id: 'page-1',
  slug: 'auth-redesign',
  chapterSlug: 'architecture',
  title: 'Auth Redesign',
  content: '# Auth Redesign\n\nThis is the content.',
  author: 'user',
  pinned: false,
  createdAt: twoHoursAgo,
  updatedAt: twoHoursAgo,
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setupMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
}

beforeEach(() => {
  localStorage.clear();
  setupMatchMedia();
  useAppStore.setState({
    folioOpen: false,
    activeSpaceId: 'space-1',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// FolioChapterList
// ===========================================================================

describe('FolioChapterList — empty state', () => {
  it('renders empty-state when active=false', () => {
    render(
      <FolioChapterList
        active={false}
        chapters={[]}
        loading={false}
        onOpenChapter={vi.fn()}
        onNewPage={vi.fn()}
      />
    );
    expect(screen.getByTestId('folio-empty-state')).toBeInTheDocument();
    expect(screen.getByText('This space has no Folio yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first page to get started.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create your first page/i })).toBeInTheDocument();
  });

  it('renders empty-state when active=true but chapters array is empty', () => {
    render(
      <FolioChapterList
        active={true}
        chapters={[]}
        loading={false}
        onOpenChapter={vi.fn()}
        onNewPage={vi.fn()}
      />
    );
    expect(screen.getByTestId('folio-empty-state')).toBeInTheDocument();
  });

  it('calls onNewPage when CTA button is clicked', () => {
    const onNewPage = vi.fn();
    render(
      <FolioChapterList
        active={false}
        chapters={[]}
        loading={false}
        onOpenChapter={vi.fn()}
        onNewPage={onNewPage}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /create your first page/i }));
    expect(onNewPage).toHaveBeenCalledOnce();
  });
});

describe('FolioChapterList — loading state', () => {
  it('shows loading spinner when loading=true', () => {
    render(
      <FolioChapterList
        active={false}
        chapters={[]}
        loading={true}
        onOpenChapter={vi.fn()}
        onNewPage={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Loading Folio index…')).toBeInTheDocument();
    expect(screen.queryByTestId('folio-empty-state')).not.toBeInTheDocument();
  });
});

describe('FolioChapterList — populated state', () => {
  it('renders chapter cards for each chapter', () => {
    render(
      <FolioChapterList
        active={true}
        chapters={CHAPTERS}
        loading={false}
        onOpenChapter={vi.fn()}
        onNewPage={vi.fn()}
      />
    );
    expect(screen.getByTestId('folio-chapter-list')).toBeInTheDocument();
    expect(screen.getByTestId('chapter-card-architecture')).toBeInTheDocument();
    expect(screen.getByTestId('chapter-card-implementation')).toBeInTheDocument();
  });

  it('renders page count badge on each chapter card', () => {
    render(
      <FolioChapterList
        active={true}
        chapters={CHAPTERS}
        loading={false}
        onOpenChapter={vi.fn()}
        onNewPage={vi.fn()}
      />
    );
    expect(screen.getByText('3 pages')).toBeInTheDocument();
    expect(screen.getByText('1 page')).toBeInTheDocument();
  });

  it('uses singular "page" for count=1', () => {
    render(
      <FolioChapterList
        active={true}
        chapters={[{ slug: 'arch', title: 'Arch', position: 0, pageCount: 1 }]}
        loading={false}
        onOpenChapter={vi.fn()}
        onNewPage={vi.fn()}
      />
    );
    expect(screen.getByText('1 page')).toBeInTheDocument();
    expect(screen.queryByText('1 pages')).not.toBeInTheDocument();
  });

  it('calls onOpenChapter with the correct slug when a card is clicked', () => {
    const onOpenChapter = vi.fn();
    render(
      <FolioChapterList
        active={true}
        chapters={CHAPTERS}
        loading={false}
        onOpenChapter={onOpenChapter}
        onNewPage={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('chapter-card-architecture'));
    expect(onOpenChapter).toHaveBeenCalledWith('architecture');
  });

  it('aria-label includes chapter title and page count', () => {
    render(
      <FolioChapterList
        active={true}
        chapters={CHAPTERS}
        loading={false}
        onOpenChapter={vi.fn()}
        onNewPage={vi.fn()}
      />
    );
    const card = screen.getByTestId('chapter-card-architecture');
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('Architecture'));
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('3 pages'));
  });

  it('does NOT show empty state when chapters exist', () => {
    render(
      <FolioChapterList
        active={true}
        chapters={CHAPTERS}
        loading={false}
        onOpenChapter={vi.fn()}
        onNewPage={vi.fn()}
      />
    );
    expect(screen.queryByTestId('folio-empty-state')).not.toBeInTheDocument();
  });
});

// ===========================================================================
// FolioPageList
// ===========================================================================

describe('FolioPageList — structure', () => {
  it('renders chapter title and page count in header', () => {
    render(
      <FolioPageList
        chapterTitle="Architecture"
        pages={PAGES}
        loading={false}
        onOpenPage={vi.fn()}
        onDeletePage={vi.fn()}
        onNewPage={vi.fn()}
        onBack={vi.fn()}
      />
    );
    expect(screen.getByText('Architecture')).toBeInTheDocument();
    expect(screen.getByText('2 pages')).toBeInTheDocument();
  });

  it('calls onBack when back button is clicked', () => {
    const onBack = vi.fn();
    render(
      <FolioPageList
        chapterTitle="Architecture"
        pages={PAGES}
        loading={false}
        onOpenPage={vi.fn()}
        onDeletePage={vi.fn()}
        onNewPage={vi.fn()}
        onBack={onBack}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /back to chapters/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe('FolioPageList — loading state', () => {
  it('shows loading spinner when loading=true', () => {
    render(
      <FolioPageList
        chapterTitle="Architecture"
        pages={[]}
        loading={true}
        onOpenPage={vi.fn()}
        onDeletePage={vi.fn()}
        onNewPage={vi.fn()}
        onBack={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Loading pages…')).toBeInTheDocument();
  });
});

describe('FolioPageList — empty chapter', () => {
  it('renders empty chapter message when pages is empty and not loading', () => {
    render(
      <FolioPageList
        chapterTitle="Architecture"
        pages={[]}
        loading={false}
        onOpenPage={vi.fn()}
        onDeletePage={vi.fn()}
        onNewPage={vi.fn()}
        onBack={vi.fn()}
      />
    );
    expect(screen.getByText('No pages in this chapter yet.')).toBeInTheDocument();
    expect(screen.getByText('Create a page')).toBeInTheDocument();
  });
});

describe('FolioPageList — author labels (neutral vocabulary)', () => {
  it('displays "You" for author=user pages', () => {
    render(
      <FolioPageList
        chapterTitle="Architecture"
        pages={PAGES}
        loading={false}
        onOpenPage={vi.fn()}
        onDeletePage={vi.fn()}
        onNewPage={vi.fn()}
        onBack={vi.fn()}
      />
    );
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('displays "Agent" for author=agent pages', () => {
    render(
      <FolioPageList
        chapterTitle="Architecture"
        pages={PAGES}
        loading={false}
        onOpenPage={vi.fn()}
        onDeletePage={vi.fn()}
        onNewPage={vi.fn()}
        onBack={vi.fn()}
      />
    );
    expect(screen.getByText('Agent')).toBeInTheDocument();
  });

  it('does NOT render raw author values "user" or "agent" as labels', () => {
    render(
      <FolioPageList
        chapterTitle="Architecture"
        pages={PAGES}
        loading={false}
        onOpenPage={vi.fn()}
        onDeletePage={vi.fn()}
        onNewPage={vi.fn()}
        onBack={vi.fn()}
      />
    );
    // "user" should NOT appear as standalone label text
    const textNodes = screen.queryAllByText('user');
    expect(textNodes.filter(el => el.getAttribute('data-testid') === null && el.closest('button'))).toHaveLength(0);
  });

  it('page row aria-label contains title, author, and time', () => {
    render(
      <FolioPageList
        chapterTitle="Architecture"
        pages={PAGES}
        loading={false}
        onOpenPage={vi.fn()}
        onDeletePage={vi.fn()}
        onNewPage={vi.fn()}
        onBack={vi.fn()}
      />
    );
    const firstRow = screen.getByTestId('page-row-auth-redesign');
    expect(firstRow).toHaveAttribute('aria-label', expect.stringContaining('Auth Redesign'));
    expect(firstRow).toHaveAttribute('aria-label', expect.stringContaining('You'));
  });
});

describe('FolioPageList — page row interactions', () => {
  it('calls onOpenPage with the page slug when row is clicked', () => {
    const onOpenPage = vi.fn();
    render(
      <FolioPageList
        chapterTitle="Architecture"
        pages={PAGES}
        loading={false}
        onOpenPage={onOpenPage}
        onDeletePage={vi.fn()}
        onNewPage={vi.fn()}
        onBack={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('page-row-auth-redesign'));
    expect(onOpenPage).toHaveBeenCalledWith('auth-redesign');
  });
});

// ===========================================================================
// FolioPageEditor
// ===========================================================================

describe('FolioPageEditor — view mode', () => {
  const baseProps = {
    page: FULL_PAGE,
    isMutating: false,
    loading: false,
    onBack: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
  };

  it('renders page title in view mode', () => {
    render(<FolioPageEditor {...baseProps} />);
    expect(screen.getByText('Auth Redesign')).toBeInTheDocument();
  });

  it('renders MarkdownViewer with page content', () => {
    render(<FolioPageEditor {...baseProps} />);
    expect(screen.getByTestId('markdown-viewer')).toBeInTheDocument();
    expect(screen.getByTestId('markdown-viewer')).toHaveTextContent('# Auth Redesign');
  });

  it('shows "Author: You" for user-authored page', () => {
    render(<FolioPageEditor {...baseProps} />);
    expect(screen.getByText('Author: You')).toBeInTheDocument();
  });

  it('shows "Author: Agent" for agent-authored page', () => {
    const agentPage = { ...FULL_PAGE, author: 'agent' as const };
    render(<FolioPageEditor {...baseProps} page={agentPage} />);
    expect(screen.getByText('Author: Agent')).toBeInTheDocument();
  });

  it('renders Edit button in view mode', () => {
    render(<FolioPageEditor {...baseProps} />);
    expect(screen.getByRole('button', { name: /edit page/i })).toBeInTheDocument();
  });

  it('renders Delete button in view mode', () => {
    render(<FolioPageEditor {...baseProps} />);
    expect(screen.getByRole('button', { name: /delete page/i })).toBeInTheDocument();
  });

  it('renders Back button', () => {
    render(<FolioPageEditor {...baseProps} />);
    expect(screen.getByRole('button', { name: /back to page list/i })).toBeInTheDocument();
  });

  it('calls onBack when Back button clicked in clean state', () => {
    const onBack = vi.fn();
    render(<FolioPageEditor {...baseProps} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: /back to page list/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('shows loading spinner when loading=true', () => {
    render(<FolioPageEditor {...baseProps} loading={true} />);
    expect(screen.getByLabelText('Loading page…')).toBeInTheDocument();
  });

  it('shows empty-content placeholder when content is empty', () => {
    const emptyPage = { ...FULL_PAGE, content: '' };
    render(<FolioPageEditor {...baseProps} page={emptyPage} />);
    expect(screen.getByText(/click edit to add some/i)).toBeInTheDocument();
  });
});

describe('FolioPageEditor — edit mode', () => {
  const baseProps = {
    page: FULL_PAGE,
    isMutating: false,
    loading: false,
    onBack: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
  };

  function enterEditMode() {
    fireEvent.click(screen.getByRole('button', { name: /edit page/i }));
  }

  it('enters edit mode when Edit is clicked', () => {
    render(<FolioPageEditor {...baseProps} />);
    enterEditMode();
    expect(screen.getByRole('textbox', { name: /page title/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /page content/i })).toBeInTheDocument();
  });

  it('title input is pre-filled with current page title', () => {
    render(<FolioPageEditor {...baseProps} />);
    enterEditMode();
    const titleInput = screen.getByRole('textbox', { name: /page title/i });
    expect(titleInput).toHaveValue('Auth Redesign');
  });

  it('content textarea is pre-filled with current page content', () => {
    render(<FolioPageEditor {...baseProps} />);
    enterEditMode();
    const textarea = screen.getByRole('textbox', { name: /page content/i });
    expect(textarea).toHaveValue('# Auth Redesign\n\nThis is the content.');
  });

  it('Save button is disabled when content is unchanged (not dirty)', () => {
    render(<FolioPageEditor {...baseProps} />);
    enterEditMode();
    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    expect(saveBtn).toBeDisabled();
  });

  it('Save button becomes enabled after content change (dirty state)', async () => {
    render(<FolioPageEditor {...baseProps} />);
    enterEditMode();
    const textarea = screen.getByRole('textbox', { name: /page content/i });
    fireEvent.change(textarea, { target: { value: '# Updated content' } });
    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    expect(saveBtn).not.toBeDisabled();
  });

  it('calls onSave with changed content when Save is clicked', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FolioPageEditor {...baseProps} onSave={onSave} />);
    enterEditMode();
    const textarea = screen.getByRole('textbox', { name: /page content/i });
    fireEvent.change(textarea, { target: { value: 'New content' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'New content' })
      );
    });
  });

  it('does NOT include title in save payload when title is unchanged', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FolioPageEditor {...baseProps} onSave={onSave} />);
    enterEditMode();
    const textarea = screen.getByRole('textbox', { name: /page content/i });
    fireEvent.change(textarea, { target: { value: 'New content' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
      const payload = onSave.mock.calls[0][0];
      expect(payload).not.toHaveProperty('title');
    });
  });

  it('shows preview pane with rendered markdown', () => {
    render(<FolioPageEditor {...baseProps} />);
    enterEditMode();
    // Preview label
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('Cancel button exits edit mode without saving', () => {
    render(<FolioPageEditor {...baseProps} />);
    enterEditMode();
    // Modify content to mark dirty
    const textarea = screen.getByRole('textbox', { name: /page content/i });
    fireEvent.change(textarea, { target: { value: 'changed' } });
    // Cancel — should show guard dialog
    fireEvent.click(screen.getByRole('button', { name: /cancel editing/i }));
    // Guard dialog should appear
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();
  });

  it('cancel on clean state exits directly without dialog', () => {
    render(<FolioPageEditor {...baseProps} />);
    enterEditMode();
    // No changes — cancel immediately exits
    fireEvent.click(screen.getByRole('button', { name: /cancel editing/i }));
    // Should be back in view mode (Edit button visible again)
    expect(screen.getByRole('button', { name: /edit page/i })).toBeInTheDocument();
    expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument();
  });
});

describe('FolioPageEditor — dirty state guard', () => {
  const baseProps = {
    page: FULL_PAGE,
    isMutating: false,
    loading: false,
    onBack: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
  };

  it('shows guard dialog when Back is clicked with unsaved changes', () => {
    render(<FolioPageEditor {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /edit page/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /page content/i }), {
      target: { value: 'unsaved edits' },
    });
    fireEvent.click(screen.getByRole('button', { name: /back to page list/i }));
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /discard changes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /keep editing/i })).toBeInTheDocument();
  });

  it('"Keep editing" closes guard dialog without navigating', async () => {
    render(<FolioPageEditor {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /edit page/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /page content/i }), {
      target: { value: 'unsaved' },
    });
    fireEvent.click(screen.getByRole('button', { name: /back to page list/i }));
    fireEvent.click(screen.getByRole('button', { name: /keep editing/i }));
    // Modal plays 180ms exit animation before unmounting
    await waitFor(() => {
      expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument();
    }, { timeout: 500 });
    // Still in edit mode
    expect(screen.getByRole('textbox', { name: /page content/i })).toBeInTheDocument();
  });

  it('"Discard changes" navigates back', () => {
    const onBack = vi.fn();
    render(<FolioPageEditor {...baseProps} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: /edit page/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /page content/i }), {
      target: { value: 'unsaved' },
    });
    fireEvent.click(screen.getByRole('button', { name: /back to page list/i }));
    fireEvent.click(screen.getByRole('button', { name: /discard changes/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe('FolioPageEditor — delete confirmation', () => {
  const baseProps = {
    page: FULL_PAGE,
    isMutating: false,
    loading: false,
    onBack: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
  };

  it('shows delete confirmation dialog when Delete is clicked', () => {
    render(<FolioPageEditor {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /delete page/i }));
    expect(screen.getByText('Delete Page?')).toBeInTheDocument();
    expect(screen.getByText(/this cannot be undone/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onDelete with correct slugs when confirmed', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<FolioPageEditor {...baseProps} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /delete page/i }));
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('architecture', 'auth-redesign');
    });
  });

  it('closes dialog on Cancel without calling onDelete', async () => {
    const onDelete = vi.fn();
    render(<FolioPageEditor {...baseProps} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /delete page/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onDelete).not.toHaveBeenCalled();
    // Modal plays 180ms exit animation before unmounting
    await waitFor(() => {
      expect(screen.queryByText('Delete Page?')).not.toBeInTheDocument();
    }, { timeout: 500 });
  });
});

// ===========================================================================
// FolioToggle
// ===========================================================================

describe('FolioToggle', () => {
  it('renders with aria-label="Toggle Folio"', () => {
    render(<FolioToggle />);
    expect(screen.getByRole('button', { name: /toggle folio/i })).toBeInTheDocument();
  });

  it('aria-pressed=false when folio is closed', () => {
    useAppStore.setState({ folioOpen: false });
    render(<FolioToggle />);
    expect(screen.getByRole('button', { name: /toggle folio/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('aria-pressed=true when folio is open', () => {
    useAppStore.setState({ folioOpen: true });
    render(<FolioToggle />);
    expect(screen.getByRole('button', { name: /toggle folio/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls toggleFolio when clicked', () => {
    useAppStore.setState({ folioOpen: false });
    render(<FolioToggle />);
    fireEvent.click(screen.getByRole('button', { name: /toggle folio/i }));
    expect(useAppStore.getState().folioOpen).toBe(true);
  });
});

// ===========================================================================
// NewPageModal
// ===========================================================================

describe('NewPageModal — rendering', () => {
  it('does not render when open=false', () => {
    render(
      <NewPageModal
        open={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isMutating={false}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders modal when open=true', () => {
    render(
      <NewPageModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isMutating={false}
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/create a new page/i)).toBeInTheDocument();
  });

  it('pre-fills chapter field when prefilledChapter is provided', () => {
    render(
      <NewPageModal
        open={true}
        onClose={vi.fn()}
        prefilledChapter="architecture"
        onSubmit={vi.fn()}
        isMutating={false}
      />
    );
    const chapterInput = screen.getByLabelText(/chapter/i);
    expect(chapterInput).toHaveValue('architecture');
  });
});

describe('NewPageModal — slug validation', () => {
  it('Create button is disabled when chapter slug is empty', () => {
    render(
      <NewPageModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isMutating={false}
      />
    );
    expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled();
  });

  it('Create button is disabled when page slug is empty', () => {
    render(
      <NewPageModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isMutating={false}
      />
    );
    fireEvent.change(document.getElementById('np-chapter')!, { target: { value: 'architecture' } });
    // page slug is still empty → disabled
    expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled();
  });

  it('Create button is enabled when both chapter and page slugs are valid', () => {
    render(
      <NewPageModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isMutating={false}
      />
    );
    // Use the specific input IDs from the component (np-chapter, np-page)
    fireEvent.change(document.getElementById('np-chapter')!, { target: { value: 'architecture' } });
    fireEvent.change(document.getElementById('np-page')!, { target: { value: 'auth-redesign' } });
    expect(screen.getByRole('button', { name: /^create$/i })).not.toBeDisabled();
  });

  it('Create button stays disabled when chapter slug contains uppercase', () => {
    render(
      <NewPageModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isMutating={false}
      />
    );
    // "Architecture" fails slug regex (has uppercase) → canSubmit stays false
    fireEvent.change(document.getElementById('np-chapter')!, { target: { value: 'Architecture' } });
    fireEvent.change(document.getElementById('np-page')!, { target: { value: 'some-page' } });
    expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled();
  });

  it('does not show validation error for valid slug', () => {
    render(
      <NewPageModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isMutating={false}
      />
    );
    fireEvent.change(screen.getByLabelText(/chapter/i), { target: { value: 'architecture' } });
    expect(screen.queryByText(/invalid/i)).not.toBeInTheDocument();
  });
});

describe('NewPageModal — slug auto-generation from title', () => {
  it('auto-generates page slug from title', async () => {
    render(
      <NewPageModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isMutating={false}
      />
    );
    fireEvent.change(document.getElementById('np-title')!, { target: { value: 'My New Page' } });
    await waitFor(() => {
      expect(document.getElementById('np-page')).toHaveValue('my-new-page');
    });
  });
});

describe('NewPageModal — submit', () => {
  it('calls onSubmit with correct slug when form is submitted', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(
      <NewPageModal
        open={true}
        onClose={vi.fn()}
        prefilledChapter="architecture"
        onSubmit={onSubmit}
        isMutating={false}
      />
    );
    fireEvent.change(document.getElementById('np-page')!, { target: { value: 'new-page' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'architecture/new-page' })
      );
    });
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(
      <NewPageModal
        open={true}
        onClose={onClose}
        onSubmit={vi.fn()}
        isMutating={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ===========================================================================
// NewPageModal — inline validation (BUG-001 fix)
// Tests that onBlur handlers surface inline error messages so users
// understand why the Create button is disabled.
// ===========================================================================

describe('NewPageModal — inline blur validation (BUG-001)', () => {
  // Use role="alert" to distinguish inline errors from the static hint text
  // that shares similar wording ("Lowercase letters, numbers, and hyphens only").

  it('shows inline error on chapter field after blur with invalid slug', () => {
    render(
      <NewPageModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isMutating={false}
      />
    );
    const chapterInput = document.getElementById('np-chapter')!;
    fireEvent.change(chapterInput, { target: { value: 'Architecture' } }); // uppercase invalid
    fireEvent.blur(chapterInput);
    // role="alert" is on the inline error element, not the static hint
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/lowercase letters/i);
  });

  it('shows inline error on page field after blur with invalid slug', () => {
    render(
      <NewPageModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isMutating={false}
      />
    );
    const pageInput = document.getElementById('np-page')!;
    fireEvent.change(pageInput, { target: { value: 'My Page!' } }); // special chars invalid
    fireEvent.blur(pageInput);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/lowercase letters/i);
  });

  it('clears inline error on chapter field when corrected and blurred again', () => {
    render(
      <NewPageModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isMutating={false}
      />
    );
    const chapterInput = document.getElementById('np-chapter')!;
    // First: introduce error
    fireEvent.change(chapterInput, { target: { value: 'Bad Slug' } });
    fireEvent.blur(chapterInput);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Then: fix it
    fireEvent.change(chapterInput, { target: { value: 'good-slug' } });
    fireEvent.blur(chapterInput);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not show error for empty chapter field on blur (error only when non-empty and invalid)', () => {
    render(
      <NewPageModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isMutating={false}
      />
    );
    const chapterInput = document.getElementById('np-chapter')!;
    // Field is already empty on mount; blur it without typing
    fireEvent.blur(chapterInput);
    // No alert should appear for empty field
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears inline error immediately when user starts typing to correct', () => {
    render(
      <NewPageModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isMutating={false}
      />
    );
    const chapterInput = document.getElementById('np-chapter')!;
    fireEvent.change(chapterInput, { target: { value: 'Bad' } });
    fireEvent.blur(chapterInput);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Any change clears the error immediately (onChange clears error state)
    fireEvent.change(chapterInput, { target: { value: 'bad-slug' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ===========================================================================
// FolioPageList — PageRow accessibility (BUG-003 fix)
// Verifies the row element is not a <button> (no nested button violations).
// ===========================================================================

describe('FolioPageList — PageRow is not a <button> (BUG-003)', () => {
  it('page row renders as a div with role=button, not a <button> element', () => {
    render(
      <FolioPageList
        chapterTitle="Architecture"
        pages={PAGES}
        loading={false}
        onOpenPage={vi.fn()}
        onDeletePage={vi.fn()}
        onNewPage={vi.fn()}
        onBack={vi.fn()}
      />
    );
    const row = screen.getByTestId('page-row-auth-redesign');
    // Should be a div, not a button element
    expect(row.tagName.toLowerCase()).toBe('div');
    expect(row).toHaveAttribute('role', 'button');
    expect(row).toHaveAttribute('tabindex', '0');
  });

  it('page row is keyboard-activatable via Enter key', () => {
    const onOpenPage = vi.fn();
    render(
      <FolioPageList
        chapterTitle="Architecture"
        pages={PAGES}
        loading={false}
        onOpenPage={onOpenPage}
        onDeletePage={vi.fn()}
        onNewPage={vi.fn()}
        onBack={vi.fn()}
      />
    );
    const row = screen.getByTestId('page-row-auth-redesign');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onOpenPage).toHaveBeenCalledWith('auth-redesign');
  });

  it('page row is keyboard-activatable via Space key', () => {
    const onOpenPage = vi.fn();
    render(
      <FolioPageList
        chapterTitle="Architecture"
        pages={PAGES}
        loading={false}
        onOpenPage={onOpenPage}
        onDeletePage={vi.fn()}
        onNewPage={vi.fn()}
        onBack={vi.fn()}
      />
    );
    const row = screen.getByTestId('page-row-auth-redesign');
    fireEvent.keyDown(row, { key: ' ' });
    expect(onOpenPage).toHaveBeenCalledWith('auth-redesign');
  });
});

// ===========================================================================
// FolioScreen — space-switch reset (BUG-006)
// Verifies that changing activeSpaceId calls reset() then loadIndex().
// ===========================================================================

describe('FolioScreen — space-switch reset (BUG-006)', () => {
  let reset: ReturnType<typeof vi.fn>;
  let loadIndex: ReturnType<typeof vi.fn>;

  function makeFolioStore() {
    reset = vi.fn();
    loadIndex = vi.fn();
    (useFolioStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      view: 'chapters',
      active: false,
      chapters: [],
      activeChapterSlug: null,
      pages: [],
      activePage: null,
      loading: false,
      isMutating: false,
      loadIndex,
      openChapter: vi.fn(),
      openPage: vi.fn(),
      back: vi.fn(),
      createPage: vi.fn(),
      savePage: vi.fn(),
      deletePage: vi.fn(),
      reset,
    });
  }

  it('calls loadIndex on mount', () => {
    makeFolioStore();
    useAppStore.setState({ activeSpaceId: 'space-1' });
    render(<FolioScreen onClose={vi.fn()} />);
    expect(loadIndex).toHaveBeenCalledOnce();
  });

  it('calls reset then loadIndex when activeSpaceId changes', async () => {
    makeFolioStore();
    useAppStore.setState({ activeSpaceId: 'space-A' });
    render(<FolioScreen onClose={vi.fn()} />);

    reset.mockClear();
    loadIndex.mockClear();

    // Simulate space switch
    useAppStore.setState({ activeSpaceId: 'space-B' });

    await waitFor(() => {
      expect(reset).toHaveBeenCalledOnce();
      expect(loadIndex).toHaveBeenCalledOnce();
    });
  });

  it('does NOT call reset when space stays the same', async () => {
    makeFolioStore();
    useAppStore.setState({ activeSpaceId: 'space-A' });
    render(<FolioScreen onClose={vi.fn()} />);

    reset.mockClear();
    loadIndex.mockClear();

    // Set the same spaceId — no reset expected
    useAppStore.setState({ activeSpaceId: 'space-A' });

    // loadIndex may re-run (dependency array includes activeSpaceId), but reset must not
    await waitFor(() => {
      expect(reset).not.toHaveBeenCalled();
    });
  });

  it('renders Close button and calls onClose when clicked', () => {
    makeFolioStore();
    useAppStore.setState({ activeSpaceId: 'space-1' });
    const onClose = vi.fn();
    render(<FolioScreen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close folio/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
