/**
 * Makes the board's cards travel instead of jumping.
 *
 * Each card's position is read just before React applies a new board and
 * compared with where it ends up. A card that changed column flies on a copy
 * above the page, since columns clip what leaves them; its neighbours slide
 * into place; a card that is new fades in. Only what is on screen animates, so
 * the cost does not grow with the board.
 */

import { useLayoutEffect, useMemo, useRef, type DragEvent, type RefObject } from 'react';
import type { BoardTasks } from '@/types';
import { useDragStore } from '@/stores/useDragStore';

const MOVE_MS = 220;
const ENTER_MS = 160;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
/** A drop whose board takes longer than this to change no longer looks like its cause. */
const DROP_TTL_MS = 5000;
const CARD_SELECTOR = '[data-testid="task-card"]';

interface Seen {
  rect: DOMRect;
  column: string | null;
}

let grab: { x: number; y: number } | null = null;
let drop: { taskId: string; left: number; top: number; at: number } | null = null;
const flying = new Map<string, HTMLElement>();

/** Where the pointer holds the card, so that it lands from where it was let go. */
export function noteDragStart(e: DragEvent) {
  const rect = e.currentTarget.getBoundingClientRect();
  grab = { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

export function noteDrop(taskId: string, e: DragEvent) {
  drop = grab && { taskId, left: e.clientX - grab.x, top: e.clientY - grab.y, at: Date.now() };
  grab = null;
}

function measure(root: HTMLElement): Map<string, Seen> {
  const seen = new Map<string, Seen>();
  root.querySelectorAll<HTMLElement>(CARD_SELECTOR).forEach((el) => {
    if (el.dataset.id) seen.set(el.dataset.id, { rect: el.getBoundingClientRect(), column: el.dataset.column ?? null });
  });
  return seen;
}

function onScreen(rect: DOMRect): boolean {
  return rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
}

function shownInList(el: HTMLElement, rect: DOMRect): boolean {
  const list = el.closest('[role="list"]')?.getBoundingClientRect();
  return !list || (rect.bottom > list.top && rect.top < list.bottom);
}

function fly(el: HTMLElement, id: string, from: { left: number; top: number }, to: DOMRect) {
  // Where the column ends: a card that lands below the fold leaves towards it, and fades.
  const listBottom = el.closest('[role="list"]')?.getBoundingClientRect().bottom ?? Infinity;
  const top = Math.min(to.top, listBottom - to.height);
  const copy = el.cloneNode(true) as HTMLElement;
  copy.removeAttribute('data-testid');
  copy.removeAttribute('data-id');
  copy.removeAttribute('tabindex');
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  Object.assign(copy.style, {
    position: 'fixed', left: `${to.left}px`, top: `${top}px`, width: `${to.width}px`, height: `${to.height}px`,
    margin: '0', zIndex: '90', pointerEvents: 'none', transition: 'none', boxShadow: 'var(--shadow-md)',
  });
  document.body.append(copy);
  flying.set(id, copy);

  const options = { duration: MOVE_MS, easing: EASE };
  const landsHidden = top !== to.top;
  copy.animate(
    [
      { transform: `translate(${from.left - to.left}px, ${from.top - top}px)`, opacity: 1 },
      { transform: 'none', opacity: landsHidden ? 0 : 1 },
    ],
    options,
  ).finished.catch(() => {}).finally(() => {
    copy.remove();
    if (flying.get(id) === copy) flying.delete(id);
  });
  el.animate([{ opacity: 0 }, { opacity: 0 }], options);
}

function animate(root: HTMLElement, before: Map<string, Seen> | null) {
  const origin = drop && Date.now() - drop.at < DROP_TTL_MS ? drop : null;
  root.querySelectorAll<HTMLElement>(CARD_SELECTOR).forEach((el) => {
    const id = el.dataset.id;
    if (!id) return;
    const rect = el.getBoundingClientRect();
    if (!onScreen(rect)) return;
    const was = before?.get(id);
    if (!was) {
      if (shownInList(el, rect)) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ENTER_MS, easing: EASE });
      return;
    }
    if (origin?.taskId === id) {
      fly(el, id, origin, rect);
      return;
    }
    const inFlight = flying.get(id);
    if (was.column !== (el.dataset.column ?? null)) {
      if (!was.rect.width) return;
      fly(el, id, inFlight?.getBoundingClientRect() ?? was.rect, rect);
      inFlight?.remove();
      return;
    }
    const dx = was.rect.left - rect.left;
    const dy = was.rect.top - rect.top;
    if ((Math.abs(dx) < 1 && Math.abs(dy) < 1) || !was.rect.width) return;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: MOVE_MS, easing: EASE });
  });
  if (origin) drop = null;
}

function canAnimate(root: HTMLElement): boolean {
  return typeof root.animate === 'function'
    && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    && useDragStore.getState().draggedTaskId === null;
}

/**
 * @param scope What the board is showing. When it changes the cards are other
 *              cards: they fade in together and nothing travels.
 */
export function useCardMotion(rootRef: RefObject<HTMLElement | null>, tasks: BoardTasks, scope: string) {
  const order = useMemo(
    () => Object.entries(tasks).map(([column, list]) => `${column}:${list.map((t) => t.id).join(',')}`).join(';'),
    [tasks],
  );
  const committed = useRef<{ order: string; scope: string } | null>(null);
  const before = useRef<Map<string, Seen> | null>(null);

  // During render: this is the last moment the old board is still on the screen.
  if (committed.current && committed.current.order !== order && !before.current && rootRef.current) {
    before.current = measure(rootRef.current);
  }

  useLayoutEffect(() => {
    const previous = committed.current;
    const seen = before.current;
    before.current = null;
    committed.current = { order, scope };
    const root = rootRef.current;
    if (!root || !canAnimate(root)) return;
    if (previous?.order === order && previous.scope === scope) return;
    animate(root, previous?.scope === scope ? seen : null);
  }, [order, scope, rootRef]);
}
