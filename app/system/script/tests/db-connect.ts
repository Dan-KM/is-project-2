import "server-only";
import { db as createdDb } from "@/src/prisma/db";

// In dev, Next.js hot-reloads modules on every save. Without this cache, each reload
// would create a new connection pool, until Postgres hits "too many clients".
const globalForDb = globalThis as unknown as { db?: typeof createdDb };

export const db = globalForDb.db ?? createdDb;

if (process.env.NODE_ENV !== "production") globalForDb.db = db;