import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useDetectAutofill from './useDetectAutofill';

const Probe: React.FC<{ onAutofill?: () => void }> = ({ onAutofill }) => {
  const { containerRef } = useDetectAutofill(onAutofill);
  return (
    <div ref={containerRef}>
      <input defaultValue="prefilled" />
    </div>
  );
};

const animationStart = (name: string): AnimationEvent => {
  const event = new Event('animationstart') as AnimationEvent;
  Object.defineProperty(event, 'animationName', { value: name });
  return event;
};

describe('useDetectAutofill', () => {
  it('fires onAutofill when the :autofill keyframe (`onAutofill`) starts', () => {
    const onAutofill = vi.fn();
    const { container } = render(<Probe onAutofill={onAutofill} />);
    container.querySelector('input')!.dispatchEvent(animationStart('onAutofill'));
    expect(onAutofill).toHaveBeenCalledTimes(1);
  });

  it('ignores animationstart from unrelated keyframes', () => {
    const onAutofill = vi.fn();
    const { container } = render(<Probe onAutofill={onAutofill} />);
    container.querySelector('input')!.dispatchEvent(animationStart('spin'));
    expect(onAutofill).not.toHaveBeenCalled();
  });

  it('ignores synthetic (untrusted) input events', () => {
    const onAutofill = vi.fn();
    const { container } = render(<Probe onAutofill={onAutofill} />);
    container.querySelector('input')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onAutofill).not.toHaveBeenCalled();
  });

  it('no-ops when the container has no input', () => {
    const NoInput: React.FC<{ onAutofill?: () => void }> = ({ onAutofill }) => {
      const { containerRef } = useDetectAutofill(onAutofill);
      return <div ref={containerRef} />;
    };
    expect(() => render(<NoInput onAutofill={vi.fn()} />)).not.toThrow();
  });

  it('coalesces rapid autofill signals into a single callback', () => {
    const onAutofill = vi.fn();
    const { container } = render(<Probe onAutofill={onAutofill} />);
    const input = container.querySelector('input')!;
    input.dispatchEvent(animationStart('onAutofill'));
    input.dispatchEvent(animationStart('onAutofill')); // second is swallowed by the coalescing guard
    expect(onAutofill).toHaveBeenCalledTimes(1);
  });
});
