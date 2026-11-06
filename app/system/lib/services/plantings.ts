import "server-only";
import type { z } from "zod";
import { db } from "@/lib/db";
import { AppError, toAppError } from "@/lib/errors";
import { authorize, type Actor } from "@/lib/auth/actor";
import { assertFieldAccess, assertPlantingAccess } from "@/lib/auth/access";
import { daysSinceDate } from "@/lib/time";
import type {
  createGrowthSchema, plantCropSchema, updateGrowthSchema, updatePlantingSchema,
} from "@/lib/validation/schemas";
import { dbText, toDbNumber } from "./shared";

// Plantings (field_crop) and their growth stage records (crop_evolution).
// Planting a crop goes through the SQL function replace_field_crop(), which
// ends the field's current planting and starts the new one atomically. Water
// budgets belong to the field, so replanting never touches water.

export async function getActivePlanting(actor: Actor, fieldId: string) {
  authorize(actor, "farm.read");
  await assertFieldAccess(actor, fieldId);
  return db.orm.public.FieldCrop.where({ fieldId, isActive: true }).include("crop").first();
}

export async function listPlantings(actor: Actor, fieldId: string) {
  authorize(actor, "farm.read");
  await assertFieldAccess(actor, fieldId);
  return db.orm.public.FieldCrop
    .where({ fieldId })
    .include("crop")
    .orderBy([(p) => p.plantingDate.desc(), (p) => p.createdAt.desc()])
    .all();
}

export async function plantCrop(actor: Actor, input: z.infer<typeof plantCropSchema>) {
  authorize(actor, "planting.create");
  await assertFieldAccess(actor, input.fieldId);
  try {
    const [row] = await db.runtime().query(
      db.raw.sql`
        SELECT field_crop_id FROM replace_field_crop(${input.fieldId}::uuid, ${input.cropId}::uuid, ${input.plantingDate}::date)`
        .returnsRow({ field_crop_id: "pg/uuid@1" })
        .build(),
    );
    return { fieldCropId: row.field_crop_id };
  } catch (e) {
    throw toAppError(e);
  }
}

/** Edit the planting date, or end the planting (isActive = false). Re-activating is done by planting again. */
export async function updatePlanting(actor: Actor, input: z.infer<typeof updatePlantingSchema>) {
  authorize(actor, "planting.update");
  const { planting } = await assertPlantingAccess(actor, input.fieldCropId);
  if (input.isActive === true && !planting.isActive) {
    // Re-activating an old planting could create two active plantings; use plantCrop instead
    throw new AppError("planting.inactive");
  }
  try {
    return await db.orm.public.FieldCrop.where({ fieldCropId: input.fieldCropId }).update({
      ...(input.plantingDate ? { plantingDate: input.plantingDate } : {}),
      ...(input.isActive === false ? { isActive: false } : {}),
    });
  } catch (e) {
    throw toAppError(e);
  }
}

/**
 * Deletes a planting. The DB cascades its growth records, irrigation events
 * and predictions. The irrigation water stays spent in the ledger: deleting
 * history doesn't put water back in the tank.
 */
export async function deletePlanting(actor: Actor, fieldCropId: string) {
  authorize(actor, "planting.delete");
  await assertPlantingAccess(actor, fieldCropId);
  try {
    await db.orm.public.FieldCrop.where({ fieldCropId }).delete();
  } catch (e) {
    throw toAppError(e);
  }
}

// ---------- Growth stage records ----------

export async function listGrowthRecords(actor: Actor, fieldCropId: string) {
  authorize(actor, "farm.read");
  await assertPlantingAccess(actor, fieldCropId);
  return db.orm.public.CropEvolution
    .where({ fieldCropId })
    .orderBy((g) => g.recordedAt.desc())
    .all();
}

export async function getLatestGrowthRecord(fieldCropId: string) {
  return db.orm.public.CropEvolution
    .where({ fieldCropId })
    .orderBy((g) => g.recordedAt.desc())
    .first();
}

/** Default for the form: days since planting, derived instead of asking the farmer. */
export async function getGrowthDefaults(actor: Actor, fieldCropId: string) {
  const { planting } = await assertPlantingAccess(actor, fieldCropId);
  const latest = await getLatestGrowthRecord(fieldCropId);
  return {
    daysSincePlanting: daysSinceDate(planting.plantingDate),
    growthStage: latest?.growthStage ?? null,
    rootZoneDepth: latest?.rootZoneDepth ?? null,
    leafAreaIndex: latest?.leafAreaIndex ?? null,
  };
}

export async function createGrowthRecord(actor: Actor, input: z.infer<typeof createGrowthSchema>) {
  authorize(actor, "growth.create");
  const { planting } = await assertPlantingAccess(actor, input.fieldCropId);
  try {
    return await db.orm.public.CropEvolution.create({
      fieldCropId: input.fieldCropId,
      recordedAt: input.recordedAt,
      growthStage: dbText(input.growthStage),
      rootZoneDepth: toDbNumber(input.rootZoneDepth),
      leafAreaIndex: toDbNumber(input.leafAreaIndex),
      // Derived if the farmer left it blank
      daysSincePlanting: input.daysSincePlanting ?? daysSinceDate(planting.plantingDate),
    });
  } catch (e) {
    throw toAppError(e);
  }
}

async function assertGrowthAccess(actor: Actor, evolutionId: string) {
  const record = await db.orm.public.CropEvolution.where({ evolutionId }).first();
  if (!record) throw new AppError("errors.notFound");
  await assertPlantingAccess(actor, record.fieldCropId);
  return record;
}

export async function updateGrowthRecord(actor: Actor, input: z.infer<typeof updateGrowthSchema>) {
  authorize(actor, "growth.update");
  await assertGrowthAccess(actor, input.evolutionId);
  try {
    return await db.orm.public.CropEvolution.where({ evolutionId: input.evolutionId }).update({
      recordedAt: input.recordedAt,
      growthStage: dbText(input.growthStage),
      rootZoneDepth: toDbNumber(input.rootZoneDepth),
      leafAreaIndex: toDbNumber(input.leafAreaIndex),
      daysSincePlanting: input.daysSincePlanting ?? null,
    });
  } catch (e) {
    throw toAppError(e);
  }
}

export async function deleteGrowthRecord(actor: Actor, evolutionId: string) {
  authorize(actor, "growth.delete");
  await assertGrowthAccess(actor, evolutionId);
  await db.orm.public.CropEvolution.where({ evolutionId }).delete();
}
