/**
 * Unit tests for ArcAutocomplete — arc combobox component.
 * Suggestions come from the `arcs` prop (derived from the loaded tasks); the
 * component does no fetching. Tests: rendering, keyboard nav, clear button,
 * filtering, free-text entry, ARIA attributes.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ArcAutocomplete } from '../../src/components/shared/ArcAutocomplete';

const ARCS = ['AUTH', 'LOOP', 'QOL'];

const DEFAULT_PROPS = {
  value: '',
  onChange: vi.fn(),
  arcs: ARCS,
};

describe('ArcAutocomplete', () => {
  it('renders_combobox_with_correct_aria_attributes', () => {
    render(<ArcAutocomplete {...DEFAULT_PROPS} />);
    const input = screen.getByRole('combobox');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-haspopup', 'listbox');
    expect(input).toHaveAttribute('aria-controls', 'arc-autocomplete-listbox');
  });

  it('shows_suggestions_from_arcs_prop_on_focus', async () => {
    render(<ArcAutocomplete {...DEFAULT_PROPS} />);
    fireEvent.focus(screen.getByRole('combobox'));
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'AUTH' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'LOOP' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'QOL'  })).toBeInTheDocument();
    });
  });

  it('listbox_has_correct_id_for_aria_controls', async () => {
    render(<ArcAutocomplete {...DEFAULT_PROPS} />);
    fireEvent.focus(screen.getByRole('combobox'));
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toHaveAttribute('id', 'arc-autocomplete-listbox');
    });
  });

  it('ArrowDown_opens_dropdown', async () => {
    render(<ArcAutocomplete {...DEFAULT_PROPS} />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
  });

  it('Enter_selects_highlighted_option_and_closes_dropdown', async () => {
    const onChange = vi.fn();
    render(<ArcAutocomplete {...DEFAULT_PROPS} onChange={onChange} />);
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await waitFor(() => screen.getByRole('listbox'));
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('AUTH'));
  });

  it('Escape_closes_dropdown', async () => {
    render(<ArcAutocomplete {...DEFAULT_PROPS} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    await waitFor(() => screen.getByRole('listbox'));
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('typing_filters_suggestions_to_matching_options', async () => {
    render(<ArcAutocomplete {...DEFAULT_PROPS} value="AU" onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole('combobox'));
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'AUTH' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'LOOP' })).not.toBeInTheDocument();
    });
  });

  it('clear_button_appears_when_value_is_non_empty', () => {
    render(<ArcAutocomplete {...DEFAULT_PROPS} value="QOL" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /clear arc/i })).toBeInTheDocument();
  });

  it('clear_button_absent_when_value_is_empty', () => {
    render(<ArcAutocomplete {...DEFAULT_PROPS} value="" />);
    expect(screen.queryByRole('button', { name: /clear arc/i })).not.toBeInTheDocument();
  });

  it('clear_button_calls_onChange_with_empty_string', () => {
    const onChange = vi.fn();
    render(<ArcAutocomplete {...DEFAULT_PROPS} value="QOL" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /clear arc/i }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('dropdown_hidden_when_no_options_match_filter', () => {
    render(<ArcAutocomplete {...DEFAULT_PROPS} value="XYZ" onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('no_listbox_when_arcs_prop_is_empty', () => {
    render(<ArcAutocomplete {...DEFAULT_PROPS} arcs={[]} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('accepts_free_text_not_in_suggestions', () => {
    const onChange = vi.fn();
    render(<ArcAutocomplete {...DEFAULT_PROPS} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'NEWVALUE' } });
    expect(onChange).toHaveBeenCalledWith('NEWVALUE');
  });

  it('clicking_option_calls_onChange_and_closes_dropdown', async () => {
    const onChange = vi.fn();
    render(<ArcAutocomplete {...DEFAULT_PROPS} onChange={onChange} />);
    fireEvent.focus(screen.getByRole('combobox'));
    await waitFor(() => screen.getByRole('listbox'));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'LOOP' }));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('LOOP');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });
});
