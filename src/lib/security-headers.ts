/**
 * Per-request CSP. Next.js reads the nonce from the request Content-Security-Policy
 * header and applies it to the scripts and styles it renders. Pages must be dynamic.
 */

export function contentSecurityPolicy(input: { nonce: string; dev: boolean; https?: boolean }): string {
  const nonce = input.nonce.replace(/[^A-Za-z0-9+/=_-]/g, "");
  const script = input.dev
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
  const style = input.dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`;
  // Only on an already-HTTPS response. On plain HTTP it makes the browser reload as HTTPS.
  const upgrade = !input.dev && input.https ? " upgrade-insecure-requests;" : "";
  return [
    "default-src 'self'",
    script,
    style,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
  ].join("; ") + ";" + upgrade;
}

export function securityHeaderEntries(input: { csp: string; production: boolean }): Array<[string, string]> {
  const headers: Array<[string, string]> = [
    ["Content-Security-Policy", input.csp],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "no-referrer"],
    ["X-Frame-Options", "DENY"],
    ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"],
  ];
  if (input.production) {
    headers.push(["Strict-Transport-Security", "max-age=63072000; includeSubDomains"]);
  }
  return headers;
}

export function applySecurityHeaders(
  headers: Headers,
  input: { csp: string; production: boolean },
): void {
  for (const [name, value] of securityHeaderEntries(input)) {
    headers.set(name, value);
  }
}
