export const REDACTED = "[REDACTED]";

// Query parameters that carry credentials. Presigned URLs are bearer credentials, so every
// X-Amz-* parameter goes too.
const SECRET_QUERY_PARAM =
  /([?&;](?:access_token|refresh_token|id_token|token|client_secret|code|signed_request|api_key|apikey|password|sig|signature|X-Amz-[A-Za-z-]+)=)[^&#\s"'<>]*/gi;
// scheme://user:password@host
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi;
// Authorization header values.
const AUTH_SCHEME = /\b(Bearer|Basic|OAuth)\s+[A-Za-z0-9._~+/=-]+/gi;

/**
 * Removes credentials from free text: secret query values (tokens, OAuth codes, X-Amz-*),
 * passwords in URLs, and Bearer/Basic credentials. Everything else is kept as is.
 */
export function scrubText(text: string): string {
  return text
    .replace(SECRET_QUERY_PARAM, `$1${REDACTED}`)
    .replace(URL_PASSWORD, `$1${REDACTED}@`)
    .replace(AUTH_SCHEME, `$1 ${REDACTED}`);
}

/** Scrubs a URL before it is logged. See scrubText for what is removed. */
export function scrubUrl(url: string | URL): string {
  return scrubText(String(url));
}
