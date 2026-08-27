import { useQuery } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import type { OzariSuccessResponse } from '../../../types/api.types';

interface TermsResponse {
  terms: string;
}

/**
 * The business's published terms (`GET /legal/terms`) — a **public** read, because the people who
 * most need them are the ones being asked to ACCEPT them at registration, who have no session yet.
 *
 * `skipErrorNotification`: failing to load the terms must stay invisible. The register form works
 * perfectly well without them, and a toast complaining about a document the visitor has not asked
 * for would be noise about something they were not doing.
 *
 * `staleTime: Infinity` — terms change when an admin edits them, which is roughly never within one
 * visit, and `retry: false` because the answer is either there or it isn't.
 */
export function useTerms() {
  return useQuery({
    queryKey: [QueryKeys.TERMS],
    queryFn: async () => {
      const response = await api.get<OzariSuccessResponse<TermsResponse>>('/legal/terms', {
        public: true,
        skipErrorNotification: true,
      });
      return response.data.data?.terms ?? '';
    },
    staleTime: Infinity,
    retry: false,
  });
}

/**
 * Are there terms worth OFFERING to read?
 *
 * Whitespace does not count, and neither does a failed or in-flight request: the link appears only
 * once we genuinely have something behind it. Anything else would put a control on screen that
 * opens an empty dialog — which reads as the business having no terms *and* a broken app, when the
 * truth is one or the other.
 */
export const hasReadableTerms = (terms: string | undefined): boolean =>
  terms !== undefined && terms.trim() !== '';
