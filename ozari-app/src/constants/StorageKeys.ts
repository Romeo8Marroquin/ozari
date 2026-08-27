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
  // The order create form's silent draft — same contract, same storage, same lifetime as the
  // product one above. Both honour the `forms.saveDrafts` preference.
  ORDER_CREATE_DRAFT = 'app_order_create_draft',
  // Which maps app "abrir en mapas" should use. localStorage, and DELIBERATELY on the globals side
  // of the state taxonomy (like DEVICE_UUID and the language): it describes the DEVICE, not the
  // account — the phone either has Waze installed or it doesn't, whoever signs in on it. Clearing
  // it on logout would make a shared delivery phone re-ask every single shift.
  MAPS_APP = 'app_maps_app',
}
