/**
 * Unit tests for runsPanelOpen / setRunsPanelOpen added to usePipelineLogStore.
 * T-003 (runs-panel-unification): single source of truth for panel visibility;
 * logPanelOpen stays as backward-compat alias.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePipelineLogStore } from '../../src/stores/usePipelineLogStore';

// ── Reset helper ──────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  usePipelineLogStore.setState({
    runsPanelOpen:  false,
    logPanelOpen:   false,
    unseenCount:    5,
  });
});

// ── T-003 AC: runsPanelOpen is the single source of truth ────────────────────

describe('usePipelineLogStore — runsPanelOpen', () => {
  it('starts false by default', () => {
    expect(usePipelineLogStore.getState().runsPanelOpen).toBe(false);
  });

  it('setRunsPanelOpen(true) sets runsPanelOpen to true', () => {
    usePipelineLogStore.getState().setRunsPanelOpen(true);
    expect(usePipelineLogStore.getState().runsPanelOpen).toBe(true);
  });

  it('setRunsPanelOpen(false) sets runsPanelOpen to false', () => {
    usePipelineLogStore.setState({ runsPanelOpen: true, logPanelOpen: true });
    usePipelineLogStore.getState().setRunsPanelOpen(false);
    expect(usePipelineLogStore.getState().runsPanelOpen).toBe(false);
  });

  it('setRunsPanelOpen(true) also updates the logPanelOpen alias', () => {
    usePipelineLogStore.getState().setRunsPanelOpen(true);
    expect(usePipelineLogStore.getState().logPanelOpen).toBe(true);
  });

  it('setRunsPanelOpen(false) also updates the logPanelOpen alias', () => {
    usePipelineLogStore.setState({ runsPanelOpen: true, logPanelOpen: true });
    usePipelineLogStore.getState().setRunsPanelOpen(false);
    expect(usePipelineLogStore.getState().logPanelOpen).toBe(false);
  });

  it('setRunsPanelOpen(true) resets unseenCount to 0', () => {
    usePipelineLogStore.setState({ unseenCount: 5 });
    usePipelineLogStore.getState().setRunsPanelOpen(true);
    expect(usePipelineLogStore.getState().unseenCount).toBe(0);
  });

  it('setRunsPanelOpen(false) does NOT reset unseenCount', () => {
    usePipelineLogStore.setState({ runsPanelOpen: true, logPanelOpen: true, unseenCount: 5 });
    usePipelineLogStore.getState().setRunsPanelOpen(false);
    expect(usePipelineLogStore.getState().unseenCount).toBe(5);
  });

  it('persists open state to localStorage under prism:runs-panel:open', () => {
    usePipelineLogStore.getState().setRunsPanelOpen(true);
    expect(localStorage.getItem('prism:runs-panel:open')).toBe('1');
  });

  it('removes localStorage key when closed', () => {
    usePipelineLogStore.getState().setRunsPanelOpen(true);
    usePipelineLogStore.getState().setRunsPanelOpen(false);
    expect(localStorage.getItem('prism:runs-panel:open')).toBeNull();
  });
});

// ── Backward-compat: setLogPanelOpen still works ──────────────────────────────

describe('usePipelineLogStore — setLogPanelOpen (deprecated alias)', () => {
  it('setLogPanelOpen(true) sets both logPanelOpen and runsPanelOpen', () => {
    usePipelineLogStore.getState().setLogPanelOpen(true);
    expect(usePipelineLogStore.getState().logPanelOpen).toBe(true);
    expect(usePipelineLogStore.getState().runsPanelOpen).toBe(true);
  });

  it('setLogPanelOpen(false) sets both logPanelOpen and runsPanelOpen to false', () => {
    usePipelineLogStore.setState({ runsPanelOpen: true, logPanelOpen: true });
    usePipelineLogStore.getState().setLogPanelOpen(false);
    expect(usePipelineLogStore.getState().logPanelOpen).toBe(false);
    expect(usePipelineLogStore.getState().runsPanelOpen).toBe(false);
  });

  it('setLogPanelOpen(true) resets unseenCount', () => {
    usePipelineLogStore.setState({ unseenCount: 7 });
    usePipelineLogStore.getState().setLogPanelOpen(true);
    expect(usePipelineLogStore.getState().unseenCount).toBe(0);
  });

  it('setLogPanelOpen persists to the new prism:runs-panel:open key', () => {
    usePipelineLogStore.getState().setLogPanelOpen(true);
    expect(localStorage.getItem('prism:runs-panel:open')).toBe('1');
  });
});
