import "server-only";
import type { z } from "zod";
import { db } from "@/lib/db";
import { toAppError } from "@/lib/errors";
import { authorize, type Actor } from "@/lib/auth/actor";
import { assertFarmAccess, assertFieldAccess } from "@/lib/auth/access";
import type { createFieldSchema, updateFieldSchema } from "@/lib/validation/schemas";
import { dbText, fromDbNumber, toDbNumber } from "./shared";

// Fields: plain CRUD, EXCEPT remaining_budget_litres, which is never written
// here. Only the SQL functions (set_field_allocation, record_irrigation, …)
// change budgets. The DB caps total field area at the farm's area.

export async function listFields(actor: Actor, farmId: string) {
  authorize(actor, "farm.read");
  await assertFarmAccess(actor, farmId);
  return db.orm.public.Field.where({ farmId }).orderBy((f) => f.fieldName.asc()).all();
}

/** Fields of a farm with their active crop (if any), for the farm page. */
export async function listFieldsWithCrops(actor: Actor, farmId: string) {
  const fieldRows = await listFields(actor, farmId);
  if (fieldRows.length === 0) return [];
  const active = await db.orm.public.FieldCrop
    .where((p) => p.fieldId.in(fieldRows.map((f) => f.fieldId)))
    .where({ isActive: true })
    .include("crop")
    .all();
  return fieldRows.map((field) => ({
    ...field,
    activePlanting: active.find((p) => p.fieldId === field.fieldId) ?? null,
  }));
}

export async function getField(actor: Actor, fieldId: string) {
  authorize(actor, "farm.read");
  return assertFieldAccess(actor, fieldId);
}

export async function createField(actor: Actor, input: z.infer<typeof createFieldSchema>) {
  authorize(actor, "field.create");
  await assertFarmAccess(actor, input.farmId);
  try {
    return await db.orm.public.Field.create({
      farmId: input.farmId,
      fieldName: dbText(input.fieldName),
      soilType: dbText(input.soilType),
      area: toDbNumber(input.area),
      fieldSlope: toDbNumber(input.fieldSlope),
    });
  } catch (e) {
    throw toAppError(e);
  }
}

export async function updateField(actor: Actor, input: z.infer<typeof updateFieldSchema>) {
  authorize(actor, "field.update");
  await assertFieldAccess(actor, input.fieldId);
  try {
    return await db.orm.public.Field.where({ fieldId: input.fieldId }).update({
      fieldName: dbText(input.fieldName),
      soilType: dbText(input.soilType),
      area: toDbNumber(input.area),
      fieldSlope: toDbNumber(input.fieldSlope),
    });
  } catch (e) {
    throw toAppError(e);
  }
}

/**
 * Deletes a field (cascading its plantings, readings, allocation and budget).
 * Its budget water goes back to the unallocated pool, so in the same
 * transaction we call the existing replenish_exhausted_budgets() to let any
 * waiting field (budget 0) claim it, the same as a refill would.
 */
export async function deleteField(actor: Actor, fieldId: string) {
  authorize(actor, "field.delete");
  const field = await assertFieldAccess(actor, fieldId);
  try {
    await db.transaction(async (tx) => {
      await tx.orm.public.Field.where({ fieldId }).delete();
      // Raw plans are built on the client and executed on the transaction
      await tx.query(
        db.raw.sql`SELECT replenish_exhausted_budgets(${field.farmId}::uuid) AS allocated`
          .returnsRow({ allocated: "pg/numeric@1" })
          .build(),
      );
    });
  } catch (e) {
    throw toAppError(e);
  }
}

/** Per-field budget state from the field_budget_status view. */
export async function listFieldBudgets(actor: Actor, farmId: string) {
  authorize(actor, "farm.read");
  await assertFarmAccess(actor, farmId);
  const rows = await db.runtime().query(
    db.raw.sql`
      SELECT field_id, field_name, allocation_percentage, remaining_budget_litres, budget_status
      FROM field_budget_status WHERE farm_id = ${farmId}::uuid ORDER BY field_name`
      .returnsRow({
        field_id: "pg/uuid@1",
        field_name: "sql/varchar@1",
        allocation_percentage: { codecId: "pg/numeric@1", nullable: true },
        remaining_budget_litres: { codecId: "pg/numeric@1", nullable: true },
        budget_status: "pg/text@1",
      })
      .build(),
  );
  return rows.map((r) => ({
    fieldId: r.field_id,
    fieldName: r.field_name,
    allocationPercentage: fromDbNumber(r.allocation_percentage),
    remainingBudgetLitres: fromDbNumber(r.remaining_budget_litres),
    budgetStatus: r.budget_status as "NO_ALLOCATION" | "EXHAUSTED" | "AVAILABLE",
  }));
}
