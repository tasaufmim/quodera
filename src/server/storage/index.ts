import { env } from "@/server/lib/env";
import { logger } from "@/server/lib/logger";
import { r2Storage } from "./r2";
import { devObjectStorage } from "./dev-store";

/**
 * Object storage for raw document bytes (Phase 2.5).
 *
 * Same env-gated pattern as the rate limiter: R2 (S3-compatible) when
 * credentials exist; otherwise the dev bytea store, with ONE loud production
 * error so a credential-less deploy is never silent about it.
 *
 * Keys are generated server-side (`docs/<userId>/<uuid>`) — user-supplied
 * names are display-only metadata, never part of a storage path.
 */
export interface ObjectStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

const globalForStorage = globalThis as typeof globalThis & {
  __quoderaStorage?: ObjectStorage;
};

export function getStorage(): ObjectStorage {
  return (globalForStorage.__quoderaStorage ??= resolveStorage({
    r2Endpoint: env.R2_ENDPOINT,
    r2AccessKeyId: env.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY,
    r2Bucket: env.R2_BUCKET,
    nodeEnv: process.env.NODE_ENV,
  }));
}

export function resolveStorage(config: {
  r2Endpoint?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2Bucket?: string;
  nodeEnv: string;
}): ObjectStorage {
  if (config.r2Endpoint && config.r2AccessKeyId && config.r2SecretAccessKey && config.r2Bucket) {
    return r2Storage({
      endpoint: config.r2Endpoint,
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
      bucket: config.r2Bucket,
    });
  }

  if (config.nodeEnv === "production") {
    logger.error(
      "R2 credentials are not set — document bytes go to the DEV object store " +
        "(Postgres bytea). Functional, not intended for production. See docs/ops/PROVISIONING.md §5.",
    );
  }
  return devObjectStorage;
}
