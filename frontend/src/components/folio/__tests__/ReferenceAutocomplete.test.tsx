/**
 * Unit tests for ReferenceAutocomplete component.
 *
 * Covers:
 *  - Trigger detection: [[ opens dropdown, no trigger without [[
 *  - Page mode: searchFolioRefs called with partial after [[
 *  - Section mode: getFolioRefSections called when token includes #
 *  - Dropdown renders items with correct labels and roles
 *  - Keyboard navigation: ArrowDown/Up, Enter selects, Escape closes
 *  - Insertion: correct text inserted with closing ]]
 *  - Click outside closes dropdown
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ReferenceAutocomplete } from '../ReferenceAutocomplete';

// ---------------------------------------------------------------------------
// Mock api/client and store
// ---------------------------------------------------------------------------

const mockSearchFolioRefs = vi.fn();
const mockGetFolioRefSections = vi.fn();
const SPACE_ID = 'space-test-1';

vi.mock('@/api/client', () => ({
  searchFolioRefs:       (...args: unknown[]) => mockSearchFolioRefs(...args),
  getFolioRefSections:   (...args: unknown[]) => mockGetFolioRefSections(...args),
}));

vi.mock('@/stores/useAppStore', () => ({
  useAppStore: (selector: (s: { activeSpaceId: string }) => unknown) =>
    selector({ activeSpaceId: SPACE_ID }),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const PAGE_RESULTS = [
  { slug: 'arch/module', title: 'Module Arch', chapterSlug: 'arch', pageSlug: 'module', score: 1 },
  { slug: 'ops/runbook', title: 'Ops Runbook', chapterSlug: 'ops', pageSlug: 'runbook', score: 0.8 },
];

const SECTION_RESULTS = [
  { title: 'Overview', slug: 'overview' },
  { title: 'Decisions', slug: 'decisions' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render a controlled ReferenceAutocomplete.
 * Returns a `type` helper that simulates typing a full string into the textarea,
 * firing change events and re-rendering after each character.
 */
function renderComponent(initialValue = '') {
  let value = initialValue;
  const onChange = vi.fn((v: string) => { value = v; });

  function getRerender() {
    return (v: string) => {
      value = v;
      rerender(
        <ReferenceAutocomplete
          value={v}
          onChange={onChange}
          textareaProps={{ 'data-testid': 'desc-textarea' }}
        />,
      );
    };
  }

  const { rerender } = render(
    <ReferenceAutocomplete
      value={value}
      onChange={onChange}
      textareaProps={{ 'data-testid': 'desc-textarea' }}
    />,
  );

  const rerenderWith = getRerender();

  /**
   * Simulate typing characters one at a time.
   * Each character fires a change event and triggers re-render.
   */
  async function type(text: string): Promise<string> {
    const textarea = screen.getByTestId('desc-textarea') as HTMLTextAreaElement;
    for (const char of text) {
      value += char;
      await act(async () => {
        fireEvent.change(textarea, {
          target: { value, selectionStart: value.length },
        });
        rerenderWith(value);
      });
    }
    return value;
  }

  /**
   * Simulate typing a full replacement value (reset textarea to `text`).
   */
  async function typeValue(text: string): Promise<void> {
    const textarea = screen.getByTestId('desc-textarea') as HTMLTextAreaElement;
    value = text;
    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: text, selectionStart: text.length },
      });
      rerenderWith(text);
    });
  }

  return { onChange, type, typeValue, rerenderWith };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockSearchFolioRefs.mockResolvedValue(PAGE_RESULTS);
  mockGetFolioRefSections.mockResolvedValue(SECTION_RESULTS);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// TC-001: textarea renders
// ---------------------------------------------------------------------------

