/**
 * Daily logical backup. Run this on a machine that has pg_dump, not on Vercel.
 * Uses DIRECT_URL (owner, direct host). The file is encrypted before it is written.
 *
 *   node scripts/backup-database.mjs
 *   node scripts/backup-database.mjs --production
 *   node scripts/backup-database.mjs --decrypt path/to/file.dump.enc --out path/to/file.dump
 *
 * BACKUP_DIR must be an absolute path outside this repository.
 * BACKUP_ENCRYPTION_KEY is the passphrase. It is not stored in the file.
 * A dump of the production host requires --production.
 */
import "dotenv/config";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("AVBK1");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function backupKey() {
  const raw = process.env.BACKUP_ENCRYPTION_KEY?.trim() ?? "";
  if (raw.length < 16) {
    fail("Set BACKUP_ENCRYPTION_KEY to at least 16 characters. Keep it outside the repository.");
  }
  return createHash("sha256").update(raw).digest();
}

function databaseTarget() {
  const raw = process.env.DIRECT_URL?.trim() ?? "";
  if (!raw) fail("Set DIRECT_URL to the owner connection on the direct host.");
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("DIRECT_URL is not a valid database URL.");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) fail("DIRECT_URL has no database name.");
  const host = url.hostname;
  const productionHost = (process.env.PRODUCTION_DATABASE_HOST ?? "").trim();
  const production = productionHost && host === productionHost;
  if (production && !process.argv.includes("--production")) {
    fail("DIRECT_URL points at PRODUCTION_DATABASE_HOST. Pass --production to dump it.");
  }
  return {
    database,
    host,
    env: {
      ...process.env,
      PGHOST: host,
      PGPORT: url.port || "5432",
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: database,
      PGSSLMODE: url.searchParams.get("sslmode") || "require",
    },
  };
}

function assertBackupDir() {
  const configured = process.env.BACKUP_DIR?.trim() ?? "";
  if (!configured || !path.isAbsolute(configured)) {
    fail("Set BACKUP_DIR to an absolute folder outside this repository.");
  }
  const target = path.resolve(configured);
  const root = path.resolve(process.cwd());
  if (target === root || target.startsWith(root + path.sep)) {
    fail("BACKUP_DIR must be outside the repository. The dump is not stored in Neon or in this project.");
  }
  return target;
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function runPgDump(env, plainPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pg_dump",
      ["--format=custom", "--no-owner", "--no-acl", "--file", plainPath],
      { env, stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new Error("pg_dump was not found. Install the PostgreSQL client tools and add them to PATH."));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `pg_dump exited with status ${code}.`));
    });
  });
}

async function encryptFile(plainPath, encryptedPath) {
  const { readFile, writeFile } = await import("node:fs/promises");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", backupKey(), iv);
  const ciphertext = path.join(tmpdir(), `avanza-backup-cipher-${process.pid}.bin`);
  try {
    await pipeline(createReadStream(plainPath), cipher, createWriteStream(ciphertext));
    const tag = cipher.getAuthTag();
    const body = await readFile(ciphertext);
    await writeFile(encryptedPath, Buffer.concat([MAGIC, iv, tag, body]), { mode: 0o600 });
  } finally {
    await rm(ciphertext, { force: true });
  }
}

async function decryptFile(encryptedPath, plainPath) {
  const { readFile, writeFile } = await import("node:fs/promises");
  const raw = await readFile(encryptedPath);
  if (raw.length < MAGIC.length + 12 + 16 || !raw.subarray(0, MAGIC.length).equals(MAGIC)) {
    fail("That file is not an Avanza backup.");
  }
  const iv = raw.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = raw.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const body = raw.subarray(MAGIC.length + 28);
  const decipher = createDecipheriv("aes-256-gcm", backupKey(), iv);
  decipher.setAuthTag(tag);
  await writeFile(plainPath, Buffer.concat([decipher.update(body), decipher.final()]), { mode: 0o600 });
}

async function dump() {
  const dir = assertBackupDir();
  const target = databaseTarget();
  await mkdir(dir, { recursive: true });
  const plain = path.join(tmpdir(), `avanza-backup-${process.pid}-${stamp()}.dump`);
  const encrypted = path.join(dir, `avanza-hrms-${target.database}-${stamp()}.dump.enc`);
  try {
    await runPgDump(target.env, plain);
    await encryptFile(plain, encrypted);
  } finally {
    await rm(plain, { force: true });
  }
  const info = await stat(encrypted);
  console.log(`Wrote ${encrypted} (${info.size} bytes) from ${target.host}/${target.database}.`);
  console.log("The file is encrypted. Restore it only onto a throwaway Neon branch first.");
}

async function decrypt() {
  const fileFlag = process.argv.indexOf("--decrypt");
  const outFlag = process.argv.indexOf("--out");
  const encrypted = process.argv[fileFlag + 1];
  const out = process.argv[outFlag + 1];
  if (!encrypted || !out || encrypted.startsWith("--") || out.startsWith("--")) {
    fail("Use --decrypt <file.dump.enc> --out <file.dump>.");
  }
  if (!path.isAbsolute(out)) fail("--out must be an absolute path outside the repository.");
  const root = path.resolve(process.cwd());
  const resolved = path.resolve(out);
  if (resolved === root || resolved.startsWith(root + path.sep)) {
    fail("--out must be outside the repository.");
  }
  await decryptFile(encrypted, resolved);
  console.log(`Decrypted to ${resolved}. Load it with pg_restore onto a throwaway branch.`);
}

if (process.argv.includes("--decrypt")) {
  await decrypt();
} else {
  await dump();
}
