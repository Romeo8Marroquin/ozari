export enum QueryKeys {
  ME = 'me',
  PRODUCTS = 'products',
  PRODUCT = 'product',
  PRODUCT_CATALOG = 'product-catalog',
  PRODUCT_ARRANGEMENT = 'product-arrangement',
  ORDERS = 'orders',
  ORDER = 'order',
  ORDER_CATALOG = 'order-catalog',
  // What the products can take in the order SKETCH's window (the cart's dates) — read by the grid,
  // the detail page and the cart controls; keyed by the window + the product ids asked about.
  SKETCH_AVAILABILITY = 'sketch-availability',
  CLIENT_REGISTRIES = 'client-registries',
  PREFERENCES = 'preferences',
  DASHBOARD = 'dashboard',
  CALENDAR = 'calendar',
  TERMS = 'terms',
  REGISTRATION = 'registration',
}
