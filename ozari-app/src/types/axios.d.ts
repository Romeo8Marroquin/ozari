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
  }
}
