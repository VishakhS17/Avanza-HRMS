import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contentSecurityPolicy, securityHeaderEntries } from "@/lib/security-headers";

describe("security headers", () => {
  it("uses a nonce in production and frame-ancestors none", () => {
    const csp = contentSecurityPolicy({ nonce: "abc+def=", dev: false, https: true });
    assert.match(csp, /script-src 'self' 'nonce-abc\+def=' 'strict-dynamic'/);
    assert.match(csp, /style-src 'self' 'nonce-abc\+def='/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /upgrade-insecure-requests/);
    assert.doesNotMatch(csp, /unsafe-eval/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    const http = contentSecurityPolicy({ nonce: "abc+def=", dev: false, https: false });
    assert.doesNotMatch(http, /upgrade-insecure-requests/);
    const names = securityHeaderEntries({ csp, production: true }).map(([name]) => name);
    assert.ok(names.includes("Strict-Transport-Security"));
    assert.ok(names.includes("X-Content-Type-Options"));
    assert.ok(names.includes("Referrer-Policy"));
    assert.ok(names.includes("X-Frame-Options"));
    assert.ok(names.includes("Permissions-Policy"));
    assert.equal(
      securityHeaderEntries({ csp, production: true }).find(([name]) => name === "X-Frame-Options")?.[1],
      "DENY",
    );
  });

  it("allows eval only in development and skips HSTS there", () => {
    const csp = contentSecurityPolicy({ nonce: "dev", dev: true });
    assert.match(csp, /unsafe-eval/);
    assert.match(csp, /unsafe-inline/);
    const names = securityHeaderEntries({ csp, production: false }).map(([name]) => name);
    assert.equal(names.includes("Strict-Transport-Security"), false);
  });
});
