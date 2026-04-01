import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '../../src/components/shared/Modal';

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={vi.fn()}>
        <div>Content</div>
      </Modal>
    );
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  it('renders children when open', () => {
    render(
      <Modal open={true} onClose={vi.fn()}>
        <div>Modal Content</div>
      </Modal>
    );
    expect(screen.getByText('Modal Content')).toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose}>
        <div>Content</div>
      </Modal>
    );
    // Modal renders via createPortal to document.body
    const overlay = document.body.querySelector('[role="dialog"]');
    fireEvent.click(overlay!);
    // M-1: onClose fires after 180ms exit animation
    act(() => { vi.advanceTimersByTime(200); });
    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('calls onClose when Escape key is pressed', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose}>
        <div>Content</div>
      </Modal>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => { vi.advanceTimersByTime(200); });
    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('has aria-modal="true"', () => {
    render(
      <Modal open={true} onClose={vi.fn()}>
        Content
      </Modal>
    );
    // Portal renders into document.body
    expect(document.body.querySelector('[aria-modal="true"]')).toBeInTheDocument();
  });

  it('does not call onClose when modal content is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose}>
        <button>Inside button</button>
      </Modal>
    );
    fireEvent.click(screen.getByText('Inside button'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('BUG-001: unmounts after open transitions to false externally', async () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <Modal open={true} onClose={vi.fn()}>
        <div>Visible Content</div>
      </Modal>
    );
    expect(document.body.querySelector('[role="dialog"]')).toBeInTheDocument();

    // Parent sets open=false (e.g. after task creation succeeds)
    rerender(
      <Modal open={false} onClose={vi.fn()}>
        <div>Visible Content</div>
      </Modal>
    );

    // Before animation completes, modal is still in DOM (isClosing=true)
    expect(document.body.querySelector('[role="dialog"]')).toBeInTheDocument();

    // After 180ms exit animation the modal unmounts
    act(() => { vi.advanceTimersByTime(200); });
    expect(document.body.querySelector('[role="dialog"]')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe('ModalHeader', () => {
  it('renders close button and calls onClose', () => {
    const onClose = vi.fn();
    render(<ModalHeader onClose={onClose}>Header</ModalHeader>);
    fireEvent.click(screen.getByLabelText(/close modal/i));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ModalTitle', () => {
  it('renders title text with id', () => {
    render(<ModalTitle id="my-title">My Title</ModalTitle>);
    const el = screen.getByText('My Title');
    expect(el).toHaveAttribute('id', 'my-title');
  });
});

describe('ModalBody and ModalFooter', () => {
  it('renders body children', () => {
    render(<ModalBody><p>Body text</p></ModalBody>);
    expect(screen.getByText('Body text')).toBeInTheDocument();
  });

  it('renders footer children', () => {
    render(<ModalFooter><button>OK</button></ModalFooter>);
    expect(screen.getByText('OK')).toBeInTheDocument();
  });
});
