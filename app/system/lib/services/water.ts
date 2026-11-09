import "server-only";
import type { z } from "zod";
import { db } from "@/lib/db";
import { AppError, toAppError } from "@/lib/errors";
import { authorize, type Actor } from "@/lib/auth/actor";
import { assertFarmAccess, assertFieldAccess, assertPlantingAccess } from "@/lib/auth/access";
import type {
  allocationSchema, checkIrrigationSchema, editLedgerEntrySchema, initialWaterSchema,
  irrigationNotesSchema, irrigationSchema, refillSchema, topUpSchema,
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
  /** Water in the farm's unallocated pool (the "farm reserve"). */
  unallocatedLitres: number;
  /** Litres the field budget is short by; 0 when the budget covers it. */
  shortfallLitres: number;
  /** Over the field budget, but the farm reserve can cover the difference. */
  canUseReserve: boolean;
};

const roundLitres = (n: number) => Math.round(n * 100) / 100;

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
      SELECT c.allowed, c.reason_code, c.max_litres, c.field_budget_litres, c.farm_balance_litres,
             w.unallocated_litres
      FROM check_irrigation_request(${input.fieldCropId}::uuid, NULLIF(${amount}, '')::numeric) c
      CROSS JOIN (
        SELECT ws.unallocated_litres
        FROM field_crop fc
        JOIN field f ON f.field_id = fc.field_id
        JOIN farm_water_status ws ON ws.farm_id = f.farm_id
        WHERE fc.field_crop_id = ${input.fieldCropId}::uuid
      ) w`
      .returnsRow({
        allowed: "pg/bool@1",
        reason_code: "pg/text@1",
        max_litres: "pg/numeric@1",
        field_budget_litres: { codecId: "pg/numeric@1", nullable: true },
        farm_balance_litres: { codecId: "pg/numeric@1", nullable: true },
        unallocated_litres: "pg/numeric@1",
      })
      .build(),
  );
  if (!row) throw new AppError("errors.notFound");
  const fieldBudgetLitres = fromDbNumber(row.field_budget_litres);
  const unallocatedLitres = fromDbNumber(row.unallocated_litres) ?? 0;
  const shortfallLitres =
    row.reason_code === "EXCEEDS_FIELD_BUDGET" && input.quantityLitres !== undefined && fieldBudgetLitres !== null
      ? roundLitres(input.quantityLitres - fieldBudgetLitres)
      : 0;
  return {
    allowed: row.allowed,
    reasonCode: row.reason_code,
    maxLitres: fromDbNumber(row.max_litres) ?? 0,
    fieldBudgetLitres,
    farmBalanceLitres: fromDbNumber(row.farm_balance_litres),
    unallocatedLitres,
    shortfallLitres,
    // Advisory only: borrowFromReserve() re-checks under the farm lock
    canUseReserve: shortfallLitres > 0 && shortfallLitres <= unallocatedLitres,
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Move water from the farm's unallocated pool (the "farm reserve") into one
 * field's budget, inside the caller's transaction. Locks the farm, then the
 * field (the schema's lock order), re-reads the pool under the lock and writes
 * through apply_field_budget_change(), the schema's single budget write path.
 * The audit row is an ALLOCATE with no percentage, which marks it as manual.
 *
 * `amount` = litres to add; with `coverIrrigation`, it is the irrigation amount
 * and only the part the budget can't cover is moved. Returns litres moved and
 * the audit row id (null when nothing was needed).
 */
async function moveFromReserve(
  tx: Tx,
  fieldId: string,
  amount: number,
  coverIrrigation: boolean,
): Promise<{ movedLitres: number; budgetTxnId: string | null; budgetAfterLitres: number }> {
  // 1. Lock the farm row first, like every water function in the schema
  const [locked] = await tx.query(
    db.raw.sql`
      SELECT fm.farm_id
      FROM farm fm JOIN field f ON f.farm_id = fm.farm_id
      WHERE f.field_id = ${fieldId}::uuid
      FOR UPDATE OF fm`
      .returnsRow({ farm_id: "pg/uuid@1" })
      .build(),
  );
  if (!locked) throw new AppError("errors.notFound");

  // 2. Then the field; read its budget and the pool after the locks.
  // Litre arithmetic stays in NUMERIC, so there is no float rounding.
  const [row] = await tx.query(
    db.raw.sql`
      SELECT
        f.remaining_budget_litres IS NOT NULL
          AND EXISTS (SELECT 1 FROM water_allocation wa WHERE wa.field_id = f.field_id AND wa.is_active) AS has_allocation,
        COALESCE(f.remaining_budget_litres, 0) AS budget,
        COALESCE(current_farm_balance(f.farm_id), 0)
          - (SELECT COALESCE(SUM(o.remaining_budget_litres), 0) FROM field o WHERE o.farm_id = f.farm_id) AS unallocated,
        CASE WHEN ${coverIrrigation ? "true" : "false"}::boolean
             THEN GREATEST(${String(amount)}::numeric - COALESCE(f.remaining_budget_litres, 0), 0)
             ELSE ${String(amount)}::numeric
        END AS needed
      FROM field f
      WHERE f.field_id = ${fieldId}::uuid
      FOR UPDATE OF f`
      .returnsRow({
        has_allocation: "pg/bool@1",
        budget: "pg/numeric@1",
        unallocated: "pg/numeric@1",
        needed: "pg/numeric@1",
      })
      .build(),
  );
  if (!row) throw new AppError("errors.notFound");
  // A field without an allocation has no budget; giving it one here would be
  // released again the next time its allocation is synced.
  if (!row.has_allocation) throw new AppError("water.noAllocation");

  const budget = fromDbNumber(row.budget) ?? 0;
  const needed = fromDbNumber(row.needed) ?? 0;
  const unallocated = fromDbNumber(row.unallocated) ?? 0;
  if (needed <= 0) return { movedLitres: 0, budgetTxnId: null, budgetAfterLitres: budget };
  if (needed > unallocated) {
    throw new AppError("water.reserveTooSmall", { needed: needed, available: unallocated });
  }

  // 3. Write through the schema's single budget write path (update + audit row)
  await tx.query(
    db.raw.sql`
      SELECT 1 AS done FROM apply_field_budget_change(
        ${fieldId}::uuid,
        ${String(row.budget)}::numeric + ${String(row.needed)}::numeric,
        'ALLOCATE', NULL, ${String(row.unallocated)}::numeric, NULL)`
      .returnsRow({ done: "pg/int4@1" })
      .build(),
  );

  // A separate statement, so it sees the audit row the call above inserted
  const [audit] = await tx.query(
    db.raw.sql`
      SELECT budget_txn_id, budget_after_litres
      FROM field_budget_transaction
      WHERE field_id = ${fieldId}::uuid
        AND reason = 'ALLOCATE'
        AND water_transaction_id IS NULL
        AND allocation_percentage IS NULL
        AND created_at = now()
      ORDER BY budget_txn_id
      LIMIT 1`
      .returnsRow({ budget_txn_id: "pg/uuid@1", budget_after_litres: "pg/numeric@1" })
      .build(),
  );
  if (!audit) throw new AppError("errors.integrity");
  return {
    movedLitres: needed,
    budgetTxnId: audit.budget_txn_id,
    budgetAfterLitres: fromDbNumber(audit.budget_after_litres) ?? 0,
  };
}

/**
 * Top up a field's budget from the farm reserve (the farm's unallocated water).
 * No water enters or leaves the farm, so there is no ledger row; the field's
 * budget history shows it as a manual "Topped up" entry.
 */
export async function topUpFieldBudget(actor: Actor, input: z.infer<typeof topUpSchema>) {
  authorize(actor, "budget.topUp");
  await assertFieldAccess(actor, input.fieldId);
  try {
    return await db.transaction(async (tx) => {
      const result = await moveFromReserve(tx, input.fieldId, input.quantityLitres, false);
      return { addedLitres: result.movedLitres, remainingBudgetLitres: result.budgetAfterLitres };
    });
  } catch (e) {
    throw toAppError(e);
  }
}

export type IrrigationResult = {
  eventId: string;
  transactionId: string;
  farmBalanceLitres: number;
  fieldBudgetLitres: number;
  replenishedLitres: number;
  statusCode: "OK" | "BUDGET_REPLENISHED" | "BUDGET_EXHAUSTED";
  /** Litres taken from the farm reserve to cover what the budget couldn't (0 if none). */
  borrowedLitres: number;
};

/**
 * Record water used on a planting. record_irrigation() deducts the farm
 * balance AND this field's budget, refuses if either would go negative
 * (IR001/IR002/IR003), and replenishes the budget when it reaches 0.
 *
 * With `useReserve` (the farmer confirmed it), the part the budget can't cover
 * is first moved from the farm reserve into the budget, in the SAME
 * transaction, so either both happen or neither does. That top-up is then
 * linked to the irrigation's ledger row, so undoing the irrigation also gives
 * the borrowed water back to the reserve.
 */
export async function recordIrrigation(actor: Actor, input: z.infer<typeof irrigationSchema>): Promise<IrrigationResult> {
  authorize(actor, "water.irrigate");
  const { field } = await assertPlantingAccess(actor, input.fieldCropId);
  try {
    return await db.transaction(async (tx) => {
      const borrowed = input.useReserve
        ? await moveFromReserve(tx, field.fieldId, input.quantityLitres, true)
        : { movedLitres: 0, budgetTxnId: null };
      const result = await runRecordIrrigation(tx, input);
      if (borrowed.budgetTxnId) {
        await tx.orm.public.FieldBudgetTransaction
          .where({ budgetTxnId: borrowed.budgetTxnId })
          .update({ waterTransactionId: result.transactionId });
      }
      return { ...result, borrowedLitres: borrowed.movedLitres };
    });
  } catch (e) {
    throw toAppError(e);
  }
}

async function runRecordIrrigation(
  tx: Tx,
  input: z.infer<typeof irrigationSchema>,
): Promise<Omit<IrrigationResult, "borrowedLitres">> {
  // record_irrigation() locks the farm again; same transaction, so no wait
  const [row] = await tx.query(
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
  const rows = await db.orm.public.FieldBudgetTransaction
    .where({ fieldId })
    // Rows written by one SQL call share created_at (now() is per transaction).
    // There, a replenishment (ALLOCATE) always follows the deduction (IRRIGATE)
    // or release, so list ALLOCATE first to keep "newest first" correct.
    .orderBy([(b) => b.createdAt.desc(), (b) => b.reason.asc()])
    .limit(limit)
    .all();
  // An irrigation that borrowed from the farm reserve writes three rows at
  // once: the top-up (ALLOCATE, no %), the deduction, and any replenishment
  // (ALLOCATE with a %). Put them back in the order they happened.
  const step = (b: (typeof rows)[number]) =>
    b.reason === "ALLOCATE" && b.allocationPercentage === null ? 2 : b.reason === "ALLOCATE" ? 0 : 1;
  const time = (b: (typeof rows)[number]) => new Date(b.createdAt).getTime();
  return rows.sort((a, b) => time(b) - time(a) || step(a) - step(b));
}
