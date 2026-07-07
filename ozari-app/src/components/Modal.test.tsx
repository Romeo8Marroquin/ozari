import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Modal from './Modal';
import { closeAllModals } from './modalRegistry';

// The global setup reports `prefers-reduced-motion: reduce = true`, so the modal skips its GSAP
// stagger and renders in its final accessible state. A dedicated block below flips that off to
// exercise the animated enter/exit branches.
const reducedMotionMatchMedia = window.matchMedia;

const setReducedMotion = (reduce: boolean): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

afterEach(() => {
  window.matchMedia = reducedMotionMatchMedia;
  vi.useRealTimers();
});

const getScrim = (): HTMLElement =>
  screen.getByRole('dialog').parentElement!.firstElementChild as HTMLElement;

describe('Modal', () => {
  it('renders nothing while closed', () => {
    render(<Modal open={false} onClose={vi.fn()} title="Hola" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders an accessible dialog with title, description, children and footer', () => {
    render(
      <Modal
        open
        onClose={vi.fn()}
        title="Confirmar"
        description="¿Seguro?"
        footer={<button>Aceptar</button>}
      >
        <p>Cuerpo</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Confirmar' })).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog).toHaveAttribute('aria-describedby');
    expect(screen.getByText('Cuerpo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeInTheDocument();
  });

  it('uses aria-label when there is no visible title', () => {
    render(<Modal open onClose={vi.fn()} aria-label="Sin título" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label', 'Sin título');
    expect(dialog).not.toHaveAttribute('aria-labelledby');
    expect(dialog).not.toHaveAttribute('aria-describedby');
  });

  it('supports the alertdialog role', () => {
    render(<Modal open onClose={vi.fn()} role="alertdialog" aria-label="x" />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it.each([
    ['sm', 'max-w-sm'],
    ['lg', 'max-w-lg'],
  ] as const)('applies the %s size class', (size, cls) => {
    render(<Modal open onClose={vi.fn()} size={size} aria-label="x" />);
    expect(screen.getByRole('dialog')).toHaveClass(cls);
  });

  describe('dismissal (dismissible)', () => {
    it('renders a close button that calls onClose', () => {
      const onClose = vi.fn();
      render(<Modal open onClose={onClose} title="t" />);
      fireEvent.click(screen.getByRole('button', { name: 'components.modal.close' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on backdrop click', () => {
      const onClose = vi.fn();
      render(<Modal open onClose={onClose} title="t" />);
      fireEvent.click(getScrim());
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape', () => {
      const onClose = vi.fn();
      render(<Modal open onClose={onClose} title="t" />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('non-dismissible', () => {
    it('renders no close button and ignores backdrop + Escape', () => {
      const onClose = vi.fn();
      render(<Modal open onClose={onClose} title="t" dismissible={false} />);
      expect(screen.queryByRole('button', { name: 'components.modal.close' })).not.toBeInTheDocument();
      fireEvent.click(getScrim());
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('locked', () => {
    it('disables the close button and suspends backdrop + Escape', () => {
      const onClose = vi.fn();
      render(<Modal open onClose={onClose} title="t" locked />);
      expect(screen.getByRole('button', { name: 'components.modal.close' })).toBeDisabled();
      fireEvent.click(getScrim());
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('focus management', () => {
    it('moves focus to the [data-modal-autofocus] element on open', () => {
      vi.useFakeTimers();
      render(
        <Modal open onClose={vi.fn()} title="t">
          <input aria-label="nombre" />
          <input data-modal-autofocus aria-label="apellido" />
        </Modal>,
      );
      act(() => vi.advanceTimersByTime(20));
      expect(screen.getByLabelText('apellido')).toHaveFocus();
    });

    it('moves focus to the first focusable when there is no autofocus target', () => {
      vi.useFakeTimers();
      render(
        <Modal open onClose={vi.fn()} title="t">
          <input aria-label="nombre" />
        </Modal>,
      );
      act(() => vi.advanceTimersByTime(20));
      // The close button is the first focusable in the DOM.
      expect(screen.getByRole('button', { name: 'components.modal.close' })).toHaveFocus();
    });

    it('handles having no focusable elements at all', () => {
      vi.useFakeTimers();
      render(<Modal open onClose={vi.fn()} title="Solo texto" dismissible={false} />);
      act(() => vi.advanceTimersByTime(20));
      // Tab is a no-op when nothing is focusable (exercises the empty-focusables guard).
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('traps Tab within the modal (wraps forward and backward)', () => {
      render(
        <Modal open onClose={vi.fn()} title="t" footer={<button>Guardar</button>}>
          <button>Uno</button>
        </Modal>,
      );
      const closeBtn = screen.getByRole('button', { name: 'components.modal.close' });
      const saveBtn = screen.getByRole('button', { name: 'Guardar' });

      // Forward Tab from the last focusable wraps to the first.
      saveBtn.focus();
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(closeBtn).toHaveFocus();

      // Shift+Tab from the first focusable wraps to the last.
      closeBtn.focus();
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(saveBtn).toHaveFocus();
    });

    it('lets Tab pass through when focus is in the middle of the modal', () => {
      render(
        <Modal open onClose={vi.fn()} title="t" footer={<button>Guardar</button>}>
          <button>Uno</button>
        </Modal>,
      );
      const middleBtn = screen.getByRole('button', { name: 'Uno' });

      middleBtn.focus();
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(middleBtn).toHaveFocus();

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(middleBtn).toHaveFocus();
    });

    it('does not intercept other keys', () => {
      const onClose = vi.fn();
      render(<Modal open onClose={onClose} title="t" />);
      fireEvent.keyDown(document, { key: 'a' });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('body scroll lock', () => {
    it('locks scroll while open and restores it on close', () => {
      const { rerender } = render(<Modal open onClose={vi.fn()} title="t" />);
      expect(document.body.style.overflow).toBe('hidden');
      rerender(<Modal open={false} onClose={vi.fn()} title="t" />);
      expect(document.body.style.overflow).toBe('');
    });
  });

  describe('modal registry', () => {
    it('is closed by closeAllModals while open', () => {
      const onClose = vi.fn();
      render(<Modal open onClose={onClose} title="t" />);
      closeAllModals();
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('close lifecycle', () => {
    it('stays mounted during the close animation, then unmounts', () => {
      vi.useFakeTimers();
      const { rerender } = render(<Modal open onClose={vi.fn()} title="t" />);
      act(() => vi.advanceTimersByTime(20));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      rerender(<Modal open={false} onClose={vi.fn()} title="t" />);
      // Still mounted mid-animation.
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(500));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('with animations enabled (reduced motion off)', () => {
    it('runs the GSAP enter and exit staggers for content and footer', () => {
      setReducedMotion(false);
      vi.useFakeTimers();
      const { rerender } = render(
        <Modal open onClose={vi.fn()} title="Animado" description="desc" footer={<button>Ok</button>}>
          <p>Cuerpo</p>
        </Modal>,
      );
      // Fire the enter rAF: sets `entered` and kicks off the enter fromTo tweens.
      act(() => vi.advanceTimersByTime(20));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Closing runs the exit tweens synchronously, then unmounts after the duration.
      rerender(
        <Modal open={false} onClose={vi.fn()} title="Animado" description="desc" footer={<button>Ok</button>}>
          <p>Cuerpo</p>
        </Modal>,
      );
      act(() => vi.advanceTimersByTime(500));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('animates with a footer only (no staggerable content)', () => {
      setReducedMotion(false);
      vi.useFakeTimers();
      const { rerender } = render(
        <Modal open onClose={vi.fn()} aria-label="x" footer={<button>Ok</button>} />,
      );
      act(() => vi.advanceTimersByTime(20));
      rerender(<Modal open={false} onClose={vi.fn()} aria-label="x" footer={<button>Ok</button>} />);
      act(() => vi.advanceTimersByTime(500));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('animates with staggerable content only (no footer)', () => {
      setReducedMotion(false);
      vi.useFakeTimers();
      const { rerender } = render(
        <Modal open onClose={vi.fn()} title="Solo" description="contenido" />,
      );
      act(() => vi.advanceTimersByTime(20));
      rerender(<Modal open={false} onClose={vi.fn()} title="Solo" description="contenido" />);
      act(() => vi.advanceTimersByTime(500));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
