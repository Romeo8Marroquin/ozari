import { useLayoutEffect, useState } from 'react';

/**
 * How many columns a CSS grid is RENDERING right now — read from the computed
 * `grid-template-columns`, which lists one resolved track per column (`"233px 233px 233px"`) whether
 * or not the tracks hold items. `1` when nothing can be read (no layout, as under jsdom).
 */
export function gridColumnsOf(grid: HTMLElement): number {
  return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
}

/**
 * The live column count of the grid the returned `ref` is attached to.
 *
 * Measured, never assumed from a breakpoint: inside the panel the grid's width depends on the
 * window, the sidebar and the page padding (FRONTEND-DOCTRINE §10), and the columns are a
 * container-query outcome — so the only honest answer to "how many cards fit in one row" is the
 * rendered grid itself. Re-read whenever the grid resizes; React drops a same-value update, so the
 * height-only resizes of an unfold ease cost nothing.
 *
 * `ref` is a callback (a state setter) because the grid mounts late — after the dashboard's data
 * arrives — and an object ref would not re-run the effect when it appears.
 */
export function useGridColumns<T extends HTMLElement>(): {
  ref: (element: T | null) => void;
  element: T | null;
  columns: number;
} {
  const [element, setElement] = useState<T | null>(null);
  const [columns, setColumns] = useState(1);

  useLayoutEffect(() => {
    if (!element) return;
    const read = (): void => setColumns(gridColumnsOf(element));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return { ref: setElement, element, columns };
}
