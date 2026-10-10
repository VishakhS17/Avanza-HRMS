import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAuthAdapter } from "@/lib/auth-adapter";
import {
  companyTenantIssuer,
  evaluateSignIn,
  isCompanyEmail,
  isCompanyTenantIssuer,
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
        emailVerified: true,
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
    assert.deepEqual(
      evaluateSignIn({
        email: "asha@avanza.example",
        emailVerified: null,
        allowedDomain: domain,
        user: { status: "ACTIVE" },
      }),
      { ok: false, reason: "unverified-email" },
    );
    assert.equal(isCompanyEmail("asha@sub.avanza.example", domain), false);
  });

  it("lets the dev password form skip the email_verified claim", () => {
    assert.deepEqual(
      evaluateSignIn({
        email: "asha@avanza.example",
        emailVerified: null,
        allowedDomain: domain,
        user: { status: "ACTIVE" },
        devPassword: true,
      }),
      { ok: true },
    );
  });
});

const tenant = "11111111-2222-4333-8444-555555555555";

describe("company tenant issuer", () => {
  it("accepts one Entra tenant and rejects the common endpoints", () => {
    const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
    assert.equal(isCompanyTenantIssuer(issuer), true);
    assert.equal(isCompanyTenantIssuer("https://login.microsoftonline.com/common/v2.0"), false);
    assert.equal(isCompanyTenantIssuer("https://login.microsoftonline.com/organizations/v2.0"), false);
    assert.equal(isCompanyTenantIssuer("https://login.microsoftonline.com/consumers/v2.0"), false);
    assert.equal(isCompanyTenantIssuer("http://login.microsoftonline.com/" + tenant + "/v2.0"), false);
    assert.equal(isCompanyTenantIssuer("not a url"), false);
    assert.equal(companyTenantIssuer({ NODE_ENV: "test", AUTH_MICROSOFT_ENTRA_ID_ISSUER: issuer }), issuer);
    assert.equal(companyTenantIssuer({ NODE_ENV: "test", AUTH_MICROSOFT_ENTRA_ID_ISSUER: "" }), null);
    assert.equal(
      companyTenantIssuer({
        NODE_ENV: "test",
        AUTH_MICROSOFT_ENTRA_ID_ISSUER: "https://login.microsoftonline.com/common/v2.0",
      }),
      null,
    );
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
  it("stays off in production even when the flag and password are set", () => {
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
        NODE_ENV: "production",
        AUTH_DEV_LOGIN: "false",
      } as NodeJS.ProcessEnv),
      false,
    );
  });

  it("follows the flag and password outside production", () => {
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
    assert.equal(
      isDevLoginEnabled({
        NODE_ENV: "development",
        AUTH_DEV_LOGIN: "true",
        AUTH_DEV_PASSWORD: "",
      } as NodeJS.ProcessEnv),
      false,
    );
  });
});
