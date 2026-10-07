import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handtestDatabaseProblem, isFakeEmailDomain } from "../../scripts/handtest-guard.mjs";

const DEV = "dev-host.region.aws.neon.tech";
const PROD = "prod-host.region.aws.neon.tech";
const TEST = "test-host.region.aws.neon.tech";

function devEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    DATABASE_URL: `postgresql://avanza_hrms_app:pw@${DEV.replace(/^([^.]+)/, "$1-pooler")}/avanza_hrms_dev`,
    DIRECT_URL: `postgresql://avanza_hrms_owner:pw@${DEV}/avanza_hrms_dev`,
    TEST_DATABASE_URL: `postgresql://avanza_hrms_app:pw@${TEST.replace(/^([^.]+)/, "$1-pooler")}/avanza_hrms_test`,
    TEST_DIRECT_URL: `postgresql://avanza_hrms_owner:pw@${TEST}/avanza_hrms_test`,
    PRODUCTION_DATABASE_HOST: PROD,
    AUTH_ALLOWED_EMAIL_DOMAIN: "avanza.example",
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe("handtestDatabaseProblem", () => {
  it("allows the dev database", () => {
    assert.equal(handtestDatabaseProblem(devEnv()), null);
  });

  it("refuses production NODE_ENV", () => {
    assert.match(handtestDatabaseProblem(devEnv({ NODE_ENV: "production" })) ?? "", /NODE_ENV is production/);
  });

  it("refuses the production host, pooled or direct", () => {
    const pooled = `postgresql://avanza_hrms_app:pw@prod-host-pooler.region.aws.neon.tech/avanza_hrms_dev`;
    assert.match(handtestDatabaseProblem(devEnv({ DATABASE_URL: pooled })) ?? "", /production database host/);
    const direct = `postgresql://avanza_hrms_owner:pw@${PROD}/avanza_hrms_dev`;
    assert.match(handtestDatabaseProblem(devEnv({ DIRECT_URL: direct })) ?? "", /production database host/);
  });

  it("refuses when the production host is not configured", () => {
    assert.match(
      handtestDatabaseProblem(devEnv({ PRODUCTION_DATABASE_HOST: undefined })) ?? "",
      /PRODUCTION_DATABASE_HOST is not set/,
    );
  });

  it("refuses the test host", () => {
    const url = `postgresql://avanza_hrms_app:pw@test-host-pooler.region.aws.neon.tech/avanza_hrms_dev`;
    assert.match(handtestDatabaseProblem(devEnv({ DATABASE_URL: url })) ?? "", /test database host/);
  });

  it("refuses any database other than avanza_hrms_dev", () => {
    for (const name of ["avanza_hrms", "avanza_hrms_test", "postgres"]) {
      const url = `postgresql://avanza_hrms_app:pw@${DEV}/${name}`;
      assert.match(handtestDatabaseProblem(devEnv({ DATABASE_URL: url })) ?? "", /avanza_hrms_dev/);
    }
  });

  it("refuses a missing DATABASE_URL and a real email domain", () => {
    assert.match(handtestDatabaseProblem(devEnv({ DATABASE_URL: undefined })) ?? "", /DATABASE_URL is not set/);
    assert.match(
      handtestDatabaseProblem(devEnv({ AUTH_ALLOWED_EMAIL_DOMAIN: "avanzalogistics.com" })) ?? "",
      /reserved example domain/,
    );
  });
});

describe("isFakeEmailDomain", () => {
  it("accepts reserved example domains only", () => {
    for (const domain of ["avanza.example", "example.com", "corp.test", "@avanza.example"]) {
      assert.equal(isFakeEmailDomain(domain), true, domain);
    }
    for (const domain of ["avanza.com", "example.co", "test.avanza.com", ""]) {
      assert.equal(isFakeEmailDomain(domain), false, domain);
    }
  });
});
