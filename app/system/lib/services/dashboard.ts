import "server-only";
import { db } from "@/lib/db";
import { authorize, type Actor } from "@/lib/auth/actor";
import { assertFarmAccess } from "@/lib/auth/access";
import { calendarDaysBetween, daysSinceDate, parseDbTimestamp } from "@/lib/time";
import { getFarmWaterStatus } from "./farms";
import { listFieldBudgets, listFieldsWithCrops } from "./fields";
import { fromDbNumber } from "./shared";
import { listLedgerWithFields } from "./water";

// Everything the farmer dashboard shows for one farm, in a handful of queries
// (one per kind of data for the whole farm, not one per field).

export type DashboardField = {
  fieldId: string;
  fieldName: string;
  cropName: string | null;
  fieldCropId: string | null;
  growthStage: string | null;
  /** Days left until the crop's expected maturity (negative = past it). */
  daysToMaturity: number | null;
  budgetStatus: "NO_ALLOCATION" | "EXHAUSTED" | "AVAILABLE";
  remainingBudgetLitres: number | null;
  latestMoisture: number | null;
  latestMoistureAt: string | null;
  latestAction: string | null;
  latestActionAt: string | null;
  daysSinceLastIrrigation: number | null;
};

export async function getFarmDashboard(actor: Actor, farmId: string) {
  authorize(actor, "farm.read");
  const farm = await assertFarmAccess(actor, farmId);

  const [water, fields, budgets, ledger, readings, predictions, irrigations, growth] = await Promise.all([
    getFarmWaterStatus(actor, farmId),
    listFieldsWithCrops(actor, farmId),
    listFieldBudgets(actor, farmId),
    listLedgerWithFields(actor, farmId, 5),
    // Latest soil reading per field
    db.runtime().query(
      db.raw.sql`
        SELECT DISTINCT ON (fc.field_id) fc.field_id, fc.soil_moisture, fc.date_time
        FROM field_conditions fc JOIN field f ON f.field_id = fc.field_id
        WHERE f.farm_id = ${farmId}::uuid AND fc.soil_moisture IS NOT NULL
        ORDER BY fc.field_id, fc.date_time DESC`
        .returnsRow({ field_id: "pg/uuid@1", soil_moisture: "pg/numeric@1", date_time: "pg/timestamptz-string@1" })
        .build(),
    ),
    // Latest recommendation per field (across its plantings)
    db.runtime().query(
      db.raw.sql`
        SELECT DISTINCT ON (fc.field_id) fc.field_id, p.predicted_irrigation_action, p.predicted_at
        FROM irrigation_action_prediction p
        JOIN field_crop fc ON fc.field_crop_id = p.field_crop_id
        JOIN field f ON f.field_id = fc.field_id
        WHERE f.farm_id = ${farmId}::uuid
        ORDER BY fc.field_id, p.predicted_at DESC`
        .returnsRow({ field_id: "pg/uuid@1", predicted_irrigation_action: "sql/varchar@1", predicted_at: "pg/timestamptz-string@1" })
        .build(),
    ),
    // Last irrigation per field
    db.runtime().query(
      db.raw.sql`
        SELECT fc.field_id, MAX(ie.irrigation_date) AS last_irrigation
        FROM irrigation_event ie
        JOIN field_crop fc ON fc.field_crop_id = ie.field_crop_id
        JOIN field f ON f.field_id = fc.field_id
        WHERE f.farm_id = ${farmId}::uuid
        GROUP BY fc.field_id`
        .returnsRow({ field_id: "pg/uuid@1", last_irrigation: "pg/timestamptz-string@1" })
        .build(),
    ),
    // Latest growth stage of each active planting
    db.runtime().query(
      db.raw.sql`
        SELECT DISTINCT ON (ce.field_crop_id) ce.field_crop_id, ce.growth_stage
        FROM crop_evolution ce
        JOIN field_crop fc ON fc.field_crop_id = ce.field_crop_id AND fc.is_active
        JOIN field f ON f.field_id = fc.field_id
        WHERE f.farm_id = ${farmId}::uuid
        ORDER BY ce.field_crop_id, ce.recorded_at DESC`
        .returnsRow({ field_crop_id: "pg/uuid@1", growth_stage: "sql/varchar@1" })
        .build(),
    ),
  ]);

  const now = new Date();
  const dashboardFields: DashboardField[] = fields.map((field) => {
    const planting = field.activePlanting;
    const budget = budgets.find((b) => b.fieldId === field.fieldId);
    const reading = readings.find((r) => r.field_id === field.fieldId);
    const prediction = predictions.find((p) => p.field_id === field.fieldId);
    const irrigation = irrigations.find((i) => i.field_id === field.fieldId);
    const stage = planting ? growth.find((g) => g.field_crop_id === planting.fieldCropId) : undefined;
    // Maturity worked out in Nairobi time (the DB view uses the server's UTC date)
    const maturityDays = planting?.crop.daysToMaturity ?? null;
    return {
      fieldId: field.fieldId,
      fieldName: field.fieldName,
      cropName: planting?.crop.cropName ?? null,
      fieldCropId: planting?.fieldCropId ?? null,
      growthStage: stage?.growth_stage ?? null,
      daysToMaturity: planting && maturityDays !== null ? maturityDays - daysSinceDate(planting.plantingDate, now) : null,
      budgetStatus: budget?.budgetStatus ?? "NO_ALLOCATION",
      remainingBudgetLitres: budget?.remainingBudgetLitres ?? null,
      latestMoisture: reading ? fromDbNumber(reading.soil_moisture) : null,
      latestMoistureAt: reading?.date_time ?? null,
      latestAction: prediction?.predicted_irrigation_action ?? null,
      latestActionAt: prediction?.predicted_at ?? null,
      daysSinceLastIrrigation: irrigation ? calendarDaysBetween(parseDbTimestamp(irrigation.last_irrigation), now) : null,
    };
  });

  return { farm, water, fields: dashboardFields, recentLedger: ledger, hasWaterRecords: ledger.length > 0 };
}
