import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAuthAdapter } from "@/lib/auth-adapter";
import {
  evaluateSignIn,
  isCompanyEmail,
  isDevLoginEnabled,
  rejectSelfSignup,
} from "@/lib/services/auth-policy";

const domain = "avanza.example";

describe("evaluateSignIn", () => {
  it("allows only an existing active user on the company domain", () => {
    assert.deepEqual(
      evaluateSignIn({
        email: "Asha@Avanza.Example",
        emailVerified: true,
        allowedDomain: domain,
        user: { status: "ACTIVE" },
      }),
      { ok: true },
    );
  });

  it("rejects unknown, inactive, wrong-domain, and unverified emails", () => {
    assert.equal(
      evaluateSignIn({
        email: "new@avanza.example",
        emailVerified: true,
        allowedDomain: domain,
        user: null,
      }).ok,
      false,
    );
    assert.deepEqual(
      evaluateSignIn({
        email: "asha@avanza.example",
        emailVerified: null,
        allowedDomain: domain,
        user: { status: "INACTIVE" },
      }),
      { ok: false, reason: "inactive" },
    );
    assert.deepEqual(
      evaluateSignIn({
        email: "asha@gmail.com",
        emailVerified: true,
        allowedDomain: domain,
        user: { status: "ACTIVE" },
      }),
      { ok: false, reason: "wrong-domain" },
    );
    assert.deepEqual(
      evaluateSignIn({
        email: "asha@avanza.example",
        emailVerified: false,
        allowedDomain: domain,
        user: { status: "ACTIVE" },
      }),
      { ok: false, reason: "unverified-email" },
    );
    assert.equal(isCompanyEmail("asha@sub.avanza.example", domain), false);
  });
});

describe("self-signup", () => {
  it("refuses to create a user from the auth adapter", async () => {
    assert.throws(rejectSelfSignup, /Self-signup is disabled/);
    const createUser = createAuthAdapter().createUser;
    assert.ok(createUser);
    await assert.rejects(
      async () => {
        await createUser({
          id: "new",
          email: "new@avanza.example",
          emailVerified: null,
          name: "New",
        });
      },
      /Self-signup is disabled/,
    );
  });
});

describe("isDevLoginEnabled", () => {
  it("is off in production even when the flag is set", () => {
    assert.equal(
      isDevLoginEnabled({
        NODE_ENV: "production",
        AUTH_DEV_LOGIN: "true",
        AUTH_DEV_PASSWORD: "secret",
      } as NodeJS.ProcessEnv),
      false,
    );
    assert.equal(
      isDevLoginEnabled({
        NODE_ENV: "development",
        AUTH_DEV_LOGIN: "true",
        AUTH_DEV_PASSWORD: "secret",
      } as NodeJS.ProcessEnv),
      true,
    );
    assert.equal(
      isDevLoginEnabled({
        NODE_ENV: "development",
        AUTH_DEV_LOGIN: "false",
        AUTH_DEV_PASSWORD: "secret",
      } as NodeJS.ProcessEnv),
      false,
    );
  });
});
