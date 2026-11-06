import "server-only";
import type { z } from "zod";
import { db } from "@/lib/db";
import { AppError, toAppError } from "@/lib/errors";
import { authorize, type Actor } from "@/lib/auth/actor";
import { assertFarmAccess } from "@/lib/auth/access";
import { parseDbTimestamp } from "@/lib/time";
import { fetchOpenMeteo, type WeatherFeatures } from "@/lib/weather/open-meteo";
import type { manualWeatherSchema } from "@/lib/validation/schemas";
import { dbText, fromDbNumber } from "./shared";

// Weather for a farm: Open-Meteo, cached, stored, with graceful fallback.
//
//   1. memory cache (< CACHE_MINUTES old)      → no API call
//   2. weather_data row (< CACHE_MINUTES old)  → no API call (also survives restarts)
//   3. Open-Meteo, then saved as an "observed" weather_data row + memory cache
//   4. API down → the last stored row of ANY age, labelled with its timestamp;
//      it is only used for a prediction if it is < MAX_WEATHER_AGE_HOURS old.
//
// Missing values are never filled in: a feature that isn't available is left
// out, and the prediction flow tells the farmer it used fewer inputs.

export type { WeatherFeatures };

/** Reuse weather this recent instead of calling the API again. */
export const CACHE_MINUTES = 30;
/** Weather older than this is not used for a prediction (it would mislead the model). */
export const MAX_WEATHER_AGE_HOURS = 6;

/** The 8 weather features, in display order. */
export const WEATHER_FEATURE_NAMES = [
  "Ambient_Temperature", "Relative_Humidity", "Wind_Speed", "Rainfall_24h",
  "Rainfall_Forecast_24h", "Evaporation_Demand", "Solar_Radiation", "Soil_Temperature",
] as const satisfies ReadonlyArray<keyof WeatherFeatures>;

export type WeatherSnapshot = {
  /** Last known values (may be old when the API is down; see `usableForPrediction`). */
  features: WeatherFeatures;
  /** When the values were observed (null = no weather at all yet). */
  observedAt: Date | null;
  /** live = just fetched; cached = recent copy; stored = old copy because the API failed; none = nothing. */
  source: "live" | "cached" | "stored" | "none";
  /** The API call failed this time (the farmer can retry). */
  fetchFailed: boolean;
  /** False when the values are older than MAX_WEATHER_AGE_HOURS. */
  usableForPrediction: boolean;
  /** Weather features with no value (left out of a prediction). */
  missing: Array<keyof WeatherFeatures>;
};

// ---------------------------------------------------------------- storage

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
 * (farm_id, date_time, record_type), so fetching twice for the same moment
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
  const saved = await saveWeatherRecord(input);
  memoryCache.delete(input.farmId); // the farmer's own entry should win over a cached fetch
  return saved;
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
  memoryCache.delete(row.farmId);
}

// ---------------------------------------------------------------- snapshot

type CacheEntry = { features: WeatherFeatures; observedAt: Date; fetchedAt: number };

// Survives dev hot-reloads (same trick as lib/db.ts). Holds Soil_Temperature
// too, which weather_data has no column for.
const globalForWeather = globalThis as unknown as { weatherCache?: Map<string, CacheEntry> };
const memoryCache = (globalForWeather.weatherCache ??= new Map<string, CacheEntry>());

async function latestStoredWeather(farmId: string): Promise<{ features: WeatherFeatures; observedAt: Date } | null> {
  const latest = await db.orm.public.WeatherData
    .where({ farmId })
    .where((w) => w.recordType.in([dbText("observed"), dbText("forecast")]))
    .orderBy((w) => w.dateTime.desc())
    .first();
  if (!latest) return null;
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
  return { features, observedAt: parseDbTimestamp(latest.dateTime) };
}

function snapshot(
  features: WeatherFeatures, observedAt: Date | null, source: WeatherSnapshot["source"], fetchFailed: boolean, now: Date,
): WeatherSnapshot {
  const fresh = observedAt !== null && now.getTime() - observedAt.getTime() <= MAX_WEATHER_AGE_HOURS * 3_600_000;
  return {
    features,
    observedAt,
    source,
    fetchFailed,
    usableForPrediction: fresh,
    missing: WEATHER_FEATURE_NAMES.filter((name) => features[name] === undefined),
  };
}

const minutesOld = (date: Date, now: Date) => (now.getTime() - date.getTime()) / 60_000;

/**
 * Weather for a farm (see the steps at the top of this file).
 * `force` skips the caches (the farmer pressed "Refresh").
 * Not permission-checked: call through getFarmWeather() from pages/actions.
 */
export async function getWeatherSnapshot(
  farmId: string, options: { force?: boolean; now?: Date } = {},
): Promise<WeatherSnapshot> {
  const now = options.now ?? new Date();

  if (!options.force) {
    const cached = memoryCache.get(farmId);
    if (cached && (now.getTime() - cached.fetchedAt) / 60_000 < CACHE_MINUTES) {
      // Fetched within the last minute (e.g. the page re-rendering right after
      // "Refresh"): still label it as just updated
      const justFetched = now.getTime() - cached.fetchedAt < 60_000;
      return snapshot(cached.features, cached.observedAt, justFetched ? "live" : "cached", false, now);
    }
    const stored = await latestStoredWeather(farmId);
    if (stored && minutesOld(stored.observedAt, now) < CACHE_MINUTES) {
      return snapshot(stored.features, stored.observedAt, "cached", false, now);
    }
  }

  const farm = await db.orm.public.Farm.select("latitude", "longitude").where({ farmId }).first();
  if (!farm) throw new AppError("errors.notFound");

  try {
    const live = await fetchOpenMeteo(Number(farm.latitude), Number(farm.longitude));
    const f = live.features;
    await saveWeatherRecord({
      farmId,
      dateTime: live.observedAt.toISOString(),
      recordType: "observed",
      ambientTemperature: f.Ambient_Temperature,
      relativeHumidity: f.Relative_Humidity,
      windSpeed: f.Wind_Speed,
      rainfall24h: f.Rainfall_24h,
      rainfallForecast24h: f.Rainfall_Forecast_24h,
      evapotranspirationRate: f.Evaporation_Demand,
      solarRadiation: f.Solar_Radiation,
      // Soil_Temperature has no weather_data column; it lives in the cache and,
      // when used, in the prediction row
    });
    memoryCache.set(farmId, { features: f, observedAt: live.observedAt, fetchedAt: now.getTime() });
    return snapshot(f, live.observedAt, "live", false, now);
  } catch (e) {
    // Log for us, fall back for the farmer
    console.error("[weather] Open-Meteo request failed:", e instanceof Error ? e.message : e);
    const stored = await latestStoredWeather(farmId);
    return stored
      ? snapshot(stored.features, stored.observedAt, "stored", true, now)
      : snapshot({}, null, "none", true, now);
  }
}

/** Weather for the farm page / refresh button, with permission checks. */
export async function getFarmWeather(actor: Actor, farmId: string, options: { force?: boolean } = {}) {
  authorize(actor, options.force ? "weather.refresh" : "farm.read");
  await assertFarmAccess(actor, farmId);
  return getWeatherSnapshot(farmId, options);
}

/**
 * Weather features for a prediction: only values recent enough to describe
 * today. Old or missing values are absent (the model service estimates them).
 * Not permission-checked (internal).
 */
export async function getWeatherFeatures(farmId: string, now: Date = new Date()) {
  const snap = await getWeatherSnapshot(farmId, { now });
  return {
    features: snap.usableForPrediction ? snap.features : {},
    observedAt: snap.observedAt,
    snapshot: snap,
  };
}
