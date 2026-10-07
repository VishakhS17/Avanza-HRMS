import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  contentDisposition,
  detectContentType,
  FileValidationError,
  MAX_UPLOAD_BYTES,
  sanitizeFileName,
  validateUpload,
} from "@/lib/storage/files";
import { createLocalStorage, LOCAL_FILE_ROUTE, serveLocalFile } from "@/lib/storage/local";

const storageDir = mkdtempSync(path.join(tmpdir(), "avanza-files-"));
process.env.STORAGE_LOCAL_DIR = storageDir;
process.env.STORAGE_SIGNING_SECRET = "files-test-secret-that-is-long-enough-123";
after(() => rmSync(storageDir, { recursive: true, force: true }));

const pdf = (body = "hello") => new TextEncoder().encode(`%PDF-1.4\n${body}`);
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function tokenOf(url: string): string {
  assert.ok(url.startsWith(`${LOCAL_FILE_ROUTE}?token=`));
  return new URL(url, "http://localhost").searchParams.get("token") ?? "";
}

describe("upload validation", () => {
  it("detects PDF, PNG, and JPEG from their first bytes", () => {
    assert.equal(detectContentType(pdf()), "application/pdf");
    assert.equal(detectContentType(png()), "image/png");
    assert.equal(detectContentType(jpeg()), "image/jpeg");
    assert.equal(detectContentType(new TextEncoder().encode("<html><script>")), null);
  });

  it("rejects wrong contents, mismatched names and types, empty files, and files over 4 MB", () => {
    assert.throws(() => validateUpload({ name: "a.pdf", type: "application/pdf", bytes: new TextEncoder().encode("not a pdf") }), FileValidationError);
    assert.throws(() => validateUpload({ name: "a.pdf", type: "image/png", bytes: png() }), /must end in/);
    assert.throws(() => validateUpload({ name: "a.png", type: "image/jpeg", bytes: png() }), /does not match/);
    assert.throws(() => validateUpload({ name: "a.svg", type: "image/svg+xml", bytes: new TextEncoder().encode("<svg/>") }), FileValidationError);
    assert.throws(() => validateUpload({ name: "a.pdf", type: "", bytes: new Uint8Array() }), /Choose a file/);
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(pdf());
    assert.throws(() => validateUpload({ name: "a.pdf", type: "application/pdf", bytes: big }), /4 MB/);
    const ok = validateUpload({ name: "Scan.JPG", type: "image/jpeg", bytes: jpeg() });
    assert.equal(ok.contentType, "image/jpeg");
  });

  it("strips paths, control characters, and header-breaking characters from file names", () => {
    assert.equal(sanitizeFileName("../../etc/passwd.pdf"), "passwd.pdf");
    assert.equal(sanitizeFileName("C:\\Users\\x\\id.pdf"), "id.pdf");
    assert.equal(sanitizeFileName('a"b\r\nSet-Cookie: x.pdf'), "a_bSet-Cookie_ x.pdf");
    assert.equal(sanitizeFileName("...hidden.pdf"), "hidden.pdf");
    assert.equal(sanitizeFileName("\u0000"), "document");
    const long = sanitizeFileName(`${"x".repeat(300)}.pdf`);
    assert.equal(long.length, 120);
    assert.ok(long.endsWith(".pdf"));
  });

  it("builds an attachment Content-Disposition with a safe ASCII name and an encoded UTF-8 name", () => {
    const header = contentDisposition('Ünïcode "quote";\r\nX-Evil: 1.pdf');
    assert.ok(header.startsWith("attachment; "));
    assert.doesNotMatch(header, /[\r\n]/);
    const ascii = /filename="([^"]*)"/.exec(header)?.[1] ?? "";
    assert.doesNotMatch(ascii, /[^\x20-\x7e]|[";\\]/);
    assert.match(header, /filename\*=UTF-8''%C3%9Cn%C3%AFcode/);
  });
});

describe("local storage signed URLs", () => {
  it("serves the file before expiry and refuses it after", async () => {
    const storage = createLocalStorage();
    await storage.put("documents/test-expiry", pdf("expiry"), "application/pdf");
    const url = await storage.signedUrl("documents/test-expiry", {
      fileName: "a.pdf",
      contentType: "application/pdf",
      expiresInSeconds: 60,
    });
    assert.doesNotMatch(url, /test-expiry/);
    const token = tokenOf(url);
    const fresh = await serveLocalFile(token);
    assert.equal(fresh.status, 200);
    assert.equal(fresh.headers.get("x-content-type-options"), "nosniff");
    assert.equal(fresh.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(new Uint8Array(await fresh.arrayBuffer()), pdf("expiry"));
    const late = await serveLocalFile(token, Date.now() + 61_000);
    assert.equal(late.status, 410);
  });

  it("rejects a tampered token and cannot be pointed at another file", async () => {
    const storage = createLocalStorage();
    await storage.put("documents/test-one", pdf("one"), "application/pdf");
    await storage.put("documents/test-two", pdf("two"), "application/pdf");
    const options = { fileName: "a.pdf", contentType: "application/pdf", expiresInSeconds: 60 };
    const one = tokenOf(await storage.signedUrl("documents/test-one", options));
    const two = tokenOf(await storage.signedUrl("documents/test-two", options));
    const flipped = `${one.slice(0, -2)}${one.endsWith("AA") ? "BB" : "AA"}`;
    assert.equal((await serveLocalFile(flipped)).status, 404);
    const spliced = Buffer.concat([
      Buffer.from(one, "base64url").subarray(0, 28),
      Buffer.from(two, "base64url").subarray(28),
    ]).toString("base64url");
    assert.equal((await serveLocalFile(spliced)).status, 404);
    assert.equal((await serveLocalFile(null)).status, 404);
    assert.deepEqual(new Uint8Array(await (await serveLocalFile(one)).arrayBuffer()), pdf("one"));
  });

  it("refuses keys that leave the storage folder", async () => {
    const storage = createLocalStorage();
    await assert.rejects(storage.put("../escape", pdf(), "application/pdf"), /Invalid storage key/);
    await assert.rejects(storage.put("documents/../../escape", pdf(), "application/pdf"), /Invalid storage key/);
  });
});
