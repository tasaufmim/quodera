import { AwsClient } from "aws4fetch";
import type { ObjectStorage } from "./index";

/**
 * Cloudflare R2 driver (S3-compatible REST, SigV4 via aws4fetch — a ~10KB
 * signer instead of the multi-megabyte AWS SDK). Runs on plain fetch, so it
 * is edge-compatible if uploads ever move there.
 */
export function r2Storage(config: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}): ObjectStorage {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });

  const objectUrl = (key: string) =>
    `${config.endpoint.replace(/\/$/, "")}/${config.bucket}/${key
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;

  return {
    async put(key, bytes, contentType) {
      const response = await client.fetch(objectUrl(key), {
        method: "PUT",
        // TS 5.7+ typed-array generics refuse Uint8Array<ArrayBufferLike> as
        // BodyInit on some lib combos — a Blob is unambiguous.
        body: new Blob([bytes as BlobPart]),
        headers: { "content-type": contentType },
      });
      if (!response.ok) {
        throw new Error(`R2 put failed (${response.status}) for key ${key}`);
      }
    },

    async get(key) {
      const response = await client.fetch(objectUrl(key), { method: "GET" });
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`R2 get failed (${response.status}) for key ${key}`);
      }
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
      };
    },

    async delete(key) {
      const response = await client.fetch(objectUrl(key), { method: "DELETE" });
      // 404 is fine — the object is already gone
      if (!response.ok && response.status !== 404) {
        throw new Error(`R2 delete failed (${response.status}) for key ${key}`);
      }
    },
  };
}
