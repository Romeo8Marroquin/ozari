import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gridColumnsOf, useGridColumns } from './useGridColumns';

/** The computed column template the "browser" reports — jsdom has no layout of its own. */
let template = '';
let resize: (() => void) | undefined;
const disconnect = vi.fn();

const stubLayout = (): void => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    () => ({ gridTemplateColumns: template }) as CSSStyleDeclaration,
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe(): void {}
      disconnect = disconnect;
    },
  );
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  template = '';
  resize = undefined;
});

const Probe: React.FC = () => {
  const { ref, columns } = useGridColumns<HTMLDivElement>();
  return (
    <div ref={ref}>
      <span>{`columns ${columns}`}</span>
    </div>
  );
};

describe('gridColumnsOf', () => {
  it('counts the resolved tracks of the rendered grid', () => {
    stubLayout();
    template = '233px 233px 233px';
    expect(gridColumnsOf(document.createElement('div'))).toBe(3);
  });

  it('reads one column when there is no layout to read', () => {
    stubLayout();
    template = '';
    expect(gridColumnsOf(document.createElement('div'))).toBe(1);
  });
});

describe('useGridColumns', () => {
  it('reads the grid as it mounts and again whenever it resizes', () => {
    stubLayout();
    template = '300px 300px';
    const { unmount } = render(<Probe />);
    expect(screen.getByText('columns 2')).toBeInTheDocument();

    // The sidebar opened / the window narrowed: the container query dropped a column.
    template = '400px';
    act(() => resize?.());
    expect(screen.getByText('columns 1')).toBeInTheDocument();

    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
