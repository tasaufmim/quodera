import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { devObjectStore } from "./dev-schema";
import type { ObjectStorage } from "./index";

/**
 * The fallback object store: Postgres bytea via the runtime connection.
 * Full put/get/delete parity with R2 so the upload pipeline is honest in
 * every environment. NOT the intended production home — see index.ts.
 */
export const devObjectStorage: ObjectStorage = {
  async put(key, bytes, contentType) {
    await getDb()
      .insert(devObjectStore)
      .values({ key, contentType, bytes: Buffer.from(bytes) });
  },

  async get(key) {
    const [row] = await getDb()
      .select({ bytes: devObjectStore.bytes, contentType: devObjectStore.contentType })
      .from(devObjectStore)
      .where(eq(devObjectStore.key, key))
      .limit(1);
    if (!row) return null;
    return { bytes: new Uint8Array(row.bytes), contentType: row.contentType };
  },

  async delete(key) {
    await getDb().delete(devObjectStore).where(eq(devObjectStore.key, key));
  },
};
