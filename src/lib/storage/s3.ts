import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, type PutObjectCommandInput, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { contentDisposition } from "@/lib/storage/files";
import { StorageConfigError, type DocumentStorage } from "@/lib/storage/types";

/** Any S3-compatible store (AWS S3, Cloudflare R2, Neon Object Storage). The bucket must be private. */
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new StorageConfigError(`${name} is not set.`);
  return value;
}

/** SSE-S3 on every upload. The bucket must also have default encryption and Block Public Access. */
export function encryptedPutInput(input: {
  bucket: string;
  key: string;
  body: Uint8Array;
  contentType: string;
}): PutObjectCommandInput {
  return {
    Bucket: input.bucket,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    ServerSideEncryption: "AES256",
  };
}

export function createS3Storage(): DocumentStorage {
  const bucket = required("S3_BUCKET");
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    region: required("S3_REGION"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE?.trim().toLowerCase() === "true",
    credentials: {
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
  });
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand(encryptedPutInput({ bucket, key, body, contentType })));
    },
    async signedUrl(key, options) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentType: options.contentType,
          ResponseContentDisposition: contentDisposition(options.fileName),
          ResponseCacheControl: "private, no-store",
        }),
        { expiresIn: options.expiresInSeconds },
      );
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
