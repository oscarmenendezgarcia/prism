import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../../src/components/shared/Badge';

describe('Badge', () => {
  it('renders feature badge with correct text', () => {
    render(<Badge type="feature" />);
    expect(screen.getByText('feature')).toBeInTheDocument();
  });

  it('renders bug badge', () => {
    render(<Badge type="bug" />);
    expect(screen.getByText('bug')).toBeInTheDocument();
  });

  it('renders tech-debt badge', () => {
    render(<Badge type="tech-debt" />);
    expect(screen.getByText('tech-debt')).toBeInTheDocument();
  });

  it('renders chore badge', () => {
    render(<Badge type="chore" />);
    expect(screen.getByText('chore')).toBeInTheDocument();
  });

  it('renders done badge', () => {
    render(<Badge type="done" />);
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it('applies feature purple color class via CSS custom property token', () => {
    const { container } = render(<Badge type="feature" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-badge-feature-text');
  });

  it('applies bug red color class via CSS custom property token', () => {
    const { container } = render(<Badge type="bug" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-badge-bug-text');
  });

  it('applies tech-debt yellow color class via CSS custom property token', () => {
    const { container } = render(<Badge type="tech-debt" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-badge-tech-debt-text');
  });

  it('applies chore grey color class via CSS custom property token', () => {
    const { container } = render(<Badge type="chore" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-badge-chore-text');
  });

  it('applies done green color class via CSS custom property token', () => {
    const { container } = render(<Badge type="done" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-badge-done-text');
  });

  it('accepts custom className', () => {
    const { container } = render(<Badge type="feature" className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });
});
