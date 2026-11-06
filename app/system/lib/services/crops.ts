import "server-only";
import { db } from "@/lib/db";
import { authorize, type Actor } from "@/lib/auth/actor";
import { CROP_TYPES } from "@/lib/features/catalog";

// The crop catalog is fixed to the 8 seeded crops the model was trained on
// (decided in Phase 0), so this service is read-only. crop_name matches the
// dataset's Crop_Type labels exactly.

export async function listCrops(actor: Actor) {
  authorize(actor, "crop.read");
  const crops = await db.orm.public.Crop.orderBy((c) => c.cropName.asc()).all();
  // Defensive: only offer crops the model knows, even if someone adds rows in SQL
  return crops.filter((c) => (CROP_TYPES as readonly string[]).includes(c.cropName));
}
