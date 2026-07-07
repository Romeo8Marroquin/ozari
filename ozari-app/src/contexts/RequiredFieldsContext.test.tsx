import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import useRequiredPatterns, { RequiredPatternsContext } from './RequiredFieldsContext';

describe('useRequiredPatterns', () => {
  it('defaults to an empty pattern list with no provider', () => {
    const { result } = renderHook(() => useRequiredPatterns());
    expect(result.current).toEqual([]);
  });

  it('returns the provided patterns', () => {
    const patterns = [/email/, /password/];
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RequiredPatternsContext.Provider value={{ requiredPatterns: patterns }}>
        {children}
      </RequiredPatternsContext.Provider>
    );
    const { result } = renderHook(() => useRequiredPatterns(), { wrapper });
    expect(result.current).toBe(patterns);
  });
});
