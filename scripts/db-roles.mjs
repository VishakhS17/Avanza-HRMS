/**
 * Sets up the restricted app role `avanza_hrms_app` and checks its audit_log privileges.
 *
 * Connects with DIRECT_URL (the owner role). Run it after `npm run db:migrate`, which
 * creates the role and its grants. This script turns on LOGIN and sets a password the
 * first time, then prints the DATABASE_URL to put in .env. Pass --rotate to set a new
 * password. Running it again without --rotate changes nothing.
 *
 * On Neon, create this role here or in SQL, never in the Console, CLI, or API: roles made
 * there are added to neon_superuser, which can UPDATE and DELETE every table.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import pg from "pg";

const appRole = "avanza_hrms_app";
const rotate = process.argv.includes("--rotate");
const directUrl = process.env.DIRECT_URL;

if (!directUrl) {
  console.error("DIRECT_URL is not set. It must be the owner role's direct connection string.");
  process.exit(1);
}

function appDatabaseUrl(password) {
  const url = new URL(directUrl);
  url.username = appRole;
  url.password = password;
  const [first, ...rest] = url.hostname.split(".");
  if (url.hostname.endsWith(".neon.tech") && !first.endsWith("-pooler")) {
    url.hostname = [`${first}-pooler`, ...rest].join(".");
  }
  return url.toString();
}

const client = new pg.Client({ connectionString: directUrl });
await client.connect();

let failed = false;
try {
  const who = await client.query("SELECT current_user AS name");
  if (who.rows[0].name === appRole) {
    throw new Error(`DIRECT_URL connects as ${appRole}. It must use the owner role.`);
  }

  const existing = await client.query(
    `SELECT rolcanlogin, rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls AS elevated
     FROM pg_roles WHERE rolname = $1`,
    [appRole],
  );
  if (existing.rowCount === 0) {
    throw new Error(`Role ${appRole} does not exist. Run npm run db:migrate first.`);
  }
  if (existing.rows[0].elevated) {
    failed = true;
    console.error(`${appRole} has SUPERUSER, CREATEROLE, CREATEDB, REPLICATION, or BYPASSRLS. Remove them.`);
  }

  await client.query(`ALTER ROLE ${appRole} WITH LOGIN`);

  if (!existing.rows[0].rolcanlogin || rotate) {
    const password = randomBytes(24).toString("base64url");
    await client.query(`ALTER ROLE ${appRole} WITH PASSWORD ${client.escapeLiteral(password)}`);
    console.log(`Set a new password for ${appRole}. Put this in .env (and the host's env) as DATABASE_URL:\n`);
    console.log(`DATABASE_URL="${appDatabaseUrl(password)}"\n`);
  } else {
    console.log(`${appRole} can log in. Password unchanged. Pass --rotate to set a new one.`);
  }

  const memberships = await client.query(
    `SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
     WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = $1)`,
    [appRole],
  );
  if (memberships.rowCount > 0) {
    failed = true;
    console.error(
      `${appRole} is a member of ${memberships.rows.map((row) => row.rolname).join(", ")}. Revoke those memberships.`,
    );
  }

  const owned = await client.query(
    `SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = $1)`,
    [appRole],
  );
  if (owned.rows[0].count > 0) {
    failed = true;
    console.error(`${appRole} owns ${owned.rows[0].count} objects in public. Reassign them to the owner role.`);
  }

  const privileges = await client.query(
    `SELECT p AS privilege, has_table_privilege($1, 'audit_log', p) AS granted
     FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p`,
    [appRole],
  );
  const expected = { SELECT: true, INSERT: true, UPDATE: false, DELETE: false, TRUNCATE: false };
  for (const row of privileges.rows) {
    const ok = row.granted === expected[row.privilege];
    failed ||= !ok;
    console.log(`audit_log ${row.privilege.padEnd(8)} ${row.granted ? "granted" : "denied "} ${ok ? "ok" : "WRONG"}`);
  }
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : error);
} finally {
  await client.end();
}

process.exit(failed ? 1 : 0);
