import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LabelsInput } from '../../src/components/shared/LabelsInput';

/** Holds the labels like a form does. */
function Harness({ initial = [], onChange, disabled }: { initial?: string[]; onChange?: (labels: string[]) => void; disabled?: boolean }) {
  const [labels, setLabels] = useState(initial);
  return (
    <>
      <LabelsInput labels={labels} disabled={disabled} onChange={(next) => { setLabels(next); onChange?.(next); }} />
      <output data-testid="labels">{labels.join('|')}</output>
    </>
  );
}

const input = () => screen.getByRole('textbox', { name: 'Add a label' });
const labels = () => screen.getByTestId('labels').textContent;

describe('LabelsInput', () => {
  it('adds a label on Enter and empties the field', async () => {
    render(<Harness />);
    await userEvent.type(input(), 'bug{Enter}');
    expect(labels()).toBe('bug');
    expect(input()).toHaveValue('');
  });

  it('adds a label on a comma, without the comma', async () => {
    render(<Harness />);
    await userEvent.type(input(), 'bug,');
    expect(labels()).toBe('bug');
    expect(input()).toHaveValue('');
  });

  it('adds several in a row, keeping their order', async () => {
    render(<Harness />);
    await userEvent.type(input(), 'one,two{Enter}three,');
    expect(labels()).toBe('one|two|three');
  });

  it('shows each label as a chip with its remove button', () => {
    render(<Harness initial={['ui', 'api']} />);
    expect(screen.getByRole('button', { name: 'Remove label ui' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove label api' })).toBeInTheDocument();
  });

  it('trims what was typed', async () => {
    render(<Harness />);
    await userEvent.type(input(), '  spaced  {Enter}');
    expect(labels()).toBe('spaced');
  });

  it('ignores a duplicate, and still empties the field', async () => {
    const onChange = vi.fn();
    render(<Harness initial={['bug']} onChange={onChange} />);
    await userEvent.type(input(), 'bug{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(labels()).toBe('bug');
    expect(input()).toHaveValue('');
  });

  it('ignores an empty label', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.type(input(), '   {Enter}');
    await userEvent.type(input(), ',');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes only the label clicked', async () => {
    const onChange = vi.fn();
    render(<Harness initial={['one', 'two', 'three']} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove label two' }));
    expect(onChange).toHaveBeenCalledWith(['one', 'three']);
    expect(screen.queryByRole('button', { name: 'Remove label two' })).not.toBeInTheDocument();
  });

  it('adds what was typed when leaving the field', async () => {
    render(<Harness />);
    await userEvent.type(input(), 'typed');
    await userEvent.tab();
    expect(labels()).toBe('typed');
  });

  it('does not add a label beyond the limit of 20', async () => {
    const initial = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const onChange = vi.fn();
    render(<Harness initial={initial} onChange={onChange} />);
    await userEvent.type(input(), 'one-more{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not submit the form around it on Enter', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<form onSubmit={onSubmit}><Harness /></form>);
    await userEvent.type(input(), 'bug{Enter}');
    expect(labels()).toBe('bug');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('can do nothing while disabled', () => {
    const onChange = vi.fn();
    render(<Harness initial={['ui']} onChange={onChange} disabled />);
    expect(input()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove label ui' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove label ui' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
