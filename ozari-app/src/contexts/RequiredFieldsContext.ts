import { createContext, useContext } from 'react';

interface RequiredPatternsContext {
  requiredPatterns: RegExp[];
}

export const RequiredPatternsContext = createContext<RequiredPatternsContext>({
  requiredPatterns: [],
});

const useRequiredPatterns = () => {
  const ctx = useContext(RequiredPatternsContext);
  if (!ctx) return [];
  return ctx.requiredPatterns;
};

export default useRequiredPatterns;
