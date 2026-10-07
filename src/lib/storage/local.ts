import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { contentDisposition } from "@/lib/storage/files";
import { StorageConfigError, type DocumentStorage, type SignedUrlOptions } from "@/lib/storage/types";

/**
 * Local disk adapter for development and tests. Refuses production.
 * The signed URL carries an AES-GCM token, so the storage key is not readable from the URL
 * and any change to the token fails authentication.
 */
export const LOCAL_FILE_ROUTE = "/api/storage/local";

const KEY_PATTERN = /^[a-z0-9][a-z0-9/-]{0,199}$/;

type TokenPayload = { k: string; e: number; n: string; t: string };

// The turbopackIgnore hints keep build tracing from copying the whole project into the server
// output. This adapter never runs in production, so nothing on disk needs to ship.
function rootDir(): string {
  const configured = process.env.STORAGE_LOCAL_DIR?.trim();
  return path.resolve(/*turbopackIgnore: true*/ configured || path.join(process.cwd(), ".data", "storage"));
}

function tokenKey(): Buffer {
  const secret = process.env.STORAGE_SIGNING_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new StorageConfigError("STORAGE_SIGNING_SECRET must be set to at least 32 characters.");
  }
  return createHash("sha256").update(`avanza-local-storage:${secret}`).digest();
}

function assertNotProduction() {
  if (process.env.NODE_ENV === "production") {
    throw new StorageConfigError("Local document storage is for development only. Use STORAGE_DRIVER=s3.");
  }
}

function filePath(key: string): string {
  if (!KEY_PATTERN.test(key) || key.includes("..")) {
    throw new Error("Invalid storage key.");
  }
  const root = rootDir();
  const resolved = path.resolve(/*turbopackIgnore: true*/ root, key);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid storage key.");
  }
  return resolved;
}

export function sealLocalToken(payload: TokenPayload): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

function openLocalToken(token: string): TokenPayload | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", tokenKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(json) as TokenPayload;
    if (typeof parsed.k !== "string" || typeof parsed.e !== "number") return null;
    return parsed;
  } catch (error) {
    if (error instanceof StorageConfigError) throw error;
    return null;
  }
}

export function createLocalStorage(): DocumentStorage {
  assertNotProduction();
  tokenKey();
  return {
    async put(key, body) {
      const target = filePath(key);
      await mkdir(/*turbopackIgnore: true*/ path.dirname(target), { recursive: true });
      await writeFile(/*turbopackIgnore: true*/ target, body, { flag: "wx" });
    },
    async signedUrl(key: string, options: SignedUrlOptions) {
      filePath(key);
      const token = sealLocalToken({
        k: key,
        e: Date.now() + options.expiresInSeconds * 1000,
        n: options.fileName,
        t: options.contentType,
      });
      return `${LOCAL_FILE_ROUTE}?token=${token}`;
    },
    async remove(key) {
      await rm(/*turbopackIgnore: true*/ filePath(key), { force: true });
    },
  };
}

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** Serves one file for a valid, unexpired token. Used by the local storage route only. */
export async function serveLocalFile(token: string | null, now: number = Date.now()): Promise<Response> {
  assertNotProduction();
  if (!token) return notFound();
  const payload = openLocalToken(token);
  if (!payload) return notFound();
  if (payload.e <= now) {
    return new Response("This link has expired. Open the document again.", {
      status: 410,
      headers: { "Cache-Control": "no-store" },
    });
  }
  let body: Buffer;
  try {
    body = await readFile(/*turbopackIgnore: true*/ filePath(payload.k));
  } catch {
    return notFound();
  }
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": payload.t,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": contentDisposition(payload.n),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
