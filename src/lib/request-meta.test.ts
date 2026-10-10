import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientIp } from "@/lib/request-meta";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("clientIp", () => {
  it("uses the Vercel header and ignores a client-supplied X-Forwarded-For", () => {
    assert.equal(
      clientIp(
        headers({
          "x-forwarded-for": "198.51.100.9, 203.0.113.4",
          "x-vercel-forwarded-for": "203.0.113.4",
        }),
      ),
      "203.0.113.4",
    );
    assert.equal(clientIp(headers({ "x-forwarded-for": "198.51.100.9" })), null);
  });

  it("falls back to x-real-ip off Vercel and stores nothing when that is missing", () => {
    assert.equal(clientIp(headers({ "x-real-ip": "192.0.2.8" })), "192.0.2.8");
    assert.equal(clientIp(headers({})), null);
  });
});
