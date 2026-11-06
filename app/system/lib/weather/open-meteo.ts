import "server-only";
import { fetchWeatherApi } from "openmeteo";
import type { FeaturePayload } from "@/lib/features/catalog";
import { FARM_TIME_ZONE } from "@/lib/time";

// Open-Meteo client (free, no API key, so nothing secret to protect).
// Runs on the server only. It returns the weather features the model uses,
// keyed by the model's feature names, in the units listed in the catalog:
//   Ambient_Temperature   °C      current temperature at 2 m
//   Relative_Humidity     %       current relative humidity at 2 m
//   Wind_Speed            m/s     current wind at 10 m (wind_speed_unit=ms)
//   Soil_Temperature      °C      current modelled soil temperature at 6 cm
//   Rainfall_24h          mm      sum of hourly precipitation over the past 24 h
//   Rainfall_Forecast_24h mm      sum of hourly precipitation over the next 24 h
//   Evaporation_Demand    mm/day  today's FAO reference evapotranspiration (ET₀)
//   Solar_Radiation       MJ/m²   today's shortwave radiation sum
// A value the API doesn't return (or returns as NaN) is simply left out.

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 8_000; // the farmer is waiting on a phone; fail fast and fall back

export type WeatherFeatures = Pick<
  FeaturePayload,
  | "Ambient_Temperature" | "Relative_Humidity" | "Wind_Speed" | "Solar_Radiation"
  | "Rainfall_24h" | "Rainfall_Forecast_24h" | "Evaporation_Demand" | "Soil_Temperature"
>;

export type LiveWeather = {
  /** The time the "current" values refer to (Open-Meteo rounds to 15 minutes). */
  observedAt: Date;
  features: WeatherFeatures;
};

/** Round to the number of decimals the matching DB column stores. */
function round(value: number, decimals: number) {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Keep only finite values inside the feature's valid range. */
function usable(value: number | null | undefined, min = -Infinity, max = Infinity): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export async function fetchOpenMeteo(latitude: number, longitude: number): Promise<LiveWeather> {
  const [response] = await fetchWeatherApi(
    ENDPOINT,
    {
      latitude,
      longitude,
      timezone: FARM_TIME_ZONE, // so "today" (daily values) is the farmer's day
      current: ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "soil_temperature_6cm"],
      hourly: ["precipitation"],
      daily: ["et0_fao_evapotranspiration", "shortwave_radiation_sum"],
      wind_speed_unit: "ms",
      past_days: 1, // needed for "rain over the past 24 hours"
      forecast_days: 2, // needed for "rain over the next 24 hours"
    },
    1, // one retry on a server error, then give up and use stored values
    0.2,
    1,
    { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" },
  );
  if (!response) throw new Error("Open-Meteo returned no data");

  const current = response.current();
  const hourly = response.hourly();
  const daily = response.daily();
  if (!current) throw new Error("Open-Meteo returned no current weather");

  // All Open-Meteo timestamps are Unix seconds in UTC
  const nowSec = Number(current.time());
  const features: WeatherFeatures = {};

  const temperature = current.variables(0)?.value();
  const humidity = current.variables(1)?.value();
  const wind = current.variables(2)?.value();
  const soilTemperature = current.variables(3)?.value();
  if (usable(temperature, -60, 70)) features.Ambient_Temperature = round(temperature, 2);
  if (usable(humidity, 0, 100)) features.Relative_Humidity = round(humidity, 2);
  if (usable(wind, 0)) features.Wind_Speed = round(wind, 2);
  if (usable(soilTemperature, -60, 80)) features.Soil_Temperature = round(soilTemperature, 2);

  // Hourly precipitation at time t is the amount that fell in the hour ending at t.
  // Past 24 h = hours ending in (now-24h, now]; next 24 h = hours ending in (now, now+24h].
  if (hourly) {
    const start = Number(hourly.time());
    const step = hourly.interval();
    const values = hourly.variables(0)?.valuesArray();
    if (values && values.length > 0) {
      let past = 0, next = 0, pastHours = 0, nextHours = 0;
      values.forEach((mm, i) => {
        const t = start + i * step;
        if (!Number.isFinite(mm)) return;
        if (t > nowSec - 86_400 && t <= nowSec) { past += mm; pastHours++; }
        else if (t > nowSec && t <= nowSec + 86_400) { next += mm; nextHours++; }
      });
      // Only report a sum if (nearly) the whole window was covered
      if (pastHours >= 23) features.Rainfall_24h = round(Math.max(0, past), 2);
      if (nextHours >= 23) features.Rainfall_Forecast_24h = round(Math.max(0, next), 2);
    }
  }

  // Daily values: pick the entry for the farmer's current day
  if (daily) {
    const dayIndex = Math.floor((nowSec - Number(daily.time())) / daily.interval());
    const et0 = daily.variables(0)?.valuesArray()?.[dayIndex];
    const radiation = daily.variables(1)?.valuesArray()?.[dayIndex];
    if (usable(et0, 0)) features.Evaporation_Demand = round(et0, 3);
    if (usable(radiation, 0)) features.Solar_Radiation = round(radiation, 3);
  }

  return { observedAt: new Date(nowSec * 1000), features };
}
