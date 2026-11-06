import "server-only";
import { db as createdDb } from "@/src/prisma/db";

// In dev, Next.js hot-reloads modules on every save. Without this cache each
// reload would open a new connection pool until Postgres hits "too many clients".
const globalForDb = globalThis as unknown as { db?: typeof createdDb };

export const db = globalForDb.db ?? createdDb;

if (process.env.NODE_ENV !== "production") globalForDb.db = db;

/** The transaction context Prisma 8 passes to `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Where to run a raw SQL plan: inside the given transaction, or on the shared
 * client. Lets one service function work both standalone and as part of a
 * larger transaction.
 */
export function runner(tx?: Tx) {
  return tx ?? db.runtime();
}
