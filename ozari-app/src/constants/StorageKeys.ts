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
  // The product create form's silent draft (autosaved as the admin types). sessionStorage on
  // purpose: it must survive a refresh / navigating away and back, but a closed tab shouldn't
  // resurrect a weeks-old half-form. User-scoped → cleared by `clearAuthState` on logout.
  PRODUCT_CREATE_DRAFT = 'app_product_create_draft',
}
