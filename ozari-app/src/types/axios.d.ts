import 'axios';

declare module 'axios' {
  export interface AxiosRequestConfig {
    public?: boolean;
    deviceUuid?: boolean;
    _isRefreshRequest?: boolean;
    /** The health-check poll — exempt from the outage trigger and error toasts (it IS the probe). */
    _isHealthCheck?: boolean;
    /**
     * Opt OUT of the global "show a friendly error toast" behaviour for this request.
     * By default any failed mutation (non-GET) raises a notification; set this when the
     * caller handles the error itself (inline UI, custom toast, or a silent retry).
     */
    skipErrorNotification?: boolean;
    /**
     * A gateway status (502/503/504) on THIS request is not, by itself, proof the backend is down —
     * it is one of many small background reads (a document's row photo), where a single slow answer
     * is routine. Instead of raising the full-screen outage overlay at once, ask the health probe to
     * CONFIRM first (the same treatment a network error gets). A real outage still surfaces.
     */
    confirmOutage?: boolean;
  }
}
