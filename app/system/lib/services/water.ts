import "server-only";
import type { z } from "zod";
import { db } from "@/lib/db";
import { AppError, toAppError } from "@/lib/errors";
import { authorize, type Actor } from "@/lib/auth/actor";
import { assertFarmAccess, assertFieldAccess, assertPlantingAccess } from "@/lib/auth/access";
import type {
  allocationSchema, checkIrrigationSchema, editLedgerEntrySchema, initialWaterSchema,
  irrigationNotesSchema, irrigationSchema, refillSchema,
} from "@/lib/validation/schemas";
import { fromDbNumber } from "./shared";

// Water operations. Every balance or budget change goes through the SQL
// functions in 02-schema.sql (record_initial_water_entry, record_water_refill,
// record_irrigation, set_field_allocation). They lock the farm, check the
// balance can't go negative, update the field budgets and write the audit trail
// in ONE database transaction. We never re-implement that logic here.
//
// Optional values are passed as '' and turned into NULL with NULLIF in SQL,
// because Prisma 8's raw tag binds only concrete values.

const optionalTimestamp = (iso?: string) => iso ?? "";
const optionalNotes = (notes?: string) => notes ?? "";

// ---------- Farm supply (ledger) ----------

/** First ever water entry for a farm (may be 0 for an empty tank). */
export async function recordInitialEntry(actor: Actor, input: z.infer<typeof initialWaterSchema>) {
  authorize(actor, "water.initial");
  await assertFarmAccess(actor, input.farmId);
  try {
    const [row] = await db.runtime().query(
      db.raw.sql`
        SELECT transaction_id, current_quantity_litres
        FROM record_initial_water_entry(
          ${input.farmId}::uuid,
          ${String(input.quantityLitres)}::numeric,
          COALESCE(NULLIF(${optionalTimestamp(input.date)}, '')::timestamptz, now()),
          NULLIF(${optionalNotes(input.notes)}, ''))`
        .returnsRow({ transaction_id: "pg/uuid@1", current_quantity_litres: "pg/numeric@1" })
        .build(),
    );
    return { transactionId: row.transaction_id, balanceLitres: fromDbNumber(row.current_quantity_litres)! };
  } catch (e) {
    throw toAppError(e);
  }
}

/** Add water to the farm supply. Waiting fields (budget 0) are replenished by the DB trigger. */
export async function recordRefill(actor: Actor, input: z.infer<typeof refillSchema>) {
  authorize(actor, "water.refill");
  await assertFarmAccess(actor, input.farmId);
  try {
    const [row] = await db.runtime().query(
      db.raw.sql`
        SELECT transaction_id, current_quantity_litres
        FROM record_water_refill(
          ${input.farmId}::uuid,
          ${String(input.quantityLitres)}::numeric,
          COALESCE(NULLIF(${optionalTimestamp(input.date)}, '')::timestamptz, now()),
          NULLIF(${optionalNotes(input.notes)}, ''))`
        .returnsRow({ transaction_id: "pg/uuid@1", current_quantity_litres: "pg/numeric@1" })
        .build(),
    );
    return { transactionId: row.transaction_id, balanceLitres: fromDbNumber(row.current_quantity_litres)! };
  } catch (e) {
    throw toAppError(e);
  }
}

/** The farm's ledger, newest first, with the irrigation event (if any) of each row. */
export async function listLedger(actor: Actor, farmId: string, limit = 50) {
  authorize(actor, "farm.read");
  await assertFarmAccess(actor, farmId);
  return db.orm.public.WaterTransaction
    .where({ farmId })
    .include("irrigationEvent")
    .orderBy((t) => t.ledgerSeq.desc())
    .limit(limit)
    .all();
}

export type LedgerEntry = {
  transactionId: string;
  ledgerSeq: number;
  transactionType: "INITIAL_ENTRY" | "REFILL" | "IRRIGATION";
  quantityLitres: number;
  balanceAfterLitres: number;
  transactionDate: string;
  notes: string | null;
  /** For irrigation rows: which field and crop used the water. */
  fieldId: string | null;
  fieldName: string | null;
  cropName: string | null;
};

/**
 * The farm ledger for the water page, newest first. A join (not the ORM) so
 * each irrigation row can say which field and crop used the water.
 */
