import 'axios';

declare module 'axios' {
  export interface AxiosRequestConfig {
    public?: boolean;
    deviceUuid?: boolean;
    _isRefreshRequest?: boolean;
  }
}
