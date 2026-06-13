/**
 * Unit tests for SpaceTab component.
 *
 * Covers: active/inactive visual states, aria-selected, data-space-id,
 * click handlers, kebab click isolation, refCb wiring, title attribute.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpaceTab } from '../../src/components/layout/SpaceTab';
import type { Space } from '../../src/types';

function makeSpace(overrides?: Partial<Space>): Space {
  return {
    id: 'space-1',
    name: 'General',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SpaceTab — active state', () => {
  it('renders the space name', () => {
    render(
      <SpaceTab
        space={makeSpace()}
        active={true}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
      />,
    );
    expect(screen.getByText('General')).toBeInTheDocument();
  });

  it('active tab has aria-selected="true"', () => {
    render(
      <SpaceTab
        space={makeSpace()}
        active={true}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
      />,
    );
    const tab = screen.getByRole('tab', { name: /general/i });
    expect(tab).toHaveAttribute('aria-selected', 'true');
  });

  it('active tab has data-space-id', () => {
    render(
      <SpaceTab
        space={makeSpace({ id: 'abc' })}
        active={true}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
      />,
    );
    const tab = screen.getByRole('tab', { name: /general/i });
    expect(tab).toHaveAttribute('data-space-id', 'abc');
  });

  it('active tab has title attribute with full name', () => {
    render(
      <SpaceTab
        space={makeSpace({ name: 'related-tags-motive' })}
        active={true}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
      />,
    );
    const tab = screen.getByRole('tab');
    expect(tab).toHaveAttribute('title', 'related-tags-motive');
  });

  it('active tab applies bg-primary-container class', () => {
    render(
      <SpaceTab
        space={makeSpace()}
        active={true}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
      />,
    );
    const tab = screen.getByRole('tab');
    expect(tab.className).toContain('bg-primary-container');
  });

  it('active tab applies font-medium class', () => {
    render(
      <SpaceTab
        space={makeSpace()}
        active={true}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
      />,
    );
    const tab = screen.getByRole('tab');
    expect(tab.className).toContain('font-medium');
  });
});

describe('SpaceTab — inactive state', () => {
  it('inactive tab has aria-selected="false"', () => {
    render(
      <SpaceTab
        space={makeSpace()}
        active={false}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
      />,
    );
    const tab = screen.getByRole('tab');
    expect(tab).toHaveAttribute('aria-selected', 'false');
  });

  it('inactive tab does not apply bg-primary-container', () => {
    render(
      <SpaceTab
        space={makeSpace()}
        active={false}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
      />,
    );
    const tab = screen.getByRole('tab');
    expect(tab.className).not.toContain('bg-primary-container');
  });

  it('inactive tab applies text-text-secondary', () => {
    render(
      <SpaceTab
        space={makeSpace()}
        active={false}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
      />,
    );
    const tab = screen.getByRole('tab');
    expect(tab.className).toContain('text-text-secondary');
  });
});

describe('SpaceTab — click handlers', () => {
  it('calls onSelect with the space when tab is clicked', () => {
    const onSelect = vi.fn();
    const space = makeSpace();
    render(
      <SpaceTab
        space={space}
        active={false}
        onSelect={onSelect}
        onKebab={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('tab'));
    expect(onSelect).toHaveBeenCalledWith(space);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('calls onKebab when the kebab span is clicked', () => {
    const onKebab = vi.fn();
    render(
      <SpaceTab
        space={makeSpace({ id: 'test-space' })}
        active={false}
        onSelect={vi.fn()}
        onKebab={onKebab}
      />,
    );
    const kebab = screen.getByTitle('Space options');
    fireEvent.click(kebab);
    expect(onKebab).toHaveBeenCalledTimes(1);
    // First arg is the event, second is the space id
    expect(onKebab.mock.calls[0][1]).toBe('test-space');
  });

  it('kebab click does not trigger onSelect (stopPropagation)', () => {
    const onSelect = vi.fn();
    render(
      <SpaceTab
        space={makeSpace()}
        active={false}
        onSelect={onSelect}
        onKebab={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle('Space options'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('SpaceTab — ref callback', () => {
  it('calls refCb with the tab element when mounted', () => {
    const refCb = vi.fn();
    render(
      <SpaceTab
        space={makeSpace()}
        active={false}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
        refCb={refCb}
      />,
    );
    expect(refCb).toHaveBeenCalledWith(expect.any(HTMLDivElement));
  });
});

describe('SpaceTab — keyboard activation', () => {
  it('calls onSelect when Enter is pressed on the tab', () => {
    const onSelect = vi.fn();
    const space = makeSpace();
    render(
      <SpaceTab space={space} active={false} onSelect={onSelect} onKebab={vi.fn()} />,
    );
    fireEvent.keyDown(screen.getByRole('tab'), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(space);
  });

  it('calls onSelect when Space is pressed on the tab', () => {
    const onSelect = vi.fn();
    const space = makeSpace();
    render(
      <SpaceTab space={space} active={false} onSelect={onSelect} onKebab={vi.fn()} />,
    );
    fireEvent.keyDown(screen.getByRole('tab'), { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith(space);
  });

  it('is focusable (tabIndex=0)', () => {
    render(<SpaceTab space={makeSpace()} active={false} onSelect={vi.fn()} onKebab={vi.fn()} />);
    expect(screen.getByRole('tab')).toHaveAttribute('tabindex', '0');
  });
});

// ---------------------------------------------------------------------------
// QOL-2: drag affordance + pin indicator
// ---------------------------------------------------------------------------
describe('SpaceTab — pin indicator', () => {
  it('renders push_pin icon when pinned=true', () => {
    render(
      <SpaceTab
        space={makeSpace()}
        active={false}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
        pinned
      />,
    );
    // The push_pin span is aria-hidden; query by text content
    const icons = document.querySelectorAll('[aria-hidden="true"]');
    const pinIcon = Array.from(icons).find((el) => el.textContent === 'push_pin');
    expect(pinIcon).toBeInTheDocument();
  });

  it('does not render push_pin icon when pinned is not provided', () => {
    render(
      <SpaceTab
        space={makeSpace()}
        active={false}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
      />,
    );
    const icons = document.querySelectorAll('[aria-hidden="true"]');
    const pinIcon = Array.from(icons).find((el) => el.textContent === 'push_pin');
    expect(pinIcon).toBeUndefined();
  });
});

describe('SpaceTab — drag behavior', () => {
  it('tab element has draggable=true when draggable prop is set', () => {
    render(
      <SpaceTab
        space={makeSpace()}
        active={false}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
        draggable
      />,
    );
    const tab = screen.getByRole('tab');
    expect(tab).toHaveAttribute('draggable', 'true');
  });

  it('tab element has draggable=false (default) when draggable is not set', () => {
    render(
      <SpaceTab
        space={makeSpace()}
        active={false}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
      />,
    );
    const tab = screen.getByRole('tab');
    expect(tab).toHaveAttribute('draggable', 'false');
  });

  it('applies ring-2 ring-primary class when dragOver=true', () => {
    render(
      <SpaceTab
        space={makeSpace()}
        active={false}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
        dragOver
      />,
    );
    const tab = screen.getByRole('tab');
    expect(tab.className).toContain('ring-2');
    expect(tab.className).toContain('ring-primary');
  });

  it('does not apply ring-2 when dragOver is not set', () => {
    render(
      <SpaceTab
        space={makeSpace()}
        active={false}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
      />,
    );
    const tab = screen.getByRole('tab');
    expect(tab.className).not.toContain('ring-2');
  });

  it('calls onDragStart when dragstart fires', () => {
    const onDragStart = vi.fn();
    render(
      <SpaceTab
        space={makeSpace()}
        active={false}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
        draggable
        onDragStart={onDragStart}
      />,
    );
    fireEvent.dragStart(screen.getByRole('tab'));
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });

  it('calls onDrop when drop fires', () => {
    const onDrop = vi.fn();
    render(
      <SpaceTab
        space={makeSpace()}
        active={false}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
        draggable
        onDrop={onDrop}
      />,
    );
    fireEvent.drop(screen.getByRole('tab'));
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('calls onDragEnd when dragend fires', () => {
    const onDragEnd = vi.fn();
    render(
      <SpaceTab
        space={makeSpace()}
        active={false}
        onSelect={vi.fn()}
        onKebab={vi.fn()}
        draggable
        onDragEnd={onDragEnd}
      />,
    );
    fireEvent.dragEnd(screen.getByRole('tab'));
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });
});
