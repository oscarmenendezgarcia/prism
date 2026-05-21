/**
 * Unit tests for Tooltip component.
 * Feature: Onboarding — tooltips en iconos del header.
 *
 * Test IDs:
 *   TC-001 … TC-010 — Tooltip unit tests
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tooltip } from '../Tooltip';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderTooltip(props: {
  label?: string;
  description?: string;
  position?: 'bottom' | 'top';
  children?: React.ReactNode;
}) {
  const {
    label = 'Terminal',
    description,
    position,
    children = <button type="button">trigger</button>,
  } = props;
  return render(
    <Tooltip label={label} description={description} position={position}>
      {children}
    </Tooltip>,
  );
}

// ---------------------------------------------------------------------------
// TC-001: renders children inside the wrapper
// ---------------------------------------------------------------------------
describe('Tooltip — TC-001: renders children', () => {
  it('renders the trigger child', () => {
    renderTooltip({ label: 'Terminal' });
    expect(screen.getByRole('button', { name: 'trigger' })).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// TC-002: tooltip bubble has role="tooltip"
// ---------------------------------------------------------------------------
describe('Tooltip — TC-002: role=tooltip', () => {
  it('renders an element with role="tooltip"', () => {
    renderTooltip({ label: 'Pipeline Log' });
    expect(screen.getByRole('tooltip')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// TC-003: label text appears inside the tooltip
// ---------------------------------------------------------------------------
describe('Tooltip — TC-003: label rendered', () => {
  it('renders the label string', () => {
    renderTooltip({ label: 'Agent Settings' });
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toContain('Agent Settings');
  });

  it('renders label as semibold <p>', () => {
    const { container } = renderTooltip({ label: 'Config' });
    const tooltip = container.querySelector('[role="tooltip"]')!;
    const labelEl = tooltip.querySelector('p');
    expect(labelEl).not.toBeNull();
    expect(labelEl!.textContent).toBe('Config');
    expect(labelEl!.className).toContain('font-semibold');
  });
});

// ---------------------------------------------------------------------------
// TC-004: description appears when provided
// ---------------------------------------------------------------------------
describe('Tooltip — TC-004: description rendered when provided', () => {
  it('renders description text', () => {
    renderTooltip({
      label: 'Terminal',
      description: 'Run shell commands on the server',
    });
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toContain('Run shell commands on the server');
  });

  it('description paragraph has text-text-secondary class', () => {
    const { container } = renderTooltip({
      label: 'Terminal',
      description: 'Run shell commands on the server',
    });
    const tooltip = container.querySelector('[role="tooltip"]')!;
    const paragraphs = tooltip.querySelectorAll('p');
    expect(paragraphs.length).toBe(2);
    expect(paragraphs[1].className).toContain('text-text-secondary');
  });
});

// ---------------------------------------------------------------------------
// TC-005: description NOT rendered when omitted
// ---------------------------------------------------------------------------
describe('Tooltip — TC-005: description absent when not provided', () => {
  it('renders only one <p> when description is omitted', () => {
    const { container } = renderTooltip({ label: 'Run History' });
    const tooltip = container.querySelector('[role="tooltip"]')!;
    const paragraphs = tooltip.querySelectorAll('p');
    expect(paragraphs.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// TC-006: position='bottom' applies correct CSS classes
// ---------------------------------------------------------------------------
describe('Tooltip — TC-006: position=bottom (default)', () => {
  it('tooltip has top-full and mt-2 classes (bottom positioning)', () => {
    const { container } = renderTooltip({ label: 'Terminal', position: 'bottom' });
    const tooltip = container.querySelector('[role="tooltip"]')!;
    expect(tooltip.className).toContain('top-full');
    expect(tooltip.className).toContain('mt-2');
  });

  it('does NOT contain bottom-full for bottom position', () => {
    const { container } = renderTooltip({ label: 'Terminal', position: 'bottom' });
    const tooltip = container.querySelector('[role="tooltip"]')!;
    expect(tooltip.className).not.toContain('bottom-full');
  });
});

// ---------------------------------------------------------------------------
// TC-007: position='top' applies correct CSS classes
// ---------------------------------------------------------------------------
describe('Tooltip — TC-007: position=top', () => {
  it('tooltip has bottom-full and mb-2 classes (top positioning)', () => {
    const { container } = renderTooltip({ label: 'Terminal', position: 'top' });
    const tooltip = container.querySelector('[role="tooltip"]')!;
    expect(tooltip.className).toContain('bottom-full');
    expect(tooltip.className).toContain('mb-2');
  });

  it('does NOT contain top-full for top position', () => {
    const { container } = renderTooltip({ label: 'Terminal', position: 'top' });
    const tooltip = container.querySelector('[role="tooltip"]')!;
    expect(tooltip.className).not.toContain('top-full');
  });
});

// ---------------------------------------------------------------------------
// TC-008: default position is 'bottom'
// ---------------------------------------------------------------------------
describe('Tooltip — TC-008: default position is bottom', () => {
  it('uses bottom positioning when position prop is omitted', () => {
    const { container } = renderTooltip({ label: 'Config' });
    const tooltip = container.querySelector('[role="tooltip"]')!;
    expect(tooltip.className).toContain('top-full');
    expect(tooltip.className).not.toContain('bottom-full');
  });
});

// ---------------------------------------------------------------------------
// TC-009: tooltip is pointer-events-none (no interaction interception)
// ---------------------------------------------------------------------------
describe('Tooltip — TC-009: pointer-events-none', () => {
  it('tooltip bubble has pointer-events-none class', () => {
    const { container } = renderTooltip({ label: 'Pipeline Log' });
    const tooltip = container.querySelector('[role="tooltip"]')!;
    expect(tooltip.className).toContain('pointer-events-none');
  });
});

// ---------------------------------------------------------------------------
// TC-010: wrapper uses relative + group/tt classes for CSS hover mechanism
// ---------------------------------------------------------------------------
describe('Tooltip — TC-010: wrapper classes', () => {
  it('outer wrapper has relative and group/tt classes', () => {
    const { container } = renderTooltip({ label: 'Run History' });
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain('relative');
    expect(wrapper.className).toContain('group/tt');
  });
});

// ---------------------------------------------------------------------------
// TC-011: all 5 header tooltip labels render correctly
// ---------------------------------------------------------------------------
describe('Tooltip — TC-011: header panel labels', () => {
  const PANELS = [
    { label: 'Terminal', description: 'Run shell commands on the server' },
    { label: 'Agent Settings', description: 'Configure agents and pipeline stages' },
    { label: 'Run History', description: 'Browse past pipeline executions' },
    { label: 'Config', description: 'Edit configuration files' },
  ];

  PANELS.forEach(({ label, description }) => {
    it(`renders label="${label}" and description`, () => {
      const { container } = renderTooltip({ label, description });
      const tooltip = container.querySelector('[role="tooltip"]')!;
      expect(tooltip.textContent).toContain(label);
      expect(tooltip.textContent).toContain(description);
    });
  });
});

// ---------------------------------------------------------------------------
// TC-012: z-index is high enough not to be clipped by other header elements
// ---------------------------------------------------------------------------
describe('Tooltip — TC-012: z-index', () => {
  it('tooltip has z-[300] class to appear above header content', () => {
    const { container } = renderTooltip({ label: 'Config' });
    const tooltip = container.querySelector('[role="tooltip"]')!;
    expect(tooltip.className).toContain('z-[300]');
  });
});
