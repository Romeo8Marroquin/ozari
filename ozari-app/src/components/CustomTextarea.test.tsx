import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomTextarea from './CustomTextarea';

describe('CustomTextarea', () => {
  it('renders a labelled textarea', () => {
    render(<CustomTextarea id="desc" label="Descripción" />);
    const textarea = screen.getByLabelText(/Descripción/);
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('fires onChange and tracks the filled state', async () => {
    const onChange = vi.fn();
    render(<CustomTextarea id="desc" label="Descripción" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText(/Descripción/), 'Hola');
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByLabelText(/Descripción/)).toHaveValue('Hola');
  });

  it('starts filled when a value is provided', () => {
    render(<CustomTextarea id="desc" label="Descripción" value="texto" onChange={() => {}} />);
    expect(screen.getByLabelText(/Descripción/)).toHaveValue('texto');
  });

  it('exposes error and required state to assistive tech', () => {
    render(<CustomTextarea id="desc" label="Descripción" error isRequired />);
    const textarea = screen.getByLabelText(/Descripción/);
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).toHaveAttribute('aria-required', 'true');
  });

  it('shows the optional marker when flagged optional', () => {
    render(<CustomTextarea id="desc" label="Descripción" optionalLabel />);
    expect(screen.getByText('components.customInput.optionalField')).toBeInTheDocument();
  });

  it('can be disabled', () => {
    render(<CustomTextarea id="desc" label="Descripción" disabled />);
    expect(screen.getByLabelText(/Descripción/)).toBeDisabled();
  });

  it('forwards both object and callback refs to the textarea element', () => {
    const objectRef = { current: null as HTMLTextAreaElement | null };
    const { unmount } = render(<CustomTextarea id="desc" label="Descripción" ref={objectRef} />);
    expect(objectRef.current?.tagName).toBe('TEXTAREA');
    unmount();

    const callbackRef = vi.fn();
    render(<CustomTextarea id="desc" label="Descripción" ref={callbackRef} />);
    expect(callbackRef).toHaveBeenCalledWith(expect.objectContaining({ tagName: 'TEXTAREA' }));
  });

  it('drops the floating label when a controlled value is RESET to empty (discard-draft path)', () => {
    const isLabelFloated = (container: HTMLElement): boolean =>
      (container.querySelector('label')?.className ?? '').split(/\s+/).includes('-translate-y-6');

    const { rerender, container } = render(
      <CustomTextarea id="desc" label="Descripción" value="texto" onChange={() => {}} />,
    );
    expect(isLabelFloated(container)).toBe(true);

    rerender(<CustomTextarea id="desc" label="Descripción" value="" onChange={() => {}} />);
    expect(isLabelFloated(container)).toBe(false);
  });

  describe('autoGrow', () => {
    let originalScrollHeight: PropertyDescriptor | undefined;

    afterEach(() => {
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
      }
      originalScrollHeight = undefined;
    });

    const mockScrollHeight = (get: () => number): void => {
      originalScrollHeight ??= Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get });
    };

    it('sizes the height to the content PLUS one spare line and re-eases as the value grows', () => {
      let scrollHeight = 88;
      mockScrollHeight(() => scrollHeight);

      const { rerender } = render(
        <CustomTextarea id="desc" label="Descripción" autoGrow value="a" onChange={() => {}} />,
      );
      const textarea = screen.getByLabelText(/Descripción/);
      // jsdom reports no numeric line-height → the 24px fallback buffer: 88 + 24.
      expect(textarea.style.height).toBe('112px');
      // The handle and inner scrollbar are gone — growth replaces both — and the native floor is
      // pinned to one row so the measurement is pure content.
      expect(textarea.className).toContain('resize-none');
      expect(textarea.className).toContain('overflow-hidden');
      expect(textarea).toHaveAttribute('rows', '1');

      scrollHeight = 110; // the value wrapped onto a new line
      rerender(
        <CustomTextarea id="desc" label="Descripción" autoGrow value={'a\nb'} onChange={() => {}} />,
      );
      expect(textarea.style.height).toBe('134px');
    });

    it('uses the COMPUTED line-height for the spare line when the browser reports one', () => {
      mockScrollHeight(() => 88);
      const getComputedStyleSpy = vi
        .spyOn(window, 'getComputedStyle')
        .mockReturnValue({ lineHeight: '20px' } as CSSStyleDeclaration);

      render(<CustomTextarea id="desc" label="Descripción" autoGrow value="a" onChange={() => {}} />);
      expect((screen.getByLabelText(/Descripción/) as HTMLTextAreaElement).style.height).toBe('108px');

      getComputedStyleSpy.mockRestore();
    });

    it('keeps the native resize behaviour without autoGrow', () => {
      render(<CustomTextarea id="desc" label="Descripción" value="a" onChange={() => {}} />);
      const textarea = screen.getByLabelText(/Descripción/);
      expect(textarea.style.height).toBe('');
      expect(textarea.className).not.toContain('resize-none');
    });
  });
});
