import "server-only";
import { db } from "@/lib/db";
import { AppError, toAppError } from "@/lib/errors";
import { authorize, type Actor } from "@/lib/auth/actor";
import { assertFieldAccess, assertUuid, assertPlantingAccess } from "@/lib/auth/access";
import { buildFeaturePayload, type AssembledFeatures, type FarmerInput } from "@/lib/features/payload";
import { FEATURES, FEATURE_COUNT, FEATURE_NAMES, type IrrigationAction } from "@/lib/features/catalog";
import { getModelVersion, getPredictionMode, predict, type PredictionMode } from "@/lib/prediction";
import type { PredictionInput } from "@/lib/validation/schemas";
import { dbText, toDbNumber } from "./shared";

// Prediction flow: assemble features → (farmer confirms) → predict → store.
// The prediction table has one column per feature, so the exact request is
// stored with the result: a NULL feature column = omitted / estimated.

/** Step 1: assemble the features for the confirmation screen. Writes nothing. */
export async function previewPrediction(actor: Actor, input: PredictionInput): Promise<AssembledFeatures> {
  authorize(actor, "prediction.create");
  await assertFieldAccess(actor, input.fieldId);
  return buildFeaturePayload(input.fieldId, input.features as FarmerInput);
}

export type PredictionOutcome = {
  predictionId: string;
  action: IrrigationAction;
  mode: PredictionMode;
  estimatedCount: number;
  totalFeatures: number;
  missing: AssembledFeatures["missing"];
  entries: AssembledFeatures["entries"];
  remainingBudgetLitres: number | null;
};

/**
 * Step 2: run the prediction and store it together with today's soil reading.
 * The features are rebuilt server-side (never trusted from the client), then
 * the reading and the prediction are written in one transaction.
 */
export async function createPrediction(actor: Actor, input: PredictionInput): Promise<PredictionOutcome> {
  authorize(actor, "prediction.create");
  await assertFieldAccess(actor, input.fieldId);

  const now = new Date();
  const assembled = await buildFeaturePayload(input.fieldId, input.features as FarmerInput, now);
  const action = await predict(assembled.payload);
  const p = assembled.payload;

  // Only values the farmer actually measured go into the soil reading row;
  // estimates (e.g. weather soil temperature) are stored with the prediction only.
  const fromFarmer = (name: keyof typeof p) =>
    assembled.entries.find((e) => e.name === name)?.origin === "farmer" ? (p[name] as number) : undefined;

  // One column per feature, mapped through the catalog
  const featureColumns: Record<string, unknown> = {};
  for (const name of FEATURE_NAMES) {
    const value = p[name];
    const def = FEATURES[name];
    if (value === undefined) {
      featureColumns[def.predictionColumn] = null;
    } else if (def.kind === "category") {
      featureColumns[def.predictionColumn] = dbText(value as string);
    } else if (def.kind === "integer") {
      featureColumns[def.predictionColumn] = value;
    } else {
      featureColumns[def.predictionColumn] = toDbNumber(value as number);
    }
  }

  try {
    const predictionId = await db.transaction(async (tx) => {
      await tx.orm.public.FieldConditions.create({
        fieldId: input.fieldId,
        dateTime: now.toISOString(),
        soilMoisture: toDbNumber(p.Soil_Moisture),
        soilTemperature: toDbNumber(fromFarmer("Soil_Temperature")),
        soilPh: toDbNumber(fromFarmer("Soil_pH")),
        soilEc: toDbNumber(fromFarmer("Soil_EC")),
        waterAvailability: null, // the DB trigger snapshots the field budget
        previousIrrigationAmount: toDbNumber(p.Previous_Irrigation_Amount),
        daysSinceLastIrrigation: p.Days_Since_Last_Irrigation ?? null,
      });

      const row = await tx.orm.public.IrrigationActionPrediction.create({
        // The remaining feature columns come from the catalog mapping above
        ...(featureColumns as object),
        fieldCropId: assembled.context.fieldCropId,
        predictedAt: now.toISOString(),
        predictedIrrigationAction: dbText(action),
        modelVersion: dbText(getModelVersion()),
        predictionConfidence: null, // the API only returns the class
        // NOT NULL columns; buildFeaturePayload guarantees these three are present
        cropType: dbText(p.Crop_Type!),
        growthStage: dbText(p.Growth_Stage!),
        soilType: dbText(p.Soil_Type!),
      });
      return row.predictionId;
    });

    return {
      predictionId,
      action,
      mode: getPredictionMode(),
      estimatedCount: assembled.missing.length,
      totalFeatures: FEATURE_COUNT,
      missing: assembled.missing,
      entries: assembled.entries,
      remainingBudgetLitres: assembled.context.remainingBudgetLitres,
    };
  } catch (e) {
    throw toAppError(e);
  }
}

/** Predictions for a field (all its plantings), newest first. */
export async function listPredictions(actor: Actor, fieldId: string, limit = 20) {
  authorize(actor, "farm.read");
  await assertFieldAccess(actor, fieldId);
  const plantings = await db.orm.public.FieldCrop.select("fieldCropId").where({ fieldId }).all();
  if (plantings.length === 0) return [];
  return db.orm.public.IrrigationActionPrediction
    .where((r) => r.fieldCropId.in(plantings.map((x) => x.fieldCropId)))
    .orderBy((r) => r.predictedAt.desc())
    .limit(limit)
    .all();
}

export async function getPrediction(actor: Actor, predictionId: string) {
  authorize(actor, "farm.read");
  assertUuid(predictionId); // ids can come straight from a URL
  const row = await db.orm.public.IrrigationActionPrediction.where({ predictionId }).first();
  if (!row) throw new AppError("errors.notFound");
  await assertPlantingAccess(actor, row.fieldCropId);
  return row;
}

export async function deletePrediction(actor: Actor, predictionId: string) {
  authorize(actor, "prediction.delete");
  await getPrediction(actor, predictionId);
  await db.orm.public.IrrigationActionPrediction.where({ predictionId }).delete();
}
