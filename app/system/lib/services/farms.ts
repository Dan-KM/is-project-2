import "server-only";
import type { z } from "zod";
import { db } from "@/lib/db";
import { toAppError } from "@/lib/errors";
import { authorize, type Actor } from "@/lib/auth/actor";
import { assertFarmAccess } from "@/lib/auth/access";
import type { createFarmSchema, updateFarmSchema } from "@/lib/validation/schemas";
import { dbText, fromDbNumber, toDbNumber } from "./shared";

// Farms: plain CRUD. The DB enforces lat/lon ranges, area > 0 and that a farm
// can't shrink below the area of its fields (trg_farm_area_shrink); those
// errors are translated by toAppError.

export async function listFarms(actor: Actor) {
  authorize(actor, "farm.read");
  // Field count comes back as a number on each farm (an include reducer)
  const query = db.orm.public.Farm.include("fields", (f) => f.count()).orderBy((f) => f.farmName.asc());
  // Admin sees every farm; a farmer only their own
  return actor.role === "admin" ? query.all() : query.where({ farmerId: actor.userId }).all();
}

export async function getFarm(actor: Actor, farmId: string) {
  authorize(actor, "farm.read");
  return assertFarmAccess(actor, farmId);
}

export async function createFarm(actor: Actor, input: z.infer<typeof createFarmSchema>) {
  authorize(actor, "farm.create");
  try {
    return await db.orm.public.Farm.create({
      farmerId: actor.userId,
      farmName: dbText(input.farmName),
      farmAddress: dbText(input.farmAddress),
      latitude: toDbNumber(input.latitude),
      longitude: toDbNumber(input.longitude),
      area: toDbNumber(input.area),
    });
  } catch (e) {
    throw toAppError(e);
  }
}

export async function updateFarm(actor: Actor, input: z.infer<typeof updateFarmSchema>) {
  authorize(actor, "farm.update");
  await assertFarmAccess(actor, input.farmId);
  try {
    return await db.orm.public.Farm.where({ farmId: input.farmId }).update({
      farmName: dbText(input.farmName),
      farmAddress: dbText(input.farmAddress),
      latitude: toDbNumber(input.latitude),
      longitude: toDbNumber(input.longitude),
      area: toDbNumber(input.area),
    });
  } catch (e) {
    throw toAppError(e);
  }
}

/** Deletes the farm and (by cascade) its fields, water ledger, readings and predictions. */
export async function deleteFarm(actor: Actor, farmId: string) {
  authorize(actor, "farm.delete");
  await assertFarmAccess(actor, farmId);
  try {
    await db.orm.public.Farm.where({ farmId }).delete();
  } catch (e) {
    throw toAppError(e);
  }
}

/** Farm water split from the farm_water_status view: tank = allocated + unallocated. */
export async function getFarmWaterStatus(actor: Actor, farmId: string) {
  authorize(actor, "farm.read");
  await assertFarmAccess(actor, farmId);
  const [row] = await db.runtime().query(
    db.raw.sql`
      SELECT balance_litres, allocated_litres, unallocated_litres
      FROM farm_water_status WHERE farm_id = ${farmId}::uuid`
      .returnsRow({
        balance_litres: "pg/numeric@1",
        allocated_litres: "pg/numeric@1",
        unallocated_litres: "pg/numeric@1",
      })
      .build(),
  );
  return {
    balanceLitres: fromDbNumber(row?.balance_litres) ?? 0,
    allocatedLitres: fromDbNumber(row?.allocated_litres) ?? 0,
    unallocatedLitres: fromDbNumber(row?.unallocated_litres) ?? 0,
  };
}
