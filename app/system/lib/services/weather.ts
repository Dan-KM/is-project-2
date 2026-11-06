import "server-only";
import type { z } from "zod";
import { db } from "@/lib/db";
import { AppError, toAppError } from "@/lib/errors";
import { authorize, type Actor } from "@/lib/auth/actor";
import { assertFarmAccess } from "@/lib/auth/access";
import { parseDbTimestamp } from "@/lib/time";
import type { FeaturePayload } from "@/lib/features/catalog";
import type { manualWeatherSchema } from "@/lib/validation/schemas";
import { dbText, fromDbNumber } from "./shared";

// Weather storage. Phase 1 covers storing/reading weather_data rows (including
// a manual entry fallback); Phase 4 adds the Open-Meteo fetch, which will call
// saveWeatherRecord() and reuse getWeatherFeatures().

/** The weather features the model uses, keyed by the model's feature names. */
export type WeatherFeatures = Pick<
  FeaturePayload,
  | "Ambient_Temperature" | "Relative_Humidity" | "Wind_Speed" | "Solar_Radiation"
  | "Rainfall_24h" | "Rainfall_Forecast_24h" | "Evaporation_Demand" | "Soil_Temperature"
>;

export type WeatherSnapshot = {
  features: WeatherFeatures;
  /** When the values were observed (null = no weather stored yet). */
  observedAt: Date | null;
};

/** Stored weather older than this is not used for a prediction (it would mislead the model). */
export const MAX_WEATHER_AGE_HOURS = 6;

export type WeatherRecordInput = {
  farmId: string;
  dateTime: string;
  recordType: "historical" | "observed" | "forecast";
  ambientTemperature?: number;
  relativeHumidity?: number;
  rainfall24h?: number;
  rainfallForecast24h?: number;
  solarRadiation?: number;
  evapotranspirationRate?: number;
  windSpeed?: number;
};

const n = (v?: number) => (v === undefined ? "" : String(v));

/**
 * Insert or update one weather row. The table is unique on
 * (farm_id, date_time, record_type), so fetching twice in the same hour
 * updates the row instead of failing. Not permission-checked (internal).
 */
export async function saveWeatherRecord(input: WeatherRecordInput) {
  try {
    const [row] = await db.runtime().query(
      db.raw.sql`
        INSERT INTO weather_data (farm_id, date_time, record_type, ambient_temperature, relative_humidity,
                                  rainfall_24h, rainfall_forecast_24h, solar_radiation, evapotranspiration_rate, wind_speed)
        VALUES (${input.farmId}::uuid, ${input.dateTime}::timestamptz, ${input.recordType},
                NULLIF(${n(input.ambientTemperature)}, '')::numeric, NULLIF(${n(input.relativeHumidity)}, '')::numeric,
                NULLIF(${n(input.rainfall24h)}, '')::numeric, NULLIF(${n(input.rainfallForecast24h)}, '')::numeric,
                NULLIF(${n(input.solarRadiation)}, '')::numeric, NULLIF(${n(input.evapotranspirationRate)}, '')::numeric,
                NULLIF(${n(input.windSpeed)}, '')::numeric)
        ON CONFLICT (farm_id, date_time, record_type) DO UPDATE SET
          ambient_temperature     = EXCLUDED.ambient_temperature,
          relative_humidity       = EXCLUDED.relative_humidity,
          rainfall_24h            = EXCLUDED.rainfall_24h,
          rainfall_forecast_24h   = EXCLUDED.rainfall_forecast_24h,
          solar_radiation         = EXCLUDED.solar_radiation,
          evapotranspiration_rate = EXCLUDED.evapotranspiration_rate,
          wind_speed              = EXCLUDED.wind_speed
        RETURNING weather_id`
        .returnsRow({ weather_id: "pg/uuid@1" })
        .build(),
    );
    return { weatherId: row.weather_id };
  } catch (e) {
    throw toAppError(e);
  }
}

export async function saveManualWeather(actor: Actor, input: z.infer<typeof manualWeatherSchema>) {
  authorize(actor, "weather.manual");
  await assertFarmAccess(actor, input.farmId);
  return saveWeatherRecord(input);
}

export async function listWeather(actor: Actor, farmId: string, limit = 50) {
  authorize(actor, "farm.read");
  await assertFarmAccess(actor, farmId);
  return db.orm.public.WeatherData.where({ farmId }).orderBy((w) => w.dateTime.desc()).limit(limit).all();
}

export async function deleteWeather(actor: Actor, weatherId: string) {
  authorize(actor, "weather.delete");
  const row = await db.orm.public.WeatherData.where({ weatherId }).first();
  if (!row) throw new AppError("errors.notFound");
  await assertFarmAccess(actor, row.farmId);
  await db.orm.public.WeatherData.where({ weatherId }).delete();
}

/**
 * Latest stored weather for a farm as model features. Values that are missing,
 * or older than MAX_WEATHER_AGE_HOURS, are simply absent: they are omitted from
 * the prediction, never filled with a guess. Not permission-checked (internal).
 */
export async function getWeatherFeatures(farmId: string, now: Date = new Date()): Promise<WeatherSnapshot> {
  const latest = await db.orm.public.WeatherData
    .where({ farmId })
    .where((w) => w.recordType.in([dbText("observed"), dbText("forecast")]))
    .orderBy((w) => w.dateTime.desc())
    .first();
  if (!latest) return { features: {}, observedAt: null };

  const observedAt = parseDbTimestamp(latest.dateTime);
  if (now.getTime() - observedAt.getTime() > MAX_WEATHER_AGE_HOURS * 3_600_000) {
    return { features: {}, observedAt };
  }

  const features: WeatherFeatures = {};
  const put = (key: keyof WeatherFeatures, value: string | null) => {
    const num = fromDbNumber(value);
    if (num !== null) features[key] = num;
  };
  put("Ambient_Temperature", latest.ambientTemperature);
  put("Relative_Humidity", latest.relativeHumidity);
  put("Wind_Speed", latest.windSpeed);
  put("Solar_Radiation", latest.solarRadiation);
  put("Rainfall_24h", latest.rainfall24h);
  put("Rainfall_Forecast_24h", latest.rainfallForecast24h);
  put("Evaporation_Demand", latest.evapotranspirationRate);
  return { features, observedAt };
}