describe('TC-001: textarea renders', () => {
  it('renders a textarea with the data-testid', () => {
    renderComponent();
    expect(screen.getByTestId('desc-textarea')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// TC-002: no requests fire when [[ is not present
// ---------------------------------------------------------------------------

describe('TC-002: no requests without [[ trigger', () => {
  it('does not call searchFolioRefs when typing regular text', async () => {
    const { type } = renderComponent();
    await type('hello world');
    // Wait a bit to ensure no delayed requests either
    await new Promise((r) => setTimeout(r, 200));
    expect(mockSearchFolioRefs).not.toHaveBeenCalled();
  });

  it('does not show dropdown without [[ trigger', async () => {
    const { type } = renderComponent();
    await type('hello');
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TC-003: [[ opens dropdown with page results
// ---------------------------------------------------------------------------

describe('TC-003: [[ trigger opens dropdown', () => {
  it('calls searchFolioRefs when [[ is typed and debounce passes', async () => {
    const { type } = renderComponent();
    await type('[[mod');
    // Wait for debounce + promise resolution
    await waitFor(() => {
      expect(mockSearchFolioRefs).toHaveBeenCalledWith(SPACE_ID, expect.any(String), 20);
    }, { timeout: 800 });
  });

  it('renders a listbox with page results', async () => {
    const { type } = renderComponent();
    await type('[[mod');

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeDefined();
    }, { timeout: 800 });
  });

  it('shows page titles in the dropdown', async () => {
    const { type } = renderComponent();
    await type('[[mod');

    await waitFor(() => {
      expect(screen.getByText('Module Arch')).toBeDefined();
    }, { timeout: 800 });
  });

  it('shows page sub-labels (slug) in the dropdown', async () => {
    const { type } = renderComponent();
    await type('[[');

    await waitFor(() => {
      expect(screen.getByText('arch/module')).toBeDefined();
    }, { timeout: 800 });
  });
});

// ---------------------------------------------------------------------------
// TC-004: # switches to section mode
// ---------------------------------------------------------------------------

describe('TC-004: # in token switches to section mode', () => {
  it('calls getFolioRefSections when # is present in token', async () => {
    const { typeValue } = renderComponent();
    await typeValue('[[arch/module#');

    await waitFor(() => {
      expect(mockGetFolioRefSections).toHaveBeenCalledWith(SPACE_ID, 'arch/module');
    }, { timeout: 800 });
  });

  it('shows section titles in the dropdown', async () => {
    const { typeValue } = renderComponent();
    await typeValue('[[arch/module#');

    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeDefined();
      expect(screen.getByText('Decisions')).toBeDefined();
    }, { timeout: 800 });
  });

  it('does not call getFolioRefSections when page part is empty', async () => {
    const { typeValue } = renderComponent();
    await typeValue('[[#');

    // Wait a bit and confirm sections were never requested
    await new Promise((r) => setTimeout(r, 300));
    expect(mockGetFolioRefSections).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-005: keyboard navigation
// ---------------------------------------------------------------------------

describe('TC-005: keyboard navigation', () => {
  async function openDropdown() {
    const { typeValue } = renderComponent();
    await typeValue('[[mod');
    await waitFor(() => expect(screen.getByRole('listbox')).toBeDefined(), { timeout: 800 });
    return screen.getByTestId('desc-textarea');
  }

  it('first item is selected by default', async () => {
    await openDropdown();
    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowDown moves selection to next item', async () => {
    const textarea = await openDropdown();
    await act(async () => { fireEvent.keyDown(textarea, { key: 'ArrowDown' }); });
    const options = screen.getAllByRole('option');
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    expect(options[0].getAttribute('aria-selected')).toBe('false');
  });

  it('ArrowUp moves selection back to first item', async () => {
    const textarea = await openDropdown();
    await act(async () => { fireEvent.keyDown(textarea, { key: 'ArrowDown' }); });
    await act(async () => { fireEvent.keyDown(textarea, { key: 'ArrowUp' }); });
    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
  });

  it('Escape closes the dropdown', async () => {
    const textarea = await openDropdown();
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Escape' }); });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('ArrowDown does not go past last item', async () => {
    const textarea = await openDropdown();
    const count = screen.getAllByRole('option').length;
    for (let i = 0; i < count + 5; i++) {
      await act(async () => { fireEvent.keyDown(textarea, { key: 'ArrowDown' }); });
    }
    const options = screen.getAllByRole('option');
    expect(options[count - 1].getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowUp stays at first item when already at top', async () => {
    const textarea = await openDropdown();
    await act(async () => { fireEvent.keyDown(textarea, { key: 'ArrowUp' }); });
    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// TC-006: Enter selects and inserts
// ---------------------------------------------------------------------------

describe('TC-006: Enter inserts the selected item', () => {
  it('inserts [[chapter/page]] with closing brackets when ref selected', async () => {
    const { onChange, typeValue } = renderComponent();
    await typeValue('[[mod');

    await waitFor(() => expect(screen.getByRole('listbox')).toBeDefined(), { timeout: 800 });

    const textarea = screen.getByTestId('desc-textarea');
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }); });

    // onChange should have been called with the inserted text
    const calls = onChange.mock.calls;
    const lastCall = calls[calls.length - 1][0] as string;
    // The first result is arch/module
    expect(lastCall).toContain('[[arch/module]]');
    expect(lastCall).not.toContain('[[mod');
  });

  it('inserts [[chapter/page#section]] when in section mode', async () => {
    const { onChange, typeValue } = renderComponent();
    await typeValue('[[arch/module#');

    await waitFor(() => expect(screen.getByRole('listbox')).toBeDefined(), { timeout: 800 });

    const textarea = screen.getByTestId('desc-textarea');
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }); });

    const calls = onChange.mock.calls;
    const lastCall = calls[calls.length - 1][0] as string;
    expect(lastCall).toContain('[[arch/module#overview]]');
  });

  it('closes dropdown after Enter selection', async () => {
    const { typeValue } = renderComponent();
    await typeValue('[[mod');

    await waitFor(() => expect(screen.getByRole('listbox')).toBeDefined(), { timeout: 800 });

    const textarea = screen.getByTestId('desc-textarea');
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }); });

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull(), { timeout: 500 });
  });

  it('preserves text before the reference when inserting', async () => {
    // Use type() which properly rerenders after each change
    const { onChange, type } = renderComponent('Lead text ');
    await type('[[mod');

    await waitFor(() => expect(screen.getByRole('listbox')).toBeDefined(), { timeout: 800 });

    const textarea = screen.getByTestId('desc-textarea');
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }); });

    const calls = onChange.mock.calls;
    const lastCall = calls[calls.length - 1][0] as string;
    expect(lastCall).toContain('Lead text [[arch/module]]');
  });
});

