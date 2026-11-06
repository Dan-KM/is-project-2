import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { dayOfYear, hourOfDay } from "@/lib/time";
import { deriveFieldWaterFacts } from "@/lib/services/readings";
import { getLatestGrowthRecord } from "@/lib/services/plantings";
import { getWeatherFeatures } from "@/lib/services/weather";
import { fromDbNumber } from "@/lib/services/shared";
import {
  FEATURES, FEATURE_NAMES, type FeatureName, type FeaturePayload, type FeatureSource,
} from "./catalog";

/**
 * What the farmer sends for a prediction. For each feature:
 *   undefined → use the value derived from the DB / weather / clock
 *   a value   → the farmer's value wins (they measured or corrected it)
 *   null      → the farmer cleared it → omit it (the model service estimates it)
 */
export type FarmerInput = Partial<Record<FeatureName, string | number | null>>;

/** Where each feature's value ended up coming from; "missing" = omitted from the request. */
export type FeatureOrigin = FeatureSource | "missing";

export type AssembledFeature = {
  name: FeatureName;
  value: string | number | undefined;
  origin: FeatureOrigin;
  required: boolean;
};

export type AssembledFeatures = {
  /** The exact request body: only keys with real values. */
  payload: FeaturePayload;
  /** All features in catalog order, for the confirmation screen. */
  entries: AssembledFeature[];
  /** Features omitted from the request (the model service will estimate them). */
  missing: FeatureName[];
  context: {
    fieldId: string;
    farmId: string;
    fieldCropId: string;
    remainingBudgetLitres: number | null;
    weatherObservedAt: Date | null;
  };
};

/** A value is "real" if it's a finite number in range, or an allowed category label. */
function validFor(name: FeatureName, value: unknown): value is string | number {
  const def = FEATURES[name];
  if (def.kind === "category") return typeof value === "string" && (def.categories as readonly string[]).includes(value);
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (def.kind === "integer" && !Number.isInteger(value)) return false;
  if ("min" in def && value < def.min) return false;
  if ("max" in def && value > def.max) return false;
  return true;
}

/**
 * Assemble the model's input for a field. Derives everything the DB, the
 * weather store and the clock can provide, applies the farmer's input on top,
 * and leaves out anything without a real value. It never inserts null, "" or
 * a placeholder 0. Callers must check the actor's access to the field first.
 */
export async function buildFeaturePayload(
  fieldId: string,
  farmerInput: FarmerInput,
  now: Date = new Date(),
): Promise<AssembledFeatures> {
  const field = await db.orm.public.Field.where({ fieldId }).first();
  if (!field) throw new AppError("errors.notFound");

  const planting = await db.orm.public.FieldCrop.where({ fieldId, isActive: true }).include("crop").first();
  if (!planting) throw new AppError("planting.none");

  const [growth, facts, weather] = await Promise.all([
    getLatestGrowthRecord(planting.fieldCropId),
    deriveFieldWaterFacts(fieldId, now),
    getWeatherFeatures(field.farmId, now),
  ]);

  // Derived values, each tagged with its source. undefined = not available.
  const derived: Partial<Record<FeatureName, { value: string | number | null | undefined; origin: FeatureSource }>> = {
    Crop_Type: { value: planting.crop.cropName, origin: "db" },
    Growth_Stage: { value: growth?.growthStage, origin: "db" },
    Soil_Type: { value: field.soilType, origin: "db" },
    Day_of_Year: { value: dayOfYear(now), origin: "system" },
    Time_of_Day: { value: hourOfDay(now), origin: "system" },
    Soil_pH: { value: facts.latestSoilPh, origin: "db" },
    Soil_EC: { value: facts.latestSoilEc, origin: "db" },
    Soil_Temperature: { value: weather.features.Soil_Temperature, origin: "weather" },
    Ambient_Temperature: { value: weather.features.Ambient_Temperature, origin: "weather" },
    Relative_Humidity: { value: weather.features.Relative_Humidity, origin: "weather" },
    Wind_Speed: { value: weather.features.Wind_Speed, origin: "weather" },
    Solar_Radiation: { value: weather.features.Solar_Radiation, origin: "weather" },
    Rainfall_24h: { value: weather.features.Rainfall_24h, origin: "weather" },
    Rainfall_Forecast_24h: { value: weather.features.Rainfall_Forecast_24h, origin: "weather" },
    Evaporation_Demand: { value: weather.features.Evaporation_Demand, origin: "weather" },
    Root_Zone_Depth: { value: fromDbNumber(growth?.rootZoneDepth), origin: "db" },
    Leaf_Area_Index: { value: fromDbNumber(growth?.leafAreaIndex), origin: "db" },
    Crop_Coefficient: { value: fromDbNumber(planting.crop.cropCoefficient), origin: "db" },
    Field_Slope: { value: fromDbNumber(field.fieldSlope), origin: "db" },
    Water_Availability: { value: facts.remainingBudgetLitres, origin: "db" },
    Previous_Irrigation_Amount: { value: facts.lastIrrigationLitres, origin: "db" },
    Days_Since_Last_Irrigation: { value: facts.daysSinceLastIrrigation, origin: "db" },
    Historical_Soil_Moisture: { value: facts.historicalSoilMoisture, origin: "db" },
    // Soil_Moisture: farmer only. Water_Stress_Index: never sent (no formula).
  };

  const payload: Record<string, string | number> = {};
  const entries: AssembledFeature[] = [];

  for (const name of FEATURE_NAMES) {
    const def = FEATURES[name];
    const fromFarmer = farmerInput[name];
    let value: string | number | undefined;
    let origin: FeatureOrigin = "missing";

    if ("alwaysOmitted" in def && def.alwaysOmitted) {
      // decided in Phase 0: the model service handles it
    } else if (fromFarmer !== undefined) {
      // The farmer's value wins; null means they deliberately cleared it
      if (fromFarmer !== null && validFor(name, fromFarmer)) {
        value = fromFarmer;
        origin = "farmer";
      }
    } else {
      const d = derived[name];
      if (d && d.value !== null && d.value !== undefined && validFor(name, d.value)) {
        value = d.value;
        origin = d.origin;
      }
    }

    if (value !== undefined) payload[name] = value;
    entries.push({ name, value, origin, required: def.required });
  }

  // Required features can't be estimated sensibly; ask the farmer instead
  const missingRequired = entries.filter((e) => e.required && e.origin === "missing").map((e) => e.name);
  if (missingRequired.length > 0) {
    throw new AppError("prediction.requiredMissing", { features: missingRequired.join(", ") });
  }

  return {
    payload: payload as FeaturePayload,
    entries,
    missing: entries.filter((e) => e.origin === "missing").map((e) => e.name),
    context: {
      fieldId,
      farmId: field.farmId,
      fieldCropId: planting.fieldCropId,
      remainingBudgetLitres: facts.remainingBudgetLitres,
      weatherObservedAt: weather.observedAt,
    },
  };
}
