// Single source of truth for the model's input features.
//
// Names and category labels match the training dataset's header and values
// EXACTLY (dataset/Irrigation_Scheduling_Dataset.csv); the FastAPI service
// expects these keys. The dropdowns, Zod schemas, confirmation screen, DB
// mapping and docs/prediction-contract.md are all driven from this file.
//
// Missing optional features are OMITTED from the request; the FastAPI pipeline
// imputes them (median / mode). We never send null, "" or placeholder zeros.

export const CROP_TYPES = ["Cotton", "Groundnut", "Maize", "Rice", "Soybean", "Sugarcane", "Tomato", "Wheat"] as const;
export const GROWTH_STAGES = ["Seedling", "Vegetative", "Flowering", "Fruiting", "Maturity"] as const;
export const SOIL_TYPES = ["Clay", "Loamy", "Sandy", "Silty"] as const;
export const IRRIGATION_ACTIONS = ["No_Irrigation", "Low", "Medium", "High"] as const;

export type CropType = (typeof CROP_TYPES)[number];
export type GrowthStage = (typeof GROWTH_STAGES)[number];
export type SoilType = (typeof SOIL_TYPES)[number];
export type IrrigationAction = (typeof IRRIGATION_ACTIONS)[number];

/** Where a feature's value comes from. */
export type FeatureSource = "farmer" | "db" | "weather" | "system";

type BaseFeature = {
  /** Where the value normally comes from. */
  source: FeatureSource;
  /** Required features must be present or no prediction is made. */
  required: boolean;
  /** Column in irrigation_action_prediction that stores it (contract field name). */
  predictionColumn: PredictionColumn;
  /** Unit sent to the model; `unitConfirmed: false` = not yet checked against the training data. */
  unit?: string;
  unitConfirmed?: boolean;
  /** Plain description for the docs and the confirmation screen. */
  description: string;
  /** When true the app never sends it (decided in Phase 0); the model service estimates it. */
  alwaysOmitted?: boolean;
};

export type NumericFeature = BaseFeature & { kind: "number" | "integer"; min?: number; max?: number };
export type CategoryFeature = BaseFeature & { kind: "category"; categories: readonly string[] };
export type FeatureDefinition = NumericFeature | CategoryFeature;

/** Prediction-table columns that hold features (names from src/prisma/contract.prisma). */
type PredictionColumn =
  | "cropType" | "growthStage" | "soilType" | "dayOfYear" | "timeOfDay"
  | "soilMoisture" | "soilTemperature" | "soilPh" | "soilEc"
  | "ambientTemperature" | "relativeHumidity" | "windSpeed" | "solarRadiation"
  | "rainfall24h" | "rainfallForecast24h" | "rootZoneDepth" | "leafAreaIndex"
  | "cropCoefficient" | "fieldSlope" | "waterAvailability" | "previousIrrigationAmount"
  | "daysSinceLastIrrigation" | "historicalSoilMoisture" | "evaporationDemand" | "waterStressIndex";

