import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { StatusesEditor, toStatusRows, type StatusRow } from '../../src/components/modals/StatusesEditor';
import type { Status } from '../../src/types';

const SAVED: Status[] = [
  { id: 'todo', name: 'Todo', category: 'todo' },
  { id: 'doing', name: 'Doing', category: 'in-progress' },
  { id: 'done', name: 'Done', category: 'done' },
];

interface HarnessProps {
  initial?: StatusRow[];
  counts?: Record<string, number>;
  removed?: Status[];
  moves?: Record<string, string>;
  onRemove?: (row: StatusRow) => void;
  onMoveChange?: (statusId: string, targetId: string) => void;
}

let current: StatusRow[] = [];

function Harness({ initial = toStatusRows(SAVED), counts = {}, removed = [], moves = {}, onRemove = vi.fn(), onMoveChange = vi.fn() }: HarnessProps) {
  const [rows, setRows] = useState(initial);
  current = rows;
  return (
    <StatusesEditor rows={rows} onChange={setRows} counts={counts} removed={removed} moves={moves} onRemove={onRemove} onMoveChange={onMoveChange} />
  );
}

const names = () => screen.getAllByLabelText(/^Status name /).map((i) => (i as HTMLInputElement).value);

describe('toStatusRows', () => {
  it('uses the id of each status as its row key', () => {
    expect(toStatusRows(SAVED)[1]).toEqual({ id: 'doing', name: 'Doing', category: 'in-progress', rowKey: 'doing' });
  });

  it('is empty without statuses', () => {
    expect(toStatusRows(undefined)).toEqual([]);
  });
});

describe('StatusesEditor — add', () => {
  it('adds an empty in-progress status at the end, not saved yet', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('add-status'));
    expect(names()).toEqual(['Todo', 'Doing', 'Done', '']);
    const added = current[3];
    expect(added.id).toBeUndefined();
    expect(added.category).toBe('in-progress');
    expect(added.name).toBe('');
  });

  it('gives each added status its own row', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('add-status'));
    fireEvent.click(screen.getByTestId('add-status'));
    expect(new Set(current.map((r) => r.rowKey)).size).toBe(5);
  });

  it('stops at 12 statuses', () => {
    const initial = Array.from({ length: 11 }, (_, i): StatusRow => ({ rowKey: `r${i}`, id: `s${i}`, name: `S${i}`, category: 'todo' }));
    render(<Harness initial={initial} />);
    expect(screen.getByTestId('add-status')).toBeEnabled();
    fireEvent.click(screen.getByTestId('add-status'));
    expect(screen.getAllByTestId('status-row')).toHaveLength(12);
    expect(screen.getByTestId('add-status')).toBeDisabled();
  });
});

describe('StatusesEditor — rename and category', () => {
  it('renames only that status, keeping its id', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Status name 2'), { target: { value: 'In review' } });
    expect(names()).toEqual(['Todo', 'In review', 'Done']);
    expect(current[1].id).toBe('doing');
  });

  it('changes the category of only that status', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Category of Doing'), { target: { value: 'done' } });
    expect(current.map((r) => r.category)).toEqual(['todo', 'done', 'done']);
  });
});

describe('StatusesEditor — reorder', () => {
  it('moves a status up', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Doing up' }));
    expect(names()).toEqual(['Doing', 'Todo', 'Done']);
  });

  it('moves a status down', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Doing down' }));
    expect(names()).toEqual(['Todo', 'Done', 'Doing']);
  });

  it('cannot move the first up or the last down', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Move Todo up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Done down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Todo down' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move Done up' })).toBeEnabled();
  });

  it('moves a status by dragging it onto another', () => {
    render(<Harness />);
    const [, , last] = screen.getAllByTestId('status-row');
    fireEvent.dragStart(screen.getAllByTestId('status-grip')[0], { dataTransfer: { effectAllowed: '' } });
    fireEvent.drop(last);
    expect(names()).toEqual(['Doing', 'Done', 'Todo']);
  });

  it('does nothing when dropped on itself, or with nothing dragged', () => {
    render(<Harness />);
    const [first, second] = screen.getAllByTestId('status-row');
    fireEvent.dragStart(screen.getAllByTestId('status-grip')[0], { dataTransfer: { effectAllowed: '' } });
    fireEvent.drop(first);
    fireEvent.drop(second);
    expect(names()).toEqual(['Todo', 'Doing', 'Done']);
  });
});