export async function listLedgerWithFields(actor: Actor, farmId: string, limit = 50): Promise<LedgerEntry[]> {
  authorize(actor, "farm.read");
  await assertFarmAccess(actor, farmId);
  const rows = await db.runtime().query(
    db.raw.sql`
      SELECT wt.transaction_id, wt.ledger_seq, wt.transaction_type, wt.quantity_litres,
             wt.current_quantity_litres, wt.transaction_date, COALESCE(wt.notes, '') AS notes,
             f.field_id, COALESCE(f.field_name, '') AS field_name, COALESCE(c.crop_name, '') AS crop_name
      FROM water_transaction wt
      LEFT JOIN irrigation_event ie ON ie.transaction_id = wt.transaction_id
      LEFT JOIN field_crop fc ON fc.field_crop_id = ie.field_crop_id
      LEFT JOIN field f ON f.field_id = fc.field_id
      LEFT JOIN crop c ON c.crop_id = fc.crop_id
      WHERE wt.farm_id = ${farmId}::uuid
      ORDER BY wt.ledger_seq DESC
      LIMIT ${limit}`
      .returnsRow({
        transaction_id: "pg/uuid@1",
        ledger_seq: "pg/int4@1",
        transaction_type: "sql/varchar@1",
        quantity_litres: "pg/numeric@1",
        current_quantity_litres: "pg/numeric@1",
        transaction_date: "pg/timestamptz-string@1",
        notes: "pg/text@1",
        field_id: { codecId: "pg/uuid@1", nullable: true },
        field_name: "sql/varchar@1",
        crop_name: "sql/varchar@1",
      })
      .build(),
  );
  return rows.map((r) => ({
    transactionId: r.transaction_id,
    ledgerSeq: r.ledger_seq,
    transactionType: r.transaction_type as LedgerEntry["transactionType"],
    quantityLitres: fromDbNumber(r.quantity_litres) ?? 0,
    balanceAfterLitres: fromDbNumber(r.current_quantity_litres) ?? 0,
    transactionDate: r.transaction_date,
    notes: r.notes || null,
    fieldId: r.field_id,
    fieldName: r.field_name || null,
    cropName: r.crop_name || null,
  }));
}

async function assertTransactionAccess(actor: Actor, transactionId: string) {
  const txn = await db.orm.public.WaterTransaction.where({ transactionId }).first();
  if (!txn) throw new AppError("errors.notFound");
  await assertFarmAccess(actor, txn.farmId);
  return txn;
}

/** Only notes and date may change; the ledger guard rejects anything else. */
export async function editLedgerEntry(actor: Actor, input: z.infer<typeof editLedgerEntrySchema>) {
  authorize(actor, "water.editEntry");
  await assertTransactionAccess(actor, input.transactionId);
  try {
    return await db.orm.public.WaterTransaction.where({ transactionId: input.transactionId }).update({
      notes: input.notes ?? null,
      ...(input.transactionDate ? { transactionDate: input.transactionDate } : {}),
    });
  } catch (e) {
    throw toAppError(e);
  }
}

/**
 * Undo the farm's most recent ledger entry. The DB guard (water_transaction_guard)
 * reverses the budget changes it caused and refuses if that water was already
 * used or is still allocated. Deleting an IRRIGATION row also removes its
 * irrigation event (ON DELETE CASCADE).
 */
export async function undoLatestEntry(actor: Actor, farmId: string) {
  authorize(actor, "water.undo");
  await assertFarmAccess(actor, farmId);
  const latest = await db.orm.public.WaterTransaction
    .where({ farmId })
    .orderBy((t) => t.ledgerSeq.desc())
    .first();
  if (!latest) throw new AppError("water.noInitialEntry");
  try {
    await db.orm.public.WaterTransaction.where({ transactionId: latest.transactionId }).delete();
    return { undone: latest };
  } catch (e) {
    throw toAppError(e);
  }
}

// ---------- Irrigation ----------

export type IrrigationCheck = {
  allowed: boolean;
  reasonCode: string;
  maxLitres: number;
  fieldBudgetLitres: number | null;
  farmBalanceLitres: number | null;
};

/** Advisory pre-check (no locks, no writes) so the form can warn before submitting. */
export async function checkIrrigation(
  actor: Actor,
  input: z.infer<typeof checkIrrigationSchema>,
): Promise<IrrigationCheck> {
  authorize(actor, "water.irrigate");
  await assertPlantingAccess(actor, input.fieldCropId);
  const amount = input.quantityLitres === undefined ? "" : String(input.quantityLitres);
  const [row] = await db.runtime().query(
    db.raw.sql`
      SELECT allowed, reason_code, max_litres, field_budget_litres, farm_balance_litres
      FROM check_irrigation_request(${input.fieldCropId}::uuid, NULLIF(${amount}, '')::numeric)`
      .returnsRow({
        allowed: "pg/bool@1",
        reason_code: "pg/text@1",
        max_litres: "pg/numeric@1",
        field_budget_litres: { codecId: "pg/numeric@1", nullable: true },
        farm_balance_litres: { codecId: "pg/numeric@1", nullable: true },
      })
      .build(),
  );
  if (!row) throw new AppError("errors.notFound");
  return {
    allowed: row.allowed,
    reasonCode: row.reason_code,
    maxLitres: fromDbNumber(row.max_litres) ?? 0,
    fieldBudgetLitres: fromDbNumber(row.field_budget_litres),
    farmBalanceLitres: fromDbNumber(row.farm_balance_litres),
  };
}

export type IrrigationResult = {
  eventId: string;
  transactionId: string;
  farmBalanceLitres: number;
  fieldBudgetLitres: number;
  replenishedLitres: number;
  statusCode: "OK" | "BUDGET_REPLENISHED" | "BUDGET_EXHAUSTED";
};

