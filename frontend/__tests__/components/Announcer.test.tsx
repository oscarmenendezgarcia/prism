/**
 * Tests for <Announcer/>.
 * Verifies role/aria-live, sr-only styling, and that identical repeat
 * messages still remount the text node (key={nonce}-driven).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Announcer } from '../../src/components/shared/Announcer';
import { useAnnouncer } from '../../src/stores/useAnnouncer';

beforeEach(() => {
  useAnnouncer.setState({ message: '', nonce: 0 });
});

describe('Announcer', () => {
  it('renders a role=status, aria-live=polite, sr-only region', () => {
    render(<Announcer />);
    const el = screen.getByTestId('announcer');
    expect(el).toHaveAttribute('role', 'status');
    expect(el).toHaveAttribute('aria-live', 'polite');
    expect(el.className).toContain('sr-only');
  });

  it('renders the latest announce() message', () => {
    render(<Announcer />);
    act(() => {
      useAnnouncer.getState().announce('Task moved to position 2 of 3 in Todo.');
    });
    const el = screen.getByTestId('announcer');
    expect(el.textContent).toBe('Task moved to position 2 of 3 in Todo.');
  });

  it('two identical announcements remount the message span (nonce key)', () => {
    render(<Announcer />);
    act(() => useAnnouncer.getState().announce('boundary'));
    const firstSpan = screen.getByTestId('announcer').querySelector('span');
    act(() => useAnnouncer.getState().announce('boundary'));
    const secondSpan = screen.getByTestId('announcer').querySelector('span');
    // Different DOM node instances despite identical text — React remounted
    // it because the key (nonce) changed, which is what forces the SR to
    // re-read an aria-live region with unchanged visible text.
    expect(firstSpan).not.toBe(secondSpan);
    expect(secondSpan?.textContent).toBe('boundary');
  });
});