describe('StatusesEditor — remove', () => {
  it('asks to remove the row clicked', () => {
    const onRemove = vi.fn();
    render(<Harness onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Doing' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove.mock.calls[0][0]).toMatchObject({ id: 'doing', name: 'Doing' });
  });

  it('cannot remove the only status', () => {
    render(<Harness initial={toStatusRows(SAVED.slice(0, 1))} />);
    expect(screen.getByRole('button', { name: 'Remove Todo' })).toBeDisabled();
  });
});

describe('StatusesEditor — where the issues of a removed status go', () => {
  const REMOVED = SAVED[1];
  const KEPT = toStatusRows([SAVED[0], SAVED[2]]);

  it('asks for a removed status with issues', () => {
    render(<Harness initial={KEPT} removed={[REMOVED]} counts={{ doing: 3 }} />);
    expect(screen.getByTestId('status-move')).toHaveTextContent('«Doing» is being removed. Move its 3 issues to');
  });

  it('says issue in the singular', () => {
    render(<Harness initial={KEPT} removed={[REMOVED]} counts={{ doing: 1 }} />);
    expect(screen.getByTestId('status-move')).toHaveTextContent('Move its 1 issue to');
  });

  it('does not ask for a removed status with no issues', () => {
    render(<Harness initial={KEPT} removed={[REMOVED]} counts={{ doing: 0, todo: 5 }} />);
    expect(screen.queryByTestId('status-move')).not.toBeInTheDocument();
  });

  it('does not ask for a removed status it has no count for', () => {
    render(<Harness initial={KEPT} removed={[REMOVED]} counts={{}} />);
    expect(screen.queryByTestId('status-move')).not.toBeInTheDocument();
  });

  it('does not ask for a status with issues that is still there', () => {
    render(<Harness counts={{ doing: 3 }} />);
    expect(screen.queryByTestId('status-move')).not.toBeInTheDocument();
  });

  it('asks only for the ones with issues, when several are removed', () => {
    render(<Harness initial={toStatusRows([SAVED[2]])} removed={[SAVED[0], SAVED[1]]} counts={{ doing: 2 }} />);
    const asks = screen.getAllByTestId('status-move');
    expect(asks).toHaveLength(1);
    expect(asks[0]).toHaveTextContent('«Doing»');
  });

  it('offers the statuses already saved, with no choice made at first', () => {
    const unsaved: StatusRow = { rowKey: 'new-0', name: 'Unsaved', category: 'in-progress' };
    render(<Harness initial={[...KEPT, unsaved]} removed={[REMOVED]} counts={{ doing: 1 }} />);
    const select = within(screen.getByTestId('status-move')).getByRole('combobox');
    expect(Array.from(select.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['Choose…', 'Todo', 'Done']);
    expect(select).toHaveValue('');
  });

  it('shows the name a kept status is being given', () => {
    render(<Harness initial={[{ ...KEPT[0], name: 'Backlog' }, KEPT[1]]} removed={[REMOVED]} counts={{ doing: 1 }} />);
    const select = within(screen.getByTestId('status-move')).getByRole('combobox');
    expect(select).toHaveTextContent('Backlog');
  });

  it('reports the choice, by id', () => {
    const onMoveChange = vi.fn();
    render(<Harness initial={KEPT} removed={[REMOVED]} counts={{ doing: 1 }} onMoveChange={onMoveChange} />);
    fireEvent.change(screen.getByLabelText('Where the issues of Doing go'), { target: { value: 'done' } });
    expect(onMoveChange).toHaveBeenCalledWith('doing', 'done');
  });

  it('shows the choice already made', () => {
    render(<Harness initial={KEPT} removed={[REMOVED]} counts={{ doing: 1 }} moves={{ doing: 'done' }} />);
    expect(screen.getByLabelText('Where the issues of Doing go')).toHaveValue('done');
  });
});