// ---------------------------------------------------------------------------
// TC-007: click outside closes dropdown
// ---------------------------------------------------------------------------

describe('TC-007: click outside closes dropdown', () => {
  it('closes dropdown when clicking outside the component', async () => {
    const { typeValue } = renderComponent();
    await typeValue('[[mod');

    await waitFor(() => expect(screen.getByRole('listbox')).toBeDefined(), { timeout: 800 });

    // Click outside
    await act(async () => {
      fireEvent.mouseDown(document.body);
    });

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull(), { timeout: 500 });
  });
});

// ---------------------------------------------------------------------------
// TC-008: dropdown closes when [[ trigger deactivates
// ---------------------------------------------------------------------------

describe('TC-008: trigger deactivates on whitespace in token', () => {
  it('does not show dropdown when whitespace appears in the token after [[', async () => {
    const { typeValue } = renderComponent();
    // Space in token deactivates trigger
    await typeValue('[[mod ule');
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TC-009: listbox accessibility attributes
// ---------------------------------------------------------------------------

describe('TC-009: accessibility', () => {
  it('listbox has aria-label', async () => {
    const { typeValue } = renderComponent();
    await typeValue('[[mod');
    await waitFor(() => expect(screen.getByRole('listbox')).toBeDefined(), { timeout: 800 });
    const listbox = screen.getByRole('listbox');
    expect(listbox.getAttribute('aria-label')).toBeTruthy();
  });

  it('each option has role=option and aria-selected', async () => {
    const { typeValue } = renderComponent();
    await typeValue('[[mod');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0), { timeout: 800 });
    const options = screen.getAllByRole('option');
    options.forEach((opt) => {
      expect(opt.hasAttribute('aria-selected')).toBe(true);
    });
  });
});
