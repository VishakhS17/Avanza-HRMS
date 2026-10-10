import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { trackTestData } from "@/test/fixtures";
import { AUDIT_ACTIONS } from "@/lib/services/audit";
import {
  AUTH_RATE_WINDOW_MS,
  SIGN_IN_LIMIT,
  allowSignInAttempt,
  consumeAuthRateLimit,
} from "@/lib/services/auth-rate-limit";

const prefix = `test:${crypto.randomUUID()}`;
const ip = "203.0.113.10";
const email = `rate-${crypto.randomUUID()}@avanza.example`;

trackTestData();

after(async () => {
  await getDb().authRateLimit.deleteMany({
    where: {
      OR: [
        { key: { startsWith: prefix } },
        { key: { startsWith: "signin:ip:203.0.113." } },
        { key: { startsWith: "signin:email:rate-" } },
        { key: { startsWith: "signin:email:other-" } },
        { key: { startsWith: "signin:email:first-" } },
        { key: { startsWith: "signin:email:second-" } },
      ],
    },
  });
});

describe("consumeAuthRateLimit", () => {
  const keys = [`${prefix}:ip`];
  const start = new Date("2026-10-11T00:00:00.000Z");

  it("locks on the limit, stays quiet after that, and opens again when the window ends", async () => {
    for (let n = 1; n < SIGN_IN_LIMIT; n += 1) {
      const step = await consumeAuthRateLimit({ keys, limit: SIGN_IN_LIMIT, now: start });
      assert.equal(step.allowed, true);
    }
    const locked = await consumeAuthRateLimit({ keys, limit: SIGN_IN_LIMIT, now: start });
    assert.deepEqual(locked, { allowed: false, justLocked: true });
    const again = await consumeAuthRateLimit({
      keys,
      limit: SIGN_IN_LIMIT,
      now: new Date(start.getTime() + 60_000),
    });
    assert.deepEqual(again, { allowed: false, justLocked: false });
    const stored = await getDb().authRateLimit.findUniqueOrThrow({ where: { key: keys[0] } });
    assert.equal(stored.count, SIGN_IN_LIMIT);

    const reopened = await consumeAuthRateLimit({
      keys,
      limit: SIGN_IN_LIMIT,
      now: new Date(start.getTime() + AUTH_RATE_WINDOW_MS),
    });
    assert.equal(reopened.allowed, true);
  });
});

describe("allowSignInAttempt", () => {
  it("writes one lockout audit row and none for later blocked attempts", async () => {
    const before = await getDb().auditLog.count({
      where: { action: AUDIT_ACTIONS.AUTH_LOGIN_LOCKED, entityId: email },
    });
    for (let n = 1; n < SIGN_IN_LIMIT; n += 1) {
      assert.equal(
        await allowSignInAttempt({ ipAddress: ip, email, now: new Date("2026-10-11T01:00:00.000Z") }),
        true,
      );
    }
    assert.equal(
      await allowSignInAttempt({ ipAddress: ip, email, now: new Date("2026-10-11T01:00:00.000Z") }),
      false,
    );
    assert.equal(
      await allowSignInAttempt({ ipAddress: ip, email, now: new Date("2026-10-11T01:01:00.000Z") }),
      false,
    );
    const rows = await getDb().auditLog.count({
      where: { action: AUDIT_ACTIONS.AUTH_LOGIN_LOCKED, entityId: email },
    });
    assert.equal(rows - before, 1);

    const other = `other-${crypto.randomUUID()}@avanza.example`;
    assert.equal(
      await allowSignInAttempt({
        ipAddress: "203.0.113.11",
        email: other,
        now: new Date("2026-10-11T01:02:00.000Z"),
      }),
      true,
    );
    await getDb().authRateLimit.deleteMany({
      where: { key: { in: [`signin:ip:203.0.113.11`, `signin:email:${other}`] } },
    });
  });

  it("locks a second email on the same IP without another audit row for that email", async () => {
    const sharedIp = "203.0.113.20";
    const first = `first-${crypto.randomUUID()}@avanza.example`;
    const second = `second-${crypto.randomUUID()}@avanza.example`;
    const now = new Date("2026-10-11T02:00:00.000Z");
    for (let n = 0; n < SIGN_IN_LIMIT; n += 1) {
      await allowSignInAttempt({ ipAddress: sharedIp, email: first, now });
    }
    const before = await getDb().auditLog.count({
      where: { action: AUDIT_ACTIONS.AUTH_LOGIN_LOCKED, entityId: second },
    });
    assert.equal(await allowSignInAttempt({ ipAddress: sharedIp, email: second, now }), false);
    const after = await getDb().auditLog.count({
      where: { action: AUDIT_ACTIONS.AUTH_LOGIN_LOCKED, entityId: second },
    });
    assert.equal(after, before);
    await getDb().authRateLimit.deleteMany({
      where: {
        key: { in: [`signin:ip:${sharedIp}`, `signin:ip:${ip}`, `signin:email:${first}`, `signin:email:${second}`, `signin:email:${email}`] },
      },
    });
  });
});
