/**
 * `GET /legal/terms` — the business's terms, as written.
 *
 * An EMPTY string is a legitimate answer, not an error: a business that has published no terms is a
 * valid configuration, and the client's job is then to offer nothing to read.
 */
export interface TermsResponseModel {
  terms: string;
}
