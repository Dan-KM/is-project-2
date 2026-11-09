import { z } from "zod";
import { FEATURES, FEATURE_NAMES, GROWTH_STAGES, SOIL_TYPES, type FeatureName } from "@/lib/features/catalog";
import {
  booleanish, dateOnly, dateTime, id, oneOf, optionalDateTime, optionalNumber, optionalText,
  requiredNumber, requiredText,
} from "./common";

// One Zod schema per operation. Used by the forms (client) and re-checked by
// the server actions. Limits mirror the CHECK constraints and column sizes in
// database/init/02-schema.sql so bad input is caught before reaching the DB.

// ---------- Users / auth ----------
const email = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.email({ error: "validation.email" }).max(255),
);
const password = z.string({ error: "validation.required" }).min(8, { error: "validation.password" }).max(200);

export const registerSchema = z.object({
  firstName: requiredText(100),
  lastName: requiredText(100),
  email,
  phone: optionalText(20),
  password,
});
export const loginSchema = z.object({ email, password: z.string().min(1, { error: "validation.required" }) });
export const updateProfileSchema = z.object({
  firstName: requiredText(100),
  lastName: requiredText(100),
  email,
  phone: optionalText(20),
});
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });

// ---------- Farm ----------
const farmFields = {
  farmName: requiredText(150),
  farmAddress: requiredText(255),
  latitude: requiredNumber({ min: -90, max: 90 }),
  longitude: requiredNumber({ min: -180, max: 180 }),
  area: requiredNumber({ positive: true, max: 999_999 }), // hectares, NUMERIC(10,4)
};
export const createFarmSchema = z.object(farmFields);
export const updateFarmSchema = z.object({ farmId: id, ...farmFields });
export const farmIdSchema = z.object({ farmId: id });

// ---------- Field ----------
const fieldFields = {
  fieldName: requiredText(150),
  soilType: oneOf(SOIL_TYPES), // only the labels the model was trained on
  area: requiredNumber({ positive: true, max: 999_999 }),
  fieldSlope: optionalNumber({ min: 0, max: 999 }),
};
export const createFieldSchema = z.object({ farmId: id, ...fieldFields });
export const updateFieldSchema = z.object({ fieldId: id, ...fieldFields });
export const fieldIdSchema = z.object({ fieldId: id });

// ---------- Plantings and growth records ----------
export const plantCropSchema = z.object({ fieldId: id, cropId: id, plantingDate: dateOnly });
export const updatePlantingSchema = z.object({
  fieldCropId: id,
  plantingDate: dateOnly.optional(),
  isActive: booleanish.optional(), // false = end this planting
});
export const plantingIdSchema = z.object({ fieldCropId: id });

const growthFields = {
  recordedAt: dateTime,
  growthStage: oneOf(GROWTH_STAGES),
  rootZoneDepth: optionalNumber({ min: 0, max: 99 }),
  leafAreaIndex: optionalNumber({ min: 0, max: 999 }),
  daysSincePlanting: optionalNumber({ min: 0, int: true, max: 100_000 }),
};
export const createGrowthSchema = z.object({ fieldCropId: id, ...growthFields });
export const updateGrowthSchema = z.object({ evolutionId: id, ...growthFields });
export const growthIdSchema = z.object({ evolutionId: id });

// ---------- Soil readings (field_conditions) ----------
const readingFields = {
  dateTime,
  soilMoisture: optionalNumber({ min: 0, max: 100 }),
  soilTemperature: optionalNumber({ min: -50, max: 100 }),
  soilPh: optionalNumber({ min: 0, max: 14 }),
  soilEc: optionalNumber({ min: 0, max: 9999 }),
  // Prefilled from the DB but editable. Leave blank to let the DB snapshot the budget.
  waterAvailability: optionalNumber({ min: 0 }),
  previousIrrigationAmount: optionalNumber({ min: 0 }),
  daysSinceLastIrrigation: optionalNumber({ min: 0, int: true }),
};
export const createReadingSchema = z.object({ fieldId: id, ...readingFields });
export const updateReadingSchema = z.object({ fieldConditionsId: id, ...readingFields });
export const readingIdSchema = z.object({ fieldConditionsId: id });

// ---------- Weather (manual fallback entry) ----------
export const manualWeatherSchema = z.object({
  farmId: id,
  dateTime,
  recordType: oneOf(["historical", "observed", "forecast"] as const),
  ambientTemperature: optionalNumber({ min: -50, max: 70 }),
  relativeHumidity: optionalNumber({ min: 0, max: 100 }),
  rainfall24h: optionalNumber({ min: 0 }),
  rainfallForecast24h: optionalNumber({ min: 0 }),
  solarRadiation: optionalNumber({ min: 0 }),
  evapotranspirationRate: optionalNumber({ min: 0 }),
  windSpeed: optionalNumber({ min: 0 }),
});
export const weatherIdSchema = z.object({ weatherId: id });

// ---------- Water ----------
const notes = optionalText(1000);
export const initialWaterSchema = z.object({
  farmId: id,
  quantityLitres: requiredNumber({ min: 0, max: 9_999_999_999 }), // an empty tank (0) is a real starting point
  date: optionalDateTime,
  notes,
});
export const refillSchema = z.object({
  farmId: id,
  quantityLitres: requiredNumber({ positive: true, max: 9_999_999_999 }),
  date: optionalDateTime,
  notes,
});
export const irrigationSchema = z.object({
  fieldCropId: id,
  quantityLitres: requiredNumber({ positive: true, max: 9_999_999_999 }),
  irrigationDate: optionalDateTime,
  notes,
  // The farmer agreed to cover what the field budget can't from the farm reserve
  useReserve: booleanish,
});
export const checkIrrigationSchema = z.object({ fieldCropId: id, quantityLitres: optionalNumber({}) });
export const editLedgerEntrySchema = z.object({ transactionId: id, transactionDate: optionalDateTime, notes });
export const allocationSchema = z.object({
  fieldId: id,
  // Blank = remove the allocation (its budget returns to the unallocated pool)
  percentage: optionalNumber({ min: 0, max: 100 }),
});
export const topUpSchema = z.object({
  fieldId: id,
  quantityLitres: requiredNumber({ positive: true, max: 9_999_999_999 }),
});
export const irrigationNotesSchema = z.object({ eventId: id, notes });

// ---------- Prediction ----------
// Every feature may be sent by the farmer to override the derived value.
// `null` means "the farmer cleared it" → the feature is omitted.
const featureShape = Object.fromEntries(
  FEATURE_NAMES.map((name) => {
    const def = FEATURES[name];
    const value =
      def.kind === "category"
        ? z.enum(def.categories as unknown as [string, ...string[]], { error: "validation.option" })
        : optionalNumber({
            min: "min" in def ? def.min : undefined,
            max: "max" in def ? def.max : undefined,
            int: def.kind === "integer",
          });
    return [name, value.nullable().optional()];
  }),
) as unknown as Record<FeatureName, z.ZodType>;

export const predictionInputSchema = z.object({
  fieldId: id,
  features: z.object(featureShape).extend({
    // The one value the farmer must always provide
    Soil_Moisture: requiredNumber({ min: 0, max: 100 }),
  }),
});
export const predictionIdSchema = z.object({ predictionId: id });

export type PredictionInput = z.infer<typeof predictionInputSchema>;
