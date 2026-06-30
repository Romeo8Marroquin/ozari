import { useSyncExternalStore } from 'react';
import {
  clearDebug,
  getDebugLines,
  getDebugVersion,
  isDebugEnabled,
  subscribeDebug,
} from '@utils/debug';

/**
 * TEMPORARY on-screen console for debugging on a real phone (no devtools). Renders only when the
 * URL has `?debug`. Anchored at the TOP so it never covers the form's submit button, semi-opaque,
 * scrollable. Remove together with `@utils/debug` once the mobile login issue is resolved.
 */
const DebugOverlay: React.FC = () => {
  // Subscribe to the version counter (a primitive that actually changes) and read the lines
  // separately — the lines array is mutated in place, so it can't be the snapshot itself.
  useSyncExternalStore(subscribeDebug, getDebugVersion, getDebugVersion);
  const lines = getDebugLines();

  if (!isDebugEnabled()) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[99999] max-h-[40vh] overflow-auto bg-black/85 p-2 font-mono text-[10px] leading-tight text-lime-300">
      <button
        type="button"
        onClick={clearDebug}
        className="sticky top-0 mb-1 rounded bg-lime-300 px-2 py-0.5 text-[10px] font-bold text-black"
      >
        clear ({lines.length})
      </button>
      {lines.map((line, index) => (
        <div key={index} className="whitespace-pre-wrap break-words">
          {line}
        </div>
      ))}
    </div>
  );
};

export default DebugOverlay;
