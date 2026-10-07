import { createLocalStorage } from "@/lib/storage/local";
import { createS3Storage } from "@/lib/storage/s3";
import { StorageConfigError, type DocumentStorage } from "@/lib/storage/types";

export { StorageConfigError, type DocumentStorage, type SignedUrlOptions } from "@/lib/storage/types";

/** Signed download links stop working after this many seconds. */
export const SIGNED_URL_TTL_SECONDS = 60;

/** Reads STORAGE_DRIVER at call time. Defaults to local disk outside production. */
export function getStorage(): DocumentStorage {
  const driver = process.env.STORAGE_DRIVER?.trim().toLowerCase() || "";
  if (driver === "s3") return createS3Storage();
  if (driver === "local" || (!driver && process.env.NODE_ENV !== "production")) {
    return createLocalStorage();
  }
  throw new StorageConfigError("Document storage is not configured. Set STORAGE_DRIVER=s3 and the S3_* variables.");
}
