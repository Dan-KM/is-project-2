import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Actor } from "./actor";

// Ownership checks. A farmer may only reach rows under farms they own; admin
// reaches everything. A row that exists but belongs to someone else is
// reported as "not found" so we never reveal other farmers' data.

export async function assertFarmAccess(actor: Actor, farmId: string) {
  const farm = await db.orm.public.Farm.where({ farmId }).first();
  if (!farm || (actor.role !== "admin" && farm.farmerId !== actor.userId)) {
    throw new AppError("errors.notFound");
  }
  return farm;
}

export async function assertFieldAccess(actor: Actor, fieldId: string) {
  const field = await db.orm.public.Field.where({ fieldId }).include("farm").first();
  if (!field || (actor.role !== "admin" && field.farm.farmerId !== actor.userId)) {
    throw new AppError("errors.notFound");
  }
  return field;
}

export async function assertPlantingAccess(actor: Actor, fieldCropId: string) {
  const planting = await db.orm.public.FieldCrop.where({ fieldCropId }).first();
  if (!planting) throw new AppError("errors.notFound");
  const field = await assertFieldAccess(actor, planting.fieldId);
  return { planting, field };
}
