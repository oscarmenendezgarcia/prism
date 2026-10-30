import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpaceHookSection } from '../SpaceHookSection';

describe('SpaceHookSection', () => {
  it('reports each field', () => {
    const onChange = vi.fn();
    render(<SpaceHookSection value={{ name: 'Tests', command: '' }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npm test' } });
    expect(onChange).toHaveBeenCalledWith({ name: 'Tests', command: 'npm test' });
    fireEvent.change(screen.getByLabelText('Check name'), { target: { value: 'CI' } });
    expect(onChange).toHaveBeenCalledWith({ name: 'CI', command: '' });
  });
});
