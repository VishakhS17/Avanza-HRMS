import "dotenv/config";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { trackTestData } from "@/test/fixtures";
import { allowedEmailDomain } from "@/lib/services/auth-policy";
import {
  authorizeSessionToken,
  createDatabaseSession,
  idleTimeoutMs,
  sessionBlockReason,
} from "@/lib/services/session";

describe("sessionBlockReason", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");

  it("rejects inactive users, expired sessions, and idle sessions", () => {
    const fresh = new Date(now.getTime() - 60_000);
    const expires = new Date(now.getTime() + 60_000);
    assert.equal(
      sessionBlockReason({
        status: "INACTIVE",
        expires,
        lastActiveAt: fresh,
        now,
        idleTimeoutMs: 60_000,
      }),
      "inactive",
    );
    assert.equal(
      sessionBlockReason({
        status: "ACTIVE",
        expires: new Date(now.getTime() - 1),
        lastActiveAt: fresh,
        now,
        idleTimeoutMs: 60_000,
      }),
      "expired",
    );
    assert.equal(
      sessionBlockReason({
        status: "ACTIVE",
        expires,
        lastActiveAt: new Date(now.getTime() - 61_000),
        now,
        idleTimeoutMs: 60_000,
      }),
      "idle",
    );
    assert.equal(
      sessionBlockReason({
        status: "ACTIVE",
        expires,
        lastActiveAt: fresh,
        now,
        idleTimeoutMs: 60_000,
      }),
      null,
    );
  });

  it("uses a shorter idle window for admin roles", () => {
    const timeouts = {
      ...process.env,
      AUTH_ADMIN_IDLE_TIMEOUT_MINUTES: "15",
      AUTH_IDLE_TIMEOUT_MINUTES: "480",
    };
    const admin = idleTimeoutMs(["SUPER_ADMIN", "EMPLOYEE"], timeouts);
    const employee = idleTimeoutMs(["EMPLOYEE"], timeouts);
    assert.equal(admin, 15 * 60 * 1000);
    assert.equal(employee, 480 * 60 * 1000);
    assert.ok(admin < employee);
    assert.equal(
      idleTimeoutMs(["HR_ADMIN"], {
        ...process.env,
        AUTH_ADMIN_IDLE_TIMEOUT_MINUTES: "",
        AUTH_IDLE_TIMEOUT_MINUTES: "",
      }),
      15 * 60 * 1000,
    );
  });
});

describe("deactivation check", () => {
  const { userIds: createdIds } = trackTestData();

  it("rejects the next request after the user is deactivated", async () => {
    const domain = allowedEmailDomain();
    assert.ok(domain, "AUTH_ALLOWED_EMAIL_DOMAIN is required for this test");
    const user = await getDb().user.create({
      data: {
        name: "Deactivate Me",
        email: `deactivate-${crypto.randomUUID()}@${domain}`,
        status: "ACTIVE",
        roles: ["EMPLOYEE"],
      },
    });
    createdIds.push(user.id);

    const session = await createDatabaseSession(user.id);
    const allowed = await authorizeSessionToken(session.sessionToken);
    assert.equal(allowed.ok, true);

    await getDb().user.update({
      where: { id: user.id },
      data: { status: "INACTIVE", statusReason: "Left" },
    });

    const rejected = await authorizeSessionToken(session.sessionToken);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.equal(rejected.reason, "inactive");
    }

    const stored = await getDb().session.findUnique({ where: { sessionToken: session.sessionToken } });
    assert.equal(stored, null);
  });

  it("rejects an idle session on the next request", async () => {
    const domain = allowedEmailDomain();
    const user = await getDb().user.create({
      data: {
        name: "Idle Employee",
        email: `idle-${crypto.randomUUID()}@${domain}`,
        status: "ACTIVE",
        roles: ["EMPLOYEE"],
      },
    });
    createdIds.push(user.id);
    const session = await createDatabaseSession(user.id, new Date(Date.now() - 9 * 60 * 60 * 1000));
    const rejected = await authorizeSessionToken(session.sessionToken);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.equal(rejected.reason, "idle");
    }
  });
});
