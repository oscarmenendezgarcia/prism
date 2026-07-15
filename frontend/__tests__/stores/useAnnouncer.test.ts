/**
 * Tests for useAnnouncer.
 * T-001: message + nonce semantics (identical strings still update).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAnnouncer } from '../../src/stores/useAnnouncer';

beforeEach(() => {
  useAnnouncer.setState({ message: '', nonce: 0 });
});

describe('useAnnouncer', () => {
  it('exposes message and announce', () => {
    const state = useAnnouncer.getState();
    expect(state.message).toBe('');
    expect(typeof state.announce).toBe('function');
  });

  it('announce sets the latest message', () => {
    useAnnouncer.getState().announce('hello');
    expect(useAnnouncer.getState().message).toBe('hello');
  });

  it('nonce increments on every announce, even for identical text', () => {
    useAnnouncer.getState().announce('same');
    const first = useAnnouncer.getState().nonce;
    useAnnouncer.getState().announce('same');
    const second = useAnnouncer.getState().nonce;
    expect(second).toBe(first + 1);
    expect(useAnnouncer.getState().message).toBe('same');
  });

  it('two different messages both take effect in order', () => {
    useAnnouncer.getState().announce('first');
    useAnnouncer.getState().announce('second');
    expect(useAnnouncer.getState().message).toBe('second');
    expect(useAnnouncer.getState().nonce).toBe(2);
  });
});