/**
 * Record water used on a planting. record_irrigation() deducts the farm
 * balance AND this field's budget, refuses if either would go negative
 * (IR001/IR002/IR003), and replenishes the budget when it reaches 0.
 */
export async function recordIrrigation(actor: Actor, input: z.infer<typeof irrigationSchema>): Promise<IrrigationResult> {
  authorize(actor, "water.irrigate");
  await assertPlantingAccess(actor, input.fieldCropId);
  try {
    const [row] = await db.runtime().query(
      db.raw.sql`
        SELECT event_id, transaction_id, farm_balance_litres, field_budget_litres, replenished_litres, status_code
        FROM record_irrigation(
          ${input.fieldCropId}::uuid,
          ${String(input.quantityLitres)}::numeric,
          COALESCE(NULLIF(${optionalTimestamp(input.irrigationDate)}, '')::timestamptz, now()),
          NULLIF(${optionalNotes(input.notes)}, ''))`
        .returnsRow({
          event_id: "pg/uuid@1",
          transaction_id: "pg/uuid@1",
          farm_balance_litres: "pg/numeric@1",
          field_budget_litres: "pg/numeric@1",
          replenished_litres: "pg/numeric@1",
          status_code: "pg/text@1",
        })
        .build(),
    );
    return {
      eventId: row.event_id,
      transactionId: row.transaction_id,
      farmBalanceLitres: fromDbNumber(row.farm_balance_litres) ?? 0,
      fieldBudgetLitres: fromDbNumber(row.field_budget_litres) ?? 0,
      replenishedLitres: fromDbNumber(row.replenished_litres) ?? 0,
      statusCode: row.status_code as IrrigationResult["statusCode"],
    };
  } catch (e) {
    throw toAppError(e);
  }
}

/** All irrigation events of a field, across its plantings, newest first. */
export async function listIrrigationEvents(actor: Actor, fieldId: string, limit = 50) {
  authorize(actor, "farm.read");
  await assertFieldAccess(actor, fieldId);
  const plantings = await db.orm.public.FieldCrop.select("fieldCropId").where({ fieldId }).all();
  if (plantings.length === 0) return [];
  return db.orm.public.IrrigationEvent
    .where((e) => e.fieldCropId.in(plantings.map((p) => p.fieldCropId)))
    .orderBy((e) => e.irrigationDate.desc())
    .limit(limit)
    .all();
}

/** Notes are the only editable part of an event; amount/date come from the ledger. */
export async function updateIrrigationNotes(actor: Actor, input: z.infer<typeof irrigationNotesSchema>) {
  authorize(actor, "irrigation.editNotes");
  const event = await db.orm.public.IrrigationEvent.where({ eventId: input.eventId }).first();
  if (!event) throw new AppError("errors.notFound");
  await assertPlantingAccess(actor, event.fieldCropId);
  return db.orm.public.IrrigationEvent.where({ eventId: input.eventId }).update({ notes: input.notes ?? null });
}

// ---------- Field allocations and budgets ----------

/**
 * Give a field an allocation percentage, change it, or remove it (percentage
 * undefined). set_field_allocation() closes the old row, opens the new one and
 * syncs the budget; the DB caps the farm's active percentages at 100%.
 */
export async function setAllocation(actor: Actor, input: z.infer<typeof allocationSchema>) {
  authorize(actor, "allocation.set");
  await assertFieldAccess(actor, input.fieldId);
  const percentage = input.percentage === undefined ? "" : String(input.percentage);
  try {
    await db.runtime().query(
      db.raw.sql`
        SELECT allocation_id FROM set_field_allocation(${input.fieldId}::uuid, NULLIF(${percentage}, '')::numeric)`
        .returnsRow({ allocation_id: { codecId: "pg/uuid@1", nullable: true } })
        .build(),
    );
  } catch (e) {
    throw toAppError(e);
  }
  // Read back the budget the DB just set so the UI can show it
  const field = await db.orm.public.Field.select("remainingBudgetLitres").where({ fieldId: input.fieldId }).first();
  return { remainingBudgetLitres: fromDbNumber(field?.remainingBudgetLitres) };
}

export async function listAllocations(actor: Actor, fieldId: string) {
  authorize(actor, "farm.read");
  await assertFieldAccess(actor, fieldId);
  return db.orm.public.WaterAllocation
    .where({ fieldId })
    .orderBy((a) => a.effectiveFrom.desc())
    .all();
}

/** The field's budget audit trail: where every litre came from and went. */
export async function listBudgetHistory(actor: Actor, fieldId: string, limit = 50) {
  authorize(actor, "farm.read");
  await assertFieldAccess(actor, fieldId);
  return db.orm.public.FieldBudgetTransaction
    .where({ fieldId })
    // Rows written by one SQL call share created_at (now() is per transaction).
    // There, a replenishment (ALLOCATE) always follows the deduction (IRRIGATE)
    // or release, so list ALLOCATE first to keep "newest first" correct.
    .orderBy([(b) => b.createdAt.desc(), (b) => b.reason.asc()])
    .limit(limit)
    .all();
}
