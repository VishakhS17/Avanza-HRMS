/**
 * Starts a project-local Postgres on 127.0.0.1:5433.
 * The system Postgres on 5432 is left alone. Data stays in .data/ (gitignored).
 *
 * The app role `avanza_app` is not a superuser, so the audit-log REVOKE holds.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".data", "postgres");
const passwordFile = path.join(root, ".data", "superuser-password");
const logFile = path.join(root, ".data", "postgres.log");
const port = 5433;
const appRole = "avanza_app";
const appPassword = "avanza_app";
const database = "avanza_hrms";

function binDir() {
  if (process.env.POSTGRES_BIN && existsSync(path.join(process.env.POSTGRES_BIN, "initdb.exe"))) {
    return process.env.POSTGRES_BIN;
  }

  const candidate = "C:\\Program Files\\PostgreSQL\\18\\bin";
  if (existsSync(path.join(candidate, "initdb.exe"))) {
    return candidate;
  }

  throw new Error(
    "PostgreSQL binaries were not found. Install PostgreSQL 18 or set POSTGRES_BIN.",
  );
}

function exe(name) {
  return path.join(binDir(), process.platform === "win32" ? `${name}.exe` : name);
}

function run(file, args) {
  const result = spawnSync(file, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${path.basename(file)} failed.\n${detail}`);
  }
  return result.stdout ?? "";
}

function serverStatus() {
  const result = spawnSync(exe("pg_ctl"), ["status", "-D", dataDir], { encoding: "utf8" });
  return result.status === 0;
}

function readSuperPassword() {
  if (!existsSync(passwordFile)) {
    mkdirSync(path.dirname(passwordFile), { recursive: true });
    writeFileSync(passwordFile, randomBytes(18).toString("hex"));
  }
  return readFileSync(passwordFile, "utf8").trim();
}

function initCluster(superPassword) {
  mkdirSync(path.dirname(dataDir), { recursive: true });
  const pwFile = path.join(root, ".data", "initdb-password.txt");
  writeFileSync(pwFile, superPassword);
  try {
    run(exe("initdb"), [
      "-D",
      dataDir,
      "-U",
      "postgres",
      "--auth=scram-sha-256",
      "--pwfile",
      pwFile,
      "--encoding=UTF8",
      "--locale=C",
    ]);
  } finally {
    writeFileSync(pwFile, "");
  }

  writeFileSync(
    path.join(dataDir, "postgresql.auto.conf"),
    ["port = 5433", "listen_addresses = '127.0.0.1'", ""].join("\n"),
  );
}

function startServer() {
  if (serverStatus()) {
    return;
  }

  run(exe("pg_ctl"), ["start", "-D", dataDir, "-l", logFile, "-w", "-t", "30"]);
}

function stopServer() {
  if (!existsSync(dataDir) || !serverStatus()) {
    console.log("Local Postgres is not running.");
    return;
  }

  run(exe("pg_ctl"), ["stop", "-D", dataDir, "-m", "fast", "-w", "-t", "30"]);
  console.log("Local Postgres stopped.");
}

function clientConfig(superPassword, databaseName) {
  return {
    host: "127.0.0.1",
    port,
    user: "postgres",
    password: superPassword,
    database: databaseName,
    connectionTimeoutMillis: 5000,
  };
}

async function ensureAppRole(superPassword) {
  const admin = new pg.Client(clientConfig(superPassword, "postgres"));
  await admin.connect();

  try {
    const role = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [appRole]);
    if (role.rowCount === 0) {
      await admin.query(
        `CREATE ROLE ${appRole} LOGIN PASSWORD '${appPassword}' NOSUPERUSER CREATEDB NOCREATEROLE`,
      );
    } else {
      await admin.query(
        `ALTER ROLE ${appRole} WITH LOGIN NOSUPERUSER CREATEDB NOCREATEROLE`,
      );
    }

    const template = new pg.Client(clientConfig(superPassword, "template1"));
    await template.connect();
    try {
      await template.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${appRole}`);
    } finally {
      await template.end();
    }

    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (existing.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${database} OWNER ${appRole}`);
    }
  } finally {
    await admin.end();
  }

  const appDb = new pg.Client(clientConfig(superPassword, database));
  await appDb.connect();
  try {
    await appDb.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${appRole}`);
    await appDb.query(`ALTER SCHEMA public OWNER TO ${appRole}`);
  } finally {
    await appDb.end();
  }
}

const command = process.argv[2];

if (command === "down") {
  stopServer();
} else if (command === "up") {
  const superPassword = readSuperPassword();
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    console.log("Creating a local Postgres data directory...");
    initCluster(superPassword);
  }
  console.log("Starting local Postgres...");
  startServer();
  console.log("Ensuring the app role exists...");
  await ensureAppRole(superPassword);
  execFileSync(exe("pg_isready"), ["-h", "127.0.0.1", "-p", String(port)], { stdio: "inherit" });
  console.log(`Local Postgres is ready on 127.0.0.1:${port}, database ${database}, role ${appRole}.`);
} else {
  console.error("Usage: node scripts/dev-postgres.mjs up|down");
  process.exit(1);
}
