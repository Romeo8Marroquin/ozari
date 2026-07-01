export enum StorageKeys {
  TOKEN = 'app_auth_token',
  DEVICE_UUID = 'app_device_uuid',
  // CSRF token for the double-submit-style header. Unlike TOKEN (sessionStorage, per-tab),
  // this lives in localStorage on purpose: it's not a secret credential, and it must be
  // available cross-tab so a freshly-opened tab can attach it to its silent /auth/refresh.
  CSRF = 'app_csrf_token',
  // The inline panel sidebar's collapsed/expanded preference. localStorage (not a credential):
  // the user's manual choice survives reloads and is shared across tabs.
  PANEL_SIDEBAR_COLLAPSED = 'app_panel_sidebar_collapsed',
}
