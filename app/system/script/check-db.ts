// Run with: npx tsx scripts/check-db.ts  (from app/system)
// Connects as system_app (via db.ts → DATABASE_URL) and reads the users table.
import { db } from "../src/prisma/db";

async function main() {
  const users = await db.orm.public.User
    .select("id", "username", "createdAt") // never select passwordHash unless you need it
    .limit(5)
    .all();

  console.log(users);
  await db.close(); // closes the connection pool so the script exits
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});