import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../../src/components/shared/Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('uses primary variant by default', () => {
    const { container } = render(<Button>Primary</Button>);
    expect(container.firstChild).toHaveClass('bg-primary');
  });

  it('renders secondary variant', () => {
    const { container } = render(<Button variant="secondary">Secondary</Button>);
    expect(container.firstChild).toHaveClass('bg-surface-variant');
  });

  it('renders ghost variant', () => {
    const { container } = render(<Button variant="ghost">Ghost</Button>);
    expect(container.firstChild).toHaveClass('bg-transparent');
  });

  it('renders danger variant', () => {
    const { container } = render(<Button variant="danger">Danger</Button>);
    // ADR-003: danger button now uses bg-error token instead of hardcoded hex
    expect(container.firstChild).toHaveClass('bg-error');
  });

  it('renders icon variant', () => {
    const { container } = render(<Button variant="icon">X</Button>);
    // ADR-003: icon variant size increased from w-7 to w-8
    expect(container.firstChild).toHaveClass('w-8');
  });

  it('calls onClick when clicked', () => {
    const handler = vi.fn();
    render(<Button onClick={handler}>Click</Button>);
    fireEvent.click(screen.getByText('Click'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('is disabled when disabled prop is set', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByText('Disabled')).toBeDisabled();
  });

  it('does not call onClick when disabled', () => {
    const handler = vi.fn();
    render(<Button disabled onClick={handler}>Disabled</Button>);
    fireEvent.click(screen.getByText('Disabled'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('accepts additional className', () => {
    const { container } = render(<Button className="extra">Btn</Button>);
    expect(container.firstChild).toHaveClass('extra');
  });
});
