/**
 * Tests for useCardMotion. jsdom has no layout, so a card's position comes from
 * where it is in the DOM, and the Web Animations calls are what gets observed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useRef } from 'react';
import { render } from '@testing-library/react';
import { useCardMotion } from '../../src/hooks/useCardMotion';
import { useDragStore } from '../../src/stores/useDragStore';
import type { BoardTasks } from '../../src/types';

const task = (id: string) => ({ id, title: id, type: 'chore', createdAt: '', updatedAt: '' });
const animated: Array<{ id: string | undefined; frames: Keyframe[] }> = [];

function Board({ tasks, scope = 'a' }: { tasks: BoardTasks; scope?: string }) {
  const ref = useRef<HTMLElement>(null);
  useCardMotion(ref, tasks, scope);
  return (
    <main ref={ref}>
      {Object.entries(tasks).map(([column, list]) => (
        <div key={column} role="list">
          {list.map((t) => <article key={t.id} data-testid="task-card" data-id={t.id} data-column={column} />)}
        </div>
      ))}
    </main>
  );
}

const rectOf = (left: number, top: number) => ({ left, top, right: left + 100, bottom: top + 50, width: 100, height: 50, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

beforeEach(() => {
  animated.length = 0;
  useDragStore.getState().resetDrag();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (!this.dataset.id) return { ...rectOf(0, 0), bottom: 1000, height: 1000 };
    const list = this.parentElement!;
    return rectOf([...list.parentElement!.children].indexOf(list) * 200, [...list.children].indexOf(this) * 60);
  });
  HTMLElement.prototype.animate = vi.fn(function (this: HTMLElement, frames: Keyframe[]) {
    animated.push({ id: this.dataset.id, frames });
    return { finished: Promise.resolve() } as unknown as Animation;
  }) as never;
  window.matchMedia = vi.fn(() => ({ matches: false })) as never;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  document.body.innerHTML = '';
});

const start = () => {
  return render(<Board tasks={{ todo: [task('a'), task('b')], done: [] } as never} />);
};

describe('useCardMotion', () => {
  it('fades the cards in together when the board first appears', () => {
    start();
    expect(animated.map((a) => a.id)).toEqual(['a', 'b']);
    expect(animated[0].frames[0]).toEqual({ opacity: 0 });
  });

  it('flies a card that changes column on a copy, hides the real one, and slides its neighbour', async () => {
    const view = start();
    animated.length = 0;

    view.rerender(<Board tasks={{ todo: [task('b')], done: [task('a')] } as never} />);

    const copy = animated.find((a) => a.id === undefined);
    expect(copy?.frames[0].transform).toBe('translate(-200px, 0px)');
    expect(animated.find((a) => a.id === 'a')?.frames[0]).toEqual({ opacity: 0 });
    expect(animated.find((a) => a.id === 'b')?.frames[0].transform).toBe('translate(0px, 60px)');
    expect(document.body.querySelectorAll('[aria-hidden="true"]').length).toBe(1);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r));
    expect(document.body.querySelectorAll('[aria-hidden="true"]').length).toBe(0);
  });

  it('does nothing when a poll brings the same order', () => {
    const view = start();
    animated.length = 0;
    view.rerender(<Board tasks={{ todo: [task('a'), task('b')], done: [] } as never} />);
    expect(animated).toEqual([]);
  });

  it('only fades when the board shows something else', () => {
    const view = start();
    animated.length = 0;
    view.rerender(<Board scope="b" tasks={{ todo: [task('b')], done: [task('a')] } as never} />);
    expect(animated.every((a) => (a.frames[0] as { opacity?: number }).opacity === 0)).toBe(true);
    expect(animated.some((a) => a.id === undefined)).toBe(false);
  });

  it('leaves the cards alone during a drag, and when the system asks for less motion', () => {
    let view = start();
    animated.length = 0;
    useDragStore.getState().startDrag('z', 'todo');
    view.rerender(<Board tasks={{ todo: [task('b')], done: [task('a')] } as never} />);
    expect(animated).toEqual([]);
    useDragStore.getState().resetDrag();
    view.unmount();

    window.matchMedia = vi.fn(() => ({ matches: true })) as never;
    view = start();
    expect(animated).toEqual([]);
  });
});