// Order = dataset column order, so the payload reads like a dataset row.
export const FEATURES = {
  Crop_Type: {
    kind: "category", categories: CROP_TYPES, source: "db", required: true, predictionColumn: "cropType",
    description: "Crop planted on the field (crop.crop_name of the active planting).",
  },
  Growth_Stage: {
    kind: "category", categories: GROWTH_STAGES, source: "farmer", required: true, predictionColumn: "growthStage",
    description: "Current growth stage; prefilled from the latest growth record, confirmed by the farmer.",
  },
  Soil_Type: {
    kind: "category", categories: SOIL_TYPES, source: "db", required: true, predictionColumn: "soilType",
    description: "Field soil type (field.soil_type).",
  },
  Day_of_Year: {
    kind: "integer", min: 1, max: 366, source: "system", required: true, predictionColumn: "dayOfYear",
    description: "Day of the year in Nairobi time when the prediction is made.",
  },
  Time_of_Day: {
    kind: "integer", min: 0, max: 23, source: "system", required: true, predictionColumn: "timeOfDay",
    unit: "hour (0–23)", unitConfirmed: false,
    description: "Hour of the day in Nairobi time.",
  },
  Soil_Moisture: {
    kind: "number", min: 0, max: 100, source: "farmer", required: true, predictionColumn: "soilMoisture",
    unit: "%", description: "Today's soil moisture reading entered by the farmer.",
  },
  Soil_Temperature: {
    kind: "number", source: "farmer", required: false, predictionColumn: "soilTemperature", unit: "°C",
    description: "Farmer's measurement; if blank, Open-Meteo's modelled soil temperature (~6 cm) is used.",
  },
  Soil_pH: {
    kind: "number", min: 0, max: 14, source: "farmer", required: false, predictionColumn: "soilPh",
    description: "Soil pH; prefilled from the field's latest reading that has it.",
  },
  Soil_EC: {
    kind: "number", min: 0, source: "farmer", required: false, predictionColumn: "soilEc",
    unit: "dS/m", unitConfirmed: false,
    description: "Soil electrical conductivity; prefilled from the latest reading that has it.",
  },
  Ambient_Temperature: {
    kind: "number", source: "weather", required: false, predictionColumn: "ambientTemperature", unit: "°C",
    description: "Current air temperature at 2 m.",
  },
  Relative_Humidity: {
    kind: "number", min: 0, max: 100, source: "weather", required: false, predictionColumn: "relativeHumidity",
    unit: "%", description: "Current relative humidity at 2 m.",
  },
  Wind_Speed: {
    kind: "number", min: 0, source: "weather", required: false, predictionColumn: "windSpeed",
    unit: "m/s", unitConfirmed: false, description: "Current wind speed at 10 m.",
  },
  Solar_Radiation: {
    kind: "number", min: 0, source: "weather", required: false, predictionColumn: "solarRadiation",
    unit: "MJ/m²/day", unitConfirmed: false, description: "Today's total shortwave radiation.",
  },
  Rainfall_24h: {
    kind: "number", min: 0, source: "weather", required: false, predictionColumn: "rainfall24h",
    unit: "mm", description: "Rain over the past 24 hours.",
  },
  Rainfall_Forecast_24h: {
    kind: "number", min: 0, source: "weather", required: false, predictionColumn: "rainfallForecast24h",
    unit: "mm", description: "Forecast rain for the next 24 hours.",
  },
  Root_Zone_Depth: {
    kind: "number", min: 0, source: "db", required: false, predictionColumn: "rootZoneDepth",
    unit: "m", unitConfirmed: false, description: "From the latest growth record of the active planting.",
  },
  Leaf_Area_Index: {
    kind: "number", min: 0, source: "db", required: false, predictionColumn: "leafAreaIndex",
    description: "From the latest growth record of the active planting.",
  },
  Crop_Coefficient: {
    kind: "number", min: 0, source: "db", required: false, predictionColumn: "cropCoefficient",
    description: "Crop coefficient Kc (crop.crop_coefficient).",
  },
  Field_Slope: {
    kind: "number", min: 0, source: "db", required: false, predictionColumn: "fieldSlope",
    unit: "%", unitConfirmed: false, description: "Field slope (field.field_slope).",
  },
  Water_Availability: {
    kind: "number", min: 0, source: "db", required: false, predictionColumn: "waterAvailability",
    unit: "L", unitConfirmed: true, description: "Field's remaining water budget (field.remaining_budget_litres).",
  },
  Previous_Irrigation_Amount: {
    kind: "number", min: 0, source: "db", required: false, predictionColumn: "previousIrrigationAmount",
    unit: "L", unitConfirmed: true, description: "Litres used in the field's most recent irrigation.",
  },
  Days_Since_Last_Irrigation: {
    kind: "integer", min: 0, source: "db", required: false, predictionColumn: "daysSinceLastIrrigation",
    unit: "days", description: "Calendar days (Nairobi time) since the field's last irrigation.",
  },
  Historical_Soil_Moisture: {
    kind: "number", min: 0, max: 100, source: "db", required: false, predictionColumn: "historicalSoilMoisture",
    unit: "%", description: "Average of the field's soil moisture readings from the previous 7 days.",
  },
  Evaporation_Demand: {
    kind: "number", min: 0, source: "weather", required: false, predictionColumn: "evaporationDemand",
    unit: "mm/day (ET₀)", unitConfirmed: false, description: "Reference evapotranspiration ET₀ (FAO) for today.",
  },
  Water_Stress_Index: {
    kind: "number", source: "db", required: false, predictionColumn: "waterStressIndex", alwaysOmitted: true,
    description: "No formula available; never sent. The model service estimates it.",
  },
} as const satisfies Record<string, FeatureDefinition>;

export type FeatureName = keyof typeof FEATURES;
export const FEATURE_NAMES = Object.keys(FEATURES) as FeatureName[];
export const FEATURE_COUNT = FEATURE_NAMES.length;

/** The value type of each feature in the request body. */
export type FeatureValue<N extends FeatureName> = (typeof FEATURES)[N] extends { kind: "category"; categories: readonly (infer C)[] }
  ? C
  : number;

/** Request body for POST /predict: only keys with real values are present. */
export type FeaturePayload = { [N in FeatureName]?: FeatureValue<N> };
