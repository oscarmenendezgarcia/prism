/**
 * Tests for <Announcer/>.
 * Verifies role/aria-live, sr-only styling, and that identical repeat
 * messages still change the rendered text node (nonce-driven).
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
    expect(el.textContent?.replace(/​/g, '')).toBe(
      'Task moved to position 2 of 3 in Todo.'
    );
  });

  it('two identical announcements change the rendered text node (nonce marker)', () => {
    render(<Announcer />);
    act(() => useAnnouncer.getState().announce('boundary'));
    const first = screen.getByTestId('announcer').textContent;
    act(() => useAnnouncer.getState().announce('boundary'));
    const second = screen.getByTestId('announcer').textContent;
    expect(first).not.toBe(second);
    // The user-visible text stripped of nonce markers must remain identical.
    expect(first?.replace(/​/g, '')).toBe(second?.replace(/​/g, ''));
  });
});
