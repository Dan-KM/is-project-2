import "server-only";
import type { z } from "zod";
import { db } from "@/lib/db";
import { AppError, toAppError } from "@/lib/errors";
import { authorize, type Actor } from "@/lib/auth/actor";
import { assertFieldAccess, assertUuid } from "@/lib/auth/access";
import { calendarDaysBetween, parseDbTimestamp } from "@/lib/time";
import type { createReadingSchema, updateReadingSchema } from "@/lib/validation/schemas";
import { fromDbNumber, toDbNumber } from "./shared";

// Soil readings (field_conditions). Values that can be worked out from the DB
// are derived here and offered as editable defaults, so the farmer only types
// what they actually measured. water_availability is left NULL on insert so the
// DB trigger snapshots the field's budget at that moment.

/** How many days back Historical_Soil_Moisture averages over. */
export const HISTORY_WINDOW_DAYS = 7;

export type FieldWaterFacts = {
  remainingBudgetLitres: number | null;
  lastIrrigationLitres: number | null;
  lastIrrigationAt: Date | null;
  daysSinceLastIrrigation: number | null;
  /** Average moisture of readings in the window BEFORE `before` (null if none). */
  historicalSoilMoisture: number | null;
  latestSoilPh: number | null;
  latestSoilEc: number | null;
};

/**
 * Everything the DB already knows about a field's water and soil. Not
 * permission-checked: callers must check access first.
 */
export async function deriveFieldWaterFacts(fieldId: string, before: Date = new Date()): Promise<FieldWaterFacts> {
  const field = await db.orm.public.Field.select("remainingBudgetLitres").where({ fieldId }).first();
  if (!field) throw new AppError("errors.notFound");

  // Irrigation events hang off plantings, so look across all of the field's plantings
  const [lastIrrigation] = await db.runtime().query(
    db.raw.sql`
      SELECT ie.quantity_used_litres, ie.irrigation_date
      FROM irrigation_event ie
      JOIN field_crop fc ON fc.field_crop_id = ie.field_crop_id
      WHERE fc.field_id = ${fieldId}::uuid
      ORDER BY ie.irrigation_date DESC
      LIMIT 1`
      .returnsRow({ quantity_used_litres: "pg/numeric@1", irrigation_date: "pg/timestamptz-string@1" })
      .build(),
  );

  const [history] = await db.runtime().query(
    db.raw.sql`
      SELECT AVG(soil_moisture)::numeric(5,2) AS avg_moisture
      FROM field_conditions
      WHERE field_id = ${fieldId}::uuid
        AND soil_moisture IS NOT NULL
        AND date_time <  ${before.toISOString()}::timestamptz
        AND date_time >= ${before.toISOString()}::timestamptz - make_interval(days => ${HISTORY_WINDOW_DAYS})`
      .returnsRow({ avg_moisture: { codecId: "pg/numeric@1", nullable: true } })
      .build(),
  );

  // pH and EC change slowly, so the latest known value is a sensible default
  const latestPh = await db.orm.public.FieldConditions
    .select("soilPh")
    .where({ fieldId })
    .where((r) => r.soilPh.isNotNull())
    .orderBy((r) => r.dateTime.desc())
    .first();
  const latestEc = await db.orm.public.FieldConditions
    .select("soilEc")
    .where({ fieldId })
    .where((r) => r.soilEc.isNotNull())
    .orderBy((r) => r.dateTime.desc())
    .first();

  const lastAt = lastIrrigation ? parseDbTimestamp(lastIrrigation.irrigation_date) : null;
  return {
    remainingBudgetLitres: fromDbNumber(field.remainingBudgetLitres),
    lastIrrigationLitres: lastIrrigation ? fromDbNumber(lastIrrigation.quantity_used_litres) : null,
    lastIrrigationAt: lastAt,
    daysSinceLastIrrigation: lastAt ? calendarDaysBetween(lastAt, before) : null,
    historicalSoilMoisture: fromDbNumber(history?.avg_moisture),
    latestSoilPh: fromDbNumber(latestPh?.soilPh),
    latestSoilEc: fromDbNumber(latestEc?.soilEc),
  };
}

/** Prefilled values for the reading form. */
export async function getReadingDefaults(actor: Actor, fieldId: string) {
  authorize(actor, "farm.read");
  await assertFieldAccess(actor, fieldId);
  const facts = await deriveFieldWaterFacts(fieldId);
  return {
    soilPh: facts.latestSoilPh,
    soilEc: facts.latestSoilEc,
    waterAvailability: facts.remainingBudgetLitres,
    previousIrrigationAmount: facts.lastIrrigationLitres,
    daysSinceLastIrrigation: facts.daysSinceLastIrrigation,
  };
}

export async function listReadings(actor: Actor, fieldId: string, limit = 50) {
  authorize(actor, "farm.read");
  await assertFieldAccess(actor, fieldId);
  return db.orm.public.FieldConditions
    .where({ fieldId })
    .orderBy((r) => r.dateTime.desc())
    .limit(limit)
    .all();
}

export async function getLatestReading(fieldId: string) {
  return db.orm.public.FieldConditions.where({ fieldId }).orderBy((r) => r.dateTime.desc()).first();
}

type ReadingValues = Omit<z.infer<typeof createReadingSchema>, "fieldId">;

function readingColumns(input: ReadingValues) {
  return {
    dateTime: input.dateTime,
    soilMoisture: toDbNumber(input.soilMoisture),
    soilTemperature: toDbNumber(input.soilTemperature),
    soilPh: toDbNumber(input.soilPh),
    soilEc: toDbNumber(input.soilEc),
    // NULL → the DB trigger fills in the field's current budget
    waterAvailability: toDbNumber(input.waterAvailability),
    previousIrrigationAmount: toDbNumber(input.previousIrrigationAmount),
    daysSinceLastIrrigation: input.daysSinceLastIrrigation ?? null,
  };
}

export async function createReading(actor: Actor, input: z.infer<typeof createReadingSchema>) {
  authorize(actor, "reading.create");
  await assertFieldAccess(actor, input.fieldId);
  try {
    return await db.orm.public.FieldConditions.create({ fieldId: input.fieldId, ...readingColumns(input) });
  } catch (e) {
    throw toAppError(e);
  }
}

async function assertReadingAccess(actor: Actor, fieldConditionsId: string) {
  assertUuid(fieldConditionsId); // ids can come straight from a URL
  const reading = await db.orm.public.FieldConditions.where({ fieldConditionsId }).first();
  if (!reading) throw new AppError("errors.notFound");
  await assertFieldAccess(actor, reading.fieldId);
  return reading;
}

/** One reading with its field (for the edit page). */
export async function getReading(actor: Actor, fieldConditionsId: string) {
  authorize(actor, "farm.read");
  const reading = await assertReadingAccess(actor, fieldConditionsId);
  const field = await assertFieldAccess(actor, reading.fieldId);
  return { reading, field };
}

export async function updateReading(actor: Actor, input: z.infer<typeof updateReadingSchema>) {
  authorize(actor, "reading.update");
  await assertReadingAccess(actor, input.fieldConditionsId);
  try {
    return await db.orm.public.FieldConditions
      .where({ fieldConditionsId: input.fieldConditionsId })
      .update(readingColumns(input));
  } catch (e) {
    throw toAppError(e);
  }
}

export async function deleteReading(actor: Actor, fieldConditionsId: string) {
  authorize(actor, "reading.delete");
  await assertReadingAccess(actor, fieldConditionsId);
  await db.orm.public.FieldConditions.where({ fieldConditionsId }).delete();
}
