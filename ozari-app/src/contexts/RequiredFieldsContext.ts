import { createContext, useContext } from 'react';

interface RequiredPatternsContext {
  requiredPatterns: RegExp[];
}

export const RequiredPatternsContext = createContext<RequiredPatternsContext>({
  requiredPatterns: [],
});

const useRequiredPatterns = () => useContext(RequiredPatternsContext).requiredPatterns;

export default useRequiredPatterns;
