// Run with: npx tsx scripts/check-db.ts  (from app/system)
// Connects as system_app (via db.ts → DATABASE_URL) and reads the users table.
import { db } from "@/src/prisma/db";

async function main() {
  const crops = await db.orm.public.Crop
    .select('cropName',)
    .limit(5)
    .all();

  console.log(crops);
  await db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});