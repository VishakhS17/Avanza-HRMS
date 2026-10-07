export type SignedUrlOptions = {
  fileName: string;
  contentType: string;
  expiresInSeconds: number;
};

/** Private object storage. Objects are never public. Reads go through short-lived signed URLs. */
export interface DocumentStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Absolute URL, or a path on this app for the local adapter. */
  signedUrl(key: string, options: SignedUrlOptions): Promise<string>;
  /** Only for an object whose database row was never committed. */
  remove(key: string): Promise<void>;
}

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConfigError";
  }
}
