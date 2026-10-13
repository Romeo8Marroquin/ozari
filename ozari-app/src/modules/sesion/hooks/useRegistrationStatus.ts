import { useQuery } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import type { OzariSuccessResponse } from '../../../types/api.types';

interface RegistrationStatusResponse {
  open: boolean;
}

/**
 * Whether this environment accepts new accounts (`GET /auth/registration`) — a per-environment
 * switch the SERVER owns (`registration_open`, committed per environment and closed once there are
 * enough users). The UI never guesses it: it reports what the API says, and `POST /auth/user`
 * enforces the same answer.
 *
 * `undefined` while loading or after a failure, and every consumer treats that as "do not offer
 * registration": the sign-up link appears only on a confirmed `true`. Showing it on a guess would
 * lead a visitor into a form the server is about to refuse.
 *
 * `public`: the visitor has no session. `skipErrorNotification`: failing to learn the policy is not
 * something they asked about — the link simply stays hidden. `retry: false` — the answer is either
 * there or it isn't, and the outage overlay owns a dead backend.
 */
export function useRegistrationStatus() {
  return useQuery({
    queryKey: [QueryKeys.REGISTRATION],
    queryFn: async () => {
      const response = await api.get<OzariSuccessResponse<RegistrationStatusResponse>>(
        '/auth/registration',
        { public: true, skipErrorNotification: true },
      );
      return response.data.data?.open === true;
    },
    retry: false,
  });
}
